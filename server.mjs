import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Kernel, Fault } from './core/kernel.mjs';
import { Store } from './core/store.mjs';
import { registerSystem, roles } from './system/services.mjs';
import { Identity, provisionTenant, tenantPattern, digest } from './system/identity.mjs';
export function createApp({ authLimit=10, trustedKeys={}, store: providedStore, path = process.env.PAPBOX_DATA || fileURLToPath(new URL('./storage/data.json', import.meta.url)), secure = process.env.NODE_ENV === 'production' } = {}) {
  const store = providedStore || new Store(path), kernel = new Kernel(), identity = new Identity(store), attempts = new Map();
  registerSystem(kernel, store, {trustedKeys});
  const assets = { '/':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/offline.html':'offline.html','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png' };
  const server = createServer(async (req,res) => {
    const headers = { 'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Cache-Control':'no-store' };
    const send = (status, data, extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type':'application/json; charset=utf-8', ...extra }); res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && Object.hasOwn(assets,url.pathname)) {
        const name = assets[url.pathname], types = { html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json' };
        return send(200,await readFile(new URL('./public/'+name,import.meta.url)), { 'Content-Type':types[name.split('.').pop()]+'; charset=utf-8' });
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
        return send(200,{setup:!Object.hasOwn(setupState.tenants,'default'),user:user?{id:user.id,name:user.name,email:user.email,role:user.role,tenant:resolved.tenant}:null});
      }
      if (req.method === 'POST' && ['/api/setup','/api/login','/api/reset'].includes(url.pathname)) {
        const address=req.socket.remoteAddress, now=Date.now();
        if(store.allowAuth){if(!await store.allowAuth(digest(address),authLimit))throw new Fault(429,'Coba lagi dalam satu menit');}
        else {
          for(const [key,item] of attempts)if(now-item.start>=60000)attempts.delete(key);
          const limit=attempts.get(address);if(limit && limit.count>=authLimit)throw new Fault(429,'Coba lagi dalam satu menit');
          if(!limit)attempts.set(address,{start:now,count:1});else limit.count++;
        }
        if(url.pathname==='/api/reset')return send(200,await identity.reset(input.token,input.password));
        let tenant=typeof input.tenant==='string'?input.tenant:'default';
        if(url.pathname==='/api/setup'){
          if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))throw new Fault(403,'Setup awal hanya dari localhost');
          tenant='default';
          await provisionTenant(store,{tenant,name:'PAPbox',adminName:input.name,email:input.email,password:input.password});
        }
        const id=await identity.login(tenant,input.email,input.password);
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
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/services/')) throw new Fault(404,'Tidak ditemukan');
      const result=await kernel.invoke(url.pathname.slice('/api/services/'.length),{tenant:resolved.tenant,user:user.id,authVersion:resolved.session.authVersion,permissions:roles[user.role] || []},input);
      send(200,result);
    } catch (error) { if (!error.status) console.error(error); send(error.status || 500,{error:error.status ? error.message : 'Kesalahan server'}); }
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
  const {server}=createApp({store,trustedKeys});
  server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log('PAPbox berjalan pada port '+server.address().port+' · '+(store ? 'PostgreSQL' : 'JSON development store')));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>server.close(async()=>{await store?.close();}));
}
