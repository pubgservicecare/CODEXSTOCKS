import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AppCore, type FileStore, type SqlDriver, type SqlValue } from "../src";
import { startServer, type TestServer } from "../../server/test/helpers";

export const FAST = { m: 256, t: 1, p: 1 };
export const API = "https://admin.codexstocks.org";
export const PW = "Sup3r$ecret-Owner";
export const VAULT_PW = "Vault-Passphrase-42!";

export function sqliteDriver(path: string): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async select<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params).map((r) => ({ ...r })) as T[];
    },
    close: () => db.close(),
  };
}

export function memFiles(): FileStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async write(n, b) {
      map.set(n, b);
    },
    async read(n) {
      const v = map.get(n);
      if (!v) throw new Error("missing");
      return v;
    },
    async remove(n) {
      map.delete(n);
    },
    async exists(n) {
      return map.has(n);
    },
  };
}

/** Simulated network between devices, the API server and ImageKit. */
export class Net {
  online = true;
  /** When set, the server processes the request but the response is "lost". */
  dropNextResponse = false;
  imagekitFails = 0;
  uploads: { fileName: string; bytes: number }[] = [];
  /** Simulated ExchangeRate-API: PKR per USD, or null to make the provider fail. */
  fxRate: number | null = 278.5;
  fxCalls = 0;
  deleted: string[] = [];
  constructor(public server: TestServer) {}

  fetch: typeof fetch = async (input, init) => {
    if (!this.online) throw new TypeError("fetch failed");
    const req = new Request(input as RequestInfo, init);
    const url = new URL(req.url);
    if (url.host === "upload.imagekit.io") {
      if (this.imagekitFails > 0) {
        this.imagekitFails--;
        throw new TypeError("fetch failed");
      }
      const form = await req.formData();
      const file = form.get("file") as File;
      const fileName = String(form.get("fileName"));
      this.uploads.push({ fileName, bytes: file.size });
      const fileId = "fid_" + fileName.replace(/[^a-z0-9]/gi, "").slice(0, 20);
      return Response.json({ url: `https://ik.imagekit.io/codex/codex-stocks/accounts/${fileName}`, fileId, name: fileName });
    }
    if (url.host === "open.er-api.com") {
      this.fxCalls++;
      if (this.fxRate === null) return new Response("unavailable", { status: 503 });
      const t = Math.floor(Date.now() / 1000);
      return Response.json({ result: "success", base_code: "USD", time_last_update_unix: t - 600, time_next_update_unix: t + 86000, rates: { USD: 1, PKR: this.fxRate } });
    }
    if (url.host === "api.imagekit.io") {
      this.deleted.push(url.pathname.split("/").pop()!);
      return new Response(null, { status: 204 });
    }
    const res = await this.server.api(new Request(req.url, { method: req.method, headers: req.headers, body: init?.body as BodyInit }));
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      throw new TypeError("connection reset");
    }
    return res;
  };
}

export async function world() {
  const server = await startServer({ fetchImpl: undefined });
  const net = new Net(server);
  server.cfg.fetchImpl = net.fetch;
  const dir = mkdtempSync(join(tmpdir(), "codex-test-"));
  let n = 0;
  async function device(name = `PC-${++n}`, path = join(dir, `${name}.sqlite`), files = memFiles()) {
    const driver = sqliteDriver(path);
    const core = await AppCore.open({
      driver,
      files,
      deviceName: name,
      platform: "windows",
      defaultApiBase: API,
      fetchImpl: net.fetch,
      kdf: { vault: FAST, login: FAST },
    });
    return { core, driver, path, files };
  }
  return { server, net, dir, device };
}

export const T = () => new Date().toISOString();

export function accountInput(over: Record<string, unknown> = {}) {
  return {
    title: "Conqueror S12 — Glacier M416",
    purchase_cost_minor: 1500000,
    purchase_currency: "PKR",
    list_price_minor: 2500000,
    list_currency: "PKR",
    description_public: "  Level 72   |  Conqueror x3\n\n\n- M416 Glacier (lvl 7)\n\t- X-Suit:   Golden Pharaoh\n   ",
    internal_notes: "bought from Ali",
    ...over,
  };
}

export function png(): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
}
