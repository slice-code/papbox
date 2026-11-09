import {randomUUID} from 'node:crypto';
import {Fault} from '../core/kernel.mjs';
import {parseToken} from './identity.mjs';
const terminal=new Set(['sent','cancelled','dead']);
export class MailOutbox {
 constructor({store,cipher,now=()=>Date.now(),maxAttempts=5,backoffMs=30000,leaseMs=60000,logger=()=>{}}){
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||backoffMs<1||leaseMs<1000)throw Error('Invalid mail worker policy');
  Object.assign(this,{store,cipher,now,maxAttempts,backoffMs,leaseMs,logger});
 }
 enqueue(tenant,tenantId,user,token){
  this.cipher.requireKey();const parsed=parseToken(token),reset=parsed&&tenant.passwordResets?.[parsed.hash];
  if(!parsed||parsed.tenant!==tenantId||!reset||reset.user!==user.id)throw new Fault(400,'Token pemulihan tidak sesuai');
  this.prune(tenant);
  const id=randomUUID(),createdAt=this.now();tenant.mailOutbox||={};
  tenant.mailOutbox[id]={user:user.id,authVersion:user.authVersion||1,resetHash:parsed.hash,payload:this.cipher.encrypt(JSON.stringify({to:user.email,token}),tenantId+':mail:'+id),status:'pending',attempts:0,createdAt,nextAttempt:createdAt,expires:reset.expires,lease:null,leaseUntil:null,lastError:null};
  return id;
 }
 valid(tenant,job){
  const user=tenant.users.find(user=>user.id===job.user),reset=tenant.passwordResets?.[job.resetHash];
  return (tenant.status||'active')==='active'&&user?.active!==false&&user&&(user.authVersion||1)===job.authVersion&&reset?.user===job.user&&reset.authVersion===job.authVersion&&reset.expires>this.now()+15000&&job.expires>this.now()+15000;
 }
 prune(tenant){
  const now=this.now();tenant.mailOutbox||={};
  for(const job of Object.values(tenant.mailOutbox))if(!terminal.has(job.status)&&job.expires<=now+15000){job.status='cancelled';job.payload=null;job.lease=null;job.leaseUntil=null;job.lastError='RESET_EXPIRED_OR_REVOKED';}
  const completed=Object.entries(tenant.mailOutbox).filter(([,job])=>terminal.has(job.status)).sort((a,b)=>b[1].createdAt-a[1].createdAt);
  for(let index=0;index<completed.length;index++)if(index>=100||completed[index][1].createdAt<now-86400000)delete tenant.mailOutbox[completed[index][0]];
 }
 async claim(tenantId){
  return this.store.transact(state=>{
   const tenant=state.tenants[tenantId];if(!tenant)throw new Fault(404,'Tenant worker tidak ditemukan');
   const now=this.now();tenant.mailWorkerSeenAt=now;this.prune(tenant);
   for(const [id,job] of Object.entries(tenant.mailOutbox).sort((a,b)=>a[1].createdAt-b[1].createdAt)){
    if(terminal.has(job.status))continue;
    if(!this.valid(tenant,job)){job.status='cancelled';job.payload=null;job.lease=null;job.leaseUntil=null;job.lastError='RESET_EXPIRED_OR_REVOKED';continue;}
    if(job.status==='processing'&&job.leaseUntil>now || job.nextAttempt>now)continue;
    if(job.attempts>=this.maxAttempts){job.status='dead';job.lease=null;job.leaseUntil=null;job.lastError='ATTEMPTS_EXHAUSTED';continue;}
    job.status='processing';job.attempts++;job.lease=randomUUID();job.leaseUntil=now+this.leaseMs;
    return {id,...structuredClone(job)};
   }
   return null;
  },tenantId);
 }
 async finish(tenantId,claimed,error){
  return this.store.transact(state=>{
   const tenant=state.tenants[tenantId],job=tenant?.mailOutbox?.[claimed.id];
   if(!job||job.status!=='processing'||job.lease!==claimed.lease)return false;
   job.lease=null;job.leaseUntil=null;
   if(!this.valid(tenant,job)){job.status='cancelled';job.payload=null;job.lastError='RESET_EXPIRED_OR_REVOKED';return false;}
   if(!error){job.status='sent';job.payload=null;job.lastError=null;}
   else{job.lastError=error;job.status=job.attempts>=this.maxAttempts?'dead':'pending';job.nextAttempt=this.now()+Math.min(this.backoffMs*2**(job.attempts-1),15*60000);}
   return true;
  },tenantId);
 }
 async processNext(tenantId,mailer){
  const job=await this.claim(tenantId);if(!job)return {status:'idle'};
  let error=null;
  try{
   const payload=JSON.parse(this.cipher.decrypt(job.payload,tenantId+':mail:'+job.id));
   // Recheck revocation after claim; provider I/O never holds the tenant transaction.
   const tenant=(await this.store.read(tenantId)).tenants[tenantId],current=tenant?.mailOutbox?.[job.id];
   if(!current||current.status!=='processing'||current.lease!==job.lease||!this.valid(tenant,current)){await this.finish(tenantId,job,'RESET_EXPIRED_OR_REVOKED');return {status:'cancelled'};}
   await mailer.sendReset({...payload,jobId:job.id});
  }catch(failure){error=failure?.status===503?'ENCRYPTION_KEY_UNAVAILABLE':'PROVIDER_UNAVAILABLE';}
  const saved=await this.finish(tenantId,job,error);const status=saved?(error?(job.attempts>=this.maxAttempts?'dead':'pending'):'sent'):'cancelled';
  this.logger({event:'mail.worker',jobId:job.id,status});return {id:job.id,status};
 }
 retry(tenant,id){
  const job=tenant.mailOutbox?.[id];if(!job||job.status!=='dead')throw new Fault(409,'Hanya pengiriman gagal yang dapat dicoba ulang');
  if(!this.valid(tenant,job)||!job.payload)throw new Fault(409,'Token sudah tidak berlaku; minta tautan pemulihan baru');
  job.status='pending';job.attempts=0;job.nextAttempt=this.now();job.lastError=null;return {ok:true};
 }
 status(tenant){
  const counts={pending:0,processing:0,sent:0,cancelled:0,dead:0};for(const job of Object.values(tenant.mailOutbox||{}))counts[job.status]++;
  const jobs=Object.entries(tenant.mailOutbox||{}).sort((a,b)=>b[1].createdAt-a[1].createdAt).slice(0,100).map(([id,job])=>({id,status:job.status,attempts:job.attempts,nextAttempt:job.nextAttempt,expires:job.expires,lastError:job.lastError}));
  return {counts,jobs,workerSeenAt:tenant.mailWorkerSeenAt||null,workerRecent:Boolean(tenant.mailWorkerSeenAt&&tenant.mailWorkerSeenAt>this.now()-60000)};
 }
}
