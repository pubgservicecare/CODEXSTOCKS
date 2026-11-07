import { describe, expect, it } from "vitest";
import { batchingFetch } from "../app/admin/batchFetch";

const ORIGIN = "https://admin.codexstocks.org";

/** A fake server that records what it receives and answers like the real API (batch endpoint optional). */
function fakeServer(opts: { batch?: boolean; batchStatus?: number } = {}) {
  const seen: string[] = [];
  const inBatches: string[] = [];
  const answer = (path: string) => ({ status: path.includes("missing") ? 404 : 200, body: JSON.stringify({ path }) });
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    seen.push(`${method} ${url.replace(ORIGIN + "/api/v1", "")}`);
    if (url.endsWith("/api/v1/admin/batch")) {
      if (opts.batchStatus) return new Response(JSON.stringify({ error: { code: "x", message: "x" } }), { status: opts.batchStatus });
      if (opts.batch === false) return new Response("{}", { status: 404 });
      const { requests } = JSON.parse(String(init!.body)) as { requests: string[] };
      inBatches.push(...requests);
      return new Response(JSON.stringify({ responses: requests.map(answer) }), { status: 200 });
    }
    const a = answer(url.replace(ORIGIN + "/api/v1", ""));
    return new Response(a.body, { status: a.status });
  }) as typeof fetch;
  return { base, seen, inBatches };
}

const get = (f: typeof fetch, path: string) => f(`${ORIGIN}/api/v1${path}`, { credentials: "same-origin" });

describe("admin website network layer (batchFetch)", () => {
  it("sends reads made at the same moment as one batch; each caller gets its own status and body", async () => {
    const srv = fakeServer();
    const f = batchingFetch(srv.base, ORIGIN);
    const [a, b, c] = await Promise.all([get(f, "/admin/dashboard"), get(f, "/admin/entities/sales"), get(f, "/admin/entities/missing")]);
    expect(srv.seen).toEqual(["POST /admin/batch"]);
    expect(await a.json()).toEqual({ path: "/admin/dashboard" });
    expect(await b.json()).toEqual({ path: "/admin/entities/sales" });
    expect(c.status).toBe(404);
  });

  it("shares one request between identical reads in flight, and keeps /fx a plain (CDN-cached) GET", async () => {
    const srv = fakeServer();
    const f = batchingFetch(srv.base, ORIGIN);
    const r = await Promise.all([get(f, "/fx"), get(f, "/fx"), get(f, "/admin/audit"), get(f, "/admin/audit")]);
    expect(srv.seen.sort()).toEqual(["GET /admin/audit", "GET /fx"]);
    for (const x of r) expect(x.status).toBe(200);
  });

  it("never batches or shares writes, and a write ends sharing of reads that started before it", async () => {
    const srv = fakeServer();
    const f = batchingFetch(srv.base, ORIGIN);
    const before = get(f, "/admin/entities/accounts");
    await f(`${ORIGIN}/api/v1/admin/commands/saveSetting`, { method: "POST", body: "{}" });
    const after = get(f, "/admin/entities/accounts");
    await Promise.all([before, after]);
    // Sent twice (inside one batch or separately), never shared.
    const sent = [...srv.seen.filter((x) => x === "GET /admin/entities/accounts"), ...srv.inBatches.filter((x) => x === "/admin/entities/accounts")];
    expect(sent).toHaveLength(2);
    expect(srv.seen).toContain("POST /admin/commands/saveSetting");
  });

  it("falls back to separate requests when the server has no batch endpoint", async () => {
    const srv = fakeServer({ batch: false });
    const f = batchingFetch(srv.base, ORIGIN);
    const r = await Promise.all([get(f, "/admin/dashboard"), get(f, "/admin/entities/sales")]);
    expect(await r[1].json()).toEqual({ path: "/admin/entities/sales" });
    expect(srv.seen).toEqual(["POST /admin/batch", "GET /admin/dashboard", "GET /admin/entities/sales"]);
    await Promise.all([get(f, "/admin/a"), get(f, "/admin/b")]);
    expect(srv.seen.filter((x) => x.startsWith("POST"))).toHaveLength(1); // not retried in this session
  });

  it("gives every read the batch's error status (e.g. signed out) so the app reacts as before", async () => {
    const srv = fakeServer({ batchStatus: 401 });
    const f = batchingFetch(srv.base, ORIGIN);
    const r = await Promise.all([get(f, "/admin/dashboard"), get(f, "/admin/entities/sales")]);
    expect(r.map((x) => x.status)).toEqual([401, 401]);
  });

  it("reports a network failure to every waiting read", async () => {
    const f = batchingFetch((async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch, ORIGIN);
    const r = await Promise.allSettled([get(f, "/admin/dashboard"), get(f, "/admin/entities/sales")]);
    expect(r.map((x) => x.status)).toEqual(["rejected", "rejected"]);
  });
});
