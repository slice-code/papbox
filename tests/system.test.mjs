import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { Store } from '../core/store.mjs';
import {operationsContract} from './helpers/operations-contract.mjs';
import {accessContract} from './helpers/access-contract.mjs';
import { systemContract } from './helpers/system-contract.mjs';
test('system lifecycle: accounts, recovery, persistent sessions, provisioning and signed package rollback',async t=>{
 const dir=await mkdtemp('/tmp/papbox-system-');t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new Store(dir+'/data.json');await systemContract(store);await accessContract(store);await operationsContract(store);
});
