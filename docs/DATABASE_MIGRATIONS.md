# Database migrations

## Cloud (Neon PostgreSQL)

- Source: `packages/server/src/migrations.ts` (array of versioned migrations, applied in order).
- Tracked in table `schema_migrations (id, checksum, applied_at)`.
- Each migration runs in its own transaction under an advisory lock (safe if two deploys race).
- **Forward-only and non-destructive**: the runner refuses SQL containing `DROP TABLE/SCHEMA/DATABASE`,
  `TRUNCATE` or `DELETE FROM`. There is no reset command.
- A checksum guard refuses to run if an already-applied migration was edited. To change the schema, append
  a new migration (e.g. `0002_add_x`) with `ALTER TABLE … ADD COLUMN …`.

Commands (read `DATABASE_URL` from the environment or `apps/web/.env.local`; the URL is never printed, only the host):

```powershell
npm run db:status    # applied / pending
npm run db:migrate   # apply pending
```

Recommended production procedure:
1. Neon console → create a **branch** (instant copy) → run `db:migrate` against the branch URL first.
2. Run `db:migrate` against production.
3. Deploy the web app.

Migrations are not run automatically during the Vercel build, so a deploy can never change the schema by
accident.

## Desktop (SQLite)

`packages/local-core/src/db.ts → migrateLocal` runs on every start: `CREATE TABLE IF NOT EXISTS` plus
automatic `ALTER TABLE ADD COLUMN` for new fields. Local data is never dropped on upgrade.
