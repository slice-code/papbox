import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {base32,fromBase32,totp,Mfa} from '../system/mfa.mjs';
import {GoogleMail,configuredMail} from '../adapters/google/mail.mjs';
import {createApp} from '../server.mjs';
import {Store} from '../core/store.mjs';
import {provisionTenant,Identity} from '../system/identity.mjs';
test('TOTP RFC vector and authenticated encryption bind secrets to the account',()=>{
 const input=Buffer.from('12345678901234567890');const secret=base32(input);assert.deepEqual(fromBase32(secret),input);assert.equal(totp(secret,1),'287082');
 const mfa=new Mfa('ab'.repeat(32));const encrypted=mfa.encrypt(secret,'tenant:user');assert.equal(mfa.decrypt(encrypted,'tenant:user'),secret);assert.throws(()=>mfa.decrypt(encrypted,'other:user'),{status:503});assert.throws(()=>new Mfa('bad-key'));
});
test('Google mail refreshes OAuth credentials and sends reset links without header injection',async()=>{
 const calls=[];
 const mail=new GoogleMail({clientId:'test-client',clientSecret:'test-secret',refreshToken:'test-refresh',from:'sender@example.com',publicUrl:'https://app.example.com',fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({access_token:'test-access',expires_in:3600})};}});
 await mail.sendReset({to:'user@example.com',token:'tenant.'+'a'.repeat(64)});await mail.sendReset({to:'other@example.com',token:'tenant.'+'b'.repeat(64)});
 assert.equal(calls.filter(call=>call.url.includes('oauth2')).length,1);
 const raw=JSON.parse(calls[1].options.body).raw;const message=Buffer.from(raw,'base64url').toString('utf8');assert(message.includes('https://app.example.com/#reset='));assert(!message.includes('test-secret'));assert.equal(calls[1].options.headers.Authorization,'Bearer test-access');
 await assert.rejects(mail.sendReset({to:'x@example.com\r\nBcc: attacker@example.com',token:'x'}),{status:400});assert.equal(configuredMail({PAPBOX_EMAIL_ENABLED:'false'}),null);assert.throws(()=>configuredMail({PAPBOX_EMAIL_ENABLED:'true'}));
});
test('email recovery hides account existence, changes credentials with a one-use token, and logs no secrets',async t=>{
 const dir=await mkdtemp('/tmp/papbox-email-');t.after(()=>rm(dir,{recursive:true,force:true}));const store=new Store(dir+'/data.json');await provisionTenant(store,{tenant:'email',name:'Email',adminName:'Admin',email:'admin@example.com',password:'original password 123'});
 const delivered=[],logs=[],app=createApp({store,mailer:{sendReset:async message=>delivered.push(message)},logger:entry=>logs.push(entry)});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
 const base='http://127.0.0.1:'+app.server.address().port;
 const request=async input=>{const response=await fetch(base+'/api/forgot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
 const exists=await request({tenant:'email',email:'admin@example.com'}),missing=await request({tenant:'email',email:'unknown@example.com'});assert.deepEqual(exists,missing);
 await new Promise(r=>setImmediate(r));assert.equal(delivered.length,1);const token=delivered[0].token;
 assert(!JSON.stringify(await store.read()).includes(token));assert(!JSON.stringify(logs).includes(token));
 const identity=new Identity(store);await identity.reset(token,'replacement password 123');await assert.rejects(identity.reset(token,'third password 123'),{status:400});await identity.login('email','admin@example.com','replacement password 123');
});

test('readiness fails on backend outage without exposing internal errors',async t=>{
 const logs=[],store={health:async()=>{throw Error('internal-secret');},read:async()=>{throw Error('internal-secret');}};
 const app=createApp({store,logger:entry=>logs.push(entry)});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));});
 const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/healthz')).status,200);
 const ready=await fetch(base+'/readyz');assert.equal(ready.status,503);assert.deepEqual(await ready.json(),{status:'unavailable'});
 const failure=await fetch(base+'/api/session');assert.equal(failure.status,500);assert(!JSON.stringify(await failure.json()).includes('internal-secret'));assert(!JSON.stringify(logs).includes('internal-secret'));
});
