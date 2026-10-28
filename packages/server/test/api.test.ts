import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { newId, PUBLIC_LISTING_KEYS } from "@codex/shared";
import { migrate, migrationStatus } from "../src";
import { loginDevice, OWNER, SETUP_TOKEN, setupOwner, startServer, type TestServer } from "./helpers";

const T = () => new Date().toISOString();
const FAKE_CT = (tag: string) => "cx1." + Buffer.from(`ciphertext-${tag}-`.repeat(4)).toString("base64url");

function accountRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, rev: 0, deleted: false, created_at: T(), updated_at: T(), title: "Glacier M416 account", status: "available",
    published: false, purchase_cost_minor: 1500000, purchase_currency: "PKR", purchased_at: "2026-01-02",
    purchase_reference: "PURCHASE-REF-SECRET", list_price_minor: 2500000, list_currency: "PKR",
    description_public: "Line one\n\n  two  spaces\tTab", youtube_url: null, image_url: null, image_file_id: null,
    old_owner_name: "PRIVATE-OLD-OWNER", old_owner_whatsapp: "+923009998877", show_old_owner_public: false,
    internal_notes: "PRIVATE-INTERNAL-NOTE", ...over,
  };
}

function linkRow(id: string, account_id: string, kind: "social" | "phone" | "email", over: Record<string, unknown> = {}) {
  return {
    id, rev: 0, deleted: false, created_at: T(), updated_at: T(), account_id, kind,
    provider: kind === "social" ? "google" : null,
    identifier: kind === "email" ? "private-login@example.com" : kind === "phone" ? "+923001234567" : "PRIVATE-SOCIAL-HANDLE",
    display_name: "PRIVATE-DISPLAY", owner_name: "PRIVATE-LINK-OWNER", owner_contact: "+923331112222",
    owner_notes: "PRIVATE-LINK-NOTES", status: "active", credential_id: null, two_step_enabled: false,
    two_step_method: "none", two_step_destination: null, two_step_accessible: null, recovery_info: "PRIVATE-RECOVERY", ...over,
  };
}

let s: TestServer;
let token: string;

beforeAll(async () => {
  s = await startServer();
  ({ token } = await setupOwner(s));
});

describe("migrations", () => {
  it("are recorded and re-running is a no-op", async () => {
    expect(await migrate(s.db)).toEqual([]);
    expect((await migrationStatus(s.db)).pending).toEqual([]);
  });
  it("refuse destructive statements", async () => {
    await expect(migrate(s.db, [{ id: "9999_bad", sql: "DROP TABLE accounts" }])).rejects.toThrow(/destructive/);
  });
});

describe("owner setup and login", () => {
  it("never creates a second owner", async () => {
    const r = await s.call("POST", "/auth/setup", {
      body: { setup_token: SETUP_TOKEN, username: "attacker", password: "An0ther$trongPass", client: "web" },
    });
    expect(r.status).toBe(409);
  });
  it("requires the setup token", async () => {
    const fresh = await startServer();
    const r = await fresh.call("POST", "/auth/setup", {
      body: { setup_token: "wrong-token-wrong-token", ...OWNER, client: "web" },
    });
    expect(r.status).toBe(403);
    const off = await startServer({ setupToken: undefined });
    expect((await off.call("POST", "/auth/setup", { body: { setup_token: "x", ...OWNER, client: "web" } })).status).toBe(403);
  });
  it("rejects wrong passwords and throttles brute force", async () => {
    const fresh = await startServer();
    await setupOwner(fresh);
    for (let i = 0; i < 8; i++) {
      const r = await fresh.call("POST", "/auth/login", { body: { username: "owner", password: "wrong", client: "web" } });
      expect(r.status).toBe(401);
    }
    const blocked = await fresh.call("POST", "/auth/login", { body: { ...OWNER, client: "web" } });
    expect(blocked.status).toBe(429);
  });
  it("web login sets a secure HttpOnly SameSite=Strict cookie", async () => {
    const r = await s.call("POST", "/auth/login", { body: { ...OWNER, client: "web" } });
    expect(r.status).toBe(200);
    const c = r.headers.get("set-cookie")!;
    expect(c).toMatch(/^__Host-cx_admin=/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Secure/);
    expect(JSON.stringify(r.json)).not.toContain(c.split(";")[0].split("=")[1]);
  });
});

describe("access control", () => {
  const privateRoutes: [string, string][] = [
    ["GET", "/auth/me"], ["GET", "/devices"], ["GET", "/vault"], ["PUT", "/vault"], ["POST", "/sync/push"],
    ["GET", "/sync/pull?since=0"], ["GET", "/admin/entities/credentials"], ["GET", "/admin/entities/backup_codes"],
    ["GET", "/admin/entities/accounts"], ["GET", "/admin/dashboard"], ["POST", "/admin/commands/createAccount"],
    ["GET", "/admin/conflicts"], ["POST", "/media/imagekit-auth"], ["DELETE", "/media/files/abc"], ["GET", "/admin/audit"],
  ];
  it("every private endpoint rejects anonymous and bogus tokens", async () => {
    for (const [m, p] of privateRoutes) {
      expect((await s.call(m, p, { body: m === "GET" ? undefined : {} })).status, `${m} ${p}`).toBe(401);
      expect((await s.call(m, p, { token: "x".repeat(43), body: m === "GET" ? undefined : {} })).status, `${m} ${p}`).toBe(401);
    }
  });
  it("cookie sessions require the admin origin for writes (CSRF)", async () => {
    const login = await s.call("POST", "/auth/login", { body: { ...OWNER, client: "web" } });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    expect((await s.call("GET", "/auth/me", { cookie })).status).toBe(200);
    expect((await s.call("POST", "/admin/commands/saveSetting", { cookie, body: { key: "store_name", value: "X" } })).status).toBe(403);
    expect(
      (await s.call("POST", "/admin/commands/saveSetting", { cookie, origin: "https://evil.example", body: { key: "store_name", value: "X" } })).status,
    ).toBe(403);
    expect(
      (await s.call("POST", "/admin/commands/saveSetting", { cookie, origin: "https://admin.codexstocks.org", body: { key: "store_name", value: "CODE X STOCKS" } })).status,
    ).toBe(200);
  });
  it("revoked devices lose access immediately", async () => {
    const d = await loginDevice(s, "Stolen laptop");
    expect((await s.call("GET", "/auth/me", { token: d.token })).status).toBe(200);
    expect((await s.call("POST", `/devices/${d.device_id}/revoke`, { token })).status).toBe(200);
    expect((await s.call("GET", "/auth/me", { token: d.token })).status).toBe(401);
  });
  it("CORS is only granted to the desktop WebView origin", async () => {
    const ok = await s.api(new Request("https://admin.codexstocks.org/api/v1/auth/me", { method: "OPTIONS", headers: { origin: "http://tauri.localhost" } }));
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    const bad = await s.api(new Request("https://admin.codexstocks.org/api/v1/auth/me", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("public endpoints never expose private data", () => {
  it("returns only allowlisted fields of available+published+complete accounts", async () => {
    const a = newId(), hidden = newId(), sold = newId(), noLinks = newId();
    const credId = newId(), setId = newId();
    const ops = [
      { entity: "accounts", id: a, row: accountRow(a, { published: true, description_public: "  Conqueror  S12\n\n\nM416   Glacier\n  - lvl 7\n" }) },
      { entity: "login_links", id: newId(), row: null as any, link: "email" },
      { entity: "credentials", id: credId, row: { id: credId, rev: 0, deleted: false, created_at: T(), updated_at: T(), account_id: a, label: "shared", secret_ct: FAKE_CT("password"), secret_updated_at: T() } },
      { entity: "backup_code_sets", id: setId, row: { id: setId, rev: 0, deleted: false, created_at: T(), updated_at: T(), account_id: a, link_id: null, label: "Google codes" } },
      { entity: "accounts", id: hidden, row: accountRow(hidden, { title: "Unpublished", published: false }) },
      { entity: "accounts", id: sold, row: accountRow(sold, { title: "Sold one", status: "sold", published: true }) },
      { entity: "accounts", id: noLinks, row: accountRow(noLinks, { title: "No links", published: true }) },
    ].map((o) => ({ op_id: newId(), base_rev: 0, entity: o.entity, id: o.id, row: o.row ?? linkRow(o.id, a, "email") }));
    for (const acc of [hidden, sold]) ops.push({ op_id: newId(), base_rev: 0, entity: "login_links", id: newId(), row: null as any });
    ops[ops.length - 2].row = linkRow(ops[ops.length - 2].id, hidden, "phone");
    ops[ops.length - 1].row = linkRow(ops[ops.length - 1].id, sold, "phone");
    const codeId = newId();
    ops.push({ op_id: newId(), base_rev: 0, entity: "backup_codes", id: codeId, row: { id: codeId, rev: 0, deleted: false, created_at: T(), updated_at: T(), set_id: setId, account_id: a, position: 1, code_ct: FAKE_CT("code"), code_tag: "a".repeat(64), state: "unused", used_at: null } as any });

    const push = await s.call("POST", "/sync/push", { token, body: { ops } });
    expect(push.status).toBe(200);
    expect(push.json.results.every((r: any) => r.status === "applied"), JSON.stringify(push.json.results)).toBe(true);

    const list = await s.call("GET", "/public/listings");
    expect(list.status).toBe(200);
    expect(list.json.map((x: any) => x.id)).toEqual([a]);
    const detail = await s.call("GET", `/public/listings/${a}?include=secret_ct&fields=*`);
    expect(Object.keys(detail.json).sort()).toEqual([...PUBLIC_LISTING_KEYS].sort());
    expect(detail.json.description).toBe("  Conqueror  S12\n\n\nM416   Glacier\n  - lvl 7\n");
    for (const body of [JSON.stringify(list.json), JSON.stringify(detail.json)]) {
      for (const leak of [
        "PRIVATE", "private-login@example.com", "+923001234567", "923009998877", "923331112222", "cx1.", "PURCHASE-REF",
        "1500000", "secret_ct", "code_tag", "internal_notes", "purchase_cost",
      ])
        expect(body, leak).not.toContain(leak);
    }
    for (const id of [hidden, sold, noLinks, newId(), "not-a-uuid", "' OR 1=1 --"]) {
      expect((await s.call("GET", `/public/listings/${encodeURIComponent(id)}`)).status).toBe(404);
    }
    const search = await s.call("GET", `/public/listings?q=${encodeURIComponent("%")}`);
    expect(search.json).toEqual([]);
    const settings = await s.call("GET", "/public/settings");
    expect(Object.keys(settings.json).sort()).toEqual(["store_name", "store_tagline", "whatsapp"]);
  });
});

describe("sync protocol", () => {
  it("is idempotent: retrying an op never applies it twice", async () => {
    const id = newId();
    const op = { op_id: newId(), entity: "accounts", id, base_rev: 0, row: accountRow(id) };
    const r1 = await s.call("POST", "/sync/push", { token, body: { ops: [op] } });
    const r2 = await s.call("POST", "/sync/push", { token, body: { ops: [op] } });
    expect(r1.json.results[0]).toMatchObject({ status: "applied", rev: 1 });
    expect(r2.json.results[0]).toEqual(r1.json.results[0]);
    const all = await s.call("GET", `/admin/entities/accounts`, { token });
    expect(all.json.filter((x: any) => x.id === id)).toHaveLength(1);
  });

  it("detects stale revisions as conflicts and records them", async () => {
    const id = newId();
    await s.call("POST", "/sync/push", { token, body: { ops: [{ op_id: newId(), entity: "accounts", id, base_rev: 0, row: accountRow(id) }] } });
    const a = await s.call("POST", "/sync/push", { token, body: { ops: [{ op_id: newId(), entity: "accounts", id, base_rev: 1, row: accountRow(id, { title: "Device A" }) }] } });
    const b = await s.call("POST", "/sync/push", { token, body: { ops: [{ op_id: newId(), entity: "accounts", id, base_rev: 1, row: accountRow(id, { title: "Device B" }) }] } });
    expect(a.json.results[0].status).toBe("applied");
    expect(b.json.results[0]).toMatchObject({ status: "conflict", server_row: { title: "Device A", rev: 2 } });
    const conflicts = await s.call("GET", "/admin/conflicts", { token });
    const c = conflicts.json.find((x: any) => x.entity_id === id);
    expect(c.client_row.title).toBe("Device B");
    const res = await s.call("POST", `/admin/conflicts/${c.id}/resolve`, { token, body: { resolution: "apply_client" } });
    expect(res.status).toBe(200);
    expect((await s.call("GET", `/admin/entities/accounts/${id}`, { token })).json.title).toBe("Device B");
  });

  it("rejects plaintext secrets, link-limit violations and duplicate sales", async () => {
    const id = newId();
    const base = [{ op_id: newId(), entity: "accounts", id, base_rev: 0, row: accountRow(id) }];
    await s.call("POST", "/sync/push", { token, body: { ops: base } });
    const credId = newId();
    const plaintext = await s.call("POST", "/sync/push", {
      token,
      body: { ops: [{ op_id: newId(), entity: "credentials", id: credId, base_rev: 0, row: { id: credId, rev: 0, deleted: false, created_at: T(), updated_at: T(), account_id: id, label: "x", secret_ct: "MyPlainPassword123", secret_updated_at: T() } }] },
    });
    expect(plaintext.json.results[0]).toMatchObject({ status: "rejected", code: "validation" });

    const links = ["social", "social", "social"].map(() => newId());
    const lr = await s.call("POST", "/sync/push", {
      token,
      body: { ops: links.map((lid) => ({ op_id: newId(), entity: "login_links", id: lid, base_rev: 0, row: linkRow(lid, id, "social") })) },
    });
    expect(lr.json.results.map((r: any) => r.status)).toEqual(["applied", "applied", "rejected"]);
    expect(lr.json.results[2].code).toBe("link_limit_social");
    const p1 = newId(), p2 = newId();
    const pr = await s.call("POST", "/sync/push", {
      token,
      body: { ops: [p1, p2].map((lid) => ({ op_id: newId(), entity: "login_links", id: lid, base_rev: 0, row: linkRow(lid, id, "phone") })) },
    });
    expect(pr.json.results.map((r: any) => r.status)).toEqual(["applied", "rejected"]);

    const sale = (sid: string) => ({
      op_id: newId(), entity: "sales", id: sid, base_rev: 0,
      row: { id: sid, rev: 0, deleted: false, created_at: T(), updated_at: T(), account_id: id, sold_at: T(), amount_minor: 100, currency: "PKR", exchange_rate_micro: null, buyer_name: null, buyer_contact: null, channel: "whatsapp", reference: null, notes: null, status: "completed" },
    });
    const sr = await s.call("POST", "/sync/push", { token, body: { ops: [sale(newId()), sale(newId())] } });
    expect(sr.json.results.map((r: any) => r.status)).toEqual(["applied", "rejected"]);
    expect(sr.json.results[1].code).toBe("duplicate_sale");
  });

  it("pull returns ordered changes with a resumable cursor", async () => {
    const first = await s.call("GET", "/sync/pull?since=0&limit=3", { token });
    expect(first.json.changes).toHaveLength(3);
    expect(first.json.has_more).toBe(true);
    const seqs = first.json.changes.map((c: any) => c.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const next = await s.call("GET", `/sync/pull?since=${first.json.cursor}&limit=500`, { token });
    expect(next.json.changes[0].seq).toBeGreaterThan(first.json.cursor);
    expect(next.json.changes.every((c: any) => !("change_seq" in c.row))).toBe(true);
  });
});

describe("vault envelope storage", () => {
  const env = (vault_id: string, n = 1) =>
    JSON.stringify({ format: "codex-vault", v: 1, vault_id, pass_wrap: "p".repeat(60) + n, recovery_wrap: "r".repeat(60), kdf: {} });
  it("stores, re-wraps with version checks and refuses a different vault", async () => {
    const fresh = await startServer();
    const { token: t } = await setupOwner(fresh);
    const vid = newId();
    expect((await fresh.call("GET", "/vault", { token: t })).json).toBeNull();
    const put1 = await fresh.call("PUT", "/vault", { token: t, body: { envelope: env(vid), base_version: 0 } });
    expect(put1.json.version).toBe(1);
    expect((await fresh.call("PUT", "/vault", { token: t, body: { envelope: env(vid, 2), base_version: 0 } })).status).toBe(409);
    expect((await fresh.call("PUT", "/vault", { token: t, body: { envelope: env(vid, 2), base_version: 1 } })).json.version).toBe(2);
    const other = await fresh.call("PUT", "/vault", { token: t, body: { envelope: env(newId()), base_version: 2 } });
    expect(other.status).toBe(409);
    expect(other.json.error.code).toBe("vault_mismatch");
  });
});

describe("ImageKit upload authentication", () => {
  it("signs uploads server-side without exposing the private key", async () => {
    const r = await s.call("POST", "/media/imagekit-auth", { token, body: {} });
    expect(r.status).toBe(200);
    const expected = createHmac("sha1", "private_test_key_never_exposed").update(r.json.token + r.json.expire).digest("hex");
    expect(r.json.signature).toBe(expected);
    expect(JSON.stringify(r.json)).not.toContain("private_test_key");
    expect(r.json.expire).toBeGreaterThan(Date.now() / 1000);
  });
  it("reports a clear error when ImageKit is not configured", async () => {
    const fresh = await startServer({ imagekit: undefined });
    const { token: t } = await setupOwner(fresh);
    const r = await fresh.call("POST", "/media/imagekit-auth", { token: t, body: {} });
    expect(r.status).toBe(503);
  });
  it("rejects image URLs outside the ImageKit endpoint", async () => {
    const id = newId();
    const r = await s.call("POST", "/sync/push", {
      token,
      body: { ops: [{ op_id: newId(), entity: "accounts", id, base_rev: 0, row: accountRow(id, { image_url: "https://evil.example/x.png", image_file_id: "f1" }) }] },
    });
    expect(r.json.results[0]).toMatchObject({ status: "rejected", code: "image_host" });
  });
});

describe("admin commands", () => {
  it("run shared business rules server-side and feed the dashboard", async () => {
    const fresh = await startServer();
    const { token: t } = await setupOwner(fresh);
    const acct = await fresh.call("POST", "/admin/commands/createAccount", {
      token: t,
      body: { account: { title: "Web-created", purchase_cost_minor: 1000, purchase_currency: "USD", description_public: "a\n\n  b" }, links: [] },
    });
    expect(acct.status).toBe(422);
    expect(acct.json.error.code).toBe("link_min");
    const ok = await fresh.call("POST", "/admin/commands/createAccount", {
      token: t,
      body: {
        account: { title: "Web-created", purchase_cost_minor: 1000, purchase_currency: "USD", description_public: "a\n\n  b   " },
        links: [{ kind: "social", provider: "facebook", owner_name: "Ali" }],
      },
    });
    expect(ok.status).toBe(200);
    const id = ok.json.result.id;
    const sale = await fresh.call("POST", "/admin/commands/recordSale", {
      token: t,
      body: { account_id: id, sold_at: T(), amount_minor: 280000, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp" },
    });
    expect(sale.json.error.code).toBe("rate_required");
    const sale2 = await fresh.call("POST", "/admin/commands/recordSale", {
      token: t,
      body: { account_id: id, sold_at: T(), amount_minor: 420000, currency: "PKR", exchange_rate_micro: 280_000_000, channel: "whatsapp" },
    });
    expect(sale2.status).toBe(200);
    const dash = await fresh.call("GET", "/admin/dashboard", { token: t });
    expect(dash.json.report.byCurrency.PKR).toMatchObject({ grossSales: 420000, costOfSold: 280000, grossProfit: 140000 });
    expect(dash.json.report.byCurrency.USD).toMatchObject({ grossSales: 0, purchases: 1000 });
    const bundle = await fresh.call("GET", `/admin/accounts/${id}/bundle`, { token: t });
    expect(bundle.json.account.description_public).toBe("a\n\n  b   ");
    expect(bundle.json.account.status).toBe("sold");
    const audit = await fresh.call("GET", `/admin/audit`, { token: t });
    expect(audit.json.map((x: any) => x.action)).toEqual(expect.arrayContaining(["account.created", "sale.recorded"]));
  });
});
