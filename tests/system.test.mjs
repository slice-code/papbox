import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { Store } from '../core/store.mjs';
import { systemContract } from './helpers/system-contract.mjs';
test('system lifecycle: accounts, recovery, persistent sessions, provisioning and signed package rollback',async t=>{
 const dir=await mkdtemp('/tmp/papbox-system-');t.after(()=>rm(dir,{recursive:true,force:true}));
 await systemContract(new Store(dir+'/data.json'));
});
