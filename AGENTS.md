# PAPbox — AI Agent Development Instructions

## Mission
Develop PAPbox as a lightweight, dependency-free-core, AI-native SaaS application platform built with Node.js and native JavaScript ES modules.

## Non-negotiable rules
1. Do not add third-party npm dependencies to the kernel or system apps without explicit owner approval.
2. Prefer Node.js built-in APIs and browser-native HTML, CSS, and JavaScript.
3. Keep kernel and installable modules separate; never hardcode app-specific logic in the kernel.
4. All business operations must live in application services reusable from MVC, REST, CLI, and MCP.
5. Default-deny permissions, validate all untrusted input, and isolate tenant data.
6. Treat module manifests, installed code, and MCP inputs as untrusted. Installing third-party modules requires trust checks and explicit administrator approval; a manifest is not a sandbox.
7. Do not expose dangerous MCP actions without authorization, auditing, and explicit confirmation where appropriate.
8. Do not copy Odoo UI, Android proprietary assets, or third-party icon artwork.
9. Keep the launcher simple: icon-first, minimal top controls, no permanent desktop sidebar, no cluttered home dashboards.
10. Write tests and documentation for new kernel contracts; preserve backwards compatibility where practical.

## Approved design
Read `docs/DESIGN.md` before changing the UI. Mobile and desktop launcher concepts were approved on 2026-11-07. Do not replace the launcher with a traditional ERP dashboard without owner approval.

## Architectural boundaries
- Kernel: bootstrap, lifecycle, module registry, routing, service contracts, event bus.
- System apps: app manager, menu manager, users, settings.
- Business modules: controllers, views, models, services, routes, permissions, optional MCP declarations.
- MCP: optional transport adapter over application services, never direct unrestricted database access.

## Implementation workflow
1. Review README and relevant design/architecture specs.
2. Propose a minimal interface and tests before implementing major subsystems.
3. Implement the smallest coherent change with no unnecessary abstractions.
4. Verify authorization, input validation, error handling, and rollback behavior.
5. Document changes and outstanding decisions.

## Decisions not yet finalized
- Minimum supported Node.js version.
- Database and driver strategy.
- Module packaging and signature/trust policy.
- Frontend rendering and state model.
- Tenant isolation approach.
- Licensing and commercialization.

Do not silently treat proposals as approved implementation decisions.

## PWA-specific agent rules
- Treat PWA support as a first-class requirement for the PAPbox web runtime, not a heavy kernel dependency.
- Use browser-native Web App Manifest and Service Worker APIs; no third-party PWA package by default.
- Cache public versioned assets conservatively. Do not cache authenticated requests, private tenant data, or secrets without an explicit reviewed design.
- Implement predictable update handling and an offline fallback. Module-specific offline/sync behavior requires explicit opt-in and conflict resolution.
- Test browser and installed standalone layouts on mobile and desktop; preserve the approved launcher UI.
