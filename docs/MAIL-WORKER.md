# Outbox email pemulihan

Permintaan `/api/forgot` tidak mengirim email di proses web. Hash token reset dan
pekerjaan outbox terenkripsi disimpan dalam satu transaksi; jika enqueue gagal,
perubahan token juga di-rollback. Respons generik berarti permintaan diterima,
bukan bukti pesan sudah masuk inbox.

## Setup

1. Jalankan `npm ci` dan `npm run db:migrate` (memerlukan migrasi
   `006_mail_outbox.sql`).
2. Konfigurasikan Google mail menurut [GOOGLE-WORKSPACE.md](GOOGLE-WORKSPACE.md).
3. Pastikan `PAPBOX_ENCRYPTION_KEY` tersedia dan sama pada web serta seluruh
   worker; key dipakai untuk secret MFA dan payload email. Jangan menggantinya
   di atas database lama. Backup key secara privat dan terpisah.
4. Mulai web dengan `npm start`, lalu worker pada proses terpisah:

```sh
npm run mail:worker -- --tenant default
# Lebih dari satu tenant ditugaskan secara eksplisit:
npm run mail:worker -- --tenant default --tenant toko-satu
# Satu putaran: maksimal satu pekerjaan per tenant, cocok untuk smoke/cron:
npm run mail:worker -- --tenant default --once
```

Runtime email web dan worker mewajibkan PostgreSQL; JSON hanya untuk pengujian in-process karena penulisan file tidak aman untuk beberapa proses. Worker memakai `DATABASE_URL` runtime dengan RLS, bukan akun migrasi/superuser.
Daftar tenant ditetapkan operator secara eksplisit agar worker tidak memerlukan
privilege untuk enumerasi lintas tenant. Tambahkan tenant baru ke penugasan worker
setelah provisioning. Mode loop memeriksa tiap tenant setiap lima detik.
SIGTERM/SIGINT menghentikan polling; pekerjaan provider yang sedang berjalan
diselesaikan sebelum koneksi database ditutup. Gunakan supervisor deployment
untuk menjalankan ulang proses yang berhenti.

Jangan menjalankan worker sungguhan tanpa akun pengirim dan penerima uji yang
diotorisasi. Pengujian otomatis menggunakan provider tiruan dan tidak mengirim
pesan nyata. Tanpa flag email/konfigurasi/kunci, CLI gagal secara eksplisit.

## Status dan retry

**Pengaturan → Pengiriman email** menampilkan status, jumlah percobaan, kode
kegagalan, dan aktivitas worker terakhir. Dibutuhkan izin `mail.read` serta akses
Pengaturan. `mail.manage` mengizinkan tombol **Coba ulang email** untuk pekerjaan
`dead` yang tokennya masih berlaku. Admin bawaan memiliki keduanya. Retry manual
dikonfirmasi, diaudit, lalu mengembalikan pekerjaan ke antrean; tidak langsung
mengirim di proses web. Token yang kedaluwarsa memerlukan permintaan pemulihan baru.

Layanan `mail.status` tidak mengembalikan payload, token, alamat penerima atau
reset hash. Status UI tidak menjadi tool MCP. Heartbeat berarti worker pernah
memeriksa tenant, bukan jaminan kredensial Google atau inbox penerima siap.

| Status | Arti |
| --- | --- |
| `pending` | Menunggu waktu pengiriman/retry |
| `processing` | Diklaim worker dengan lease |
| `sent` | Provider menerima pengiriman dan hasil tersimpan |
| `cancelled` | Token kedaluwarsa/dicabut, akun/tenant tidak aktif, atau diganti |
| `dead` | Batas percobaan habis; perlu pemeriksaan operator |

Retry otomatis maksimal lima percobaan, exponential backoff mulai 30 detik.
Pekerjaan dengan sisa validitas kurang dari 15 detik tidak dikirim. Token baru,
perubahan password/peran/status, suspend/archive atau restore tenant membatalkan
pekerjaan lama. Payload dibuang setelah sukses atau pembatalan. Riwayat terminal
dibatasi 100 pekerjaan terbaru dan maksimal 24 jam sejak pembuatan; cleanup
berjalan saat enqueue maupun saat worker memeriksa tenant, sehingga riwayat tidak tumbuh tanpa batas ketika worker berhenti. Audit permintaan tetap tersimpan.

## Lease, crash dan batas delivery

Claim dan perubahan status dijalankan di transaksi dengan lock tenant yang sama
pada semua instance. Provider I/O berjalan di luar transaksi. Lease 60 detik
mencegah pengambilan normal bersamaan; worker lain dapat mengambil ulang setelah
lease habis jika worker pemilik berhenti. Hasil worker lama ditolak jika lease
sudah diganti. Google request memiliki timeout yang lebih pendek dari lease.

Semantik pengiriman adalah **at-least-once**, bukan exactly-once. Jika Gmail sudah
menerima pesan tetapi worker mati sebelum menyimpan hasil, retry dapat membuat
pesan duplikat. Header `Message-ID` stabil per job membantu pelacakan tetapi tidak
menjamin deduplikasi Gmail. Token tetap sekali pakai. Permintaan yang sudah
masuk provider tidak bisa ditarik kembali saat token dicabut; tautannya akan
ditolak server. Retrying tidak pernah menghidupkan kembali token lama.

## Penyimpanan dan pemulihan

`mail_outbox` memiliki FK tenant/pengguna, RLS FORCE, status, expiry, attempts,
reset hash, lease dan payload AES-256-GCM. AAD mengikat cipher ke tenant/job ID.
Alamat serta token tidak disimpan plaintext pada outbox atau log. Kolom
`tenants.mail_worker_seen_at` menyimpan heartbeat per tenant.

Backup tenant menyertakan antrean terenkripsi. Restore mencabut token/sesi dan
membatalkan pekerjaan lama, sehingga tidak mengirim ulang email dari backup.
Backup cluster/PITR yang memulihkan state lama tetap memerlukan review operator
sebelum worker dijalankan. Jangan menganggap restore cluster berarti provider
belum pernah menerima pesan.
