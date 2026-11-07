import { createHash } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
import { canonical } from './packages.mjs';
import { audit,revokeUser,tenantPattern } from './identity.mjs';
export const backupDigest=data=>createHash('sha256').update(canonical(JSON.parse(JSON.stringify(data)))).digest('hex');
export async function tenantStatus(store,id,status,confirm){
 if(typeof id!=='string'||!tenantPattern.test(id)||confirm!==id||!['active','suspended','archived'].includes(status))throw new Fault(400,'Konfirmasi tenant dan status diperlukan');
 return store.transact(state=>{
  const tenant=state.tenants[id];if(!tenant)throw new Fault(404,'Tenant tidak ditemukan');
  if((tenant.status||'active')===status)return {ok:true,status};
  for(const user of tenant.users)revokeUser(tenant,user);
  tenant.status=status;audit(tenant,tenant.users[0].id,'operator.tenant-'+status);return {ok:true,status};
 },id);
}
export function makeBackup(id,data){const copy=JSON.parse(JSON.stringify(data));return {format:'papbox.tenant-backup/1',tenant:id,exportedAt:new Date().toISOString(),sha256:backupDigest(copy),data:copy};}
export async function exportTenant(store,id){
 if(typeof id!=='string'||!tenantPattern.test(id))throw new Fault(400,'ID tenant tidak valid');
 const data=store.exportTenant?await store.exportTenant(id):(await store.read()).tenants[id];
 if(!data)throw new Fault(404,'Tenant tidak ditemukan');
 return makeBackup(id,data);
}
export function verifyBackup(backup){
 if(backup?.format!=='papbox.tenant-backup/1'||typeof backup.tenant!=='string'||!tenantPattern.test(backup.tenant)||!backup.data||typeof backup.data!=='object'||Array.isArray(backup.data)||!Array.isArray(backup.data.users)||!backup.data.users.length||!Array.isArray(backup.data.audit)||!backup.data.settings||!backup.data.modules||!backup.data.menus||backup.sha256!==backupDigest(backup.data))throw new Fault(400,'Backup tidak valid atau checksum tidak cocok');
 return backup;
}
export async function restoreTenant(store,backup){
 verifyBackup(backup);
 return store.transact(state=>{
  if(Object.hasOwn(state.tenants,backup.tenant))throw new Fault(409,'Tenant tujuan sudah ada');
  const data=structuredClone(backup.data);
  // A restored tenant never revives old sessions or outstanding recovery tokens.
  for(const user of data.users)revokeUser(data,user);
  data.status='archived';audit(data,data.users[0].id,'operator.tenant-restored');
  state.tenants[backup.tenant]=data;return {ok:true,tenant:backup.tenant,status:'archived'};
 },backup.tenant);
}
export async function purgeTenant(store,backup,confirm){
 verifyBackup(backup);if(confirm!==backup.tenant)throw new Fault(400,'Konfirmasi ID tenant diperlukan');
 const validate=data=>{
  if(!data)throw new Fault(404,'Tenant tidak ditemukan');
  if(data.status!=='archived'||backup.data.status!=='archived')throw new Fault(409,'Arsipkan tenant sebelum backup dan penghapusan');
  if(backupDigest(data)!==backup.sha256)throw new Fault(409,'Data berubah sejak backup; buat backup baru');
 };
 if(store.purgeTenant)return store.purgeTenant(backup.tenant,validate);
 return store.transact(state=>{validate(state.tenants[backup.tenant]);delete state.tenants[backup.tenant];return {ok:true};});
}
