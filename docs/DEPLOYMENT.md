# Deployment (legacy checklist)

> **Use the current [Vercel deployment guide](./VERCEL_DEPLOYMENT_GUIDE.md) instead.** It verifies
> current project settings, safe Neon migration steps, host routing, environment variables, and
> owner/ImageKit procedures. In particular, `npm run db:status` creates `schema_migrations` if absent;
> it is not a read-only production check. The checklist below is retained as historical reference.

Never paste secrets into chat, commits or docs. Put them only where listed below.

## 1. Neon

1. Neon console → Project → **Connection Details** → choose the **pooled** connection string, `sslmode=require`.
2. Put it in `apps/web/.env.local` as `DATABASE_URL=...` (file is git-ignored).
3. Apply the schema:
   ```powershell
   npm run db:status
   npm run db:migrate
   ```
   (Forward-only, refuses destructive SQL. Recommended: run first against a Neon branch.)

## 2. Secrets for the server

Generate a setup code (one-time, used to create the owner account):
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Vercel (**Production only**), `apps/web/.env.local` (only while migrating) | server only. Do not give Preview the production database; see PRODUCTION_PREFLIGHT.md |
| `SETUP_TOKEN` | Vercel (Production) | remove after the owner account exists |
| `IMAGEKIT_PUBLIC_KEY` | Vercel | |
| `IMAGEKIT_PRIVATE_KEY` | Vercel | server only — never in desktop or browser |
| `IMAGEKIT_URL_ENDPOINT` | Vercel | e.g. `https://ik.imagekit.io/<id>` |
| `IMAGEKIT_FOLDER` | Vercel | default `/codex-stocks/accounts` |
| `PUBLIC_SITE_URL` | Vercel | `https://codexstocks.org` |
| `ADMIN_HOSTS` | Vercel | `admin.codexstocks.org` |
| `ADMIN_ORIGINS` | Vercel | `https://admin.codexstocks.org` |
| `COOKIE_SECURE` | Vercel | `true` |

Vercel dashboard → Project → **Settings → Environment Variables**. Mark them "Sensitive".

## 3. Vercel project

1. Vercel → Add New → Project → import the Git repository (or `vercel link` from `apps/web`).
2. **Root Directory: `apps/web`** (the repo's `apps/web/vercel.json` installs workspace deps from the root).
3. Framework: Next.js. Node 22.
4. Deploy. Check `https://<deployment>/api/v1/health` → `{"ok":true}`.

## 4. Domains & DNS

Vercel → Project → Settings → **Domains** → add `codexstocks.org`, `www.codexstocks.org` (redirect to apex) and
`admin.codexstocks.org`. At your domain registrar's DNS panel create the records Vercel shows, typically:

| Type | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `admin` | `cname.vercel-dns.com` |

Use the exact values Vercel displays if they differ. HTTPS certificates are issued automatically once DNS
resolves. Verify:
```powershell
nslookup codexstocks.org; nslookup admin.codexstocks.org
curl.exe -sI https://codexstocks.org | findstr /i "HTTP strict-transport"
curl.exe -s -o NUL -w "%{http_code}" https://codexstocks.org/admin      # expect 404
curl.exe -s https://admin.codexstocks.org/api/v1/health                # expect {"ok":true,...}
```

## 5. First owner

Install the desktop app → **First PC — create my cloud account** → server URL `https://admin.codexstocks.org`,
the setup code, username, login password, vault passphrase. Save the recovery key. Then remove
`SETUP_TOKEN` from Vercel and redeploy. Website admin login: `https://admin.codexstocks.org` with the same
username/password.

## 6. ImageKit CORS

Uploads go directly from the desktop app / admin browser to `upload.imagekit.io` using a server-issued
signature. No ImageKit settings change is normally needed.

## Rollback

Vercel → Deployments → promote the previous deployment. Database migrations are additive, so older app
versions keep working with a newer schema.
