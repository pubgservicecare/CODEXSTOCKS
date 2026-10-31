# Release 1.0.3 — owner-only login, photo at creation, Mark as Sold, phone layouts

Desktop installer **1.0.3** + website (storefront and admin). No database migration. No change to stored data,
API routes, accounting formula or encryption. Nothing has been deployed.

## What changed

| Area | Change | Files |
|---|---|---|
| Single owner (server) | `/auth/setup` returns 409 `owner_exists` before checking the token once an owner exists; wrong setup codes throttled; `/auth/status` reports `setup_enabled:false` whenever an owner exists | `packages/server/src/api.ts` |
| Owner login (desktop) | Fresh install shows **Owner sign in** (username, password, Sign In; server address under "Server address"); signing in enrols the PC; offline first sign-in shows "Connect to the internet to sign in and authorise this PC for the first time."; **Restore encrypted backup** is the only other option. Removed: First PC / Another PC / local-only setup choices. Settings' cloud-connect no longer asks for a setup code. | `apps/desktop/src/screens.tsx`, `main.tsx`, `packages/ui/src/pages/Settings.tsx`, `apps/web/app/admin/AdminRoot.tsx` (wording) |
| Photo at creation | Photo picker in Add/Edit Account (choose, drag-and-drop, preview, change, remove, type/size check). After saving, desktop queues the photo (offline-safe), web uploads it via the existing signed ImageKit flow; a failure keeps the account and offers **Retry photo** / **Continue without photo**. Desktop account page gains **Retry now** for a failed queued upload. | `packages/ui/src/ImagePicker.tsx`, `pages/AccountForm.tsx`, `pages/AccountDetail.tsx`, `service.ts`, `apps/desktop/src/DesktopService.ts` |
| Mark as Sold | New dialog: actual amount (never pre-filled), currency, rate when currencies differ, date/time, sold via, optional buyer name/WhatsApp, payment ref, notes → review (listing price, cost, actual amount, expected profit + explanation) → **CONFIRM SALE**. On account page, inventory cards and list rows. Sold accounts show "Sold for / Sold on / Profit on this account". | `packages/ui/src/pages/MarkSold.tsx`, `AccountDetail.tsx`, `Accounts.tsx` |
| Sale idempotency | `recordSale` checks "already recorded" before the account status, so a resubmitted sale is recognised (it was already refused, just with a less useful message) | `packages/shared/src/commands.ts` |
| Phone layouts | Storefront: menu button + panel, 44 px targets, 16 px inputs, sticky WhatsApp bar that never covers content, safe areas. Admin: drawer navigation, bottom tab bar (Home, Accounts, New, Sales, Menu), compact top bar, bottom-sheet dialogs with sticky actions, wide tables shown as labelled cards (no column dropped), stacked facts, full-width actions | `packages/ui/src/styles.css`, `AdminApp.tsx`, `apps/web/app/(store)/store.css`, `layout.tsx`, `MobileMenu.tsx` |
| Tests | +29 tests (111 total); Vitest limited to 3 parallel workers (in-memory Postgres per file could exhaust memory) | `*/test/*features*`, `packages/server/test/owner.test.ts`, `vitest.config.ts` |

## Verification

| Item | Status | Evidence |
|---|---|---|
| Automated tests | VERIFIED | `npm test`: 11 files, **111 passed** (82 existing unchanged + 29 new) |
| Typecheck / lint (`npm run lint` = typecheck) | VERIFIED | all workspaces clean |
| Prettier | not enforced | the repository was not Prettier-formatted before this work (unchanged files fail `prettier --check` too); not reformatted to keep the diff reviewable |
| Web production build | VERIFIED | `next build` OK (run with `DATABASE_URL` empty so it could not reach production) |
| Phone layouts | VERIFIED in browser emulation | Chromium headless, demo data; storefront 3 pages × 10 widths, admin 11 pages × 10 widths (320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440): no horizontal overflow, nothing off-screen, no clipped text; screenshots in `docs/screenshots/mobile/`. **No physical phone was used.** |
| Mark as Sold in the browser | VERIFIED (demo mode) | amount empty by default; review → CONFIRM SALE → account Sold, unpublished, removed from public API; dashboard Sold count updated |
| Photo at creation in the browser | VERIFIED failure path only (demo mode has no ImageKit) | invalid file rejected, preview, remove/re-pick, honest failure + Retry + Continue, one account created |
| Real ImageKit upload | NOT VERIFIED | no real upload was made in this task; covered by automated tests against a mocked ImageKit |
| Production sale | NOT DONE | no sale was recorded in production |
| Desktop installer | see below | |

"Before" admin screenshots were taken after the new features were added but before the phone CSS, so they show
the old phone navigation/table behaviour with the new buttons.

## Desktop installer

| Item | Status | Detail |
|---|---|---|
| Build | VERIFIED | `release\CODE-X-STOCKS-1.0.3-Setup-x64.exe`, 209.9 MB, SHA-256 `577B0E678B2D766FA53C4B1309C3860AD8CBA8ADF78BC181BD579EFF71D5360E` (also copied to `CODE-X-STOCKS-Setup-x64.exe`) |
| Previous installers kept | VERIFIED | 1.0.1 and 1.0.2 files unchanged (same SHA-256 as recorded in RELEASE.md) |
| Secrets in bundle | VERIFIED | `apps/desktop/dist` and `apps/web/.next/static`: no database URL, Neon host, ImageKit private key, `DATABASE_URL`, demo password or `SETUP_TOKEN` |
| Data survives upgrade 1.0.2 → 1.0.3 | IMPLEMENTED BUT NOT VERIFIED on this PC | Not installed here: CODE X STOCKS 1.0.2 was running with the owner's real data. No local schema, sync or migration file changed in this release (`git diff` empty for `local-core/src/db.ts`, `store.ts`, `sync.ts`, `server/src/migrations.ts`, `shared/src/entities.ts`); the 1.0.1→1.0.2 upgrade kept data byte-identical. |
| Login, photo at creation, offline sale in the installed app | IMPLEMENTED BUT NOT VERIFIED in the .exe | Verified through the same shared UI in the browser and by the desktop-engine tests (`packages/local-core/test/features.test.ts`) |

Upgrade steps for the owner: (1) Backup page → export an encrypted backup; (2) close CODE X STOCKS;
(3) run `CODE-X-STOCKS-1.0.3-Setup-x64.exe`; (4) open the app → the existing PC keeps its sign-in (works offline);
check that your accounts, photos and sales are all present.

## Safe deployment (owner actions — nothing below has been done)

1. **Back up first.** In the desktop app: Backup → export an encrypted backup. Optional: create a Neon branch
   (snapshot) of the production database in the Neon console.
2. **Commit and push** the changes (they are local and uncommitted). Vercel builds the push automatically if the
   project is connected to GitHub. No environment variable changes are needed for this release.
3. **No migration.** This release has no schema change — do not run `db:migrate` for it.
4. After the deployment is live, check (read-only):
   - `https://codexstocks.org/api/v1/health` → `"ok": true`
   - `https://admin.codexstocks.org/api/v1/auth/status` → `{"owner_exists":true,"setup_enabled":false}`
     (false even before step 5, because of the new server rule)
   - open `https://admin.codexstocks.org` on your phone: Owner sign in, drawer, Mark as Sold, Add Account photo.
5. **Remove `SETUP_TOKEN`** from Vercel → Project → Settings → Environment Variables (Production), then redeploy.
   On 2026-10-30 production returned `setup_enabled:true`, i.e. the token is still configured.
6. **Desktop:** install `release\CODE-X-STOCKS-1.0.3-Setup-x64.exe` over 1.0.2 on each PC (data is kept). Sign in
   with the same owner username and password.
7. Rollback: Vercel → Deployments → promote the previous deployment; desktop: reinstall 1.0.2 (data is kept).
