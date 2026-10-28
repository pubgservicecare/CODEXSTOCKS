# CODE X STOCKS — Vercel deployment guide

Verified against the repository on 2026-10-28. This guide is the current deployment reference. It does
not imply that any Vercel, Neon, ImageKit, or DNS setting has been applied or tested. No production
environment, data, or credentials were accessed while preparing it.

## 1. Vercel project settings

Import `pubgservicecare/CODEXSTOCKS` as **one** Vercel project for the web app. Configure:

| Setting                                     | Value                                                                |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Root Directory                              | `apps/web`                                                           |
| Framework Preset                            | Next.js (`apps/web/vercel.json` declares `nextjs`)                   |
| Install Command                             | `cd ../.. && npm ci` (from `apps/web`, as declared in `vercel.json`) |
| Build Command                               | `next build`                                                         |
| Output Directory                            | Leave unset; use Next.js/Vercel's default `.next` output             |
| Node.js Version                             | `24.x`                                                               |
| Include source files outside Root Directory | Enable; `apps/web` imports workspace packages from `packages/`       |

The root `package.json` declares Node `>=22.13`. Vercel currently supports Node `22.x` and `24.x`; its
version mapping selects `24.x` for this engine range. Set the project to `24.x` explicitly. The source
also builds locally under Node `22.23.3`; a Vercel Linux build has not been run.

The custom install command changes to the repository root to run `npm ci` against the root
`package-lock.json`; `next build` then runs from the configured app root. Do not set a static export,
custom output directory, or standalone output. `next.config.ts` sets the tracing root to the monorepo
root. The build does not run migrations and does not require production environment variables.

References: [Vercel monorepos](https://vercel.com/docs/monorepos),
[Vercel build configuration](https://vercel.com/docs/builds/configure-a-build), and
[Vercel supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## 2. Production environment variables

Set variables in Vercel **Settings → Environment Variables**, scoped to **Production** unless noted.
Never put values in Git, documentation, chat, browser-visible `NEXT_PUBLIC_*` variables, or Preview
environments that connect to production data.

| Variable                | Requirement and verified behavior                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Required at runtime. Use the Neon PostgreSQL connection string for this app (pooled connection with TLS/`sslmode=require` is appropriate). The server uses it to open the database pool. Do not use the production URL for Preview; use an isolated Neon branch or leave Preview unconfigured. |
| `SETUP_TOKEN`           | Temporary, only while creating the first owner. Must be at least 16 characters; generate a random value of 32+ bytes. Remove it after owner setup and redeploy.                                                                                                                                |
| `IMAGEKIT_PUBLIC_KEY`   | Required for uploads.                                                                                                                                                                                                                                                                          |
| `IMAGEKIT_PRIVATE_KEY`  | Required for uploads; server-only signing/deletion credential. Mark sensitive.                                                                                                                                                                                                                 |
| `IMAGEKIT_URL_ENDPOINT` | Required for uploads, e.g. `https://ik.imagekit.io/<your-imagekit-id>`. The storefront CSP permits ImageKit images from `ik.imagekit.io`; use this host.                                                                                                                                       |
| `IMAGEKIT_FOLDER`       | Optional; defaults to `/codex-stocks/accounts`.                                                                                                                                                                                                                                                |
| `PUBLIC_SITE_URL`       | Optional; defaults to `https://codexstocks.org` and is used for storefront metadata/share links.                                                                                                                                                                                               |
| `ADMIN_HOSTS`           | Optional; default includes `admin.codexstocks.org`. If set, it replaces the defaults; set it to `admin.codexstocks.org` (comma-separated only if you intentionally need more admin hosts).                                                                                                     |
| `ADMIN_ORIGINS`         | Optional; defaults to `https://admin.codexstocks.org`. If overridden, include the exact HTTPS origin used by the admin site; cookie-authenticated writes check it.                                                                                                                             |
| `COOKIE_SECURE`         | Optional; defaults to secure cookies in production. Leave unset or set to `true`; never set `false` in Production.                                                                                                                                                                             |
| `EXTRA_CORS_ORIGINS`    | Optional; only needed for additional browser origins. The desktop Tauri origins are already allowed.                                                                                                                                                                                           |

Do not set `DEMO_MODE` in Production. Do not manually set Vercel's `VERCEL_ENV` or `NODE_ENV`. The
desktop-only `VITE_API_BASE_URL` is a build-time setting for `apps/desktop`, not a Vercel web runtime
variable. The three ImageKit values must all be configured or upload signing returns HTTP 503.

Generate the one-time setup token locally and keep it out of Git and logs:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 3. Neon production migration procedure

The web app does **not** migrate automatically. The current migration is `0001_init`; migration code
uses a transaction and advisory lock, records a checksum, and refuses destructive SQL. The migration
runner has no database-name confirmation and the initial schema uses ordinary `CREATE TABLE`, so only
run it against the intended CODE X STOCKS database. Do not run it against a shared or unexplored
database.

Important: `npm run db:status` is **not read-only**. It creates `schema_migrations` if absent before
reporting status. The CLI prefers an inherited `DATABASE_URL` over a local env file and reports only
the host. Never print the connection string.

1. In Neon, create or identify the dedicated CODE X STOCKS project/database. Make a Neon branch for
   migration rehearsal. If this is an existing project, check its current state before changing it.
2. In Neon's SQL Editor, check the target database and its public tables before running either CLI
   command:
   ```sql
   SELECT current_database(), current_user;
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
   ORDER BY table_name;
   ```
   For a brand-new database, expect no public tables. If any table is unexpected, stop and have the
   database owner identify it; do not try the migration to see what happens.
3. Use a fresh PowerShell session. Check whether a `DATABASE_URL` is inherited without printing it:
   ```powershell
   Test-Path Env:DATABASE_URL
   ```
   If it is set, either deliberately confirm it is the intended target or remove it **in this
   session only** to let the migration CLI load `apps/web/.env.local`:
   ```powershell
   Remove-Item Env:DATABASE_URL
   ```
   Do not overwrite an existing ignored env file without first preserving its contents locally. Keep
   the connection string out of command history and output.
4. Configure the migration URL privately (an environment variable in that session or the ignored
   `apps/web/.env.local`). Before proceeding, verify in Neon that the selected project, database,
   and branch are the intended target. The CLI prints the hostname only; that is not a substitute
   for checking the database name and branch.
5. On the rehearsal branch, run:
   ```powershell
   npm run db:status
   npm run db:migrate
   ```
   Confirm the host and pending/applied migration IDs are expected. The status command creates
   `schema_migrations`; the migration applies `0001_init`. Re-run the SQL table query and verify the
   expected application schema and migration record.
6. Before production migration, take/confirm a Neon backup or restore point and repeat the
   database/branch/table checks against the production target. Stop if the target is not the
   intended empty CODE X STOCKS database, or if its schema state is unfamiliar.
7. Only after the rehearsal and production target checks, run the same `db:status` and
   `db:migrate` commands against the production URL. Verify the migration result in Neon. Do not
   run this step from Vercel or as part of a build.
8. Configure `DATABASE_URL` in the Vercel **Production** environment only after the migration is
   confirmed. Trigger a deployment so the production runtime receives the variable.

These are instructions for an authorized operator; no Neon migration or production database access
was performed for this repository review.

## 4. Domains and host routing

Attach all three domains to the same Vercel project:

| Domain                  | Expected behavior                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codexstocks.org`       | Public storefront. `/admin` and `/admin/*` return 404.                                                                                                |
| `admin.codexstocks.org` | Admin app. The Next.js `proxy.ts` rewrites requests to the admin app; `/api/v1/*` passes through.                                                     |
| `www.codexstocks.org`   | Public storefront if attached; configure a Vercel domain redirect to `codexstocks.org` for canonicalization. The code does not perform this redirect. |

This works in one project without application code changes, provided `admin.codexstocks.org` is
included in `ADMIN_HOSTS` (it is the default) and `www` is configured as a redirect. The admin API
base URL used by the desktop app is `https://admin.codexstocks.org`.

Add the domains under Vercel **Settings → Domains**, and use the exact DNS records Vercel shows at
the registrar. Do not assume fixed A/CNAME targets. Wait for Vercel to confirm DNS and HTTPS
certificates before owner setup. Production cookies require HTTPS.

After deployment and DNS activation, verify:

```powershell
curl.exe -i https://admin.codexstocks.org/api/v1/health
curl.exe -i https://admin.codexstocks.org/api/v1/auth/status
curl.exe -I https://www.codexstocks.org/
curl.exe -i https://codexstocks.org/admin
```

Expected: health returns HTTP 200 with `"ok":true` when the database is reachable; auth status returns
`owner_exists` and `setup_enabled`; `www` redirects to the apex; the public `/admin` request returns 404. Health only checks database connectivity (`SELECT 1`), not that application migrations exist.
Auth status queries the `owner` table, so it only works after the schema is migrated.

## 5. First owner initialization

The website provides sign-in, not initial owner creation. Create the first owner using the desktop
app's **First PC → Create my cloud owner account** flow:

1. Deploy the migrated app and make `admin.codexstocks.org` resolve with HTTPS.
2. Immediately before owner setup, add the temporary Production `SETUP_TOKEN` and redeploy. Verify
   `/api/v1/auth/status` reports `setup_enabled: true`.
3. In the desktop app, use server URL `https://admin.codexstocks.org`, the setup token, a unique
   owner username, a strong login password, and a separate vault passphrase. The setup endpoint is
   `POST /api/v1/auth/setup`; it refuses setup when the token is missing/short/incorrect and refuses
   to create a second owner.
   The setup endpoint is not rate-limited; keep the token high-entropy and enable it only for the
   short window needed to complete this step.
4. Store the one-time recovery key offline. Do not send it to the server or put it in this repository.
5. Remove `SETUP_TOKEN` from Vercel Production and redeploy. Verify
   `GET /api/v1/auth/status` reports `owner_exists: true` and `setup_enabled: false`, then sign in
   to the admin site.

Do not create the owner as part of deployment preparation or before the production database and
domain have been verified.

## 6. ImageKit upload smoke test

The admin client requests signed parameters from `POST /api/v1/media/imagekit-auth` after login;
the server signs with `IMAGEKIT_PRIVATE_KEY`. The browser uploads directly to
`https://upload.imagekit.io/api/v1/files/upload` using the public key and short-lived signature.
The private key is not sent to the browser. The default destination is
`/codex-stocks/accounts`.

After owner setup and configuring all three required ImageKit variables:

1. In the admin site, create an unpublished throwaway account and upload a small, harmless JPEG,
   PNG, or WebP.
2. Confirm it displays in admin and that the file appears in the configured ImageKit folder.
3. If desired, publish the throwaway listing briefly and confirm its image loads from the storefront
   ImageKit host; then unpublish it.
4. Remove the image using the app and confirm it is removed from ImageKit; delete the throwaway
   account.

If signing responds 503, check all three ImageKit variables in the Production environment. If the
upload succeeds but the storefront image is blocked, verify the endpoint uses `ik.imagekit.io`.
No ImageKit setting or live upload was tested during this repository preparation.

## 7. Rollback

- For an application-only problem, use Vercel Deployments to promote the last known-good deployment.
- Do not roll back or reset the Neon database just because an app deployment is rolled back.
  Migrations are forward-only; retain additive schema and use a later corrective migration for
  schema changes.
- If data recovery is necessary, coordinate with the Neon database owner and assess the restore
  point's impact on writes made since then. A database restore can discard data; it is not an
  automatic part of Vercel rollback.
- After rollback, verify health, auth status, admin login, and storefront behavior again.

## 8. Repository checks and remaining external steps

Verified locally for this guide: the Git remote is `pubgservicecare/CODEXSTOCKS`; branch `master`
was clean at inspection start; `npm test` passed 82/82 tests; `npm run typecheck` passed; and
`npm run web:build` passed with database access explicitly disabled. A disposable in-memory
PostgreSQL check returned HTTP 200 from `/api/v1/health` (`ok: true`) and `/api/v1/auth/status`
(`owner_exists: false`, `setup_enabled: true`). No Vercel deployment, DNS change, Production env
change, Neon connection, production migration, or production owner creation was done. The build was
local on Windows, not a Vercel Linux build.

Deployment still requires an authorized operator with access to:

- The Vercel team/project, to import/configure the repository, set sensitive Production variables,
  add domains, and deploy.
- The dedicated Neon project/database and its connection details, to rehearse and then apply the
  migration as described above.
- The ImageKit account, to obtain its public key, private key, and URL endpoint.
- The domain registrar, to publish the exact DNS records Vercel supplies.
- The desktop app and owner-provided login/vault credentials to perform the one-time owner setup.

No repository blocker was found. These external account actions and the actual production checks
remain unverified; do not treat them as complete until performed.
