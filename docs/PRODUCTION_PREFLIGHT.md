# CODE X STOCKS — production readiness preflight

Inspection date: 2026-10-28 · Scope: **inspect and report only**. Nothing was deployed, no migration or
`db:status` was run, no DNS was touched, no production data or secrets were accessed. No secret values
appear in this document.

> This is a point-in-time preflight report, not the current deployment checklist. Use
> [VERCEL_DEPLOYMENT_GUIDE.md](./VERCEL_DEPLOYMENT_GUIDE.md) for the latest repository state and
> Vercel/Neon instructions; some environment, Git, and runtime observations below may be stale.

Legend: ✅ verified now (by reading code or running a check) · ⚠ risk / action needed · ⛔ blocker · ❔ not verified

---

## 1. Verified readiness items

| Item | Result | Evidence |
|---|---|---|
| Git | ✅ Repository exists on `master` with **no commits**; all files untracked. Nothing is in Git history, so no secret can be in history. | `git status`, `git log` |
| `.gitignore` | ✅ Ignores `.env`, `.env.*` (keeps `.env.example`), `*.pem`, `*.key`, `*.cxbackup`, `recovery-key*.txt`, `*.sqlite`, `.vercel/`, `release/`, build outputs. | `.gitignore` |
| Secret files on disk | ✅ No `.env*` files exist (only `.env.example`, names only). `DATABASE_URL` is not set in the shell used for this inspection. | directory listing, env check |
| Browser bundles | ✅ `apps/web/.next/static` contains none of: `postgres://`, `neon.tech`, ImageKit private-key patterns, `DATABASE_URL`, `SETUP_TOKEN`, demo credentials. No `NEXT_PUBLIC_*` variables exist, so no env value is inlined into browser code. | grep of build output |
| Desktop bundle | ✅ `apps/desktop/dist` (embedded in the .exe) contains no secrets; the only match is the label text "SETUP_TOKEN" in a help hint. The installed .exe and the 1.0.2 installer contain no matches either (assets are compressed inside them, so the `dist` scan is the authoritative one). | grep |
| Public artwork | ✅ No secret patterns in `packages/ui/assets/art/*`. | grep |
| Server-only secrets | ✅ `DATABASE_URL`, `SETUP_TOKEN`, `IMAGEKIT_PRIVATE_KEY` are read only in `apps/web/lib/server.ts` (imports `server-only`) and `packages/server` (config, CLI). | code search |
| Public endpoints | ✅ Covered by automated tests (public DTO allowlist; no cost/notes/credentials/codes/owner contact). | `packages/server/test`, `apps/web/test/parity.test.ts` |
| Owner creation | ✅ Single owner enforced by schema (`owner.id = 1` CHECK) and `INSERT … ON CONFLICT DO NOTHING` → a second setup returns **409**. Setup refuses when `SETUP_TOKEN` is missing or shorter than 16 chars; token compared in constant time. | `packages/server/src/api.ts` `/auth/setup` |
| Production web never auto-migrates | ✅ With `DATABASE_URL` set, the app only opens a pool; migrations run **only** via the CLI. | `apps/web/lib/server.ts` |
| Demo mode cannot reach production | ✅ Demo DB is used only when `DATABASE_URL` is empty **and** `DEMO_MODE=1` **and** `VERCEL_ENV !== "production"`. | `isDemoMode()` |
| Admin session cookie | ✅ `__Host-cx_admin` (host-only, Secure) in production; `COOKIE_SECURE` defaults to on when `NODE_ENV=production`. | `api.ts`, `config.ts` |
| Lockfile for Vercel (Linux) | ✅ `package-lock.json` (v3) includes Linux builds of `@next/swc`, `sharp`, `esbuild`. ❔ `npm ci` on Linux has **not** been run. | lockfile inspection |
| Tests | ✅ **82/82 passed, run during this inspection** (7 files). | `npx vitest run` at 10:54 |
| Type check | ✅ **0 errors, run during this inspection.** | `npm run typecheck` |
| Web production build | ✅ Last run today 07:19 (`next build` succeeded). No web source has changed since (only desktop version files and the auto-generated `next-env.d.ts`). Not re-run now (no rebuilds in this task). | `.next/BUILD_ID` timestamp, file comparison |
| Desktop installer 1.0.2 | ✅ Built today 07:25; upgrade 1.0.1→1.0.2 verified on this PC (see RELEASE.md). Not rebuilt now. | `release/`, RELEASE.md |

---

## 2. Environment variables (names read by the current code)

Derived from the code (`packages/server/src/config.ts`, `apps/web/lib/server.ts`, `apps/web/proxy.ts`,
store pages, migration CLI, desktop `main.tsx`) — not from older docs.

| Name | Where it belongs | Required? | Notes |
|---|---|---|---|
| `DATABASE_URL` | Vercel → **Production only**; `apps/web/.env.local` on your PC only while running migrations | **Required** | Server only. If missing in production, every page using data fails (`DATABASE_URL is not configured`). Do **not** add it to Preview unless it points to a separate Neon branch. |
| `SETUP_TOKEN` | Vercel → Production, **temporarily** | Required only to create the owner once | Must be ≥ 16 chars (code enforces); use 32+ random. Remove and redeploy right after the owner exists. |
| `IMAGEKIT_PUBLIC_KEY` | Vercel → Production | Required for uploads | All three ImageKit values must be set, otherwise uploads return 503 "not configured". |
| `IMAGEKIT_PRIVATE_KEY` | Vercel → Production | Required for uploads | Server only. Signs uploads; used for server-side deletes. |
| `IMAGEKIT_URL_ENDPOINT` | Vercel → Production | Required for uploads | Must be on `https://ik.imagekit.io/...` (see §7: the storefront CSP only allows that host). |
| `IMAGEKIT_FOLDER` | Vercel → Production | Optional | Default `/codex-stocks/accounts`. |
| `PUBLIC_SITE_URL` | Vercel → Production | Optional | Default `https://codexstocks.org` (metadata + WhatsApp link). |
| `ADMIN_HOSTS` | Vercel → Production | Optional | Default `admin.codexstocks.org,admin.localhost`. ⚠ If you set it, it **replaces** the defaults, so it must include `admin.codexstocks.org`. |
| `ADMIN_ORIGINS` | Vercel → Production | Optional | Default `https://admin.codexstocks.org` (exact origin, used for the CSRF check on cookie writes). |
| `COOKIE_SECURE` | Vercel → Production | Optional | Defaults to secure in production. Never set to `false` in production. |
| `EXTRA_CORS_ORIGINS` | Vercel | Optional, not needed | Desktop (Tauri) origins are allowed by default. |
| `DEMO_MODE` | **Never in Production** | — | Ignored in production. Only for local preview (or a Preview environment with **no** `DATABASE_URL`). |
| `VERCEL_ENV`, `NODE_ENV` | Set by Vercel | — | Do not set manually. |
| `VITE_API_BASE_URL` | `apps/desktop/.env` at desktop **build** time | Optional | Public, not a secret. Default when absent: `https://admin.codexstocks.org`. |

---

## 3. Safe Neon setup and migration

### What the commands do (from `packages/server/src/cli/migrate.ts` and `migrations.ts`)

- **Which database:** `DATABASE_URL` from the **process environment first**; only if that is empty does it load
  `apps/web/.env.local` (then `.env.local` in the repo root / current folder).
  ⚠ If a `DATABASE_URL` from another project is set in your Windows user/system environment or terminal,
  **that database is used and `.env.local` is ignored.**
- **`npm run db:status`** — connects, prints `Database host: <hostname>` (host only, not the database
  name), lists applied/pending migrations. ⚠ It is **not purely read-only**: it runs
  `CREATE TABLE IF NOT EXISTS schema_migrations (...)` in the target database.
- **`npm run db:migrate`** — does the same, then applies each pending migration in its own transaction
  under an advisory lock, refuses any SQL containing destructive statements, and records a checksum
  (refuses to run if an applied migration was edited). Currently there is one migration, `0001_init`.
- **What `0001_init` creates (in the `public` schema):** sequence `change_seq_global`; tables `owner`,
  `devices`, `sessions`, `login_attempts`, `vault`, `sync_ops`, `conflicts`, `accounts`, `login_links`,
  `credentials`, `backup_code_sets`, `backup_codes`, `sales`, `refunds`, `expenses`, `audit_events`,
  `settings`, plus `schema_migrations`. These names are generic: on a shared database a name clash makes the
  migration fail and roll back, but `schema_migrations` may already have been created by `db:status`.
- There is no prompt, no database-name check and no "is this empty?" check in the CLI. Safety therefore
  relies on the steps below.

### Steps

1. In Neon create a **new project** named e.g. `codex-stocks` (not a branch of another app's project).
   Default database `neondb` or create `codexstocks`.
2. In **that project's** Neon SQL Editor, run this read-only check:
   ```sql
   SELECT current_database(), current_user;
   SELECT table_schema, table_name FROM information_schema.tables
   WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2;
   ```
   Expected: your new database name and **zero rows**. If any table is listed, stop.
3. Note the project's endpoint id (`ep-…`) shown in Neon → Connection Details.
4. On your PC confirm no stray `DATABASE_URL` is set (PowerShell, prints only True/False):
   ```powershell
   Test-Path Env:DATABASE_URL
   [bool][Environment]::GetEnvironmentVariable('DATABASE_URL','User')
   [bool][Environment]::GetEnvironmentVariable('DATABASE_URL','Machine')
   ```
   All three must be `False`. Use a **new** terminal window.
5. Create `apps/web/.env.local` containing one line `DATABASE_URL=<Neon connection string>` (pooled or
   direct both work; each migration is a single transaction). Never paste it into chat.
6. Before connecting, check the target without printing the password:
   ```powershell
   node -e "process.loadEnvFile('apps/web/.env.local'); const u=new URL(process.env.DATABASE_URL); console.log(u.hostname, u.pathname)"
   ```
   The hostname must contain the `ep-…` id from step 3 and the path must be your database name.
7. `npm run db:status` → expect `Database host: ep-…`, `Applied: (none)`, `Pending: 0001_init`.
8. `npm run db:migrate` → expect `Applied now: 0001_init`.
9. Re-run the step-2 query: expect the 18 tables listed above plus `schema_migrations`.
10. Keep `.env.local` only as long as needed (it is Git-ignored), or delete it.

---

## 4. Vercel setup and deployment sequence

Configuration (from `apps/web/vercel.json`, `next.config.ts`, `package.json`):

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework preset | Next.js (16.4.3) |
| Install command | from `vercel.json`: `cd ../.. && npm ci` (installs the workspace from the repo root) |
| Build command | from `vercel.json`: `next build` |
| Output | default (`.next`) |
| Node.js version | 22.x (root `engines` requires ≥ 22.13) |
| "Include files outside the Root Directory" | must stay **enabled** (workspace packages live in `packages/`) |
| Env vars needed at build time | none (all pages are dynamic; the build succeeded locally without env) |
| Runtime env vars | §2, Production environment |

Sequence:
1. ⛔ Create the first Git commit and push to a **private** repository (or deploy with the Vercel CLI).
   Before committing, run `git status` and confirm no `.env*` (other than `.env.example`), `release/`,
   `*.sqlite` or `.cxbackup` files are staged.
2. Create the Vercel project from that repo with the settings above. **Do not add env vars yet** except
   as listed in step 4; the first automatic deployment may fail without `DATABASE_URL`, which is harmless.
3. Neon migration (§3) must be complete before the site receives `DATABASE_URL`.
4. Add Production env vars: `DATABASE_URL`, `SETUP_TOKEN`, the three `IMAGEKIT_*` values (optionally
   `IMAGEKIT_FOLDER`, `PUBLIC_SITE_URL`). Leave Preview without `DATABASE_URL`.
5. Deploy to Production. Check `https://<deployment>/api/v1/health` → `{"ok":true,…}` (database reachable).
6. Domains (§5). After DNS is live, check `https://admin.codexstocks.org/api/v1/auth/status` →
   `owner_exists:false, setup_enabled:true`.
7. Create the owner from the desktop app (§6, "First PC"). Save the recovery key offline.
8. Remove `SETUP_TOKEN` from Vercel and **redeploy**; then `auth/status` must show `setup_enabled:false`.
9. ImageKit test (§7). Then publish real listings.

Note: on a `*.vercel.app` URL the admin is **not reachable** (`/admin` returns 404 on any host other than the
admin host or `localhost`), by design. Test the admin only after `admin.codexstocks.org` resolves.

---

## 5. Hostnames, origins and DNS

| Host | Behaviour (from `apps/web/lib/hosts.ts`, `proxy.ts`) |
|---|---|
| `codexstocks.org` | Public storefront. `/admin/*` returns 404. `/api/v1` served (private endpoints need a session). Storefront CSP. |
| `admin.codexstocks.org` | Must be listed in `ADMIN_HOSTS` (it is by default). Every path is rewritten to the admin app; `/api/v1` passes through; admin CSP, `no-store`, `noindex`. The desktop app's API base. |
| `www.codexstocks.org` | Not handled by code; add it in Vercel and set it to **redirect** to `codexstocks.org`. |

Origins: cookie-authenticated writes must come from `ADMIN_ORIGINS` (default `https://admin.codexstocks.org`).
The desktop app uses bearer tokens; its Tauri origins are allowed by CORS by default.

DNS (at your registrar, use the exact values Vercel shows):

| Type | Name | Typical value |
|---|---|---|
| A | `@` | Vercel apex IP shown in Domains |
| CNAME | `www` | Vercel CNAME shown in Domains |
| CNAME | `admin` | Vercel CNAME shown in Domains |

HTTPS is required (the `__Host-` cookie and `COOKIE_SECURE` depend on it); Vercel issues certificates
after DNS resolves.

---

## 6. Desktop production API configuration

- The cloud URL is compiled in at build time from `VITE_API_BASE_URL`; with no `apps/desktop/.env` it falls
  back to **`https://admin.codexstocks.org`** (`apps/desktop/src/main.tsx`).
- ✅ No `apps/desktop/.env` exists, and the built bundle contains `admin.codexstocks.org` and **no**
  `localhost:3000`/`127.0.0.1`. So the current 1.0.2 installer is configured for **production**, not local
  development or a placeholder.
- ⚠ That host does **not serve the API yet** (not deployed, no DNS). Until it does, "First PC" and "Another
  PC" setup will fail with a network error; "local-only" setup works offline and can be connected later.
- The server URL field in the setup wizard is editable, and each installed PC stores its URL in its local
  database after setup, so later builds do not change existing installs.
- The client calls `<base>/api/v1/...`; the admin host passes `/api/` through, so the base must be the
  admin origin with no path.
- No rebuild is needed for production as long as the API lives at `https://admin.codexstocks.org`.

---

## 7. Real ImageKit verification

How uploads work: the signed-in client asks `POST /api/v1/media/imagekit-auth`; the server returns a
token/expiry (20 min)/HMAC signature made with the private key (never sent), the public key and folder; the
client uploads straight to `upload.imagekit.io` (fixed file name + overwrite, so retries don't duplicate);
the server only accepts image URLs starting with `IMAGEKIT_URL_ENDPOINT`; removing an image deletes it
server-side via `api.imagekit.io`.

Requirements and checks:
- Use the default `https://ik.imagekit.io/<id>` endpoint. ⚠ The storefront CSP allows images only from
  `ik.imagekit.io`; a custom ImageKit domain would show broken images until the CSP is updated.
- In ImageKit settings, optionally restrict allowed file types to JPEG/PNG/WebP and enable the "restrict
  unsigned uploads" option (uploads here are always signed).

Safest real test (after §4 step 8):
1. Admin website → create an account titled e.g. `TEST — delete me`, cost 0, **leave it unpublished**.
2. Upload a small harmless JPEG from the account page. Expect "Image uploaded" and the image shown.
3. In the ImageKit Media Library confirm the file is in `/codex-stocks/accounts` (or your folder).
4. Optional: publish briefly and confirm the image loads on `codexstocks.org`, then unpublish.
5. Click **Remove** (expect the file to disappear from ImageKit), then delete the test account.
6. Repeat once from the desktop app (it queues offline and uploads when online).

---

## 8. Remaining blockers and risks (priority order)

1. ⛔ **No credentials/infrastructure yet**: Neon project, ImageKit keys, Vercel project, `SETUP_TOKEN`.
2. ⛔ **No Git commit / remote**: Vercel Git deployments need a pushed repository (or use the Vercel CLI).
3. ⛔ **DNS for `codexstocks.org`, `www`, `admin`** not configured; the desktop installer's default API host
   is unreachable until then.
4. ⚠ **Migration targeting is guarded only by procedure** (§3): the CLI prefers an inherited
   `DATABASE_URL`, prints only the host, and `db:status` writes `schema_migrations`. Follow §3 exactly.
   (Optional hardening, not done in this task: make the CLI print the database name and require a
   confirmation, and make `db:status` read-only.)
5. ⚠ **docs/DEPLOYMENT.md advised `DATABASE_URL` for Preview too**; corrected in this task to Production only,
   because Preview deployments would otherwise write to the live database.
6. ⚠ **`SETUP_TOKEN` window**: anyone holding the token can claim the owner account until it exists. Create
   the owner immediately after DNS is live, then remove the token and redeploy. Setup attempts are not
   rate-limited (login is), so use a long random token.
7. ⚠ **Owner can only be created from the desktop app** ("First PC" → server URL + setup code); the admin
   website has a sign-in screen only.
8. ❔ `npm ci` + `next build` on Vercel's Linux builders not yet exercised.
9. ⚠ Installer not code-signed (SmartScreen warning); not tested on Windows 11 or a clean PC.
10. ⚠ Custom ImageKit domains need a CSP change (§7).
