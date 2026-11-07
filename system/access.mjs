import { Fault } from '../core/kernel.mjs';
export const systemPermissions={
 'launcher.read':['all'],'users.read':['all'],'users.create':['all'],'users.update':['all'],'users.reset':['all'],
 'apps.read':['all'],'apps.install':['all'],'apps.enable':['all'],'apps.disable':['all'],'apps.uninstall':['all'],'apps.rollback':['all'],
 'menus.read':['all'],'menus.update':['all'],'settings.read':['all'],'settings.update':['all'],
 'approvals.read':['all'],'approvals.approve':['all'],'roles.read':['all'],'roles.manage':['all'],'roles.assign':['all'],'contracts.read':['all']
};
export const baselineRoles={admin:['launcher.read',...Object.keys(systemPermissions)],member:['launcher.read']};
export const modulePermissions=id=>({[id+'.open']:['all'],[id+'.records.read']:['own','all'],[id+'.records.create']:['own','all'],[id+'.records.update']:['own','all'],[id+'.records.delete']:['own','all']});
export function permissionCatalog(tenant){
 const result={...systemPermissions};for(const id of Object.keys(tenant.modules||{}))Object.assign(result,modulePermissions(id));return result;
}
export function effectivePermissions(tenant,user){
 const catalog=permissionCatalog(tenant);
 if(user.role==='admin')return Object.fromEntries(Object.keys(catalog).map(id=>[id,'all']));
 if(user.role==='member')return {'launcher.read':'all'};
 const grants=tenant.roles?.[user.role]?.permissions || {};
 return {'launcher.read':'all',...Object.fromEntries(Object.entries(grants).filter(([id,scope])=>catalog[id]?.includes(scope)))};
}
export function access(tenant,user,permission,owner){
 const scope=effectivePermissions(tenant,user)[permission];
 if(!scope || owner!==undefined && scope==='own' && owner!==user.id)throw new Fault(403,'Akses ditolak');
 return scope;
}
export function roleExists(tenant,id){return ['admin','member'].includes(id) || Object.hasOwn(tenant.roles||{},id);}
export function canAssign(tenant,actor,role){
 if(!roleExists(tenant,role))throw new Fault(400,'Peran tidak ditemukan');
 if(actor.role==='admin')return;
 access(tenant,actor,'roles.assign');
 const own=effectivePermissions(tenant,actor),target=effectivePermissions(tenant,{role});
 if(role==='admin' || Object.entries(target).some(([id,scope])=>!own[id] || scope==='all' && own[id]!=='all'))throw new Fault(403,'Tidak boleh memberikan akses melebihi izin sendiri');
}

export function manageTarget(tenant,actor,target){
 if(actor.role==='admin')return;
 const own=effectivePermissions(tenant,actor),other=effectivePermissions(tenant,target);
 if(target.role==='admin' || Object.entries(other).some(([id,scope])=>!own[id] || scope==='all' && own[id]!=='all'))throw new Fault(403,'Tidak boleh mengelola pengguna dengan akses lebih tinggi');
}
