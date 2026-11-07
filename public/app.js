const main=document.querySelector('#main'), notice=document.querySelector('#notice');
let session, apps=[];
const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else if(key==='class')node.className=value;else if(key==='checked')node.checked=value;else node.setAttribute(key,value);}for(const child of children.flat())if(child!==null && child!==undefined)node.append(typeof child==='string'?document.createTextNode(child):child);return node;};
function message(value){notice.textContent=value;clearTimeout(message.timer);message.timer=setTimeout(()=>notice.textContent='',6000);}
async function api(path,body){const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok){if(response.status===401 && session?.user){session.user=null;auth();}throw Error(result.error);}return result;}
const service=(name,input={})=>api('services/'+name,input);
const button=(label,action)=>el('button',{type:'button',onclick:()=>Promise.resolve().then(action).catch(e=>message(e.message))},label);
function field(label,name,type='text',value=''){return el('label',{},label,el('input',{name,type,value,required:'',...(type==='password'?{minlength:'12',maxlength:'256',autocomplete:session?.setup?'new-password':'current-password'}:{maxlength:'160'})}));}
function form(fields,submit,label='Simpan'){const node=el('form',{},...fields,el('button',{type:'submit'},label));node.addEventListener('submit',async event=>{event.preventDefault();const b=node.querySelector('[type=submit]');b.disabled=true;try{await submit(Object.fromEntries(new FormData(node)));}catch(e){message(e.message);}finally{b.disabled=false;}});return node;}
function auth(){document.querySelector('#search-wrap').hidden=true;document.querySelector('#account').hidden=true;main.replaceChildren(el('section',{class:'panel auth'},el('h1',{},session.setup?'Siapkan ruang kerja':'Selamat datang kembali'),el('p',{class:'muted'},session.setup?'Buat administrator pertama. Kata sandi minimal 12 karakter.':'Masuk ke ruang kerja PAPbox Anda.'),form([...(session.setup?[field('Nama administrator','name')]:[]),field('Email','email','email'),field('Kata sandi','password','password')],async data=>{await api(session.setup?'setup':'login',data);await init();},session.setup?'Buat ruang kerja':'Masuk')));}
async function init(){session=await api('session');if(!session.user)return auth();document.querySelector('#account').hidden=false;document.querySelector('#account').textContent=session.user.name+' · Keluar';await home();}
async function home(){apps=await service('launcher.read');document.querySelector('#search-wrap').hidden=false;document.querySelector('#search').value='';main.replaceChildren(el('div',{class:'intro'},el('h1',{},'Ruang kerja Anda'),el('p',{},'Semua aplikasi, dalam satu tempat.')),el('div',{class:'grid',id:'grid'}));renderGrid('');}
function renderGrid(query){const grid=document.querySelector('#grid');if(!grid)return;const matches=apps.filter(a=>a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));grid.replaceChildren(...matches.map(a=>buttonTile(a)));if(session.user.role==='admin')grid.append(buttonTile({id:'apps',name:'Tambah',icon:'+',color:'slate'}));if(!matches.length)grid.prepend(el('p',{class:'muted'},'Belum ada aplikasi yang cocok.'));}
function buttonTile(a){return el('button',{class:'tile',onclick:()=>open(a).catch(e=>message(e.message))},el('span',{class:'icon '+a.color,'aria-hidden':'true'},a.icon),el('span',{},a.name));}
function panel(title){document.querySelector('#search-wrap').hidden=true;const content=el('section',{class:'panel'},el('h1',{},title));main.replaceChildren(button('← Launcher',home),content);main.firstChild.classList.add('back');return content;}
async function open(a){
 const p=panel(a.name);
 if(a.id==='apps'){
  const list=await service('apps.list');p.append(el('p',{class:'muted'},'Katalog bawaan yang ditinjau. Modul bisnis masih berupa fondasi; belum menyediakan transaksi.'));
  for(const app of list){const actions=el('div',{class:'actions'});const change=async action=>{if(['install','uninstall'].includes(action)&&!confirm(action==='install'?`Pasang modul bawaan ${app.name}?`:`Hapus pendaftaran ${app.name}?`))return;await service('apps.change',{id:app.id,action,approved:true});message('Aplikasi diperbarui');await open(a);};
  if(!app.installed)actions.append(button('Pasang',()=>change('install')));else actions.append(button(app.enabled?'Nonaktifkan':'Aktifkan',()=>change(app.enabled?'disable':'enable')),button('Hapus',()=>change('uninstall')));
  p.append(el('div',{class:'row'},el('div',{},el('strong',{},app.name),el('p',{class:'muted'},app.description),el('small',{},app.installed?(app.enabled?'Aktif':'Nonaktif'):'Belum terpasang')),actions));}
 }else if(a.id==='users'){
  const users=await service('users.list');for(const u of users)p.append(el('div',{class:'row'},el('strong',{},u.name),el('span',{},u.email+' · '+u.role)));
  p.append(el('h2',{},'Tambah pengguna'),form([field('Nama','name'),field('Email','email','email'),field('Kata sandi awal','password','password'),el('label',{},'Peran',el('select',{name:'role'},el('option',{value:'member'},'Anggota'),el('option',{value:'admin'},'Administrator')))],async data=>{await service('users.create',data);message('Pengguna dibuat');await open(a);}));
 }else if(a.id==='menus'){
  const menus=await service('menus.list');p.append(el('p',{class:'muted'},'Atur nama, urutan, dan visibilitas. Menyembunyikan menu tidak mengubah izin akses.'));
  for(const item of menus){const row=form([field('Nama','name','text',item.name),field('Urutan','order','number',String(item.order)),el('label',{},'Sembunyikan',el('input',{name:'hidden',type:'checkbox',checked:!!item.hidden}))],async data=>{await service('menus.save',{id:item.id,name:data.name,order:Number(data.order),hidden:data.hidden==='on'});message('Menu disimpan');});row.className='menu-row';p.append(row);}
 }else if(a.id==='settings'){
  const data=await service('settings.list');p.append(form([field('Nama ruang kerja','name','text',data.name)],async input=>{await service('settings.save',input);message('Pengaturan disimpan');}),el('h2',{},'Aktivitas administrator'));
  for(const entry of data.audit)p.append(el('p',{class:'muted'},new Date(entry.at).toLocaleString('id-ID')+' · '+entry.action));
 }else{p.append(el('p',{},a.description || 'Modul fondasi.'),el('p',{class:'muted'},'Aplikasi terdaftar melalui registri modul. Fitur transaksi bisnis akan dibangun pada tahap berikutnya.'));}
}
document.querySelector('#search').addEventListener('input',event=>renderGrid(event.target.value));
document.querySelector('#account').onclick=async()=>{try{await api('logout',{});await init();}catch(e){message(e.message);}};
document.querySelector('#help').onclick=()=>document.querySelector('#help-dialog').showModal();
function connection(){document.querySelector('#connection').textContent=navigator.onLine?'Online':'Offline · data privat tidak tersedia';}window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();const b=document.querySelector('#install');b.hidden=false;b.onclick=async()=>{await event.prompt();b.hidden=true;};});
let updateRequested=false;
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(reg=>{const offer=()=>{if(!reg.waiting)return;const b=document.querySelector('#update');b.hidden=false;b.onclick=()=>{updateRequested=true;reg.waiting.postMessage({type:'ACTIVATE'});};};offer();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offer));navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested)location.reload();});}).catch(()=>message('PWA belum tersedia pada browser ini.'));
init().catch(e=>message(e.message));
