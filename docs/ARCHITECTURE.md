# Architecture

```
 Windows PC (Tauri 2)                         Vercel (Next.js 16)                    Neon PostgreSQL
 ┌──────────────────────────────┐   HTTPS    ┌───────────────────────────────┐      ┌──────────────┐
 │ React UI (@codex/ui)         │  Bearer    │ /api/v1/*  (@codex/server)    │ TLS  │ accounts ... │
 │ local-core: commands, outbox,│──────────▶ │  auth · sync · admin · public │─────▶│ sync_ops     │
 │ sync engine, vault, images   │            │ storefront (public DTOs only) │      │ vault (blob) │
 │ SQLite (Rust, 1 connection)  │            │ admin site (@codex/ui, cookie)│      └──────────────┘
 └──────────────────────────────┘            └───────────────────────────────┘
          │ signed upload (server-issued signature)            │ HMAC signature (private key server-only)
          └──────────────────────────▶ ImageKit ◀──────────────┘
```

## Key decisions

- **One rule set everywhere.** `packages/shared/src/commands.ts` implements every write (create account,
  record sale, refund, …) against an abstract `EntityStore`. The desktop runs it on SQLite (writes also
  append outbox ops in the same transaction); the server runs the same code on Postgres for the admin
  website. `checkInvariants` (link limits, one shared credential, duplicate sale, refund limits, immutable
  backup codes, append-only audit) runs on both sides, and again on every synced row the server receives.
- **No database credentials in the desktop app.** The desktop talks only to `/api/v1` with a per-device
  bearer token. `DATABASE_URL` and `IMAGEKIT_PRIVATE_KEY` exist only in server environment variables.
- **Same wire format** (snake_case rows, integer minor units, ISO timestamps) for SQLite, Postgres and HTTP.
  Separate adapters per database — no ORM forcing one dialect.
- **Admin UI shared**: `packages/ui` renders against a `DataService` interface: `DesktopService`
  (offline-first, local SQLite) or `WebService` (cloud API + in-browser vault).

## Sync protocol

- Every row: `id` (UUIDv7 generated on the device), `rev` (server revision), `deleted` tombstone.
- Local write → row saved with `sync_state=pending` + outbox op (`op_id`, entity, snapshot) in ONE transaction.
- Push: ops sent strictly in order (batches of 100). `base_rev` is assigned and persisted before sending, so a
  retry is byte-identical. Server stores each op result under `op_id` → retries never apply twice.
- Server: if `base_rev` ≠ current `rev` → **conflict** (recorded, server row returned). Device runs a field-level
  three-way merge (base = last server version seen). Non-overlapping edits merge automatically; overlapping
  fields create a conflict record shown with both versions for an explicit choice.
- Pull: global `change_seq` cursor; rows with pending local edits or open conflicts are never overwritten.
  Writes are serialised with a Postgres advisory lock so the cursor cannot skip rows.
- Network/5xx failures: exponential back-off (5 s → 10 min). Local data is never removed by a sync failure.
- Business-rule rejections (e.g. second sale of the same account from another PC) are stored as `rejected`
  and shown on the Sync page with the reason.

## Images

Selected file → validated by magic bytes (JPEG/PNG/WebP, ≤ 8 MB) → written to `%APPDATA%\…\media` →
queue row. When online: server signs upload (`/media/imagekit-auth`) → direct upload with a deterministic
file name (`<queue id>.<ext>`, overwrite) so retries never duplicate → URL recorded on the account in a
local transaction → only then is the item marked uploaded. Crash mid-upload → re-queued on start.
Replaced/removed images are deleted from ImageKit only after the change has synced (server refuses to
delete a file still referenced).

## Local data location

`%APPDATA%\org.codexstocks.desktop\codex-stocks.sqlite` (+ `media\`). Outside the install folder: upgrades and
uninstall keep it (verified, see docs/RELEASE.md).
