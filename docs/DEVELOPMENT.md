# Pengembangan PAPbox 0.1

Versi ini adalah fondasi platform yang dapat dijalankan, bukan SaaS produksi.
Kernel, aplikasi sistem, dan frontend memakai API native. Adapter PostgreSQL memakai driver `pg` yang disetujui pemilik; lihat [panduan database](DATABASE.md).

## Menjalankan

Untuk setup PostgreSQL lengkap, mulai dari [panduan database](DATABASE.md), termasuk Docker, `.env`, migrasi, dan pemeriksaan kesiapan. Perintah singkat di bawah mengasumsikan database sudah siap, atau `DATABASE_URL` tidak diset untuk mode JSON.

Diuji dengan Node.js 24.22.1. Versi minimum resmi belum diputuskan.

```sh
cd /workspace/papbox
npm ci
npm start
```

Server secara default mendengarkan `127.0.0.1:3000`. Buka aplikasi lalu buat
administrator pertama dengan kata sandi minimal 12 karakter. Tidak ada akun atau
kata sandi bawaan. Setup pertama dibatasi koneksi loopback; deployment remote
memerlukan alur provisioning administrator yang ditinjau terpisah.

`PORT`, `HOST`, dan `PAPBOX_DATA` dapat menyesuaikan port, binding, dan lokasi data.
`NODE_ENV=production` mengaktifkan cookie Secure dan pemeriksaan origin HTTPS;
gunakan terminasi TLS yang mempertahankan Host. Jangan membuka binding jaringan
publik sebelum meninjau deployment, autentikasi, pemulihan akun, dan backup.

```sh
npm test
npm run check
```

Pengujian menggunakan penyimpanan sementara dan tidak mengubah data aplikasi.
Jika `DATABASE_URL` diset, server memakai PostgreSQL dan membutuhkan migrasi terlebih dahulu. Instruksi di paragraf ini hanya untuk adapter JSON. Data JSON lokal ada di `storage/data.json` (diabaikan Git), dengan kata sandi scrypt
bersalt. Hash sesi disimpan pada adapter yang dipilih dan kedaluwarsa setelah delapan jam. Perubahan akses/kata sandi mencabut sesi; lihat [kontrak sistem](SYSTEM.md). Backup file data hanya saat server dihentikan. Jalankan satu
proses server: antrean penulisan dan rename atomik bukan penguncian multiproses.

## Fitur yang tersedia

- Setup administrator, login/logout, peran admin dan anggota.
- Launcher responsif dengan pencarian dan menu berdasarkan izin.
- Katalog metadata modul bawaan: pasang dengan konfirmasi, aktif/nonaktif, hapus.
- Pengaturan nama, urutan, dan visibilitas menu.
- Pembuatan/edit/status pengguna, perlindungan admin terakhir, dan reset kata sandi sekali pakai.
- Akun Saya untuk mengganti password dan mencabut sesi; provisioning tenant lewat CLI operator.
- Instalasi/update/rollback paket deklaratif bertanda tangan Ed25519.
- Pengaturan nama ruang kerja dan audit mutasi.
- Manifest PWA, ikon orisinal PNG/SVG, service worker, fallback offline, dan tombol
  pembaruan ketika worker baru tersedia. Ubah versi cache ketika mengubah aset.
- Data autentikasi dan API tidak dicache. Offline tidak menyediakan data bisnis.

POS sudah memiliki [operasi kasir tunai](POS.md). Inventory, CRM, dan Invoice belum memiliki operasi bisnis. Katalog bawaan tidak memuat kode pihak ketiga. Paket deklaratif bertanda tangan didukung sesuai [SYSTEM.md](SYSTEM.md), tanpa mengeksekusi kode pihak ketiga. Penghapusan modul menghapus registrasi/menu dan histori paketnya.

## Kontrak implementasi awal

Ini pilihan sementara untuk implementasi lokal, bukan keputusan arsitektur final:
PostgreSQL sebagai adapter utama (JSON untuk tes ringan), DOM browser native sebagai rendering, dan
identitas tenant dari sesi server. Tidak ada API pendaftaran tenant publik; setup membuat `default` dan CLI operator dapat memprovisioning tenant lain. Uji layanan membuktikan pemisahan dua tenant, tetapi belum merupakan
validasi isolasi SaaS produksi.

`core/kernel.mjs` mendaftarkan layanan bernama dengan izin wajib. Pemanggilan
`kernel.invoke(name, context, input)` menolak akses tanpa tenant, pengguna, atau
izin. Adapter tepercaya harus membentuk context dari identitas terautentikasi,
bukan menerima context klien. Event `service:completed` berisi identitas dan nama
layanan tanpa kata sandi atau payload privat.

`system/services.mjs` menyediakan `launcher.read`, `apps.list/change`,
`menus.list/save`, `users.list/create`, dan `settings.list/save`. HTTP adapter
menggunakan `POST /api/services/<nama>` dan JSON. Aturan bisnis tidak ditempatkan
pada handler HTTP. Operator CLI dan adapter MCP memakai layanan/kernel yang sama sesuai cakupannya; adapter MCP terbatas kini tersedia sesuai [MCP.md](MCP.md).

`Store.transact` membuat snapshot, menjalankan perubahan, lalu menyimpan dengan
rename atomik. Jika validasi/operasi gagal, perubahan tidak disimpan. Audit mutasi
berada dalam transaksi yang sama. Audit ini lokal, belum immutable/tamper-proof.

## Verifikasi dan pekerjaan berikutnya

Uji Node mencakup autentikasi HTTP, izin anggota, origin, validasi, lifecycle modul,
visibilitas menu, persistensi, isolasi tenant, rollback, dan serialisasi penulisan.
Pemeriksaan Chromium manual otomatis pada onboarding mencakup desktop dan ponsel,
setup, instalasi katalog, pencarian, pengaturan, worker, dan fallback offline.
Instalasi standalone pada perangkat nyata belum diverifikasi.

Langkah berikutnya: tetapkan kontrak bisnis modul pertama dan deployment operasional. Kontrak modul, izin granular, MFA, MCP dengan persetujuan UI, serta lifecycle/backup tenant kini tersedia; lihat [status implementasi](STATUS.md). SSO ditunda oleh pemilik dan paket executable belum didukung. POS tunai sudah tersedia; stok Inventory, pelanggan CRM, dan faktur Invoice masih tahap berikutnya.
