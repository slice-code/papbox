import { randomUUID } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
import { validateInput } from '../core/contracts.mjs';
import { access } from './access.mjs';
export async function listRecords(tenant,tenantId,module,actor,input,tx){
 const scope=access(tenant,actor,module+'.records.read');
 const limit=input.limit??25;if(!Number.isInteger(limit) || limit<1 || limit>100)throw new Fault(400,'Batas halaman 1–100');
 const cursor=input.cursor||'';if(cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cursor))throw new Fault(400,'Cursor tidak valid');
 let rows;
 if(tx.client)rows=(await tx.client.query('SELECT id,owner_id AS owner,data,revision,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE tenant_id=$1 AND module_id=$2 AND ($3::uuid IS NULL OR owner_id=$3) AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5',[tenantId,module,scope==='own'?actor.id:null,cursor||null,limit+1])).rows;
 else rows=Object.values(tenant.records?.[module]||{}).filter(row=>(scope==='all'||row.owner===actor.id)&&(!cursor||row.id>cursor)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit+1);
 return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null};
}
export async function mutateRecord(tenant,tenantId,module,actor,input,operation,model,tx){
 access(tenant,actor,module+'.records.'+operation);
 if(operation!=='delete')validateInput(input.data,model);
 if(operation==='create'){
  const row={id:randomUUID(),owner:actor.id,data:structuredClone(input.data),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  if(tx.client)await tx.client.query('INSERT INTO module_records(tenant_id,module_id,id,owner_id,data) VALUES($1,$2,$3,$4,$5)',[tenantId,module,row.id,row.owner,row.data]);
  else{tenant.records||={};tenant.records[module]||={};tenant.records[module][row.id]=row;}
  return row;
 }
 if(typeof input.id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.id) || !Number.isInteger(input.revision))throw new Fault(400,'ID atau revisi record tidak valid');
 const row=tx.client?(await tx.client.query('SELECT id,owner_id AS owner,data,revision FROM module_records WHERE tenant_id=$1 AND module_id=$2 AND id=$3 FOR UPDATE',[tenantId,module,input.id])).rows[0]:tenant.records?.[module]?.[input.id];
 if(!row)throw new Fault(404,'Record tidak ditemukan');
 access(tenant,actor,module+'.records.'+operation,row.owner);
 if(row.revision!==input.revision)throw new Fault(409,'Data sudah berubah; muat ulang sebelum menyimpan');
 if(operation==='delete'){
  if(tx.client)await tx.client.query('DELETE FROM module_records WHERE tenant_id=$1 AND module_id=$2 AND id=$3',[tenantId,module,input.id]);else delete tenant.records[module][input.id];return {ok:true};
 }
 const updated={...row,data:structuredClone(input.data),revision:row.revision+1,updatedAt:new Date().toISOString()};
 if(tx.client)await tx.client.query('UPDATE module_records SET data=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND module_id=$2 AND id=$3',[tenantId,module,input.id,input.data]);else tenant.records[module][input.id]=updated;
 return updated;
}
export async function hasRecords(tenant,tenantId,module,tx){return tx.client?(await tx.client.query('SELECT 1 FROM module_records WHERE tenant_id=$1 AND module_id=$2 LIMIT 1',[tenantId,module])).rowCount>0:Object.keys(tenant.records?.[module]||{}).length>0;}
export async function validateExisting(tenant,tenantId,module,model,tx){
 if(!model && await hasRecords(tenant,tenantId,module,tx))throw new Fault(409,'Paket dengan data tidak boleh berubah menjadi paket tanpa model');
 if(!model)return;
 if(tx.client){let cursor=null;while(true){const rows=(await tx.client.query('SELECT id,data FROM module_records WHERE tenant_id=$1 AND module_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 100',[tenantId,module,cursor])).rows;if(!rows.length)break;for(const row of rows)validateInput(row.data,model);cursor=rows.at(-1).id;}}
 else for(const row of Object.values(tenant.records?.[module]||{}))validateInput(row.data,model);
}
