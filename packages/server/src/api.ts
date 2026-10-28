import {
  computeReport,
  ConflictError,
  firstIssue,
  isCommandName,
  isEntity,
  isUuid,
  loadAccountBundle,
  MAX_PULL_LIMIT,
  newId,
  pushRequestSchema,
  RuleError,
  runCommand,
  SETTING_IDS,
  toPublicListing,
  type DeviceInfo,
  type PublicListing,
  type PublicSettings,
  type SessionInfo,
  type VaultRecord,
} from "@codex/shared";
import { z } from "zod";
import {
  authenticate,
  clearFailures,
  createSession,
  getDummyHash,
  hashPassword,
  isThrottled,
  passwordProblem,
  recordFailure,
  verifyPassword,
  type AuthContext,
} from "./auth";
import type { Db } from "./db";
import { imagekitAuthParams, imagekitDeleteFile, type ImageKitConfig } from "./imagekit";
import { PgEntityStore, selectList } from "./store";
import { applyOp, pullChanges, pushOps } from "./sync";

export interface ApiConfig {
  db: Db;
  /** One-time secret required to create the owner account on a fresh deployment. */
  setupToken?: string;
  imagekit?: ImageKitConfig;
  /** Origins allowed to call the private API cross-origin with a Bearer token (desktop WebView). */
  corsOrigins: string[];
  /** Origins of the admin website (cookie sessions; CSRF origin check). */
  adminOrigins: string[];
  cookieSecure: boolean;
  webSessionHours?: number;
  deviceSessionDays?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Password hashing parameters (tests use cheaper ones). */
  passwordParams?: { logN: number; r: number; p: number; keyLen: number };
  log?: (msg: string) => void;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const PREFIX = "/api/v1";
const MAX_BODY = 4 * 1024 * 1024;
export const COOKIE_SECURE = "__Host-cx_admin";
export const COOKIE_DEV = "cx_admin";

type Handler = (c: Ctx) => Promise<Response>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: "public" | "owner";
  handler: Handler;
}

interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  auth: AuthContext | null;
  cfg: ApiConfig;
  now: Date;
  body: () => Promise<unknown>;
  cors: Record<string, string>;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/:([a-zA-Z_]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${src}$`), keys };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function cookieName(cfg: ApiConfig) {
  return cfg.cookieSecure ? COOKIE_SECURE : COOKIE_DEV;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
  client: z.enum(["web", "desktop"]),
  device: z
    .object({ id: z.string().optional(), name: z.string().min(1).max(100), platform: z.string().max(50) })
    .optional(),
});

const setupSchema = z.object({
  setup_token: z.string().min(1).max(500),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Username may contain letters, numbers, dot, dash and underscore"),
  password: z.string().max(200),
  client: z.enum(["web", "desktop"]),
  device: z.object({ id: z.string().optional(), name: z.string().min(1).max(100), platform: z.string().max(50) }).optional(),
});

function constantEq(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

/* ------------------------------------------------------------------ */
/* Route table                                                         */
/* ------------------------------------------------------------------ */

const routes: Route[] = [];
function route(method: string, path: string, auth: Route["auth"], handler: Handler) {
  routes.push({ method, ...compile(path), auth, handler });
}

route("GET", "/health", "public", async (c) => {
  let db = false;
  try {
    await c.cfg.db.query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  return json({ ok: db, service: "codex-stocks-api", version: 1, time: c.now.toISOString() }, db ? 200 : 503, c.cors);
});

route("GET", "/auth/status", "public", async (c) => {
  const r = await c.cfg.db.query("SELECT 1 FROM owner");
  return json({ owner_exists: r.rowCount > 0, setup_enabled: !!c.cfg.setupToken }, 200, c.cors);
});

async function issueLogin(c: Ctx, client: "web" | "desktop", device?: { id?: string; name: string; platform: string }) {
  const { db } = c.cfg;
  if (client === "web") {
    const hours = c.cfg.webSessionHours ?? 12;
    const s = await createSession(db, "web", null, hours * 3600_000, c.now);
    const cookie = `${cookieName(c.cfg)}=${s.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${hours * 3600}${c.cfg.cookieSecure ? "; Secure" : ""}`;
    return json({ ok: true, expires_at: s.expiresAt.toISOString() }, 200, { "Set-Cookie": cookie, ...c.cors });
  }
  if (!device) throw new HttpError(400, "device_required", "Device name is required for desktop login");
  let deviceId = device.id && isUuid(device.id) ? device.id : null;
  if (deviceId) {
    const d = await db.query<{ revoked_at: string | null }>("SELECT revoked_at FROM devices WHERE id = $1", [deviceId]);
    if (d.rows[0]?.revoked_at) deviceId = null; // revoked devices must enrol again with a new id
    else if (!d.rows[0])
      await db.query("INSERT INTO devices (id, name, platform, created_at) VALUES ($1,$2,$3,$4)", [
        deviceId, device.name, device.platform, c.now.toISOString(),
      ]);
    else await db.query("UPDATE devices SET name = $1 WHERE id = $2", [device.name, deviceId]);
  }
  if (!deviceId) {
    deviceId = newId(c.now.getTime());
    await db.query("INSERT INTO devices (id, name, platform, created_at) VALUES ($1,$2,$3,$4)", [
      deviceId, device.name, device.platform, c.now.toISOString(),
    ]);
  }
  await db.query("UPDATE sessions SET revoked_at = $1 WHERE device_id = $2 AND revoked_at IS NULL", [c.now.toISOString(), deviceId]);
  const days = c.cfg.deviceSessionDays ?? 180;
  const s = await createSession(db, "device", deviceId, days * 86400_000, c.now);
  return json({ token: s.token, device_id: deviceId, expires_at: s.expiresAt.toISOString() }, 200, c.cors);
}

route("POST", "/auth/setup", "public", async (c) => {
  const body = setupSchema.parse(await c.body());
  if (!c.cfg.setupToken || c.cfg.setupToken.length < 16)
    throw new HttpError(403, "setup_disabled", "Cloud setup is disabled on this server (SETUP_TOKEN not configured)");
  if (!constantEq(body.setup_token, c.cfg.setupToken)) throw new HttpError(403, "setup_token", "Invalid setup code");
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(422, "weak_password", problem);
  const hash = await hashPassword(body.password, c.cfg.passwordParams);
  const created = await c.cfg.db.tx(async (tx) => {
    const r = await tx.query(
      "INSERT INTO owner (id, username, password_hash, created_at) VALUES (1,$1,$2,$3) ON CONFLICT (id) DO NOTHING",
      [body.username.toLowerCase(), hash, c.now.toISOString()],
    );
    return r.rowCount > 0;
  });
  // Never create a second owner or silently replace the existing one.
  if (!created) throw new HttpError(409, "owner_exists", "The cloud owner account already exists. Sign in instead.");
  return issueLogin(c, body.client, body.device);
});

route("POST", "/auth/login", "public", async (c) => {
  const body = loginSchema.parse(await c.body());
  const { db } = c.cfg;
  const keys = [`ip:${clientIp(c.req)}`, `user:${body.username.toLowerCase()}`];
  if (await isThrottled(db, keys, c.now))
    throw new HttpError(429, "throttled", "Too many failed attempts. Wait 15 minutes and try again.");
  const r = await db.query<{ username: string; password_hash: string }>("SELECT username, password_hash FROM owner");
  const owner = r.rows[0];
  const ok =
    owner && owner.username === body.username.toLowerCase()
      ? await verifyPassword(body.password, owner.password_hash)
      : (await verifyPassword(body.password, await getDummyHash(c.cfg.passwordParams)), false);
  if (!ok) {
    await recordFailure(db, keys, c.now);
    throw new HttpError(401, "bad_credentials", owner ? "Incorrect username or password" : "No cloud owner account exists yet");
  }
  await clearFailures(db, keys);
  return issueLogin(c, body.client, body.device);
});

route("POST", "/auth/logout", "owner", async (c) => {
  await c.cfg.db.query("UPDATE sessions SET revoked_at = $1 WHERE id = $2", [c.now.toISOString(), c.auth!.sessionId]);
  const clear = `${cookieName(c.cfg)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${c.cfg.cookieSecure ? "; Secure" : ""}`;
  return json({ ok: true }, 200, { "Set-Cookie": clear, ...c.cors });
});

route("GET", "/auth/me", "owner", async (c) => {
  const r = await c.cfg.db.query<{ username: string; created_at: string }>("SELECT username, created_at FROM owner");
  const info: SessionInfo = {
    owner: r.rows[0],
    device: c.auth!.deviceId ? { id: c.auth!.deviceId, name: c.auth!.deviceName ?? "" } : null,
    kind: c.auth!.kind,
  };
  return json(info, 200, c.cors);
});

route("POST", "/auth/change-password", "owner", async (c) => {
  const body = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(await c.body());
  const r = await c.cfg.db.query<{ password_hash: string }>("SELECT password_hash FROM owner");
  if (!r.rows[0] || !(await verifyPassword(body.current, r.rows[0].password_hash)))
    throw new HttpError(401, "bad_credentials", "Current password is incorrect");
  const problem = passwordProblem(body.next);
  if (problem) throw new HttpError(422, "weak_password", problem);
  await c.cfg.db.query("UPDATE owner SET password_hash = $1, password_changed_at = $2", [
    await hashPassword(body.next, c.cfg.passwordParams),
    c.now.toISOString(),
  ]);
  // Sign out other web sessions; enrolled devices keep working (they verify the new password at next online login).
  await c.cfg.db.query("UPDATE sessions SET revoked_at = $1 WHERE kind = 'web' AND id <> $2 AND revoked_at IS NULL", [
    c.now.toISOString(),
    c.auth!.sessionId,
  ]);
  return json({ ok: true }, 200, c.cors);
});

/* ---------------------------- devices ------------------------------ */

route("GET", "/devices", "owner", async (c) => {
  const r = await c.cfg.db.query<Omit<DeviceInfo, "current">>(
    "SELECT id, name, platform, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at",
  );
  return json(r.rows.map((d) => ({ ...d, current: d.id === c.auth!.deviceId })), 200, c.cors);
});

route("POST", "/devices/:id/revoke", "owner", async (c) => {
  if (!isUuid(c.params.id)) throw new HttpError(404, "not_found", "Device not found");
  const t = c.now.toISOString();
  const r = await c.cfg.db.query("UPDATE devices SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", [t, c.params.id]);
  await c.cfg.db.query("UPDATE sessions SET revoked_at = $1 WHERE device_id = $2 AND revoked_at IS NULL", [t, c.params.id]);
  if (!r.rowCount) throw new HttpError(404, "not_found", "Device not found or already revoked");
  return json({ ok: true }, 200, c.cors);
});

/* ----------------------------- vault ------------------------------- */

route("GET", "/vault", "owner", async (c) => {
  const r = await c.cfg.db.query<VaultRecord>("SELECT envelope, vault_id, version, updated_at FROM vault");
  return json(r.rows[0] ?? null, 200, c.cors);
});

route("PUT", "/vault", "owner", async (c) => {
  const body = z.object({ envelope: z.string().min(50).max(10_000), base_version: z.number().int().min(0) }).parse(await c.body());
  let env: { format?: string; v?: number; vault_id?: string; pass_wrap?: string; recovery_wrap?: string };
  try {
    env = JSON.parse(body.envelope);
  } catch {
    throw new HttpError(400, "vault_format", "Invalid vault envelope");
  }
  if (env.format !== "codex-vault" || env.v !== 1 || !isUuid(env.vault_id) || !env.pass_wrap || !env.recovery_wrap)
    throw new HttpError(400, "vault_format", "Invalid vault envelope");
  const rec = await c.cfg.db.tx(async (tx) => {
    const cur = await tx.query<VaultRecord>("SELECT envelope, vault_id, version, updated_at FROM vault FOR UPDATE");
    const existing = cur.rows[0];
    if (!existing) {
      if (body.base_version !== 0) throw new HttpError(409, "vault_stale", "Vault version mismatch");
      const r = await tx.query<VaultRecord>(
        "INSERT INTO vault (id, vault_id, envelope, version, updated_at) VALUES (1,$1,$2,1,$3) RETURNING envelope, vault_id, version, updated_at",
        [env.vault_id, body.envelope, c.now.toISOString()],
      );
      return r.rows[0];
    }
    // The vault key can never be silently replaced: only re-wraps of the SAME vault are accepted.
    if (existing.vault_id !== env.vault_id)
      throw new HttpError(409, "vault_mismatch", "A different vault already exists in the cloud. Unlock it instead of replacing it.");
    if (existing.version !== body.base_version)
      throw new HttpError(409, "vault_stale", "The vault was changed on another device. Reload it first.", { current: existing });
    const r = await tx.query<VaultRecord>(
      "UPDATE vault SET envelope = $1, version = version + 1, updated_at = $2 RETURNING envelope, vault_id, version, updated_at",
      [body.envelope, c.now.toISOString()],
    );
    return r.rows[0];
  });
  return json(rec, 200, c.cors);
});

/* ------------------------------ sync ------------------------------- */

function syncCtx(c: Ctx) {
  return {
    deviceId: c.auth!.deviceId,
    actor: c.auth!.deviceId ? `device:${c.auth!.deviceId}` : "web",
    now: () => c.cfg.now?.() ?? new Date(),
    imageUrlPrefix: c.cfg.imagekit?.urlEndpoint,
  };
}

route("POST", "/sync/push", "owner", async (c) => {
  const body = pushRequestSchema.parse(await c.body());
  const results = await pushOps(c.cfg.db, body.ops, syncCtx(c));
  return json({ results }, 200, c.cors);
});

route("GET", "/sync/pull", "owner", async (c) => {
  const since = Number(c.url.searchParams.get("since") ?? "0");
  const limit = Number(c.url.searchParams.get("limit") ?? String(MAX_PULL_LIMIT));
  if (!Number.isFinite(since) || since < 0) throw new HttpError(400, "bad_cursor", "Invalid cursor");
  return json(await pullChanges(c.cfg.db, Math.floor(since), limit), 200, c.cors);
});

/* ------------------------------ admin ------------------------------ */

route("GET", "/admin/entities/:entity", "owner", async (c) => {
  const entity = c.params.entity;
  if (!isEntity(entity)) throw new HttpError(404, "not_found", "Unknown entity");
  const where: Record<string, string> = {};
  for (const k of ["account_id", "set_id", "sale_id", "status", "entity_id"]) {
    const v = c.url.searchParams.get(k);
    if (v !== null) where[k] = v;
  }
  const store = new PgEntityStore(c.cfg.db, "web");
  try {
    const rows = await store.list(entity, where, {
      includeDeleted: c.url.searchParams.get("include_deleted") === "1",
      limit: Number(c.url.searchParams.get("limit") ?? 0) || undefined,
      orderBy: c.url.searchParams.get("order_by") ?? undefined,
    });
    return json(rows, 200, c.cors);
  } catch (e) {
    if ((e as Error).message === "Unknown filter column") throw new HttpError(400, "bad_filter", "Invalid filter");
    throw e;
  }
});

route("GET", "/admin/entities/:entity/:id", "owner", async (c) => {
  if (!isEntity(c.params.entity) || !isUuid(c.params.id)) throw new HttpError(404, "not_found", "Not found");
  const row = await new PgEntityStore(c.cfg.db, "web").get(c.params.entity, c.params.id);
  if (!row) throw new HttpError(404, "not_found", "Not found");
  return json(row, 200, c.cors);
});

route("GET", "/admin/accounts/:id/bundle", "owner", async (c) => {
  if (!isUuid(c.params.id)) throw new HttpError(404, "not_found", "Account not found");
  const b = await loadAccountBundle(new PgEntityStore(c.cfg.db, "web"), c.params.id);
  if (!b) throw new HttpError(404, "not_found", "Account not found");
  return json(b, 200, c.cors);
});

route("POST", "/admin/commands/:name", "owner", async (c) => {
  const name = c.params.name;
  if (!isCommandName(name)) throw new HttpError(404, "not_found", "Unknown command");
  const args = (await c.body()) as Record<string, unknown>;
  if (name === "setAccountImage" && c.cfg.imagekit && typeof args?.image_url === "string" && !args.image_url.startsWith(c.cfg.imagekit.urlEndpoint))
    throw new HttpError(422, "image_host", "Images must be hosted on the configured ImageKit endpoint");
  const actor = c.auth!.deviceId ? `device:${c.auth!.deviceId}` : "web";
  const result = await c.cfg.db.tx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [724002]);
    return runCommand(new PgEntityStore(tx, actor, () => c.cfg.now?.() ?? new Date()), name, args);
  });
  return json({ ok: true, result: result ?? null }, 200, c.cors);
});

route("GET", "/admin/dashboard", "owner", async (c) => {
  const store = new PgEntityStore(c.cfg.db, "web");
  const [accounts, sales, refunds, expenses] = await Promise.all([
    store.list("accounts"),
    store.list("sales"),
    store.list("refunds"),
    store.list("expenses"),
  ]);
  return json({ report: computeReport({ accounts, sales, refunds, expenses }), sync: await cloudSyncStatus(c.cfg.db) }, 200, c.cors);
});

export interface CloudSyncStatus {
  open_conflicts: number;
  active_devices: number;
  last_device_sync_at: string | null;
}

export async function cloudSyncStatus(db: Db): Promise<CloudSyncStatus> {
  const r = await db.query<{ conflicts: number; devices: number; last: string | null }>(
    `SELECT (SELECT count(*)::int FROM conflicts WHERE status = 'open') AS conflicts,
            (SELECT count(*)::int FROM devices WHERE revoked_at IS NULL) AS devices,
            (SELECT max(last_seen_at) FROM devices WHERE revoked_at IS NULL) AS last`,
  );
  const x = r.rows[0];
  return { open_conflicts: x.conflicts, active_devices: x.devices, last_device_sync_at: x.last };
}

route("GET", "/admin/sync-status", "owner", async (c) => json(await cloudSyncStatus(c.cfg.db), 200, c.cors));

/**
 * Audit history. Without parameters: the newest events overall. With account_id: every event that
 * concerns that account (the account itself plus its links, password, codes, sales, refunds, expenses).
 */
route("GET", "/admin/audit", "owner", async (c) => {
  const accountId = c.url.searchParams.get("account_id") ?? c.url.searchParams.get("entity_id");
  const limit = Math.min(Math.max(Number(c.url.searchParams.get("limit")) || 500, 1), 2000);
  if (accountId && !isUuid(accountId)) throw new HttpError(400, "bad_filter", "Invalid account id");
  const r = await c.cfg.db.query(
    `SELECT ${selectList("audit_events")} FROM audit_events
      WHERE NOT deleted ${accountId ? "AND (entity_id = $1 OR details LIKE '%\"account_id\":\"' || $1::text || '\"%')" : ""}
      ORDER BY at DESC LIMIT ${limit}`,
    accountId ? [accountId] : [],
  );
  return json(r.rows, 200, c.cors);
});

route("GET", "/admin/conflicts", "owner", async (c) => {
  const r = await c.cfg.db.query(
    `SELECT id, entity, entity_id, op_id, device_id, client_row, server_rev, reason, status, resolution, created_at
       FROM conflicts WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
    [c.url.searchParams.get("status") === "resolved" ? "resolved" : "open"],
  );
  const store = new PgEntityStore(c.cfg.db, "web");
  const out = [];
  for (const row of r.rows as { entity: string; entity_id: string }[]) {
    out.push({ ...row, server_row: isEntity(row.entity) ? await store.get(row.entity, row.entity_id) : null });
  }
  return json(out, 200, c.cors);
});

route("POST", "/admin/conflicts/:id/resolve", "owner", async (c) => {
  const body = z.object({ resolution: z.enum(["keep_server", "apply_client"]) }).parse(await c.body());
  if (!isUuid(c.params.id)) throw new HttpError(404, "not_found", "Conflict not found");
  const r = await c.cfg.db.query<{ entity: string; entity_id: string; client_row: Record<string, unknown>; status: string }>(
    "SELECT entity, entity_id, client_row, status FROM conflicts WHERE id = $1",
    [c.params.id],
  );
  const conflict = r.rows[0];
  if (!conflict || conflict.status !== "open") throw new HttpError(404, "not_found", "Conflict not found or already resolved");
  if (body.resolution === "apply_client") {
    if (!isEntity(conflict.entity)) throw new HttpError(400, "bad_entity", "Unknown entity");
    const cur = await new PgEntityStore(c.cfg.db, "web").get(conflict.entity, conflict.entity_id);
    const result = await applyOp(
      c.cfg.db,
      { op_id: newId(), entity: conflict.entity, id: conflict.entity_id, base_rev: cur?.rev ?? 0, row: conflict.client_row },
      syncCtx(c),
    );
    if (result.status !== "applied")
      throw new HttpError(422, "resolve_failed", result.status === "rejected" ? result.message : "Record changed again; retry");
  }
  await c.cfg.db.query("UPDATE conflicts SET status = 'resolved', resolution = $1, resolved_at = $2 WHERE id = $3", [
    body.resolution,
    c.now.toISOString(),
    c.params.id,
  ]);
  return json({ ok: true }, 200, c.cors);
});

/* ------------------------------ media ------------------------------ */

route("POST", "/media/imagekit-auth", "owner", async (c) => {
  if (!c.cfg.imagekit) throw new HttpError(503, "imagekit_unconfigured", "Image uploads are not configured on the server");
  return json(imagekitAuthParams(c.cfg.imagekit, c.now), 200, c.cors);
});

route("DELETE", "/media/files/:fileId", "owner", async (c) => {
  if (!c.cfg.imagekit) throw new HttpError(503, "imagekit_unconfigured", "Image uploads are not configured on the server");
  const inUse = await c.cfg.db.query("SELECT 1 FROM accounts WHERE image_file_id = $1 AND NOT deleted", [c.params.fileId]);
  if (inUse.rowCount) throw new HttpError(409, "image_in_use", "This image is still used by an account");
  const ok = await imagekitDeleteFile(c.cfg.imagekit, c.params.fileId, c.cfg.fetchImpl ?? fetch);
  if (!ok) throw new HttpError(502, "imagekit_error", "ImageKit did not confirm the deletion");
  return json({ ok: true }, 200, c.cors);
});

/* ------------------------------ public ----------------------------- */

const PUBLIC_COLUMNS =
  "a.id, a.title, a.list_price_minor, a.list_currency, a.description_public, a.image_url, a.youtube_url, a.old_owner_name, a.show_old_owner_public, a.updated_at";
const PUBLIC_WHERE = `NOT a.deleted AND a.published AND a.status = 'available'
  AND EXISTS (SELECT 1 FROM login_links l WHERE l.account_id = a.id AND NOT l.deleted)`;

export async function queryPublicListings(
  db: Db,
  opts: { q?: string | null; currency?: string | null; sort?: string | null; limit?: number } = {},
): Promise<PublicListing[]> {
  const params: unknown[] = [];
  let where = PUBLIC_WHERE;
  if (opts.q) {
    params.push(`%${opts.q.slice(0, 100).replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    where += ` AND (a.title ILIKE $${params.length} OR a.description_public ILIKE $${params.length})`;
  }
  if (opts.currency === "USD" || opts.currency === "PKR") {
    params.push(opts.currency);
    where += ` AND a.list_currency = $${params.length}`;
  }
  const order =
    opts.sort === "price_asc"
      ? "a.list_price_minor ASC NULLS LAST"
      : opts.sort === "price_desc"
        ? "a.list_price_minor DESC NULLS LAST"
        : "a.updated_at DESC";
  const limit = Math.min(opts.limit ?? 200, 500);
  const r = await db.query<Parameters<typeof toPublicListing>[0]>(
    `SELECT ${PUBLIC_COLUMNS} FROM accounts a WHERE ${where} ORDER BY ${order} LIMIT ${limit}`,
    params,
  );
  return r.rows.map(toPublicListing);
}

export async function queryPublicListing(db: Db, id: string): Promise<PublicListing | null> {
  if (!isUuid(id)) return null;
  const r = await db.query<Parameters<typeof toPublicListing>[0]>(
    `SELECT ${PUBLIC_COLUMNS} FROM accounts a WHERE a.id = $1 AND ${PUBLIC_WHERE}`,
    [id],
  );
  return r.rows[0] ? toPublicListing(r.rows[0]) : null;
}

export async function queryPublicSettings(db: Db): Promise<PublicSettings> {
  const r = await db.query<{ id: string; value: string }>("SELECT id, value FROM settings WHERE NOT deleted AND id = ANY($1)", [
    [SETTING_IDS.store_name, SETTING_IDS.public_whatsapp, SETTING_IDS.store_tagline],
  ]);
  const get = (id: string) => r.rows.find((x) => x.id === id)?.value ?? null;
  return {
    store_name: get(SETTING_IDS.store_name) || "CODE X STOCKS",
    store_tagline: get(SETTING_IDS.store_tagline) || "Verified PUBG Mobile accounts",
    whatsapp: get(SETTING_IDS.public_whatsapp),
  };
}

const PUBLIC_CACHE = { "Cache-Control": "public, max-age=30, s-maxage=30" };

route("GET", "/public/listings", "public", async (c) => {
  const sp = c.url.searchParams;
  const rows = await queryPublicListings(c.cfg.db, { q: sp.get("q"), currency: sp.get("currency"), sort: sp.get("sort") });
  return json(rows, 200, { ...PUBLIC_CACHE, ...c.cors });
});

route("GET", "/public/listings/:id", "public", async (c) => {
  const row = await queryPublicListing(c.cfg.db, c.params.id);
  if (!row) throw new HttpError(404, "not_found", "Listing not found");
  return json(row, 200, { ...PUBLIC_CACHE, ...c.cors });
});

route("GET", "/public/settings", "public", async (c) => json(await queryPublicSettings(c.cfg.db), 200, { ...PUBLIC_CACHE, ...c.cors }));

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

export function createApi(cfg: ApiConfig): (req: Request) => Promise<Response> {
  const log = cfg.log ?? ((m: string) => console.error(m));
  return async (req: Request) => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    const cors: Record<string, string> =
      origin && cfg.corsOrigins.includes(origin)
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {};
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: cors["Access-Control-Allow-Origin"] ? 204 : 403,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        },
      });
    }
    if (!url.pathname.startsWith(PREFIX)) return json({ error: { code: "not_found", message: "Not found" } }, 404, cors);
    const path = url.pathname.slice(PREFIX.length) || "/";
    let matched: Route | undefined;
    let params: Record<string, string> = {};
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      matched = r;
      params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      break;
    }
    if (!matched)
      return json({ error: { code: methodMismatch ? "method" : "not_found", message: "Not found" } }, methodMismatch ? 405 : 404, cors);

    const now = cfg.now?.() ?? new Date();
    let cached: unknown;
    const ctx: Ctx = {
      req, url, params, cfg, now, cors, auth: null,
      body: async () => {
        if (cached !== undefined) return cached;
        const text = await req.text();
        if (text.length > MAX_BODY) throw new HttpError(413, "too_large", "Request body is too large");
        try {
          cached = text ? JSON.parse(text) : {};
        } catch {
          throw new HttpError(400, "bad_json", "Request body must be JSON");
        }
        return cached;
      },
    };

    try {
      if (matched.auth === "owner") {
        const bearerToken = bearer(req);
        const cookieToken = bearerToken ? null : readCookie(req, cookieName(cfg));
        ctx.auth = await authenticate(cfg.db, bearerToken ?? cookieToken, now);
        if (!ctx.auth) throw new HttpError(401, "unauthorized", "Sign in required");
        // Cookie sessions are ambient credentials: require a same-site admin Origin on writes (CSRF defence).
        if (cookieToken && req.method !== "GET" && (!origin || !cfg.adminOrigins.includes(origin)))
          throw new HttpError(403, "bad_origin", "Request origin not allowed");
        if (cookieToken && ctx.auth.kind !== "web") throw new HttpError(401, "unauthorized", "Sign in required");
      }
      return await matched.handler(ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message, ...e.extra } }, e.status, cors);
      if (e instanceof z.ZodError) return json({ error: { code: "validation", message: firstIssue(e) } }, 400, cors);
      if (e instanceof RuleError) return json({ error: { code: e.code, message: e.message } }, 422, cors);
      if (e instanceof ConflictError)
        return json({ error: { code: "conflict", message: e.message, current: e.current ?? null } }, 409, cors);
      const pgCode = (e as { code?: string }).code;
      if (pgCode === "23505") return json({ error: { code: "constraint_unique", message: "Duplicate record" } }, 409, cors);
      // Log only the error type/message — request bodies (which may hold ciphertext) are never logged.
      log(`[api] ${req.method} ${path} failed: ${(e as Error)?.name}: ${(e as Error)?.message}`);
      return json({ error: { code: "internal", message: "Internal server error" } }, 500, cors);
    }
  };
}
