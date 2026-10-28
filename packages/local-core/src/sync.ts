import { ApiClient, ApiError } from "@codex/api-client";
import { isEntity, newId, threeWayMerge, type AnyRow, type Entity, type OpResult, type SyncOp } from "@codex/shared";
import { fromLocal, kvGet, kvSet, type LocalDb, type Q } from "./db";
import { enqueue, writeLocalRow } from "./store";

export interface VaultState {
  envelope: string;
  vault_id: string;
  /** Last cloud version this device knows (0 = never uploaded). */
  version: number;
  /** Local change (new passphrase / recovery key) not yet uploaded. */
  dirty: boolean;
}

export interface SyncStatus {
  phase: "unpaired" | "offline" | "idle" | "syncing" | "error" | "auth";
  pending: number;
  failed: number;
  rejected: number;
  conflicts: number;
  queuedImages: number;
  failedImages: number;
  lastSyncAt: string | null;
  lastError: string | null;
  vaultMismatch: boolean;
  notice: string | null;
}

export interface SyncReport {
  pushed: number;
  applied: number;
  conflicts: number;
  rejected: number;
  pulled: number;
  error: string | null;
}

const BATCH = 100;

export function backoffMs(attempts: number): number {
  const base = Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return base + Math.floor(Math.random() * 1000);
}

/** Error text stored for display. Never includes request bodies (which may contain ciphertext). */
function safeError(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.status ? ` (HTTP ${e.status})` : ""}`;
  return e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
}

interface OutboxRow {
  seq: number;
  op_id: string;
  entity: string;
  entity_id: string;
  payload: string;
  base_rev: number | null;
  attempts: number;
  status: string;
  next_attempt_at: string | null;
}

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  lastError: string | null = null;
  lastSyncAt: string | null = null;
  phase: SyncStatus["phase"] = "idle";
  vaultMismatch = false;
  notice: string | null = null;

  constructor(
    private db: LocalDb,
    private getApi: () => ApiClient | null,
    private hooks: {
      now?: () => Date;
      beforePush?: (api: ApiClient) => Promise<void>;
      afterPull?: (api: ApiClient) => Promise<void>;
      onChange?: () => void;
    } = {},
  ) {}

  private now() {
    return this.hooks.now?.() ?? new Date();
  }

  /** Run one full cycle (images -> push -> pull -> vault). Concurrent calls share the same run. */
  syncOnce(opts: { force?: boolean } = {}): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.cycle(opts.force ?? false).finally(() => {
      this.running = null;
      this.hooks.onChange?.();
    });
    return this.running;
  }

  get isRunning() {
    return this.running !== null;
  }

  private async cycle(force: boolean): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, applied: 0, conflicts: 0, rejected: 0, pulled: 0, error: null };
    const api = this.getApi();
    if (!api) {
      this.phase = "unpaired";
      return report;
    }
    this.phase = "syncing";
    this.hooks.onChange?.();
    try {
      await this.hooks.beforePush?.(api);
      await this.push(api, force, report);
      await this.pull(api, report);
      await this.syncVault(api);
      await this.hooks.afterPull?.(api);
      this.lastSyncAt = this.now().toISOString();
      this.lastError = null;
      this.phase = "idle";
    } catch (e) {
      report.error = safeError(e);
      this.lastError = report.error;
      this.phase = e instanceof ApiError && e.status === 401 ? "auth" : e instanceof ApiError && e.status === 0 ? "offline" : "error";
    }
    return report;
  }

  /* ---------------------------- push ------------------------------- */

  private async nextBatch(force: boolean): Promise<OutboxRow[]> {
    return this.db.tx(async (q) => {
      const rows = await q.all<OutboxRow>(
        `SELECT * FROM outbox WHERE status IN ('pending','failed') ORDER BY seq LIMIT ${BATCH}`,
      );
      if (!rows.length) return [];
      const due = force || !rows[0].next_attempt_at || rows[0].next_attempt_at <= this.now().toISOString();
      if (!due) return [];
      // Assign base revisions once, BEFORE sending, and persist them so retries are identical.
      for (const op of rows) {
        if (op.base_rev !== null) continue;
        const prev = await q.one<{ base_rev: number | null }>(
          `SELECT base_rev FROM outbox WHERE entity_id = ? AND seq < ? AND status != 'rejected' ORDER BY seq DESC LIMIT 1`,
          [op.entity_id, op.seq],
        );
        let base: number;
        if (prev && prev.base_rev !== null) base = prev.base_rev + 1;
        else {
          if (!isEntity(op.entity)) throw new Error("Corrupt outbox entry");
          const row = await q.one<{ rev: number }>(`SELECT rev FROM ${op.entity} WHERE id = ?`, [op.entity_id]);
          base = row?.rev ?? 0;
        }
        await q.run(`UPDATE outbox SET base_rev = ? WHERE seq = ?`, [base, op.seq]);
        op.base_rev = base;
      }
      return rows;
    });
  }

  private async push(api: ApiClient, force: boolean, report: SyncReport) {
    for (let guard = 0; guard < 1000; guard++) {
      const batch = await this.nextBatch(force);
      if (!batch.length) return;
      const ops: SyncOp[] = batch.map((o) => ({
        op_id: o.op_id,
        entity: o.entity as Entity,
        id: o.entity_id,
        base_rev: o.base_rev ?? 0,
        row: JSON.parse(o.payload) as AnyRow,
      }));
      let results: OpResult[];
      try {
        results = (await api.push(ops)).results;
      } catch (e) {
        const msg = safeError(e);
        await this.db.tx(async (q) => {
          for (const o of batch) {
            const attempts = o.attempts + 1;
            await q.run(
              `UPDATE outbox SET attempts = ?, status = 'failed', last_error = ?, next_attempt_at = ? WHERE seq = ?`,
              [attempts, msg, new Date(this.now().getTime() + backoffMs(attempts)).toISOString(), o.seq],
            );
          }
        });
        throw e;
      }
      report.pushed += ops.length;
      await this.db.tx(async (q) => {
        for (const r of results) await this.applyResult(q, r, report);
      });
      force = true; // continue draining immediately after a successful batch
    }
  }

  private async applyResult(q: Q, r: OpResult, report: SyncReport) {
    const op = await q.one<OutboxRow>(`SELECT * FROM outbox WHERE op_id = ?`, [r.op_id]);
    if (!op || !isEntity(op.entity)) return; // superseded by an earlier conflict in this batch
    const entity = op.entity;
    if (r.status === "applied") {
      report.applied++;
      await q.run(`UPDATE ${entity} SET rev = ?, base_json = ? WHERE id = ?`, [r.rev, JSON.stringify(r.row), op.entity_id]);
      await q.run(`DELETE FROM outbox WHERE seq = ?`, [op.seq]);
      const left = await q.one<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE entity_id = ?`, [op.entity_id]);
      if (!left?.n) await q.run(`UPDATE ${entity} SET sync_state = 'synced' WHERE id = ? AND sync_state = 'pending'`, [op.entity_id]);
      return;
    }
    if (r.status === "rejected") {
      report.rejected++;
      await q.run(`UPDATE outbox SET status = 'rejected', attempts = attempts + 1, last_error = ? WHERE seq = ?`, [
        `${r.message} [${r.code}]`,
        op.seq,
      ]);
      await q.run(`UPDATE ${entity} SET sync_state = 'error' WHERE id = ?`, [op.entity_id]);
      return;
    }
    // Conflict: someone else changed this record first.
    report.conflicts++;
    const server = r.server_row;
    const localRaw = await q.one<Record<string, unknown>>(`SELECT * FROM ${entity} WHERE id = ?`, [op.entity_id]);
    await q.run(`DELETE FROM outbox WHERE entity_id = ?`, [op.entity_id]);
    if (!localRaw) {
      await writeLocalRow(q, entity, server, "synced", JSON.stringify(server));
      return;
    }
    const local = fromLocal(entity, localRaw);
    const base = localRaw.base_json ? (JSON.parse(String(localRaw.base_json)) as AnyRow) : null;
    const { merged, conflictingFields } = threeWayMerge(base, local, server);
    if (conflictingFields.length === 0) {
      const changed = JSON.stringify({ ...merged, updated_at: null }) !== JSON.stringify({ ...server, updated_at: null });
      await writeLocalRow(q, entity, merged, changed ? "pending" : "synced", JSON.stringify(server));
      if (changed) await enqueue(q, entity, merged, this.now().toISOString());
      return;
    }
    await writeLocalRow(q, entity, { ...local, rev: server.rev }, "conflict", JSON.stringify(server));
    await q.run(`UPDATE conflicts SET status = 'resolved', resolution = 'superseded', resolved_at = ? WHERE entity_id = ? AND status = 'open'`, [
      this.now().toISOString(),
      op.entity_id,
    ]);
    await q.run(
      `INSERT INTO conflicts (id, entity, entity_id, local_json, server_json, fields, status, created_at) VALUES (?,?,?,?,?,?, 'open', ?)`,
      [newId(), entity, op.entity_id, JSON.stringify(local), JSON.stringify(server), JSON.stringify(conflictingFields), this.now().toISOString()],
    );
  }

  /* ---------------------------- pull ------------------------------- */

  private async pull(api: ApiClient, report: SyncReport) {
    for (let guard = 0; guard < 10_000; guard++) {
      const cursor = (await kvGet<number>(this.db, "sync_cursor")) ?? 0;
      const page = await api.pull(cursor, 500);
      await this.db.tx(async (q) => {
        for (const ch of page.changes) {
          if (!isEntity(ch.entity)) continue;
          const busy = await q.one(`SELECT 1 AS x FROM outbox WHERE entity_id = ? LIMIT 1`, [ch.row.id]);
          const local = await q.one<{ sync_state: string }>(`SELECT sync_state FROM ${ch.entity} WHERE id = ?`, [ch.row.id]);
          // Local unsynced edits or an open conflict are never overwritten by a pull.
          if (local?.sync_state === "conflict") {
            // Keep the conflict's "cloud version" current (it may have been changed or resolved on the
            // website meanwhile), so "keep cloud version" never restores an outdated snapshot.
            await q.run(`UPDATE conflicts SET server_json = ? WHERE entity_id = ? AND status = 'open'`, [JSON.stringify(ch.row), ch.row.id]);
            await q.run(`UPDATE ${ch.entity} SET base_json = ? WHERE id = ?`, [JSON.stringify(ch.row), ch.row.id]);
            continue;
          }
          if (busy) continue;
          await writeLocalRow(q, ch.entity, ch.row, "synced", JSON.stringify(ch.row));
          report.pulled++;
        }
        await kvSet(q, "sync_cursor", page.cursor);
      });
      if (!page.has_more) return;
    }
  }

  /* ---------------------------- vault ------------------------------ */

  private async syncVault(api: ApiClient) {
    const local = await kvGet<VaultState>(this.db, "vault");
    const cloud = await api.getVault();
    if (!local) return;
    if (!cloud) {
      const rec = await api.putVault(local.envelope, 0);
      await kvSet(this.db, "vault", { ...local, version: rec.version, dirty: false });
      return;
    }
    if (cloud.vault_id !== local.vault_id) {
      this.vaultMismatch = true;
      return;
    }
    this.vaultMismatch = false;
    if (local.dirty) {
      try {
        const rec = await api.putVault(local.envelope, local.version);
        await kvSet(this.db, "vault", { ...local, version: rec.version, dirty: false });
      } catch (e) {
        if (e instanceof ApiError && e.code === "vault_stale") {
          await kvSet(this.db, "vault", { envelope: cloud.envelope, vault_id: cloud.vault_id, version: cloud.version, dirty: false });
          this.notice = "The vault passphrase was changed on another device at the same time. That newer change was kept; use the passphrase set there.";
        } else throw e;
      }
      return;
    }
    if (cloud.version > local.version)
      await kvSet(this.db, "vault", { envelope: cloud.envelope, vault_id: cloud.vault_id, version: cloud.version, dirty: false });
  }

  /* --------------------------- status ------------------------------ */

  async status(paired: boolean): Promise<SyncStatus> {
    const c = await this.db.one<{ pending: number; failed: number; rejected: number }>(
      `SELECT sum(status = 'pending') AS pending, sum(status = 'failed') AS failed, sum(status = 'rejected') AS rejected FROM outbox`,
    );
    const conf = await this.db.one<{ n: number }>(`SELECT count(*) AS n FROM conflicts WHERE status = 'open'`);
    const img = await this.db.one<{ q: number; f: number }>(
      `SELECT sum(status IN ('queued','uploading')) AS q, sum(status = 'failed') AS f FROM media_queue`,
    );
    return {
      phase: paired ? this.phase : "unpaired",
      pending: Number(c?.pending ?? 0),
      failed: Number(c?.failed ?? 0),
      rejected: Number(c?.rejected ?? 0),
      conflicts: Number(conf?.n ?? 0),
      queuedImages: Number(img?.q ?? 0),
      failedImages: Number(img?.f ?? 0),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      vaultMismatch: this.vaultMismatch,
      notice: this.notice,
    };
  }
}
