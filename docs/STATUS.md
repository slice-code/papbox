# Status implementasi core

## Tersedia dan diuji

- Aplikasi POS native: katalog, keranjang, checkout tunai IDR, struk, riwayat dan pembatalan, dengan izin kasir serta idempotensi. Lihat [POS.md](POS.md).

- Kernel layanan, kontrak modul API 1, schema input tertutup, registry/routing,
  dependensi versi tepat, dan registrasi atomik.
- Launcher responsif, pencarian, menu, pengguna, pengaturan, peran khusus dan izin
  per aksi; scope own/all diperiksa di backend dan query record.
- Password/sesi persisten, pencabutan akses, token reset sekali pakai, MFA TOTP,
  recovery code dan pemulihan operator.
- PostgreSQL dengan migrasi checksum, transaksi, RLS, FK, indeks owner/revisi,
  pagination SQL, dan concurrency checks.
- Paket deklaratif v1/v2 Ed25519, registry kepercayaan, model CRUD, pemeriksaan
  kompatibilitas data/dependensi, serta update/rollback yang gagal secara atomik.
- Backup tenant melalui Pengaturan dengan izin khusus, password/MFA dan unduhan privat.
- Provisioning, suspend/archive/activate tenant, backup lengkap per tenant,
  purge dengan backup cocok, dan restore yang tidak menghidupkan sesi lama.
- Adapter MCP stdio, penemuan tool berdasarkan izin, resource kontrak, serta
  persetujuan manusia di UI sebelum mutasi dieksekusi sekali oleh pemohonnya.
- Health/readiness probe dan log JSON tanpa payload credential.
- Outbox email terenkripsi, worker terpisah, lease/retry/backoff, pembatalan token lama, serta status dan retry manual di Pengaturan.
- PWA manifest, ikon, cache aset publik saja, fallback offline, serta alur worker
  update yang diperiksa dengan Chromium pada fixture terisolasi.

Uji Node mencakup kontrak negatif dan happy path pada JSON serta PostgreSQL.
Uji browser memakai data uji sementara; installability dan pemasangan Chromium diuji. Launch pada mode headless masih melaporkan display-mode browser; standalone berjendela/perangkat fisik belum tervalidasi. Langkah reproduksi ada di [TESTING.md](TESTING.md).

## Tersedia, tetapi perlu konfigurasi operator

- **Email Google Workspace:** adapter Gmail/OAuth dan alur reset diuji memakai
  provider tiruan. Pengiriman nyata belum diuji karena client ID/secret, refresh
  token, sender, dan origin HTTPS publik belum dikonfigurasi. Outbox dan retry persisten sudah tersedia; aktivasi Google serta uji pengiriman nyata masih menunggu konfigurasi operator.
- **MFA produksi:** kunci enkripsi privat harus sama pada semua instance dan
  dibackup terpisah. Development memiliki key lokal; jangan menyalinnya ke Git.
- **Deployment:** monitoring/alerting, backup cluster/PITR, TLS publik, secret
  manager dan retensi harus dipasang sesuai infrastruktur tujuan. Tes restore
  tenant tidak membuktikan disaster recovery seluruh cluster.

## Ditunda atau belum didukung

- **SSO Google:** ditunda oleh pemilik; setup OAuth didokumentasikan tetapi
  callback/login belum aktif.
- **Paket executable pihak ketiga:** tidak dijalankan. Tidak ada sandbox atau
  arbitrary SQL migration/hook yang diklaim aman. Kontrak saat ini deklaratif;
  menjalankan kode pihak ketiga memerlukan desain isolasi terpisah.
- **Inventory, CRM, Invoice:** masih katalog/fondasi. POS sudah menyediakan penjualan tunai; integrasi stok dan payment gateway belum tersedia.
- **Kesiapan produksi penuh:** belum diklaim; lakukan review keamanan/deployment,
  uji provider nyata dan restore cluster, serta validasi perangkat target.
