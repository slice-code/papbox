# Sistem utama PAPbox

Dokumen ini menjelaskan kontrak sistem yang sudah tersedia, cara operasi, dan
batas versi awal. Jalankan setup PostgreSQL di [DATABASE.md](DATABASE.md) terlebih
dahulu. Migrasi `006_mail_outbox.sql` diperlukan setelah update kode:

```sh
npm ci
npm run db:migrate
npm start
```

Lihat [MODULES.md](MODULES.md) untuk izin granular/peran khusus dan kontrak model, [OPERATIONS.md](OPERATIONS.md) untuk lifecycle tenant, MFA dan backup, serta [MCP.md](MCP.md) untuk adapter AI. Dokumen ini menjelaskan kontrak akun dan paket v1 yang tetap didukung.

Tidak ada dependensi baru selain driver `pg` yang sebelumnya disetujui.

## Pengguna, peran, dan akun

Administrator tenant membuka **Pengguna** untuk menambah pengguna, mengubah nama/
email/peran, serta mengaktifkan atau menonaktifkan akun. Peran bawaan adalah `admin` dan `member`; **Hak Akses** menyediakan peran khusus dengan izin per aksi dan cakupan data. Tidak ada penghapusan fisik pengguna agar referensi audit
tetap utuh. Semua operasi dibatasi tenant dari sesi server.

Administrator aktif terakhir tidak boleh dinonaktifkan atau dijadikan anggota.
Pemeriksaan dilakukan di dalam transaksi yang mengunci tenant, termasuk ketika
dua administrator melakukan perubahan bersamaan. Perubahan email, peran, atau
status menaikkan versi autentikasi dan mencabut seluruh sesi serta token reset
pengguna tersebut. Mengaktifkan kembali akun tidak menghidupkan sesi lama.

Setiap pengguna memiliki **Akun Saya** untuk mengganti kata sandi dengan verifikasi
kata sandi saat ini, atau keluar dari seluruh perangkat. Kedua tindakan mencabut
seluruh sesi, termasuk sesi pemanggil, sehingga pengguna harus masuk kembali.

## Reset kata sandi

1. Administrator membuka **Pengguna → Reset kata sandi**, lalu mengonfirmasi.
2. Server menghasilkan token acak 256 bit, berlaku 15 menit dan hanya sekali pakai.
3. Token ditampilkan satu kali pada dialog. Sampaikan secara privat setelah
   memverifikasi identitas penerima; PAPbox belum mengirim email/SMS.
4. Pengguna memilih **Gunakan token reset kata sandi** pada halaman login,
   memasukkan token dan kata sandi baru minimal 12 karakter.
5. Penggunaan token mengganti kata sandi dan membatalkan semua sesi/token reset
   lama. Dua permintaan penggunaan bersamaan hanya mengizinkan satu berhasil.

Tabel reset hanya menyimpan SHA-256 token; outbox email menyimpan salinan token terenkripsi sementara, bukan plaintext. Audit tidak menyimpan
token atau kata sandi. Penerbitan token baru membatalkan token lama pengguna yang
sama. Akun nonaktif tidak dapat menerima atau memakai reset.

Jika semua administrator lupa kata sandi, operator yang memiliki akses tepercaya
ke host/kredensial database dapat memakai CLI pemulihan di bawah. Ini operasi
operator lokal, bukan endpoint publik atau izin admin lintas tenant.

## Provisioning tenant oleh operator

Tidak ada pendaftaran tenant publik. Operator menjalankan CLI dari root checkout
menggunakan `DATABASE_URL` akun runtime yang sudah dikonfigurasi. CLI memakai
layanan provisioning yang sama dengan setup awal, dalam satu transaksi per tenant.
Slug tenant berupa huruf kecil diikuti huruf/angka/`_`/`-`, maksimal 63 karakter.
ID yang sudah ada ditolak tanpa menimpa data. Setiap tenant memiliki admin pertama,
pengaturan, serta audit pembuatan sendiri.

Pada Bash, baca kata sandi tanpa menampilkannya, kirim lewat stdin, lalu hapus
variabel shell. Jangan menaruh kata sandi literal pada argumen atau histori:

```bash
read -r -s -p 'Kata sandi admin tenant: ' papbox_password
printf '\n'
printf '%s\n' "$papbox_password" | npm run tenant:create -- \
  --id toko-satu --name 'Toko Satu' \
  --email admin@example.com --admin-name 'Admin Toko'
unset papbox_password
```

Pengguna memilih **ID tenant** saat login. Jika tenant lain dibuat sebelum tenant
`default`, pilih **Masuk ke tenant yang sudah ada** pada halaman setup. Admin
tenant tidak memperoleh layanan HTTP untuk membuat atau membaca tenant lain.

Untuk memulihkan kata sandi pengguna aktif melalui operator:

```bash
read -r -s -p 'Kata sandi baru: ' papbox_password
printf '\n'
printf '%s\n' "$papbox_password" | npm run account:recover -- \
  --tenant toko-satu --email admin@example.com
unset papbox_password
```

CLI tidak mengaktifkan akun nonaktif atau mengubah peran. Password hanya diterima
melalui stdin; sesi/token lama dicabut. Audit `operator.account-recovery`
mencatat pengguna target. Identitas operator OS belum terintegrasi ke audit ini;
catat identitas/tiket perubahan pada prosedur operasi eksternal.

## Sesi bersama dan pencabutan

Cookie HttpOnly/SameSite=Strict berisi tenant dan token acak 256 bit. PostgreSQL
menyimpan hash token di tabel `sessions` dengan FK tenant/pengguna, RLS, versi
autentikasi, dan waktu kedaluwarsa delapan jam. Tidak ada plaintext token di DB.
Semua instance membaca sumber database yang sama dan memeriksa status/peran/versi
terbaru. Sesi tetap berlaku sesudah proses web restart, tetapi tidak sesudah
password/peran/status berubah atau sesi dicabut. Maksimal sepuluh sesi per akun;
login berikutnya mencabut yang paling lama. Sesi kedaluwarsa dipangkas saat login
pada tenant yang sama; tidak ada daemon cleanup terpisah.

Dengan PostgreSQL, batas sepuluh percobaan login/setup/reset per alamat koneksi
per bucket menit dibagi antarinstance melalui `auth_rate_limits`. IP di-hash
sebelum disimpan; counter lama dipangkas saat permintaan berikutnya. Ini batas
fixed-window; deployment tetap perlu pengaturan reverse proxy dan rate limit
perimeter yang tepat. PAPbox memakai alamat socket dan tidak mempercayai
`X-Forwarded-For`. Proxy loopback dapat membuat banyak pengguna berbagi counter.

Adapter JSON menyimpan hash sesi/reset di file yang sama agar dapat restart,
namun tetap **satu proses** dan rate limit hanya lokal. Hentikan server JSON sebelum memakai CLI operator karena penguncian file tidak dibagi antarproses. PostgreSQL diperlukan
untuk beberapa instance. Aset dan API privat tetap tidak dicache service worker.

## Paket modul deklaratif versi 1

Kontrak ini implementasi awal yang dibatasi; belum menjadi format paket kode
JavaScript atau kebijakan marketplace umum. Paket mendefinisikan aplikasi teks
read-only, tanpa skrip, HTML, SQL, dependensi, hook, akses jaringan, atau akses
filesystem. Isi dirender sebagai text node. Tidak ada ekstraksi arsip atau eksekusi
kode. Paket dapat muncul di launcher dan dibuka setelah aktif serta pengguna diberi izin `<id>.open`; anggota tidak memperoleh izin modul otomatis.

Envelope JSON terdiri dari `format: "papbox.module/1"`, `publisher`, `manifest`,
dan `signature`. Manifest memiliki tepat delapan field seperti
[contoh manifest](../examples/notes.manifest.json); field asing ditolak, `api`
harus `1`. Versi berupa tiga bilangan `major.minor.patch`. Paket maksimal 64 KiB
pada API, dengan konten maksimal 8000 karakter. ID aplikasi sistem/bawaan dilindungi.

Tanda tangan Ed25519 dibuat atas JSON payload `{format,publisher,manifest}` dengan
kunci objek diurutkan rekursif (fungsi `canonical` di `system/packages.mjs`). Ini
kontrak serialisasi PAPbox v1, bukan klaim implementasi RFC 8785. SHA-256 payload
ditampilkan saat review. Tanda tangan membuktikan penerbit/integritas, bukan
jaminan bahwa konten atau keputusan bisnis penerbit benar.

### Menandatangani dan menetapkan penerbit tepercaya

Private key disimpan pada mesin penerbit/offline, tidak pada server web atau Git.
Contoh menggunakan OpenSSL pada mesin penerbit:

```sh
openssl genpkey -algorithm ED25519 -out publisher-private.pem
chmod 600 publisher-private.pem
openssl pkey -in publisher-private.pem -pubout -out publisher-public.pem
npm run package:sign -- --manifest examples/notes.manifest.json \
  --key publisher-private.pem --publisher toko-publisher --out notes-1.0.0.json
```

Operator harus memverifikasi identitas dan fingerprint public key melalui kanal
tepercaya sebelum memasukkannya ke file registry. Registry berbentuk objek JSON
`{"toko-publisher":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"}`.
Contoh registry kosong di `config/trusted-publishers.example.json`. Public key
bukan secret, tetapi perubahan registry adalah perubahan kepercayaan yang harus
ditinjau operator. Paket tidak dapat menambahkan public key miliknya sendiri.

Atur `PAPBOX_TRUSTED_KEYS` ke lokasi registry melalui environment/`.env`, lalu
restart semua instance agar menggunakan kebijakan yang sama. Bila variabel tidak
diset, tidak ada penerbit eksternal yang dipercaya. Menghapus key lalu restart
menonaktifkan akses ke paket penerbit tersebut; launcher tetap menampilkan
aplikasi lain. Paket yang key-nya dicabut tidak boleh diaktifkan atau dipakai
untuk rollback. Rotasi key memerlukan penandatanganan ulang dengan key yang baru
sebelum pemasangan versi baru; histori bertanda tangan lama mungkin tidak lagi
layak di-rollback setelah key lama dicabut.

### Instalasi, update, dan rollback

1. Admin memilih file JSON pada **Aplikasi → Verifikasi paket**.
2. Server memvalidasi skema, kunci tepercaya, API, dan tanda tangan.
3. Browser menampilkan penerbit, nama, versi, serta digest untuk konfirmasi admin.
4. Setelah persetujuan, server memverifikasi ulang dan menyimpan paket, versi,
   registrasi menu, serta audit dalam satu transaksi. Tidak ada perubahan kernel.
5. Update memakai ID dan publisher yang sama dengan versi lebih tinggi. Gagal
   verifikasi tidak mengubah versi yang sedang aktif.
6. **Rollback** memulihkan versi sebelumnya setelah konfirmasi dan verifikasi
   ulang. Lima versi sebelumnya dipertahankan. Aktivasi dan nama menu dipertahankan;
   uninstall menghapus registrasi, menu override, paket dan histori tenant itu.

Operasi paket dilaksanakan melalui layanan bersama `packages.inspect`,
`packages.install`, `packages.rollback`, serta `apps.open`. Tidak ada penggantian
izin administrator dengan flag persetujuan saja: identitas/peran tetap diperiksa.
Layanan pengguna baru: `users.update`, `users.reset`, `account.change-password`,
dan `account.revoke-sessions`. Audit mutasi menyimpan target tanpa payload rahasia.

## Verifikasi

`npm test` menjalankan kontrak akun, reset, sesi, provisioning dan paket pada JSON.
`npm run test:postgres` menjalankan kontrak yang sama pada database sementara,
termasuk instance web dengan pool koneksi terpisah. Kasus negatif mencakup admin
terakhir, sesi/token lama, tenant salah, paket yang dimodifikasi, publisher tak
tepercaya, versi turun, dan rollback tanpa konfirmasi. Panduan konfigurasi test
ada di [DATABASE.md](DATABASE.md).

Pengujian Chromium mencakup UI edit/aktivasi pengguna, reset dan login ulang,
perubahan password, instalasi/update/rollback paket, rendering konten teks tanpa
mengeksekusi HTML, dan layout ponsel. Pengujian browser tersebut dilakukan pada
instance terisolasi, tidak mengubah akun pengguna development.

Batas yang masih berlaku: eksekusi kode pihak ketiga/sandbox belum didukung, dan SSO ditunda. MFA, izin granular, MCP serta adapter email kini tersedia sesuai panduan terkait; email perlu konfigurasi OAuth serta worker outbox menurut [MAIL-WORKER.md](MAIL-WORKER.md). Tidak ada klaim sertifikasi produksi. POS tunai kini tersedia sesuai [POS.md](POS.md); Inventory, CRM dan Invoice masih fondasi.
