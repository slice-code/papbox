# MCP melalui stdio

Adapter MCP native tidak membutuhkan SDK npm tambahan. Ia memakai kernel dan
layanan yang sama dengan HTTP, tanpa akses database bebas atau eksekusi kode
modul pihak ketiga. Endpoint HTTP MCP belum disediakan.

## Menyiapkan sesi

Gunakan akun dengan peran terbatas, bukan otomatis administrator. Dari root
checkout, buat file sesi mode 0600 di lokasi privat di luar Git. Bash:

```bash
read -r -s -p 'Kata sandi: ' papbox_password
printf '\n'
read -r -s -p 'Kode MFA/recovery jika aktif (kosong jika tidak): ' papbox_code
printf '\n'
printf '%s\n%s\n' "$papbox_password" "$papbox_code" | npm run session:create -- \
  --tenant toko-satu --email user@example.com --out /secure/path/papbox-session
unset papbox_password papbox_code
```

Jangan mencetak atau menyalin isi file sesi ke chat, Git, konfigurasi publik, atau
log. Sesi maksimal delapan jam dan mengikuti pencabutan password/peran/status/MFA.
Path file disetel sebagai `PAPBOX_MCP_SESSION_FILE`. Adapter menolak file yang
bisa dibaca group/other atau bukan milik pengguna OS yang menjalankannya.

Contoh konfigurasi client MCP (sesuaikan executable/path):

```json
{
  "mcpServers": {
    "papbox": {
      "command": "node",
      "args": ["--env-file-if-exists=.env", "scripts/mcp.mjs"],
      "cwd": "/workspace/papbox",
      "env": { "PAPBOX_MCP_SESSION_FILE": "/secure/path/papbox-session" }
    }
  }
}
```

Client tanpa dukungan `cwd` harus menjalankan wrapper lokal yang `cd` ke checkout.
Gunakan Node langsung agar banner npm tidak merusak stdout protokol. Client boleh
memakai `npm --silent run mcp` dengan working directory yang benar.

## Protokol dan penemuan

JSON-RPC 2.0 memakai satu pesan per baris. Input buffer dibatasi 256 KiB. Adapter
mendukung initialize, ping, tools/list, tools/call, resources/list dan
resources/read. Versi protokol yang didukung: 2024-11-05 dan 2025-03-26; versi lain
dinegosiasikan ke 2025-03-26. Log/error proses hanya di stderr, bukan stdout.

Daftar tool dibentuk ulang dari izin sesi terbaru. Tool baca mencakup launcher,
katalog aplikasi, menu/pengaturan, dan kontrak jika diizinkan. Modul model
menyediakan `<id>.records.list/create/update/delete` sesuai grant pengguna.
Resource `papbox://contracts` memerlukan `contracts.read`.

Password, token reset, pengelolaan peran, provisioning/purge tenant, registrasi
public key, dan instalasi paket tidak diekspos sebagai tool. Tidak ada tool untuk
SQL, filesystem, shell, atau mengirim email bebas.

## Persetujuan manusia untuk mutasi

Tool mutasi hanya membuat permintaan `pending` di database. Argumen `approved`
dari model tidak menggantikan persetujuan manusia. Alur:

1. Client memanggil tool mutasi; hasilnya `approvalId` dan expiry lima menit.
2. Pengguna berizin membuka **Persetujuan AI** pada browser, memeriksa nama
   layanan serta argumen persis, lalu memilih Setujui/Tolak.
3. Client memanggil `approvals.execute` dengan ID setelah disetujui.
4. Server memeriksa pemohon, versi autentikasi, izin dan kepemilikan terbaru,
   status approval, expiry, serta revisi record; kemudian mengeksekusi sekali.

Eksekusi, audit, dan penandaan `used` berada dalam transaksi yang sama. Replay,
permintaan ditolak/kedaluwarsa, atau sesi pemohon yang dicabut tidak dapat
mengeksekusi ulang. Persetujuan tidak memberikan izin baru kepada pemohon.
Perubahan data setelah persetujuan bisa menyebabkan konflik revisi; buat
permintaan baru dengan data terbaru. Tidak ada tombol browser untuk menjalankan
permintaan sebagai identitas approver.

Antrean memerlukan `approvals.read` untuk ditampilkan dan `approvals.approve`
untuk keputusan. Kedua izin bersifat sensitif karena preview dapat berisi data
privat tenant. Batasi peran approver dan perlakukan isi preview sebagai data tak
tepercaya. Antrean dibatasi 20 permintaan aktif per pemohon.
