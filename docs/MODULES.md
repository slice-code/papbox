# Kontrak modul dan izin granular

PAPbox memiliki kontrak native untuk developer dan paket deklaratif untuk modul
yang dipasang administrator. Keduanya memakai layanan aplikasi sebagai pintu
operasi; adapter HTTP dan MCP memanggil layanan yang sama. Core tidak memuat
JavaScript pihak ketiga dari upload paket.

## Kontrak native versi API 1

`Kernel.install(contract, handlers)` memvalidasi seluruh deklarasi sebelum
mempublikasikan layanan/rute. Bentrok, handler yang hilang, dependensi yang belum
terpasang atau versi yang tidak cocok membatalkan registrasi tanpa sisa parsial.
Kontrak berisi:

- `id`, `version` (`major.minor.patch`), dan `api: 1`.
- `dependencies: [{id, version}]` dengan versi tepat, bukan rentang SemVer.
- `permissions: [{id, scopes}]`, dengan scope `all` dan/atau `own`.
- `services: [{name, permission, mutation, confirmation, input}]`.
- `routes: [{method, path, service}]` dengan nama layanan yang dideklarasikan.

Handler menerima context tepercaya dan input yang telah divalidasi. Context harus
dibentuk adapter dari identitas terautentikasi, bukan JSON dari klien. Kernel
memeriksa izin deklaratif; handler/repository tetap wajib memeriksa tenant,
kepemilikan record, dan izin terbaru dalam transaksi yang sama dengan perubahan.
Kernel generik tidak otomatis memberikan transaksi untuk handler native arbitrer.

Skema input mendukung object tertutup (`additionalProperties:false`), required,
string, boolean, integer/number, enum, array berbatas, dan batas panjang/angka.
Kedalaman maksimum enam tingkat dan maksimal 50 field per object. Tipe internal
`json` dipakai hanya untuk envelope yang kemudian diperiksa validator khusus;
export schema MCP mengubah tipe ini menjadi schema JSON bebas. Ini subset schema
PAPbox, bukan implementasi lengkap JSON Schema.

`system/contracts.mjs` adalah sumber metadata layanan aplikasi sistem. Rute HTTP
bertindak sebagai controller yang meneruskan input ke `kernel.invoke`; rendering
browser adalah view. Event `service:completed` berisi nama layanan dan identitas,
tanpa input privat. `contracts.list` mengembalikan kontrak sistem dan modul data
yang tersedia bagi tenant, dengan izin `contracts.read`.

## Paket deklaratif v1 dan v2

Paket v1 bertanda tangan tetap didukung untuk konten teks read-only. Paket v2
memakai `format: "papbox.module/2"`; manifest v1 ditambah tepat dua field:

- `model`: schema object tertutup untuk data aplikasi.
- `dependencies`: objek `{moduleId: "1.0.0"}` dengan versi aktif yang tepat.

Contoh di [tasks.manifest.json](../examples/tasks.manifest.json). Gunakan CLI
penandatanganan yang sama seperti [SYSTEM.md](SYSTEM.md). `api` tetap `1` untuk
kompatibilitas kernel; format envelope v2 menambah kontrak data, bukan menaikkan
versi API kernel.

Setelah paket v2 dipasang, adapter menurunkan layanan dan rute:

| Operasi | HTTP POST | Izin |
| --- | --- | --- |
| List | `/api/modules/<id>/list` | `<id>.records.read` |
| Create | `/api/modules/<id>/create` | `<id>.records.create` |
| Update | `/api/modules/<id>/update` | `<id>.records.update` |
| Delete | `/api/modules/<id>/delete` | `<id>.records.delete` |

Semua operasi juga memerlukan `<id>.open`. Layanan generik yang setara adalah
`records.list/create/update/delete` dengan argumen `module`; rute modul memvalidasi
input sesuai kontraknya sebelum meneruskan ke layanan tersebut. Modul v1/bawaan
hanya memakai izin `<id>.open`, bukan fitur data.

List menerima `limit` 1–100 dan cursor UUID, lalu mengembalikan `items` serta
`nextCursor`. Create menerima `data` dan menetapkan owner dari pengguna sesi.
Update membutuhkan `id`, `revision`, dan `data` lengkap; revisi lama ditolak 409.
Delete memerlukan `id`, `revision`, dan `approved:true`. Isi model selalu divalidasi,
field tak dikenal ditolak, dan klien tidak boleh menyisipkan `owner`/`tenant`.

Data disimpan pada `module_records` dengan FK tenant/modul dan tenant/pengguna,
RLS, indeks owner, serta revision. Query PostgreSQL melakukan pagination dan filter
owner di SQL, tanpa memuat semua record ke snapshot metadata. Scope `own` berlaku
pada read/update/delete; create selalu menetapkan owner pemanggil meski scope all.

Browser menyediakan formulir berdasarkan schema dan aksi sesuai izin. Field
kompleks berupa JSON dan divalidasi server. Konten paket dan nilai record dirender
sebagai text node, bukan HTML atau JavaScript. Ini mekanisme aplikasi deklaratif
dasar, bukan implementasi transaksi POS, stok, CRM, atau faktur.

## Lifecycle dan kompatibilitas

Instalasi/update memeriksa tanda tangan Ed25519, registry kepercayaan operator,
API, dependensi, serta konfirmasi admin. Pemasangan aplikasi baru tidak memberi
anggota akses otomatis; admin harus menetapkan peran/izin yang sesuai.

Modul yang masih diperlukan aplikasi aktif tidak boleh dinonaktifkan/dihapus.
Update/rollback tidak boleh mengubah versi yang dipatok aplikasi aktif lain.
Model baru dan model rollback diperiksa terhadap seluruh record yang tersimpan,
bertahap per 100 row; jika tidak kompatibel, perubahan ditolak dan versi/data lama
utuh. Modul yang memiliki record tidak boleh di-uninstall. Nonaktifkan atau
arsipkan tenant terlebih dahulu sesuai kebutuhan retensi.

Tidak ada SQL migrasi arbitrer atau hook executable dari paket. Perubahan model
kompatibel dapat dilakukan lewat schema; transformasi data/destructive migration
memerlukan pekerjaan operator/developer tersendiri. Eksekusi kode pihak ketiga
serta sandbox belum didukung dan bukan jaminan yang diberikan tanda tangan.

## Peran dan delegasi

**Hak Akses** menyediakan peran khusus dengan grant `{permission: scope}`.
Admin dan member bawaan tidak dapat diedit/dihapus. Admin memperoleh seluruh izin
yang dikenal, member hanya akses akun/launcher. Semua pengguna aktif memperoleh
akses akun dasar; modul bisnis default-deny sampai diberi izin.

Izin sistem dipisah per aksi: misalnya `users.read/create/update/reset`,
`apps.read/install/enable/disable/uninstall/rollback`, `menus.read/update`,
`settings.read/update`, dan `roles.read/manage/assign`. Izin administratif hanya
mendukung `all`; itu berarti seluruh tenant saat ini, bukan lintas tenant.

Pemegang `roles.manage` yang bukan admin tidak boleh memberikan izin atau scope
di atas miliknya. Penugasan peran memerlukan `roles.assign` dan cakupan yang tidak
melebihi akses sendiri; admin tidak dapat ditetapkan oleh non-admin. Pengguna
berizin lebih rendah tidak boleh mengelola akun admin atau akun berizin lebih
tinggi. Perubahan grant peran mencabut sesi/token/permintaan persetujuan pengguna
terkait. Peran yang masih dipakai pengguna tidak dapat dihapus.
