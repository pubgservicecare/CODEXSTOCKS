import { beforeEach, describe, expect, it } from "vitest";
import { newId } from "@codex/shared";
import { OWNER, setupOwner, startServer, type TestServer } from "./helpers";

let s: TestServer;
let token: string;

beforeEach(async () => {
  s = await startServer();
  token = (await setupOwner(s)).token;
  const r = await s.call("POST", "/admin/commands/createAccount", {
    token,
    body: {
      id: newId(),
      account: { title: "Batch test account", purchase_cost_minor: 100, purchase_currency: "PKR", list_price_minor: 200, list_currency: "PKR", description_public: "x" },
      links: [{ kind: "email", identifier: "a@example.com" }],
    },
  });
  expect(r.status).toBe(200);
});

describe("POST /admin/batch (several admin reads in one request)", () => {
  it("returns exactly what each separate GET returns, in order", async () => {
    const paths = ["/admin/entities/accounts", "/admin/dashboard", "/admin/sync-status", "/admin/entities/login_links?account_id=" + newId()];
    const batch = await s.call("POST", "/admin/batch", { token, body: { requests: paths } });
    expect(batch.status).toBe(200);
    expect(batch.json.responses).toHaveLength(paths.length);
    for (const [i, p] of paths.entries()) {
      const single = await s.call("GET", p, { token });
      expect(batch.json.responses[i].status).toBe(single.status);
      expect(JSON.parse(batch.json.responses[i].body)).toEqual(single.json);
    }
  });

  it("needs a session, and checks the CSRF origin for cookie sessions like any other POST", async () => {
    expect((await s.call("POST", "/admin/batch", { body: { requests: ["/admin/dashboard"] } })).status).toBe(401);
    const login = await s.call("POST", "/auth/login", { body: { ...OWNER, client: "web" } });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    expect((await s.call("POST", "/admin/batch", { cookie, body: { requests: ["/admin/dashboard"] } })).status).toBe(403);
    const ok = await s.call("POST", "/admin/batch", { cookie, origin: "https://admin.codexstocks.org", body: { requests: ["/admin/dashboard"] } });
    expect(ok.status).toBe(200);
    expect(ok.json.responses[0].status).toBe(200);
  });

  it("only runs read-only admin routes: no writes, public/login routes, other hosts or nested batches", async () => {
    const r = await s.call("POST", "/admin/batch", {
      token,
      body: { requests: ["/admin/commands/saveSetting", "/admin/batch", "/auth/me", "/fx", "//evil.example/api/v1/admin/dashboard", "/admin/nope", "/admin/entities/not_an_entity"] },
    });
    expect(r.status).toBe(200);
    const statuses = r.json.responses.map((x: { status: number }) => x.status);
    expect(statuses.slice(0, 6)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(statuses[6]).toBeGreaterThanOrEqual(400); // the route's own validation error, as a separate GET would get
  });

  it("a malformed item fails on its own; the other items still answer", async () => {
    const r = await s.call("POST", "/admin/batch", { token, body: { requests: ["/admin/accounts/%E0%A4%A/bundle", "/admin/sync-status"] } });
    expect(r.status).toBe(200);
    expect(r.json.responses.map((x: { status: number }) => x.status)).toEqual([400, 200]);
  });

  it("limits the size of a batch", async () => {
    const many = Array.from({ length: 21 }, () => "/admin/sync-status");
    expect((await s.call("POST", "/admin/batch", { token, body: { requests: many } })).status).toBe(400);
    expect((await s.call("POST", "/admin/batch", { token, body: { requests: [] } })).status).toBe(400);
  });
});
