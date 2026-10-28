import type { ApiClient } from "@codex/api-client";
import { createLoginVerifier, encryptBackup, passphraseProblem, wipe, LOGIN_KDF, VAULT_KDF } from "@codex/crypto";
import { ENTITIES, type AnyRow } from "@codex/shared";

type Kdf = { m: number; t: number; p: number };

/**
 * Build an encrypted backup of the CLOUD inventory (used by admin.codexstocks.org).
 * The file has exactly the desktop backup format, so it can be restored in the desktop app
 * ("Restore from an encrypted backup file"). Secrets stay vault-encrypted inside it.
 *
 * `loginPassword` becomes the password for signing in on the PC where the file is restored
 * (the browser has no offline login verifier of its own).
 */
export async function exportCloudBackup(
  api: ApiClient,
  opts: { username: string; backupPassword: string; loginPassword: string; now?: Date; kdf?: { vault?: Kdf; login?: Kdf } },
): Promise<{ fileText: string; accounts: number }> {
  const bp = passphraseProblem(opts.backupPassword, 12);
  if (bp) throw new Error(`Backup password: ${bp}`);
  if (!opts.loginPassword) throw new Error("Enter the login password to use after restoring");
  const tables: Record<string, Record<string, unknown>[]> = {};
  let accounts = 0;
  for (const e of ENTITIES) {
    const rows = await api.list<AnyRow>(e, { include_deleted: "1" });
    tables[e] = rows.map((r) => ({ ...r, sync_state: "synced", base_json: JSON.stringify(r) }));
    if (e === "accounts") accounts = rows.filter((r) => !r.deleted).length;
  }
  const vault = await api.getVault();
  const { record, localKey } = await createLoginVerifier(opts.loginPassword, opts.kdf?.login ?? LOGIN_KDF);
  wipe(localKey);
  const now = (opts.now ?? new Date()).toISOString();
  const data = {
    format: "codex-stocks-data",
    version: 1,
    exported_at: now,
    source: "cloud",
    owner: { username: opts.username.toLowerCase(), verifier: record, created_at: now },
    vault: vault ? { envelope: vault.envelope, vault_id: vault.vault_id, version: vault.version, dirty: false } : null,
    prefs: null,
    tables,
    outbox: [],
    conflicts: [],
  };
  return { fileText: await encryptBackup(opts.backupPassword, JSON.stringify(data), { kdf: opts.kdf?.vault ?? VAULT_KDF }), accounts };
}
