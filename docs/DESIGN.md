# PAPbox — Approved UI/UX Design

**Status:** Mobile and desktop launcher direction approved, 2026-11-07. This is a specification, not an implemented interface.

## Product philosophy
Users should open PAPbox and immediately recognize the apps they can launch, like a familiar smartphone home screen. One click should open an app. Avoid dense ERP dashboards, KPI panels, nested global navigation, and persistent sidebar clutter.

## Shared visual language
- Original PAPbox blue cube mark and “Plug and Play Box” subtitle.
- Light pastel blue/lavender gradients and subtle wave decoration.
- Generous whitespace, clean typography, rounded-square colorful app icons, concise labels.
- Minimal top-level actions: search, notifications, user profile.
- Example launcher icons: POS (blue/cart), Inventory (green/box), CRM (purple/people), Invoice (orange/document), Pengguna (pink/person), Aplikasi (slate/puzzle), Pengaturan (slate/gear), Tambah (light/plus).
- Icons and illustrations must be original or appropriately licensed; no copying proprietary Odoo or Android assets.

## Mobile — approved direction
- Smartphone-style icon launcher with a responsive grid (reference mockup shows four columns).
- Compact top bar with brand and essential actions.
- Optional page indicator for multiple pages of apps.
- Optional bottom dock for Aplikasi Baru, Kelola Menu, AI Assistant, Bantuan.
- Prioritize touch targets, short labels, and single-tap access.
- Avoid unnecessary system metrics or dashboard widgets on the launcher.

## Desktop — approved direction
- Wide, centered app icon grid with ample spacing.
- Top bar: PAPbox brand left, search near center, notification and account actions right.
- No persistent left navigation sidebar on the launcher.
- Small version/status indicator bottom left and compact Bantuan button bottom right.
- The grid adapts to screen width; do not merely stretch mobile icons.
- App-specific pages may have contextual navigation when needed, without making the home screen complex.

## Interaction and customization
- Install an app: validate package/manifest and permissions, then register it and show its launcher icon.
- Admin can reorder, rename (display label), hide, and group launcher items.
- Users see only apps they are authorized to access.
- Hiding an icon is never a substitute for backend authorization.
- Search locates apps and, where authorized, app content.
- Support keyboard navigation, screen readers, sufficient contrast, and reduced motion.
- Keep configuration controls in dedicated screens, not the launcher itself.

## Responsive guidelines (provisional)
- Mobile: 3–4 columns depending on usable width and accessible sizing.
- Tablet: 4–6 columns.
- Desktop: approximately 5–7 columns depending on viewport and icon sizing.
- Use CSS Grid and intrinsic sizing rather than hard-coded device breakpoints.
- Avoid mandatory animations and heavy frontend dependencies.

## Module-to-menu contract (proposed)
A module manifest declares app identity, display name, icon reference, routes, permissions, and optional MCP capabilities. A central registry merges module declarations with administrator overrides (ordering, visibility, groups). Route authorization remains enforced server-side.

## Design acceptance checklist
- New users can identify and open an installed app without training.
- Installing an app can add its launcher icon without modifying core UI code.
- Desktop home does not regress into a traditional dashboard or sidebar-heavy ERP.
- Mobile launcher is usable with touch and accessible text.
- Hidden or unauthorized apps do not leak privileged routes or data.
- No unapproved external UI dependencies.

## Reference artifacts
Two visual mockups were approved in the project conversation on 2026-11-07: mobile launcher and desktop launcher. This document captures their design intent. Reference image files should be added to `docs/design/` when available for upload.
