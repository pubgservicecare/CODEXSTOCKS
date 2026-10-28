# CODE X STOCKS

Offline-first inventory for PUBG Mobile accounts: a Windows desktop app (Tauri 2) with an encrypted
credential vault and cloud sync, a public storefront (**codexstocks.org**) and a private admin website
(**admin.codexstocks.org**), all sharing one server API and one Neon PostgreSQL database.

## Repository layout

```
apps/
  desktop/        Tauri 2 + React desktop app (Windows installer)
    src-tauri/    Rust shell: one SQLite connection, image files, backup file I/O
  web/            Next.js 16: storefront, admin website, /api/v1 route
packages/
  shared/         Zod data contracts, business rules, commands, accounting, public DTOs
  crypto/         Vault, XChaCha20-Poly1305, Argon2id, recovery key, encrypted backups
  server/         Postgres schema/migrations, auth, sync, admin + public API (framework-agnostic)
  api-client/     Typed HTTP client + ImageKit upload
  local-core/     Desktop engine: SQLite store, sync outbox, conflicts, image queue, backup/restore
  ui/             Admin React UI used by BOTH the desktop app and admin.codexstocks.org
docs/             Architecture, security, accounting, migrations, testing, release, deployment, backup
release/          Built installer (CODE-X-STOCKS-Setup-x64.exe) — not committed
```

## Quick start (development)

Requirements: Node 22.13+, npm 10, Rust (rustup), Visual Studio 2022 Build Tools (C++ workload), Windows 10/11.

```powershell
npm install
npm test                      # all automated tests (no external services needed)
npm run typecheck

# Website with an in-memory demo database (DEMO data, never production):
cd apps/web; $env:DEMO_MODE="1"; $env:COOKIE_SECURE="false"; $env:ADMIN_ORIGINS="http://localhost:3000"; npx next dev
#   storefront: http://localhost:3000     admin: http://localhost:3000/admin  (demo / Demo-Owner-Pass1!)

# Desktop app in development:
npm run desktop:dev
```

## Build

```powershell
npm run desktop:build   # -> release\CODE-X-STOCKS-Setup-x64.exe (also apps\desktop\src-tauri\target\release\bundle\nsis\)
npm run web:build
```

## Production setup (summary)

1. Put secrets in `apps/web/.env.local` (local) and in Vercel → Settings → Environment Variables (see `.env.example`).
2. `npm run db:status` then `npm run db:migrate` (forward-only, never destructive).
3. Deploy `apps/web` to Vercel; add `codexstocks.org` and `admin.codexstocks.org` domains; set DNS records.
4. Install the desktop app → "First PC — create my cloud account" → enter the server setup code.

Full details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Current status: [CODEX_STOCKS_PROGRESS.md](CODEX_STOCKS_PROGRESS.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Desktop ⇄ web admin parity](docs/PARITY.md)
- [Design system, artwork & before/after screenshots](docs/DESIGN.md)
- [Security model & limitations](docs/SECURITY.md)
- [Accounting & profit formula](docs/ACCOUNTING.md)
- [Database migrations](docs/DATABASE_MIGRATIONS.md)
- [Testing](docs/TESTING.md)
- [Release checklist (desktop)](docs/RELEASE.md)
- [Deployment & domains](docs/DEPLOYMENT.md)
- [Production readiness preflight](docs/PRODUCTION_PREFLIGHT.md)
- [Backup & restore](docs/BACKUP_RESTORE.md)

## Troubleshooting

- **App shows "Could not start"**: your data is untouched in `%APPDATA%\org.codexstocks.desktop`. Reinstall the latest installer; data is kept.
- **"Cloud sign-in needed"**: sign out and sign in while online with the current cloud password.
- **Sync errors**: open *Sync & conflicts*; failed items retry automatically, rejected items show the reason and can be retried or discarded.
