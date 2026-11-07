# Status implementasi core

## Tersedia dan diuji

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
- PWA manifest, ikon, cache aset publik saja, fallback offline, serta alur worker
  update yang diperiksa dengan Chromium pada fixture terisolasi.

Uji Node mencakup kontrak negatif dan happy path pada JSON serta PostgreSQL.
Uji browser memakai data uji sementara; installability dan pemasangan Chromium diuji. Launch pada mode headless masih melaporkan display-mode browser; standalone berjendela/perangkat fisik belum tervalidasi. Langkah reproduksi ada di [TESTING.md](TESTING.md).

## Tersedia, tetapi perlu konfigurasi operator

- **Email Google Workspace:** adapter Gmail/OAuth dan alur reset diuji memakai
  provider tiruan. Pengiriman nyata belum diuji karena client ID/secret, refresh
  token, sender, dan origin HTTPS publik belum dikonfigurasi. Delivery masih
  best-effort tanpa outbox/retry persisten.
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
- **Modul bisnis POS, Inventory, CRM, Invoice:** masih katalog/fondasi, belum ada
  transaksi penjualan, stok, pelanggan, atau faktur.
- **Kesiapan produksi penuh:** belum diklaim; lakukan review keamanan/deployment,
  uji provider nyata dan restore cluster, serta validasi perangkat target.
