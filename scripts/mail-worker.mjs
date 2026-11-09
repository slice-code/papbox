import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimeStore} from './runtime-store.mjs';
import {configuredMail} from '../adapters/google/mail.mjs';
import {MailOutbox} from '../system/mail-outbox.mjs';
import {Mfa} from '../system/mfa.mjs';
import {tenantPattern} from '../system/identity.mjs';
const {values}=parseArgs({options:{tenant:{type:'string',multiple:true},once:{type:'boolean'}}});
const tenants=[...new Set(values.tenant||[])];if(!tenants.length||tenants.some(id=>!tenantPattern.test(id)))throw Error('Use --tenant <id> (repeat for each assigned tenant)');
if(!process.env.DATABASE_URL)throw Error('The mail worker requires PostgreSQL; JSON is only supported for in-process development tests');
const mailer=configuredMail();if(!mailer)throw Error('Configure Google mail and PAPBOX_EMAIL_ENABLED=true before running the worker');
const cipher=new Mfa(process.env.PAPBOX_ENCRYPTION_KEY);cipher.requireKey();
const store=await runtimeStore(),controller=new AbortController(),worker=new MailOutbox({store,cipher,logger:entry=>console.log(JSON.stringify(entry))});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());
try{
 do{
  for(const tenant of tenants){if(controller.signal.aborted)break;try{await worker.processNext(tenant,mailer);}catch(error){console.error(JSON.stringify({event:'mail.worker-error',code:error.code||error.status||'INTERNAL'}));if(values.once)process.exitCode=1;}}
  if(values.once||controller.signal.aborted)break;
  try{await delay(5000,undefined,{signal:controller.signal});}catch(error){if(error.name!=='AbortError')throw error;}
 }while(!controller.signal.aborted);
}finally{await store.close?.();}
