import { Store } from '../core/store.mjs';
import { fileURLToPath } from 'node:url';
export async function runtimeStore(){
  if(!process.env.DATABASE_URL)return new Store(process.env.PAPBOX_DATA || fileURLToPath(new URL('../storage/data.json',import.meta.url)));
  const {PostgresStore,createPool}=await import('../adapters/postgres/store.mjs');
  const store=new PostgresStore(createPool(process.env.DATABASE_URL));
  try{await store.initialize();return store;}catch(error){await store.close();throw error;}
}
export async function readPassword(){
  if(process.stdin.isTTY)throw Error('Read password securely from stdin; see docs/SYSTEM.md');
  let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>1024)throw Error('Input too large');}
  return input.replace(/\r?\n$/,'');
}
