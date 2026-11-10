# PAPbox

**Plug and Play Box** — a lightweight, AI-native, modular SaaS application platform.

> Status: fondasi platform v0.1 dapat dijalankan. Modul bisnis masih tahap kontrak awal.

## Mulai pengembangan

Gunakan Node.js 24 (versi yang telah diuji), lalu `npm ci`. Untuk pengembangan dengan PostgreSQL, ikuti [panduan database](docs/DATABASE.md): siapkan `.env`, jalankan `docker compose up -d --wait`, `npm run db:migrate`, lalu `npm start`. Adapter JSON tetap tersedia bila `DATABASE_URL` tidak diatur. Buka aplikasi pada port 3000 dan buat administrator pertama; tidak ada akun bawaan. Jalankan `npm test`, `npm run test:postgres`, dan `npm run check` sesuai panduan.

Launcher, autentikasi/MFA, izin per aksi dan data milik sendiri, peran khusus, sesi PostgreSQL bersama, provisioning/lifecycle tenant, paket deklaratif bertanda tangan dengan model CRUD, serta MCP dengan persetujuan manusia sudah tersedia. POS menyediakan katalog bergambar, kategori, keypad jumlah/harga/diskon dengan izin khusus, penjualan tunai, struk, dan riwayat; Inventory, CRM dan Invoice masih berupa fondasi.

- [Panduan aplikasi POS](docs/POS.md)
- [Kontrak modul dan hak akses](docs/MODULES.md)
- [Operasi, MFA, backup/restore tenant](docs/OPERATIONS.md)
- [Setup MCP](docs/MCP.md)
- [Outbox dan worker email persisten](docs/MAIL-WORKER.md)
- [Email Google Workspace dan persiapan SSO yang ditunda](docs/GOOGLE-WORKSPACE.md)
- [Status implementasi dan batas yang masih berlaku](docs/STATUS.md)
- [Panduan sistem utama](docs/SYSTEM.md) dan [pengembangan](docs/DEVELOPMENT.md)


## Vision
Build SaaS applications by installing modules into one simple, familiar app launcher. PAPbox favors ease of use over dense dashboards and keeps its kernel small.

## Principles
- **Node.js native:** JavaScript ES modules and built-in runtime APIs; PostgreSQL uses the separately isolated `pg` adapter.
- **Modular MVC:** modules declare routes, controllers, views, services, menus, permissions, and events.
- **AI-native:** optional built-in Model Context Protocol (MCP) server with permission-aware tools, resources, and prompts.
- **Shared business services:** HTTP, REST, CLI, and MCP invoke the same application services.
- **Launcher-first UX:** familiar icon grid, one-click app access, responsive mobile and desktop layouts.
- **Security first:** default-deny permissions, tenant isolation, audit logs, module validation, and rollback.
- **Lightweight by design:** optional components load only when needed; performance must be measured.

## Proposed structure
```text
papbox/
  core/        # kernel, router, module registry, security, services, events
  system/      # app manager, menu manager, users, settings
  modules/     # installable apps
  public/      # web assets and entry point
  config/      # configuration
  storage/     # runtime data
  docs/        # architecture and UI specifications
```

## Approved UI direction
PAPbox home is a **mobile-inspired application launcher**, not an ERP dashboard.

- **Mobile:** rounded colorful app icons in a responsive grid, minimal header, optional bottom shortcuts.
- **Desktop:** spacious centered app grid, top search and profile actions, no permanent sidebar.
- **Both:** POS, Inventory, CRM, Invoice, Pengguna, Aplikasi, Pengaturan, Tambah; customizable ordering and visibility.
- **App installation:** installing an approved module registers its menus, routes, permissions, and optional MCP capabilities.
- **Navigation:** hide complexity until the user opens an app; show only actions relevant to their permissions.

See [UI/UX design specification](docs/DESIGN.md).

## Roadmap (proposed)
1. Define kernel lifecycle, module manifest, and compatibility contract.
2. Build native HTTP router, MVC interfaces, application services, and test harness.
3. Build app launcher and menu registry with role-aware customization.
4. Implement module install/update/disable/uninstall with validation and rollback.
5. Implement auth, ACL, tenant isolation, audit logging, and database adapters.
6. Add optional MCP server and permission-aware module tool discovery.
7. Benchmark memory, startup, throughput, and module activation.


## Approved launcher mockups

The following uploaded visual references are the approved direction for the PAPbox launcher. Keep the interface icon-first and uncluttered.

### Mobile launcher
![PAPbox mobile launcher](docs/PAPbox%20%E2%80%93%20Peluncur%20Aplikasi%20Pastel.png)

### Desktop launcher
![PAPbox desktop launcher](docs/Dasbor%20Launcher%20PAPbox%20Pastel.png)

See [design specification](docs/DESIGN.md) for interaction and responsive requirements.


## Progressive Web App (PWA)
PAPbox is **PWA-first**: the same responsive launcher works in browsers and can be installed on supported mobile and desktop platforms. The native web runtime will provide a web app manifest, icons, installability metadata, a service worker, offline fallback, and safe asset update/versioning without mandatory external packages. Offline support for business modules is opt-in and must explicitly handle data synchronization and conflicts; PWA installation is not equivalent to a native Android APK. HTTPS is required in production (localhost excepted).

## Development rules
See [AGENTS.md](AGENTS.md) before generating or modifying code.

## License
Not decided. Do not assume this project is open-source licensed.
