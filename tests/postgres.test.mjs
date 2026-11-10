import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPool, PostgresStore } from '../adapters/postgres/store.mjs';
import { migrate } from '../adapters/postgres/migrate.mjs';
import { Kernel } from '../core/kernel.mjs';
import { registerSystem, roles, passwordHash } from '../system/services.mjs';
import { createApp } from '../server.mjs';
import {posContract} from './helpers/pos-contract.mjs';
import {outboxContract} from './helpers/outbox-contract.mjs';
import {operationsContract} from './helpers/operations-contract.mjs';
import {accessContract} from './helpers/access-contract.mjs';
import { systemContract } from './helpers/system-contract.mjs';
import { importJson } from '../scripts/import-json.mjs';

const enabled=Boolean(process.env.TEST_DATABASE_ADMIN_URL && process.env.TEST_DATABASE_URL);
if(process.env.PAPBOX_REQUIRE_POSTGRES_TESTS && !enabled) throw Error('TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL are required');
test('PostgreSQL migrations, tenant RLS, rollback, concurrency, constraints, HTTP and restart', {skip:!enabled},async t=>{
 const database='papbox_test_'+randomUUID().replaceAll('-','');
 const admin=createPool(process.env.TEST_DATABASE_ADMIN_URL);
 await admin.query(`CREATE DATABASE ${database}`);
 const url=value=>{const result=new URL(value);result.pathname='/'+database;return result.toString();};
 const migrationPool=createPool(url(process.env.TEST_DATABASE_ADMIN_URL));
 const pool=createPool(url(process.env.TEST_DATABASE_URL)),store=new PostgresStore(pool);
 t.after(async()=>{await pool.end();await migrationPool.end();await admin.query(`DROP DATABASE ${database}`);await admin.end();});
 await migrate(migrationPool);await migrate(migrationPool);
 assert.equal((await migrationPool.query('SELECT count(*)::integer AS count FROM schema_migrations')).rows[0].count,7);
 const originalChecksum=(await migrationPool.query("SELECT checksum FROM schema_migrations WHERE version='001_platform.sql'")).rows[0].checksum;
 await migrationPool.query("UPDATE schema_migrations SET checksum='tampered' WHERE version='001_platform.sql'");
 await assert.rejects(migrate(migrationPool),/checksum mismatch/);
 await migrationPool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='001_platform.sql'",[originalChecksum]);
 await migrationPool.query('GRANT USAGE ON SCHEMA public TO papbox_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO papbox_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO papbox_app; REVOKE UPDATE,DELETE,TRUNCATE ON audit_events FROM papbox_app; REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON schema_migrations FROM papbox_app');
 await store.initialize();
 const unsafeStore=new PostgresStore(migrationPool);await assert.rejects(unsafeStore.initialize(),/non-superuser/);
 const adminId=randomUUID();
 for(const tenant of ['alpha','beta'])await store.transact(state=>{state.tenants[tenant]={users:[{id:adminId,name:'Admin',email:'same@example.com',role:'admin',hash:passwordHash('correct horse battery')}],settings:{name:tenant,locale:'id-ID'},modules:{},menus:{},audit:[]};},tenant);
 const kernel=new Kernel();registerSystem(kernel,store);const ctx=tenant=>({tenant,user:adminId,permissions:roles.admin});
 await kernel.invoke('apps.change',ctx('alpha'),{id:'pos',action:'install',approved:true});
 assert((await kernel.invoke('launcher.read',ctx('alpha'))).some(a=>a.id==='pos'));
 assert(!(await kernel.invoke('launcher.read',ctx('beta'))).some(a=>a.id==='pos'));
 assert.equal((await store.read('alpha')).tenants.alpha.audit.length,1);
 const client=await pool.connect();
 try{
  assert.equal((await client.query('SELECT * FROM users')).rowCount,0);
  await client.query('BEGIN');await client.query("SELECT set_config('papbox.tenant_id','alpha',true)");
  assert.equal((await client.query("SELECT * FROM users WHERE tenant_id='beta'")).rowCount,0);
  await assert.rejects(client.query("INSERT INTO tenant_settings(tenant_id,name) VALUES('beta','leak')"),e=>e.code==='42501');await client.query('ROLLBACK');
  assert.equal((await client.query('SELECT * FROM users')).rowCount,0);
  await client.query('BEGIN');await client.query("SELECT set_config('papbox.tenant_id','alpha',true)");
  await assert.rejects(client.query('DELETE FROM audit_events'),e=>e.code==='42501');await client.query('ROLLBACK');
 }finally{client.release();}
 await assert.rejects(store.transact(s=>{s.tenants.alpha.settings.name='should rollback';s.tenants.alpha.users.push({...s.tenants.alpha.users[0],id:randomUUID()});},'alpha'),e=>e.code==='23505');
 assert.equal((await store.read('alpha')).tenants.alpha.settings.name,'alpha');
 await assert.rejects(store.transact(s=>{s.tenants.alpha.settings.name='bad';throw Error('abort');},'alpha'),/abort/);
 await Promise.all(Array.from({length:10},()=>store.transact(s=>{const m=s.tenants.alpha.menus.counter;s.tenants.alpha.menus.counter={name:'Counter',order:(m?.order||0)+1,hidden:false};},'alpha')));
 assert.equal((await store.read('alpha')).tenants.alpha.menus.counter.order,10);
 await assert.rejects(store.transact(s=>{s.tenants.alpha.audit=[];},'alpha'),/append-only/);
 for(let i=0;i<25;i++)await kernel.invoke('settings.save',ctx('alpha'),{name:'Audit '+i});
 assert.equal((await kernel.invoke('settings.list',ctx('alpha'))).audit.length,20);
 assert.equal(await store.scoped('alpha',false,async client=>(await client.query('SELECT count(*)::integer AS count FROM audit_events')).rows[0].count),26);
 const freshPool=createPool(url(process.env.TEST_DATABASE_URL));
 try { const freshStore=new PostgresStore(freshPool);await freshStore.initialize();assert.equal((await freshStore.read('alpha')).tenants.alpha.settings.name,'Audit 24'); } finally { await freshPool.end(); }
 const imported={users:[{id:randomUUID(),name:'Imported',email:'import@example.com',role:'admin',hash:passwordHash('import password 123')}],settings:{name:'Imported',locale:'id-ID'},modules:{},menus:{},audit:[]};
 await importJson(store,{tenants:{imported}});assert.equal((await store.read('imported')).tenants.imported.users[0].email,'import@example.com');
 await assert.rejects(importJson(store,{tenants:{imported}}),/already exists/);
 const {server}=createApp({store});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'First admin',email:'default@example.com',password:'default password 123'})});assert.equal(setup.status,200);
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'alpha',email:'same@example.com',password:'correct horse battery'})});
  assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
  const saved=await fetch(base+'/api/services/settings.save',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({name:'Postgres workspace'})});assert.equal(saved.status,200);
  assert.equal((await new PostgresStore(pool).read('alpha')).tenants.alpha.settings.name,'Postgres workspace');
  assert.equal((await store.read('beta')).tenants.beta.settings.name,'beta');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 const replicaPool=createPool(url(process.env.TEST_DATABASE_URL));
 try{const replicaStore=new PostgresStore(replicaPool);await replicaStore.initialize();await systemContract(store,{replicaStore});await accessContract(store);await posContract(store,{replicaStore,operatorStore:new PostgresStore(migrationPool)});await outboxContract(store,{replicaStore});await operationsContract(store,{operatorStore:new PostgresStore(migrationPool)});}finally{await replicaPool.end();}
});
