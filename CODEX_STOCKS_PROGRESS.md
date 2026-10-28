# CODE X STOCKS — Progress Log

Legend: ✅ VERIFIED · 🟡 IMPLEMENTED, NOT VERIFIED · ⛔ BLOCKED

Last update: 2026-10-28 (dev PC: Windows 10 Pro 22H2 build 19045)

## Production preflight (inspection only) — see docs/PRODUCTION_PREFLIGHT.md
- 2026-10-28: tests 82/82 and typecheck re-run during inspection (pass). No deploy, migration, `db:status`, DNS or data change.
- Desktop 1.0.2 installer defaults to `https://admin.codexstocks.org` (production; not live yet).
- Fixed doc risk: DEPLOYMENT.md no longer advises giving Preview deployments the production `DATABASE_URL`.

## Visual redesign (1.0.2) — see docs/DESIGN.md
- ✅ New design system shared by desktop + admin website (tokens, self-hosted Inter, original icons + brand mark, new app icon).
- ✅ Original artwork: 14 WebP files in `packages/ui/assets/art/` from `scripts/art/generate-art.mjs` (procedural vector illustration).
  ⚠ No AI image-generation tool was available; prompts for an optional AI upgrade: docs/IMAGE_GENERATION_PROMPTS.md.
- ✅ Redesigned: shell, sign-in/setup, dashboard, inventory (grid/list), account detail, form, logins/codes/sales tabs, history, sync, settings, backup, empty/loading/error states, storefront home/detail/mobile.
- ✅ Tests: 82 passing (7 new design guards). Typecheck clean. Web production build OK.
- 👁 Browser QA (demo mode, dev + production build): 20 screens desktop + mobile, 0 console errors, no horizontal overflow; images + font load under production CSP. Before/after: docs/screenshots/.
- ✅ Desktop installer **1.0.2**: `release\CODE-X-STOCKS-1.0.2-Setup-x64.exe` (SHA-256 8D94C095…735A). 1.0.1 installer kept unchanged.
  Upgrade 1.0.1 → 1.0.2 verified on this PC (exit 0, local data byte-identical). Installed app inspected on Windows 10: setup screen + setup form captured (docs/screenshots/desktop/).
  ⚠ Signed-in desktop screens were verified through the identical shared UI in the browser, not in the installed app (doing so would require creating an owner account in this PC's real app data).
- No deployment, no production database access, no DNS change.

## Parity task (desktop ⇄ admin.codexstocks.org) ✅ — see docs/PARITY.md
Fixed/added:
- Server closed no conflicts when a device later resolved them → web showed stale conflicts. Now superseded conflicts auto-close.
- Desktop could keep an outdated copy after a conflict was settled on the web ("keep cloud version" used an old snapshot). Pulls now refresh the snapshot.
- Account history missed link/password/code/sale/refund/expense events; initial links were not audited. Fixed on both (same filter rule).
- New History page (global audit) on both. Web: cloud sync status + device last-sync, idle lock + setting, encrypted backup download (restorable in desktop).
- Web image upload now honours the injected network layer (tests only; no behaviour change in browsers).
- Tests: 75 passing (8 new parity tests). Typecheck clean. Web production build OK. Browser QA of new web pages: 0 console errors.
- Desktop rebuilt as **1.0.1** (`release\CODE-X-STOCKS-1.0.1-Setup-x64.exe`); upgrade from 1.0.0 verified on this PC.
- ⚠ The original 1.0.0 installer file was overwritten during this work (hash recorded in docs/RELEASE.md). Release builds now keep a per-version copy.

## Earlier phases
- A–F ✅ (see git history of this file / docs). Server verified on PGlite only; ImageKit mocked.
- G ✅ installer on Windows 10; ⛔ Windows 11 and clean-PC tests not done.
- H ✅ locally; ⛔ not deployed.

## Phase I — Deployment ⛔ (not started on purpose; no production changes made)
No `.env*` files with values exist; project not linked to Vercel. Only migration: `0001_init` (no schema change needed for parity).
Next safe action: create an EMPTY Neon database or branch for CODE X STOCKS, put its connection string in
`apps/web/.env.local` as `DATABASE_URL`, then run `npm run db:status` and `npm run db:migrate`.
