/**
 * CODE X STOCKS cryptography.
 *
 * Built only from audited primitives in @noble/ciphers and @noble/hashes:
 *  - XChaCha20-Poly1305 authenticated encryption (random 192-bit nonce per message)
 *  - Argon2id password-based key derivation
 *  - HKDF-SHA256 key separation, HMAC-SHA256 fingerprints
 * No custom ciphers. Works identically in Node, browsers and the Tauri WebView.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes as nobleRandom } from "@noble/ciphers/utils.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export class VaultError extends Error {
  constructor(
    public code: "wrong_key" | "corrupt" | "locked" | "format" | "weak_passphrase",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

/* ------------------------------------------------------------------ */
/* Encoding helpers (no Buffer — runs in the browser)                  */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
export const utf8 = (s: string) => enc.encode(s);
export const fromUtf8 = (b: Uint8Array) => dec.decode(b);

export function toB64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new VaultError("format", "Invalid encoding");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(n: number): Uint8Array {
  return nobleRandom(n);
}

/** Best-effort zeroing of key material. JS cannot guarantee no copies remain (documented limitation). */
export function wipe(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const a of arrays) a?.fill(0);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/* ------------------------------------------------------------------ */
/* Authenticated encryption of individual secrets                      */
/* ------------------------------------------------------------------ */

const PREFIX = "cx1.";
const NONCE_LEN = 24;

function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Uint8Array {
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce, utf8(aad)).encrypt(plaintext);
  const out = new Uint8Array(NONCE_LEN + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_LEN);
  return out;
}

function open(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < NONCE_LEN + 16) throw new VaultError("corrupt", "Encrypted value is truncated");
  try {
    return xchacha20poly1305(key, sealed.subarray(0, NONCE_LEN), utf8(aad)).decrypt(sealed.subarray(NONCE_LEN));
  } catch {
    throw new VaultError("wrong_key", "Decryption failed: wrong key or tampered data");
  }
}

/** Associated data binds each ciphertext to its record, so ciphertexts cannot be swapped between records. */
export function secretAad(kind: "credential" | "backup_code", recordId: string): string {
  return `codex/v1/${kind}/${recordId}`;
}

/** A vault key: the decrypted data-encryption key plus derived sub-keys. Keep in memory only while unlocked. */
export interface VaultKey {
  vaultId: string;
  encKey: Uint8Array;
  tagKey: Uint8Array;
}

function deriveSubkeys(vaultId: string, dek: Uint8Array): VaultKey {
  return {
    vaultId,
    encKey: hkdf(sha256, dek, utf8(vaultId), utf8("codex/v1/secret-encryption"), 32),
    tagKey: hkdf(sha256, dek, utf8(vaultId), utf8("codex/v1/backup-code-tag"), 32),
  };
}

export function wipeVaultKey(k: VaultKey | null | undefined): void {
  if (k) wipe(k.encKey, k.tagKey);
}

export function encryptSecret(key: VaultKey, plaintext: string, aad: string): string {
  return PREFIX + toB64url(seal(key.encKey, utf8(plaintext), aad));
}

export function decryptSecret(key: VaultKey, ciphertext: string, aad: string): string {
  if (!ciphertext.startsWith(PREFIX)) throw new VaultError("format", "Not an encrypted value");
  return fromUtf8(open(key.encKey, fromB64url(ciphertext.slice(PREFIX.length)), aad));
}

/**
 * Keyed fingerprint of a backup code. Lets any party (including the server) detect duplicate
 * codes within a set without being able to learn or brute-force the code (key stays on devices).
 */
export function backupCodeTag(key: VaultKey, setId: string, code: string): string {
  return toHex(hmac(sha256, key.tagKey, utf8(`${setId}:${code}`)));
}

/* ------------------------------------------------------------------ */
/* Argon2id                                                            */
/* ------------------------------------------------------------------ */

export interface KdfParams {
  alg: "argon2id";
  m: number; // KiB
  t: number;
  p: number;
  salt: string; // base64url
}

/** Vault unlock: 64 MiB, 3 passes (stronger than OWASP minimum, ~1-3 s in JS). */
export const VAULT_KDF = { m: 65536, t: 3, p: 1 };
/** Login verifier: OWASP recommended minimum for Argon2id (19 MiB, 2 passes). */
export const LOGIN_KDF = { m: 19456, t: 2, p: 1 };
/** Backups: same as vault. */
export const BACKUP_KDF = VAULT_KDF;

export function newKdfParams(base: { m: number; t: number; p: number }): KdfParams {
  return { alg: "argon2id", ...base, salt: toB64url(randomBytes(16)) };
}

export async function deriveKey(secret: string, params: KdfParams, dkLen = 32): Promise<Uint8Array> {
  if (params.alg !== "argon2id") throw new VaultError("format", "Unsupported key derivation");
  if (params.m < 8 * params.p || params.t < 1 || params.m > 1_048_576) throw new VaultError("format", "Invalid KDF parameters");
  return argon2idAsync(utf8(secret.normalize("NFKC")), fromB64url(params.salt), {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen,
  });
}

/* ------------------------------------------------------------------ */
/* Passphrase policy                                                   */
/* ------------------------------------------------------------------ */

export function passphraseProblem(p: string, minLength = 12): string | null {
  if (p.length < minLength) return `Use at least ${minLength} characters`;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (p.length < 20 && classes < 3)
    return "Mix upper-case, lower-case, numbers and symbols, or use a longer passphrase (20+ characters)";
  if (/^(.)\1+$/.test(p)) return "Passphrase is too repetitive";
  return null;
}

/* ------------------------------------------------------------------ */
/* Recovery key                                                        */
/* ------------------------------------------------------------------ */

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

export function parseRecoveryKey(text: string): Uint8Array {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (clean.length !== 52) throw new VaultError("format", "Recovery key should be 52 characters (13 groups of 4)");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new VaultError("format", "Recovery key contains invalid characters");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out.slice(0, 32));
}

/* ------------------------------------------------------------------ */
/* Vault envelope                                                      */
/* ------------------------------------------------------------------ */

/**
 * The vault envelope is safe to store locally and on the server: it holds the
 * data-encryption key (DEK) wrapped twice — by a key derived from the owner's
 * vault passphrase (Argon2id) and by the random recovery key. The server never
 * receives the passphrase, the recovery key or the DEK.
 */
export interface VaultEnvelope {
  format: "codex-vault";
  v: 1;
  vault_id: string;
  created_at: string;
  updated_at: string;
  kdf: KdfParams;
  pass_wrap: string;
  recovery_wrap: string;
}

const wrapAad = (vaultId: string, kind: "pass" | "recovery") => `codex/v1/vault-wrap/${kind}/${vaultId}`;

function recoveryKek(vaultId: string, recovery: Uint8Array): Uint8Array {
  return hkdf(sha256, recovery, utf8(vaultId), utf8("codex/v1/recovery-kek"), 32);
}

export function parseEnvelope(json: string): VaultEnvelope {
  let e: VaultEnvelope;
  try {
    e = JSON.parse(json);
  } catch {
    throw new VaultError("format", "Vault data is not valid JSON");
  }
  if (e?.format !== "codex-vault" || e.v !== 1 || typeof e.vault_id !== "string" || !e.kdf || !e.pass_wrap || !e.recovery_wrap)
    throw new VaultError("format", "Unrecognised vault format");
  return e;
}

export async function createVault(
  passphrase: string,
  opts: { vaultId: string; kdf?: { m: number; t: number; p: number }; now?: string },
): Promise<{ envelope: VaultEnvelope; key: VaultKey; recoveryKey: string }> {
  const dek = randomBytes(32);
  const recovery = randomBytes(32);
  const kdf = newKdfParams(opts.kdf ?? VAULT_KDF);
  const kek = await deriveKey(passphrase, kdf);
  const rkek = recoveryKek(opts.vaultId, recovery);
  const now = opts.now ?? new Date().toISOString();
  const envelope: VaultEnvelope = {
    format: "codex-vault",
    v: 1,
    vault_id: opts.vaultId,
    created_at: now,
    updated_at: now,
    kdf,
    pass_wrap: toB64url(seal(kek, dek, wrapAad(opts.vaultId, "pass"))),
    recovery_wrap: toB64url(seal(rkek, dek, wrapAad(opts.vaultId, "recovery"))),
  };
  const key = deriveSubkeys(opts.vaultId, dek);
  const recoveryKey = formatRecoveryKey(recovery);
  wipe(dek, recovery, kek, rkek);
  return { envelope, key, recoveryKey };
}

export async function unlockWithPassphrase(env: VaultEnvelope, passphrase: string): Promise<VaultKey> {
  const kek = await deriveKey(passphrase, env.kdf);
  try {
    const dek = open(kek, fromB64url(env.pass_wrap), wrapAad(env.vault_id, "pass"));
    const key = deriveSubkeys(env.vault_id, dek);
    wipe(dek);
    return key;
  } catch {
    throw new VaultError("wrong_key", "Incorrect vault passphrase");
  } finally {
    wipe(kek);
  }
}

export function unlockWithRecoveryKey(env: VaultEnvelope, recoveryKey: string): VaultKey {
  const rec = parseRecoveryKey(recoveryKey);
  const rkek = recoveryKek(env.vault_id, rec);
  try {
    const dek = open(rkek, fromB64url(env.recovery_wrap), wrapAad(env.vault_id, "recovery"));
    const key = deriveSubkeys(env.vault_id, dek);
    wipe(dek);
    return key;
  } catch {
    throw new VaultError("wrong_key", "Incorrect recovery key");
  } finally {
    wipe(rec, rkek);
  }
}

/** Unwrap the raw DEK (needed only to re-wrap it under a new passphrase). */
async function unwrapDek(env: VaultEnvelope, auth: { passphrase?: string; recoveryKey?: string }): Promise<Uint8Array> {
  if (auth.passphrase !== undefined) {
    const kek = await deriveKey(auth.passphrase, env.kdf);
    try {
      return open(kek, fromB64url(env.pass_wrap), wrapAad(env.vault_id, "pass"));
    } catch {
      throw new VaultError("wrong_key", "Incorrect vault passphrase");
    } finally {
      wipe(kek);
    }
  }
  if (auth.recoveryKey !== undefined) {
    const rec = parseRecoveryKey(auth.recoveryKey);
    const rkek = recoveryKek(env.vault_id, rec);
    try {
      return open(rkek, fromB64url(env.recovery_wrap), wrapAad(env.vault_id, "recovery"));
    } catch {
      throw new VaultError("wrong_key", "Incorrect recovery key");
    } finally {
      wipe(rec, rkek);
    }
  }
  throw new VaultError("locked", "Passphrase or recovery key required");
}

/**
 * Change the vault passphrase. Proven with the current passphrase OR the recovery key.
 * The data key itself never changes, so no stored secret has to be re-encrypted and
 * no key is silently replaced. The recovery key keeps working.
 */
export async function changeVaultPassphrase(
  env: VaultEnvelope,
  auth: { passphrase?: string; recoveryKey?: string },
  newPassphrase: string,
  opts: { kdf?: { m: number; t: number; p: number }; now?: string } = {},
): Promise<VaultEnvelope> {
  const dek = await unwrapDek(env, auth);
  const kdf = newKdfParams(opts.kdf ?? VAULT_KDF);
  const kek = await deriveKey(newPassphrase, kdf);
  try {
    return {
      ...env,
      kdf,
      pass_wrap: toB64url(seal(kek, dek, wrapAad(env.vault_id, "pass"))),
      updated_at: opts.now ?? new Date().toISOString(),
    };
  } finally {
    wipe(dek, kek);
  }
}

/** Issue a new recovery key (the old one stops working). Requires the current passphrase. */
export async function rotateRecoveryKey(
  env: VaultEnvelope,
  passphrase: string,
  now?: string,
): Promise<{ envelope: VaultEnvelope; recoveryKey: string }> {
  const dek = await unwrapDek(env, { passphrase });
  const recovery = randomBytes(32);
  const rkek = recoveryKek(env.vault_id, recovery);
  try {
    return {
      envelope: {
        ...env,
        recovery_wrap: toB64url(seal(rkek, dek, wrapAad(env.vault_id, "recovery"))),
        updated_at: now ?? new Date().toISOString(),
      },
      recoveryKey: formatRecoveryKey(recovery),
    };
  } finally {
    wipe(dek, recovery, rkek);
  }
}

/* ------------------------------------------------------------------ */
/* Local login password (offline verification)                          */
/* ------------------------------------------------------------------ */

export interface LoginVerifier {
  kdf: KdfParams;
  verifier: string; // hex
}

/**
 * One Argon2id run yields two independent keys (via HKDF):
 *  - a verifier stored locally to check the password offline
 *  - a local key used to encrypt this device's cloud session token at rest
 */
export async function deriveLoginKeys(
  password: string,
  kdf: KdfParams,
): Promise<{ verifier: Uint8Array; localKey: Uint8Array }> {
  const master = await deriveKey(password, kdf, 32);
  try {
    return {
      verifier: hkdf(sha256, master, undefined, utf8("codex/v1/login-verifier"), 32),
      localKey: hkdf(sha256, master, undefined, utf8("codex/v1/local-key"), 32),
    };
  } finally {
    wipe(master);
  }
}

export async function createLoginVerifier(
  password: string,
  base = LOGIN_KDF,
): Promise<{ record: LoginVerifier; localKey: Uint8Array }> {
  const kdf = newKdfParams(base);
  const { verifier, localKey } = await deriveLoginKeys(password, kdf);
  return { record: { kdf, verifier: toHex(verifier) }, localKey };
}

/** Returns the local key when the password is correct, otherwise null. Constant-time comparison. */
export async function checkLoginPassword(password: string, rec: LoginVerifier): Promise<Uint8Array | null> {
  const { verifier, localKey } = await deriveLoginKeys(password, rec.kdf);
  const expected = Uint8Array.from(rec.verifier.match(/../g)!.map((h) => parseInt(h, 16)));
  if (constantTimeEqual(verifier, expected)) return localKey;
  wipe(localKey);
  return null;
}

export function sealWithKey(key: Uint8Array, plaintext: string, aad: string): string {
  return PREFIX + toB64url(seal(key, utf8(plaintext), aad));
}

export function openWithKey(key: Uint8Array, ciphertext: string, aad: string): string {
  if (!ciphertext.startsWith(PREFIX)) throw new VaultError("format", "Not an encrypted value");
  return fromUtf8(open(key, fromB64url(ciphertext.slice(PREFIX.length)), aad));
}

/* ------------------------------------------------------------------ */
/* Encrypted backup files                                              */
/* ------------------------------------------------------------------ */

export interface BackupFile {
  format: "codex-stocks-backup";
  v: 1;
  created_at: string;
  kdf: KdfParams;
  data: string; // base64url(nonce || ciphertext)
}

export async function encryptBackup(
  passphrase: string,
  plaintextJson: string,
  opts: { kdf?: { m: number; t: number; p: number }; now?: string } = {},
): Promise<string> {
  const kdf = newKdfParams(opts.kdf ?? BACKUP_KDF);
  const key = await deriveKey(passphrase, kdf);
  try {
    const file: BackupFile = {
      format: "codex-stocks-backup",
      v: 1,
      created_at: opts.now ?? new Date().toISOString(),
      kdf,
      data: toB64url(seal(key, utf8(plaintextJson), "codex/v1/backup")),
    };
    return JSON.stringify(file);
  } finally {
    wipe(key);
  }
}

export async function decryptBackup(passphrase: string, fileText: string): Promise<string> {
  let f: BackupFile;
  try {
    f = JSON.parse(fileText);
  } catch {
    throw new VaultError("format", "This is not a CODE X STOCKS backup file");
  }
  if (f?.format !== "codex-stocks-backup" || f.v !== 1) throw new VaultError("format", "This is not a CODE X STOCKS backup file");
  const key = await deriveKey(passphrase, f.kdf);
  try {
    return fromUtf8(open(key, fromB64url(f.data), "codex/v1/backup"));
  } catch (e) {
    if (e instanceof VaultError && e.code === "wrong_key") throw new VaultError("wrong_key", "Incorrect backup password");
    throw e;
  } finally {
    wipe(key);
  }
}
