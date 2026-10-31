import { ApiClient, ApiError } from "@codex/api-client";
import {
  changeVaultPassphrase,
  checkLoginPassword,
  createLoginVerifier,
  createVault,
  decryptBackup,
  decryptSecret,
  encryptBackup,
  encryptSecret,
  backupCodeTag,
  openWithKey,
  parseEnvelope,
  passphraseProblem,
  rotateRecoveryKey,
  sealWithKey,
  secretAad,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  wipe,
  wipeVaultKey,
  LOGIN_KDF,
  VAULT_KDF,
  type LoginVerifier,
  type VaultKey,
} from "@codex/crypto";
import {
  computeReport,
  fxStatus,
  isValidUsdPkrMicro,
  type FxQuote,
  ENTITIES,
  ENTITY_SCHEMAS,
  firstIssue,
  loadAccountBundle,
  newId,
  RuleError,
  runCommand,
  type Account,
  type AccountBundle,
  type AnyRow,
  type BackupCode,
  type CommandName,
  type Credential,
  type Currency,
  type DeviceInfo,
  type Entity,
  type EntityRowMap,
  type FinancialReport,
  type LoginLink,
} from "@codex/shared";
import { fromLocal, kvGet, kvSet, LocalDb, migrateLocal, type Q, type SqlDriver } from "./db";
import { MediaQueue, type FileStore } from "./media";
import { backupSetArgs, revealBackupCode, revealCredential, sharedPasswordArgs } from "./secrets";
import { LocalEntityStore, enqueue, writeLocalRow } from "./store";
import { SyncEngine, type SyncStatus, type VaultState } from "./sync";

export interface Platform {
  driver: SqlDriver;
  files: FileStore;
  deviceName: string;
  platform: string;
  defaultApiBase: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Test-only overrides for key-derivation cost. */
  kdf?: { vault?: { m: number; t: number; p: number }; login?: { m: number; t: number; p: number } };
}

interface OwnerRecord {
  username: string;
  verifier: LoginVerifier;
  created_at: string;
}

interface CloudRecord {
  api_base: string;
  device_id: string;
  token_ct: string;
  paired_at: string;
}

export interface Prefs {
  idle_minutes: number;
  api_base: string;
}

export interface AppState {
  setup: boolean;
  loggedIn: boolean;
  vaultUnlocked: boolean;
  hasVault: boolean;
  paired: boolean;
  username: string | null;
  deviceId: string | null;
  apiBase: string;
  cloudProblem: string | null;
}

export interface DashboardData {
  report: FinancialReport;
  sync: SyncStatus;
}

export interface OutboxIssue {
  seq: number;
  entity: string;
  entity_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface LocalConflict {
  id: string;
  entity: Entity;
  entity_id: string;
  local: AnyRow;
  server: AnyRow;
  fields: string[];
  created_at: string;
}

const TOKEN_AAD = "codex/v1/device-token";
const BACKUP_FORMAT = "codex-stocks-data";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class AppCore {
  readonly db: LocalDb;
  readonly sync: SyncEngine;
  readonly media: MediaQueue;
  private localKey: Uint8Array | null = null;
  private token: string | null = null;
  private vaultKey: VaultKey | null = null;
  private username: string | null = null;
  private cloud: CloudRecord | null = null;
  private listeners = new Set<() => void>();
  cloudProblem: string | null = null;

  private constructor(private p: Platform) {
    this.db = new LocalDb(p.driver);
    this.media = new MediaQueue(this.db, p.files, (q, name, args) => this.runIn(q, name, args), {
      now: p.now,
      fetchImpl: p.fetchImpl,
    });
    this.sync = new SyncEngine(this.db, () => this.api(), {
      now: p.now,
      beforePush: (api) => this.media.processUploads(api).then(() => undefined),
      afterPull: (api) => this.media.processDeletes(api),
      onChange: () => this.emit(),
    });
  }

  static async open(p: Platform): Promise<AppCore> {
    const core = new AppCore(p);
    await migrateLocal(core.db);
    await core.media.recover();
    core.cloud = await kvGet<CloudRecord>(core.db, "cloud");
    return core;
  }

  /* ------------------------------------------------------------------ */
  /* plumbing                                                            */
  /* ------------------------------------------------------------------ */

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }
  private now() {
    return this.p.now?.() ?? new Date();
  }
  private actor() {
    return this.cloud ? `device:${this.cloud.device_id}` : "local";
  }
  private requireLogin() {
    if (!this.username) throw new AuthError("Sign in first");
  }
  private requireVault(): VaultKey {
    this.requireLogin();
    if (!this.vaultKey) throw new AuthError("Unlock the credential vault first");
    return this.vaultKey;
  }

  private client(apiBase: string, token: string | null = null) {
    return new ApiClient({ baseUrl: apiBase, getToken: () => token, fetchImpl: this.p.fetchImpl, timeoutMs: 20_000 });
  }

  /** Authenticated API client, available only while signed in on a paired device. */
  api(): ApiClient | null {
    if (!this.cloud || !this.token || !this.username) return null;
    const token = this.token;
    return this.client(this.cloud.api_base, token);
  }

  private runIn(q: Q, name: CommandName, args: unknown) {
    return runCommand(new LocalEntityStore(q, this.actor(), () => this.now()), name, args);
  }

  /**
   * USD/PKR quote for conversions and transaction snapshots. Online: fetched from the server (which
   * caches the provider's daily rate) and remembered locally. Offline: the remembered quote, with its
   * status recomputed from its age — never a made-up value. Null if this PC has never received one.
   */
  async fxQuote(): Promise<FxQuote | null> {
    const base = this.cloud?.api_base ?? (await this.prefs()).api_base;
    try {
      const { quote } = await this.client(base).fx();
      if (quote && isValidUsdPkrMicro(quote.usd_pkr_micro)) {
        await kvSet(this.db, "fx", quote);
        return { ...quote, status: fxStatus(quote, this.now()) };
      }
    } catch {
      /* offline or server unavailable: use the cached quote */
    }
    const cached = await kvGet<FxQuote>(this.db, "fx");
    return cached && isValidUsdPkrMicro(cached.usd_pkr_micro) ? { ...cached, status: fxStatus(cached, this.now()) } : null;
  }

  async prefs(): Promise<Prefs> {
    const p = await kvGet<Partial<Prefs>>(this.db, "prefs");
    return { idle_minutes: p?.idle_minutes ?? 10, api_base: p?.api_base || this.p.defaultApiBase };
  }

  async savePrefs(p: Partial<Prefs>): Promise<void> {
    const cur = await this.prefs();
    const next = { ...cur, ...p };
    if (next.idle_minutes < 1 || next.idle_minutes > 240) throw new RuleError("idle", "Idle lock must be 1–240 minutes");
    if (next.api_base && !/^https?:\/\/[^\s]+$/.test(next.api_base)) throw new RuleError("api_base", "Enter a valid server URL");
    await kvSet(this.db, "prefs", next);
    this.emit();
  }

  async state(): Promise<AppState> {
    const owner = await kvGet<OwnerRecord>(this.db, "owner");
    const vault = await kvGet<VaultState>(this.db, "vault");
    return {
      setup: !!owner,
      loggedIn: !!this.username,
      vaultUnlocked: !!this.vaultKey,
      hasVault: !!vault,
      paired: !!this.cloud,
      username: owner?.username ?? null,
      deviceId: this.cloud?.device_id ?? null,
      apiBase: this.cloud?.api_base ?? (await this.prefs()).api_base,
      cloudProblem: this.cloudProblem,
    };
  }

  /* ------------------------------------------------------------------ */
  /* first-run setup                                                     */
  /* ------------------------------------------------------------------ */

  private async assertFresh() {
    if (await kvGet(this.db, "owner")) throw new RuleError("already_setup", "This device is already set up");
  }

  private checkSetupInput(username: string, password: string, vaultPassphrase?: string) {
    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username))
      throw new RuleError("username", "Username: 3–50 letters, numbers, dot, dash or underscore");
    const pw = passphraseProblem(password, 10);
    if (pw) throw new RuleError("weak_password", `Login password: ${pw}`);
    if (vaultPassphrase !== undefined) {
      const vp = passphraseProblem(vaultPassphrase, 12);
      if (vp) throw new RuleError("weak_passphrase", `Vault passphrase: ${vp}`);
      if (vaultPassphrase === password)
        throw new RuleError("same_secret", "The vault passphrase must be different from the login password");
    }
  }

  private async storeOwner(username: string, password: string): Promise<Uint8Array> {
    const { record, localKey } = await createLoginVerifier(password, this.p.kdf?.login ?? LOGIN_KDF);
    await kvSet(this.db, "owner", { username: username.toLowerCase(), verifier: record, created_at: this.now().toISOString() });
    return localKey;
  }

  private async newVault(passphrase: string): Promise<string> {
    const vaultId = newId();
    const { envelope, key, recoveryKey } = await createVault(passphrase, { vaultId, kdf: this.p.kdf?.vault ?? VAULT_KDF });
    await kvSet(this.db, "vault", { envelope: JSON.stringify(envelope), vault_id: vaultId, version: 0, dirty: true } satisfies VaultState);
    wipeVaultKey(this.vaultKey);
    this.vaultKey = key;
    return recoveryKey;
  }

  private async saveCloud(apiBase: string, deviceId: string, token: string, localKey: Uint8Array) {
    const rec: CloudRecord = {
      api_base: apiBase.replace(/\/$/, ""),
      device_id: deviceId,
      token_ct: sealWithKey(localKey, token, TOKEN_AAD),
      paired_at: this.now().toISOString(),
    };
    await kvSet(this.db, "cloud", rec);
    this.cloud = rec;
    this.token = token;
  }

  private beginSession(username: string, localKey: Uint8Array) {
    wipe(this.localKey);
    this.localKey = localKey;
    this.username = username.toLowerCase();
    this.cloudProblem = null;
  }

  /** Offline / local-only setup. Can be paired with the cloud later. Returns the recovery key (show once). */
  async setupLocal(input: { username: string; password: string; vaultPassphrase: string; currency: Currency }): Promise<{ recoveryKey: string }> {
    await this.assertFresh();
    this.checkSetupInput(input.username, input.password, input.vaultPassphrase);
    const localKey = await this.storeOwner(input.username, input.password);
    const recoveryKey = await this.newVault(input.vaultPassphrase);
    this.beginSession(input.username, localKey);
    await this.exec("saveSetting", { key: "default_currency", value: input.currency });
    this.emit();
    return { recoveryKey };
  }

  /** First device of a brand-new cloud deployment (needs the server's one-time setup code). */
  async setupCloud(input: {
    apiBase: string;
    setupToken: string;
    username: string;
    password: string;
    vaultPassphrase: string;
    currency: Currency;
  }): Promise<{ recoveryKey: string }> {
    await this.assertFresh();
    this.checkSetupInput(input.username, input.password, input.vaultPassphrase);
    const res = await this.client(input.apiBase).setup({
      setup_token: input.setupToken,
      username: input.username,
      password: input.password,
      client: "desktop",
      device: { name: this.p.deviceName, platform: this.p.platform },
    });
    const localKey = await this.storeOwner(input.username, input.password);
    await this.saveCloud(input.apiBase, res.device_id, res.token, localKey);
    const recoveryKey = await this.newVault(input.vaultPassphrase);
    this.beginSession(input.username, localKey);
    await this.exec("saveSetting", { key: "default_currency", value: input.currency });
    await this.sync.syncOnce({ force: true });
    this.emit();
    return { recoveryKey };
  }

  /**
   * Enrol this PC with an EXISTING cloud account (second PC / reinstall). Requires an online
   * login. The inventory is downloaded; secrets stay encrypted until the vault is unlocked.
   */
  async connectExisting(input: { apiBase: string; username: string; password: string }): Promise<{ vaultExists: boolean }> {
    await this.assertFresh();
    const api = this.client(input.apiBase);
    const res = await api.login({
      username: input.username,
      password: input.password,
      client: "desktop",
      device: { name: this.p.deviceName, platform: this.p.platform },
    });
    if (!res.token || !res.device_id) throw new ApiError(500, "bad_response", "Server did not issue a device token");
    const localKey = await this.storeOwner(input.username, input.password);
    await this.saveCloud(input.apiBase, res.device_id, res.token, localKey);
    this.beginSession(input.username, localKey);
    const authed = this.api()!;
    const vault = await authed.getVault();
    if (vault)
      await kvSet(this.db, "vault", { envelope: vault.envelope, vault_id: vault.vault_id, version: vault.version, dirty: false } satisfies VaultState);
    await this.sync.syncOnce({ force: true });
    this.emit();
    return { vaultExists: !!vault };
  }

  /** Create the vault when the cloud account has none yet (e.g. owner was created on the website). */
  async createVaultIfMissing(passphrase: string): Promise<{ recoveryKey: string }> {
    this.requireLogin();
    if (await kvGet(this.db, "vault")) throw new RuleError("vault_exists", "A vault already exists");
    const vp = passphraseProblem(passphrase, 12);
    if (vp) throw new RuleError("weak_passphrase", vp);
    const recoveryKey = await this.newVault(passphrase);
    this.emit();
    return { recoveryKey };
  }

  /**
   * Pair a local-only installation with the cloud. If the cloud already has a different
   * vault, the local secrets are re-encrypted under the cloud vault key (proven with the
   * cloud vault passphrase). Nothing is duplicated: cloud and local records keep their ids.
   */
  async pairWithCloud(input: {
    apiBase: string;
    username: string;
    password: string;
    setupToken?: string;
    cloudVaultPassphrase?: string;
  }): Promise<void> {
    this.requireLogin();
    if (this.cloud) throw new RuleError("already_paired", "This device is already connected to the cloud");
    const localVaultKey = this.requireVault();
    const api = this.client(input.apiBase);
    const status = await api.authStatus();
    let res: { token?: string; device_id?: string };
    const device = { name: this.p.deviceName, platform: this.p.platform };
    if (!status.owner_exists) {
      if (!input.setupToken) throw new RuleError("setup_token_required", "This cloud has no owner yet. Enter the server setup code.");
      this.checkSetupInput(input.username, input.password);
      res = await api.setup({ setup_token: input.setupToken, username: input.username, password: input.password, client: "desktop", device });
    } else {
      res = await api.login({ username: input.username, password: input.password, client: "desktop", device });
    }
    if (!res.token || !res.device_id) throw new ApiError(500, "bad_response", "Server did not issue a device token");
    const authed = this.client(input.apiBase, res.token);
    const cloudVault = await authed.getVault();
    const local = (await kvGet<VaultState>(this.db, "vault"))!;
    let rekeyTo: { key: VaultKey; state: VaultState } | null = null;
    if (cloudVault && cloudVault.vault_id !== local.vault_id) {
      if (!input.cloudVaultPassphrase)
        throw new RuleError("cloud_vault_passphrase", "The cloud already has a credential vault. Enter its vault passphrase to merge.");
      const key = await unlockWithPassphrase(parseEnvelope(cloudVault.envelope), input.cloudVaultPassphrase);
      rekeyTo = { key, state: { envelope: cloudVault.envelope, vault_id: cloudVault.vault_id, version: cloudVault.version, dirty: false } };
    }
    // Commit locally: new login verifier (cloud password), re-encrypted secrets, cloud record.
    const { record, localKey } = await createLoginVerifier(input.password, this.p.kdf?.login ?? LOGIN_KDF);
    await this.db.tx(async (q) => {
      if (rekeyTo) await this.rekeySecrets(q, localVaultKey, rekeyTo.key);
      if (rekeyTo) await kvSet(q, "vault", rekeyTo.state);
      const owner = (await kvGet<OwnerRecord>(q, "owner"))!;
      await kvSet(q, "owner", { ...owner, username: input.username.toLowerCase(), verifier: record });
      await kvSet(q, "cloud", {
        api_base: input.apiBase.replace(/\/$/, ""),
        device_id: res.device_id!,
        token_ct: sealWithKey(localKey, res.token!, TOKEN_AAD),
        paired_at: this.now().toISOString(),
      } satisfies CloudRecord);
    });
    this.cloud = await kvGet<CloudRecord>(this.db, "cloud");
    this.token = res.token;
    if (rekeyTo) {
      wipeVaultKey(this.vaultKey);
      this.vaultKey = rekeyTo.key;
    }
    this.beginSession(input.username, localKey);
    await this.sync.syncOnce({ force: true });
    this.emit();
  }

  /** Re-encrypt never-synced local secrets (rows + queued outbox snapshots) under another vault key. */
  private async rekeySecrets(q: Q, from: VaultKey, to: VaultKey) {
    const synced = await q.one<{ n: number }>(
      "SELECT (SELECT count(*) FROM credentials WHERE rev > 0) + (SELECT count(*) FROM backup_codes WHERE rev > 0) AS n",
    );
    if (Number(synced?.n)) throw new RuleError("rekey_synced", "Secrets were already synced with another vault; cannot merge vaults automatically");
    const reCred = (row: Record<string, unknown>) => {
      const aad = secretAad("credential", String(row.id));
      return { ...row, secret_ct: encryptSecret(to, decryptSecret(from, String(row.secret_ct), aad), aad) };
    };
    const reCode = (row: Record<string, unknown>) => {
      const aad = secretAad("backup_code", String(row.id));
      const code = decryptSecret(from, String(row.code_ct), aad);
      return { ...row, code_ct: encryptSecret(to, code, aad), code_tag: backupCodeTag(to, String(row.set_id), code) };
    };
    for (const [entity, fn] of [["credentials", reCred], ["backup_codes", reCode]] as const) {
      for (const raw of await q.all(`SELECT * FROM ${entity}`)) {
        const row = fn(fromLocal(entity, raw) as unknown as Record<string, unknown>);
        await writeLocalRow(q, entity, row, raw.sync_state as "pending");
      }
      for (const op of await q.all<{ seq: number; payload: string }>(`SELECT seq, payload FROM outbox WHERE entity = ?`, [entity])) {
        await q.run("UPDATE outbox SET payload = ? WHERE seq = ?", [JSON.stringify(fn(JSON.parse(op.payload))), op.seq]);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* login / logout                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Sign in. Works OFFLINE against the locally stored Argon2id verifier. When the local check
   * fails but the device is online and paired, the cloud is asked (the password may have been
   * changed on another device) and the local verifier is updated on success.
   */
  async login(username: string, password: string): Promise<void> {
    const owner = await kvGet<OwnerRecord>(this.db, "owner");
    if (!owner) throw new AuthError("This device is not set up yet");
    const sameUser = owner.username === username.trim().toLowerCase();
    let localKey = sameUser ? await checkLoginPassword(password, owner.verifier) : null;
    if (!localKey && this.cloud) {
      try {
        localKey = await this.cloudReLogin(username, password);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0)
          throw new AuthError("Incorrect username or password (cloud unreachable, so only the password saved on this PC was checked)");
        throw new AuthError("Incorrect username or password");
      }
    }
    if (!localKey) throw new AuthError("Incorrect username or password");
    this.beginSession(owner.username, localKey);
    this.token = this.cloud ? openWithKey(localKey, this.cloud.token_ct, TOKEN_AAD) : null;
    this.emit();
  }

  /** Online login used to (re-)enrol this device and refresh its token. Returns the new local key. */
  private async cloudReLogin(username: string, password: string): Promise<Uint8Array> {
    const cloud = this.cloud!;
    const res = await this.client(cloud.api_base).login({
      username,
      password,
      client: "desktop",
      device: { id: cloud.device_id, name: this.p.deviceName, platform: this.p.platform },
    });
    if (!res.token || !res.device_id) throw new ApiError(500, "bad_response", "No device token issued");
    const { record, localKey } = await createLoginVerifier(password, this.p.kdf?.login ?? LOGIN_KDF);
    const rec: CloudRecord = { ...cloud, device_id: res.device_id, token_ct: sealWithKey(localKey, res.token, TOKEN_AAD) };
    await this.db.tx(async (q) => {
      const owner = (await kvGet<OwnerRecord>(q, "owner"))!;
      await kvSet(q, "owner", { ...owner, username: username.trim().toLowerCase(), verifier: record });
      await kvSet(q, "cloud", rec);
    });
    this.cloud = rec;
    this.token = res.token;
    return localKey;
  }

  /**
   * After an offline-capable login, confirm the cloud still accepts this device. If the token
   * was revoked/expired, try to re-enrol with the password just typed.
   */
  async refreshCloudSession(password: string): Promise<"ok" | "offline" | "reauth_failed" | "unpaired"> {
    const api = this.api();
    if (!api || !this.username) return "unpaired";
    try {
      await api.me();
      this.cloudProblem = null;
      return "ok";
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0) return "offline";
      if (e.status !== 401) return "offline";
    }
    try {
      const localKey = await this.cloudReLogin(this.username, password);
      wipe(this.localKey);
      this.localKey = localKey;
      this.cloudProblem = null;
      this.emit();
      return "ok";
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return "offline";
      this.cloudProblem =
        "The cloud rejected this device. It may have been revoked, or the password was changed on another device. Inventory still works offline; sign out and sign in with the current cloud password to resume syncing.";
      this.token = null;
      this.emit();
      return "reauth_failed";
    }
  }

  /** Sign out: clears the vault key, session key and token from memory. Local data is kept. */
  logout() {
    wipeVaultKey(this.vaultKey);
    wipe(this.localKey);
    this.vaultKey = null;
    this.localKey = null;
    this.token = null;
    this.username = null;
    this.emit();
  }

  /* ------------------------------------------------------------------ */
  /* vault                                                               */
  /* ------------------------------------------------------------------ */

  private async envelope() {
    const v = await kvGet<VaultState>(this.db, "vault");
    if (!v) throw new RuleError("no_vault", "No credential vault exists on this device yet");
    return { state: v, env: parseEnvelope(v.envelope) };
  }

  async unlockVault(passphrase: string) {
    this.requireLogin();
    const { env } = await this.envelope();
    const key = await unlockWithPassphrase(env, passphrase);
    wipeVaultKey(this.vaultKey);
    this.vaultKey = key;
    this.emit();
  }

  async unlockVaultWithRecoveryKey(recoveryKey: string) {
    this.requireLogin();
    const { env } = await this.envelope();
    const key = unlockWithRecoveryKey(env, recoveryKey);
    wipeVaultKey(this.vaultKey);
    this.vaultKey = key;
    this.emit();
  }

  lockVault() {
    wipeVaultKey(this.vaultKey);
    this.vaultKey = null;
    this.emit();
  }

  get vaultUnlocked() {
    return !!this.vaultKey;
  }

  /** Change the vault passphrase (proven by current passphrase OR recovery key). Data key is unchanged. */
  async changeVaultPassphrase(auth: { passphrase?: string; recoveryKey?: string }, next: string) {
    this.requireLogin();
    const vp = passphraseProblem(next, 12);
    if (vp) throw new RuleError("weak_passphrase", vp);
    const { state, env } = await this.envelope();
    const changed = await changeVaultPassphrase(env, auth, next, { kdf: this.p.kdf?.vault ?? VAULT_KDF });
    await kvSet(this.db, "vault", { ...state, envelope: JSON.stringify(changed), dirty: true });
    this.emit();
  }

  async rotateRecoveryKey(passphrase: string): Promise<string> {
    this.requireLogin();
    const { state, env } = await this.envelope();
    const r = await rotateRecoveryKey(env, passphrase);
    await kvSet(this.db, "vault", { ...state, envelope: JSON.stringify(r.envelope), dirty: true });
    this.emit();
    return r.recoveryKey;
  }

  /**
   * Forgotten LOGIN password on this PC: prove ownership with the vault recovery key and set a
   * new local password. (The cloud password is unchanged; reset it with the server CLI if needed.)
   */
  async resetLoginWithRecoveryKey(recoveryKey: string, newPassword: string) {
    const { env } = await this.envelope();
    const key = unlockWithRecoveryKey(env, recoveryKey); // throws if wrong
    wipeVaultKey(key);
    const pw = passphraseProblem(newPassword, 10);
    if (pw) throw new RuleError("weak_password", pw);
    const owner = await kvGet<OwnerRecord>(this.db, "owner");
    if (!owner) throw new AuthError("This device is not set up");
    const { record, localKey } = await createLoginVerifier(newPassword, this.p.kdf?.login ?? LOGIN_KDF);
    await this.db.tx(async (q) => {
      await kvSet(q, "owner", { ...owner, verifier: record });
      // The stored device token was sealed with the old password; it cannot be recovered. Re-login online later.
      if (this.cloud) await kvSet(q, "cloud", { ...this.cloud, token_ct: sealWithKey(localKey, "revoked", TOKEN_AAD) });
    });
    if (this.cloud) {
      this.cloud = await kvGet<CloudRecord>(this.db, "cloud");
      this.cloudProblem = "Sign in online once with your cloud password to resume syncing.";
    }
    wipe(localKey);
  }

  async changeLoginPassword(current: string, next: string) {
    this.requireLogin();
    const owner = (await kvGet<OwnerRecord>(this.db, "owner"))!;
    const ok = await checkLoginPassword(current, owner.verifier);
    if (!ok) throw new AuthError("Current password is incorrect");
    wipe(ok);
    const pw = passphraseProblem(next, 10);
    if (pw) throw new RuleError("weak_password", pw);
    const api = this.api();
    if (this.cloud) {
      if (!api) throw new AuthError("Connect to the internet to change the cloud password");
      await api.changePassword(current, next);
    }
    const { record, localKey } = await createLoginVerifier(next, this.p.kdf?.login ?? LOGIN_KDF);
    await this.db.tx(async (q) => {
      await kvSet(q, "owner", { ...owner, verifier: record });
      if (this.cloud && this.token)
        await kvSet(q, "cloud", { ...this.cloud, token_ct: sealWithKey(localKey, this.token, TOKEN_AAD) });
    });
    this.cloud = await kvGet<CloudRecord>(this.db, "cloud");
    wipe(this.localKey);
    this.localKey = localKey;
  }

  /* ------------------------------------------------------------------ */
  /* inventory commands & queries                                        */
  /* ------------------------------------------------------------------ */

  /** Run a business command in ONE local transaction (row writes + outbox ops). Works offline. */
  async exec<T = unknown>(name: CommandName, args: unknown): Promise<T> {
    this.requireLogin();
    const out = await this.db.tx((q) => this.runIn(q, name, args));
    this.emit();
    return out as T;
  }


  async list<E extends Entity>(entity: E, where: Record<string, string | number | boolean | null> = {}): Promise<EntityRowMap[E][]> {
    this.requireLogin();
    return this.db.read((q) => new LocalEntityStore(q, this.actor()).list(entity, where));
  }

  async get<E extends Entity>(entity: E, id: string): Promise<EntityRowMap[E] | null> {
    this.requireLogin();
    return this.db.read((q) => new LocalEntityStore(q, this.actor()).get(entity, id));
  }

  async listAccounts(): Promise<(Account & { link_count: number; sync_state: string })[]> {
    this.requireLogin();
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT a.*, (SELECT count(*) FROM login_links l WHERE l.account_id = a.id AND l.deleted = 0) AS link_count
         FROM accounts a WHERE a.deleted = 0 ORDER BY a.created_at DESC`,
    );
    return rows.map((r) => ({ ...fromLocal("accounts", r), link_count: Number(r.link_count), sync_state: String(r.sync_state) }));
  }

  async bundle(id: string): Promise<AccountBundle | null> {
    this.requireLogin();
    return this.db.read((q) => loadAccountBundle(new LocalEntityStore(q, this.actor()), id));
  }

  async syncStates(entity: Entity, ids: string[]): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const rows = await this.db.all<{ id: string; sync_state: string }>(
      `SELECT id, sync_state FROM ${entity} WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.sync_state]));
  }

  async dashboard(): Promise<DashboardData> {
    this.requireLogin();
    const [accounts, sales, refunds, expenses] = await Promise.all([
      this.list("accounts"),
      this.list("sales"),
      this.list("refunds"),
      this.list("expenses"),
    ]);
    return { report: computeReport({ accounts, sales, refunds, expenses }), sync: await this.syncStatus() };
  }

  /** Audit history: newest events overall, or every event concerning one account (same rule as the server). */
  async audit(accountId?: string) {
    this.requireLogin();
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM audit_events WHERE deleted = 0 ${
        accountId ? `AND (entity_id = ? OR details LIKE '%"account_id":"' || ? || '"%')` : ""
      } ORDER BY at DESC LIMIT 500`,
      accountId ? [accountId, accountId] : [],
    );
    return rows.map((r) => fromLocal("audit_events", r));
  }

  /* ------------------------------------------------------------------ */
  /* secrets (vault must be unlocked)                                    */
  /* ------------------------------------------------------------------ */

  async saveSharedPassword(accountId: string, plaintext: string) {
    const key = this.requireVault();
    const existing = (await this.list("credentials", { account_id: accountId }))[0] ?? null;
    return this.exec("saveSharedPassword", sharedPasswordArgs(key, accountId, existing, plaintext));
  }

  revealCredential(c: Credential): string {
    return revealCredential(this.requireVault(), c);
  }

  async recordBackupCodes(input: { accountId: string; linkId: string | null; label: string; codes: string[] }) {
    return this.exec("recordBackupSet", backupSetArgs(this.requireVault(), input));
  }

  revealBackupCode(c: BackupCode): string {
    return revealBackupCode(this.requireVault(), c);
  }

  /* ------------------------------------------------------------------ */
  /* images                                                              */
  /* ------------------------------------------------------------------ */

  async setAccountImage(accountId: string, bytes: Uint8Array) {
    this.requireLogin();
    const item = await this.media.enqueue(accountId, bytes);
    this.emit();
    this.kickSync();
    return item;
  }

  async removeAccountImage(accountId: string) {
    this.requireLogin();
    await this.media.removeImage(accountId);
    this.emit();
    this.kickSync();
  }

  /* ------------------------------------------------------------------ */
  /* sync                                                                */
  /* ------------------------------------------------------------------ */

  async syncStatus(): Promise<SyncStatus> {
    const s = await this.sync.status(!!this.cloud);
    if (this.cloud && !this.token && this.username) s.phase = "auth";
    return s;
  }

  async syncNow() {
    const r = await this.sync.syncOnce({ force: true });
    this.emit();
    return r;
  }

  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  kickSync(delayMs = 1500) {
    if (!this.api()) return;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.sync.syncOnce(), delayMs);
  }

  async outboxIssues(): Promise<OutboxIssue[]> {
    return this.db.all<OutboxIssue>(
      `SELECT seq, entity, entity_id, status, attempts, last_error, created_at FROM outbox WHERE status IN ('failed','rejected') ORDER BY seq LIMIT 200`,
    );
  }

  async retryOutbox(seq: number) {
    await this.db.run(`UPDATE outbox SET status = 'pending', next_attempt_at = NULL, base_rev = NULL WHERE seq = ? AND status = 'rejected'`, [seq]);
    await this.db.run(`UPDATE outbox SET next_attempt_at = NULL WHERE seq = ? AND status = 'failed'`, [seq]);
    this.emit();
  }

  /** Drop a rejected local change and restore the server's version of that record. */
  async discardOutbox(seq: number) {
    const op = await this.db.one<{ entity: string; entity_id: string }>("SELECT entity, entity_id FROM outbox WHERE seq = ? AND status = 'rejected'", [seq]);
    if (!op) return;
    const entity = op.entity as Entity;
    let server: AnyRow | null = null;
    const api = this.api();
    if (api) {
      try {
        server = await api.get(entity, op.entity_id);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    await this.db.tx(async (q) => {
      await q.run("DELETE FROM outbox WHERE seq = ?", [seq]);
      const left = await q.one<{ n: number }>("SELECT count(*) AS n FROM outbox WHERE entity_id = ?", [op.entity_id]);
      if (server) await writeLocalRow(q, entity, server, Number(left?.n) ? "pending" : "synced", JSON.stringify(server));
      else if (!Number(left?.n)) {
        const cur = await q.one(`SELECT rev FROM ${entity} WHERE id = ?`, [op.entity_id]);
        if (cur && Number(cur.rev) === 0) await q.run(`UPDATE ${entity} SET deleted = 1, sync_state = 'synced' WHERE id = ?`, [op.entity_id]);
        else await q.run(`UPDATE ${entity} SET sync_state = 'synced' WHERE id = ?`, [op.entity_id]);
      }
    });
    this.emit();
  }

  async conflicts(): Promise<LocalConflict[]> {
    const rows = await this.db.all<Record<string, string>>(`SELECT * FROM conflicts WHERE status = 'open' ORDER BY created_at DESC`);
    return rows.map((r) => ({
      id: r.id,
      entity: r.entity as Entity,
      entity_id: r.entity_id,
      local: JSON.parse(r.local_json),
      server: JSON.parse(r.server_json),
      fields: JSON.parse(r.fields),
      created_at: r.created_at,
    }));
  }

  /** Explicit owner decision for a conflict: keep this device's version or take the cloud's. */
  async resolveConflict(id: string, choice: "local" | "server") {
    this.requireLogin();
    const c = (await this.conflicts()).find((x) => x.id === id);
    if (!c) throw new RuleError("not_found", "Conflict not found");
    await this.db.tx(async (q) => {
      if (choice === "server") {
        await writeLocalRow(q, c.entity, c.server, "synced", JSON.stringify(c.server));
      } else {
        const row = { ...c.local, rev: c.server.rev, updated_at: this.now().toISOString() } as AnyRow;
        const schema = ENTITY_SCHEMAS[c.entity];
        const parsed = schema.safeParse(row);
        if (!parsed.success) throw new RuleError("validation", firstIssue(parsed.error));
        await writeLocalRow(q, c.entity, row, "pending", JSON.stringify(c.server));
        await enqueue(q, c.entity, row, this.now().toISOString());
      }
      await q.run(`UPDATE conflicts SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`, [
        choice,
        this.now().toISOString(),
        id,
      ]);
    });
    this.emit();
    this.kickSync(200);
  }

  /* ------------------------------------------------------------------ */
  /* devices                                                             */
  /* ------------------------------------------------------------------ */

  async devices(): Promise<DeviceInfo[]> {
    const api = this.api();
    if (!api) throw new AuthError("Connect to the cloud to manage devices");
    return api.devices();
  }

  async revokeDevice(id: string) {
    const api = this.api();
    if (!api) throw new AuthError("Connect to the cloud to manage devices");
    await api.revokeDevice(id);
  }

  /* ------------------------------------------------------------------ */
  /* backup / restore                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Full encrypted backup of the local database. Secrets inside are ALREADY encrypted with the
   * vault key; the whole file is additionally encrypted with the backup password (Argon2id +
   * XChaCha20-Poly1305). Restoring secrets later needs the vault passphrase or recovery key.
   */
  async exportBackup(backupPassword: string): Promise<string> {
    this.requireLogin();
    const pw = passphraseProblem(backupPassword, 12);
    if (pw) throw new RuleError("weak_passphrase", `Backup password: ${pw}`);
    const data = await this.db.read(async (q) => {
      const tables: Record<string, unknown[]> = {};
      for (const e of ENTITIES) tables[e] = await q.all(`SELECT * FROM ${e}`);
      return {
        format: BACKUP_FORMAT,
        version: 1,
        exported_at: this.now().toISOString(),
        owner: await kvGet(q, "owner"),
        vault: await kvGet(q, "vault"),
        prefs: await kvGet(q, "prefs"),
        tables,
        outbox: await q.all("SELECT op_id, entity, entity_id, payload, base_rev, attempts, status, last_error, created_at FROM outbox ORDER BY seq"),
        conflicts: await q.all("SELECT * FROM conflicts"),
      };
    });
    return encryptBackup(backupPassword, JSON.stringify(data), { kdf: this.p.kdf?.vault ?? VAULT_KDF });
  }

  /** Restore a backup, replacing local inventory data in ONE transaction (all-or-nothing). Signs out. */
  async restoreBackup(fileText: string, backupPassword: string): Promise<{ accounts: number }> {
    const json = await decryptBackup(backupPassword, fileText);
    const data = JSON.parse(json) as {
      format: string; version: number; owner: OwnerRecord; vault: VaultState | null; prefs: Prefs | null;
      tables: Record<string, Record<string, unknown>[]>; outbox: Record<string, unknown>[]; conflicts: Record<string, unknown>[];
    };
    if (data.format !== BACKUP_FORMAT || data.version !== 1 || !data.owner?.verifier)
      throw new RuleError("backup_format", "Unsupported backup content");
    // Validate every row before touching the database.
    for (const e of ENTITIES) {
      for (const raw of data.tables[e] ?? []) {
        const parsed = ENTITY_SCHEMAS[e].safeParse(fromLocal(e, raw));
        if (!parsed.success) throw new RuleError("backup_invalid", `Backup contains an invalid ${e} record: ${firstIssue(parsed.error)}`);
      }
    }
    let accounts = 0;
    await this.db.tx(async (q) => {
      for (const e of ENTITIES) {
        await q.run(`DELETE FROM ${e}`);
        for (const raw of data.tables[e] ?? []) {
          await writeLocalRow(q, e, fromLocal(e, raw), (raw.sync_state as "synced") ?? "pending", (raw.base_json as string) ?? null);
          if (e === "accounts" && !raw.deleted) accounts++;
        }
      }
      await q.run("DELETE FROM outbox");
      for (const o of data.outbox ?? [])
        await q.run(
          `INSERT INTO outbox (op_id, entity, entity_id, payload, base_rev, attempts, status, last_error, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [o.op_id, o.entity, o.entity_id, o.payload, o.base_rev, o.attempts, o.status, o.last_error, o.created_at],
        );
      await q.run("DELETE FROM conflicts");
      for (const c of data.conflicts ?? [])
        await q.run(
          `INSERT INTO conflicts (id, entity, entity_id, local_json, server_json, fields, status, resolution, created_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [c.id, c.entity, c.entity_id, c.local_json, c.server_json, c.fields, c.status, c.resolution, c.created_at, c.resolved_at],
        );
      await kvSet(q, "owner", data.owner);
      await kvSet(q, "vault", data.vault);
      if (data.prefs) await kvSet(q, "prefs", data.prefs);
      await kvSet(q, "sync_cursor", 0); // re-pull everything from the cloud after a restore
    });
    this.logout();
    return { accounts };
  }

  /** Convenience for UIs: two-step-verification context of a link. */
  static linkLabel(l: LoginLink): string {
    if (l.kind === "social") return `${l.provider ?? "social"}${l.display_name ? ` · ${l.display_name}` : ""}`;
    return `${l.kind === "phone" ? "Phone" : "Email"} · ${l.identifier ?? ""}`;
  }
}
