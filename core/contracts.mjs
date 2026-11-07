import { Fault } from './kernel.mjs';
export const identifier=/^[a-z][a-z0-9_-]{0,62}$/;
export const permissionId=/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
export const versionPattern=/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const fail=message=>{throw new Fault(400,message);};
export function validateSchema(schema,depth=0){
  if(depth>6 || !schema || typeof schema!=='object' || Array.isArray(schema))fail('Skema input tidak valid');
  const keys=['type','properties','required','additionalProperties','items','enum','minLength','maxLength','minimum','maximum','maxItems'];
  if(Object.keys(schema).some(key=>!keys.includes(key)) || !['object','array','string','integer','number','boolean','json'].includes(schema.type))fail('Tipe atau keyword skema tidak didukung');
  const applicable={object:['type','properties','required','additionalProperties'],array:['type','items','maxItems'],string:['type','enum','minLength','maxLength'],integer:['type','enum','minimum','maximum'],number:['type','enum','minimum','maximum'],boolean:['type','enum'],json:['type']};
  if(Object.keys(schema).some(key=>!applicable[schema.type].includes(key)))fail('Keyword tidak sesuai tipe skema');
  if(schema.minimum!==undefined&&schema.maximum!==undefined&&schema.minimum>schema.maximum || schema.minLength!==undefined&&schema.maxLength!==undefined&&schema.minLength>schema.maxLength)fail('Rentang skema tidak valid');
  if(schema.enum && (!Array.isArray(schema.enum) || schema.enum.length>50 || schema.enum.some(value=>!['string','boolean','number'].includes(typeof value))))fail('Enum tidak valid');
  if(schema.enum && schema.enum.some(value=>schema.type==='integer'?!Number.isSafeInteger(value):typeof value!==schema.type))fail('Enum tidak sesuai tipe');
  for(const key of ['minLength','maxLength','maxItems'])if(schema[key]!==undefined && (!Number.isInteger(schema[key]) || schema[key]<0 || schema[key]>10000))fail('Batas skema tidak valid');
  for(const key of ['minimum','maximum'])if(schema[key]!==undefined && (typeof schema[key]!=='number' || !Number.isFinite(schema[key])))fail('Batas angka tidak valid');
  if(schema.type==='object'){
    if(!schema.properties || typeof schema.properties!=='object' || Array.isArray(schema.properties) || Object.keys(schema.properties).length>50 || Object.keys(schema.properties).some(key=>!/^[a-z][A-Za-z0-9_]{0,62}$/.test(key) || ['constructor','prototype'].includes(key)))fail('Properti skema tidak valid');
    if(schema.additionalProperties!==false || !Array.isArray(schema.required) || new Set(schema.required).size!==schema.required.length || schema.required.some(key=>!Object.hasOwn(schema.properties,key)))fail('Skema objek harus tertutup dengan required eksplisit');
    for(const child of Object.values(schema.properties))validateSchema(child,depth+1);
  }
  if(schema.type==='array'){if(schema.maxItems===undefined || !schema.items)fail('Array harus dibatasi');validateSchema(schema.items,depth+1);}
  return schema;
}
export function validateInput(value,schema,path='input'){
  const wrong=()=>fail(`Isian ${path} tidak sesuai skema`);
  if(schema.type==='json'){try{if(JSON.stringify(value).length>65536)wrong();}catch{wrong();}return value;}
  if(schema.enum && !schema.enum.includes(value))wrong();
  if(schema.type==='object'){
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)) || schema.required.some(key=>!Object.hasOwn(value,key)))wrong();
    for(const [key,item] of Object.entries(value))validateInput(item,schema.properties[key],path+'.'+key);
  }else if(schema.type==='array'){
    if(!Array.isArray(value) || value.length>schema.maxItems)wrong();for(const item of value)validateInput(item,schema.items,path+'[]');
  }else if(schema.type==='string'){
    if(typeof value!=='string' || value.length<(schema.minLength??0) || value.length>(schema.maxLength??10000))wrong();
  }else if(schema.type==='boolean'){if(typeof value!=='boolean')wrong();}
  else if(typeof value!=='number' || !Number.isFinite(value) || schema.type==='integer' && !Number.isSafeInteger(value) || value<(schema.minimum??-Infinity) || value>(schema.maximum??Infinity))wrong();
  return value;
}
export function validateModule(contract){
  if(!contract || !identifier.test(contract.id) || !versionPattern.test(contract.version) || contract.api!==1 || !Array.isArray(contract.permissions) || !Array.isArray(contract.services) || !Array.isArray(contract.routes) || !Array.isArray(contract.dependencies))fail('Kontrak modul tidak valid');
  const permissions=new Set();
  for(const p of contract.permissions){if(!permissionId.test(p.id) || permissions.has(p.id) || !Array.isArray(p.scopes) || !p.scopes.length || p.scopes.some(scope=>!['own','all'].includes(scope)))fail('Deklarasi izin tidak valid');permissions.add(p.id);}
  const services=new Set();
  for(const service of contract.services){
    if(!permissionId.test(service.name) || services.has(service.name) || !permissions.has(service.permission) || typeof service.mutation!=='boolean' || typeof service.confirmation!=='boolean')fail('Deklarasi layanan tidak valid');
    if(service.confirmation && !service.mutation)fail('Konfirmasi hanya untuk mutasi');validateSchema(service.input);services.add(service.name);
  }
  const routes=new Set();
  for(const route of contract.routes){const key=route.method+' '+route.path;if(!['GET','POST'].includes(route.method) || typeof route.path!=='string' || !/^\/api\/[a-z0-9_./-]+$/.test(route.path) || route.path.includes('..') || !services.has(route.service) || routes.has(key))fail('Deklarasi rute tidak valid');routes.add(key);}
  for(const dep of contract.dependencies)if(!identifier.test(dep.id) || dep.id===contract.id || !versionPattern.test(dep.version))fail('Dependensi tidak valid');
  return structuredClone(contract);
}
