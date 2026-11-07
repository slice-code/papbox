const main=document.querySelector('#main'), notice=document.querySelector('#notice');
let session, apps=[];
const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else if(key==='class')node.className=value;else if(key==='checked')node.checked=value;else node.setAttribute(key,value);}for(const child of children.flat())if(child!==null && child!==undefined)node.append(typeof child==='string'?document.createTextNode(child):child);return node;};
function message(value){notice.textContent=value;clearTimeout(message.timer);message.timer=setTimeout(()=>notice.textContent='',6000);}
async function api(path,body){const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok){if(response.status===401 && session?.user){session.user=null;auth();}throw Error(result.error);}return result;}
const service=(name,input={})=>api('services/'+name,input);
const button=(label,action)=>el('button',{type:'button',onclick:()=>Promise.resolve().then(action).catch(e=>message(e.message))},label);
function field(label,name,type='text',value=''){return el('label',{},label,el('input',{name,type,value,required:'',...(type==='password'?{minlength:'12',maxlength:'256',autocomplete:session?.setup?'new-password':'current-password'}:{maxlength:'160'})}));}
function form(fields,submit,label='Simpan'){const node=el('form',{},...fields,el('button',{type:'submit'},label));node.addEventListener('submit',async event=>{event.preventDefault();const b=node.querySelector('[type=submit]');b.disabled=true;try{await submit(Object.fromEntries(new FormData(node)));}catch(e){message(e.message);}finally{b.disabled=false;}});return node;}
function auth(){
 document.querySelector('#search-wrap').hidden=true;document.querySelector('#account').hidden=true;
 const setup=session.setup;
 const content=el('section',{class:'panel auth'},el('h1',{},setup?'Siapkan ruang kerja':'Selamat datang kembali'),el('p',{class:'muted'},setup?'Buat administrator pertama. Kata sandi minimal 12 karakter.':'Masuk ke tenant PAPbox Anda.'),form([...(setup?[field('Nama administrator','name')]:[field('ID tenant','tenant','text','default')]),field('Email','email','email'),field('Kata sandi','password','password')],async data=>{await api(setup?'setup':'login',data);await init();},setup?'Buat ruang kerja':'Masuk'));
 content.append(button('Gunakan token reset kata sandi',resetForm));
 if(setup)content.append(button('Masuk ke tenant yang sudah ada',()=>{session.setup=false;auth();}));
 main.replaceChildren(content);
}
function resetForm(){
 const p=el('section',{class:'panel auth'},el('h1',{},'Reset kata sandi'),el('p',{class:'muted'},'Minta token sekali pakai dari administrator tenant. Token berlaku 15 menit.'),form([field('Token reset','token'),field('Kata sandi baru','password','password')],async data=>{await api('reset',data);await init();message('Kata sandi diperbarui. Silakan masuk kembali.');},'Reset kata sandi'),button('Kembali masuk',auth));main.replaceChildren(p);
}
function roleField(role='member'){
 const select=el('select',{name:'role'},el('option',{value:'member'},'Anggota'),el('option',{value:'admin'},'Administrator'));select.value=role;return el('label',{},'Peran',select);
}
function showToken(data){
 const dialog=el('dialog',{},el('h2',{},'Token reset sekali pakai'),el('p',{},'Sampaikan melalui kanal privat yang terverifikasi. Jangan bagikan melalui kanal publik.'),el('label',{},'Token reset',el('input',{value:data.token,readonly:''})),el('p',{},'Berlaku sampai '+new Date(data.expires).toLocaleString('id-ID')),el('form',{method:'dialog'},el('button',{},'Tutup')));
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
async function init(){session=await api('session');if(!session.user)return auth();document.querySelector('#account').hidden=false;document.querySelector('#account').textContent=session.user.name+' · Keluar';await home();}
async function home(){apps=await service('launcher.read');document.querySelector('#search-wrap').hidden=false;document.querySelector('#search').value='';main.replaceChildren(el('div',{class:'intro'},el('h1',{},'Ruang kerja Anda'),el('p',{},'Semua aplikasi, dalam satu tempat.')),el('div',{class:'grid',id:'grid'}));renderGrid('');}
function renderGrid(query){const grid=document.querySelector('#grid');if(!grid)return;const matches=apps.filter(a=>a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));grid.replaceChildren(...matches.map(a=>buttonTile(a)));if(session.user.role==='admin')grid.append(buttonTile({id:'apps',name:'Tambah',icon:'+',color:'slate'}));if(!matches.length)grid.prepend(el('p',{class:'muted'},'Belum ada aplikasi yang cocok.'));}
function buttonTile(a){return el('button',{class:'tile',onclick:()=>open(a).catch(e=>message(e.message))},el('span',{class:'icon '+a.color,'aria-hidden':'true'},a.icon),el('span',{},a.name));}
function panel(title){document.querySelector('#search-wrap').hidden=true;const content=el('section',{class:'panel'},el('h1',{},title));main.replaceChildren(button('← Launcher',home),content);main.firstChild.classList.add('back');return content;}
async function open(a){
 const p=panel(a.name);
 if(a.id==='apps'){
  const list=await service('apps.list');p.append(el('p',{class:'muted'},'Kelola katalog bawaan dan paket deklaratif dari penerbit tepercaya. Modul bisnis bawaan belum menyediakan transaksi.'));
  for(const app of list){const actions=el('div',{class:'actions'});const change=async action=>{if(['install','uninstall'].includes(action)&&!confirm(action==='install'?`Pasang modul bawaan ${app.name}?`:`Hapus pendaftaran ${app.name}?`))return;await service('apps.change',{id:app.id,action,approved:true});message('Aplikasi diperbarui');await open(a);};
  if(!app.installed)actions.append(button('Pasang',()=>change('install')));else {actions.append(button(app.enabled?'Nonaktifkan':'Aktifkan',()=>change(app.enabled?'disable':'enable')),button('Hapus',()=>change('uninstall')));if(app.canRollback)actions.append(button('Rollback',async()=>{if(!confirm('Kembalikan versi paket sebelumnya?'))return;await service('packages.rollback',{id:app.id,approved:true});await open(a);message('Versi sebelumnya dipulihkan');}));}
  p.append(el('div',{class:'row'},el('div',{},el('strong',{},app.name+' · '+app.version),el('p',{class:'muted'},app.description),el('small',{},app.installed?(app.enabled?'Aktif':'Nonaktif'):'Belum terpasang')),actions));}
  p.append(el('h2',{},'Pasang atau update paket bertanda tangan'),el('p',{class:'muted'},'Paket deklaratif JSON dengan Ed25519; tidak mengeksekusi JavaScript atau HTML. Kunci penerbit ditetapkan operator.'),form([el('label',{},'File paket JSON',el('input',{name:'bundle',type:'file',accept:'.json,application/json',required:''}))],async data=>{
    if(data.bundle.size>65536)throw Error('Paket maksimal 64 KiB');
    let bundle;try{bundle=JSON.parse(await data.bundle.text());}catch{throw Error('JSON paket tidak valid');}
    const review=await service('packages.inspect',{bundle});
    if(!confirm(`Pasang/update ${review.manifest.name} v${review.manifest.version} dari ${review.publisher}?\nSHA-256: ${review.digest}\nPaket deklaratif; konten terlihat bagi anggota tenant.`))return;
    await service('packages.install',{bundle,approved:true});await open(a);message('Paket diverifikasi dan dipasang');
  },'Verifikasi paket'));
 }else if(a.id==='users'){
  const users=await service('users.list');
  for(const u of users)p.append(el('div',{class:'row'},el('div',{},el('strong',{},u.name),el('p',{},u.email+' · '+u.role+' · '+(u.active?'Aktif':'Nonaktif'))),el('div',{class:'actions'},button('Edit',()=>{
    const edit=panel('Edit pengguna');edit.append(form([field('Nama','name','text',u.name),field('Email','email','email',u.email),roleField(u.role),el('label',{},'Aktif',el('input',{type:'checkbox',name:'active',checked:u.active}))],async data=>{
      await service('users.update',{id:u.id,...data,active:data.active==='on'});
      if(u.id===session.user.id)await init();else await open(a);message('Pengguna diperbarui; sesi lama dicabut bila akses berubah');
    }));
  }),button('Reset kata sandi',async()=>{if(!confirm('Terbitkan token reset untuk '+u.email+'?'))return;showToken(await service('users.reset',{id:u.id,approved:true}));}))));
  p.append(el('h2',{},'Tambah pengguna'),form([field('Nama','name'),field('Email','email','email'),field('Kata sandi awal','password','password'),roleField()],async data=>{await service('users.create',data);message('Pengguna dibuat');await open(a);}));
 }else if(a.id==='account'){
  p.append(el('p',{},session.user.email+' · tenant '+session.user.tenant),el('h2',{},'Ganti kata sandi'),form([field('Kata sandi saat ini','currentPassword','password'),field('Kata sandi baru','password','password')],async data=>{await service('account.change-password',data);await init();message('Kata sandi diperbarui dan seluruh sesi dicabut. Silakan masuk kembali.');}),el('h2',{},'Keamanan sesi'),button('Keluar dari semua perangkat',async()=>{if(!confirm('Cabut semua sesi, termasuk perangkat ini?'))return;await service('account.revoke-sessions');await init();message('Semua sesi telah dicabut');}));
 }else if(a.id==='menus'){
  const menus=await service('menus.list');p.append(el('p',{class:'muted'},'Atur nama, urutan, dan visibilitas. Menyembunyikan menu tidak mengubah izin akses.'));
  for(const item of menus){const row=form([field('Nama','name','text',item.name),field('Urutan','order','number',String(item.order)),el('label',{},'Sembunyikan',el('input',{name:'hidden',type:'checkbox',checked:!!item.hidden}))],async data=>{await service('menus.save',{id:item.id,name:data.name,order:Number(data.order),hidden:data.hidden==='on'});message('Menu disimpan');});row.className='menu-row';p.append(row);}
 }else if(a.id==='settings'){
  const data=await service('settings.list');p.append(form([field('Nama ruang kerja','name','text',data.name)],async input=>{await service('settings.save',input);message('Pengaturan disimpan');}),el('h2',{},'Aktivitas administrator'));
  for(const entry of data.audit)p.append(el('p',{class:'muted'},new Date(entry.at).toLocaleString('id-ID')+' · '+entry.action));
 }else{const app=await service('apps.open',{id:a.id});p.append(el('p',{},app.description || 'Modul fondasi.'),el('p',{class:'module-content'},app.content || 'Aplikasi terdaftar melalui registri modul. Fitur transaksi bisnis akan dibangun pada tahap berikutnya.'));}
}
document.querySelector('#search').addEventListener('input',event=>renderGrid(event.target.value));
document.querySelector('#account').onclick=async()=>{try{await api('logout',{});await init();}catch(e){message(e.message);}};
document.querySelector('#help').onclick=()=>document.querySelector('#help-dialog').showModal();
function connection(){document.querySelector('#connection').textContent=navigator.onLine?'Online':'Offline · data privat tidak tersedia';}window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();const b=document.querySelector('#install');b.hidden=false;b.onclick=async()=>{await event.prompt();b.hidden=true;};});
let updateRequested=false;
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(reg=>{const offer=()=>{if(!reg.waiting || !navigator.serviceWorker.controller)return;const b=document.querySelector('#update');b.hidden=false;b.onclick=()=>{updateRequested=true;reg.waiting.postMessage({type:'ACTIVATE'});};};offer();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offer));navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested)location.reload();});}).catch(()=>message('PWA belum tersedia pada browser ini.'));
init().catch(e=>message(e.message));
