import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
import { passwordHash, text, verify } from './security.mjs';
export const tenantPattern = /^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,62}$/;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const audit = (tenant, user, action) => tenant.audit.push({ at:new Date().toISOString(),user,action });
export const publicUser = ({id,name,email,role,active=true}) => ({id,name,email,role,active});
export function parseToken(value) {
  if(typeof value!=='string') return null;
  const [tenant,token,...rest]=value.split('.');
  return !rest.length && tenantPattern.test(tenant) && /^[a-f0-9]{64}$/.test(token || '') ? {tenant,hash:digest(token)} : null;
}
export async function provisionTenant(store, input) {
  if(typeof input.tenant!=='string' || !tenantPattern.test(input.tenant) || ['__proto__','constructor','prototype'].includes(input.tenant)) throw new Fault(400,'ID tenant tidak valid');
  const name=text(input.name),email=text(input.email,160).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Fault(400,'Email tidak valid');
  const user={id:randomUUID(),name:text(input.adminName),email,role:'admin',active:true,authVersion:1,hash:passwordHash(input.password)};
  return store.transact(state=>{
    if(Object.hasOwn(state.tenants,input.tenant)) throw new Fault(409,'Tenant sudah ada');
    const tenant={users:[user],settings:{name,locale:'id-ID'},modules:{},menus:{},audit:[],sessions:{},passwordResets:{}};
    audit(tenant,user.id,'tenant.created');state.tenants[input.tenant]=tenant;
    return {tenant:input.tenant,user:publicUser(user)};
  },input.tenant);
}
export class Identity {
  constructor(store,{now=()=>Date.now()}={}){this.store=store;this.now=now;}
  async resolve(value){
    const parsed=parseToken(value);if(!parsed)return null;
    const state=await this.store.read(parsed.tenant),tenant=state.tenants[parsed.tenant];
    const session=tenant?.sessions?.[parsed.hash];
    const user=session && tenant.users.find(u=>u.id===session.user);
    if(!user || user.active===false || session.expires<=this.now() || session.authVersion!==(user.authVersion || 1))return null;
    return {tenant:parsed.tenant,user,session,hash:parsed.hash,state};
  }
  async login(tenantId,email,password){
    if(typeof tenantId!=='string' || !tenantPattern.test(tenantId))throw new Fault(400,'ID tenant tidak valid');
    // Verify and issue under the same tenant transaction as account changes.
    const token=randomBytes(32).toString('hex');
    await this.store.transact(state=>{
      const tenant=state.tenants[tenantId];
      const user=tenant?.users.find(u=>u.email===String(email).toLowerCase());
      const valid=verify(password,user?.hash || '0'.repeat(32)+':'+ '0'.repeat(128));
      if(!user || user.active===false || !valid)throw new Fault(401,'Email atau kata sandi salah');
      tenant.sessions ||= {};
      for(const [hash,s] of Object.entries(tenant.sessions))if(s.expires<=this.now() || s.user===user.id && s.authVersion!==(user.authVersion||1))delete tenant.sessions[hash];
      const existing=Object.entries(tenant.sessions).filter(([,s])=>s.user===user.id).sort((a,b)=>a[1].expires-b[1].expires);
      while(existing.length>=10)delete tenant.sessions[existing.shift()[0]];
      tenant.sessions[digest(token)]={user:user.id,authVersion:user.authVersion||1,expires:this.now()+8*60*60*1000};
      audit(tenant,user.id,'auth.login');
    },tenantId);
    return tenantId+'.'+token;
  }
  async logout(value){
    const parsed=parseToken(value);if(!parsed)return;
    await this.store.transact(state=>{
      const tenant=state.tenants[parsed.tenant];if(!tenant)return;
      const session=tenant.sessions?.[parsed.hash];if(session){delete tenant.sessions[parsed.hash];audit(tenant,session.user,'auth.logout');}
    },parsed.tenant);
  }
  async reset(value,password){
    const parsed=parseToken(value);if(!parsed)throw new Fault(400,'Token reset tidak valid atau kedaluwarsa');
    const hash=passwordHash(password);
    return this.store.transact(state=>{
      const tenant=state.tenants[parsed.tenant],reset=tenant?.passwordResets?.[parsed.hash];
      const user=reset && tenant.users.find(u=>u.id===reset.user && u.active!==false);
      if(!user || reset.expires<=this.now() || reset.authVersion!==(user.authVersion||1))throw new Fault(400,'Token reset tidak valid atau kedaluwarsa');
      user.hash=hash;revokeUser(tenant,user);audit(tenant,user.id,'auth.password-reset');return {ok:true};
    },parsed.tenant);
  }
}
export function revokeUser(tenant,user){
  user.authVersion=(user.authVersion||1)+1;
  for(const property of ['sessions','passwordResets'])for(const [hash,item] of Object.entries(tenant[property]||{}))if(item.user===user.id)delete tenant[property][hash];
}
export function issueReset(tenant,user,tenantId,now=Date.now()){
  for(const [hash,item] of Object.entries(tenant.passwordResets||{}))if(item.user===user.id || item.expires<=now)delete tenant.passwordResets[hash];
  const token=randomBytes(32).toString('hex');tenant.passwordResets ||= {};
  tenant.passwordResets[digest(token)]={user:user.id,authVersion:user.authVersion||1,expires:now+15*60*1000};
  return {token:tenantId+'.'+token,expires:new Date(now+15*60*1000).toISOString()};
}
