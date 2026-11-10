import {MailOutbox} from './mail-outbox.mjs';
import {makeBackup} from './tenants.mjs';
import { randomUUID } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
import { catalog, systemApps } from '../modules/catalog.mjs';
export {roles,passwordHash,verify,text} from './security.mjs';
import {roles,text,verify} from './security.mjs';
import {passwordHash} from './security.mjs';
import {inspectPackage,newer} from './packages.mjs';
import {access,canAssign,effectivePermissions,permissionCatalog,roleExists,manageTarget} from './access.mjs';
import {systemContract} from './contracts.mjs';
import {listRecords,mutateRecord,hasRecords,validateExisting} from './records.mjs';
import {modelContract} from './module-contract.mjs';
import {Mfa} from './mfa.mjs';
import {validateInput} from '../core/contracts.mjs';
import {identifier} from '../core/contracts.mjs';
import {publicUser,revokeUser,issueReset} from './identity.mjs';
export function registerSystem(kernel, store, {trustedKeys={},mfa=new Mfa(),outbox=new MailOutbox({store,cipher:mfa}),emailEnabled=false}={}) {
  const available=t=>[...catalog,...Object.values(t.modules).filter(item=>item.package).flatMap(item=>{try{return [inspectPackage(item.package,trustedKeys).manifest];}catch{return [];}})];
  const reserved=new Set([...catalog,...systemApps].map(app=>app.id).concat(['constructor','prototype']));
  const handlers={},operations={};
  const approvalServices=new Set(['apps.change','menus.save','settings.save','records.create','records.update','records.delete']);
  const descriptors=new Map(systemContract().services.map(service=>[service.name,service]));
  const register=(name,handler)=>{
    operations[name]=handler;
    const descriptor=descriptors.get(name);
    if(!descriptor)throw Error('Missing service contract: '+name);
    handlers[name]=(ctx,input)=>store.transact(async(state,tx={})=>{
      const tenant=state.tenants[ctx.tenant],actor=tenant?.users.find(u=>u.id===ctx.user && u.active!==false);
      if(!tenant || (tenant.status||'active')!=='active' || !actor || ctx.authVersion!==undefined && ctx.authVersion!==(actor.authVersion||1))throw new Fault(401,'Sesi tidak valid');
      access(tenant,actor,descriptor.permission);
      const result=await handler(tenant,input,ctx,tx,actor);
      if(descriptor.mutation)tenant.audit.push({at:new Date().toISOString(),user:actor.id,action:name,details:{target:input.id || input.module || input.bundle?.manifest?.id || actor.id}});
      return result;
    },ctx.tenant);
  };
  register('launcher.read',(t,_i,_ctx,_tx,actor)=>[
    ...available(t).filter(a=>t.modules[a.id]?.enabled && effectivePermissions(t,actor)[a.id+'.open']).map(({content,model,...app})=>app),
    ...systemApps.filter(a=>effectivePermissions(t,actor)[a.permission])
  ].map((app,index)=>({...app,...t.menus[app.id],order:t.menus[app.id]?.order??index})).filter(app=>!app.hidden).sort((a,b)=>a.order-b.order));
  register('apps.list',t=>[...catalog,...Object.entries(t.modules).filter(([,item])=>item.package).map(([id,item])=>({id,...item.package.manifest}))].map(({content,...a})=>({...a,version:t.modules[a.id]?.version || '0.1.0',installed:Boolean(t.modules[a.id]),enabled:Boolean(t.modules[a.id]?.enabled),packaged:Boolean(t.modules[a.id]?.package),canRollback:Boolean(t.modules[a.id]?.history?.length)})));
  register('apps.open',(t,i,_ctx,_tx,actor)=>{
    access(t,actor,i.id+'.open');
    if(!t.modules[i.id]?.enabled)throw new Fault(404,'Aplikasi tidak aktif');
    const app=available(t).find(a=>a.id===i.id);if(!app)throw new Fault(404,'Aplikasi tidak ditemukan');return {...app,recordAccess:Object.fromEntries(['read','create','update','delete'].map(action=>[action,effectivePermissions(t,actor)[i.id+'.records.'+action]||null]))};
  });
  register('packages.inspect',(_t,i)=>inspectPackage(i.bundle,trustedKeys));
  register('packages.install',async(t,i,ctx,tx)=>{
    if(i.approved!==true)throw new Fault(400,'Persetujuan administrator diperlukan');
    const {manifest}=inspectPackage(i.bundle,trustedKeys);
    if(reserved.has(manifest.id))throw new Fault(409,'ID aplikasi dilindungi');
    for(const [id,version] of Object.entries(manifest.dependencies||{}))if(!t.modules[id]?.enabled || t.modules[id].version!==version)throw new Fault(409,'Dependensi aktif dengan versi tepat diperlukan');
    if(Object.entries(t.modules).some(([id,item])=>id!==manifest.id && item.enabled && item.package?.manifest?.dependencies?.[manifest.id] && item.package.manifest.dependencies[manifest.id]!==manifest.version))throw new Fault(409,'Versi masih diperlukan aplikasi aktif');
    const previous=t.modules[manifest.id];
    try{await validateExisting(t,ctx.tenant,manifest.id,manifest.model,tx);}catch(error){if(error.status)throw new Fault(409,'Model baru tidak kompatibel dengan data yang tersimpan');throw error;}
    if(previous?.package && previous.package.publisher!==i.bundle.publisher)throw new Fault(409,'Penerbit update harus sama');
    if(previous && (!previous.package || !newer(manifest.version,previous.version)))throw new Fault(409,'Versi update harus lebih baru');
    t.modules[manifest.id]={version:manifest.version,enabled:previous?.enabled??true,package:i.bundle,history:previous?[...(previous.history||[]),previous.package].slice(-5):[]};
    return {id:manifest.id,version:manifest.version};
  });
  register('packages.rollback',async(t,i,ctx,tx)=>{
    if(i.approved!==true)throw new Fault(400,'Konfirmasi rollback diperlukan');
    const installed=t.modules[i.id],previous=installed?.history?.at(-1);
    if(!previous)throw new Fault(409,'Tidak ada versi sebelumnya');
    const {manifest}=inspectPackage(previous,trustedKeys);
    for(const [id,version] of Object.entries(manifest.dependencies||{}))if(!t.modules[id]?.enabled || t.modules[id].version!==version)throw new Fault(409,'Dependensi rollback tidak terpenuhi');
    try{await validateExisting(t,ctx.tenant,i.id,manifest.model,tx);}catch(error){if(error.status)throw new Fault(409,'Versi sebelumnya tidak kompatibel dengan data');throw error;}
    if(Object.entries(t.modules).some(([id,item])=>id!==i.id && item.enabled && item.package?.manifest?.dependencies?.[i.id] && item.package.manifest.dependencies[i.id]!==manifest.version))throw new Fault(409,'Versi masih diperlukan aplikasi aktif');
    if(manifest.id!==i.id)throw new Fault(400,'Identitas paket tidak sesuai');
    t.modules[i.id]={...installed,version:manifest.version,package:previous,history:installed.history.slice(0,-1)};return {id:i.id,version:manifest.version};
  });
  register('apps.change', async(t,i,ctx,tx,actor) => {
    access(t,actor,'apps.'+i.action);
    if(['disable','uninstall'].includes(i.action) && Object.entries(t.modules).some(([id,item])=>id!==i.id && item.enabled && Object.hasOwn(item.package?.manifest?.dependencies||{},i.id)))throw new Fault(409,'Modul masih diperlukan aplikasi aktif');
    if(i.action==='uninstall' && await hasRecords(t,ctx.tenant,i.id,tx))throw new Fault(409,'Modul memiliki data; nonaktifkan atau arsipkan terlebih dahulu');
    if (![...catalog.map(a=>a.id),...Object.keys(t.modules)].includes(i.id) || !['install','enable','disable','uninstall'].includes(i.action)) throw new Fault(400, 'Modul atau tindakan tidak valid');
    if (i.action === 'install') { if (i.approved !== true) throw new Fault(400, 'Persetujuan administrator diperlukan'); if (t.modules[i.id]) throw new Fault(409, 'Modul sudah terpasang'); t.modules[i.id] = { enabled: true, version: catalog.find(app=>app.id===i.id)?.version||'0.1.0' }; }
    else { if (!t.modules[i.id]) throw new Fault(409, 'Modul belum terpasang'); if (i.action === 'uninstall') { delete t.modules[i.id]; delete t.menus[i.id]; } else {if(i.action==='enable' && t.modules[i.id].package){const {manifest}=inspectPackage(t.modules[i.id].package,trustedKeys);for(const [id,version] of Object.entries(manifest.dependencies||{}))if(!t.modules[id]?.enabled || t.modules[id].version!==version)throw new Fault(409,'Dependensi tidak terpenuhi');}t.modules[i.id].enabled = i.action === 'enable';} }
    return { ok: true };
  });
  register('menus.list', t => [...available(t).filter(a => t.modules[a.id]), ...systemApps].map((a,index) => ({ ...a, order:index, ...t.menus[a.id] })));
  register('menus.save', (t,i) => {
    if (![...available(t).filter(a => t.modules[a.id]), ...systemApps].some(a => a.id === i.id) || !Number.isInteger(i.order) || i.order < 0 || i.order > 100 || typeof i.hidden !== 'boolean') throw new Fault(400, 'Menu tidak valid');
    t.menus[i.id] = { name: text(i.name), order:i.order, hidden:i.hidden }; return { ok:true };
  });
  register('users.list', t => t.users.map(publicUser));
  register('users.create', (t,i,_ctx,_tx,actor) => {
    canAssign(t,actor,i.role);
    const name = text(i.name), email = text(i.email, 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roleExists(t,i.role)) throw new Fault(400, 'Email atau peran tidak valid');
    if (t.users.some(u => u.email === email)) throw new Fault(409, 'Email sudah digunakan');
    const user = { id:randomUUID(), name,email,role:i.role,active:true,authVersion:1,hash:passwordHash(i.password) }; t.users.push(user); return publicUser(user);
  });
  register('users.update',(t,i,_ctx,_tx,actor)=>{
    const user=t.users.find(u=>u.id===i.id);if(!user)throw new Fault(404,'Pengguna tidak ditemukan');manageTarget(t,actor,user);
    if(user.role!==i.role)canAssign(t,actor,i.role);
    const name=text(i.name),email=text(i.email,160).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roleExists(t,i.role) || typeof i.active!=='boolean')throw new Fault(400,'Data pengguna tidak valid');
    if(t.users.some(u=>u.id!==user.id && u.email===email))throw new Fault(409,'Email sudah digunakan');
    if(user.role==='admin' && user.active!==false && (i.role!=='admin' || !i.active) && !t.users.some(u=>u.id!==user.id && u.role==='admin' && u.active!==false))throw new Fault(409,'Administrator aktif terakhir harus dipertahankan');
    if(user.role!==i.role || (user.active!==false)!==i.active || user.email!==email)revokeUser(t,user);
    Object.assign(user,{name,email,role:i.role,active:i.active});return publicUser(user);
  });
  register('users.reset',(t,i,ctx,_tx,actor)=>{
    if(i.approved!==true)throw new Fault(400,'Konfirmasi reset diperlukan');
    const user=t.users.find(u=>u.id===i.id && u.active!==false);if(!user)throw new Fault(404,'Pengguna aktif tidak ditemukan');
    manageTarget(t,actor,user);return issueReset(t,user,ctx.tenant);
  });
  register('account.change-password',(t,i,ctx)=>{
    const user=t.users.find(u=>u.id===ctx.user);
    if(!verify(i.currentPassword,user.hash))throw new Fault(400,'Kata sandi saat ini salah');
    user.hash=passwordHash(i.password);revokeUser(t,user);return {ok:true};
  });
  register('account.revoke-sessions',(t,i,ctx)=>{revokeUser(t,t.users.find(u=>u.id===ctx.user));return {ok:true};});
  register('backups.export',async(t,i,ctx,tx,actor)=>{
    if(!verify(i.currentPassword,actor.hash))throw new Fault(400,'Kata sandi saat ini salah');
    if(!mfa.verify(actor,ctx.tenant,i.code))throw new Fault(400,'Kode MFA atau recovery tidak valid');
    const snapshot=tx.client?await store.exportSnapshot(tx.client,ctx.tenant):structuredClone(t);
    // Keep factor state from this transaction, including a consumed recovery code.
    snapshot.users=structuredClone(t.users);
    return makeBackup(ctx.tenant,snapshot);
  });
  register('mail.status',t=>({...outbox.status(t),emailEnabled}));
  register('mail.retry',(t,i)=>outbox.retry(t,i.id));
  register('settings.list', t => ({ ...t.settings, audit:t.audit.slice(-20).reverse() }));
  register('settings.save', (t,i) => { t.settings = { name:text(i.name), locale:'id-ID' }; return t.settings; });

  register('roles.list',(t,_i,_ctx,_tx,actor)=>({roles:[{id:'admin',name:'Administrator',builtin:true,permissions:effectivePermissions(t,{role:'admin'})},{id:'member',name:'Anggota',builtin:true,permissions:effectivePermissions(t,{role:'member'})},...Object.entries(t.roles||{}).map(([id,role])=>({id,...role,builtin:false}))],permissions:permissionCatalog(t),canManage:Boolean(effectivePermissions(t,actor)['roles.manage'])}));
  register('roles.save',(t,i,_ctx,_tx,actor)=>{
    if(!identifier.test(i.id) || ['admin','member','constructor','prototype'].includes(i.id) || !i.permissions || typeof i.permissions!=='object' || Array.isArray(i.permissions))throw new Fault(400,'Peran tidak valid');
    const catalog=permissionCatalog(t),own=effectivePermissions(t,actor);
    for(const [id,scope] of Object.entries(i.permissions)){
      if(!catalog[id]?.includes(scope))throw new Fault(400,'Izin atau cakupan tidak dikenal');
      if(actor.role!=='admin' && (!own[id] || scope==='all' && own[id]!=='all'))throw new Fault(403,'Tidak boleh memberikan izin melebihi akses sendiri');
    }
    t.roles||={};t.roles[i.id]={name:text(i.name),permissions:i.permissions};
    for(const user of t.users.filter(user=>user.role===i.id))revokeUser(t,user);
    return {ok:true};
  });
  register('roles.delete',(t,i)=>{if(!Object.hasOwn(t.roles||{},i.id))throw new Fault(404,'Peran tidak ditemukan');if(t.users.some(user=>user.role===i.id))throw new Fault(409,'Peran masih digunakan');delete t.roles[i.id];return {ok:true};});
  register('contracts.list',t=>[...kernel.describe(),...available(t).filter(app=>app.model).map(modelContract)]);
  for(const operation of ['list','create','update','delete'])register('records.'+operation,async(t,i,ctx,tx,actor)=>{
    const installed=t.modules[i.module];if(!installed?.enabled || !installed.package)throw new Fault(404,'Modul data tidak aktif');
    const {manifest}=inspectPackage(installed.package,trustedKeys);if(!manifest.model)throw new Fault(400,'Modul tidak mendeklarasikan model');
    access(t,actor,i.module+'.open');
    return operation==='list'?listRecords(t,ctx.tenant,i.module,actor,i,tx):mutateRecord(t,ctx.tenant,i.module,actor,i,operation,manifest.model,tx);
  });
  register('account.mfa-status',(t,_i,_ctx,_tx,actor)=>({configured:Boolean(mfa.key),enabled:Boolean(actor.security?.mfa),recoveryCodesRemaining:actor.security?.mfa?.recoveryHashes?.length||0}));
  register('account.mfa-begin',(_t,i,ctx,_tx,actor)=>{if(!verify(i.currentPassword,actor.hash))throw new Fault(400,'Kata sandi saat ini salah');return mfa.begin(actor,ctx.tenant);});
  register('account.mfa-confirm',(t,i,ctx,_tx,actor)=>{const result=mfa.confirm(actor,ctx.tenant,i.code);revokeUser(t,actor);return result;});
  register('account.mfa-disable',(t,i,ctx,_tx,actor)=>{if(!verify(i.currentPassword,actor.hash)||!mfa.verify(actor,ctx.tenant,i.code))throw new Fault(400,'Kata sandi atau MFA tidak valid');delete actor.security?.mfa;delete actor.security?.pending;revokeUser(t,actor);return {ok:true};});
  register('approvals.list',t=>Object.entries(t.approvals||{}).filter(([,request])=>request.expires>Date.now() && ['pending','approved'].includes(request.status)).map(([id,request])=>({id,...request})));
  register('approvals.request',(t,i,_ctx,_tx,actor)=>{
    if(!approvalServices.has(i.service))throw new Fault(403,'Layanan ini tidak tersedia melalui persetujuan AI');
    const descriptor=descriptors.get(i.service),input={...i.input};
    if(descriptor.confirmation || i.service==='apps.change')input.approved=true;
    validateInput(input,descriptor.input);access(t,actor,descriptor.permission);
    if(i.service==='apps.change')access(t,actor,'apps.'+input.action);
    if(i.service.startsWith('records.')){access(t,actor,input.module+'.open');access(t,actor,input.module+'.records.'+i.service.split('.')[1]);}
    t.approvals||={};for(const [id,request] of Object.entries(t.approvals))if(request.expires<=Date.now() || ['used','rejected'].includes(request.status))delete t.approvals[id];
    if(Object.values(t.approvals).filter(request=>request.user===actor.id).length>=20)throw new Fault(429,'Terlalu banyak permintaan persetujuan');
    const id=randomUUID();t.approvals[id]={user:actor.id,authVersion:actor.authVersion||1,service:i.service,input,status:'pending',expires:Date.now()+5*60000,approver:null};
    return {approvalId:id,status:'pending',expires:new Date(t.approvals[id].expires).toISOString()};
  });
  register('approvals.decide',(t,i,_ctx,_tx,actor)=>{const request=t.approvals?.[i.id];if(!request || request.expires<=Date.now() || !['pending','approved'].includes(request.status))throw new Fault(409,'Permintaan tidak berlaku');request.status=i.approved?'approved':'rejected';request.approver=actor.id;return {ok:true};});
  register('approvals.execute',async(t,i,ctx,tx,actor)=>{
    const request=t.approvals?.[i.id];if(!request || !approvalServices.has(request.service) || request.user!==actor.id || request.authVersion!==(actor.authVersion||1) || request.status!=='approved' || request.expires<=Date.now())throw new Fault(403,'Persetujuan belum ada, habis, atau sudah digunakan');
    const approver=t.users.find(user=>user.id===request.approver&&user.active!==false);if(!approver||!effectivePermissions(t,approver)['approvals.approve'])throw new Fault(403,'Hak approver telah dicabut');
    const descriptor=descriptors.get(request.service);access(t,actor,descriptor.permission);validateInput(request.input,descriptor.input);
    const result=await operations[request.service](t,request.input,ctx,tx,actor);request.status='used';
    t.audit.push({at:new Date().toISOString(),user:actor.id,action:request.service,details:{approval:i.id,approver:request.approver,target:request.input.id||request.input.module||actor.id}});return result;
  });
  kernel.install(systemContract(),handlers);
}
