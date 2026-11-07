import { parseArgs } from 'node:util';
import { Fault } from '../core/kernel.mjs';
import { passwordHash } from '../system/security.mjs';
import { audit, revokeUser, tenantPattern } from '../system/identity.mjs';
import { runtimeStore, readPassword } from './runtime-store.mjs';
const {values}=parseArgs({options:{tenant:{type:'string'},email:{type:'string'},'disable-mfa':{type:'boolean'},confirm:{type:'string'}}});
if(!tenantPattern.test(values.tenant || '') || !values.email)throw Error('Usage: account:recover -- --tenant tenant --email user@example.com (password on stdin)');
if(values['disable-mfa'] && values.confirm!==values.tenant+':'+values.email)throw Error('MFA recovery requires --confirm tenant:email');
const hash=passwordHash(await readPassword()),store=await runtimeStore();
try{await store.transact(state=>{const tenant=state.tenants[values.tenant],user=tenant?.users.find(u=>u.email===values.email.toLowerCase() && u.active!==false);if(!user)throw new Fault(404,'Active user not found');if(values['disable-mfa']){user.security={};audit(tenant,user.id,'operator.mfa-recovery');}user.hash=hash;revokeUser(tenant,user);audit(tenant,user.id,'operator.account-recovery');},values.tenant);console.log('Password changed; previous sessions and reset tokens revoked');}
finally{await store.close?.();}
