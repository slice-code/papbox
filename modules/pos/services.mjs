import {randomUUID,createHash} from 'node:crypto';
import {Fault} from '../../core/kernel.mjs';
import {access} from '../../system/access.mjs';
import {canonical} from '../../system/packages.mjs';
import {text} from '../../system/security.mjs';
import {PosRepository,uuid} from './repository.mjs';
import {posContract} from './manifest.mjs';
const product=row=>({id:row.id,revision:row.revision,...row.data});
const sale=row=>{const {payloadHash,requestId,...data}=row.data;return {id:row.id,owner:row.owner,revision:row.revision,createdAt:row.createdAt,...data};};
const makeRow=(actor,data)=>({id:randomUUID(),owner:actor.id,revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),data});
async function quote(repo,items,checkRevision){
 if(!items.length)throw new Fault(400,'Keranjang masih kosong');
 const seen=new Set(),lines=[];let total=0;
 for(const item of items){
  if(!uuid(item.productId)||seen.has(item.productId.toLowerCase()))throw new Fault(400,'Produk duplikat atau ID tidak valid');seen.add(item.productId.toLowerCase());
  const row=await repo.get(item.productId,'product');if(!row||!row.data.active)throw new Fault(409,'Produk tidak tersedia atau telah dinonaktifkan');
  if(checkRevision&&item.revision!==row.revision)throw new Fault(409,'Harga atau produk berubah. Perbarui keranjang sebelum membayar.');
  const lineTotal=row.data.price*item.quantity;total+=lineTotal;if(!Number.isSafeInteger(total)||total>1000000000000)throw new Fault(400,'Total transaksi melebihi batas');
  lines.push({productId:row.id,revision:row.revision,sku:row.data.sku,name:row.data.name,quantity:item.quantity,unitPrice:row.data.price,lineTotal});
 }
 return {items:lines,currency:'IDR',total};
}
export function registerPos(kernel,store){
 const handlers={},operations={
  'pos.products.list':async(t,i,_ctx,_tx,actor,repo)=>{if(i.includeInactive)access(t,actor,'pos.products.manage');const page=await repo.products(i);return {...page,items:page.items.map(product)};},
  'pos.products.get':async(_t,i,_ctx,_tx,_actor,repo)=>{const row=await repo.get(i.id,'product');if(!row)throw new Fault(404,'Produk tidak ditemukan');return product(row);},
  'pos.products.create':async(_t,i,_ctx,_tx,actor,repo)=>{
   const sku=text(i.sku,40).toUpperCase();if(!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku))throw new Fault(400,'SKU hanya huruf, angka, titik, garis bawah atau strip');
   if(await repo.find('sku',sku,'product'))throw new Fault(409,'SKU sudah digunakan');
   return product(await repo.insert(makeRow(actor,{kind:'product',sku,name:text(i.name,120),price:i.price,active:true})));
  },
  'pos.products.update':async(_t,i,_ctx,_tx,_actor,repo)=>{const row=await repo.get(i.id,'product');if(!row)throw new Fault(404,'Produk tidak ditemukan');if(row.revision!==i.revision)throw new Fault(409,'Produk sudah berubah; muat ulang');return product(await repo.save({...row,revision:row.revision+1,updatedAt:new Date().toISOString(),data:{...row.data,name:text(i.name,120),price:i.price,active:i.active}}));},
  'pos.quote':async(_t,i,_ctx,_tx,_actor,repo)=>quote(repo,i.items,false),
  'pos.sales.resolve':async(_t,i,_ctx,_tx,actor,repo)=>{if(!uuid(i.requestId))throw new Fault(400,'ID permintaan tidak valid');const row=await repo.find('requestId',i.requestId.toLowerCase(),'sale');if(!row)return null;if(row.owner!==actor.id)throw new Fault(403,'Akses ditolak');return sale(row);},
  'pos.checkout':async(t,i,_ctx,_tx,actor,repo)=>{
   access(t,actor,'pos.products.read');
   if(!uuid(i.requestId))throw new Fault(400,'ID permintaan tidak valid');
   const payloadHash=createHash('sha256').update(canonical({items:i.items.map(item=>({...item,productId:item.productId.toLowerCase()})).sort((a,b)=>a.productId.localeCompare(b.productId)),tendered:i.tendered})).digest('hex');
   const previous=await repo.find('requestId',i.requestId.toLowerCase(),'sale');if(previous){if(previous.owner!==actor.id||previous.data.payloadHash!==payloadHash)throw new Fault(409,'ID permintaan sudah digunakan untuk transaksi lain');return sale(previous);}
   const priced=await quote(repo,i.items,true);if(i.tendered<priced.total)throw new Fault(400,'Uang diterima kurang dari total');
   const row=makeRow(actor,{kind:'sale',...priced,status:'paid',tendered:i.tendered,change:i.tendered-priced.total,cashierName:actor.name,paymentMethod:'cash',requestId:i.requestId.toLowerCase(),payloadHash});row.data.number='POS-'+row.id.toUpperCase();return sale(await repo.insert(row));
  },
  'pos.sales.list':async(t,i,_ctx,_tx,actor,repo)=>{const scope=access(t,actor,'pos.sales.read'),page=await repo.sales({...i,owner:scope==='own'?actor.id:null});return {...page,items:page.items.map(sale)};},
  'pos.sales.get':async(t,i,_ctx,_tx,actor,repo)=>{const row=await repo.get(i.id,'sale');if(!row)throw new Fault(404,'Transaksi tidak ditemukan');access(t,actor,'pos.sales.read',row.owner);return sale(row);},
  'pos.sales.void':async(t,i,_ctx,_tx,actor,repo)=>{
   const row=await repo.get(i.id,'sale');if(!row)throw new Fault(404,'Transaksi tidak ditemukan');access(t,actor,'pos.sales.void',row.owner);const reason=text(i.reason,300);if(reason.length<3)throw new Fault(400,'Alasan pembatalan minimal tiga karakter');
   if(row.data.status==='void'){if(row.data.voidedBy===actor.id&&row.data.voidReason===reason)return sale(row);throw new Fault(409,'Transaksi sudah dibatalkan');}
   if(row.revision!==i.revision)throw new Fault(409,'Transaksi sudah berubah; muat ulang');
   return sale(await repo.save({...row,revision:row.revision+1,updatedAt:new Date().toISOString(),data:{...row.data,status:'void',voidedBy:actor.id,voidedAt:new Date().toISOString(),voidReason:reason}}));
  }
 };
 for(const descriptor of posContract.services)handlers[descriptor.name]=(ctx,input)=>store.transact(async(state,tx={})=>{
  const tenant=state.tenants[ctx.tenant],actor=tenant?.users.find(user=>user.id===ctx.user&&user.active!==false);
  if(!tenant||!actor||(tenant.status||'active')!=='active'||ctx.authVersion!==undefined&&ctx.authVersion!==(actor.authVersion||1))throw new Fault(401,'Sesi tidak valid');
  if(!tenant.modules.pos?.enabled||tenant.modules.pos.package)throw new Fault(404,'Aplikasi POS belum aktif');
  access(tenant,actor,'pos.open');access(tenant,actor,descriptor.permission);
  const result=await operations[descriptor.name](tenant,input,ctx,tx,actor,new PosRepository(tenant,ctx.tenant,tx));
  if(descriptor.mutation)tenant.audit.push({at:new Date().toISOString(),user:actor.id,action:descriptor.name,details:{target:result.id}});
  return result;
 },ctx.tenant);
 kernel.install(posContract,handlers);
}
