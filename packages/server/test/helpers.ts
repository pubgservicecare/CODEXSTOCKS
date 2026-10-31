import { createApi, createPgliteDb, migrate, type ApiConfig, type Db } from "../src";

export const SETUP_TOKEN = "test-setup-token-0123456789";
export const OWNER = { username: "owner", password: "Sup3r$ecret-Owner" };
export const FAST_PW = { logN: 10, r: 8, p: 1, keyLen: 32 };

export interface TestServer {
  db: Db;
  api: (req: Request) => Promise<Response>;
  cfg: ApiConfig;
  call: (method: string, path: string, opts?: { body?: unknown; token?: string; cookie?: string; origin?: string; headers?: Record<string, string> }) => Promise<{ status: number; json: any; headers: Headers }>;
  fetch: typeof fetch;
}

export async function startServer(over: Partial<ApiConfig> = {}): Promise<TestServer> {
  const db = await createPgliteDb();
  await migrate(db);
  const cfg: ApiConfig = {
    db,
    setupToken: SETUP_TOKEN,
    corsOrigins: ["http://tauri.localhost"],
    adminOrigins: ["https://admin.codexstocks.org"],
    cookieSecure: true,
    passwordParams: FAST_PW,
    imagekit: {
      publicKey: "public_test_key",
      privateKey: "private_test_key_never_exposed",
      urlEndpoint: "https://ik.imagekit.io/codex/",
      folder: "/codex-stocks/accounts",
    },
    log: () => undefined,
    // No real exchange-rate provider calls in tests; FX tests enable it with a mocked provider.
    fx: { disabled: true },
    ...over,
  };
  const api = createApi(cfg);
  const call: TestServer["call"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.origin) headers.origin = opts.origin;
    const res = await api(
      new Request(`https://admin.codexstocks.org/api/v1${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => api(new Request(input, init))) as typeof fetch;
  return { db, api, cfg, call, fetch: fetchImpl };
}

export async function setupOwner(s: TestServer, deviceName = "PC-1"): Promise<{ token: string; device_id: string }> {
  const r = await s.call("POST", "/auth/setup", {
    body: { setup_token: SETUP_TOKEN, ...OWNER, client: "desktop", device: { name: deviceName, platform: "windows" } },
  });
  if (r.status !== 200) throw new Error(`setup failed ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

export async function loginDevice(s: TestServer, deviceName: string) {
  const r = await s.call("POST", "/auth/login", {
    body: { ...OWNER, client: "desktop", device: { name: deviceName, platform: "windows" } },
  });
  if (r.status !== 200) throw new Error(`login failed ${r.status}`);
  return r.json as { token: string; device_id: string };
}
