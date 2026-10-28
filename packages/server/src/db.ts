/**
 * Minimal database abstraction so the same server code runs on:
 *  - Neon/any Postgres via node-postgres (production)
 *  - PGlite (real Postgres compiled to WASM) in automated tests
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run `fn` in a transaction. Nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

/** Convert driver values into the wire format (ISO strings, numbers). */
export function normalizeRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "bigint") out[k] = Number(v);
    else out[k] = v;
  }
  return out as T;
}

const INT8 = 20;
const DATE = 1082;

/* ------------------------------------------------------------------ */
/* node-postgres (Neon in production)                                  */
/* ------------------------------------------------------------------ */

export async function createPgDb(connectionString: string, opts: { max?: number } = {}): Promise<Db> {
  const pg = await import("pg");
  const Pool = pg.default?.Pool ?? (pg as unknown as { Pool: typeof import("pg").Pool }).Pool;
  const types = pg.default?.types ?? (pg as unknown as { types: typeof import("pg").types }).types;
  const pool = new Pool({
    connectionString,
    max: opts.max ?? 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") => {
        if (oid === INT8) return (v: string) => Number(v);
        if (oid === DATE) return (v: string) => v;
        return types.getTypeParser(oid, format);
      }) as typeof types.getTypeParser,
    },
  });

  type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
  const wrap = (c: Client, inTx: boolean): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await c.query(sql, params);
      return { rows: r.rows.map((x) => normalizeRow<T>(x)), rowCount: r.rowCount ?? 0 };
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      if (inTx) return fn(wrap(c, true));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client, true));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  });
  return { ...wrap(pool, false), close: () => pool.end() };
}

/* ------------------------------------------------------------------ */
/* PGlite (tests / local demo)                                         */
/* ------------------------------------------------------------------ */

interface PGliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

export function wrapPglite(pg: PGliteLike): Db {
  let chain: Promise<unknown> = Promise.resolve();
  let active = false;
  const base = (inTx: boolean): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query<Record<string, unknown>>(sql, params);
      return { rows: r.rows.map((x) => normalizeRow<T>(x)), rowCount: r.rows.length || (r.affectedRows ?? 0) };
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      if (inTx) return fn(base(true));
      const run = async () => {
        active = true;
        await pg.exec("BEGIN");
        try {
          const out = await fn(base(true));
          await pg.exec("COMMIT");
          return out;
        } catch (e) {
          await pg.exec("ROLLBACK");
          throw e;
        } finally {
          active = false;
        }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    },
  });
  return { ...base(false), close: () => pg.close() };
}

export async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite({
    parsers: { [INT8]: (v: string) => Number(v), [DATE]: (v: string) => v },
  });
  return wrapPglite(pg as unknown as PGliteLike);
}
