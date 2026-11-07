import { parseArgs } from 'node:util';
import { provisionTenant } from '../system/identity.mjs';
import { runtimeStore, readPassword } from './runtime-store.mjs';
const {values}=parseArgs({options:{id:{type:'string'},name:{type:'string'},email:{type:'string'},'admin-name':{type:'string'}}});
if(!values.id || !values.name || !values.email || !values['admin-name'])throw Error('Usage: tenant:create -- --id tenant --name Workspace --email admin@example.com --admin-name Admin (password on stdin)');
const password=await readPassword(),store=await runtimeStore();
try{const result=await provisionTenant(store,{tenant:values.id,name:values.name,email:values.email,adminName:values['admin-name'],password});console.log('Tenant created:',result.tenant);}
finally{await store.close?.();}
