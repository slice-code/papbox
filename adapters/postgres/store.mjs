import pg from 'pg';

export function createPool(connectionString) {
  if (!connectionString) throw Error('DATABASE_URL is required for PostgreSQL');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: 'papbox', options: '-c search_path=public -c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
  pool.on('error', error => console.error(JSON.stringify({event:'db.connection-error',code:error.code||'unknown'})));
  return pool;
}
export class PostgresStore {
  constructor(pool) { this.pool = pool; }
  async initialize() {
    const {rows:[role]} = await this.pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if (role.rolsuper || role.rolbypassrls) throw Error('PAPbox requires a non-superuser role without BYPASSRLS');
    const result = await this.pool.query("SELECT version FROM schema_migrations WHERE version='006_mail_outbox.sql'");
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
    const tenantRow=(await client.query('SELECT id,status,mail_worker_seen_at FROM tenants WHERE id=$1',[tenant])).rows[0];
    if(!tenantRow)return state;
    const settings = (await client.query('SELECT name,locale FROM tenant_settings WHERE tenant_id=$1', [tenant])).rows[0];
    const users = (await client.query('SELECT id,name,email,role,active,security,auth_version AS "authVersion",password_hash AS hash FROM users WHERE tenant_id=$1 ORDER BY created_at,id', [tenant])).rows;
    const modules = Object.fromEntries((await client.query('SELECT module_id,version,enabled,package,history FROM installed_modules WHERE tenant_id=$1', [tenant])).rows.map(({module_id,...item})=>[module_id,item]));
    const menus = Object.fromEntries((await client.query('SELECT menu_id,name,position AS "order",hidden FROM menu_overrides WHERE tenant_id=$1', [tenant])).rows.map(({menu_id,...item})=>[menu_id,item]));
    const audit = (await client.query('SELECT actor_id AS "user",action,occurred_at,details FROM (SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20) recent ORDER BY occurred_at,id', [tenant])).rows.map(({occurred_at,...item})=>({...item,at:occurred_at.toISOString()}));
    const security = {};
    for (const [property,table] of [['sessions','sessions'],['passwordResets','password_resets']]) {
      security[property]=Object.fromEntries((await client.query(`SELECT token_hash,user_id,auth_version,expires_at FROM ${table} WHERE tenant_id=$1`,[tenant])).rows.map(row=>[row.token_hash,{user:row.user_id,authVersion:row.auth_version,expires:row.expires_at.getTime()}]));
    }
    const roles=Object.fromEntries((await client.query('SELECT id,name,permissions FROM roles WHERE tenant_id=$1',[tenant])).rows.map(({id,...role})=>[id,role]));
    const approvals=Object.fromEntries((await client.query('SELECT id,requester_id AS "user",auth_version AS "authVersion",service,input,status,expires_at,approver_id AS approver FROM approvals WHERE tenant_id=$1',[tenant])).rows.map(({id,expires_at,...item})=>[id,{...item,expires:new Date(expires_at).getTime()}]));
    const mailOutbox=Object.fromEntries((await client.query('SELECT id,user_id AS "user",auth_version AS "authVersion",reset_hash AS "resetHash",payload,status,attempts,created_at,next_attempt_at,expires_at,lease,lease_until,last_error AS "lastError" FROM mail_outbox WHERE tenant_id=$1',[tenant])).rows.map(({id,created_at,next_attempt_at,expires_at,lease_until,...job})=>[id,{...job,createdAt:new Date(created_at).getTime(),nextAttempt:new Date(next_attempt_at).getTime(),expires:new Date(expires_at).getTime(),leaseUntil:lease_until?new Date(lease_until).getTime():null}]));
    state.tenants[tenant] = { mailOutbox,mailWorkerSeenAt:tenantRow.mail_worker_seen_at?new Date(tenantRow.mail_worker_seen_at).getTime():null,approvals,status:tenantRow.status,roles, settings, users, modules, menus, audit, ...security };
    return state;
  }
  read(tenant = 'default') { return this.scoped(tenant,false,client=>this.load(client,tenant)); }
  transact(operation, tenant = 'default') {
    return this.scoped(tenant,true,async client=>{
      const state = await this.load(client,tenant), before = structuredClone(state.tenants[tenant]);
      const result = await operation(state,{client});
      if (Object.keys(state.tenants).some(id=>id!==tenant) || !state.tenants[tenant]) throw Error('Transaction must preserve its tenant scope');
      const next = state.tenants[tenant];
      if (!before) await client.query('INSERT INTO tenants(id,status) VALUES ($1,$2)',[tenant,next.status||'active']);
      else if((next.status||'active')!==before.status)await client.query('UPDATE tenants SET status=$2 WHERE id=$1',[tenant,next.status||'active']);
      if((next.mailWorkerSeenAt||null)!==(before?.mailWorkerSeenAt||null))await client.query('UPDATE tenants SET mail_worker_seen_at=$2 WHERE id=$1',[tenant,next.mailWorkerSeenAt?new Date(next.mailWorkerSeenAt):null]);
      for(const id of Object.keys(before?.roles||{}))if(!Object.hasOwn(next.roles||{},id))await client.query('DELETE FROM roles WHERE tenant_id=$1 AND id=$2',[tenant,id]);
      for(const [id,role] of Object.entries(next.roles||{}))if(JSON.stringify(role)!==JSON.stringify(before?.roles?.[id]))await client.query('INSERT INTO roles(tenant_id,id,name,permissions) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions',[tenant,id,role.name,role.permissions]);
      if (JSON.stringify(next.settings)!==JSON.stringify(before?.settings)) await client.query('INSERT INTO tenant_settings(tenant_id,name,locale) VALUES ($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET name=excluded.name,locale=excluded.locale',[tenant,next.settings.name,next.settings.locale]);
      const oldUsers = new Map(before?.users.map(user=>[user.id,user]) || []);
      for (const user of next.users) if (JSON.stringify(user)!==JSON.stringify(oldUsers.get(user.id))) await client.query('INSERT INTO users(tenant_id,id,name,email,password_hash,role,active,auth_version,security) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,id) DO UPDATE SET name=excluded.name,email=excluded.email,password_hash=excluded.password_hash,role=excluded.role,active=excluded.active,auth_version=excluded.auth_version,security=excluded.security',[tenant,user.id,user.name,user.email,user.hash,user.role,user.active!==false,user.authVersion||1,user.security||{}]);
      if ([...oldUsers.keys()].some(id=>!next.users.some(user=>user.id===id))) throw Error('User deletion requires an explicit lifecycle service');
      for (const [property, table, key, fields] of [['modules','installed_modules','module_id',['version','enabled','package','history']],['menus','menu_overrides','menu_id',['name','position','hidden']]]) {
        for (const id of Object.keys(before?.[property] || {})) if (!Object.hasOwn(next[property],id)) await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND ${key}=$2`,[tenant,id]);
        for (const [id,item] of Object.entries(next[property])) if (JSON.stringify(item)!==JSON.stringify(before?.[property]?.[id])) {
          const values=property==='modules'?[item.version,item.enabled,item.package||null,JSON.stringify(item.history||[])]:[item.name,item.order,item.hidden];
          await client.query(`INSERT INTO ${table}(tenant_id,${key},${fields.join(',')}) VALUES ($1,$2,${fields.map((_,i)=>'$'+(i+3)).join(',')}) ON CONFLICT(tenant_id,${key}) DO UPDATE SET ${fields.map(field=>`${field}=excluded.${field}`).join(',')}`,[tenant,id,...values]);
        }
      }
      for(const [property,table] of [['sessions','sessions'],['passwordResets','password_resets']]) {
        for(const hash of Object.keys(before?.[property]||{}))if(!Object.hasOwn(next[property]||{},hash))await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND token_hash=$2`,[tenant,hash]);
        for(const [hash,item] of Object.entries(next[property]||{}))if(JSON.stringify(item)!==JSON.stringify(before?.[property]?.[hash]))await client.query(`INSERT INTO ${table}(tenant_id,token_hash,user_id,auth_version,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,token_hash) DO UPDATE SET auth_version=excluded.auth_version,expires_at=excluded.expires_at`,[tenant,hash,item.user,item.authVersion,new Date(item.expires)]);
      }
      for(const id of Object.keys(before?.approvals||{}))if(!Object.hasOwn(next.approvals||{},id))await client.query('DELETE FROM approvals WHERE tenant_id=$1 AND id=$2',[tenant,id]);
      for(const [id,item] of Object.entries(next.approvals||{}))if(JSON.stringify(item)!==JSON.stringify(before?.approvals?.[id]))await client.query('INSERT INTO approvals(tenant_id,id,requester_id,auth_version,service,input,status,expires_at,approver_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,id) DO UPDATE SET status=excluded.status,approver_id=excluded.approver_id',[tenant,id,item.user,item.authVersion,item.service,item.input,item.status,new Date(item.expires),item.approver||null]);
      for(const id of Object.keys(before?.mailOutbox||{}))if(!Object.hasOwn(next.mailOutbox||{},id))await client.query('DELETE FROM mail_outbox WHERE tenant_id=$1 AND id=$2',[tenant,id]);
      for(const [id,job] of Object.entries(next.mailOutbox||{}))if(JSON.stringify(job)!==JSON.stringify(before?.mailOutbox?.[id]))await client.query('INSERT INTO mail_outbox(tenant_id,id,user_id,auth_version,reset_hash,payload,status,attempts,created_at,next_attempt_at,expires_at,lease,lease_until,last_error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(tenant_id,id) DO UPDATE SET payload=excluded.payload,status=excluded.status,attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,lease=excluded.lease,lease_until=excluded.lease_until,last_error=excluded.last_error',[tenant,id,job.user,job.authVersion,job.resetHash,job.payload,job.status,job.attempts,new Date(job.createdAt),new Date(job.nextAttempt),new Date(job.expires),job.lease,job.leaseUntil?new Date(job.leaseUntil):null,job.lastError]);
      if(!before)for(const [module,records] of Object.entries(next.records||{}))for(const row of Object.values(records))await client.query('INSERT INTO module_records(tenant_id,module_id,id,owner_id,data,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,module,row.id,row.owner,row.data,row.revision,row.createdAt,row.updatedAt]);
      const previousAudit = before?.audit || [];
      if (JSON.stringify(next.audit.slice(0,previousAudit.length))!==JSON.stringify(previousAudit)) throw Error('Audit history is append-only');
      for (const entry of next.audit.slice(previousAudit.length)) await client.query('INSERT INTO audit_events(tenant_id,actor_id,action,occurred_at,details) VALUES($1,$2,$3,$4,$5)',[tenant,entry.user,entry.action,entry.at,entry.details||{}]);
      return result;
    });
  }
  async health(){const result=await this.pool.query("SELECT count(*)::integer AS version FROM schema_migrations WHERE version='006_mail_outbox.sql'");if(result.rows[0].version!==1)throw Error('Schema not ready');for(const table of ['mail_outbox','roles','module_records','approvals','sessions','users'])await this.pool.query(`SELECT 1 FROM ${table} LIMIT 0`);}
  async exportSnapshot(client,tenant){
    const data=(await this.load(client,tenant)).tenants[tenant];if(!data)return null;
    data.audit=(await client.query('SELECT actor_id AS "user",action,occurred_at,details FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at,id',[tenant])).rows.map(({occurred_at,...entry})=>({...entry,at:occurred_at.toISOString()}));
    data.records={};
    for(const {module_id,...row} of (await client.query('SELECT module_id,id,owner_id AS owner,data,revision,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE tenant_id=$1 ORDER BY module_id,id',[tenant])).rows){data.records[module_id]||={};data.records[module_id][row.id]=row;}
    return JSON.parse(JSON.stringify(data));
  }
  exportTenant(tenant){return this.scoped(tenant,false,client=>this.exportSnapshot(client,tenant));}
  purgeTenant(tenant,validate){return this.scoped(tenant,true,async client=>{
    validate(await this.exportSnapshot(client,tenant));
    // Operator-only: runtime role deliberately cannot delete audit history.
    for(const table of ['mail_outbox','approvals','sessions','password_resets','module_records','menu_overrides','installed_modules','roles','tenant_settings','audit_events','users'])await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`,[tenant]);
    await client.query('DELETE FROM tenants WHERE id=$1',[tenant]);return {ok:true};
  });}
  async allowAuth(key,limit=10) {
    await this.pool.query('DELETE FROM auth_rate_limits WHERE bucket < floor(extract(epoch from now())/60)::bigint - 1');
    const result=await this.pool.query('INSERT INTO auth_rate_limits(key_hash,bucket,attempts) VALUES($1,floor(extract(epoch from now())/60)::bigint,1) ON CONFLICT(key_hash,bucket) DO UPDATE SET attempts=auth_rate_limits.attempts+1 RETURNING attempts',[key]);
    return result.rows[0].attempts<=limit;
  }
  close() { return this.pool.end(); }
}
