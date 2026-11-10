# Aplikasi POS 1.1

POS adalah aplikasi native bawaan di `modules/pos/`, terpisah dari kernel dan
aplikasi sistem. Rilis awal menyediakan katalog produk, kasir tunai IDR, struk,
riwayat dan pembatalan tercatat. Tidak ada dependensi npm tambahan.

## Menjalankan

```sh
npm ci
npm run db:migrate
npm start
```

Migrasi `007_pos.sql` menambahkan indeks unik SKU dan idempotency key serta indeks
riwayat pada data POS. Data tetap terisolasi lewat RLS dan FK tenant/modul/user.
Tidak ada akun, harga atau transaksi contoh yang disisipkan ke data pengguna.

1. Login sebagai admin, buka **Aplikasi**, lalu **Pasang** pada POS.
2. Kembali ke launcher dan buka **POS**.
3. Buka tab **Produk → Tambah produk**, masukkan SKU, nama, kategori dan harga rupiah utuh. Pilih ilustrasi bawaan atau unggah foto produk.
4. Pada tab **Kasir**, cari/pilih produk. Klik produk untuk menambah ke keranjang,
   pilih baris pesanan lalu gunakan keypad **Jumlah**, **Harga**, atau **Diskon %**. Harga dan diskon hanya aktif dengan izin khusus. Pilih **Pembayaran** lalu masukkan uang tunai yang diterima.
5. Pilih **Bayar & simpan** dan konfirmasikan total. Server menyimpan transaksi
   serta audit, kemudian menampilkan struk dengan total, tunai dan kembalian.
6. **Cetak struk** memakai dialog cetak browser. Riwayat dapat dibuka kembali
   melalui tab **Riwayat**.

Harga di server adalah sumber kebenaran. Jika produk/harga berubah setelah masuk
keranjang, pembayaran ditolak; gunakan **Perbarui harga keranjang** dan tinjau
ulang total. Produk nonaktif tidak dapat dijual; menonaktifkan produk tidak
mengubah struk lama. SKU unik per tenant, dinormalisasi uppercase, dan tidak
berubah melalui form edit.

## Izin kasir

Admin bawaan memiliki izin POS setelah modul dipasang. Untuk pengguna kasir,
buat peran pada **Hak Akses** dan berikan:

| Izin | Cakupan yang disarankan |
| --- | --- |
| `pos.open` | all |
| `pos.products.read` | all |
| `pos.sales.create` | own |
| `pos.sales.read` | own untuk struk sendiri; all bagi pengelola |
| `pos.products.manage` | all, hanya pengelola katalog |
| `pos.sales.override-price` | all, hanya kasir yang boleh mengganti harga per transaksi |
| `pos.sales.discount` | all, hanya kasir yang boleh memberi diskon |
| `pos.sales.void` | own atau all sesuai kebijakan pembatalan |

Tetapkan peran kepada pengguna melalui **Pengguna**. Kasir tanpa izin pengelolaan
tidak mendapat tombol tambah/edit produk. Backend tetap memeriksa izin terbaru,
status tenant/pengguna, dan owner transaksi pada setiap operasi; menyembunyikan
kontrol UI bukan pengganti otorisasi.

## Kontrak layanan

Manifest `modules/pos/manifest.mjs` mendeklarasikan input tertutup, izin, mutasi,
konfirmasi serta rute POST `/api/services/<nama>`:

- `pos.products.list/get/create/update`: katalog, pagination, revisi, kategori, pilihan ilustrasi, foto dan aktivasi. Filter kategori dilakukan di server sebelum pagination.
- `pos.products.categories`: kategori produk aktif (maksimal 1000 kategori).
- `pos.products.photo`: foto privat berdasarkan ID produk; memerlukan izin baca katalog. Daftar produk hanya memuat `hasPhoto`, tanpa isi foto.
- `pos.quote`: harga terbaru dan total untuk item/quantity tanpa menyimpan penjualan.
- `pos.checkout`: transaksi tunai dari daftar productId, quantity, revision,
  tendered dan requestId UUID; memerlukan approved:true.
- `pos.sales.resolve`: hasil requestId yang dimiliki pemanggil, atau null jika
  belum tersimpan. Tidak memberikan akses struk milik pengguna lain.
- `pos.sales.list/get`: riwayat dengan cursor stabil dan cakupan own/all.
- `pos.sales.void`: pembatalan dengan alasan, revision dan approved:true.

Semua aturan bisnis ada dalam layanan POS; controller HTTP memakai registry
kernel yang sama dengan aplikasi sistem. Native registry juga tersedia bagi
adapter tepercaya lain. Tool MCP belum mengekspos operasi keuangan POS secara
otomatis; kebijakan persetujuan untuk operasi tersebut harus ditambahkan secara
terpisah sebelum diaktifkan.

## Integritas transaksi

- Mata uang IDR, harga berupa integer rupiah, quantity berupa integer 1–1000.
  Maksimal 100 baris, harga satuan Rp1 miliar, total/tunai maksimal Rp1 triliun.
  Perhitungan server memeriksa batas integer aman; klien tidak dapat mengirim
  total atau kembalian sendiri. `unitPrice` opsional memerlukan izin override;
  `discountBps` integer 0–10000 mewakili 0–100%. Diskon dibulatkan half-up
  pada subtotal setiap baris memakai BigInt, lalu server menjumlahkan nilai neto.
  Struk menyimpan harga katalog, harga transaksi, subtotal serta diskon. Format
  checkout lama tanpa override/diskon tetap diterima.
- Checkout membaca produk aktif dan revisi terbaru di dalam transaksi tenant.
  Idempotency key UUID dan payload hash menolak penggunaan key yang sama untuk
  isi berbeda, termasuk pemakaian oleh kasir lain.
- Retry key yang sama dengan isi sama mengembalikan transaksi yang sudah ada,
  tanpa menyimpan penjualan kedua. Indeks PostgreSQL memperkuat keunikannya.
- Bila respons jaringan hilang setelah commit, UI memeriksa requestId dan
  memulihkan struk. Jika server tidak dapat dihubungi, keranjang dibekukan sampai
  **Periksa pembayaran** berhasil. Jangan membuat penjualan baru untuk transaksi
  yang statusnya belum diketahui; periksa riwayat setelah terhubung kembali.
  Keranjang/key hanya ada dalam memori halaman, bukan cache/localStorage offline.
- Struk menyimpan snapshot SKU, nama dan harga saat penjualan. Mengedit produk
  tidak mengubah histori. Nomor transaksi unik berbasis UUID.
- Pembatalan mencatat status void, alasan, pelaku dan waktu; tidak menghapus
  record atau mengubah nominal asli. Ini pencatatan pembatalan, bukan transfer
  pengembalian dana otomatis. Audit mencatat permintaan layanan; hitung jumlah
  penjualan dari record sale, bukan jumlah event audit karena retry juga diaudit.

Record disimpan pada `module_records` khusus module_id pos dengan kind product
atau sale. Generic CRUD paket deklaratif tidak dapat mengubah data POS. Uninstall
POS ditolak jika masih ada produk/transaksi; disable menyimpan semua data.
Backup tenant di Pengaturan dan prosedur restore operator mencakup katalog,
struk, idempotency key dan pembatalan. Pengujian PostgreSQL memverifikasi roundtrip
backup/purge/restore tanpa kehilangan histori atau membuat transaksi duplikat.

## Foto produk dan pembaruan

Ada 12 gambar ilustrasi orisinal yang disajikan dari aset lokal, tanpa CDN.
Gambar bawaan dihasilkan untuk PAPbox dan merupakan ilustrasi, bukan foto produk
milik toko. Pengelola dapat menggantinya melalui unggahan foto. Browser mengecilkan
foto menjadi JPEG maksimal 240 piksel dan 10000 karakter data URL; file sumber
maksimal 10 MB. Foto yang masih terlalu besar setelah kompresi ditolak.
Server membatasi format JPEG, ukuran input dan dimensi (maksimal 1024 piksel).
Foto disimpan dalam JSONB record produk dan ikut backup/restore tenant.
Permintaan foto harus melalui layanan terautentikasi dengan respons no-store;
foto privat tidak masuk cache service worker. Blob URL browser hanya digunakan
untuk menampilkan gambar dan dilepas setelah dimuat. SVG/URL eksternal tidak diterima.

Tidak ada dependensi baru atau migrasi baru untuk pembaruan ini. Data katalog lama
menggunakan kategori Umum dan ilustrasi pertama sampai diedit. Setelah mengambil
kode terbaru, jalankan `npm ci`, `npm run db:migrate`, dan restart `npm start`.
Migrasi yang dibutuhkan tetap `007_pos.sql`; jangan mengubah migrasi yang sudah
terpasang. Terima pembaruan PWA jika diminta. Admin sudah memiliki izin baru;
peran kasir khusus perlu diberi dua izin di atas sesuai kebijakan toko.

## Verifikasi dan batas versi awal

`npm test` mencakup harga berubah, kekurangan tunai, input tamper/fractional,
retry/concurrency, owner/tenant ACL, pembatalan, pagination, dan backup/restore.
`npm run test:postgres` menjalankan kontrak yang sama dengan pool terpisah.

Browser smoke POS di [TESTING.md](TESTING.md) memeriksa instalasi, katalog,
keranjang, pembayaran/kembalian, aksi cetak, respons hilang, hak kasir dan mobile.
Pengujian aksi cetak tidak membuktikan kompatibilitas printer fisik tertentu.

Belum termasuk kartu/payment gateway, pajak, fractional quantity, barcode
hardware, shift/laci kas, retur parsial, transaksi offline, atau integrasi stok
Inventory. Katalog POS saat ini mandiri; penjualan belum mengurangi stok.
