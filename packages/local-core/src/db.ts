import { ENTITIES, ENTITY_FIELDS, type Entity, type EntityRowMap } from "@codex/shared";

export type SqlValue = string | number | null;

/**
 * Platform SQLite driver. The desktop app implements this with a Rust command that
 * holds ONE rusqlite connection; tests use node:sqlite. All calls are serialized by
 * LocalDb, so BEGIN/COMMIT issued as separate calls form a real transaction.
 */
export interface SqlDriver {
  execute(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

export interface Q {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "bigint") return Number(v);
  return JSON.stringify(v);
}

export class LocalDb {
  private chain: Promise<unknown> = Promise.resolve();
  private inTx = false;

  constructor(private driver: SqlDriver) {}

  private q(): Q {
    const d = this.driver;
    return {
      run: (sql, params = []) => d.execute(sql, params.map(toSql)),
      all: <T>(sql: string, params: unknown[] = []) => d.select<T>(sql, params.map(toSql)),
      one: async <T>(sql: string, params: unknown[] = []) => (await d.select<T>(sql, params.map(toSql)))[0] ?? null,
    };
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  run(sql: string, params: unknown[] = []) {
    return this.serialize(() => this.q().run(sql, params));
  }
  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.serialize(() => this.q().all<T>(sql, params));
  }
  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.serialize(() => this.q().one<T>(sql, params));
  }

  /** Atomic unit of work. Everything inside commits together or not at all. */
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    if (this.inTx) throw new Error("Nested transaction");
    return this.serialize(async () => {
      const q = this.q();
      await q.run("BEGIN IMMEDIATE");
      this.inTx = true;
      try {
        const out = await fn(q);
        await q.run("COMMIT");
        return out;
      } catch (e) {
        await q.run("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        this.inTx = false;
      }
    });
  }

  /** Read-only consistent snapshot (serialized with writers). */
  read<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    return this.serialize(() => fn(this.q()));
  }
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const SQL_TYPE = { text: "TEXT", int: "INTEGER", bool: "INTEGER" } as const;

function entityTableSql(entity: Entity): string {
  const cols = Object.entries(ENTITY_FIELDS[entity]).map(([c, t]) =>
    c === "id" ? `"id" TEXT PRIMARY KEY` : `"${c}" ${SQL_TYPE[t]}`,
  );
  cols.push(`sync_state TEXT NOT NULL DEFAULT 'synced'`, `base_json TEXT`);
  return `CREATE TABLE IF NOT EXISTS ${entity} (${cols.join(", ")})`;
}

const LOCAL_TABLES = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     entity TEXT NOT NULL,
     entity_id TEXT NOT NULL,
     payload TEXT NOT NULL,
     base_rev INTEGER,
     attempts INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'pending',
     last_error TEXT,
     next_attempt_at TEXT,
     created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS outbox_entity_idx ON outbox(entity_id)`,
  `CREATE TABLE IF NOT EXISTS conflicts (
     id TEXT PRIMARY KEY,
     entity TEXT NOT NULL,
     entity_id TEXT NOT NULL,
     local_json TEXT NOT NULL,
     server_json TEXT NOT NULL,
     fields TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open',
     resolution TEXT,
     created_at TEXT NOT NULL,
     resolved_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS media_queue (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     status TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     remote_url TEXT,
     remote_file_id TEXT,
     next_attempt_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS media_queue_account_idx ON media_queue(account_id)`,
  `CREATE TABLE IF NOT EXISTS media_deletes (
     file_id TEXT PRIMARY KEY,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     created_at TEXT NOT NULL)`,
];

export const LOCAL_SCHEMA_VERSION = 1;

/**
 * Creates/updates the local schema. Additive entity columns are added automatically
 * (ALTER TABLE ADD COLUMN), so upgrades never require deleting local data.
 */
export async function migrateLocal(db: LocalDb): Promise<void> {
  await db.tx(async (q) => {
    for (const s of LOCAL_TABLES) await q.run(s);
    for (const e of ENTITIES) {
      await q.run(entityTableSql(e));
      const info = await q.all<{ name: string }>(`PRAGMA table_info(${e})`);
      const have = new Set(info.map((c) => c.name));
      for (const [c, t] of Object.entries(ENTITY_FIELDS[e]))
        if (!have.has(c)) await q.run(`ALTER TABLE ${e} ADD COLUMN "${c}" ${SQL_TYPE[t]}`);
    }
    await q.run(`CREATE INDEX IF NOT EXISTS login_links_acc ON login_links(account_id)`);
    await q.run(`CREATE INDEX IF NOT EXISTS backup_codes_set ON backup_codes(set_id)`);
    await q.run(`CREATE INDEX IF NOT EXISTS sales_acc ON sales(account_id)`);
    await q.run(`CREATE INDEX IF NOT EXISTS refunds_sale ON refunds(sale_id)`);
    await q.run(`INSERT OR IGNORE INTO kv (key, value) VALUES ('schema_version', ?)`, [String(LOCAL_SCHEMA_VERSION)]);
  });
}

/* ------------------------------------------------------------------ */
/* Row conversion                                                      */
/* ------------------------------------------------------------------ */

export function fromLocal<E extends Entity>(entity: E, raw: Record<string, unknown>): EntityRowMap[E] {
  const out: Record<string, unknown> = {};
  for (const [c, t] of Object.entries(ENTITY_FIELDS[entity])) {
    const v = raw[c];
    if (v === undefined || v === null) out[c] = null;
    else if (t === "bool") out[c] = v === 1 || v === true || v === "1";
    else if (t === "int") out[c] = Number(v);
    else out[c] = String(v);
  }
  return out as EntityRowMap[E];
}

export function entityCols(entity: Entity): string[] {
  return Object.keys(ENTITY_FIELDS[entity]);
}

export async function kvGet<T>(q: Q | LocalDb, key: string): Promise<T | null> {
  const r = await q.one<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]);
  return r ? (JSON.parse(r.value) as T) : null;
}

export async function kvSet(q: Q | LocalDb, key: string, value: unknown): Promise<void> {
  if (value === null || value === undefined) await q.run("DELETE FROM kv WHERE key = ?", [key]);
  else await q.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
}
