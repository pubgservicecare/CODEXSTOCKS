import "server-only";
import { configFromEnv, createApi, createPgDb, createPgliteDb, migrate, type Db } from "@codex/server";

/**
 * Server-only access to the database and API. DATABASE_URL and every private key
 * are read here and never reach browser bundles (this module imports "server-only").
 */
// Process-wide singletons (Next.js may load this module once per route bundle).
const g = globalThis as unknown as {
  __codexDb?: Promise<Db> | null;
  __codexApi?: Promise<(req: Request) => Promise<Response>> | null;
};

export function isDemoMode(): boolean {
  return !process.env.DATABASE_URL && process.env.DEMO_MODE === "1" && process.env.VERCEL_ENV !== "production";
}

async function openDb(): Promise<Db> {
  if (process.env.DATABASE_URL) return createPgDb(process.env.DATABASE_URL, { max: 5 });
  if (isDemoMode()) {
    // Throw-away in-memory Postgres for local previews ONLY. Never used in production.
    const db = await createPgliteDb();
    await migrate(db);
    const { seedDemo } = await import("./demo");
    await seedDemo(db);
    return db;
  }
  throw new Error("DATABASE_URL is not configured");
}

export function getDb(): Promise<Db> {
  g.__codexDb ??= openDb().catch((e) => {
    g.__codexDb = null;
    throw e;
  });
  return g.__codexDb;
}

export function getApi(): Promise<(req: Request) => Promise<Response>> {
  g.__codexApi ??= getDb()
    .then((db) => {
      const env = { ...process.env } as Record<string, string | undefined>;
      if (isDemoMode()) env.SETUP_TOKEN ||= "demo-setup-token-0000";
      return createApi(configFromEnv(env, db));
    })
    .catch((e) => {
      g.__codexApi = null;
      throw e;
    });
  return g.__codexApi;
}
