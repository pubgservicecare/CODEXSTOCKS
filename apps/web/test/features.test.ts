/**
 * Final feature set across both admin interfaces: photo at account creation, Mark as Sold with the
 * actual amount, and desktop/web consistency. Real desktop engine + real web service + real server API,
 * simulated network and mocked ImageKit (no real uploads).
 */
import { describe, expect, it } from "vitest";
import { newId, type Account, type Sale } from "@codex/shared";
import { desktopService } from "../../desktop/src/DesktopService";
import { webService } from "../app/admin/WebService";
import { accountInput, API, FAST, png, PW, T, VAULT_PW, world } from "../../../packages/local-core/test/harness";
import { SETUP_TOKEN } from "../../../packages/server/test/helpers";

async function setup() {
  const w = await world();
  const a = await w.device("PC-A");
  await a.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
  const desk = desktopService(a.core, () => "owner");
  const login = await w.server.call("POST", "/auth/login", { body: { username: "owner", password: PW, client: "web" } });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const webFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (String(input instanceof Request ? input.url : input).startsWith(API)) {
      headers.set("cookie", cookie);
      headers.set("origin", "https://admin.codexstocks.org");
    }
    return w.net.fetch(input, { ...init, headers });
  };
  const web = webService("owner", { baseUrl: API, fetchImpl: webFetch, download: () => undefined, kdf: { vault: FAST, login: FAST } });
  return { ...w, a, desk, web };
}

const links = [{ kind: "email", identifier: "login@example.com" }];

describe("photo chosen while creating an account (web admin)", () => {
  it("uploads through the server-signed ImageKit flow and attaches it to the new account", async () => {
    const { a, desk, web, net } = await setup();
    const id = newId();
    await web.exec("createAccount", { id, account: accountInput({ title: "Web photo" }), links });
    await web.setImage(id, png());
    const acct = (await web.bundle(id))!.account;
    expect(acct.image_url).toMatch(/^https:\/\/ik\.imagekit\.io\/codex\//);
    expect(acct.image_file_id).toBeTruthy();
    expect(net.uploads).toHaveLength(1);
    await a.core.syncNow();
    expect((await desk.bundle(id))!.account.image_url).toBe(acct.image_url);
  });

  it("an upload failure is reported, the account exists once without a photo, and retry attaches it", async () => {
    const { web, net, server } = await setup();
    const id = newId();
    await web.exec("createAccount", { id, account: accountInput({ title: "Retry photo" }), links });
    net.imagekitFails = 1;
    await expect(web.setImage(id, png())).rejects.toThrow();
    expect((await web.bundle(id))!.account.image_url).toBeNull();
    await web.setImage(id, png()); // "Retry photo"
    expect((await web.bundle(id))!.account.image_url).toMatch(/^https:\/\/ik\.imagekit\.io\//);
    const n = await server.db.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts WHERE title = 'Retry photo'");
    expect(n.rows[0].n).toBe(1);
  });

  it("rejects non-image files and oversize images before uploading", async () => {
    const { web, net } = await setup();
    const id = newId();
    await web.exec("createAccount", { id, account: accountInput(), links });
    await expect(web.setImage(id, new TextEncoder().encode("not an image"))).rejects.toThrow(/JPEG, PNG or WebP/);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(png().slice(0, 8));
    await expect(web.setImage(id, big)).rejects.toThrow(/too large/);
    expect(net.uploads).toHaveLength(0);
  });
});

describe("Mark as Sold on both interfaces", () => {
  it("a web sale reaches the desktop and a desktop sale reaches the web with identical values and reports", async () => {
    const { a, desk, web } = await setup();
    const x = await desk.exec<Account>("createAccount", { account: accountInput({ title: "Sold on web" }), links });
    const y = await desk.exec<Account>("createAccount", { account: accountInput({ title: "Sold on desktop" }), links });
    await a.core.syncNow();

    const webSale = await web.exec<Sale>("recordSale", { id: newId(), account_id: x.id, sold_at: T(), amount_minor: 2_150_000, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp", buyer_name: "Bilal", buyer_contact: "+923001112233", reference: "Easypaisa", notes: null });
    const deskSale = await desk.exec<Sale>("recordSale", { id: newId(), account_id: y.id, sold_at: T(), amount_minor: 2_400_000, currency: "PKR", exchange_rate_micro: null, channel: "direct", buyer_name: null, buyer_contact: null, reference: null, notes: null });
    expect((await a.core.syncNow()).error).toBeNull();

    const strip = ({ rev: _r, updated_at: _u, ...rest }: Sale) => rest;
    expect(strip((await desk.bundle(x.id))!.sales[0])).toEqual(strip(webSale));
    expect(strip((await web.bundle(y.id))!.sales[0])).toEqual(strip(deskSale));
    expect((await desk.bundle(x.id))!.account.status).toBe("sold");
    expect((await web.bundle(y.id))!.account.status).toBe("sold");
    const [dw, dd] = [await web.dashboard(), await desk.dashboard()];
    expect(dw.report).toEqual(dd.report);
    expect(dw.report.byCurrency.PKR).toMatchObject({ grossSales: 4_550_000, costOfSold: 3_000_000, grossProfit: 1_550_000, salesCount: 2 });
    expect(dw.report.counts.sold).toBe(2);
  });

  it("a resubmitted web sale is recognised as already recorded (no second sale)", async () => {
    const { web, server } = await setup();
    const id = newId();
    await web.exec("createAccount", { id, account: accountInput(), links });
    const args = { id: newId(), account_id: id, sold_at: T(), amount_minor: 1_000_000, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp", buyer_name: null, buyer_contact: null, reference: null, notes: null };
    await web.exec("recordSale", args);
    await expect(web.exec("recordSale", args)).rejects.toMatchObject({ code: "exists" });
    const n = await server.db.query<{ n: number }>("SELECT count(*)::int AS n FROM sales WHERE account_id = $1", [id]);
    expect(n.rows[0].n).toBe(1);
  });

  it("if the website already sold the account, the desktop's offline sale becomes a conflict, not a second sale", async () => {
    const { a, desk, web, net, server } = await setup();
    const acct = await desk.exec<Account>("createAccount", { account: accountInput(), links });
    await a.core.syncNow();
    net.online = false;
    await desk.exec("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 1_800_000, currency: "PKR", exchange_rate_micro: null, channel: "direct" });
    net.online = true;
    // Meanwhile the website sells the same account (before the PC reconnects and pushes its sale).
    await web.exec("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 1_900_000, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp" });
    const r = await a.core.syncNow();
    expect(r.rejected + r.conflicts).toBeGreaterThan(0);
    const cloud = await server.db.query<{ amount_minor: string; status: string }>("SELECT amount_minor, status FROM sales WHERE account_id = $1 AND status = 'completed'", [acct.id]);
    expect(cloud.rows.map((s) => Number(s.amount_minor))).toEqual([1_900_000]);
    expect((await web.conflicts()).length + (await desk.conflicts()).length + (await a.core.outboxIssues()).length).toBeGreaterThan(0);
  });
});
