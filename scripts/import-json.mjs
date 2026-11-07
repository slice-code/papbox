import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, PostgresStore } from '../adapters/postgres/store.mjs';
export async function importJson(store, data) {
  if (!data || typeof data.tenants !== 'object' || !data.tenants || Array.isArray(data.tenants)) throw Error('Invalid JSON store');
  const entries=Object.entries(data.tenants);
  // Preflight all tenants before writing. Each tenant imports atomically.
  for(const [tenant,value] of entries) {
    if (!/^[a-z][a-z0-9_-]{0,62}$/.test(tenant) || !value?.users?.length || !value.settings || !value.modules || !value.menus || !Array.isArray(value.audit)) throw Error('Invalid tenant data');
    if (Object.hasOwn((await store.read(tenant)).tenants,tenant)) throw Error(`Target tenant already exists: ${tenant}`);
  }
  for(const [tenant,value] of entries) await store.transact(state=>{
    if (Object.hasOwn(state.tenants,tenant)) throw Error(`Target tenant already exists: ${tenant}`);
    state.tenants[tenant]=value;
  },tenant);
  return entries.length;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]) throw Error('Usage: npm run db:import-json -- /path/to/data.json');
  const store=new PostgresStore(createPool(process.env.DATABASE_URL));
  try { await store.initialize();const count=await importJson(store,JSON.parse(await readFile(process.argv[2],'utf8')));console.log(`Imported ${count} tenant(s); source JSON unchanged`); }
  finally { await store.close(); }
}
