import {randomUUID} from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Kernel, Fault } from './core/kernel.mjs';
import { Store } from './core/store.mjs';
import { registerSystem, roles } from './system/services.mjs';
import {configuredMail} from './adapters/google/mail.mjs';
import {audit,issueReset} from './system/identity.mjs';
import {Mfa} from './system/mfa.mjs';
import {modelContract} from './system/module-contract.mjs';
import {validateInput} from './core/contracts.mjs';
import {inspectPackage} from './system/packages.mjs';
import {effectivePermissions} from './system/access.mjs';
import { Identity, provisionTenant, tenantPattern, digest } from './system/identity.mjs';
export function createApp({ assetRoot=new URL('./public/',import.meta.url), mailer=null, mfa=new Mfa(), logger=()=>{}, authLimit=10, trustedKeys={}, store: providedStore, path = process.env.PAPBOX_DATA || fileURLToPath(new URL('./storage/data.json', import.meta.url)), secure = process.env.NODE_ENV === 'production' } = {}) {
  const store = providedStore || new Store(path), kernel = new Kernel(), identity = new Identity(store,{mfa}), attempts = new Map();
  registerSystem(kernel, store, {trustedKeys,mfa});
  const assets = { '/':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/offline.html':'offline.html','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png' };
  const server = createServer(async (req,res) => {
    const requestId=randomUUID(),started=performance.now();
    res.once('finish',()=>logger({event:'http.request',requestId,method:req.method,status:res.statusCode,durationMs:Math.round(performance.now()-started)}));
    const headers = { 'X-Request-Id':requestId,'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Cache-Control':'no-store' };
    const send = (status, data, extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type':'application/json; charset=utf-8', ...extra }); res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if(req.method==='GET' && url.pathname==='/healthz')return send(200,{status:'ok'});
      if(req.method==='GET' && url.pathname==='/readyz'){try{await (store.health?store.health():store.read('default'));return send(200,{status:'ready'});}catch{return send(503,{status:'unavailable'});}}
      if (req.method === 'GET' && Object.hasOwn(assets,url.pathname)) {
        const name = assets[url.pathname], types = { html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json' };
        return send(200,await readFile(new URL(name,assetRoot)), { 'Content-Type':types[name.split('.').pop()]+'; charset=utf-8' });
      }
      if (!url.pathname.startsWith('/api/')) throw new Fault(404,'Tidak ditemukan');
      if (req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `${secure ? 'https' : 'http'}://${req.headers.host}`) throw new Fault(403,'Origin ditolak');
        if (!req.headers['content-type']?.startsWith('application/json')) throw new Fault(415,'Gunakan JSON');
      }
      let input = {};
      if (req.method === 'POST') {
        const chunks=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>65536)throw new Fault(413,'Permintaan terlalu besar');chunks.push(chunk);}
        try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new Fault(400,'JSON tidak valid');}
        if(!input || typeof input!=='object' || Array.isArray(input))throw new Fault(400,'Objek JSON diperlukan');
      }
      const token = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('papbox='))?.slice(7);
      const resolved = await identity.resolve(token);
      const tenantId=resolved?.tenant || (typeof input.tenant==='string'?input.tenant:'default');
      if(!tenantPattern.test(tenantId))throw new Fault(400,'ID tenant tidak valid');
      const state=resolved?.state || await store.read(tenantId);
      if (req.method === 'GET' && url.pathname === '/api/session') {
        const user=resolved?.user;
        const setupState=tenantId==='default'?state:await store.read('default');
        const roleOptions=resolved?[{id:'admin',name:'Administrator'},{id:'member',name:'Anggota'},...Object.entries(resolved.state.tenants[resolved.tenant].roles||{}).map(([id,role])=>({id,name:role.name}))]:[];
        return send(200,{emailRecovery:Boolean(mailer),roles:roleOptions,setup:!Object.hasOwn(setupState.tenants,'default'),user:user?{id:user.id,name:user.name,email:user.email,role:user.role,tenant:resolved.tenant,permissions:effectivePermissions(resolved.state.tenants[resolved.tenant],user)}:null});
      }
      if (req.method === 'POST' && ['/api/setup','/api/login','/api/reset','/api/forgot'].includes(url.pathname)) {
        const address=req.socket.remoteAddress, now=Date.now();
        if(store.allowAuth){if(!await store.allowAuth(digest(address),authLimit))throw new Fault(429,'Coba lagi dalam satu menit');}
        else {
          for(const [key,item] of attempts)if(now-item.start>=60000)attempts.delete(key);
          const limit=attempts.get(address);if(limit && limit.count>=authLimit)throw new Fault(429,'Coba lagi dalam satu menit');
          if(!limit)attempts.set(address,{start:now,count:1});else limit.count++;
        }
        if(url.pathname==='/api/forgot'){
          if(!mailer)throw new Fault(503,'Pemulihan email belum dikonfigurasi operator');
          const recoveryTenant=typeof input.tenant==='string'?input.tenant:'default';
          if(!tenantPattern.test(recoveryTenant))throw new Fault(400,'ID tenant tidak valid');
          const existing=(await store.read(recoveryTenant)).tenants[recoveryTenant];
          const pending=existing?await store.transact(s=>{
            const tenant=s.tenants[recoveryTenant],user=tenant.users.find(user=>user.active!==false&&user.email===String(input.email).trim().toLowerCase());
            if(!user||(tenant.status||'active')!=='active')return null;
            const reset=issueReset(tenant,user,recoveryTenant);audit(tenant,user.id,'auth.email-reset-requested');return {to:user.email,token:reset.token};
          },recoveryTenant):null;
          // Delivery is best-effort and detached to keep account existence out of response timing.
          if(pending)void Promise.resolve().then(()=>mailer.sendReset(pending)).then(()=>logger({event:'mail.reset-delivered'}),()=>logger({event:'mail.reset-failed'}));
          return send(200,{ok:true,message:'Jika akun aktif, permintaan pemulihan diproses.'});
        }
        if(url.pathname==='/api/reset')return send(200,await identity.reset(input.token,input.password));
        let tenant=typeof input.tenant==='string'?input.tenant:'default';
        if(url.pathname==='/api/setup'){
          if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))throw new Fault(403,'Setup awal hanya dari localhost');
          tenant='default';
          await provisionTenant(store,{tenant,name:'PAPbox',adminName:input.name,email:input.email,password:input.password});
        }
        const id=await identity.login(tenant,input.email,input.password,input.code);
        // Remove a previous authenticated token when explicitly switching accounts.
        if(resolved)await identity.logout(token);
        return send(200,{ok:true},{'Set-Cookie':`papbox=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`});
      }
      if(!resolved)throw new Fault(401,'Silakan masuk');
      const user=resolved.user;
      if(req.method==='POST' && url.pathname==='/api/logout'){
        await identity.logout(token);
        return send(200,{ok:true},{'Set-Cookie':`papbox=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`});
      }
      const context={tenant:resolved.tenant,user:user.id,authVersion:resolved.session.authVersion,permissions:Object.keys(effectivePermissions(resolved.state.tenants[resolved.tenant],user))};
      let service=kernel.routes.get(req.method+' '+url.pathname);
      const moduleRoute=/^\/api\/modules\/([a-z][a-z0-9_-]*)\/(list|create|update|delete)$/.exec(url.pathname);
      if(req.method==='POST' && moduleRoute){
        const [,id,action]=moduleRoute,installed=resolved.state.tenants[resolved.tenant].modules[id];
        if(!installed?.enabled || !installed.package)throw new Fault(404,'Modul tidak aktif');
        const {manifest}=inspectPackage(installed.package,trustedKeys);if(!manifest.model)throw new Fault(404,'Model tidak tersedia');
        const contract=modelContract(manifest),descriptor=contract.services.find(s=>s.name===id+'.records.'+action);
        validateInput(input,descriptor.input);input={...input,module:id};service='records.'+action;
      }
      if(!service)throw new Fault(404,'Tidak ditemukan');
      if(service==='backups.export' && context.permissions.includes('backups.export')){
        const key='backup:'+resolved.tenant+':'+user.id,now=Date.now();
        if(store.allowAuth){if(!await store.allowAuth(digest(key),authLimit))throw new Fault(429,'Terlalu banyak percobaan backup; coba lagi dalam satu menit');}
        else{const previous=attempts.get(key);if(previous&&now-previous.start<60000){if(previous.count>=authLimit)throw new Fault(429,'Terlalu banyak percobaan backup; coba lagi dalam satu menit');previous.count++;}else attempts.set(key,{start:now,count:1});}
      }
      const result=await kernel.invoke(service,context,input);
      if(service==='backups.export')return send(200,result,{'Content-Disposition':`attachment; filename="papbox-${resolved.tenant}-${new Date().toISOString().replace(/[:.]/g,'-')}.json"`});
      send(200,result);
    } catch (error) { if(!error.status)logger({event:'http.error',requestId,code:typeof error.code==='string'?error.code:'INTERNAL'}); send(error.status || 500,{error:error.status ? error.message : 'Kesalahan server'}); }
  });
  server.requestTimeout=15000; server.headersTimeout=10000;
  return {server,store,kernel};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let store;
  if (process.env.DATABASE_URL) {
    const { createPool, PostgresStore } = await import('./adapters/postgres/store.mjs');
    store = new PostgresStore(createPool(process.env.DATABASE_URL));
    try { await store.initialize(); } catch (error) { await store.close(); throw error; }
  }
  const trustedKeys=process.env.PAPBOX_TRUSTED_KEYS ? JSON.parse(await readFile(process.env.PAPBOX_TRUSTED_KEYS,'utf8')) : {};
  const {server}=createApp({store,trustedKeys,mailer:configuredMail(),mfa:new Mfa(process.env.PAPBOX_ENCRYPTION_KEY),logger:entry=>console.log(JSON.stringify(entry))});
  server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log('PAPbox berjalan pada port '+server.address().port+' · '+(store ? 'PostgreSQL' : 'JSON development store')));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>server.close(async()=>{await store?.close();}));
}
