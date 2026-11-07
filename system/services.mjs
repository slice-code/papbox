import { randomUUID, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
import { catalog, systemApps } from '../modules/catalog.mjs';
export const roles = { admin: ['launcher.read','apps.manage','menus.manage','users.manage','settings.manage'], member: ['launcher.read'] };
export function text(value, max = 80) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Fault(400, 'Isian tidak valid'); return value.trim(); }
export function passwordHash(password) { if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Fault(400, 'Kata sandi harus 12–256 karakter'); const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
export function verify(password, hash) { if (typeof password !== 'string' || password.length > 256) return false; const [salt, key] = hash.split(':'); return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex')); }
export function registerSystem(kernel, store) {
  const register = (name, permission, handler) => kernel.register(name, permission, (ctx, input) => store.transact(state => {
    const tenant = state.tenants[ctx.tenant];
    if (!tenant || !tenant.users.some(u => u.id === ctx.user)) throw new Fault(401, 'Sesi tidak valid');
    const result = handler(tenant, input, ctx);
    if (!name.endsWith('.list') && name !== 'launcher.read') tenant.audit.push({ at: new Date().toISOString(), user: ctx.user, action: name });
    return result;
  }, ctx.tenant));
  kernel.register('launcher.read', 'launcher.read', async ctx => {
    const state = await store.read(ctx.tenant); const t = state.tenants[ctx.tenant];
    if (!t) throw new Fault(401, 'Sesi tidak valid');
    return [...catalog.filter(a => t.modules[a.id]?.enabled), ...systemApps.filter(a => ctx.permissions.includes(a.permission))]
      .map((a, index) => ({ ...a, ...t.menus[a.id], order: t.menus[a.id]?.order ?? index }))
      .filter(a => !a.hidden).sort((a,b) => a.order-b.order);
  });
  register('apps.list', 'apps.manage', t => catalog.map(a => ({ ...a, installed: Boolean(t.modules[a.id]), enabled: Boolean(t.modules[a.id]?.enabled) })));
  register('apps.change', 'apps.manage', (t, i) => {
    if (!catalog.some(a => a.id === i.id) || !['install','enable','disable','uninstall'].includes(i.action)) throw new Fault(400, 'Modul atau tindakan tidak valid');
    if (i.action === 'install') { if (i.approved !== true) throw new Fault(400, 'Persetujuan administrator diperlukan'); if (t.modules[i.id]) throw new Fault(409, 'Modul sudah terpasang'); t.modules[i.id] = { enabled: true, version: '0.1.0' }; }
    else { if (!t.modules[i.id]) throw new Fault(409, 'Modul belum terpasang'); if (i.action === 'uninstall') { delete t.modules[i.id]; delete t.menus[i.id]; } else t.modules[i.id].enabled = i.action === 'enable'; }
    return { ok: true };
  });
  register('menus.list', 'menus.manage', t => [...catalog.filter(a => t.modules[a.id]), ...systemApps].map((a,index) => ({ ...a, order:index, ...t.menus[a.id] })));
  register('menus.save', 'menus.manage', (t,i) => {
    if (![...catalog.filter(a => t.modules[a.id]), ...systemApps].some(a => a.id === i.id) || !Number.isInteger(i.order) || i.order < 0 || i.order > 100 || typeof i.hidden !== 'boolean') throw new Fault(400, 'Menu tidak valid');
    t.menus[i.id] = { name: text(i.name), order:i.order, hidden:i.hidden }; return { ok:true };
  });
  register('users.list', 'users.manage', t => t.users.map(({ hash, ...u }) => u));
  register('users.create', 'users.manage', (t,i) => {
    const name = text(i.name), email = text(i.email, 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Object.hasOwn(roles,i.role)) throw new Fault(400, 'Email atau peran tidak valid');
    if (t.users.some(u => u.email === email)) throw new Fault(409, 'Email sudah digunakan');
    const user = { id:randomUUID(), name,email,role:i.role,hash:passwordHash(i.password) }; t.users.push(user); return { id:user.id,name,email,role:user.role };
  });
  register('settings.list', 'settings.manage', t => ({ ...t.settings, audit:t.audit.slice(-20).reverse() }));
  register('settings.save', 'settings.manage', (t,i) => { t.settings = { name:text(i.name), locale:'id-ID' }; return t.settings; });
}
