# Testing

```powershell
npm test            # vitest: all suites, no external services required
npm run typecheck   # tsc for every package/app
npm run web:build   # Next.js production build
npm run desktop:build
```

The server suites run against **PGlite** (the real Postgres engine compiled to WASM), and the desktop
suites run two simulated PCs (separate SQLite files via `node:sqlite`) against the real server code with a
simulated network (online/offline switch, lost responses) and a mocked ImageKit.

| Suite | Covers |
|---|---|
| `packages/shared/test` | required fields, explicit zero cost, link limits, link-kind validation, 2SV warnings, backup-code format/duplicates/leading zeros, status transitions, money parsing/rounding, all accounting cases, public DTO allowlist, TXT whitespace, YouTube parsing, three-way merge |
| `packages/crypto/test` | encrypt/decrypt, unique nonces, tamper/AAD/wrong key, vault unlock by passphrase/recovery key, passphrase change keeps data key, recovery-key rotation, login verifier, encrypted backups, KDF timing |
| `packages/server/test` | migrations idempotent + destructive SQL refused, single owner, setup token, brute-force throttling, secure cookie, 401 on every private endpoint, CSRF origin check, device revocation, CORS, **public endpoints leak nothing private**, sync idempotency, revision conflicts + resolution, plaintext-secret rejection, server-side link limits, duplicate sale rejection, pull cursor, vault versioning/mismatch, ImageKit signature, image host check, admin commands + dashboard + audit |
| `packages/local-core/test` | offline setup, offline create/edit, restart while offline, login required, wrong password, vault lock/unlock, recovery-key login reset, no plaintext in SQLite file, shared password linked to phone+email, backup codes, cross-PC sync of inventory/secrets/TXT, offline sale + disconnect + reconnect, lost-response retry without duplicates, auto-merge and explicit conflicts, duplicate offline sale, revoked device, pairing local-only install into existing cloud vault (re-encryption), image queue failures/crash recovery/no duplicate uploads/old file deletion, encrypted backup + restore on a fresh PC |
| `apps/web/test/parity.test.ts` | **desktop ⇄ web admin parity**: web service implements every desktop capability (except documented desktop-only ones); web-created accounts/links/password/codes/image/TXT/publish/status appear identically on desktop; offline desktop sales + expenses and web refunds give identical reports; identical account history; web vault passphrase change works on desktop; conflicts visible on web and closed when desktop resolves; web-settled conflicts never leave desktop stale; devices/settings both ways; web backup download restores in desktop |
| `packages/ui/test/design.test.tsx` | redesign guarantees: exact TXT whitespace + HTML escaping in the shared viewer, required/optional field markers, artwork fallbacks differ between neighbours and are stable per id, artwork shipped as local WebP under 400 KB, no remote image hotlinks or base64 images in UI/storefront sources (only ImageKit photos and YouTube embeds), no private field names or secret env names in storefront code |
| `packages/server/test/owner.test.ts` | single-owner policy: setup reported closed once the owner exists (even with `SETUP_TOKEN` still set), 2nd owner refused for any token/client (409), setup-code guessing throttled (429), no registration routes, private endpoints 401 without a session, device enrolment only after a correct password |
| `packages/local-core/test/features.test.ts` | fresh-install owner sign-in enrols the PC and downloads inventory without creating an owner; vault stays locked until unlocked; offline first sign-in refused with nothing set up; enrolled PC signs in offline and syncs later; backup restore never creates an owner; photo chosen at creation kept locally offline, upload failure keeps the file, retry uploads and attaches it, public listing shows it; Mark as Sold with an amount different from the listing price offline, duplicate submission refused, synced exactly once after a lost response, reports/counts/history/public removal (incl. old URL → 404); cross-currency sale needs a rate, PKR/USD kept separate; restocking refund keeps the original sale and the account can be resold |
| `apps/web/test/features.test.ts` | web admin photo at creation: real signed-upload flow, failure + retry (one account), invalid/oversize rejected before upload; web sale → desktop and desktop sale → web identical rows and reports; resubmitted sale = "already recorded"; second sale of the same account (web first, desktop offline) becomes a conflict, cloud keeps one sale |
| `packages/ui/test/features.test.tsx` | Mark as Sold offered only for available/reserved; amount never pre-filled from the listing price; expected profit/loss (and "cannot be calculated" without a rate); photo validation by content (type, empty, 8 MB); picker is optional with choose/drag-and-drop; fresh-install screen is owner sign-in only (no First PC/local-only/setup code/sign-up); Settings no longer asks for a setup code; phone CSS rules present (drawer, tab bar, bottom sheets, table cards, safe areas, 16 px inputs, sticky WhatsApp bar clear of footer) |
| `packages/shared/test/fx.test.ts` | USD↔PKR conversion and rounding, invalid rates (NaN/∞/0/negative/absurd), no conversion without a rate, staleness, sale-rate ↔ USD/PKR consistency, country → display currency and manual choice, snapshot validation (source/time required, manual needs reason), combined books with mixed PKR/USD purchases, sales, cross-currency sale, expenses, restocking refund and voided sale, exclusion of USD records without a rate, **PKR and USD charts with identical movement** (constant factor, unaffected by a new display rate, history unchanged) |
| `packages/server/test/fx.test.ts` | rate service: single fetch then cache, refresh after the provider's next update, stale fallback on failure + retry pause, no rate ever → null, invalid provider data rejected, public `/fx`; migration 0002 additive; sale snapshot stored, manual rate needs a reason, mismatched rate refused; an older client cannot erase snapshots during sync; storefront sorting by PKR equivalent (and every query shape with a rate) |
| `packages/local-core/test/fx.test.ts` | desktop quote cached and served offline, none invented on a never-connected PC; offline USD sale and expense keep their recorded rate through sync while the reference rate changes; identical combined books on both PCs; audit records the rate; refund uses its sale's rate |
| `packages/ui/test/fx.test.tsx` | storefront price display for Pakistan / international visitors and both listing currencies, no-rate fallback, rate note (daily, time, stale, attribution, never "live"); Add/Edit form preview; inventory equivalents; Mark as Sold rate resolver (reference, manual + reason, old cache confirmation, no quote); purchase and expense snapshot rules |
| `apps/web/test/web.test.tsx` | domain routing (admin never reachable on public host), TXT rendering (pre-wrap + HTML escaping) for storefront and admin |

## Phone-size browser checks (repeatable)

`scripts/qa/*.mjs` take a Playwright `page` (run them with any Playwright runner against a **demo-mode**
dev server: `DATABASE_URL= DEMO_MODE=1 COOKIE_SECURE=false ADMIN_ORIGINS=http://localhost:3100 npx next dev -p 3100`
in `apps/web`; the empty `DATABASE_URL` guarantees the in-memory demo data even if `.env.local` exists).

- `mobile-audit.mjs` — every storefront and admin page at 320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440 px:
  horizontal overflow, elements off-screen, clipped text, smallest font, touch targets under 40 px; screenshots.
- `mobile-sale-flow.mjs`, `mobile-photo-flow.mjs`, `mobile-store-flow.mjs` — the phone flows (drawer, Mark as Sold
  sheet, public listing removal, photo at creation incl. failure/retry, storefront menu and sticky WhatsApp bar).

These use **browser device emulation** (Chromium, headless). They are not a substitute for a physical phone.

## Manual / real-environment checks performed

See CODEX_STOCKS_PROGRESS.md for what was verified on a real machine (installer, app launch, data
preservation, browser QA of the website) and what remains blocked on credentials.
