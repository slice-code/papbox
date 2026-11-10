import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {Store} from '../core/store.mjs';
import {posContract} from './helpers/pos-contract.mjs';
test('POS: prices, cash checkout, idempotency, product revisions, tenant/owner ACL and immutable receipts',async t=>{
 const dir=await mkdtemp('/tmp/papbox-pos-');t.after(()=>rm(dir,{recursive:true,force:true}));await posContract(new Store(dir+'/data.json'));
});
