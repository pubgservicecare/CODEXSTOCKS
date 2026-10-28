import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { FileStore, SqlDriver, SqlValue } from "@codex/local-core";

/** SQLite via the Rust shell (one connection; calls are serialized by LocalDb). */
export const tauriDriver: SqlDriver = {
  execute: (sql: string, params: SqlValue[] = []) => invoke<{ changes: number }>("db_execute", { sql, params }),
  select: <T,>(sql: string, params: SqlValue[] = []) => invoke<T[]>("db_select", { sql, params }),
};

/** Image files in %APPDATA%\org.codexstocks.desktop\media. */
export const tauriFiles: FileStore = {
  async write(name, bytes) {
    await invoke("media_write", bytes, { headers: { "x-name": name } });
  },
  async read(name) {
    const buf = await invoke<ArrayBuffer>("media_read", { name });
    return new Uint8Array(buf);
  },
  async remove(name) {
    await invoke("media_remove", { name });
  },
  async exists(name) {
    return invoke<boolean>("media_exists", { name });
  },
};

export interface AppInfo {
  device_name: string;
  data_dir: string;
  version: string;
}

export const appInfo = () => invoke<AppInfo>("app_info");

export async function saveBackupFile(contents: string): Promise<string | null> {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const path = await save({
    title: "Save encrypted backup",
    defaultPath: `codex-stocks-backup-${stamp}.cxbackup`,
    filters: [{ name: "CODE X STOCKS backup", extensions: ["cxbackup"] }],
  });
  if (!path) return null;
  await invoke("backup_save", { path, contents });
  return path;
}

export async function openBackupFile(): Promise<string | null> {
  const path = await open({
    title: "Choose backup to restore",
    multiple: false,
    directory: false,
    filters: [{ name: "CODE X STOCKS backup", extensions: ["cxbackup"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return invoke<string>("backup_read", { path });
}
