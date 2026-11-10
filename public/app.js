import {nativeViews} from './native-apps.js';
const main=document.querySelector('#main'), notice=document.querySelector('#notice');
let session, apps=[];
const can=permission=>Boolean(session?.user?.permissions?.[permission]);
const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else if(key==='class')node.className=value;else if(key==='checked')node.checked=value;else node.setAttribute(key,value);}for(const child of children.flat())if(child!==null && child!==undefined)node.append(typeof child==='string'?document.createTextNode(child):child);return node;};
function message(value){notice.textContent=value;clearTimeout(message.timer);message.timer=setTimeout(()=>notice.textContent='',6000);}
async function api(path,body){const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok){if(response.status===401 && session?.user){session.user=null;auth();}throw Error(result.error);}return result;}
const service=(name,input={})=>api('services/'+name,input);
const button=(label,action)=>el('button',{type:'button',onclick:()=>Promise.resolve().then(action).catch(e=>message(e.message))},label);
function field(label,name,type='text',value=''){return el('label',{},label,el('input',{name,type,value,required:'',...(type==='password'?{minlength:'12',maxlength:'256',autocomplete:session?.setup?'new-password':'current-password'}:{maxlength:'160'})}));}
function form(fields,submit,label='Simpan'){const node=el('form',{},...fields,el('button',{type:'submit'},label));node.addEventListener('submit',async event=>{event.preventDefault();const b=node.querySelector('[type=submit]');b.disabled=true;try{await submit(Object.fromEntries(new FormData(node)));}catch(e){message(e.message);}finally{b.disabled=false;}});return node;}
function auth(){
 document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
 document.querySelector('#search-wrap').hidden=true;document.querySelector('#account').hidden=true;
 const setup=session.setup;
 const content=el('section',{class:'panel auth'},el('h1',{},setup?'Siapkan ruang kerja':'Selamat datang kembali'),el('p',{class:'muted'},setup?'Buat administrator pertama. Kata sandi minimal 12 karakter.':'Masuk ke tenant PAPbox Anda.'),form([...(setup?[field('Nama administrator','name')]:[field('ID tenant','tenant','text','default')]),field('Email','email','email'),field('Kata sandi','password','password'),...(!setup?[el('label',{},'Kode MFA atau recovery (jika aktif)',el('input',{name:'code',maxlength:'32',autocomplete:'one-time-code'}))]:[])],async data=>{await api(setup?'setup':'login',data);await init();},setup?'Buat ruang kerja':'Masuk'));
 content.append(button('Gunakan token reset kata sandi',()=>resetForm()));
 if(session.emailRecovery)content.append(button('Minta pemulihan lewat email',()=>{const p=panel('Pemulihan email');p.append(form([field('ID tenant','tenant','text','default'),field('Email','email','email')],async input=>{const result=await api('forgot',input);message(result.message);auth();},'Kirim permintaan'),button('Kembali masuk',auth));}));
 if(setup)content.append(button('Masuk ke tenant yang sudah ada',()=>{session.setup=false;auth();}));
 main.replaceChildren(content);
}
function resetForm(token=''){
 const p=el('section',{class:'panel auth'},el('h1',{},'Reset kata sandi'),el('p',{class:'muted'},'Minta token sekali pakai dari administrator tenant. Token berlaku 15 menit.'),form([field('Token reset','token','text',token),field('Kata sandi baru','password','password')],async data=>{await api('reset',data);await init();message('Kata sandi diperbarui. Silakan masuk kembali.');},'Reset kata sandi'),button('Kembali masuk',auth));main.replaceChildren(p);
}
function roleField(role='member'){
 const select=el('select',{name:'role','aria-label':'Peran'},...(session.roles||[]).map(role=>el('option',{value:role.id},role.name)));select.value=role;return el('label',{},'Peran',select);
}
function showToken(data){
 const dialog=el('dialog',{},el('h2',{},'Token reset sekali pakai'),el('p',{},'Sampaikan melalui kanal privat yang terverifikasi. Jangan bagikan melalui kanal publik.'),el('label',{},'Token reset',el('input',{value:data.token,readonly:''})),el('p',{},'Berlaku sampai '+new Date(data.expires).toLocaleString('id-ID')),el('form',{method:'dialog'},el('button',{},'Tutup')));
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
async function init(){session=await api('session');const reset=new URLSearchParams(location.hash.slice(1)).get('reset');if(reset){history.replaceState(null,'',location.pathname);return resetForm(reset);}if(!session.user)return auth();document.querySelector('#account').hidden=false;document.querySelector('#account').textContent=session.user.name+' · Keluar';await home(false);}
async function home(refresh=true){if(refresh){session=await api('session');if(!session.user)return auth();}apps=await service('launcher.read');document.querySelector('#search-wrap').hidden=false;document.querySelector('#search').value='';main.replaceChildren(el('div',{class:'intro'},el('h1',{},'Ruang kerja Anda'),el('p',{},'Semua aplikasi, dalam satu tempat.')),el('div',{class:'grid',id:'grid'}));renderGrid('');}
function renderGrid(query){const grid=document.querySelector('#grid');if(!grid)return;const matches=apps.filter(a=>a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));grid.replaceChildren(...matches.map(a=>buttonTile(a)));if(session.user.role==='admin')grid.append(buttonTile({id:'apps',name:'Tambah',icon:'+',color:'slate'}));if(!matches.length)grid.prepend(el('p',{class:'muted'},'Belum ada aplikasi yang cocok.'));}
function buttonTile(a){return el('button',{class:'tile',onclick:()=>open(a).catch(e=>message(e.message))},el('span',{class:'icon '+a.color,'aria-hidden':'true'},a.icon),el('span',{},a.name));}
function panel(title){document.querySelector('#search-wrap').hidden=true;const content=el('section',{class:'panel'},el('h1',{},title));main.replaceChildren(button('← Launcher',home),content);main.firstChild.classList.add('back');return content;}
async function open(a){
 const p=panel(a.name);
 if(a.id==='apps'){
  const list=await service('apps.list');p.append(el('p',{class:'muted'},'Kelola katalog bawaan dan paket deklaratif dari penerbit tepercaya. POS menyediakan kasir tunai; Inventory, CRM dan Invoice masih berupa fondasi.'));
  for(const app of list){const actions=el('div',{class:'actions'});const change=async action=>{if(['install','uninstall'].includes(action)&&!confirm(action==='install'?`Pasang modul bawaan ${app.name}?`:`Hapus pendaftaran ${app.name}?`))return;await service('apps.change',{id:app.id,action,approved:true});message('Aplikasi diperbarui');await open(a);};
  if(!app.installed && can('apps.install'))actions.append(button('Pasang',()=>change('install')));else if(app.installed){if(can('apps.'+(app.enabled?'disable':'enable')))actions.append(button(app.enabled?'Nonaktifkan':'Aktifkan',()=>change(app.enabled?'disable':'enable')));if(can('apps.uninstall'))actions.append(button('Hapus',()=>change('uninstall')));if(app.canRollback && can('apps.rollback'))actions.append(button('Rollback',async()=>{if(!confirm('Kembalikan versi paket sebelumnya?'))return;await service('packages.rollback',{id:app.id,approved:true});await open(a);message('Versi sebelumnya dipulihkan');}));}
  p.append(el('div',{class:'row'},el('div',{},el('strong',{},app.name+' · '+app.version),el('p',{class:'muted'},app.description),el('small',{},app.installed?(app.enabled?'Aktif':'Nonaktif'):'Belum terpasang')),actions));}
  if(can('apps.install'))p.append(el('h2',{},'Pasang atau update paket bertanda tangan'),el('p',{class:'muted'},'Paket deklaratif JSON dengan Ed25519; tidak mengeksekusi JavaScript atau HTML. Kunci penerbit ditetapkan operator.'),form([el('label',{},'File paket JSON',el('input',{name:'bundle',type:'file',accept:'.json,application/json',required:''}))],async data=>{
    if(data.bundle.size>65536)throw Error('Paket maksimal 64 KiB');
    let bundle;try{bundle=JSON.parse(await data.bundle.text());}catch{throw Error('JSON paket tidak valid');}
    const review=await service('packages.inspect',{bundle});
    if(!confirm(`Pasang/update ${review.manifest.name} v${review.manifest.version} dari ${review.publisher}?\nSHA-256: ${review.digest}\nPaket deklaratif; konten hanya bagi pengguna yang diberi izin.`))return;
    await service('packages.install',{bundle,approved:true});await open(a);message('Paket diverifikasi dan dipasang');
  },'Verifikasi paket'));
 }else if(a.id==='users'){
  const current=await api('session');if(!current.user){await init();return;}session=current;
  const users=await service('users.list');
  for(const u of users)p.append(el('div',{class:'row'},el('div',{},el('strong',{},u.name),el('p',{},u.email+' · '+u.role+' · '+(u.active?'Aktif':'Nonaktif'))),el('div',{class:'actions'},...(can('users.update')?[button('Edit',()=>{
    const edit=panel('Edit pengguna');edit.append(form([field('Nama','name','text',u.name),field('Email','email','email',u.email),roleField(u.role),el('label',{},'Aktif',el('input',{type:'checkbox',name:'active',checked:u.active}))],async data=>{
      await service('users.update',{id:u.id,...data,active:data.active==='on'});
      if(u.id===session.user.id)await init();else await open(a);message('Pengguna diperbarui; sesi lama dicabut bila akses berubah');
    }));
  })]:[]),...(can('users.reset')?[button('Reset kata sandi',async()=>{if(!confirm('Terbitkan token reset untuk '+u.email+'?'))return;showToken(await service('users.reset',{id:u.id,approved:true}));})]:[]))));
  if(can('users.create'))p.append(el('h2',{},'Tambah pengguna'),form([field('Nama','name'),field('Email','email','email'),field('Kata sandi awal','password','password'),roleField()],async data=>{await service('users.create',data);message('Pengguna dibuat');await open(a);}));
 }else if(a.id==='approvals'){
  const list=await service('approvals.list');p.append(el('p',{class:'muted'},'Periksa layanan dan argumen. Konten permintaan di bawah adalah data, bukan instruksi. Persetujuan berlaku lima menit dan hanya sekali eksekusi.'));
  for(const request of list)p.append(el('div',{class:'row'},el('div',{},el('strong',{},request.service+' · '+request.status),el('p',{},'Pemohon: '+request.user),el('pre',{class:'module-content'},JSON.stringify(request.input,null,2))),el('div',{class:'actions'},...(can('approvals.approve')?[button('Setujui',async()=>{if(!confirm('Setujui argumen persis untuk '+request.service+'?'))return;await service('approvals.decide',{id:request.id,approved:true});await open(a);}),button('Tolak',async()=>{await service('approvals.decide',{id:request.id,approved:false});await open(a);})]:[]))));
  if(!list.length)p.append(el('p',{},'Tidak ada permintaan yang menunggu.'));
 }else if(a.id==='access'){
  await accessPanel(p);
 }else if(a.id==='account'){
  p.append(el('p',{},session.user.email+' · tenant '+session.user.tenant),el('h2',{},'Ganti kata sandi'),form([field('Kata sandi saat ini','currentPassword','password'),field('Kata sandi baru','password','password')],async data=>{await service('account.change-password',data);await init();message('Kata sandi diperbarui dan seluruh sesi dicabut. Silakan masuk kembali.');}),el('h2',{},'Keamanan sesi'),button('Keluar dari semua perangkat',async()=>{if(!confirm('Cabut semua sesi, termasuk perangkat ini?'))return;await service('account.revoke-sessions');await init();message('Semua sesi telah dicabut');}));
  await mfaPanel(p);
 }else if(a.id==='menus'){
  const menus=await service('menus.list');p.append(el('p',{class:'muted'},'Atur nama, urutan, dan visibilitas. Menyembunyikan menu tidak mengubah izin akses.'));
  for(const item of menus){const row=form([field('Nama','name','text',item.name),field('Urutan','order','number',String(item.order)),el('label',{},'Sembunyikan',el('input',{name:'hidden',type:'checkbox',checked:!!item.hidden}))],async data=>{await service('menus.save',{id:item.id,name:data.name,order:Number(data.order),hidden:data.hidden==='on'});message('Menu disimpan');});row.className='menu-row';if(!can('menus.update')){row.querySelectorAll('input,button').forEach(node=>node.disabled=true);}p.append(row);}
 }else if(a.id==='settings'){
  const data=await service('settings.list');if(can('settings.update'))p.append(form([field('Nama ruang kerja','name','text',data.name)],async input=>{await service('settings.save',input);message('Pengaturan disimpan');}));else p.append(el('p',{},data.name));if(can('backups.export'))backupPanel(p);if(can('mail.read'))await mailPanel(p);p.append(el('h2',{},'Aktivitas administrator'));
  for(const entry of data.audit)p.append(el('p',{class:'muted'},new Date(entry.at).toLocaleString('id-ID')+' · '+entry.action));
 }else if(nativeViews[a.id]){await nativeViews[a.id]({container:p,service,can,user:session.user,el,button,form,field,notify:message});
 }else{const app=await service('apps.open',{id:a.id});p.append(el('p',{},app.description || 'Modul fondasi.'),el('p',{class:'module-content'},app.content || 'Aplikasi terdaftar melalui registri modul. Fitur transaksi bisnis akan dibangun pada tahap berikutnya.'));if(app.model)await recordsPanel(p,app);}
}
document.querySelector('#search').addEventListener('input',event=>renderGrid(event.target.value));
document.querySelector('#account').onclick=async()=>{try{await api('logout',{});await init();}catch(e){message(e.message);}};
document.querySelector('#help').onclick=()=>document.querySelector('#help-dialog').showModal();
function connection(){document.querySelector('#connection').textContent=navigator.onLine?'Online':'Offline · data privat tidak tersedia';}window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();const b=document.querySelector('#install');b.hidden=false;b.onclick=async()=>{await event.prompt();b.hidden=true;};});
let updateRequested=false;
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(reg=>{const offer=()=>{if(!reg.waiting || !navigator.serviceWorker.controller)return;const b=document.querySelector('#update');b.hidden=false;b.onclick=()=>{updateRequested=true;reg.waiting.postMessage({type:'ACTIVATE'});};};offer();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offer));navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested)location.reload();});}).catch(()=>message('PWA belum tersedia pada browser ini.'));
init().catch(e=>message(e.message));
async function accessPanel(p){
 const data=await service('roles.list');
 const editor=role=>{
  const target=panel(role?'Edit peran':'Buat peran');
  const selects=Object.entries(data.permissions).map(([id,scopes])=>{
   const select=el('select',{name:'grant:'+id,'aria-label':id},el('option',{value:''},'Tidak diizinkan'),...scopes.map(scope=>el('option',{value:scope},scope==='own'?'Data milik sendiri':'Seluruh tenant')));select.value=role?.permissions[id]||'';return el('label',{},id,select);
  });
  const idField=field('ID peran','id','text',role?.id||'');if(role)idField.querySelector('input').readOnly=true;
  target.append(form([idField,field('Nama peran','name','text',role?.name||''),...selects],async input=>{
   const permissions=Object.fromEntries(Object.entries(input).filter(([key,value])=>key.startsWith('grant:')&&value).map(([key,value])=>[key.slice(6),value]));
   if(!confirm('Simpan hak akses dan cabut sesi pengguna peran ini?'))return;
   await service('roles.save',{id:input.id,name:input.name,permissions,approved:true});if(session.user.role===input.id)await init();else await open({id:'access',name:'Hak Akses'});message('Peran disimpan');
  }));
 };
 for(const role of data.roles)p.append(el('div',{class:'row'},el('div',{},el('strong',{},role.name),el('p',{class:'muted'},role.id+(role.builtin?' · bawaan':'')),el('p',{},Object.entries(role.permissions).map(([id,scope])=>id+' ('+scope+')').join(', ')||'Hanya akses akun dasar')),el('div',{class:'actions'},...(!role.builtin&&data.canManage?[button('Edit',()=>editor(role)),button('Hapus',async()=>{if(!confirm('Hapus peran '+role.name+'?'))return;await service('roles.delete',{id:role.id,approved:true});await open({id:'access',name:'Hak Akses'});})]:[]))));
 if(data.canManage)p.append(button('Buat peran',()=>editor(null)));
}
async function recordsPanel(p,app){
 const allowed=app.recordAccess,fields=app.model.properties;
 const edit=(record)=>{
  const target=panel(record?'Edit '+app.name:'Tambah '+app.name);
  const nodes=Object.entries(fields).map(([name,schema])=>{
   const attrs={name,...(app.model.required.includes(name)?{required:''}:{})};let input;
   if(schema.enum){input=el('select',{...attrs,'aria-label':name},...schema.enum.map(value=>el('option',{value:String(value)},String(value))));if(record)input.value=String(record.data[name]??'');}
   else if(schema.type==='boolean')input=el('input',{name,type:'checkbox',checked:!!record?.data[name]});
   else if(['object','array','json'].includes(schema.type))input=el('textarea',attrs,record?.data[name]!==undefined?JSON.stringify(record.data[name]):'');
   else input=el('input',{...attrs,type:['number','integer'].includes(schema.type)?'number':'text',value:record?.data[name]??'',...(schema.type==='integer'?{step:'1'}:{}),...(schema.maxLength!==undefined?{maxlength:schema.maxLength}:{})});
   return el('label',{},name,input);
  });
  target.append(form(nodes,async values=>{
   const data={};for(const [name,schema] of Object.entries(fields)){
    if(schema.type==='boolean'){data[name]=schema.enum?values[name]==='true':values[name]==='on';continue;}
    if(values[name]===''&&!app.model.required.includes(name))continue;
    if(['integer','number'].includes(schema.type))data[name]=Number(values[name]);
    else if(['object','array','json'].includes(schema.type)){try{data[name]=JSON.parse(values[name]);}catch{throw Error('JSON tidak valid untuk '+name);}}
    else data[name]=values[name];
   }
   await service(record?'records.update':'records.create',{module:app.id,data,...(record?{id:record.id,revision:record.revision}:{})});await open(app);message('Data disimpan');
  }));
 };
 p.append(el('h2',{},'Data aplikasi'));if(allowed.create)p.append(button('Tambah data',()=>edit(null)));
 if(!allowed.read)return;
 const list=el('div',{});p.append(list);
 const load=async cursor=>{
  const page=await service('records.list',{module:app.id,...(cursor?{cursor}:{})});
  for(const row of page.items){
   const own=row.owner===session.user.id;
   list.append(el('div',{class:'row'},el('div',{},...Object.entries(row.data).map(([key,value])=>el('p',{},key+': '+(typeof value==='object'?JSON.stringify(value):String(value))))),el('div',{class:'actions'},...(allowed.update==='all'||allowed.update==='own'&&own?[button('Edit',()=>edit(row))]:[]),...(allowed.delete==='all'||allowed.delete==='own'&&own?[button('Hapus',async()=>{if(!confirm('Hapus data ini?'))return;await service('records.delete',{module:app.id,id:row.id,revision:row.revision,approved:true});await open(app);})]:[]))));
  }
  if(page.nextCursor){const more=button('Muat berikutnya',async()=>{more.remove();await load(page.nextCursor);});list.append(more);}
  if(!cursor&&!page.items.length)list.append(el('p',{class:'muted'},'Belum ada data yang dapat diakses.'));
 };
 await load(null);
}
function secretDialog(title,body){
 const dialog=el('dialog',{},el('h2',{},title),...body,el('form',{method:'dialog'},el('button',{},'Tutup')));document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;
}
async function mfaPanel(p){
 const status=await service('account.mfa-status');p.append(el('h2',{},'Autentikasi dua faktor'));
 if(!status.configured&&!status.enabled){p.append(el('p',{class:'muted'},'Operator perlu mengatur kunci enkripsi MFA sebelum fitur diaktifkan.'));return;}
 if(status.enabled){
  p.append(el('p',{},'MFA aktif. Kode pemulihan tersisa: '+status.recoveryCodesRemaining),form([field('Kata sandi untuk menonaktifkan MFA','currentPassword','password'),field('Kode MFA atau recovery','code')],async input=>{if(!confirm('Nonaktifkan MFA dan cabut seluruh sesi?'))return;await service('account.mfa-disable',input);await init();message('MFA dinonaktifkan; silakan masuk kembali.');},'Nonaktifkan MFA'));return;
 }
 p.append(form([field('Kata sandi untuk mengaktifkan MFA','currentPassword','password')],async input=>{
  const pending=await service('account.mfa-begin',input);
  const dialog=secretDialog('Daftarkan authenticator',[el('p',{},'Masukkan secret ini ke aplikasi authenticator. Jangan bagikan secret atau kode pemulihan.'),el('label',{},'Secret authenticator',el('input',{readonly:'',value:pending.secret})),el('p',{class:'module-content'},pending.uri),form([field('Kode enam digit','code')],async values=>{
   const result=await service('account.mfa-confirm',values);dialog.close();await init();secretDialog('Simpan kode pemulihan',[el('p',{},'Kode ditampilkan sekali. Simpan secara privat. Gunakan kode authenticator berikutnya atau satu recovery code untuk login.'),el('textarea',{readonly:'',rows:'11'},result.recoveryCodes.join('\n'))]);
  },'Konfirmasi MFA')]);
 },'Daftarkan MFA'));
}

function backupPanel(p){
 p.append(el('h2',{},'Backup data'),el('p',{},'Unduh backup lengkap tenant ini, termasuk data aplikasi, pengguna, pengaturan, dan audit.'),el('p',{class:'muted'},'File berisi data sensitif. Simpan secara privat dan amankan bersama backup kunci MFA secara terpisah. Pemulihan penuh dilakukan oleh operator ke tenant yang belum ada.'));
 const node=form([field('Kata sandi untuk backup','currentPassword','password'),el('label',{},'Kode MFA atau recovery untuk backup (jika aktif)',el('input',{name:'code',maxlength:'32',autocomplete:'one-time-code'}))],async input=>{
  if(!confirm('Unduh seluruh data tenant ini sebagai file backup sensitif?'))return;
  try{
   const response=await fetch('/api/services/backups.export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,approved:true})});
   if(!response.ok){const error=await response.json();if(response.status===401)await init();throw Error(error.error);}
   const blob=await response.blob(),url=URL.createObjectURL(blob),filename=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')||'')?.[1]||'papbox-backup.json';
   const link=el('a',{href:url,download:filename});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Backup berhasil diunduh. Simpan di lokasi privat.');
  }finally{node.reset();}
 },'Unduh backup');p.append(node);
}

async function mailPanel(p){
 const status=await service('mail.status');p.append(el('h2',{},'Pengiriman email'),el('p',{},status.emailEnabled?'Pemulihan email diaktifkan.':'Pemulihan email belum diaktifkan oleh operator.'),el('p',{class:'muted'},status.workerSeenAt?'Worker terakhir aktif: '+new Date(status.workerSeenAt).toLocaleString('id-ID')+(status.workerRecent?'':' · periksa worker jika ada antrean.'): 'Worker belum melaporkan aktivitas untuk tenant ini.'),el('p',{},Object.entries(status.counts).map(([state,count])=>state+': '+count).join(' · ')));
 for(const job of status.jobs)p.append(el('div',{class:'row'},el('div',{},el('strong',{},job.status+' · '+job.attempts+' percobaan'),el('p',{class:'muted'},job.id),el('p',{},job.lastError||'Tidak ada error')),...(job.status==='dead'&&can('mail.manage')?[button('Coba ulang email',async()=>{if(!confirm('Jadwalkan ulang pengiriman ini jika token masih berlaku?'))return;await service('mail.retry',{id:job.id,approved:true});await open({id:'settings',name:'Pengaturan'});message('Pengiriman dijadwalkan ulang');})]:[])));
}
