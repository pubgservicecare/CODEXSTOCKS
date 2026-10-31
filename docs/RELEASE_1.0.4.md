# Release 1.0.4 — dual currency, exchange-rate snapshots, combined reports

Website (codexstocks.org + admin.codexstocks.org) and Windows desktop installer **1.0.4**. This release also ships
the 1.0.3 work (owner-only sign-in, photo at creation, Mark as Sold, phone layouts), which had not been deployed.
Feature details: [FX.md](FX.md), [RELEASE_1.0.3.md](RELEASE_1.0.3.md).

## Identifiers

| Item | Value |
|---|---|
| Repository / branch | `github.com/pubgservicecare/CODEXSTOCKS` (**public**), `master` |
| Release commit | `737b912606ca59e7a2ff1f1c3f2483144a7d8315` — pushed 2026-10-31 16:46:31 UTC (fast-forward from `d422f02`, no force) |
| Vercel deployment | `4j5ti8tMAK8Kb2iBC24fHdGR31dA` (team `codexstocks`, project `codexstocks`), Vercel commit status "Deployment has completed" at 2026-10-31 16:47:04 UTC |
| Database migrations | `0001_init`, `0002_fx_snapshots` applied; none pending (0002 applied by the owner before the deploy) |
| Desktop installer | `release\CODE-X-STOCKS-1.0.4-Setup-x64.exe` — 220,062,993 bytes, SHA-256 `8B5DBBE21434CBDE9D83A3A9DBCC52F9493A4B3FBFF0BF65C6A063DE367E67FD` (built 2026-10-31 from the release commit; not installed on any PC) |

## Migration verification (read-only)

1. No `DATABASE_URL` in the Windows process, user or machine environment, so `npm run db:status` used
   `apps/web/.env.local` (Neon, `ap-southeast-1`, database `neondb`; the value was never printed).
2. `npm run db:status` (the `--status` path returns before any migration step): `Applied: 0001_init, 0002_fx_snapshots`,
   `Pending: (none)`. It also verifies each applied migration's checksum against the code — they match.
3. Schema: all ten snapshot columns exist and are nullable; table `fx_rates` exists. Existing data unchanged
   (1 owner, 1 account, 1 sale, 0 expenses, before and after the deploy).
4. **Same database as production:** the deployed site's first rate fetch (`276.777696`, retrieved
   2026-10-31 16:47:05.768 UTC) appears in `fx_rates` of this database with the same timestamp.

## Live production checks (2026-10-31, after the deploy, read-only)

| Check | Result |
|---|---|
| TLS | codexstocks.org, www.codexstocks.org, admin.codexstocks.org: valid Let's Encrypt certificates (expire 28 Jan 2027), TLS 1.3 |
| Routing | apex 200 (storefront); www → 308 → apex; admin 200 (Owner sign in); `/admin` on the apex → 404 |
| `GET /api/v1/health` | `{"ok":true,…}` |
| `GET /api/v1/fx` | `USD/PKR 276.777696`, source ExchangeRate-API, published 2026-10-31 00:02:31 UTC, retrieved 16:47:05 UTC, next update 2026-11-01 00:26:21 UTC, `frequency: daily`, `status: fresh`, cached 5 min |
| `GET /api/v1/auth/status` | `{"owner_exists":true,"setup_enabled":false}` (was `true` before this deploy) |
| `POST /api/v1/auth/setup` (dummy body) | 409 `owner_exists` — nothing created |
| Private endpoints without a session | `/admin/entities/accounts`, `/admin/dashboard`, `/sync/pull`, `/vault` → 401 |
| Public listings | 0 (the only account is sold): `/public/listings` empty; `/public/listings/<sold id>` → 404; its old page shows "Account not found" with `noindex` (HTTP 200 — see limitations) |
| Existing photo | served by `ik.imagekit.io` from `/codexstocks/codex-stocks/accounts/…` (200, JPEG); file id stored |
| Secrets in served code | 3 pages + 18 JavaScript files (1.5 MB) scanned for the real database password/host, `DATABASE_URL`, `IMAGEKIT_PRIVATE_KEY`, private-key patterns, demo password: none |
| Storefront in a browser (Chromium, this PC, IP in Pakistan) | default **PKR**; PKR \| USD switcher visible at 390 px; USD choice kept after reload (`cx_ccy` cookie), switch back works; a forged `x-vercel-ip-country: AE` request header is ignored; "Rates By Exchange Rate API" in the footer; no horizontal scroll at 320, 360, 375, 390, 414, 768, 1280, 1440 px |
| Admin sign-in page in a browser | only username + password + Sign In (no registration/setup); no overflow at 320, 390, 768, 1280 px |

## Tests and builds (2026-10-31, release tree)

| Item | Result |
|---|---|
| `npx vitest run` | Release commit: 15 files, **156 passed** (unit, API/integration on PGlite, two-PC sync, desktop ⇄ web parity, FX + accounting, UI render, phone-CSS guards). Docs commit adds `packages/local-core/test/upgrade.test.ts` (opening a database written without the snapshot columns): 16 files, **157 passed**. |
| `npm run typecheck` (= `npm run lint`) | exit 0, no errors — there is no separate ESLint configuration |
| `git diff --check` | clean |
| Web production build (`next build`, production secrets blanked) | OK |
| Desktop production build (`npm run desktop:build`) | OK — Vite bundle + Rust release build + NSIS installer (first attempt stalled downloading Microsoft's new WebView2 runtime; the runtime installer was then downloaded separately, its Microsoft Authenticode signature checked as Valid, version 1.3.307.15, and the build re-run) |
| Secret scan of the commit | 273 committable files: no real secret values, no credential patterns, no `.env`/database/backup/key/installer files. Whole history (3 commits, 320 blobs) clean. |

## Desktop installer 1.0.4

| Check | Result |
|---|---|
| File | `release\CODE-X-STOCKS-1.0.4-Setup-x64.exe` (also copied to `release\CODE-X-STOCKS-Setup-x64.exe`, the "latest" convenience copy, which previously held 1.0.3) |
| SHA-256 | `8B5DBBE21434CBDE9D83A3A9DBCC52F9493A4B3FBFF0BF65C6A063DE367E67FD` (220,062,993 bytes) |
| Version | installer and `codex-stocks.exe` product/file version **1.0.4** |
| Contents | dual-currency UI (rate previews, sale rate with reference/manual + reason, Combined card, USD-equivalent chart), owner-only sign-in, photo at creation with offline queue, Mark as Sold — strings checked in the bundled UI |
| API address | `https://admin.codexstocks.org` (no override at build time) |
| Secrets | bundled UI (`apps/desktop/dist`) and `codex-stocks.exe`: no database password/host, `DATABASE_URL`, ImageKit private key or demo password |
| Previous installers | 1.0.1 `A64C3E78…E05A`, 1.0.2 `8D94C095…735A`, 1.0.3 `577B0E67…360E` — unchanged (hashed before and after the build) |
| Code signing | not signed (as before) |
| Installed on a PC | **No.** This PC runs 1.0.3 with the owner's real data, so 1.0.4 was not installed. Opening an older local database is covered by `upgrade.test.ts`; the real upgrade is unverified. |

Upgrade (owner, on each PC):
1. In CODE X STOCKS: **Backup** → choose a backup password → **Export backup…** → save the `.cxbackup` somewhere
   outside the app (USB stick or another folder). Optional: open **Sync** and check nothing is waiting.
2. Close CODE X STOCKS completely.
3. Run `release\CODE-X-STOCKS-1.0.4-Setup-x64.exe` (unsigned: SmartScreen → "More info" → "Run anyway").
4. Open the app. The PC stays authorised; sign in with the same owner username and password if asked.
5. Check: accounts, photos and sales are all there; Dashboard shows the PKR, USD and **Combined** cards; Add Account
   shows "≈" previews with the daily rate once the PC has been online.

Data stays in `%APPDATA%\org.codexstocks.desktop`; on first start 1.0.4 adds the nullable snapshot columns to the local
SQLite database (no existing value changes). Desktop 1.0.3 PCs keep working with the new server meanwhile.

## Real ImageKit upload — BLOCKED

Not performed. A controlled upload needs an owner session on admin.codexstocks.org (owner credentials were not
available and were not requested) or the ImageKit keys, which exist only in Vercel Production (`.env.local` holds
only `DATABASE_URL`, and the local Vercel CLI is signed in to a different account). Evidence available instead:
automated tests of the signed-upload flow against a mocked ImageKit, and the existing production photo above
(uploaded earlier by the owner) being served correctly.

Owner test (2 minutes): admin.codexstocks.org → New account → title "TEST – delete me", leave **Published off**,
choose a small photo → Save → the account page shows the photo → then remove the photo and delete the test account.

## Not verified / blockers

| Item | Status | Owner action |
|---|---|---|
| `SETUP_TOKEN` still stored in Vercel Production | BLOCKED (no access to that Vercel account from this PC) | Vercel → team `codexstocks` → project `codexstocks` → Settings → Environment Variables → delete `SETUP_TOKEN` (Production only) → redeploy. Setup is already closed in code. |
| Preview deployments without the production `DATABASE_URL` | BLOCKED (same reason) | In the same screen, make sure `DATABASE_URL` is set for **Production** only (not Preview/Development). |
| Signed-in admin pages in production (dashboard, inventory, Add Account, Mark as Sold, reports, vault, backup, history) | IMPLEMENTED BUT NOT VERIFIED live | Sign in on a phone and a laptop and open each page. Verified by the automated tests and in a local production build with demo data. |
| Foreign visitor → USD | IMPLEMENTED BUT NOT VERIFIED live (no non-Pakistan connection available) | Ask someone abroad to open codexstocks.org, or use a VPN. Verified with a simulated country header locally and in tests. |
| Physical phones | NOT TESTED (browser emulation only) | Open both sites on your phone. |
| 1.0.3 → 1.0.4 upgrade on this PC | NOT PERFORMED (your real data) | Follow the upgrade steps above. |

## Known limitations

- The rate is a **daily reference rate**; converted prices are approximate and labelled so.
- A removed or sold account's old page shows "Account not found" with `noindex`, but answers HTTP 200 (the storefront
  streams a loading state before the lookup finishes). The public API answers 404. Unchanged since the first release.
- The repository is public (no secrets in it). Make it private on GitHub if the code should not be visible.
- The installer is not code-signed.

## Rollback

- **Website:** Vercel → project `codexstocks` → Deployments → the previous production deployment (commit `d422f02`)
  → **Instant Rollback / Promote to Production**. No database change is needed: migration 0002 only added nullable
  columns and a table; the previous server code reads and updates explicit column lists only, so it neither needs
  nor clears the new columns (it also ran against the migrated database between the owner's migration and this
  deploy, with health, status and public listings OK). Never drop the new columns.
- **Desktop:** restore is safest from the encrypted backup made in step 1. Reinstalling 1.0.3 over 1.0.4 keeps the
  data folder, but a downgrade was not tested.
