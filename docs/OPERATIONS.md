# Operasi core PAPbox

Jalankan migrasi sebelum upgrade server. Versi saat ini memerlukan migrasi
`005_mfa_approvals.sql`. Pastikan semua instance memakai kode, database, kunci MFA,
dan registry penerbit yang konsisten. Tidak ada DDL otomatis saat startup.

## Kesehatan dan log

- `GET /healthz`: liveness proses, 200 tanpa data tenant.
- `GET /readyz`: memeriksa koneksi dan skema PostgreSQL yang diperlukan (atau
  keterbacaan store JSON), 200 ready atau 503 unavailable. Tidak memaparkan error
  database/credential ke pemanggil.
- Response menyertakan `X-Request-Id`. Server CLI menulis log JSON berisi request
  ID, metode, status dan durasi; error hanya kode, tanpa body/password/cookie,
  query string, token email, secret MFA, atau URL database.

Kumpulkan log melalui platform deployment. Endpoint tersebut bukan platform
monitoring/alerting terkelola; pasang probe dan alarm sesuai infrastruktur Anda.

## Lifecycle tenant

Operator menggunakan CLI; administrator tenant tidak memiliki akses HTTP untuk
mengubah tenant lain. Contoh:

```sh
npm run tenant:operate -- --action status --id toko-satu --status suspended --confirm toko-satu
npm run tenant:operate -- --action status --id toko-satu --status archived --confirm toko-satu
npm run tenant:operate -- --action status --id toko-satu --status active --confirm toko-satu
```

Suspend/archive menghentikan login dan akses layanan, serta mencabut seluruh
sesi, token reset, dan approval. Aktivasi kembali tidak menghidupkan sesi lama.
Archive adalah retensi data; bukan penghapusan fisik. Perubahan dicatat sebagai
aksi operator pada audit tenant.

## Backup tenant, penghapusan, dan restore

### Backup melalui Pengaturan

Buka **Pengaturan → Backup data → Unduh backup**. Fitur membutuhkan izin
`settings.read` untuk membuka Pengaturan dan `backups.export` untuk mengunduh;
admin bawaan memilikinya. Tombol tidak ditampilkan bagi pengguna tanpa izin.
Masukkan kata sandi akun saat ini dan kode MFA/recovery baru bila MFA aktif,
lalu konfirmasikan unduhan. Percobaan dibatasi per akun/tenant; respons tidak
dicache dan tidak tersedia lewat tool MCP.

File JSON hanya berisi tenant dari sesi login, meliputi seluruh data modul,
pengguna, peran, menu, pengaturan, dan audit lengkap. Snapshot dibuat dalam
transaksi yang sama dengan verifikasi akun. Recovery code yang dipakai untuk
verifikasi sudah dianggap terpakai di backup. Aktivitas unduhan dicatat dalam
audit setelah snapshot dibuat. Tidak ada pemilihan tenant lain melalui input.
Backup UI dapat dibuat ketika tenant aktif; unduhan tidak mengubah data bisnis.
Pemulihan penuh menggunakan prosedur operator di bawah ke ID tenant yang belum
ada. Tombol unduh tidak menimpa tenant aktif atau memulihkan sesi lama.

File backup berisi seluruh metadata, role, model records, audit lengkap, hash
password, serta secret MFA terenkripsi. File sangat sensitif: mode 0600, simpan
terenkripsi di luar mesin, dan sertakan backup kunci enkripsi MFA secara terpisah.
Tidak ada plaintext token sesi/password di backup. SHA-256 memeriksa integritas,
bukan membuktikan identitas pembuat atau mengenkripsi file.

Untuk backup CLI yang akan dipakai sebagai prasyarat purge, arsipkan terlebih dahulu agar penulisan aplikasi berhenti, lalu:

```sh
npm run tenant:operate -- --action export --id toko-satu --file /secure/backups/toko-satu.json
```

CLI menolak menimpa file yang sudah ada. Untuk menghapus fisik data, tinjau backup
dan kebijakan retensi, kemudian berikan konfirmasi ID persis:

```sh
npm run tenant:operate -- --action purge --file /secure/backups/toko-satu.json --confirm toko-satu
```

Purge memerlukan tenant archived dan backup yang identik dengan snapshot terkini.
Checksum/data yang berubah ditolak. PostgreSQL memakai `DATABASE_MIGRATION_URL`
sebagai credential operator khusus untuk menghapus audit; role runtime sengaja
tidak memiliki izin ini. Semua tabel core tenant, record, dan audit dihapus dalam
satu transaksi. CLI ini hanya mendukung skema core dan modul deklaratif yang
dikelola PAPbox; tabel eksternal buatan sendiri memerlukan prosedur tersendiri.

Restore hanya ke ID tenant yang belum ada, dalam satu transaksi:

```sh
npm run tenant:operate -- --action restore --file /secure/backups/toko-satu.json --confirm toko-satu
```

Hasil restore selalu archived, dengan seluruh sesi/token/approval lama dicabut.
Periksa data, registry kepercayaan paket, dan kunci MFA sebelum mengaktifkan.
Modul dan user ID tetap sama. Tidak ada rename tenant otomatis. Import backup
hanya dari sumber operator tepercaya, bukan file upload publik.

Tes PostgreSQL melakukan archive, export lengkap, penolakan purge oleh runtime,
purge operator, restore role/record/audit/MFA, aktivasi, dan login ulang. Backup
per tenant ini tidak menggantikan backup cluster (`pg_dump`/PITR), konfigurasi,
atau file kunci. Prosedur backup cluster ada di [DATABASE.md](DATABASE.md).

## MFA

**Akun Saya** menyediakan pendaftaran TOTP (SHA-1, enam digit, 30 detik),
konfirmasi kode, sepuluh recovery code sekali pakai, dan penonaktifan dengan
password serta faktor kedua. Secret hanya ditampilkan saat pendaftaran;
recovery code hanya ditampilkan sekali. Tidak memakai layanan QR eksternal.

`PAPBOX_ENCRYPTION_KEY` adalah 32 byte hex, konsisten pada semua instance. Secret
TOTP dienkripsi AES-256-GCM, diikat ke ID tenant/pengguna, sementara recovery code
di-hash. Enrolment kedaluwarsa sepuluh menit. Window TOTP ±1 langkah dan counter
yang sudah dipakai ditolak. Perubahan MFA mencabut seluruh sesi/token/approval.
Login menerima field opsional `code` (TOTP atau recovery code). Reset password
lewat email/admin tidak menonaktifkan MFA.

Environment development yang disiapkan telah memiliki key lokal dalam `.env`
yang diabaikan Git. Untuk environment baru, buat key sekali melalui generator
kriptografi, simpan pada secret manager/konfigurasi privat, lalu atur variabel
tersebut. Jangan mengganti key bila database lama masih memiliki secret MFA:
rotasi membutuhkan re-enkripsi terencana. Kehilangan key memerlukan recovery
code atau pemulihan operator; backup database saja tidak cukup.

Tanpa key, pendaftaran MFA dinonaktifkan dan akun tanpa MFA tetap bisa dipakai.
Akun MFA tidak boleh diam-diam melewati faktor kedua karena key hilang. Jika
pengguna kehilangan authenticator dan semua recovery code, operator dapat
mereset password sekaligus menghapus konfigurasi MFA dengan konfirmasi eksplisit:

```bash
read -r -s -p 'Kata sandi baru: ' papbox_password
printf '\n'
printf '%s\n' "$papbox_password" | npm run account:recover -- \
  --tenant toko-satu --email user@example.com --disable-mfa \
  --confirm toko-satu:user@example.com
unset papbox_password
```

Tindakan dicatat `operator.mfa-recovery`. Verifikasi identitas penerima melalui
prosedur operator; CLI lokal bukan layanan pemulihan publik.
