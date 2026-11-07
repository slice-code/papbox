import { randomUUID } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
import { catalog, systemApps } from '../modules/catalog.mjs';
export {roles,passwordHash,verify,text} from './security.mjs';
import {roles,text,verify} from './security.mjs';
import {passwordHash} from './security.mjs';
import {inspectPackage,newer} from './packages.mjs';
import {publicUser,revokeUser,issueReset} from './identity.mjs';
export function registerSystem(kernel, store, {trustedKeys={}}={}) {
  const available=t=>[...catalog,...Object.values(t.modules).filter(item=>item.package).flatMap(item=>{try{return [inspectPackage(item.package,trustedKeys).manifest];}catch{return [];}})];
  const reserved=new Set([...catalog,...systemApps].map(app=>app.id).concat(['constructor','prototype']));
  const register = (name, permission, handler) => kernel.register(name, permission, (ctx, input) => store.transact(state => {
    const tenant = state.tenants[ctx.tenant];
    const actor=tenant?.users.find(u=>u.id===ctx.user && u.active!==false);
    if (!actor || ctx.authVersion!==undefined && ctx.authVersion!==(actor.authVersion||1)) throw new Fault(401, 'Sesi tidak valid');
    if (!roles[actor.role]?.includes(permission)) throw new Fault(403,'Akses ditolak');
    const result = handler(tenant, input, ctx);
    if (!name.endsWith('.list') && name !== 'launcher.read') tenant.audit.push({ at: new Date().toISOString(), user: ctx.user, action: name, details: {target:typeof input.id==='string'?input.id:input.bundle?.manifest?.id || ctx.user} });
    return result;
  }, ctx.tenant));
  kernel.register('launcher.read', 'launcher.read', async ctx => {
    const state = await store.read(ctx.tenant); const t = state.tenants[ctx.tenant];
    const actor=t?.users.find(u=>u.id===ctx.user && u.active!==false);
    if (!actor || ctx.authVersion!==undefined && ctx.authVersion!==(actor.authVersion||1)) throw new Fault(401,'Sesi tidak valid');
    return [...available(t).filter(a => t.modules[a.id]?.enabled).map(({content,...app})=>app), ...systemApps.filter(a => roles[actor.role]?.includes(a.permission))]
      .map((a, index) => ({ ...a, ...t.menus[a.id], order: t.menus[a.id]?.order ?? index }))
      .filter(a => !a.hidden).sort((a,b) => a.order-b.order);
  });
  register('apps.list','apps.manage',t=>[...catalog,...Object.entries(t.modules).filter(([,item])=>item.package).map(([id,item])=>({id,...item.package.manifest}))].map(({content,...a})=>({...a,version:t.modules[a.id]?.version || '0.1.0',installed:Boolean(t.modules[a.id]),enabled:Boolean(t.modules[a.id]?.enabled),packaged:Boolean(t.modules[a.id]?.package),canRollback:Boolean(t.modules[a.id]?.history?.length)})));
  register('apps.open','launcher.read',(t,i)=>{
    if(!t.modules[i.id]?.enabled)throw new Fault(404,'Aplikasi tidak aktif');
    const app=available(t).find(a=>a.id===i.id);if(!app)throw new Fault(404,'Aplikasi tidak ditemukan');return app;
  });
  register('packages.inspect','apps.manage',(_t,i)=>inspectPackage(i.bundle,trustedKeys));
  register('packages.install','apps.manage',(t,i)=>{
    if(i.approved!==true)throw new Fault(400,'Persetujuan administrator diperlukan');
    const {manifest}=inspectPackage(i.bundle,trustedKeys);
    if(reserved.has(manifest.id))throw new Fault(409,'ID aplikasi dilindungi');
    const previous=t.modules[manifest.id];
    if(previous?.package && previous.package.publisher!==i.bundle.publisher)throw new Fault(409,'Penerbit update harus sama');
    if(previous && (!previous.package || !newer(manifest.version,previous.version)))throw new Fault(409,'Versi update harus lebih baru');
    t.modules[manifest.id]={version:manifest.version,enabled:previous?.enabled??true,package:i.bundle,history:previous?[...(previous.history||[]),previous.package].slice(-5):[]};
    return {id:manifest.id,version:manifest.version};
  });
  register('packages.rollback','apps.manage',(t,i)=>{
    if(i.approved!==true)throw new Fault(400,'Konfirmasi rollback diperlukan');
    const installed=t.modules[i.id],previous=installed?.history?.at(-1);
    if(!previous)throw new Fault(409,'Tidak ada versi sebelumnya');
    const {manifest}=inspectPackage(previous,trustedKeys);
    if(manifest.id!==i.id)throw new Fault(400,'Identitas paket tidak sesuai');
    t.modules[i.id]={...installed,version:manifest.version,package:previous,history:installed.history.slice(0,-1)};return {id:i.id,version:manifest.version};
  });
  register('apps.change', 'apps.manage', (t, i) => {
    if (![...catalog.map(a=>a.id),...Object.keys(t.modules)].includes(i.id) || !['install','enable','disable','uninstall'].includes(i.action)) throw new Fault(400, 'Modul atau tindakan tidak valid');
    if (i.action === 'install') { if (i.approved !== true) throw new Fault(400, 'Persetujuan administrator diperlukan'); if (t.modules[i.id]) throw new Fault(409, 'Modul sudah terpasang'); t.modules[i.id] = { enabled: true, version: '0.1.0' }; }
    else { if (!t.modules[i.id]) throw new Fault(409, 'Modul belum terpasang'); if (i.action === 'uninstall') { delete t.modules[i.id]; delete t.menus[i.id]; } else {if(i.action==='enable' && t.modules[i.id].package)inspectPackage(t.modules[i.id].package,trustedKeys);t.modules[i.id].enabled = i.action === 'enable';} }
    return { ok: true };
  });
  register('menus.list', 'menus.manage', t => [...available(t).filter(a => t.modules[a.id]), ...systemApps].map((a,index) => ({ ...a, order:index, ...t.menus[a.id] })));
  register('menus.save', 'menus.manage', (t,i) => {
    if (![...available(t).filter(a => t.modules[a.id]), ...systemApps].some(a => a.id === i.id) || !Number.isInteger(i.order) || i.order < 0 || i.order > 100 || typeof i.hidden !== 'boolean') throw new Fault(400, 'Menu tidak valid');
    t.menus[i.id] = { name: text(i.name), order:i.order, hidden:i.hidden }; return { ok:true };
  });
  register('users.list', 'users.manage', t => t.users.map(publicUser));
  register('users.create', 'users.manage', (t,i) => {
    const name = text(i.name), email = text(i.email, 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Object.hasOwn(roles,i.role)) throw new Fault(400, 'Email atau peran tidak valid');
    if (t.users.some(u => u.email === email)) throw new Fault(409, 'Email sudah digunakan');
    const user = { id:randomUUID(), name,email,role:i.role,active:true,authVersion:1,hash:passwordHash(i.password) }; t.users.push(user); return publicUser(user);
  });
  register('users.update','users.manage',(t,i)=>{
    const user=t.users.find(u=>u.id===i.id);if(!user)throw new Fault(404,'Pengguna tidak ditemukan');
    const name=text(i.name),email=text(i.email,160).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Object.hasOwn(roles,i.role) || typeof i.active!=='boolean')throw new Fault(400,'Data pengguna tidak valid');
    if(t.users.some(u=>u.id!==user.id && u.email===email))throw new Fault(409,'Email sudah digunakan');
    if(user.role==='admin' && user.active!==false && (i.role!=='admin' || !i.active) && !t.users.some(u=>u.id!==user.id && u.role==='admin' && u.active!==false))throw new Fault(409,'Administrator aktif terakhir harus dipertahankan');
    if(user.role!==i.role || (user.active!==false)!==i.active || user.email!==email)revokeUser(t,user);
    Object.assign(user,{name,email,role:i.role,active:i.active});return publicUser(user);
  });
  register('users.reset','users.manage',(t,i,ctx)=>{
    if(i.approved!==true)throw new Fault(400,'Konfirmasi reset diperlukan');
    const user=t.users.find(u=>u.id===i.id && u.active!==false);if(!user)throw new Fault(404,'Pengguna aktif tidak ditemukan');
    return issueReset(t,user,ctx.tenant);
  });
  register('account.change-password','launcher.read',(t,i,ctx)=>{
    const user=t.users.find(u=>u.id===ctx.user);
    if(!verify(i.currentPassword,user.hash))throw new Fault(400,'Kata sandi saat ini salah');
    user.hash=passwordHash(i.password);revokeUser(t,user);return {ok:true};
  });
  register('account.revoke-sessions','launcher.read',(t,i,ctx)=>{revokeUser(t,t.users.find(u=>u.id===ctx.user));return {ok:true};});
  register('settings.list', 'settings.manage', t => ({ ...t.settings, audit:t.audit.slice(-20).reverse() }));
  register('settings.save', 'settings.manage', (t,i) => { t.settings = { name:text(i.name), locale:'id-ID' }; return t.settings; });
}
