import {
  checkInvariants,
  ConflictError,
  ENTITIES,
  firstIssue,
  MAX_PULL_LIMIT,
  newId,
  RuleError,
  syncOpSchema,
  validateRow,
  type AnyRow,
  type Entity,
  type OpResult,
  type PullChange,
  type PullResponse,
} from "@codex/shared";
import type { Db } from "./db";
import { PgEntityStore, selectList } from "./store";

export interface SyncContext {
  deviceId: string | null;
  actor: string;
  now: () => Date;
  /** If set, account image URLs must point at this ImageKit endpoint. */
  imageUrlPrefix?: string;
}

const WRITE_LOCK = 724002;

function stripMeta(row: Record<string, unknown>): Record<string, unknown> {
  const { change_seq: _c, ...rest } = row;
  return rest;
}

async function recordConflict(
  db: Db,
  ctx: SyncContext,
  op: { op_id: string; entity: Entity; id: string },
  clientRow: unknown,
  serverRev: number | null,
  reason: string,
) {
  await db.query(
    `INSERT INTO conflicts (id, entity, entity_id, op_id, device_id, client_row, server_rev, reason, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [newId(), op.entity, op.id, op.op_id, ctx.deviceId, JSON.stringify(clientRow), serverRev, reason, ctx.now().toISOString()],
  );
}

/**
 * Apply ONE pushed operation. Idempotent: the result is stored under op_id and a retry
 * returns the stored result without applying anything twice.
 */
export async function applyOp(db: Db, rawOp: unknown, ctx: SyncContext): Promise<OpResult> {
  const parsed = syncOpSchema.safeParse(rawOp);
  if (!parsed.success) {
    const opId = (rawOp as { op_id?: unknown })?.op_id;
    return { op_id: typeof opId === "string" ? opId : "invalid", status: "rejected", code: "invalid_op", message: firstIssue(parsed.error) };
  }
  const op = parsed.data;
  try {
    return await db.tx(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
      const done = await tx.query<{ result: OpResult }>("SELECT result FROM sync_ops WHERE op_id = $1", [op.op_id]);
      if (done.rows[0]) return done.rows[0].result;

      const store = new PgEntityStore(tx, ctx.actor, ctx.now);
      const prev = await store.get(op.entity, op.id);
      let result: OpResult;

      if (prev && prev.rev !== op.base_rev) {
        await recordConflict(tx, ctx, op, op.row, prev.rev, "stale_revision");
        result = { op_id: op.op_id, status: "conflict", server_row: prev, message: "Changed on another device" };
      } else {
        let row: AnyRow;
        try {
          // Fields the client did not send (an older app version that does not know them yet, e.g. the
          // exchange-rate snapshots) keep their stored value instead of being cleared.
          row = validateRow(op.entity, { ...(prev ?? {}), ...op.row, id: op.id, rev: prev?.rev ?? 0 });
          if (
            op.entity === "accounts" &&
            ctx.imageUrlPrefix &&
            (row as { image_url: string | null }).image_url &&
            !(row as { image_url: string }).image_url.startsWith(ctx.imageUrlPrefix)
          )
            throw new RuleError("image_host", "Images must be hosted on the configured ImageKit endpoint");
          if (prev) row = { ...row, created_at: prev.created_at };
          await checkInvariants(store, op.entity, row, prev);
          const saved = await store.put(op.entity, row, prev);
          result = { op_id: op.op_id, status: "applied", rev: saved.rev, row: saved };
          // A newer accepted version of this record settles any earlier open conflict for it
          // (e.g. the device merged or the owner chose a version on the desktop).
          await tx.query(
            "UPDATE conflicts SET status = 'resolved', resolution = 'superseded', resolved_at = $2 WHERE entity_id = $1 AND status = 'open' AND reason = 'stale_revision'",
            [op.id, ctx.now().toISOString()],
          );
        } catch (e) {
          if (e instanceof ConflictError) throw e;
          const code = e instanceof RuleError ? e.code : "validation";
          if (code === "duplicate_sale") await recordConflict(tx, ctx, op, op.row, prev?.rev ?? null, code);
          result = { op_id: op.op_id, status: "rejected", code, message: firstIssue(e) };
        }
      }
      await tx.query("INSERT INTO sync_ops (op_id, device_id, entity, entity_id, result) VALUES ($1,$2,$3,$4,$5)", [
        op.op_id, ctx.deviceId, op.entity, op.id, JSON.stringify(result),
      ]);
      return result;
    });
  } catch (e) {
    // Database constraint backstops (unique / foreign key / check) -> permanent rejection, stored idempotently.
    const code = (e as { code?: string }).code;
    if (code === "23505" || code === "23503" || code === "23514") {
      const result: OpResult = {
        op_id: op.op_id,
        status: "rejected",
        code: code === "23505" ? "constraint_unique" : code === "23503" ? "parent_missing" : "constraint_check",
        message: "The change violates a data rule on the server",
      };
      await db.query(
        "INSERT INTO sync_ops (op_id, device_id, entity, entity_id, result) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (op_id) DO NOTHING",
        [op.op_id, ctx.deviceId, op.entity, op.id, JSON.stringify(result)],
      );
      return result;
    }
    throw e;
  }
}

export async function pushOps(db: Db, ops: unknown[], ctx: SyncContext): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (const op of ops) results.push(await applyOp(db, op, ctx));
  return results;
}

export async function pullChanges(db: Db, since: number, limit: number): Promise<PullResponse> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || 1), MAX_PULL_LIMIT);
  const all: PullChange[] = [];
  let truncated = false;
  for (const entity of ENTITIES) {
    const r = await db.query<Record<string, unknown>>(
      `SELECT ${selectList(entity)}, change_seq FROM ${entity} WHERE change_seq > $1 ORDER BY change_seq LIMIT $2`,
      [since, lim + 1],
    );
    if (r.rows.length > lim) truncated = true;
    for (const row of r.rows) all.push({ entity, seq: Number(row.change_seq), row: stripMeta(row) as unknown as AnyRow });
  }
  all.sort((a, b) => a.seq - b.seq);
  const changes = all.slice(0, lim);
  return {
    changes,
    cursor: changes.length ? changes[changes.length - 1].seq : since,
    has_more: truncated || all.length > lim,
  };
}
