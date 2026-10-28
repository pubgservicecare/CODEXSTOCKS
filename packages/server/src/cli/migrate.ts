/**
 * Apply database migrations (forward-only, non-destructive).
 *   npm run db:status    -> show applied/pending migrations
 *   npm run db:migrate   -> apply pending migrations
 * Reads DATABASE_URL from the environment or from apps/web/.env.local.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPgDb } from "../db";
import { migrate, migrationStatus } from "../migrations";

for (const f of ["../../apps/web/.env.local", "../../.env.local", ".env.local"]) {
  const p = resolve(process.cwd(), f);
  if (!process.env.DATABASE_URL && existsSync(p)) process.loadEnvFile(p);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in apps/web/.env.local (never commit it).");
    process.exit(2);
  }
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "(unparseable)";
    }
  })();
  const db = await createPgDb(url, { max: 1 });
  try {
    const status = await migrationStatus(db);
    console.log(`Database host: ${host}`);
    console.log(`Applied: ${status.applied.join(", ") || "(none)"}`);
    console.log(`Pending: ${status.pending.join(", ") || "(none)"}`);
    if (process.argv.includes("--status")) return;
    const done = await migrate(db);
    console.log(done.length ? `Applied now: ${done.join(", ")}` : "Nothing to apply.");
  } finally {
    await db.close?.();
  }
}

main().catch((e) => {
  console.error(`Migration failed: ${(e as Error).message}`);
  process.exit(1);
});
