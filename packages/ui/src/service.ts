import type {
  Account,
  AccountBundle,
  AnyRow,
  AuditEvent,
  BackupCode,
  CommandName,
  Credential,
  DeviceInfo,
  Entity,
  EntityRowMap,
  FinancialReport,
  FxQuote,
} from "@codex/shared";

export type AccountListItem = Account & { link_count: number; sync_state?: string };

export interface SyncSummary {
  phase: string;
  pending: number;
  failed: number;
  rejected: number;
  conflicts: number;
  queuedImages: number;
  failedImages: number;
  lastSyncAt: string | null;
  lastError: string | null;
  vaultMismatch?: boolean;
  notice?: string | null;
  /** Cloud-side view (admin website): open conflicts, enrolled devices and their latest sync. */
  cloud?: { open_conflicts: number; active_devices: number; last_device_sync_at: string | null };
}

export interface ConflictView {
  id: string;
  entity: Entity;
  entity_id: string;
  local: AnyRow | null;
  server: AnyRow | null;
  fields: string[];
  created_at: string;
  /** Labels for the two resolution buttons. */
  keepLocalLabel: string;
  keepServerLabel: string;
}

export interface OutboxIssueView {
  seq: number;
  entity: string;
  entity_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface Prefs {
  idle_minutes: number;
  api_base: string;
}

/**
 * Everything the admin UI needs. Implemented by the desktop app (local SQLite, offline-first)
 * and by the admin website (cloud API + in-browser vault).
 */
export interface DataService {
  kind: "desktop" | "web";
  username(): string | null;
  subscribe(fn: () => void): () => void;
  logout(): Promise<void>;

  listAccounts(): Promise<AccountListItem[]>;
  bundle(id: string): Promise<AccountBundle | null>;
  list<E extends Entity>(entity: E, where?: Record<string, string>): Promise<EntityRowMap[E][]>;
  dashboard(): Promise<{ report: FinancialReport; sync: SyncSummary | null }>;
  /** Newest audit events, or every event concerning one account when `accountId` is given. */
  audit(accountId?: string): Promise<AuditEvent[]>;
  exec<T = unknown>(name: CommandName, args: unknown): Promise<T>;
  /** Latest USD/PKR reference quote (desktop: cached for offline use), or null if none is available. */
  fx(): Promise<FxQuote | null>;

  vaultUnlocked(): boolean;
  hasVault(): Promise<boolean>;
  unlockVault(passphrase: string): Promise<void>;
  unlockVaultWithRecoveryKey(key: string): Promise<void>;
  lockVault(): void;
  saveSharedPassword(accountId: string, plaintext: string): Promise<unknown>;
  revealCredential(c: Credential): string;
  recordBackupCodes(input: { accountId: string; linkId: string | null; label: string; codes: string[] }): Promise<unknown>;
  revealBackupCode(c: BackupCode): string;

  setImage(accountId: string, bytes: Uint8Array): Promise<void>;
  removeImage(accountId: string): Promise<void>;
  /** Object URL of a local (queued/cached) image, desktop only. */
  localImage?(accountId: string): Promise<{ url: string; status: string; error: string | null } | null>;
  /** Retry a failed queued upload now instead of waiting for the automatic retry (desktop only). */
  retryImage?(accountId: string): Promise<void>;

  syncStatus?(): Promise<SyncSummary>;
  syncNow?(): Promise<void>;
  outboxIssues?(): Promise<OutboxIssueView[]>;
  retryOutbox?(seq: number): Promise<void>;
  discardOutbox?(seq: number): Promise<void>;
  conflicts(): Promise<ConflictView[]>;
  resolveConflict(id: string, choice: "local" | "server"): Promise<void>;

  devices(): Promise<DeviceInfo[]>;
  revokeDevice(id: string): Promise<void>;

  changeLoginPassword(current: string, next: string): Promise<void>;
  changeVaultPassphrase(auth: { passphrase?: string; recoveryKey?: string }, next: string): Promise<void>;
  rotateRecoveryKey(passphrase: string): Promise<string>;

  prefs?(): Promise<Prefs>;
  savePrefs?(p: Partial<Prefs>): Promise<void>;
  /** Encrypted backup. The website also needs the login password to use after restoring on a PC. */
  exportBackup?(password: string, opts?: { loginPassword?: string }): Promise<void>;
  restoreBackup?(password: string): Promise<{ accounts: number } | null>;
  cloudInfo?(): Promise<{ paired: boolean; apiBase: string; deviceId: string | null; problem: string | null }>;
  pairWithCloud?(input: { apiBase: string; username: string; password: string; setupToken?: string; cloudVaultPassphrase?: string }): Promise<void>;
}
