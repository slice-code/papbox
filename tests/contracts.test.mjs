import test from 'node:test';
import assert from 'node:assert/strict';
import {Kernel} from '../core/kernel.mjs';
const contract={id:'example',version:'1.0.0',api:1,dependencies:[],permissions:[{id:'example.add',scopes:['all']}],services:[{name:'example.add',permission:'example.add',mutation:true,confirmation:false,input:{type:'object',properties:{value:{type:'integer',minimum:0,maximum:10}},required:['value'],additionalProperties:false}}],routes:[{method:'POST',path:'/api/example/add',service:'example.add'}]};
test('module contracts validate input, declare routing, reject incompatible dependencies and publish atomically',async()=>{
 const malformed=structuredClone(contract);malformed.services[0].input.properties=42;assert.throws(()=>new Kernel().install(malformed,{'example.add':()=>1}),{status:400});
 const kernel=new Kernel();kernel.install(contract,{'example.add':(_ctx,input)=>input.value+1});
 assert.equal(await kernel.invoke('example.add',{tenant:'t',user:'u',permissions:['example.add']},{value:2}),3);
 await assert.rejects(kernel.invoke('example.add',{tenant:'t',user:'u',permissions:[]},{value:2}),{status:403});
 await assert.rejects(kernel.invoke('example.add',{tenant:'t',user:'u',permissions:['example.add']},{value:2,script:'unexpected'}),{status:400});
 assert.equal(kernel.routes.get('POST /api/example/add'),'example.add');
 const child={...contract,id:'child',dependencies:[{id:'example',version:'2.0.0'}],services:[{...contract.services[0],name:'child.add'}],routes:[{method:'POST',path:'/api/child/add',service:'child.add'}]};
 assert.throws(()=>kernel.install(child,{'child.add':()=>1}),{status:409});assert(!kernel.services.has('child.add'));assert(!kernel.modules.has('child'));
 const duplicate={...child,dependencies:[],routes:[...child.routes,contract.routes[0]]};assert.throws(()=>kernel.install(duplicate,{'child.add':()=>1}));assert(!kernel.services.has('child.add'));
});
