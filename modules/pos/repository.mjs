import {Fault} from '../../core/kernel.mjs';
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const publicRow=row=>row&&({...row,createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString()});
export class PosRepository {
 constructor(tenant,tenantId,tx){Object.assign(this,{tenant,tenantId,client:tx.client});}
 async get(id,kind){
  if(!uuid(id))throw new Fault(400,'ID tidak valid');id=id.toLowerCase();
  if(this.client)return publicRow((await this.client.query('SELECT id,owner_id AS owner,data,revision,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE tenant_id=$1 AND module_id=\'pos\' AND id=$2 AND data->>\'kind\'=$3',[this.tenantId,id,kind])).rows[0]);
  const row=this.tenant.records?.pos?.[id];return row?.data.kind===kind?structuredClone(row):null;
 }
 async find(field,value,kind){
  if(!['sku','requestId'].includes(field))throw Error('Unsupported POS lookup');
  if(this.client)return publicRow((await this.client.query(`SELECT id,owner_id AS owner,data,revision,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE tenant_id=$1 AND module_id='pos' AND data->>'kind'=$2 AND data->>$3=$4`,[this.tenantId,kind,field,value])).rows[0]);
  return Object.values(this.tenant.records?.pos||{}).find(row=>row.data.kind===kind&&row.data[field]===value)||null;
 }
 async insert(row){
  if(this.client)await this.client.query("INSERT INTO module_records(tenant_id,module_id,id,owner_id,data,revision,created_at,updated_at) VALUES($1,'pos',$2,$3,$4,$5,$6,$7)",[this.tenantId,row.id,row.owner,row.data,row.revision,row.createdAt,row.updatedAt]);
  else{this.tenant.records||={};this.tenant.records.pos||={};this.tenant.records.pos[row.id]=structuredClone(row);}
  return row;
 }
 async save(row){
  if(this.client){const result=await this.client.query("UPDATE module_records SET data=$3,revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND module_id='pos' AND id=$2 AND revision=$5",[this.tenantId,row.id,row.data,row.updatedAt,row.revision-1]);if(!result.rowCount)throw new Fault(409,'Data berubah; muat ulang');}
  else this.tenant.records.pos[row.id]=structuredClone(row);
  return row;
 }
 async categories(){
  if(this.client)return (await this.client.query("SELECT DISTINCT coalesce(data->>'category','Umum') AS category FROM module_records WHERE tenant_id=$1 AND module_id='pos' AND data->>'kind'='product' AND data->>'active'='true' ORDER BY category LIMIT 1000",[this.tenantId])).rows.map(row=>row.category);
  return [...new Set(Object.values(this.tenant.records?.pos||{}).filter(row=>row.data.kind==='product'&&row.data.active).map(row=>row.data.category||'Umum'))].sort().slice(0,1000);
 }
 async products({q='',category='',includeInactive=false,limit=50,cursor=''}={}){
  if(cursor&&!uuid(cursor))throw new Fault(400,'Cursor produk tidak valid');
  cursor=cursor.toLowerCase();
  let rows;
  if(this.client)rows=(await this.client.query("SELECT id,owner_id AS owner,data,revision,created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM module_records WHERE tenant_id=$1 AND module_id='pos' AND data->>'kind'='product' AND ($2 OR data->>'active'='true') AND position(lower($3) in lower((data->>'name')||' '||(data->>'sku')))>0 AND ($4::uuid IS NULL OR id>$4) AND ($6='' OR coalesce(data->>'category','Umum')=$6) ORDER BY id LIMIT $5",[this.tenantId,includeInactive,q,cursor||null,limit+1,category])).rows.map(publicRow);
  else rows=Object.values(this.tenant.records?.pos||{}).filter(row=>row.data.kind==='product'&&(!category||(row.data.category||'Umum')===category)&&(includeInactive||row.data.active)&&(!cursor||row.id>cursor)&&(row.data.name+' '+row.data.sku).toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit+1);
  return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null};
 }
 async sales({limit=25,cursor='',owner=null}={}){
  let after=null;if(cursor){try{after=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(!uuid(after.id)||typeof after.at!=='string'||new Date(after.at).toISOString()!==after.at)throw Error();after.id=after.id.toLowerCase();}catch{throw new Fault(400,'Cursor riwayat tidak valid');}}
  let rows;
  if(this.client)rows=(await this.client.query("SELECT id,owner_id AS owner,data,revision,created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM module_records WHERE tenant_id=$1 AND module_id='pos' AND data->>'kind'='sale' AND ($2::uuid IS NULL OR owner_id=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",[this.tenantId,owner,after?.at||null,after?.id||null,limit+1])).rows.map(publicRow);
  else rows=Object.values(this.tenant.records?.pos||{}).filter(row=>row.data.kind==='sale'&&(!owner||row.owner===owner)&&(!after||row.createdAt<after.at||row.createdAt===after.at&&row.id<after.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,limit+1);
  const last=rows[limit-1];return {items:rows.slice(0,limit),nextCursor:rows.length>limit?Buffer.from(JSON.stringify({at:last.createdAt,id:last.id})).toString('base64url'):null};
 }
}
