import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { newId } from "@codex/shared";
import type { Db } from "./db";

/* ------------------------------------------------------------------ */
/* Owner password hashing — scrypt (memory-hard), per-password salt     */
/* ------------------------------------------------------------------ */

// OWASP recommended scrypt parameters: N=2^17, r=8, p=1 (128 MiB).
const SCRYPT = { logN: 17, r: 8, p: 1, keyLen: 32 };

function scrypt(password: string, salt: Buffer, logN: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keyLen, { N: 2 ** logN, r, p, maxmem: 2 ** logN * r * 256 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string, params = SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, params.logN, params.r, params.p, params.keyLen);
  return `scrypt$${params.logN}$${params.r}$${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [alg, logN, r, p, salt, hash] = encoded.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), +logN, +r, +p, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Fake hash used to keep timing similar when the username is wrong. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(params = SCRYPT) {
  dummyHash ??= hashPassword("dummy-password-not-used", params);
  return dummyHash;
}

export function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Password must be at least 10 characters";
  if (p.length > 200) return "Password is too long";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (p.length < 16 && classes < 3) return "Use upper/lower-case letters, numbers and symbols (or 16+ characters)";
  return null;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export interface AuthContext {
  sessionId: string;
  kind: "web" | "device";
  deviceId: string | null;
  deviceName: string | null;
}

export async function createSession(
  db: Db,
  kind: "web" | "device",
  deviceId: string | null,
  ttlMs: number,
  now: Date,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const sessionId = newId(now.getTime());
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.query(
    "INSERT INTO sessions (id, token_hash, kind, device_id, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [sessionId, sha256Hex(token), kind, deviceId, now.toISOString(), expiresAt.toISOString()],
  );
  return { token, sessionId, expiresAt };
}

export async function authenticate(db: Db, token: string | null, now: Date): Promise<AuthContext | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await db.query<{
    id: string; kind: "web" | "device"; device_id: string | null; expires_at: string; revoked_at: string | null;
    last_seen_at: string | null; d_name: string | null; d_revoked: string | null;
  }>(
    `SELECT s.id, s.kind, s.device_id, s.expires_at, s.revoked_at, s.last_seen_at, d.name AS d_name, d.revoked_at AS d_revoked
       FROM sessions s LEFT JOIN devices d ON d.id = s.device_id WHERE s.token_hash = $1`,
    [sha256Hex(token)],
  );
  const s = r.rows[0];
  if (!s || s.revoked_at || s.d_revoked || new Date(s.expires_at) <= now) return null;
  if (!s.last_seen_at || now.getTime() - new Date(s.last_seen_at).getTime() > 60_000) {
    await db.query("UPDATE sessions SET last_seen_at = $1 WHERE id = $2", [now.toISOString(), s.id]);
    if (s.device_id) await db.query("UPDATE devices SET last_seen_at = $1 WHERE id = $2", [now.toISOString(), s.device_id]);
  }
  return { sessionId: s.id, kind: s.kind, deviceId: s.device_id, deviceName: s.d_name };
}

/* ------------------------------------------------------------------ */
/* Login throttling                                                    */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;

export async function isThrottled(db: Db, keys: string[], now: Date): Promise<boolean> {
  const r = await db.query<{ key: string; window_start: string; failures: number }>(
    "SELECT key, window_start, failures FROM login_attempts WHERE key = ANY($1)",
    [keys],
  );
  return r.rows.some((x) => now.getTime() - new Date(x.window_start).getTime() < WINDOW_MS && x.failures >= MAX_FAILURES);
}

export async function recordFailure(db: Db, keys: string[], now: Date): Promise<void> {
  for (const key of keys) {
    await db.query(
      `INSERT INTO login_attempts (key, window_start, failures) VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE SET
         failures = CASE WHEN login_attempts.window_start < $3 THEN 1 ELSE login_attempts.failures + 1 END,
         window_start = CASE WHEN login_attempts.window_start < $3 THEN $2 ELSE login_attempts.window_start END`,
      [key, now.toISOString(), new Date(now.getTime() - WINDOW_MS).toISOString()],
    );
  }
}

export async function clearFailures(db: Db, keys: string[]): Promise<void> {
  await db.query("DELETE FROM login_attempts WHERE key = ANY($1)", [keys]);
}
