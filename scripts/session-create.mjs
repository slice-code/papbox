import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { runtimeStore } from './runtime-store.mjs';
import { Identity } from '../system/identity.mjs';
import { Mfa } from '../system/mfa.mjs';
const {values}=parseArgs({options:{tenant:{type:'string'},email:{type:'string'},out:{type:'string'}}});
if(!values.tenant||!values.email||!values.out||process.stdin.isTTY)throw Error('Provide --tenant, --email, --out; password and optional MFA code on two stdin lines');
let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>1024)throw Error('Input too large');}
const [password,code]=input.replace(/\r/g,'').split('\n'),store=await runtimeStore(),identity=new Identity(store,{mfa:new Mfa(process.env.PAPBOX_ENCRYPTION_KEY)});let token;
try{token=await identity.login(values.tenant,values.email,password,code||undefined);try{await writeFile(values.out,token+'\n',{mode:0o600,flag:'wx'});}catch(error){await identity.logout(token);throw error;}console.log('Session file written; expires in eight hours');}
finally{await store.close?.();}
