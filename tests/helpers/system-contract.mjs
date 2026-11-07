import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { Kernel } from '../../core/kernel.mjs';
import { registerSystem, roles } from '../../system/services.mjs';
import { Identity, provisionTenant } from '../../system/identity.mjs';
import { canonical } from '../../system/packages.mjs';
import { createApp } from '../../server.mjs';

export async function systemContract(store,{replicaStore=store}={}){
  const admin=await provisionTenant(store,{tenant:'secure',name:'Secure tenant',adminName:'Admin',email:'admin@example.com',password:'admin password 123'});
  await assert.rejects(provisionTenant(store,{tenant:'secure',name:'Other',adminName:'Admin',email:'admin@example.com',password:'admin password 123'}),{status:409});
  await provisionTenant(store,{tenant:'separate',name:'Separate',adminName:'Admin',email:'admin@example.com',password:'other password 123'});
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),trustedKeys={publisher:publicKey.export({type:'spki',format:'pem'}),other:publicKey.export({type:'spki',format:'pem'})};
  const kernel=new Kernel();registerSystem(kernel,store,{trustedKeys});const ctx={tenant:'secure',user:admin.user.id,permissions:roles.admin};
  const call=(name,input={})=>kernel.invoke(name,ctx,input);
  const user=await call('users.create',{name:'Member',email:'member@example.com',role:'member',password:'member password 123'});
  assert(!('hash' in user));assert(!('authVersion' in user));
  await assert.rejects(call('users.update',{id:admin.user.id,name:'Admin',email:'admin@example.com',role:'member',active:true}),{status:409});
  await assert.rejects(call('users.update',{id:admin.user.id,name:'Admin',email:'admin@example.com',role:'admin',active:false}),{status:409});
  const identity=new Identity(store),token=await identity.login('secure','member@example.com','member password 123');
  assert.equal((await identity.resolve(token)).user.id,user.id);
  assert(!JSON.stringify(await store.read('secure')).includes(token.split('.')[1]));
  assert.equal(await identity.resolve(token.replace('secure.','separate.')),null);
  const start=async(instanceStore=store)=>{const app=createApp({store:instanceStore,trustedKeys,authLimit:100});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');return app.server;};
  const stop=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  const a=await start(),b=await start(replicaStore);
  const request=async(server,cookie,route='session',data)=>{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{Cookie:'papbox='+cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  try{
    assert.equal((await request(a,token)).data.user.id,user.id);
    assert.equal((await request(b,token)).data.user.id,user.id);
    await call('users.update',{...user,active:false});
    assert.equal((await request(b,token,'services/launcher.read',{})).status,401);
    await assert.rejects(identity.login('secure','member@example.com','member password 123'),{status:401});
    await call('users.update',{...user,active:true});
    assert.equal(await identity.resolve(token),null);
    const freshToken=await identity.login('secure','member@example.com','member password 123');
    const reset=await call('users.reset',{id:user.id,approved:true});
    assert(!JSON.stringify(await store.read('secure')).includes(reset.token.split('.')[1]));
    await assert.rejects(new Identity(store,{now:()=>Date.now()+16*60000}).reset(reset.token,'new member password 123'),{status:400});
    await assert.rejects(identity.reset(reset.token.replace('secure.','separate.'),'new member password 123'),{status:400});
    const resets=await Promise.allSettled([identity.reset(reset.token,'new member password 123'),identity.reset(reset.token,'new member password 123')]);
    assert.equal(resets.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(await identity.resolve(freshToken),null);
    await assert.rejects(identity.login('secure','member@example.com','member password 123'),{status:401});
    const newToken=await identity.login('secure','member@example.com','new member password 123');
    assert.equal((await request(b,newToken)).data.user.id,user.id);
    const memberCtx={tenant:'secure',user:user.id,permissions:roles.member};
    await assert.rejects(kernel.invoke('users.reset',memberCtx,{id:admin.user.id,approved:true}),{status:403});
    await assert.rejects(kernel.invoke('account.change-password',memberCtx,{currentPassword:'wrong password 123',password:'latest member password'}),{status:400});
    await kernel.invoke('account.change-password',memberCtx,{currentPassword:'new member password 123',password:'latest member password'});
    assert.equal(await identity.resolve(newToken),null);
    const revoke=await identity.login('secure','member@example.com','latest member password');await kernel.invoke('account.revoke-sessions',memberCtx,{});assert.equal(await identity.resolve(revoke),null);
    const logout=await identity.login('secure','member@example.com','latest member password');
    assert.equal((await request(a,logout,'logout',{})).status,200);assert.equal((await request(b,logout)).data.user,null);
  }finally{await stop(a);await stop(b);}
  // Recreate the HTTP application; persistent sessions must still authenticate.
  const persistent=await identity.login('secure','member@example.com','latest member password');const c=await start(replicaStore);
  try{
    assert.equal((await request(c,persistent)).data.user.id,user.id);
    const switched=await request(c,persistent,'login',{tenant:'separate',email:'admin@example.com',password:'other password 123'});
    assert.equal(switched.status,200);
    const switchedToken=switched.cookie.split(';')[0].slice('papbox='.length);
    assert.equal((await identity.resolve(switchedToken)).tenant,'separate');
    assert.equal(await identity.resolve(persistent),null);
  }finally{await stop(c);}
  const expired=new Identity(store,{now:()=>Date.now()+9*3600000});assert.equal(await expired.resolve(persistent),null);
  const bundle=(version='1.0.0',change={},publisher='publisher')=>{const payload={format:'papbox.module/1',publisher,manifest:{id:'notes',version,api:1,name:'Catatan',icon:'N',color:'blue',description:'Catatan deklaratif',content:'Teks aman <script>alert(1)</script>',...change}};return {...payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};};
  const first=bundle();
  await assert.rejects(call('packages.install',{bundle:first}),{status:400});
  await assert.rejects(call('packages.install',{bundle:{...first,publisher:'unknown'},approved:true}),{status:403});
  await assert.rejects(call('packages.install',{bundle:{...first,manifest:{...first.manifest,content:'tampered'}},approved:true}),{status:400});
  await assert.rejects(call('packages.install',{bundle:bundle('1.0.0',{script:'evil.js'}),approved:true}),{status:400});
  await assert.rejects(call('packages.install',{bundle:bundle('1.0.0',{id:'users'}),approved:true}),{status:409});
  await call('packages.install',{bundle:first,approved:true});
  assert((await call('launcher.read')).some(app=>app.id==='notes'));
  assert.equal((await call('apps.open',{id:'notes'})).content,first.manifest.content);
  await call('packages.install',{bundle:bundle('2.0.0'),approved:true});
  await assert.rejects(call('packages.install',{bundle:bundle('3.0.0',{},'other'),approved:true}),{status:409});
  await assert.rejects(call('packages.install',{bundle:first,approved:true}),{status:409});
  await assert.rejects(call('packages.rollback',{id:'notes'}),{status:400});
  const tampered=bundle('3.0.0');tampered.signature=first.signature;
  await assert.rejects(call('packages.install',{bundle:tampered,approved:true}),{status:400});
  assert.equal((await store.read('secure')).tenants.secure.modules.notes.version,'2.0.0');
  await call('packages.rollback',{id:'notes',approved:true});assert.equal((await store.read('secure')).tenants.secure.modules.notes.version,'1.0.0');
  for(let version=2;version<=8;version++)await call('packages.install',{bundle:bundle(version+'.0.0'),approved:true});
  assert.equal((await store.read('secure')).tenants.secure.modules.notes.history.length,5);
  await call('apps.change',{id:'notes',action:'disable'});await assert.rejects(call('apps.open',{id:'notes'}),{status:404});
  await call('apps.change',{id:'notes',action:'enable'});
  const revoked=new Kernel();registerSystem(revoked,store,{trustedKeys:{}});
  assert(!(await revoked.invoke('launcher.read',ctx)).some(app=>app.id==='notes'));
  assert((await revoked.invoke('launcher.read',ctx)).some(app=>app.id==='account'));
  await assert.rejects(revoked.invoke('apps.open',ctx,{id:'notes'}),{status:404});
  await call('apps.change',{id:'notes',action:'uninstall'});assert(!(await call('launcher.read')).some(app=>app.id==='notes'));
  assert(!(await new Identity(store).resolve(persistent.replace('secure.','separate.'))));
  // Last-admin invariant must also hold when two admins demote themselves concurrently.
  const race=await provisionTenant(store,{tenant:'race',name:'Race',adminName:'One',email:'one@example.com',password:'admin one password'});
  const raceCtx={tenant:'race',user:race.user.id,permissions:roles.admin};
  const second=await kernel.invoke('users.create',raceCtx,{name:'Two',email:'two@example.com',role:'admin',password:'admin two password'});
  const results=await Promise.allSettled([kernel.invoke('users.update',raceCtx,{...race.user,role:'member'}),kernel.invoke('users.update',{...raceCtx,user:second.id},{...second,role:'member'})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
  assert.equal((await store.read('race')).tenants.race.users.filter(u=>u.role==='admin' && u.active!==false).length,1);
  if(store.allowAuth){const key='f'.repeat(64);assert.equal(await store.allowAuth(key,2),true);assert.equal(await store.allowAuth(key,2),true);assert.equal(await store.allowAuth(key,2),false);}
}
