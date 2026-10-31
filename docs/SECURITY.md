# Security model

This describes what the software protects against and what it does not. It is not "perfectly secure".

## Scope of the app

CODE X STOCKS **records** credentials the owner already holds. It never logs in to third-party services,
never requests/intercepts OTPs, never resets third-party passwords and never generates backup codes.

## Secrets: what is encrypted, with what

| Item | Protection |
|---|---|
| Phone/email shared password, backup codes | XChaCha20-Poly1305 (random 192-bit nonce, auth tag) with a key derived via HKDF from the vault data key. Associated data binds each ciphertext to its record id, so ciphertexts cannot be swapped between records. Stored as `cx1.…` in SQLite and Neon. |
| Vault data key (DEK) | Random 256-bit. Stored only wrapped: (1) by Argon2id(vault passphrase; 64 MiB, 3 passes), (2) by the 256-bit recovery key. The wrapped "envelope" syncs to the server; the server never receives the passphrase, recovery key or DEK. |
| Backup-code duplicate check | HMAC-SHA256 tag keyed from the DEK — the server can enforce uniqueness without learning codes. |
| Owner login password (server) | scrypt N=2^17, r=8, p=1, per-password salt. Login throttled (8 failures / 15 min per IP and per user). |
| Owner login password (desktop, offline) | Argon2id (19 MiB, 2 passes) verifier. A second HKDF output encrypts the device's cloud token at rest. |
| Sessions | 256-bit random tokens; only SHA-256 hashes stored. Web: `__Host-` cookie, HttpOnly, Secure, SameSite=Strict, 12 h. Device: bearer token, 180 days, revocable per device. |
| Backups | Whole file: Argon2id(backup password) + XChaCha20-Poly1305. Secrets inside remain vault-encrypted. |

Libraries: `@noble/ciphers`, `@noble/hashes` (audited, maintained). No custom algorithms.

## Single owner (enforced by the server)

- One owner row only: `owner.id = 1` CHECK constraint + `INSERT … ON CONFLICT DO NOTHING`.
- `POST /auth/setup` refuses with **409 `owner_exists`** as soon as an owner exists, **before** the setup token is
  even compared — a leaked `SETUP_TOKEN` cannot create or replace an owner. Wrong setup codes are throttled
  (8 per 15 min per IP). `GET /auth/status` reports `setup_enabled: false` whenever an owner exists.
- There is no registration route. Every private endpoint returns 401 without an owner session or device token.
- Every app installation starts at **Owner sign in**. Signing in on a new PC is the device enrolment: the server
  checks the owner password, issues a device token, and the inventory downloads; vault secrets stay encrypted until
  the vault passphrase (or recovery key) is entered on that PC. A never-enrolled PC cannot sign in offline.
  The only other entry is restoring an encrypted backup, which never contacts the server's owner setup.
- Remove `SETUP_TOKEN` from Vercel once the owner exists (defence in depth; setup is closed either way).
  Production check 2026-10-31 (deployment of `737b912`): `/auth/status` → `owner_exists:true, setup_enabled:false`;
  a setup request → 409 `owner_exists`. Whether `SETUP_TOKEN` is still stored in Vercel could not be checked (the
  local Vercel CLI is signed in to a different account than the one hosting codexstocks.org).

## Source repository

`github.com/pubgservicecare/CODEXSTOCKS` is **public**. Nothing secret is in it: `.env*`, databases, backups, keys
and installers are git-ignored, and the full history was scanned for the real database password/host and for
credential patterns (2026-10-31: none found). Security does not depend on the code being private, but the code,
docs and demo screenshots are visible to anyone; make the repository private on GitHub if that is not wanted.

## Vault passphrase vs login password

They must differ (enforced). The server sees the login password during online login, so the vault key is
never derived from it.

## Recovery

| Lost | Recovery |
|---|---|
| Vault passphrase | Unlock with recovery key → Settings → set a new passphrase (data key unchanged, nothing re-encrypted). |
| Login password on a PC | Login screen → "Forgot password?" → recovery key → new local password. Cloud password: `npm run owner:reset-password` with database access. |
| Recovery key | Settings → issue a new one (needs the passphrase). |
| **Both passphrase and recovery key** | **Stored passwords and backup codes are unrecoverable by anyone**, including the developer. Inventory, sales and reports are unaffected. |

Changing the vault passphrase never replaces the data key silently; the server refuses any vault upload with
a different `vault_id` than the stored one.

## Access control

- Every private endpoint authenticates (bearer or cookie) and checks session + device revocation.
- Cookie-authenticated writes require `Origin` ∈ `ADMIN_ORIGINS` (CSRF).
- CORS is granted only to the Tauri WebView origins.
- Public endpoints select explicit columns and map through an allowlist DTO (`toPublicListing`). Only
  `available` + `published` accounts with ≥ 1 login link are returned. Tests assert no private value appears.
- Admin pages are served only on `ADMIN_HOSTS`; `/admin` returns 404 on the public domain. The admin page
  validates the session server-side, and the API enforces auth independently.
- Server validates every request with Zod + business invariants; ciphertext fields must match the `cx1.`
  envelope format so plaintext cannot be stored by mistake.
- Errors and logs never include request bodies or secret values.

## Memory

Decrypted keys are held only while unlocked and zeroed on lock/logout/idle-lock (best effort: JavaScript
engines can keep copies we cannot erase). Revealed secrets auto-hide after 30 seconds. Idle lock default 10 min.

## Known limitations

- A compromised Windows account (malware running as the user) can read what the app shows while unlocked.
- SQLite file is not encrypted as a whole; non-secret inventory data (titles, notes, costs) is readable by
  anyone with access to the Windows user profile. Secrets inside it are encrypted.
- The admin website runs the vault in the browser; a malicious browser extension could read unlocked secrets.
- Storefront CSP allows inline scripts (required by Next.js without nonces).
