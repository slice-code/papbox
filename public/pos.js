const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
export async function renderPos({container,service,can,user,el,button,form,field,notify}){
 const cart=new Map();let requestId=crypto.randomUUID(),submitting=false,uncertain=false;
 const nav=el('nav',{class:'pos-nav','aria-label':'Navigasi POS'}),body=el('div',{class:'pos-workspace'});
 container.append(el('p',{class:'muted'},'Kasir tunai · IDR'),nav,body);
 const total=()=>[...cart.values()].reduce((sum,line)=>sum+line.unitPrice*line.quantity,0);
 const changed=()=>{requestId=crypto.randomUUID();};
 function receipt(sale){
  if(!container.isConnected)return;
  const dialog=el('dialog',{class:'pos-receipt-dialog'},el('article',{class:'pos-receipt'},el('h2',{},'Struk penjualan'),el('p',{class:'pos-number'},sale.number),el('p',{},new Date(sale.createdAt).toLocaleString('id-ID')),el('p',{},'Kasir: '+sale.cashierName),el('strong',{},sale.status==='void'?'DIBATALKAN':'LUNAS'),...sale.items.map(line=>el('div',{class:'pos-receipt-line'},el('div',{},el('strong',{},line.name),el('small',{},line.sku+' · '+line.quantity+' × '+money(line.unitPrice))),el('span',{},money(line.lineTotal)))),el('hr',{}),el('p',{class:'pos-receipt-line'},'Total',money(sale.total)),el('p',{class:'pos-receipt-line'},'Tunai',money(sale.tendered)),el('p',{class:'pos-receipt-line'},'Kembalian',money(sale.change)),...(sale.status==='void'?[el('p',{},'Alasan: '+sale.voidReason)]:[])),el('div',{class:'actions pos-no-print'},button('Cetak struk',()=>{document.body.classList.add('printing-pos');try{window.print();}finally{document.body.classList.remove('printing-pos');}}),el('form',{method:'dialog'},el('button',{},'Tutup'))));
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
 }
 async function cashier(){
  body.replaceChildren();const products=el('section',{class:'pos-products'},el('h2',{},'Produk')),basket=el('section',{class:'pos-basket','aria-label':'Keranjang belanja'});body.append(products,basket);
  const search=el('input',{type:'search',placeholder:'Cari nama atau SKU','aria-label':'Cari produk POS'}),results=el('div',{class:'pos-product-grid'}),searchForm=el('form',{class:'pos-search'},search,el('button',{type:'submit'},'Cari'));products.append(searchForm,results);
  const load=async(cursor)=>{
   if(!can('pos.products.read')){results.replaceChildren(el('p',{},'Izin membaca katalog produk diperlukan.'));return;}
   const page=await service('pos.products.list',{q:search.value,...(cursor?{cursor}:{})});if(!cursor)results.replaceChildren();
   for(const product of page.items)results.append(el('button',{class:'pos-product',type:'button',onclick:()=>{
    if(submitting||uncertain)return;const old=cart.get(product.id);if(old&&old.quantity>=1000){notify('Jumlah maksimal 1000 per produk');return;}
    if(!old&&cart.size>=100){notify('Maksimal 100 baris produk per transaksi');return;}if(old)old.quantity++;else cart.set(product.id,{productId:product.id,revision:product.revision,sku:product.sku,name:product.name,unitPrice:product.price,quantity:1});changed();drawBasket();
   }},el('strong',{},product.name),el('small',{},product.sku),el('span',{},money(product.price))));
   if(!page.items.length&&!cursor)results.append(el('p',{class:'muted'},'Belum ada produk yang cocok. Pengelola dapat menambah produk pada tab Produk.'));
   if(page.nextCursor){const more=button('Muat produk berikutnya',async()=>{more.remove();await load(page.nextCursor);});results.append(more);}
  };
  searchForm.addEventListener('submit',event=>{event.preventDefault();load(null).catch(error=>notify(error.message));});
  function drawBasket(){
   basket.replaceChildren(el('h2',{},'Keranjang'));
   for(const line of cart.values())basket.append(el('div',{class:'pos-cart-line'},el('div',{},el('strong',{},line.name),el('small',{},money(line.unitPrice))),el('div',{class:'pos-quantity'},button('−',()=>{if(submitting||uncertain)return;line.quantity--;if(line.quantity===0)cart.delete(line.productId);changed();drawBasket();}),el('span',{'aria-label':'Jumlah '+line.name},String(line.quantity)),button('+',()=>{if(submitting||uncertain)return;if(line.quantity>=1000)throw Error('Jumlah maksimal 1000');line.quantity++;changed();drawBasket();}),button('Hapus',()=>{if(submitting||uncertain)return;cart.delete(line.productId);changed();drawBasket();})),el('strong',{},money(line.unitPrice*line.quantity))));
   basket.append(el('p',{class:'pos-total'},'Total ',el('strong',{},money(total()))));
   if(uncertain){basket.append(el('p',{role:'alert'},'Status pembayaran belum diketahui. Periksa transaksi sebelum mencoba pembayaran baru.'),button('Periksa pembayaran',async()=>{const saved=await service('pos.sales.resolve',{requestId});uncertain=false;if(saved){cart.clear();changed();drawBasket();receipt(saved);notify('Transaksi ditemukan dan struk dipulihkan');}else{drawBasket();notify('Belum ada transaksi tersimpan; pembayaran dapat dicoba kembali.');}}));return;}
   if(!cart.size){basket.append(el('p',{class:'muted'},'Pilih produk untuk memulai penjualan.'));return;}
   basket.append(button('Perbarui harga keranjang',async()=>{if(submitting||uncertain)return;const quoted=await service('pos.quote',{items:[...cart.values()].map(({productId,quantity})=>({productId,quantity}))});cart.clear();for(const line of quoted.items)cart.set(line.productId,line);changed();drawBasket();notify('Harga keranjang diperbarui; periksa total sebelum membayar.');}));
   if(!can('pos.sales.create')){basket.append(el('p',{},'Anda tidak memiliki izin membuat penjualan.'));return;}
   const paid=field('Uang diterima (Rp)','tendered','number','');paid.querySelector('input').min='0';paid.querySelector('input').step='1';paid.querySelector('input').max='1000000000000';
   const change=el('p',{role:'status'},'Masukkan jumlah uang tunai.');paid.querySelector('input').addEventListener('input',event=>{const amount=Number(event.target.value);change.textContent=amount>=total()?'Kembalian: '+money(amount-total()):'Kurang: '+money(total()-amount);});
   basket.append(form([paid,change],async input=>{
    if(submitting||uncertain)return;const tendered=Number(input.tendered);if(total()>1000000000000)throw Error('Total transaksi melebihi batas');if(!Number.isSafeInteger(tendered)||tendered<total())throw Error('Uang diterima harus bilangan rupiah utuh dan cukup');
    const items=[...cart.values()].map(({productId,quantity,revision})=>({productId,quantity,revision}));
    if(!confirm('Simpan penjualan '+money(total())+' dengan uang tunai '+money(tendered)+'?'))return;
    submitting=true;
    try{const sale=await service('pos.checkout',{requestId,items,tendered,approved:true});cart.clear();changed();drawBasket();receipt(sale);notify('Penjualan tersimpan');}
    catch(error){try{const saved=await service('pos.sales.resolve',{requestId});if(saved){cart.clear();changed();drawBasket();receipt(saved);notify('Transaksi tersimpan; struk berhasil dipulihkan');return;}}catch{uncertain=true;drawBasket();}throw error;}
    finally{submitting=false;}
   },'Bayar & simpan'));
  }
  drawBasket();await load(null);
 }
 async function manageProducts(){
  body.replaceChildren();const section=el('section',{class:'pos-wide'},el('h2',{},'Katalog produk'));body.append(section);
  const list=el('div',{});section.append(list);
  const editor=product=>{
   const target=el('section',{class:'pos-wide'},el('h2',{},product?'Edit produk':'Tambah produk'));body.replaceChildren(target);
   const price=field('Harga jual (Rp)','price','number',String(product?.price??''));price.querySelector('input').min='0';price.querySelector('input').step='1';
   target.append(form([...(product?[el('p',{},'SKU: '+product.sku)]:[field('SKU','sku')]),field('Nama produk','name','text',product?.name||''),price,...(product?[el('label',{},'Aktif dijual',el('input',{name:'active',type:'checkbox',checked:product.active}))]:[])],async input=>{
    const price=Number(input.price);if(!Number.isSafeInteger(price)||price<0)throw Error('Harga harus rupiah utuh, minimal nol');
    await service(product?'pos.products.update':'pos.products.create',{name:input.name,price,...(product?{id:product.id,revision:product.revision,active:input.active==='on'}:{sku:input.sku})});await manageProducts();notify('Produk disimpan');
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
