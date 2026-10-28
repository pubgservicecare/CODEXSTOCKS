import {
  ConflictError,
  ENTITY_FIELDS,
  isEntity,
  newId,
  type Entity,
  type EntityRowMap,
  type EntityStore,
} from "@codex/shared";
import type { Db } from "./db";

export function columns(entity: Entity): string[] {
  return Object.keys(ENTITY_FIELDS[entity]);
}

function assertEntity(entity: string): asserts entity is Entity {
  if (!isEntity(entity)) throw new Error("Unknown entity");
}

export function selectList(entity: Entity, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return columns(entity)
    .map((c) => `${p}"${c}"`)
    .join(", ");
}

function fromDb<E extends Entity>(entity: E, row: Record<string, unknown>): EntityRowMap[E] {
  const out: Record<string, unknown> = {};
  for (const c of columns(entity)) out[c] = row[c] ?? null;
  return out as EntityRowMap[E];
}

/**
 * Postgres-backed EntityStore. Every write bumps the row revision and takes a fresh
 * value from the global change sequence, which is what devices pull from.
 */
export class PgEntityStore implements EntityStore {
  constructor(
    private db: Db,
    public actor: string,
    private clock: () => Date = () => new Date(),
  ) {}

  now() {
    return this.clock().toISOString();
  }
  newId() {
    return newId(this.clock().getTime());
  }

  async get<E extends Entity>(entity: E, id: string): Promise<EntityRowMap[E] | null> {
    assertEntity(entity);
    const r = await this.db.query(`SELECT ${selectList(entity)} FROM ${entity} WHERE id = $1`, [id]);
    return r.rows[0] ? fromDb(entity, r.rows[0]) : null;
  }

  async list<E extends Entity>(
    entity: E,
    where: Partial<Record<string, string | number | boolean | null>> = {},
    opts: { includeDeleted?: boolean; limit?: number; orderBy?: string } = {},
  ): Promise<EntityRowMap[E][]> {
    assertEntity(entity);
    const cols = new Set(columns(entity));
    const conds: string[] = opts.includeDeleted ? [] : ["deleted = false"];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (!cols.has(k)) throw new Error("Unknown filter column");
      if (v === null) conds.push(`"${k}" IS NULL`);
      else {
        params.push(v);
        conds.push(`"${k}" = $${params.length}`);
      }
    }
    const order = opts.orderBy && cols.has(opts.orderBy) ? `"${opts.orderBy}" DESC` : "created_at ASC";
    const limit = opts.limit ? ` LIMIT ${Math.min(Math.max(1, Math.floor(opts.limit)), 5000)}` : "";
    const r = await this.db.query(
      `SELECT ${selectList(entity)} FROM ${entity}${conds.length ? " WHERE " + conds.join(" AND ") : ""} ORDER BY ${order}${limit}`,
      params,
    );
    return r.rows.map((x) => fromDb(entity, x));
  }

  async put<E extends Entity>(entity: E, row: EntityRowMap[E], prev: EntityRowMap[E] | null): Promise<EntityRowMap[E]> {
    assertEntity(entity);
    const cols = columns(entity).filter((c) => c !== "rev");
    const values = cols.map((c) => (row as Record<string, unknown>)[c] ?? null);
    if (!prev) {
      const ph = cols.map((_, i) => `$${i + 1}`);
      const r = await this.db.query(
        `INSERT INTO ${entity} (${cols.map((c) => `"${c}"`).join(", ")}, rev, change_seq)
         VALUES (${ph.join(", ")}, 1, nextval('change_seq_global'))
         RETURNING ${selectList(entity)}`,
        values,
      );
      return fromDb(entity, r.rows[0]);
    }
    const sets = cols.filter((c) => c !== "id" && c !== "created_at").map((c) => c);
    const params = sets.map((c) => (row as Record<string, unknown>)[c] ?? null);
    params.push(row.id, prev.rev);
    const r = await this.db.query(
      `UPDATE ${entity} SET ${sets.map((c, i) => `"${c}" = $${i + 1}`).join(", ")},
         rev = rev + 1, change_seq = nextval('change_seq_global')
       WHERE id = $${sets.length + 1} AND rev = $${sets.length + 2}
       RETURNING ${selectList(entity)}`,
      params,
    );
    if (!r.rows[0]) throw new ConflictError("This record was changed elsewhere. Reload to see the latest version.");
    return fromDb(entity, r.rows[0]);
  }
}
