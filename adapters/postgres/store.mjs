import pg from 'pg';

export function createPool(connectionString) {
  if (!connectionString) throw Error('DATABASE_URL is required for PostgreSQL');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: 'papbox', options: '-c search_path=public -c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
  pool.on('error', error => console.error('PostgreSQL idle connection error:', error.code || 'unknown'));
  return pool;
}
export class PostgresStore {
  constructor(pool) { this.pool = pool; }
  async initialize() {
    const {rows:[role]} = await this.pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if (role.rolsuper || role.rolbypassrls) throw Error('PAPbox requires a non-superuser role without BYPASSRLS');
    const result = await this.pool.query("SELECT version FROM schema_migrations WHERE version='002_audit_permissions.sql'");
    if (!result.rowCount) throw Error('Run npm run db:migrate before starting PAPbox');
  }
  async scoped(tenant, write, operation) {
    if (typeof tenant !== 'string' || !/^[a-z][a-z0-9_-]{0,62}$/.test(tenant)) throw Error('Valid tenant context required');
    const client = await this.pool.connect();
    try {
      await client.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SELECT set_config('papbox.tenant_id', $1, true)", [tenant]);
      if (write) await client.query("SELECT pg_advisory_xact_lock(hashtextextended('papbox:tenant:' || $1, 0))", [tenant]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async load(client, tenant) {
    const state = { tenants: {} };
    if (!(await client.query('SELECT id FROM tenants WHERE id=$1', [tenant])).rowCount) return state;
    const settings = (await client.query('SELECT name,locale FROM tenant_settings WHERE tenant_id=$1', [tenant])).rows[0];
    const users = (await client.query('SELECT id,name,email,role,password_hash AS hash FROM users WHERE tenant_id=$1 ORDER BY created_at,id', [tenant])).rows;
    const modules = Object.fromEntries((await client.query('SELECT module_id,version,enabled FROM installed_modules WHERE tenant_id=$1', [tenant])).rows.map(({module_id,...item})=>[module_id,item]));
    const menus = Object.fromEntries((await client.query('SELECT menu_id,name,position AS "order",hidden FROM menu_overrides WHERE tenant_id=$1', [tenant])).rows.map(({menu_id,...item})=>[menu_id,item]));
    const audit = (await client.query('SELECT actor_id AS "user",action,occurred_at FROM (SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20) recent ORDER BY occurred_at,id', [tenant])).rows.map(({occurred_at,...item})=>({...item,at:occurred_at.toISOString()}));
    state.tenants[tenant] = { settings, users, modules, menus, audit };
    return state;
  }
  read(tenant = 'default') { return this.scoped(tenant,false,client=>this.load(client,tenant)); }
  transact(operation, tenant = 'default') {
    return this.scoped(tenant,true,async client=>{
      const state = await this.load(client,tenant), before = structuredClone(state.tenants[tenant]);
      const result = await operation(state);
      if (Object.keys(state.tenants).some(id=>id!==tenant) || !state.tenants[tenant]) throw Error('Transaction must preserve its tenant scope');
      const next = state.tenants[tenant];
      if (!before) await client.query('INSERT INTO tenants(id) VALUES ($1)',[tenant]);
      if (JSON.stringify(next.settings)!==JSON.stringify(before?.settings)) await client.query('INSERT INTO tenant_settings(tenant_id,name,locale) VALUES ($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET name=excluded.name,locale=excluded.locale',[tenant,next.settings.name,next.settings.locale]);
      const oldUsers = new Map(before?.users.map(user=>[user.id,user]) || []);
      for (const user of next.users) if (JSON.stringify(user)!==JSON.stringify(oldUsers.get(user.id))) await client.query('INSERT INTO users(tenant_id,id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,id) DO UPDATE SET name=excluded.name,email=excluded.email,password_hash=excluded.password_hash,role=excluded.role',[tenant,user.id,user.name,user.email,user.hash,user.role]);
      if ([...oldUsers.keys()].some(id=>!next.users.some(user=>user.id===id))) throw Error('User deletion requires an explicit lifecycle service');
      for (const [property, table, key, fields] of [['modules','installed_modules','module_id',['version','enabled']],['menus','menu_overrides','menu_id',['name','position','hidden']]]) {
        for (const id of Object.keys(before?.[property] || {})) if (!Object.hasOwn(next[property],id)) await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND ${key}=$2`,[tenant,id]);
        for (const [id,item] of Object.entries(next[property])) if (JSON.stringify(item)!==JSON.stringify(before?.[property]?.[id])) {
          const values=property==='modules'?[item.version,item.enabled]:[item.name,item.order,item.hidden];
          await client.query(`INSERT INTO ${table}(tenant_id,${key},${fields.join(',')}) VALUES ($1,$2,${fields.map((_,i)=>'$'+(i+3)).join(',')}) ON CONFLICT(tenant_id,${key}) DO UPDATE SET ${fields.map(field=>`${field}=excluded.${field}`).join(',')}`,[tenant,id,...values]);
        }
      }
      const previousAudit = before?.audit || [];
      if (JSON.stringify(next.audit.slice(0,previousAudit.length))!==JSON.stringify(previousAudit)) throw Error('Audit history is append-only');
      for (const entry of next.audit.slice(previousAudit.length)) await client.query('INSERT INTO audit_events(tenant_id,actor_id,action,occurred_at) VALUES($1,$2,$3,$4)',[tenant,entry.user,entry.action,entry.at]);
      return result;
    });
  }
  close() { return this.pool.end(); }
}
