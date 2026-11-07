import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Kernel, Fault } from './core/kernel.mjs';
import { Store } from './core/store.mjs';
import { registerSystem, passwordHash, verify, roles, text } from './system/services.mjs';
export function createApp({ store: providedStore, path = process.env.PAPBOX_DATA || fileURLToPath(new URL('./storage/data.json', import.meta.url)), secure = process.env.NODE_ENV === 'production' } = {}) {
  const store = providedStore || new Store(path), kernel = new Kernel(), sessions = new Map(), attempts = new Map();
  registerSystem(kernel, store);
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
      if (req.method === 'POST') { let data=''; for await (const chunk of req) { data+=chunk; if (Buffer.byteLength(data)>16384) throw new Fault(413,'Permintaan terlalu besar'); } try { input=JSON.parse(data); } catch { throw new Fault(400,'JSON tidak valid'); } if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Fault(400,'Objek JSON diperlukan'); }
      const token = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('papbox='))?.slice(7);
      const session = sessions.get(token);
      if (session && session.expires < Date.now()) sessions.delete(token);
      const state = await store.read(session?.tenant || (typeof input.tenant === 'string' ? input.tenant : 'default'));
      if (req.method === 'GET' && url.pathname === '/api/session') {
        const user = session && session.expires > Date.now() && state.tenants[session.tenant]?.users.find(u=>u.id===session.user);
        return send(200,{ setup:!Object.keys(state.tenants).length, user:user ? { name:user.name,email:user.email,role:user.role,tenant:session.tenant } : null });
      }
      if (req.method === 'POST' && ['/api/setup','/api/login'].includes(url.pathname)) {
        const address=req.socket.remoteAddress, now=Date.now();
        const limit=attempts.get(address); if (limit && now-limit.start < 60000 && limit.count >= 10) throw new Fault(429,'Coba lagi dalam satu menit');
        if (!limit || now-limit.start >= 60000) attempts.set(address,{ start:now,count:1 }); else limit.count++;
        let tenant, user;
        if (url.pathname === '/api/setup') {
          if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)) throw new Fault(403,'Setup awal hanya dari localhost');
          tenant='default';
          user={ id:randomUUID(),name:text(input.name),email:text(input.email,160).toLowerCase(),role:'admin',hash:passwordHash(input.password) };
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) throw new Fault(400,'Email tidak valid');
          await store.transact(s=>{ if (Object.keys(s.tenants).length) throw new Fault(409,'Setup sudah selesai'); s.tenants[tenant]={ users:[user],modules:{},menus:{},settings:{name:'PAPbox',locale:'id-ID'},audit:[] }; });
        } else {
          tenant = typeof input.tenant === 'string' ? input.tenant : 'default';
          user=Object.hasOwn(state.tenants,tenant) && state.tenants[tenant].users.find(u=>u.email===String(input.email).toLowerCase());
          if (!user || !verify(input.password,user.hash)) throw new Fault(401,'Email atau kata sandi salah');
        }
        const id=randomBytes(32).toString('hex'); sessions.set(id,{ tenant,user:user.id,expires:now+8*60*60*1000 });
        return send(200,{ok:true},{'Set-Cookie':`papbox=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`});
      }
      if (!session || session.expires < Date.now()) throw new Fault(401,'Silakan masuk');
      const user=state.tenants[session.tenant]?.users.find(u=>u.id===session.user);
      if (!user) throw new Fault(401,'Sesi tidak valid');
      if (req.method === 'POST' && url.pathname === '/api/logout') { sessions.delete(token); return send(200,{ok:true},{'Set-Cookie':'papbox=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/services/')) throw new Fault(404,'Tidak ditemukan');
      const result=await kernel.invoke(url.pathname.slice('/api/services/'.length),{tenant:session.tenant,user:user.id,permissions:roles[user.role] || []},input);
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
  const {server}=createApp({store});
  server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log('PAPbox berjalan pada port '+server.address().port+' · '+(store ? 'PostgreSQL' : 'JSON development store')));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>server.close(async()=>{await store?.close();}));
}
