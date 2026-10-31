"use client";

import { ApiClient, uploadToImageKit } from "@codex/api-client";
import {
  changeVaultPassphrase,
  parseEnvelope,
  rotateRecoveryKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  wipeVaultKey,
  type VaultKey,
} from "@codex/crypto";
import { backupSetArgs, revealBackupCode, revealCredential, sharedPasswordArgs } from "@codex/local-core/secrets";
import { exportCloudBackup } from "@codex/local-core/cloud-backup";
import {
  fxStatus,
  IMAGE_EXT,
  MAX_IMAGE_BYTES,
  newId,
  sniffImageType,
  type Account,
  type AuditEvent,
  type Credential,
  type LoginLink,
} from "@codex/shared";
import type { ConflictView, DataService, Prefs, SyncSummary } from "@codex/ui";

export interface WebServiceOptions {
  /** API origin (default: this page's origin). */
  baseUrl?: string;
  /** Network override (tests). Browsers use the session cookie automatically. */
  fetchImpl?: typeof fetch;
  /** Save a downloaded file (default: browser download). */
  download?: (fileName: string, text: string) => void;
  /** Key-derivation cost override (tests only). */
  kdf?: { vault?: { m: number; t: number; p: number }; login?: { m: number; t: number; p: number } };
}

const PREFS_KEY = "codex.admin.prefs";

function browserDownload(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function readPrefs(origin: string): Prefs {
  let idle = 10;
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY);
    if (raw) idle = Number(JSON.parse(raw).idle_minutes) || 10;
  } catch {
    /* storage unavailable: defaults */
  }
  return { idle_minutes: idle, api_base: origin };
}

/**
 * DataService for admin.codexstocks.org. Talks to the same API as the desktop app using the
 * HttpOnly session cookie. The vault is unlocked IN THE BROWSER: the passphrase and decrypted
 * keys never leave this tab, and secrets are encrypted here before being sent.
 */
export function webService(username: string, opts: WebServiceOptions = {}): DataService {
  const origin = opts.baseUrl ?? window.location.origin;
  const api = new ApiClient({ baseUrl: origin, credentials: "same-origin", fetchImpl: opts.fetchImpl });
  let key: VaultKey | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const needKey = () => {
    if (!key) throw new Error("Unlock the credential vault first");
    return key;
  };
  const vault = async () => {
    const v = await api.getVault();
    if (!v) throw new Error("No credential vault exists yet. Create it from the desktop app first.");
    return v;
  };
  // Clear decrypted keys when the tab has been hidden longer than the idle-lock time.
  let hiddenAt = 0;
  globalThis.document?.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (key && Date.now() - hiddenAt > readPrefs(origin).idle_minutes * 60_000) svc.lockVault();
  });
  const cloudSummary = (c: { open_conflicts: number; active_devices: number; last_device_sync_at: string | null }): SyncSummary => ({
    phase: "cloud",
    pending: 0,
    failed: 0,
    rejected: 0,
    conflicts: c.open_conflicts,
    queuedImages: 0,
    failedImages: 0,
    lastSyncAt: c.last_device_sync_at,
    lastError: null,
    cloud: c,
  });

  const svc: DataService = {
    kind: "web",
    username: () => username,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async logout() {
      svc.lockVault();
      await api.logout().catch(() => undefined);
      if (globalThis.window?.location && !opts.fetchImpl) window.location.href = "/";
    },

    async listAccounts() {
      const [accounts, links] = await Promise.all([api.list<Account>("accounts"), api.list<LoginLink>("login_links")]);
      const counts = new Map<string, number>();
      for (const l of links) counts.set(l.account_id, (counts.get(l.account_id) ?? 0) + 1);
      return accounts.map((a) => ({ ...a, link_count: counts.get(a.id) ?? 0 }));
    },
    bundle: (id) => api.bundle(id).catch((e) => (e.status === 404 ? null : Promise.reject(e))),
    list: (entity, where) => api.list(entity, where ?? {}) as never,
    async dashboard() {
      const d = await api.dashboard();
      return { report: d.report, sync: cloudSummary(d.sync) };
    },
    audit: (id) => api.audit(id) as Promise<AuditEvent[]>,
    async exec(name, args) {
      const r = await api.command(name, args);
      emit();
      return r as never;
    },

    async fx() {
      const { quote } = await api.fx().catch(() => ({ quote: null }));
      return quote ? { ...quote, status: fxStatus(quote, new Date()) } : null;
    },

    vaultUnlocked: () => !!key,
    hasVault: async () => !!(await api.getVault()),
    async unlockVault(p) {
      const k = await unlockWithPassphrase(parseEnvelope((await vault()).envelope), p);
      wipeVaultKey(key);
      key = k;
      emit();
    },
    async unlockVaultWithRecoveryKey(rk) {
      const k = unlockWithRecoveryKey(parseEnvelope((await vault()).envelope), rk);
      wipeVaultKey(key);
      key = k;
      emit();
    },
    lockVault() {
      wipeVaultKey(key);
      key = null;
      emit();
    },
    async saveSharedPassword(accountId, plaintext) {
      const k = needKey();
      const existing = (await api.list<Credential>("credentials", { account_id: accountId }))[0] ?? null;
      return svc.exec("saveSharedPassword", sharedPasswordArgs(k, accountId, existing, plaintext));
    },
    revealCredential: (c) => revealCredential(needKey(), c),
    recordBackupCodes: (input) => svc.exec("recordBackupSet", backupSetArgs(needKey(), input)),
    revealBackupCode: (c) => revealBackupCode(needKey(), c),

    async setImage(accountId, bytes) {
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Image is too large (max 8 MB)");
      const mime = sniffImageType(bytes);
      if (!mime) throw new Error("Only JPEG, PNG or WebP images are supported");
      const before = await api.get<Account>("accounts", accountId);
      const auth = await api.imagekitAuth();
      const up = await uploadToImageKit(auth, { bytes, fileName: `${newId()}.${IMAGE_EXT[mime]}`, mime }, opts.fetchImpl);
      await svc.exec("setAccountImage", { id: accountId, image_url: up.url, image_file_id: up.fileId });
      if (before.image_file_id && before.image_file_id !== up.fileId) await api.deleteMedia(before.image_file_id).catch(() => undefined);
    },
    async removeImage(accountId) {
      const before = await api.get<Account>("accounts", accountId);
      await svc.exec("setAccountImage", { id: accountId, image_url: null, image_file_id: null });
      if (before.image_file_id) await api.deleteMedia(before.image_file_id).catch(() => undefined);
    },

    async conflicts(): Promise<ConflictView[]> {
      return (await api.conflicts()).map((c) => ({
        id: c.id,
        entity: c.entity,
        entity_id: c.entity_id,
        local: c.client_row,
        server: c.server_row,
        fields: [],
        created_at: c.created_at,
        keepLocalLabel: "Device's version",
        keepServerLabel: "Current cloud version",
      }));
    },
    async resolveConflict(id, choice) {
      await api.resolveConflict(id, choice === "local" ? "apply_client" : "keep_server");
      emit();
    },

    syncStatus: async () => cloudSummary(await api.syncStatus()),

    async prefs() {
      return readPrefs(origin);
    },
    async savePrefs(p) {
      const idle = p.idle_minutes ?? readPrefs(origin).idle_minutes;
      if (!(idle >= 1 && idle <= 240)) throw new Error("Idle lock must be 1–240 minutes");
      globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify({ idle_minutes: idle }));
      emit();
    },

    async exportBackup(password, o) {
      const { fileText } = await exportCloudBackup(api, {
        username,
        backupPassword: password,
        loginPassword: o?.loginPassword ?? "",
        kdf: opts.kdf,
      });
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      (opts.download ?? browserDownload)(`codex-stocks-cloud-backup-${stamp}.cxbackup`, fileText);
    },

    devices: () => api.devices(),
    revokeDevice: async (id) => void (await api.revokeDevice(id)),

    changeLoginPassword: async (a, b) => void (await api.changePassword(a, b)),
    async changeVaultPassphrase(auth, next) {
      const v = await vault();
      const env = await changeVaultPassphrase(parseEnvelope(v.envelope), auth, next, { kdf: opts.kdf?.vault });
      await api.putVault(JSON.stringify(env), v.version);
    },
    async rotateRecoveryKey(passphrase) {
      const v = await vault();
      const r = await rotateRecoveryKey(parseEnvelope(v.envelope), passphrase);
      await api.putVault(JSON.stringify(r.envelope), v.version);
      return r.recoveryKey;
    },
  };
  return svc;
}
