# PAPbox

**Plug and Play Box** — a lightweight, AI-native, modular SaaS application platform.

> Status: architecture and design phase. No framework implementation yet.

## Vision
Build SaaS applications by installing modules into one simple, familiar app launcher. PAPbox favors ease of use over dense dashboards and keeps its kernel small.

## Principles
- **Node.js native:** JavaScript ES modules and built-in runtime APIs; no mandatory third-party npm packages in the core.
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

## Development rules
See [AGENTS.md](AGENTS.md) before generating or modifying code.

## License
Not decided. Do not assume this project is open-source licensed.
