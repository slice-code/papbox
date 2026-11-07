import { modulePermissions } from './access.mjs';
import { validateModule } from '../core/contracts.mjs';
export function modelContract(manifest){
 const module=manifest.id;
 const props={list:{limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',maxLength:36}},create:{data:manifest.model},update:{id:{type:'string',minLength:36,maxLength:36},revision:{type:'integer',minimum:1},data:manifest.model},delete:{id:{type:'string',minLength:36,maxLength:36},revision:{type:'integer',minimum:1},approved:{type:'boolean'}}};
 const required={list:[],create:['data'],update:['id','revision','data'],delete:['id','revision','approved']};
 return validateModule({id:module,version:manifest.version,api:1,dependencies:Object.entries(manifest.dependencies||{}).map(([id,version])=>({id,version})),permissions:Object.entries(modulePermissions(module)).map(([id,scopes])=>({id,scopes})),services:Object.keys(props).map(action=>({name:module+'.records.'+action,permission:module+'.records.'+(action==='list'?'read':action),mutation:action!=='list',confirmation:action==='delete',input:{type:'object',properties:props[action],required:required[action],additionalProperties:false}})),routes:Object.keys(props).map(action=>({method:'POST',path:'/api/modules/'+module+'/'+action,service:module+'.records.'+action}))});
}
