const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
export async function renderPos({container,service,can,user,el,button,form,field,notify}){
 const cart=new Map();let selected=null,mode='quantity',digits='',fresh=true;let requestId=crypto.randomUUID(),submitting=false,uncertain=false;
 const nav=el('nav',{class:'pos-nav','aria-label':'Navigasi POS'}),body=el('div',{class:'pos-workspace'});
 container.classList.add('pos-app');container.append(el('p',{class:'muted'},'Kasir tunai · IDR'),nav,body);
 const total=()=>[...cart.values()].reduce((sum,line)=>sum+net(line),0);
 const net=line=>line.unitPrice*line.quantity-Number((BigInt(line.unitPrice*line.quantity)*BigInt(line.discountBps||0)+5000n)/10000n);
 const lineInput=({productId,quantity,revision,unitPrice,catalogPrice,discountBps})=>({productId,quantity,revision,...(catalogPrice!==undefined&&unitPrice!==catalogPrice?{unitPrice}:{}),...(discountBps?{discountBps}:{})});
 const photo=product=>{const node=el('span',{class:'pos-photo pos-photo-'+(product.imageKey??0),'aria-hidden':'true'});if(product.hasPhoto)service('pos.products.photo',{id:product.id}).then(({photo})=>{if(!photo||!node.isConnected)return;const bytes=Uint8Array.from(atob(photo.split(',')[1]),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})),img=el('img',{src:url,alt:''});img.addEventListener('load',()=>URL.revokeObjectURL(url),{once:true});img.addEventListener('error',()=>URL.revokeObjectURL(url),{once:true});node.append(img);}).catch(()=>{});return node;};
 const changed=()=>{requestId=crypto.randomUUID();};
 function receipt(sale){
  if(!container.isConnected)return;
  const dialog=el('dialog',{class:'pos-receipt-dialog'},el('article',{class:'pos-receipt'},el('h2',{},'Struk penjualan'),el('p',{class:'pos-number'},sale.number),el('p',{},new Date(sale.createdAt).toLocaleString('id-ID')),el('p',{},'Kasir: '+sale.cashierName),el('strong',{},sale.status==='void'?'DIBATALKAN':'LUNAS'),...sale.items.map(line=>el('div',{class:'pos-receipt-line'},el('div',{},el('strong',{},line.name),el('small',{},line.sku+' · '+line.quantity+' × '+money(line.unitPrice))),el('span',{},money(line.lineTotal)))),...(sale.discountTotal?[el('p',{class:'pos-receipt-line'},'Subtotal',money(sale.subtotal)),el('p',{class:'pos-receipt-line'},'Diskon',money(sale.discountTotal))]:[]),el('hr',{}),el('p',{class:'pos-receipt-line'},'Total',money(sale.total)),el('p',{class:'pos-receipt-line'},'Tunai',money(sale.tendered)),el('p',{class:'pos-receipt-line'},'Kembalian',money(sale.change)),...(sale.status==='void'?[el('p',{},'Alasan: '+sale.voidReason)]:[])),el('div',{class:'actions pos-no-print'},button('Cetak struk',()=>{document.body.classList.add('printing-pos');try{window.print();}finally{document.body.classList.remove('printing-pos');}}),el('form',{method:'dialog'},el('button',{},'Tutup'))));
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
 }
 async function cashier(){
  body.replaceChildren();const products=el('section',{class:'pos-products'},el('h2',{},'Produk')),basket=el('section',{class:'pos-basket','aria-label':'Keranjang belanja'});body.append(products,basket);
  let category='',loadVersion=0;const categories=el('div',{class:'pos-categories','aria-label':'Kategori produk'});const search=el('input',{type:'search',placeholder:'Cari nama atau SKU','aria-label':'Cari produk POS'}),results=el('div',{class:'pos-product-grid'}),searchForm=el('form',{class:'pos-search'},search,el('button',{type:'submit'},'Cari'));products.append(searchForm,categories,results);
  const load=async(cursor)=>{
   if(!can('pos.products.read')){results.replaceChildren(el('p',{},'Izin membaca katalog produk diperlukan.'));return;}
   const version=++loadVersion;const page=await service('pos.products.list',{q:search.value,category,...(cursor?{cursor}:{})});if(version!==loadVersion||!results.isConnected)return;if(!cursor)results.replaceChildren();
   for(const product of page.items){
    const categoryName=product.category||'Umum';
    const card=el('button',{class:'pos-product',type:'button',onclick:()=>{
     if(submitting||uncertain)return;const old=cart.get(product.id);if(old&&old.quantity>=1000){notify('Jumlah maksimal 1000 per produk');return;}
     if(!old&&cart.size>=100){notify('Maksimal 100 baris produk per transaksi');return;}
     if(old)old.quantity++;else cart.set(product.id,{productId:product.id,revision:product.revision,sku:product.sku,name:product.name,imageKey:product.imageKey??0,catalogPrice:product.price,unitPrice:product.price,quantity:1});selected=product.id;fresh=true;changed();drawBasket();
    }},photo(product),el('span',{class:'pos-product-info'},el('strong',{},product.name),el('small',{},product.sku),el('span',{},money(product.price))));card.dataset.category=categoryName;results.append(card);
   }
   filter();
   if(!page.items.length&&!cursor)results.append(el('p',{class:'muted'},'Belum ada produk yang cocok. Pengelola dapat menambah produk pada tab Produk.'));
   if(page.nextCursor){const more=button('Muat produk berikutnya',async()=>{more.remove();await load(page.nextCursor);});results.append(more);}
  };
  function filter(){for(const chip of categories.children)chip.setAttribute('aria-pressed',String(chip.dataset.category===category));}
  for(const name of ['',...await service('pos.products.categories')]){const chip=button(name||'Semua',async()=>{category=name;filter();await load(null);});chip.dataset.category=name;categories.append(chip);}
  searchForm.addEventListener('submit',event=>{event.preventDefault();load(null).catch(error=>notify(error.message));});
  function drawBasket(){
   basket.replaceChildren(el('div',{class:'pos-basket-heading'},el('h2',{},'Pesanan'),el('span',{class:'muted'},cart.size+' produk')));
   const cartLines=el('div',{class:'pos-cart-lines'});basket.append(cartLines);
   for(const line of cart.values()){
    const row=el('div',{class:'pos-cart-line'+(selected===line.productId?' selected':'')},button(line.name,()=>{selected=line.productId;fresh=true;drawBasket();}),el('small',{},line.quantity+' × '+money(line.unitPrice)+(line.discountBps?' · Diskon '+(line.discountBps/100)+'%':'')),el('div',{class:'pos-quantity'},button('−',()=>{if(submitting||uncertain)return;line.quantity--;if(!line.quantity)cart.delete(line.productId);changed();drawBasket();}),el('span',{'aria-label':'Jumlah '+line.name},String(line.quantity)),button('+',()=>{if(submitting||uncertain)return;if(line.quantity>=1000)throw Error('Jumlah maksimal 1000');line.quantity++;changed();drawBasket();}),button('Hapus',()=>{if(submitting||uncertain)return;cart.delete(line.productId);changed();drawBasket();})),el('strong',{},money(net(line))));cartLines.append(row);
   }
   if(cart.size&&!cart.has(selected)){selected=cart.keys().next().value;fresh=true;}
   const discount=[...cart.values()].reduce((sum,line)=>sum+line.unitPrice*line.quantity-net(line),0);
   if(discount)basket.append(el('p',{class:'pos-discount'},'Diskon ',money(discount)));
   basket.append(el('p',{class:'pos-total'},'Total ',el('strong',{},money(total()))));
   const modes=el('div',{class:'pos-keypad-modes'}),keypad=el('div',{class:'pos-keypad'});
   for(const [key,label,permission] of [['quantity','Jumlah'],['unitPrice','Harga','pos.sales.override-price'],['discountBps','Diskon %','pos.sales.discount']]){const control=button(label,()=>{mode=key;fresh=true;drawBasket();});control.disabled=!!permission&&!can(permission)||submitting||uncertain;control.setAttribute('aria-pressed',String(mode===key));modes.append(control);}
   const active=cart.get(selected),value=active?(mode==='discountBps'?(active.discountBps||0)/100:active[mode]):0;
   const display=el('output',{'aria-live':'polite',class:'pos-keypad-display'},(active?active.name+' · ':'')+(mode==='unitPrice'?'Rp ':mode==='discountBps'?'Diskon ':'Jumlah ')+value+(mode==='discountBps'?'%':''));
   for(const key of ['1','2','3','4','5','6','7','8','9','.','0','⌫']){const control=button(key,()=>{
    if(submitting||uncertain||!active)return;
    const current=mode==='discountBps'?String((active.discountBps||0)/100):String(active[mode]);
    let next=key==='⌫'?(fresh?current:digits).slice(0,-1):(fresh?'':digits)+key;
    if(key==='.'&&mode!=='discountBps')return;
    if(!/^\d*(?:\.\d{0,2})?$/.test(next))return;
    const value=mode==='discountBps'?Math.round(Number(next)*100):Number(next),max=mode==='quantity'?1000:mode==='unitPrice'?1000000000:10000;
    if(!Number.isSafeInteger(value)||value>max){notify('Nilai melebihi batas');return;}
    if(mode==='quantity'&&value<1){digits=next;fresh=false;return;}
    digits=next;fresh=false;active[mode]=value;changed();drawBasket();
   });control.disabled=!active||submitting||uncertain||key==='.'&&mode!=='discountBps';control.setAttribute('aria-label',key==='⌫'?'Hapus digit':key==='.'?'Desimal':key);keypad.append(control);}
   basket.append(modes,display,keypad);
   if(uncertain){basket.append(el('p',{role:'alert'},'Status pembayaran belum diketahui. Periksa transaksi sebelum mencoba pembayaran baru.'),button('Periksa pembayaran',async()=>{const saved=await service('pos.sales.resolve',{requestId});uncertain=false;if(saved){cart.clear();changed();drawBasket();receipt(saved);notify('Transaksi ditemukan dan struk dipulihkan');}else{drawBasket();notify('Belum ada transaksi tersimpan; pembayaran dapat dicoba kembali.');}}));return;}
   if(!cart.size){basket.append(el('p',{class:'muted'},'Pilih produk untuk memulai penjualan.'));return;}
   basket.append(button('Perbarui harga keranjang',async()=>{if(submitting||uncertain)return;const quoted=await service('pos.quote',{items:[...cart.values()].map(line=>{const {revision,...input}=lineInput(line);return input;})});const old=new Map(cart);cart.clear();for(const line of quoted.items)cart.set(line.productId,{...old.get(line.productId),...line});changed();drawBasket();notify('Harga keranjang diperbarui; periksa total sebelum membayar.');}));
   if(!can('pos.sales.create')){basket.append(el('p',{},'Anda tidak memiliki izin membuat penjualan.'));return;}
   basket.append(button('Pembayaran · '+money(total()),()=>{
   if(submitting||uncertain)return;
   const payment=el('dialog',{class:'pos-payment-dialog'},el('h2',{},'Pembayaran tunai'),el('p',{class:'pos-total'},'Total',money(total())));
   const paid=field('Uang diterima (Rp)','tendered','number','');paid.querySelector('input').min='0';paid.querySelector('input').step='1';paid.querySelector('input').max='1000000000000';
   const change=el('p',{role:'status'},'Masukkan jumlah uang tunai.');paid.querySelector('input').addEventListener('input',event=>{const amount=Number(event.target.value);change.textContent=amount>=total()?'Kembalian: '+money(amount-total()):'Kurang: '+money(total()-amount);});
   payment.append(form([paid,change],async input=>{
    if(submitting||uncertain)return;const tendered=Number(input.tendered);if(total()>1000000000000)throw Error('Total transaksi melebihi batas');if(!Number.isSafeInteger(tendered)||tendered<total())throw Error('Uang diterima harus bilangan rupiah utuh dan cukup');
    const items=[...cart.values()].map(lineInput);
    if(!confirm('Simpan penjualan '+money(total())+' dengan uang tunai '+money(tendered)+'?'))return;
    submitting=true;
    try{const sale=await service('pos.checkout',{requestId,items,tendered,approved:true});cart.clear();changed();drawBasket();payment.close();receipt(sale);notify('Penjualan tersimpan');}
    catch(error){try{const saved=await service('pos.sales.resolve',{requestId});if(saved){cart.clear();changed();drawBasket();payment.close();receipt(saved);notify('Transaksi tersimpan; struk berhasil dipulihkan');return;}}catch{uncertain=true;payment.close();drawBasket();}throw error;}
    finally{submitting=false;if(basket.isConnected)drawBasket();}
   },'Bayar & simpan'),button('Kembali ke pesanan',()=>{if(!submitting)payment.close();}));
   payment.addEventListener('cancel',event=>{if(submitting)event.preventDefault();});payment.addEventListener('close',()=>payment.remove());document.body.append(payment);payment.showModal();paid.querySelector('input').focus();
   }));
  }
  drawBasket();await load(null);
 }
 async function manageProducts(){
  body.replaceChildren();const section=el('section',{class:'pos-wide'},el('h2',{},'Katalog produk'));body.append(section);
  const list=el('div',{});section.append(list);
  const editor=product=>{
   const target=el('section',{class:'pos-wide'},el('h2',{},product?'Edit produk':'Tambah produk'));body.replaceChildren(target);
   const price=field('Harga jual (Rp)','price','number',String(product?.price??''));price.querySelector('input').min='0';price.querySelector('input').step='1';
   let uploaded;const file=el('input',{type:'file',accept:'image/*','aria-label':'Unggah foto produk'}),status=el('p',{role:'status'},product?.hasPhoto?'Foto sendiri tersimpan.':'Gambar bawaan merupakan ilustrasi.'),preview=el('div',{class:'pos-gallery-preview'});if(product)preview.append(photo(product));let preparing=false;
   file.addEventListener('change',async()=>{if(!file.files[0])return;preparing=true;try{if(file.files[0].size>10000000)throw Error('Foto maksimal 10 MB');const bitmap=await createImageBitmap(file.files[0]);try{const canvas=document.createElement('canvas'),scale=Math.min(1,240/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);let quality=.7;do{uploaded=canvas.toDataURL('image/jpeg',quality);quality-=.1;}while(uploaded.length>10000&&quality>=.1);if(uploaded.length>10000){uploaded=undefined;throw Error('Foto terlalu rumit; pilih foto yang lebih sederhana');}status.textContent='Foto siap disimpan';}finally{bitmap.close();}}catch(error){notify(error.message);}finally{preparing=false;}});
   const gallery=el('select',{name:'imageKey','aria-label':'Gambar produk'});for(const [index,label] of ['Kopi susu','Americano','Cappuccino','Teh lemon','Matcha','Cokelat','Croissant','Roti cokelat','Donat','Nasi ayam','Sandwich','Air mineral'].entries()){const option=el('option',{value:String(index)},label);option.selected=index===(product?.imageKey??0);gallery.append(option);}
   target.append(form([preview,el('label',{},'Foto sendiri',file),status,button('Gunakan ilustrasi bawaan',()=>{uploaded='';file.value='';status.textContent='Ilustrasi bawaan akan digunakan setelah disimpan';preview.replaceChildren();}),el('label',{},'Gambar ilustrasi',gallery),field('Kategori','category','text',product?.category||'Umum'),...(product?[el('p',{},'SKU: '+product.sku)]:[field('SKU','sku')]),field('Nama produk','name','text',product?.name||''),price,...(product?[el('label',{},'Aktif dijual',el('input',{name:'active',type:'checkbox',checked:product.active}))]:[])],async input=>{
    if(preparing)throw Error('Tunggu pemrosesan foto selesai');const price=Number(input.price);if(!Number.isSafeInteger(price)||price<0)throw Error('Harga harus rupiah utuh, minimal nol');
    await service(product?'pos.products.update':'pos.products.create',{name:input.name,price,category:input.category,imageKey:Number(input.imageKey),...(uploaded!==undefined?{photo:uploaded}:{}),...(product?{id:product.id,revision:product.revision,active:input.active==='on'}:{sku:input.sku})});await manageProducts();notify('Produk disimpan');
   }),button('Kembali ke produk',manageProducts));
  };
  if(can('pos.products.manage'))section.append(button('Tambah produk',()=>editor(null)));
  const load=async cursor=>{const page=await service('pos.products.list',{includeInactive:can('pos.products.manage'),...(cursor?{cursor}:{})});for(const product of page.items)list.append(el('div',{class:'row'},el('div',{},el('strong',{},product.name),el('p',{class:'muted'},product.sku+' · '+(product.active?'Aktif':'Nonaktif')),el('p',{},money(product.price))),...(can('pos.products.manage')?[button('Edit produk',()=>editor(product))]:[])));if(!page.items.length&&!cursor)list.append(el('p',{},'Belum ada produk.'));if(page.nextCursor){const more=button('Muat produk berikutnya',async()=>{more.remove();await load(page.nextCursor);});section.append(more);}};
  await load(null);
 }
 async function history(){
  body.replaceChildren();const section=el('section',{class:'pos-wide'},el('h2',{},'Riwayat penjualan'));body.append(section);
  const load=async cursor=>{const page=await service('pos.sales.list',cursor?{cursor}:{});for(const sale of page.items){const own=sale.owner===user.id,scope=user.permissions['pos.sales.void'];section.append(el('div',{class:'row'},el('div',{},el('strong',{class:'pos-number'},sale.number),el('p',{},new Date(sale.createdAt).toLocaleString('id-ID')+' · '+sale.cashierName),el('p',{},money(sale.total)+' · '+(sale.status==='paid'?'Lunas':'Dibatalkan'))),el('div',{class:'actions'},button('Lihat struk',async()=>receipt(await service('pos.sales.get',{id:sale.id}))),...(sale.status==='paid'&&(scope==='all'||scope==='own'&&own)?[button('Batalkan transaksi',()=>{
   const dialog=el('dialog',{},el('h2',{},'Batalkan transaksi'),el('p',{class:'pos-number'},sale.number),form([field('Alasan pembatalan','reason')],async input=>{if(!confirm('Batalkan transaksi '+money(sale.total)+'?'))return;await service('pos.sales.void',{id:sale.id,revision:sale.revision,reason:input.reason,approved:true});dialog.close();await history();notify('Pembatalan tercatat');},'Konfirmasi pembatalan'),el('form',{method:'dialog'},el('button',{},'Tutup')));document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  })]:[]))));}if(!page.items.length&&!cursor)section.append(el('p',{},'Belum ada transaksi yang dapat diakses.'));if(page.nextCursor){const more=button('Muat riwayat berikutnya',async()=>{more.remove();await load(page.nextCursor);});section.append(more);}};
  await load(null);
 }
 if(can('pos.products.read'))nav.append(button('Kasir',cashier),button('Produk',manageProducts));
 if(can('pos.sales.read'))nav.append(button('Riwayat',history));
 if(can('pos.products.read'))await cashier();else if(can('pos.sales.read'))await history();else body.append(el('p',{},'Minta pengelola memberikan izin katalog atau riwayat POS.'));
}
