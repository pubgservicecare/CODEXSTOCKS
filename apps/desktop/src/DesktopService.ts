import type { AppCore } from "@codex/local-core";
import type { DataService } from "@codex/ui";
import { openBackupFile, saveBackupFile } from "./platform";

/** DataService for the desktop: everything goes through the offline-first local core. */
export function desktopService(core: AppCore, getUsername: () => string | null): DataService {
  return {
    kind: "desktop",
    username: getUsername,
    subscribe: (fn) => core.subscribe(fn),
    logout: async () => core.logout(),

    listAccounts: () => core.listAccounts(),
    bundle: (id) => core.bundle(id),
    list: (entity, where) => core.list(entity, where ?? {}),
    dashboard: () => core.dashboard(),
    audit: (id) => core.audit(id),
    exec: async (name, args) => {
      const r = await core.exec(name, args);
      core.kickSync();
      return r as never;
    },

    vaultUnlocked: () => core.vaultUnlocked,
    hasVault: async () => (await core.state()).hasVault,
    unlockVault: (p) => core.unlockVault(p),
    unlockVaultWithRecoveryKey: (k) => core.unlockVaultWithRecoveryKey(k),
    lockVault: () => core.lockVault(),
    saveSharedPassword: async (id, pw) => {
      const r = await core.saveSharedPassword(id, pw);
      core.kickSync();
      return r;
    },
    revealCredential: (c) => core.revealCredential(c),
    recordBackupCodes: async (input) => {
      const r = await core.recordBackupCodes(input);
      core.kickSync();
      return r;
    },
    revealBackupCode: (c) => core.revealBackupCode(c),

    setImage: async (id, bytes) => void (await core.setAccountImage(id, bytes)),
    removeImage: (id) => core.removeAccountImage(id),
    localImage: async (accountId) => {
      const item = await core.media.localFor(accountId);
      if (!item) return null;
      const bytes = await core.media.readLocal(item);
      if (!bytes) return null;
      return { url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: item.mime })), status: item.status, error: item.last_error };
    },

    syncStatus: () => core.syncStatus(),
    syncNow: async () => {
      const r = await core.syncNow();
      if (r.error) throw new Error(r.error);
    },
    outboxIssues: () => core.outboxIssues(),
    retryOutbox: async (seq) => {
      await core.retryOutbox(seq);
      core.kickSync(100);
    },
    discardOutbox: (seq) => core.discardOutbox(seq),
    conflicts: async () =>
      (await core.conflicts()).map((c) => ({ ...c, keepLocalLabel: "This PC", keepServerLabel: "Cloud version" })),
    resolveConflict: (id, choice) => core.resolveConflict(id, choice),

    devices: () => core.devices(),
    revokeDevice: (id) => core.revokeDevice(id),

    changeLoginPassword: (a, b) => core.changeLoginPassword(a, b),
    changeVaultPassphrase: async (auth, next) => {
      await core.changeVaultPassphrase(auth, next);
      core.kickSync(100);
    },
    rotateRecoveryKey: async (p) => {
      const k = await core.rotateRecoveryKey(p);
      core.kickSync(100);
      return k;
    },

    prefs: () => core.prefs(),
    savePrefs: (p) => core.savePrefs(p),
    exportBackup: async (password) => {
      const text = await core.exportBackup(password);
      const path = await saveBackupFile(text);
      if (!path) throw new Error("Export cancelled");
    },
    restoreBackup: async (password) => {
      const text = await openBackupFile();
      if (!text) return null;
      return core.restoreBackup(text, password);
    },
    cloudInfo: async () => {
      const s = await core.state();
      return { paired: s.paired, apiBase: s.apiBase, deviceId: s.deviceId, problem: s.cloudProblem };
    },
    pairWithCloud: (input) => core.pairWithCloud(input),
  };
}
