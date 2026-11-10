const id={type:'string',minLength:36,maxLength:36},integer=(minimum,maximum)=>({type:'integer',minimum,maximum}),string=maxLength=>({type:'string',minLength:1,maxLength}),bool={type:'boolean'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const lines=withRevision=>({type:'array',maxItems:100,items:object({productId:id,quantity:integer(1,1000),...(withRevision?{revision:integer(1,2147483647)}:{})},['productId','quantity',...(withRevision?['revision']:[])])});
export const permissions={'pos.open':['all'],'pos.products.read':['all'],'pos.products.manage':['all'],'pos.sales.create':['own','all'],'pos.sales.read':['own','all'],'pos.sales.void':['own','all']};
const specs={
 'pos.products.list':['pos.products.read',false,false,object({q:{type:'string',maxLength:120},includeInactive:bool,limit:integer(1,100),cursor:{type:'string',maxLength:36}})],
 'pos.products.get':['pos.products.read',false,false,object({id},['id'])],
 'pos.products.create':['pos.products.manage',true,false,object({sku:string(40),name:string(120),price:integer(0,1000000000)},['sku','name','price'])],
 'pos.products.update':['pos.products.manage',true,false,object({id,revision:integer(1,2147483647),name:string(120),price:integer(0,1000000000),active:bool},['id','revision','name','price','active'])],
 'pos.quote':['pos.products.read',false,false,object({items:lines(false)},['items'])],
 'pos.sales.resolve':['pos.sales.create',false,false,object({requestId:id},['requestId'])],
 'pos.checkout':['pos.sales.create',true,true,object({requestId:id,items:lines(true),tendered:integer(0,1000000000000),approved:bool},['requestId','items','tendered','approved'])],
 'pos.sales.list':['pos.sales.read',false,false,object({limit:integer(1,100),cursor:{type:'string',maxLength:256}})],
 'pos.sales.get':['pos.sales.read',false,false,object({id},['id'])],
 'pos.sales.void':['pos.sales.void',true,true,object({id,revision:integer(1,2147483647),reason:{type:'string',minLength:3,maxLength:300},approved:bool},['id','revision','reason','approved'])]
};
export const posContract={id:'pos',version:'1.0.0',api:1,dependencies:[],permissions:Object.entries(permissions).map(([id,scopes])=>({id,scopes})),services:Object.entries(specs).map(([name,[permission,mutation,confirmation,input]])=>({name,permission,mutation,confirmation,input})),routes:Object.keys(specs).map(service=>({method:'POST',path:'/api/services/'+service,service}))};
export const posApp={id:'pos',version:'1.0.0',name:'POS',icon:'▣',color:'blue',description:'Kasir tunai, katalog produk, struk, dan riwayat penjualan.'};
