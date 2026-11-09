import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {MailOutbox} from '../system/mail-outbox.mjs';
import {Mfa} from '../system/mfa.mjs';
import {issueReset} from '../system/identity.mjs';
import {Store} from '../core/store.mjs';
import {outboxContract} from './helpers/outbox-contract.mjs';
test('durable mail queue: encryption, retry, leases, worker recovery, revocation and human retry',async t=>{
 const dir=await mkdtemp('/tmp/papbox-outbox-');t.after(()=>rm(dir,{recursive:true,force:true}));await outboxContract(new Store(dir+'/data.json'));
});

test('worker CLI refuses a shared JSON store before any provider request',()=>{
 const result=spawnSync(process.execPath,[new URL('../scripts/mail-worker.mjs',import.meta.url).pathname,'--tenant','default','--once'],{encoding:'utf8',env:{...process.env,DATABASE_URL:'',PAPBOX_EMAIL_ENABLED:'false'}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/requires PostgreSQL/);
});

test('enqueue bounds cancelled history even while no worker is running',()=>{
 let now=Date.now();const queue=new MailOutbox({cipher:new Mfa('56'.repeat(32)),now:()=>now}),user={id:'11111111-1111-1111-1111-111111111111',email:'user@example.com',authVersion:1};const tenant={users:[user],passwordResets:{}};
 for(let index=0;index<110;index++){now++;const reset=issueReset(tenant,user,'history',now);queue.enqueue(tenant,'history',user,reset.token);}
 const jobs=Object.values(tenant.mailOutbox);assert.equal(jobs.filter(job=>job.status==='pending').length,1);assert(jobs.length<=101);assert(jobs.filter(job=>job.status==='cancelled').every(job=>job.payload===null));
});
