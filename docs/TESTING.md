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
| `apps/web/test/web.test.tsx` | domain routing (admin never reachable on public host), TXT rendering (pre-wrap + HTML escaping) for storefront and admin |

## Manual / real-environment checks performed

See CODEX_STOCKS_PROGRESS.md for what was verified on a real machine (installer, app launch, data
preservation, browser QA of the website) and what remains blocked on credentials.
