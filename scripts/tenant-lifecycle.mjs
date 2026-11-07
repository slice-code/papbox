import { parseArgs } from 'node:util';
import { readFile,writeFile } from 'node:fs/promises';
import { runtimeStore } from './runtime-store.mjs';
import { tenantStatus,exportTenant,restoreTenant,purgeTenant } from '../system/tenants.mjs';
const {values}=parseArgs({options:{action:{type:'string'},id:{type:'string'},status:{type:'string'},confirm:{type:'string'},file:{type:'string'}}});
if(!['status','export','restore','purge'].includes(values.action))throw Error('Use --action status|export|restore|purge; see docs/OPERATIONS.md');
let store;
if(values.action==='purge' && process.env.DATABASE_URL){
 if(!process.env.DATABASE_MIGRATION_URL)throw Error('Operator purge requires DATABASE_MIGRATION_URL');
 const {PostgresStore,createPool}=await import('../adapters/postgres/store.mjs');store=new PostgresStore(createPool(process.env.DATABASE_MIGRATION_URL));
}else store=await runtimeStore();
try{
 if(values.action==='status')await tenantStatus(store,values.id,values.status,values.confirm);
 else{
  if(!values.file)throw Error('--file is required');
  if(values.action==='export')await writeFile(values.file,JSON.stringify(await exportTenant(store,values.id),null,2)+'\n',{mode:0o600,flag:'wx'});
  else {const backup=JSON.parse(await readFile(values.file,'utf8'));if(values.confirm!==backup.tenant)throw Error('--confirm must match backup tenant');if(values.action==='restore')await restoreTenant(store,backup);else await purgeTenant(store,backup,values.confirm);}
 }
 console.log('Tenant operation completed:',values.action);
}finally{await store.close?.();}
