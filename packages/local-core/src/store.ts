import { isEntity, newId, type Entity, type EntityRowMap, type EntityStore } from "@codex/shared";
import { entityCols, fromLocal, type Q } from "./db";

/**
 * Local SQLite EntityStore. Every write happens inside the caller's transaction and
 * appends a durable outbox operation in the SAME transaction, so a saved change can
 * never be lost from the sync queue (and the queue never references unsaved data).
 */
export class LocalEntityStore implements EntityStore {
  constructor(
    private q: Q,
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
    if (!isEntity(entity)) throw new Error("Unknown entity");
    const r = await this.q.one(`SELECT * FROM ${entity} WHERE id = ?`, [id]);
    return r ? fromLocal(entity, r) : null;
  }

  async list<E extends Entity>(
    entity: E,
    where: Partial<Record<string, string | number | boolean | null>> = {},
  ): Promise<EntityRowMap[E][]> {
    if (!isEntity(entity)) throw new Error("Unknown entity");
    const cols = new Set(entityCols(entity));
    const conds = ["deleted = 0"];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (!cols.has(k)) throw new Error("Unknown filter column");
      if (v === null) conds.push(`"${k}" IS NULL`);
      else {
        conds.push(`"${k}" = ?`);
        params.push(v);
      }
    }
    const rows = await this.q.all(`SELECT * FROM ${entity} WHERE ${conds.join(" AND ")} ORDER BY created_at`, params);
    return rows.map((r) => fromLocal(entity, r));
  }

  async put<E extends Entity>(entity: E, row: EntityRowMap[E], prev: EntityRowMap[E] | null): Promise<EntityRowMap[E]> {
    const saved = { ...row, rev: prev ? prev.rev : 0 } as EntityRowMap[E];
    await writeLocalRow(this.q, entity, saved, "pending");
    await enqueue(this.q, entity, saved, this.now());
    return saved;
  }
}

export async function writeLocalRow(
  q: Q,
  entity: Entity,
  row: Record<string, unknown> | EntityRowMap[Entity],
  syncState: "pending" | "synced" | "conflict" | "error",
  baseJson?: string | null,
): Promise<void> {
  const cols = entityCols(entity);
  const r = row as Record<string, unknown>;
  const values = cols.map((c) => r[c]);
  const setBase = baseJson !== undefined;
  const allCols = [...cols, "sync_state", ...(setBase ? ["base_json"] : [])];
  const allVals = [...values, syncState, ...(setBase ? [baseJson] : [])];
  await q.run(
    `INSERT INTO ${entity} (${allCols.map((c) => `"${c}"`).join(", ")}) VALUES (${allCols.map(() => "?").join(", ")})
     ON CONFLICT(id) DO UPDATE SET ${allCols
       .filter((c) => c !== "id")
       .map((c) => `"${c}" = excluded."${c}"`)
       .join(", ")}`,
    allVals,
  );
}

/** Append an outbox operation carrying a snapshot of the row. Ops are pushed strictly in order. */
export async function enqueue(q: Q, entity: Entity, row: EntityRowMap[Entity], nowIso: string): Promise<string> {
  const opId = newId();
  await q.run(
    `INSERT INTO outbox (op_id, entity, entity_id, payload, base_rev, attempts, status, created_at)
     VALUES (?, ?, ?, ?, NULL, 0, 'pending', ?)`,
    [opId, entity, row.id, JSON.stringify(row), nowIso],
  );
  return opId;
}
