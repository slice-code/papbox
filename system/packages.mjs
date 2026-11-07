import { createPublicKey, verify, createHash } from 'node:crypto';
import { Fault } from '../core/kernel.mjs';
const colors=['blue','green','purple','orange','pink','slate'];
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
export function inspectPackage(bundle, trustedKeys={}){
  if(!exact(bundle,['format','publisher','manifest','signature']) || bundle.format!=='papbox.module/1' || typeof bundle.publisher!=='string' || !/^[a-z][a-z0-9_-]{0,62}$/.test(bundle.publisher) || typeof bundle.signature!=='string' || !/^[A-Za-z0-9+/]{86}==$/.test(bundle.signature))throw new Fault(400,'Format paket tidak valid');
  const m=bundle.manifest;
  if(!exact(m,['id','version','api','name','icon','color','description','content']) || !/^[a-z][a-z0-9_-]{0,62}$/.test(m.id) || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(m.version) || m.api!==1 || !colors.includes(m.color))throw new Fault(400,'Manifest atau versi API tidak didukung');
  for(const [field,max] of [['name',80],['icon',4],['description',300],['content',8000]])if(typeof m[field]!=='string' || !m[field].trim() || m[field].length>max)throw new Fault(400,'Konten manifest tidak valid');
  if(!Object.hasOwn(trustedKeys,bundle.publisher))throw new Fault(403,'Penerbit belum dipercaya oleh operator');
  let key;try{key=createPublicKey(trustedKeys[bundle.publisher]);}catch{throw new Fault(403,'Kunci penerbit tidak valid');}
  if(key.asymmetricKeyType!=='ed25519')throw new Fault(403,'Penerbit harus memakai Ed25519');
  const payload=canonical({format:bundle.format,publisher:bundle.publisher,manifest:m});
  if(!verify(null,Buffer.from(payload),key,Buffer.from(bundle.signature,'base64')))throw new Fault(400,'Tanda tangan atau integritas paket tidak valid');
  return {manifest:m,publisher:bundle.publisher,digest:createHash('sha256').update(payload).digest('hex')};
}
export const newer=(next,old)=>{const a=next.split('.').map(Number),b=old.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;};
