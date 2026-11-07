# Setup Google Workspace: email dan persiapan SSO

SSO **ditunda atas arahan pemilik**. Rilis ini tidak mengaktifkan login Google;
login password/MFA tetap berlaku. Dokumen ini menyediakan setup yang dapat
disiapkan sekarang tanpa mengaktifkan SSO. Adapter email Gmail tersedia terpisah.

## Email pemulihan melalui Gmail API

Gunakan akun Workspace khusus pengirim. Pada Google Cloud Console:

1. Buat/pilih project organisasi dan aktifkan Gmail API.
2. Konfigurasikan OAuth consent untuk organisasi (Internal bila tersedia).
3. Buat OAuth client khusus pengiriman email, terpisah dari client SSO.
4. Admin Workspace meninjau aplikasi/scopes dan kebijakan akses API organisasi.
5. Operator memperoleh refresh token akun pengirim melalui consent OAuth resmi
   dengan scope `https://www.googleapis.com/auth/gmail.send` dan offline access.
   Gunakan alur OAuth resmi Anda; PAPbox belum menyediakan UI bootstrap token.
6. Simpan client secret dan refresh token pada secret manager/environment settings,
   bukan chat, Git, argumen command, atau log. Pastikan token milik akun pengirim.

Konfigurasi runtime:

| Variabel | Isi |
| --- | --- |
| `PAPBOX_EMAIL_ENABLED` | `true` hanya sesudah seluruh konfigurasi siap |
| `PAPBOX_PUBLIC_URL` | Origin HTTPS publik, misalnya `https://app.example.com` |
| `GOOGLE_MAIL_CLIENT_ID` | OAuth client ID untuk Gmail |
| `GOOGLE_MAIL_CLIENT_SECRET` | Secret client, simpan secara privat |
| `GOOGLE_MAIL_REFRESH_TOKEN` | Refresh token dengan izin gmail.send |
| `GOOGLE_MAIL_FROM` | Email Workspace pengirim yang diotorisasi |

Server memvalidasi konfigurasi ketika email diaktifkan. Origin publik tidak boleh
memiliki username/password, path aplikasi, query, atau fragment. Pastikan HTTPS
benar dan URL dapat diakses penerima. Domain jaringan yang diperlukan:
`oauth2.googleapis.com` dan `gmail.googleapis.com`. Jalankan Node dengan dukungan
proxy environment (`npm start` sudah memakai `--use-env-proxy`), pertahankan TLS
verification serta CA trust yang disediakan environment.

Alur pemulihan: pengguna memilih **Minta pemulihan lewat email**, mengisi tenant
serta email. Respons generik sama untuk akun tidak ditemukan/nonaktif. Token acak
sekali pakai berlaku 15 menit. Tautan memakai fragment `/#reset=...` agar token
tidak masuk request URL server; frontend menghapus fragment setelah membacanya.
MFA yang sudah aktif tetap diperlukan saat login setelah reset.

Pengiriman bersifat **best-effort di proses web**, tanpa durable outbox/retry
worker. Respons menyatakan permintaan diproses, bukan menjamin pesan terkirim.
Kegagalan dicatat sebagai event tanpa alamat, token, atau isi email. Jika proses
mati atau Google menolak pesan, pengguna perlu meminta ulang. Logikanya diuji
menggunakan provider tiruan; pengiriman nyata memerlukan kredensial dan uji
operator pada akun yang diotorisasi. Jangan menandai email produksi siap sebelum
uji tersebut dan monitoring/retry operasional ditetapkan.

Jika email tidak diaktifkan, tombolnya tidak ditampilkan dan endpoint menolak
permintaan secara eksplisit. Alur token admin dan recovery operator tetap tersedia.
Tidak ada tool MCP untuk mengirim email bebas.

## Persiapan SSO Google yang belum diaktifkan

Siapkan **OAuth web client terpisah** dengan consent internal dan scope minimal
`openid email profile`; jangan memberi client SSO akses pengiriman Gmail.
Catat secara privat client ID/secret dan domain Workspace yang diizinkan. Rencana
callback adalah `https://<origin-papbox>/api/auth/google/callback`, tetapi route
tersebut **belum aktif**. Mendaftarkannya di Console tidak mengaktifkan SSO PAPbox.
Jangan mengubah client produksi yang sudah dipakai aplikasi lain.

Nama konfigurasi yang disediakan untuk tahap aktivasi berikutnya (belum dibaca
runtime rilis ini):

```dotenv
# GOOGLE_SSO_CLIENT_ID=
# GOOGLE_SSO_CLIENT_SECRET=
# GOOGLE_WORKSPACE_DOMAIN=
# GOOGLE_SSO_REDIRECT_URI=https://app.example.com/api/auth/google/callback
```

Aktivasi kelak harus mencakup state sekali pakai, PKCE, nonce, validasi signature
JWKS/issuer/audience/expiry/verified email dan domain hosted Workspace. Mengirim
parameter `hd` ke Google saja bukan pemeriksaan domain. Account linking hanya
untuk pengguna tenant yang sudah diotorisasi, tanpa auto-admin dari email/domain.
Kebijakan MFA, logout, dan pencabutan sesi tetap harus berlaku.

Sebelum tahap SSO, operator perlu menetapkan origin publik dan domain Workspace.
Karena belum ditentukan dan SSO ditunda, tidak ada secret atau redirect aktif
SSO yang ditambahkan ke konfigurasi environment.
