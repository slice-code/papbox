# PostgreSQL untuk PAPbox

PostgreSQL 17 adalah jalur database utama untuk pengembangan. Adapter menggunakan
`pg` (disetujui pemilik); kernel tidak mengimpor driver. Adapter JSON masih untuk
pengembangan ringan dan tes tanpa server database. Jika `DATABASE_URL` diset,
server wajib terkoneksi PostgreSQL; kegagalan koneksi tidak dialihkan ke JSON.

## Menjalankan lokal

Prasyarat: Git, Node.js 24 (diuji 24.22.1), npm, Docker Engine, dan Docker
Compose v2 dengan dukungan `--wait`. Jalankan semua perintah dari root checkout
PAPbox. Untuk checkout baru:

```sh
git clone https://github.com/slice-code/papbox.git
cd papbox
npm ci
# Salin hanya jika .env belum ada; pertahankan konfigurasi lokal yang ada.
test -f .env || cp .env.example .env
# Isi dua kata sandi berbeda pada .env, sesuaikan juga URL koneksinya.
# Gunakan kata sandi yang URI-safe atau percent-encode bagian password pada URL.
chmod 600 .env
docker compose up -d --wait
npm run db:migrate
npm start
```

Setelah server menyala, buka aplikasi pada port 3000 melalui browser lokal.
Buat administrator pertama dengan nama, email, dan kata sandi minimal 12 karakter.
Database tidak memiliki akun aplikasi PAPbox bawaan; role PostgreSQL adalah akun
koneksi internal, bukan akun login pengguna.

Periksa kesiapan dari terminal lain:

```sh
curl --fail http://127.0.0.1:3000/api/session
```

Pada database baru hasilnya `{"setup":true,"user":null}`. Setelah setup,
`setup` menjadi `false`. Startup server harus menyebut `PostgreSQL`; jika tertulis
`JSON development store`, periksa keberadaan `DATABASE_URL` tanpa mencetak nilainya.
Hentikan server dengan Ctrl+C. Untuk memulai kembali, jalankan
`docker compose up -d --wait`, `npm run db:migrate`, lalu `npm start`.

Pada environment yang sudah disiapkan, `.env` lokal telah dibuat dengan dua
kata sandi acak berbeda; jangan menimpanya atau mengirim isinya ke Git/chat.
Database dan port hanya dibuka ke loopback. Kredensial migrasi dan runtime terpisah.
Volume Docker `papbox_postgres` menyimpan data melampaui restart container.
`docker compose down` tidak menghapus volume; jangan gunakan `down -v` untuk data
penting. Environment snapshot belum tentu mencakup volume Docker: selalu siapkan
backup terpisah sebelum memindahkan lingkungan.

Inisialisasi role aplikasi hanya dijalankan pada volume baru. Mengubah `.env`
tidak merotasi password database yang sudah dibuat. Rotasi dilakukan melalui
administrator database dengan koneksi aman, lalu perbarui konfigurasi aplikasi.
File init harus dapat dibaca pengguna postgres di container (mode 0644).

## Skema

| Tabel | Tujuan dan integritas |
| --- | --- |
| `tenants` | Identitas tenant dengan slug unik |
| `tenant_settings` | Nama dan locale, satu baris per tenant |
| `users` | UUID, hash password, peran; email unik dalam tenant |
| `installed_modules` | Versi dan status modul per tenant |
| `menu_overrides` | Nama, urutan, visibilitas menu per tenant |
| `audit_events` | Aktivitas dengan FK gabungan tenant/pengguna dan indeks waktu |
| `schema_migrations` | Versi, checksum SHA-256, waktu penerapan |

Tabel bisnis berikutnya memakai `tenant_id NOT NULL`, FK tenant, PK atau UNIQUE
berbasis tenant, dan FK gabungan ketika menunjuk record tenant lainnya. Gunakan
`numeric` untuk uang, integer satuan terkecil bila cocok, serta `timestamptz` untuk
waktu; jangan gunakan floating point untuk nominal. Tambahkan tabel bisnis melalui
migrasi baru. Rancangan transaksi stok, penjualan, dan faktur perlu kontrak sendiri.

## Isolasi dan transaksi

Semua tabel tenant menggunakan **FORCE ROW LEVEL SECURITY**. Adapter memasang
`papbox.tenant_id` dengan `set_config(..., true)` di dalam transaksi; nilainya
hilang setelah commit/rollback sehingga tidak bocor melalui connection pool.
Tanpa konteks tenant, baris tidak terlihat dan penulisan ditolak.

Identitas tenant harus berasal dari sesi server. RLS membatasi query yang lupa
filter, bukan sandbox terhadap server atau kredensial database yang disusupi:
pemegang kredensial dapat memasang konteks tenant lain. Otorisasi pengguna tetap
berada pada layanan aplikasi.

Runtime menolak role superuser/BYPASSRLS. Role `papbox_app` lokal tidak memiliki
DDL, pembuatan role/database, atau UPDATE/DELETE audit. Migrator lokal dibuat
superuser oleh image resmi untuk bootstrap **development saja**. Untuk produksi,
gunakan role migrasi terpisah dengan hak DDL yang diperlukan dan role runtime
terbatas; jangan berikan URL migrator ke proses web. Grant SELECT/INSERT/UPDATE/
DELETE pada tabel runtime yang diperlukan, USAGE sequence, dan hanya SELECT/
INSERT pada audit. Tabel migrasi hanya perlu SELECT bagi runtime.

Transaksi perubahan memakai advisory lock per tenant dan penulisan parameterized.
Tenant berbeda dapat menulis bersamaan. Semua perubahan data dan audit commit
bersama; kegagalan mengembalikan transaksi. Snapshot baca menggunakan repeatable
read. Pool maksimal 10 koneksi, dengan connection/statement/lock timeout.

Adapter saat ini mempertahankan kontrak snapshot layanan agar perubahan awal
kecil: pengguna, konfigurasi menu, dan modul dimuat per tenant, sementara audit
dibatasi 20 entri terbaru. Audit lengkap tetap berada di database. Ini sesuai
metadata platform awal; modul bisnis berskala besar harus memakai repository SQL
khusus, query berhalaman, dan transaksi domain, bukan memuat seluruh tabel.
Sesi web masih di memori; deployment multi-instance memerlukan session store
bersama. Pemeriksaan ini bukan sertifikasi keamanan SaaS produksi.

## Migrasi

```sh
npm run db:migrate
```

Runner menggunakan `DATABASE_MIGRATION_URL`, atau `DATABASE_URL` bila URL migrator
tidak tersedia. Migrasi harus dijalankan oleh role dengan hak DDL. Startup web
hanya memeriksa kesiapan skema; tidak menjalankan DDL secara otomatis.

Semua migrasi yang belum diterapkan dieksekusi dalam satu transaksi dengan lock
migrasi, sehingga kegagalan tidak meninggalkan setengah skema. Menjalankan ulang
aman; checksum migrasi lama tidak boleh diubah. Buat file bernomor baru untuk
perubahan berikutnya. Belum ada destructive down migration otomatis; gunakan
migrasi korektif dan backup sebelum perubahan berisiko.

## Memindahkan JSON lama

Hentikan server/penulisan data, backup JSON, migrasikan skema, kemudian:

```sh
npm run db:import-json -- storage/data.json
```

Import tidak mengubah sumber atau menimpa tenant yang sudah ada. Tiap tenant
atomik, bukan seluruh file multi-tenant: bila tenant selanjutnya gagal, tenant
sebelumnya tetap tersimpan. Jangan ulang seluruh file secara membabi buta; periksa
hasil dan siapkan file berisi tenant yang belum masuk. Constraint PostgreSQL
memvalidasi UUID, relasi, peran, dan keunikan. Jalankan server dengan DATABASE_URL
setelah memverifikasi hasil. Tidak ada pemindahan JSON otomatis saat startup.

## Pengujian database

Siapkan `TEST_DATABASE_ADMIN_URL` dan `TEST_DATABASE_URL` pada shell atau `.env`.
Admin harus boleh membuat database sementara dan menjalankan migrasi; URL kedua
memakai login role `papbox_app` pada cluster yang sama. Jangan gunakan kredensial
produksi. Pengujian membuat nama database acak, mengujinya, lalu menghapus hanya
database tersebut. Role `papbox_app` harus sudah tersedia (Compose menyediakan).

```sh
npm test
npm run test:postgres
```

`npm test` tetap menjalankan tes JSON dan melewati tes PostgreSQL jika dua URL tes
tidak disediakan. `test:postgres` gagal jika konfigurasi tidak lengkap, agar CI
tidak melaporkan integrasi sebagai lulus ketika sebenarnya tidak dijalankan.

Tes mencakup migrasi ulang, RLS lintas tenant, tidak bocornya konteks pool, larangan
role superuser, pembatasan audit, unique constraint, rollback, concurrency,
import tanpa overwrite, login HTTP, dan pembacaan ulang data.

## Backup dan produksi

Gunakan `pg_dump --format=custom` dan uji restore ke database terpisah. Simpan
backup terenkripsi di luar mesin/volume database dengan retensi yang ditetapkan.
Kredensial sebaiknya melalui secret manager atau PGPASSFILE mode 0600, bukan argumen
command yang masuk histori. Restore harus diuji dengan role runtime dan RLS.

Untuk server remote, wajibkan TLS dengan sertifikat CA yang diverifikasi dan
hostname sesuai; jangan gunakan `rejectUnauthorized:false`. Tetapkan kebijakan
backup/PITR, monitoring, rotasi kredensial, kapasitas pool, dan provisioning tenant
sebelum deployment produksi. Compose ini ditujukan untuk pengembangan lokal.
