# Pengujian core

```sh
npm test
npm run check
```

Tes default tidak memerlukan PostgreSQL; integrasi ditandai skipped bila URL tes
tidak diberikan. Untuk wajib menjalankan integrasi pada cluster development yang
sudah memiliki role `papbox_app`:

```sh
npm run test:postgres
```

Atur `TEST_DATABASE_ADMIN_URL` dan `TEST_DATABASE_URL` secara privat seperti
[DATABASE.md](DATABASE.md). Suite membuat database acak, menjalankan migrasi,
kontrak akun, peran/record, MFA, MCP, dan restore, lalu menghapus hanya database
sementara tersebut. Tidak mengubah data aplikasi utama.

Tes mencakup registrasi modul atomik, input schema, tenant/RLS, own/all, delegasi
tanpa eskalasi, revision conflicts, dependensi/model update, token/sesi/recovery
single-use, vektor RFC TOTP, persetujuan manusia MCP dan replay, backup/purge/
restore lengkap, serta mail provider tiruan. Runtime tidak pernah mengirim email
nyata saat tes default/integrasi.

## Browser opsional

Runtime aplikasi tetap hanya memerlukan `pg`. Pengujian browser menggunakan
Playwright Core sebagai alat pengembangan opsional, dipasang di luar checkout:

```sh
npm install --prefix /tmp/papbox-browser --cache /tmp/papbox-npm-cache \
  --no-package-lock --no-audit --no-fund playwright-core
PAPBOX_PLAYWRIGHT_MODULE=/tmp/papbox-browser/node_modules/playwright-core/index.mjs \
  PAPBOX_CHROMIUM=/usr/bin/chromium node scripts/browser-smoke.mjs
```

Chromium harus sudah terpasang dari sumber resmi. Skrip memakai profile/data dan
salinan aset sementara, bukan akun/data pengguna. Ia memeriksa peran khusus,
form CRUD model, enrollment MFA dan recovery login, persetujuan MCP melalui UI,
layout ponsel, pergantian service worker tanpa cache privat, serta fallback offline.
Screenshot fixture ada di `/tmp/papbox-core-mobile.png`.

Pemeriksaan tambahan melalui Chrome DevTools membuktikan installability tanpa
error dan pemasangan/uninstall PWA pada profile Chromium sementara. Dalam mode
headless, launch yang diuji masih melaporkan `display-mode: browser`; tampilan
standalone pada browser berjendela/perangkat nyata belum tervalidasi. Tidak ada
klaim pengujian perangkat fisik atau readiness produksi dari pemeriksaan ini.
