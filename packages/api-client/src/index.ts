import type {
  AccountBundle,
  AnyRow,
  CommandName,
  DeviceInfo,
  Entity,
  FinancialReport,
  ImageKitAuth,
  OpResult,
  PublicListing,
  PublicSettings,
  PullResponse,
  ServerConflict,
  SessionInfo,
  SyncOp,
  VaultRecord,
} from "@codex/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Network failures and 5xx/429 are worth retrying; 4xx are not. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** "include" for the same-origin admin website (cookie session). */
  credentials?: RequestCredentials;
}

export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  get baseUrl() {
    return this.opts.baseUrl.replace(/\/$/, "");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = this.opts.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        credentials: this.opts.credentials,
      });
    } catch (e) {
      throw new ApiError(0, "network", (e as Error)?.name === "AbortError" ? "Request timed out" : "Cannot reach the server");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status || 502, "bad_response", "The server returned an unexpected response");
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } })?.error;
      throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, data);
    }
    return data as T;
  }

  /* auth */
  health() {
    return this.request<{ ok: boolean }>("GET", "/health");
  }
  authStatus() {
    return this.request<{ owner_exists: boolean; setup_enabled: boolean }>("GET", "/auth/status");
  }
  setup(body: { setup_token: string; username: string; password: string; client: "web" | "desktop"; device?: { id?: string; name: string; platform: string } }) {
    return this.request<{ token: string; device_id: string; expires_at: string }>("POST", "/auth/setup", body);
  }
  login(body: { username: string; password: string; client: "web" | "desktop"; device?: { id?: string; name: string; platform: string } }) {
    return this.request<{ token?: string; device_id?: string; expires_at: string }>("POST", "/auth/login", body);
  }
  logout() {
    return this.request<{ ok: true }>("POST", "/auth/logout", {});
  }
  me() {
    return this.request<SessionInfo>("GET", "/auth/me");
  }
  changePassword(current: string, next: string) {
    return this.request<{ ok: true }>("POST", "/auth/change-password", { current, next });
  }
  devices() {
    return this.request<DeviceInfo[]>("GET", "/devices");
  }
  revokeDevice(id: string) {
    return this.request<{ ok: true }>("POST", `/devices/${encodeURIComponent(id)}/revoke`, {});
  }

  /* vault */
  getVault() {
    return this.request<VaultRecord | null>("GET", "/vault");
  }
  putVault(envelope: string, base_version: number) {
    return this.request<VaultRecord>("PUT", "/vault", { envelope, base_version });
  }

  /* sync */
  push(ops: SyncOp[]) {
    return this.request<{ results: OpResult[] }>("POST", "/sync/push", { ops });
  }
  pull(since: number, limit = 500) {
    return this.request<PullResponse>("GET", `/sync/pull?since=${since}&limit=${limit}`);
  }

  /* admin */
  list<T extends AnyRow = AnyRow>(entity: Entity, where: Record<string, string> = {}) {
    const q = new URLSearchParams(where).toString();
    return this.request<T[]>("GET", `/admin/entities/${entity}${q ? "?" + q : ""}`);
  }
  get<T extends AnyRow = AnyRow>(entity: Entity, id: string) {
    return this.request<T>("GET", `/admin/entities/${entity}/${encodeURIComponent(id)}`);
  }
  bundle(id: string) {
    return this.request<AccountBundle>("GET", `/admin/accounts/${encodeURIComponent(id)}/bundle`);
  }
  command<T = unknown>(name: CommandName, args: unknown) {
    return this.request<{ ok: true; result: T }>("POST", `/admin/commands/${name}`, args).then((r) => r.result);
  }
  dashboard() {
    return this.request<{
      report: FinancialReport;
      sync: { open_conflicts: number; active_devices: number; last_device_sync_at: string | null };
    }>("GET", "/admin/dashboard");
  }
  /** Newest audit events, or all events concerning one account. */
  audit(accountId?: string) {
    return this.request<AnyRow[]>("GET", `/admin/audit${accountId ? "?account_id=" + encodeURIComponent(accountId) : ""}`);
  }
  syncStatus() {
    return this.request<{ open_conflicts: number; active_devices: number; last_device_sync_at: string | null }>("GET", "/admin/sync-status");
  }
  conflicts() {
    return this.request<ServerConflict[]>("GET", "/admin/conflicts");
  }
  resolveConflict(id: string, resolution: "keep_server" | "apply_client") {
    return this.request<{ ok: true }>("POST", `/admin/conflicts/${encodeURIComponent(id)}/resolve`, { resolution });
  }

  /* media */
  imagekitAuth() {
    return this.request<ImageKitAuth>("POST", "/media/imagekit-auth", {});
  }
  deleteMedia(fileId: string) {
    return this.request<{ ok: true }>("DELETE", `/media/files/${encodeURIComponent(fileId)}`);
  }

  /* public */
  publicListings(params: { q?: string; currency?: string; sort?: string } = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return this.request<PublicListing[]>("GET", `/public/listings${q ? "?" + q : ""}`);
  }
  publicListing(id: string) {
    return this.request<PublicListing>("GET", `/public/listings/${encodeURIComponent(id)}`);
  }
  publicSettings() {
    return this.request<PublicSettings>("GET", "/public/settings");
  }
}

/** Upload a file to ImageKit using server-issued signature parameters. */
export async function uploadToImageKit(
  auth: ImageKitAuth,
  file: { bytes: Uint8Array; fileName: string; mime: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; fileId: string }> {
  const form = new FormData();
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.mime }), file.fileName);
  form.append("fileName", file.fileName);
  form.append("publicKey", auth.public_key);
  form.append("signature", auth.signature);
  form.append("expire", String(auth.expire));
  form.append("token", auth.token);
  form.append("folder", auth.folder);
  // Deterministic name + overwrite => a retried upload replaces the same file instead of creating duplicates.
  form.append("useUniqueFileName", "false");
  form.append("overwriteFile", "true");
  let res: Response;
  try {
    res = await fetchImpl("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body: form });
  } catch {
    throw new ApiError(0, "network", "Cannot reach ImageKit");
  }
  const data = (await res.json().catch(() => null)) as { url?: string; fileId?: string; message?: string } | null;
  if (!res.ok || !data?.url || !data?.fileId)
    throw new ApiError(res.status || 502, "imagekit_upload", data?.message ?? `Image upload failed (${res.status})`);
  return { url: data.url, fileId: data.fileId };
}
