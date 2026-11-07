import { effectivePermissions } from '../../system/access.mjs';
import { modelContract } from '../../system/module-contract.mjs';
import { inspectPackage } from '../../system/packages.mjs';
import { Fault } from '../../core/kernel.mjs';
const readable=['launcher.read','apps.list','apps.open','menus.list','settings.list','contracts.list'];
const mutable=['apps.change','menus.save','settings.save'];
const standardSchema=schema=>{if(schema.type==='json')return {};return Object.fromEntries(Object.entries(schema).map(([key,value])=>[key,key==='properties'?Object.fromEntries(Object.entries(value).map(([name,child])=>[name,standardSchema(child)])):key==='items'?standardSchema(value):value]));};
export class McpAdapter {
 constructor({kernel,identity,session,trustedKeys={}}){Object.assign(this,{kernel,identity,session,trustedKeys});}
 async principal(){const session=await this.identity.resolve(await this.session());if(!session)throw new Fault(401,'Sesi MCP tidak valid atau kedaluwarsa');const tenant=session.state.tenants[session.tenant];return {session,tenant,context:{tenant:session.tenant,user:session.user.id,authVersion:session.session.authVersion,permissions:Object.keys(effectivePermissions(tenant,session.user))}};}
 async tools(principal){
  const {context,tenant,session}=principal,result=new Map();
  for(const name of [...readable,...mutable]){const descriptor=this.kernel.services.get(name);if(context.permissions.includes(descriptor.permission))result.set(name,{descriptor,service:name,mutation:descriptor.mutation});}
  const permissions=effectivePermissions(tenant,session.user);
  for(const installed of Object.values(tenant.modules))if(installed.enabled&&installed.package){
   let manifest;try{manifest=inspectPackage(installed.package,this.trustedKeys).manifest;}catch{continue;}
   if(!manifest.model||!permissions[manifest.id+'.open'])continue;
   for(const descriptor of modelContract(manifest).services)if(permissions[descriptor.permission])result.set(descriptor.name,{descriptor,service:'records.'+descriptor.name.split('.').at(-1),module:manifest.id,mutation:descriptor.mutation});
  }
  result.set('approvals.execute',{descriptor:this.kernel.services.get('approvals.execute'),service:'approvals.execute',mutation:false});return result;
 }
 async handle(request){
  if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string')return {jsonrpc:'2.0',id:request?.id??null,error:{code:-32600,message:'Invalid request'}};
  if(request.id===undefined)return null;
  const response=result=>({jsonrpc:'2.0',id:request.id,result});
  try{
   if(request.method==='initialize'){await this.principal();return response({protocolVersion:['2024-11-05','2025-03-26'].includes(request.params?.protocolVersion)?request.params.protocolVersion:'2025-03-26',serverInfo:{name:'papbox',version:'0.2.0'},capabilities:{tools:{},resources:{}}});}
   if(request.method==='ping')return response({});
   const principal=await this.principal();
   if(request.method==='resources/list')return response({resources:principal.context.permissions.includes('contracts.read')?[{uri:'papbox://contracts',name:'Module contracts',mimeType:'application/json'}]:[]});
   if(request.method==='resources/read'){
    if(request.params?.uri!=='papbox://contracts')throw new Fault(404,'Resource tidak ditemukan');const contracts=await this.kernel.invoke('contracts.list',principal.context,{});return response({contents:[{uri:'papbox://contracts',mimeType:'application/json',text:JSON.stringify(contracts)}]});
   }
   const tools=await this.tools(principal);
   if(request.method==='tools/list')return response({tools:[...tools.entries()].map(([name,tool])=>({name,description:tool.mutation?'Meminta persetujuan UI manusia sebelum perubahan '+name:name,inputSchema:standardSchema(tool.descriptor.input),annotations:{readOnlyHint:!tool.mutation&&name!=='approvals.execute',destructiveHint:tool.mutation||name==='approvals.execute',openWorldHint:false}}))});
   if(request.method==='tools/call'){
    const tool=tools.get(request.params?.name);if(!tool)throw new Fault(403,'Tool tidak diizinkan');
    let input=request.params.arguments??{};
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Fault(400,'Argumen harus berupa objek');
    if(tool.module)input={...input,module:tool.module};
    const result=tool.mutation?await this.kernel.invoke('approvals.request',principal.context,{service:tool.service,input}):await this.kernel.invoke(tool.service,principal.context,input);
    return response({content:[{type:'text',text:JSON.stringify(result)}],isError:false});
   }
   return {jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}};
  }catch(error){if(request.method==='tools/call')return response({content:[{type:'text',text:error.status?error.message:'Internal error'}],isError:true});return {jsonrpc:'2.0',id:request.id,error:{code:error.status===401?-32001:error.status===403?-32003:-32602,message:error.status?error.message:'Internal error'}};}
 }
}
