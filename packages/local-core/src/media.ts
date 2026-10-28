import { ApiClient, ApiError, uploadToImageKit } from "@codex/api-client";
import { IMAGE_EXT, MAX_IMAGE_BYTES, newId, RuleError, sniffImageType, type CommandName } from "@codex/shared";
import type { LocalDb, Q } from "./db";
import { backoffMs } from "./sync";

/** Where queued/cached image files live (desktop: app-data folder via Rust; tests: memory). */
export interface FileStore {
  write(name: string, bytes: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array>;
  remove(name: string): Promise<void>;
  exists(name: string): Promise<boolean>;
}

export interface MediaItem {
  id: string;
  account_id: string;
  file_name: string;
  mime: string;
  size: number;
  status: "queued" | "uploading" | "uploaded" | "failed" | "superseded";
  attempts: number;
  last_error: string | null;
  remote_url: string | null;
  remote_file_id: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

type RunCmd = (q: Q, name: CommandName, args: unknown) => Promise<unknown>;

export class MediaQueue {
  constructor(
    private db: LocalDb,
    private files: FileStore,
    private runCmd: RunCmd,
    private opts: { now?: () => Date; fetchImpl?: typeof fetch } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** Validate and store an image locally, then queue it for upload. Works offline. */
  async enqueue(accountId: string, bytes: Uint8Array): Promise<MediaItem> {
    if (!bytes.length) throw new RuleError("image_empty", "The selected file is empty");
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new RuleError("image_too_large", `Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
    const mime = sniffImageType(bytes);
    if (!mime) throw new RuleError("image_type", "Only JPEG, PNG or WebP images are supported");
    const id = newId();
    const file_name = `${id}.${IMAGE_EXT[mime]}`;
    await this.files.write(file_name, bytes); // file first: a DB row never points at a missing file
    const t = this.now().toISOString();
    try {
      await this.db.tx(async (q) => {
        const acct = await q.one("SELECT id FROM accounts WHERE id = ? AND deleted = 0", [accountId]);
        if (!acct) throw new RuleError("not_found", "Account not found");
        await q.run(`UPDATE media_queue SET status = 'superseded', updated_at = ? WHERE account_id = ? AND status IN ('queued','failed','uploading')`, [t, accountId]);
        await q.run(
          `INSERT INTO media_queue (id, account_id, file_name, mime, size, status, attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
          [id, accountId, file_name, mime, bytes.length, t, t],
        );
      });
    } catch (e) {
      await this.files.remove(file_name).catch(() => undefined);
      throw e;
    }
    return (await this.get(id))!;
  }

  async get(id: string): Promise<MediaItem | null> {
    return this.db.one<MediaItem>("SELECT * FROM media_queue WHERE id = ?", [id]);
  }

  async list(): Promise<MediaItem[]> {
    return this.db.all<MediaItem>("SELECT * FROM media_queue ORDER BY created_at DESC LIMIT 200");
  }

  /** Newest usable local copy for an account (pending upload or cached after upload). */
  async localFor(accountId: string): Promise<MediaItem | null> {
    return this.db.one<MediaItem>(
      `SELECT * FROM media_queue WHERE account_id = ? AND status != 'superseded' ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
  }

  async readLocal(item: MediaItem): Promise<Uint8Array | null> {
    return (await this.files.exists(item.file_name)) ? this.files.read(item.file_name) : null;
  }

  /** Remove the account image. The remote file is deleted later, after the change has synced. */
  async removeImage(accountId: string): Promise<void> {
    const t = this.now().toISOString();
    await this.db.tx(async (q) => {
      await q.run(`UPDATE media_queue SET status = 'superseded', updated_at = ? WHERE account_id = ? AND status != 'superseded'`, [t, accountId]);
      const a = await q.one<{ image_file_id: string | null }>("SELECT image_file_id FROM accounts WHERE id = ?", [accountId]);
      if (a?.image_file_id) await q.run(`INSERT OR IGNORE INTO media_deletes (file_id, created_at) VALUES (?, ?)`, [a.image_file_id, t]);
      await this.runCmd(q, "setAccountImage", { id: accountId, image_url: null, image_file_id: null });
    });
  }

  async retry(id: string) {
    await this.db.run(`UPDATE media_queue SET status = 'queued', next_attempt_at = NULL WHERE id = ? AND status IN ('failed','queued')`, [id]);
  }

  /** After a crash/close mid-upload, re-queue interrupted uploads (re-upload overwrites the same file name). */
  async recover() {
    await this.db.run(`UPDATE media_queue SET status = 'queued', next_attempt_at = NULL WHERE status = 'uploading'`);
  }

  async processUploads(api: ApiClient): Promise<{ uploaded: number; failed: number }> {
    const nowIso = this.now().toISOString();
    const items = await this.db.all<MediaItem>(
      `SELECT * FROM media_queue WHERE status IN ('queued','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at`,
      [nowIso],
    );
    let uploaded = 0;
    let failed = 0;
    for (const item of items) {
      await this.db.run(`UPDATE media_queue SET status = 'uploading', updated_at = ? WHERE id = ?`, [nowIso, item.id]);
      try {
        const bytes = await this.readLocal(item);
        if (!bytes) {
          await this.db.run(`UPDATE media_queue SET status = 'failed', last_error = ?, next_attempt_at = ? WHERE id = ?`, [
            "Local image file is missing; choose the image again",
            "9999-12-31T00:00:00.000Z",
            item.id,
          ]);
          failed++;
          continue;
        }
        const auth = await api.imagekitAuth();
        const res = await uploadToImageKit(auth, { bytes, fileName: item.file_name, mime: item.mime }, this.opts.fetchImpl);
        if (!res.url.startsWith(auth.url_endpoint)) throw new ApiError(502, "imagekit_url", "ImageKit returned an unexpected URL");
        const t = this.now().toISOString();
        await this.db.tx(async (q) => {
          const cur = await q.one<{ status: string }>("SELECT status FROM media_queue WHERE id = ?", [item.id]);
          if (cur?.status !== "uploading") {
            // Replaced/removed while uploading: the uploaded file is not wanted.
            await q.run(`INSERT OR IGNORE INTO media_deletes (file_id, created_at) VALUES (?, ?)`, [res.fileId, t]);
            return;
          }
          const a = await q.one<{ image_file_id: string | null; deleted: number }>("SELECT image_file_id, deleted FROM accounts WHERE id = ?", [item.account_id]);
          if (!a || a.deleted) {
            await q.run(`INSERT OR IGNORE INTO media_deletes (file_id, created_at) VALUES (?, ?)`, [res.fileId, t]);
            await q.run(`UPDATE media_queue SET status = 'superseded', updated_at = ? WHERE id = ?`, [t, item.id]);
            return;
          }
          await this.runCmd(q, "setAccountImage", { id: item.account_id, image_url: res.url, image_file_id: res.fileId });
          if (a.image_file_id && a.image_file_id !== res.fileId)
            await q.run(`INSERT OR IGNORE INTO media_deletes (file_id, created_at) VALUES (?, ?)`, [a.image_file_id, t]);
          await q.run(
            `UPDATE media_queue SET status = 'uploaded', remote_url = ?, remote_file_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
            [res.url, res.fileId, t, item.id],
          );
          // Older cached copies for this account are no longer needed.
          await q.run(`UPDATE media_queue SET status = 'superseded', updated_at = ? WHERE account_id = ? AND id != ? AND status = 'uploaded'`, [t, item.account_id, item.id]);
        });
        uploaded++;
      } catch (e) {
        const attempts = item.attempts + 1;
        const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? "Upload failed";
        // The local file is kept: a failed upload never removes the only copy.
        await this.db.run(
          `UPDATE media_queue SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'uploading'`,
          [attempts, msg.slice(0, 300), new Date(this.now().getTime() + backoffMs(attempts)).toISOString(), this.now().toISOString(), item.id],
        );
        failed++;
        if (e instanceof ApiError && (e.status === 0 || e.status === 401)) break; // offline / signed out: stop for now
      }
    }
    await this.cleanupFiles();
    return { uploaded, failed };
  }

  /** Delete remote files that are no longer referenced (runs after local changes were pushed). */
  async processDeletes(api: ApiClient): Promise<void> {
    const rows = await this.db.all<{ file_id: string; attempts: number }>("SELECT file_id, attempts FROM media_deletes LIMIT 50");
    for (const r of rows) {
      try {
        await api.deleteMedia(r.file_id);
        await this.db.run("DELETE FROM media_deletes WHERE file_id = ?", [r.file_id]);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return;
        await this.db.run("UPDATE media_deletes SET attempts = attempts + 1, last_error = ? WHERE file_id = ?", [
          (e as Error).message.slice(0, 200),
          r.file_id,
        ]);
      }
    }
  }

  /** Remove local files of superseded items. Uploaded files are kept as an offline cache. */
  private async cleanupFiles() {
    const rows = await this.db.all<{ id: string; file_name: string }>(
      "SELECT id, file_name FROM media_queue WHERE status = 'superseded'",
    );
    for (const r of rows) {
      await this.files.remove(r.file_name).catch(() => undefined);
      await this.db.run("DELETE FROM media_queue WHERE id = ? AND status = 'superseded'", [r.id]);
    }
  }
}
