import { readFile,stat } from 'node:fs/promises';
import { runtimeStore } from './runtime-store.mjs';
import {registerNativeApps} from '../modules/native.mjs';
import { Kernel } from '../core/kernel.mjs';
import { registerSystem } from '../system/services.mjs';
import { Identity } from '../system/identity.mjs';
import { Mfa } from '../system/mfa.mjs';
import { McpAdapter } from '../adapters/mcp/adapter.mjs';
const file=process.env.PAPBOX_MCP_SESSION_FILE;if(!file)throw Error('PAPBOX_MCP_SESSION_FILE is required; see docs/MCP.md');
const session=async()=>{const info=await stat(file);if(!info.isFile()||info.mode&0o077||process.getuid&&info.uid!==process.getuid())throw Error('MCP session file must be owned by current user and mode 0600');return (await readFile(file,'utf8')).trim();};
const store=await runtimeStore(),kernel=new Kernel(),mfa=new Mfa(process.env.PAPBOX_ENCRYPTION_KEY);
const trustedKeys=process.env.PAPBOX_TRUSTED_KEYS?JSON.parse(await readFile(process.env.PAPBOX_TRUSTED_KEYS,'utf8')):{};
registerSystem(kernel,store,{trustedKeys,mfa});registerNativeApps(kernel,store);const adapter=new McpAdapter({kernel,identity:new Identity(store,{mfa}),session,trustedKeys});
let pending='';
try{
 process.stdin.setEncoding('utf8');
 for await(const chunk of process.stdin){
  pending+=chunk;if(Buffer.byteLength(pending)>262144)throw Error('MCP input exceeds 256 KiB');
  let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);if(!line.trim())continue;let result;try{result=await adapter.handle(JSON.parse(line));}catch{result={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}if(result)process.stdout.write(JSON.stringify(result)+'\n');}
 }
}finally{await store.close?.();}
