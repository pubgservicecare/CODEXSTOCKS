/**
 * Desktop ⇄ web admin PARITY tests.
 * The real desktop engine (AppCore + DesktopService) and the real web admin service (WebService)
 * run against the same server API, with a simulated network and a mocked ImageKit.
 */
import { describe, expect, it } from "vitest";
import type { Account, Sale } from "@codex/shared";
import type { DataService } from "@codex/ui";
import { desktopService } from "../../desktop/src/DesktopService";
import { webService } from "../app/admin/WebService";
import { accountInput, API, FAST, png, PW, T, VAULT_PW, world } from "../../../packages/local-core/test/harness";
import { SETUP_TOKEN } from "../../../packages/server/test/helpers";

const ADMIN_ORIGIN = "https://admin.codexstocks.org";

async function setup() {
  const w = await world();
  const a = await w.device("PC-A");
  await a.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
  const desk = desktopService(a.core, () => "owner");
  // Web admin: real cookie login, then every request carries the cookie + admin Origin like a browser.
  const login = await w.server.call("POST", "/auth/login", { body: { username: "owner", password: PW, client: "web" } });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const webFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(API)) {
      headers.set("cookie", cookie);
      headers.set("origin", ADMIN_ORIGIN);
    }
    return w.net.fetch(input, { ...init, headers });
  };
  const downloads: { name: string; text: string }[] = [];
  const web = webService("owner", {
    baseUrl: API,
    fetchImpl: webFetch,
    download: (name, text) => downloads.push({ name, text }),
    kdf: { vault: FAST, login: FAST },
  });
  return { ...w, a, desk, web, downloads };
}

const strip = <T extends Record<string, unknown>>(r: T) => {
  const { rev: _r, updated_at: _u, ...rest } = r as Record<string, unknown>;
  return rest;
};

describe("feature surface", () => {
  it("web admin implements every desktop admin capability except documented desktop-only ones", async () => {
    const { desk, web } = await setup();
    const DESKTOP_ONLY = ["localImage", "retryImage", "syncNow", "outboxIssues", "retryOutbox", "discardOutbox", "restoreBackup", "cloudInfo", "pairWithCloud"];
    const d = Object.keys(desk).filter((k) => typeof (desk as unknown as Record<string, unknown>)[k] === "function");
    const wk = new Set(Object.keys(web));
    const missingOnWeb = d.filter((k) => !wk.has(k) && !DESKTOP_ONLY.includes(k));
    expect(missingOnWeb).toEqual([]);
    const missingOnDesktop = [...wk].filter((k) => !(k in desk));
    expect(missingOnDesktop).toEqual([]);
  });
});

describe("web → desktop", () => {
  it("accounts, all link types, owner details, shared password, backup codes, image, YouTube, TXT and publishing", async () => {
    const { a, desk, web, server, net } = await setup();
    await web.unlockVault(VAULT_PW);
    const txt = "  Conqueror   x3\n\n\n\t- M416  Glacier   lvl 7\n   ";
    const acct = await web.exec<Account>("createAccount", {
      account: accountInput({ description_public: txt, youtube_url: "https://youtu.be/dQw4w9WgXcQ", old_owner_name: "Old Ali", show_old_owner_public: true }),
      links: [
        { kind: "social", provider: "google", identifier: "g-handle", owner_name: "G owner", owner_contact: "+923001110000", owner_notes: "gmail owner" },
        { kind: "social", provider: "game_center", owner_name: "GC owner" },
        { kind: "phone", identifier: "+923001234567", owner_name: "Phone owner", two_step_enabled: true, two_step_method: "phone", two_step_destination: "+923001234567", two_step_accessible: true },
        { kind: "email", identifier: "login@example.com", owner_name: "Email owner" },
      ],
    });
    await expect(web.exec("saveLink", { account_id: acct.id, link: { kind: "social", provider: "x" } })).rejects.toThrow(/at most/);
    await web.saveSharedPassword(acct.id, "Web-Shared-P@ss");
    await web.recordBackupCodes({ accountId: acct.id, linkId: null, label: "Google", codes: ["00000042", "12345678"] });
    await web.setImage(acct.id, png());
    await web.exec("setPublished", { id: acct.id, published: true });
    expect(net.uploads).toHaveLength(1);

    await a.core.syncNow();
    const wb = (await web.bundle(acct.id))!;
    const db = (await desk.bundle(acct.id))!;
    expect(strip(db.account)).toEqual(strip(wb.account));
    expect(db.account.description_public).toBe(txt);
    expect(db.links.map(strip)).toEqual(wb.links.map(strip));
    const phone = db.links.find((l) => l.kind === "phone")!;
    const email = db.links.find((l) => l.kind === "email")!;
    expect(phone.credential_id).toBe(db.credential!.id);
    expect(email.credential_id).toBe(db.credential!.id);
    await desk.unlockVault(VAULT_PW);
    expect(desk.revealCredential(db.credential!)).toBe("Web-Shared-P@ss");
    expect(db.backupSets[0].codes.map((c) => desk.revealBackupCode(c))).toEqual(["00000042", "12345678"]);
    expect(db.account.image_url).toMatch(/^https:\/\/ik\.imagekit\.io\/codex\//);

    const pub = await server.call("GET", `/public/listings/${acct.id}`);
    expect(pub.json).toMatchObject({ description: txt, youtube_id: "dQw4w9WgXcQ", previous_owner: "Old Ali" });
    const leak = JSON.stringify(pub.json);
    for (const s of ["login@example.com", "+923001234567", "Web-Shared", "00000042", "cx1.", "1500000", "bought from Ali", "G owner"]) expect(leak).not.toContain(s);

    // Status changes from the web reach the desktop.
    await web.exec("setAccountStatus", { id: acct.id, status: "reserved", expected_rev: (await web.bundle(acct.id))!.account.rev });
    await a.core.syncNow();
    expect((await desk.bundle(acct.id))!.account.status).toBe("reserved");
    await web.exec("setAccountStatus", { id: acct.id, status: "archived", expected_rev: (await web.bundle(acct.id))!.account.rev });
    await a.core.syncNow();
    expect((await desk.bundle(acct.id))!.account).toMatchObject({ status: "archived", published: false });
  });
});

describe("desktop → web", () => {
  it("offline sales, expenses and web refunds give identical PKR/USD reports and history on both", async () => {
    const { a, desk, web, net } = await setup();
    const acct = await desk.exec<Account>("createAccount", { account: accountInput({ purchase_cost_minor: 2000, purchase_currency: "USD" }), links: [{ kind: "email", identifier: "x@y.zz" }] });
    const other = await desk.exec<Account>("createAccount", { account: accountInput({ title: "Unsold" }), links: [{ kind: "social", provider: "facebook" }] });
    await a.core.syncNow();
    net.online = false;
    const sale = await desk.exec<Sale>("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 840000, currency: "PKR", exchange_rate_micro: 280_000_000, channel: "whatsapp" });
    await desk.exec("saveExpense", { expense: { incurred_at: "2026-10-01", amount_minor: 50000, currency: "PKR", category: "advertising", description: "ads", account_id: acct.id, sale_id: null } });
    await desk.exec("saveExpense", { expense: { incurred_at: "2026-10-02", amount_minor: 300, currency: "USD", category: "hosting_software", description: "vps", account_id: null, sale_id: null } });
    net.online = true;
    expect((await a.core.syncNow()).error).toBeNull();

    const [dw, dd] = [await web.dashboard(), await desk.dashboard()];
    expect(dw.report).toEqual(dd.report);
    expect(dw.report.byCurrency.PKR).toMatchObject({ grossSales: 840000, costOfSold: 560000, expenses: 50000, netProfit: 230000 });
    expect(dw.report.byCurrency.USD).toMatchObject({ purchases: 2000 + 0, expenses: 300 });

    // Refund recorded on the website returns the account to inventory everywhere.
    await web.exec("recordRefund", { sale_id: sale.id, refunded_at: T(), amount_minor: 840000, reason: "buyer cancelled", restock: true });
    await a.core.syncNow();
    expect((await desk.bundle(acct.id))!.account.status).toBe("available");
    expect((await web.dashboard()).report).toEqual((await desk.dashboard()).report);

    // Account history is complete and identical on both admin interfaces.
    const actions = (evs: { action: string }[]) => evs.map((e) => e.action).sort();
    const wa = actions(await web.audit(acct.id));
    const da = actions(await desk.audit(acct.id));
    expect(wa).toEqual(da);
    expect(wa).toEqual(expect.arrayContaining(["account.created", "link.created", "sale.recorded", "refund.recorded", "expense.recorded"]));
    expect(actions(await web.audit(other.id))).not.toContain("sale.recorded");
    expect((await web.audit()).length).toBeGreaterThan(5);
  });
});

describe("vault, conflicts, devices, backup", () => {
  it("vault passphrase changed on the web works on the desktop", async () => {
    const { a, desk, web } = await setup();
    await web.changeVaultPassphrase({ passphrase: VAULT_PW }, "Web-New-Vault-Pass-1!");
    await a.core.syncNow();
    desk.lockVault();
    await expect(desk.unlockVault(VAULT_PW)).rejects.toThrow();
    await desk.unlockVault("Web-New-Vault-Pass-1!");
    expect(desk.vaultUnlocked()).toBe(true);
  });

  it("conflicts are visible on the web and close everywhere when the desktop resolves them", async () => {
    const { a, desk, web } = await setup();
    const acct = await desk.exec<Account>("createAccount", { account: accountInput({ title: "Base" }), links: [{ kind: "email", identifier: "c@d.ee" }] });
    await a.core.syncNow();
    await web.exec("updateAccount", { id: acct.id, expected_rev: (await web.bundle(acct.id))!.account.rev, account: { title: "Web title" } });
    await desk.exec("updateAccount", { id: acct.id, account: { title: "Desk title" } });
    await a.core.syncNow();
    expect(await desk.conflicts()).toHaveLength(1);
    expect((await web.conflicts()).map((c) => c.entity_id)).toEqual([acct.id]);
    expect((await web.syncStatus!()).conflicts).toBe(1);
    await desk.resolveConflict((await desk.conflicts())[0].id, "local");
    await a.core.syncNow();
    expect(await web.conflicts()).toHaveLength(0);
    expect((await web.bundle(acct.id))!.account.title).toBe("Desk title");
  });

  it("a conflict settled on the web never leaves the desktop with an outdated copy", async () => {
    const { a, desk, web } = await setup();
    const acct = await desk.exec<Account>("createAccount", { account: accountInput({ internal_notes: "n0" }), links: [{ kind: "email", identifier: "e@f.gg" }] });
    await a.core.syncNow();
    await web.exec("updateAccount", { id: acct.id, expected_rev: (await web.bundle(acct.id))!.account.rev, account: { internal_notes: "web-1" } });
    await desk.exec("updateAccount", { id: acct.id, account: { internal_notes: "desk-1" } });
    await a.core.syncNow();
    const wc = await web.conflicts();
    await web.resolveConflict(wc[0].id, "server");
    await web.exec("updateAccount", { id: acct.id, expected_rev: (await web.bundle(acct.id))!.account.rev, account: { internal_notes: "web-2" } });
    await a.core.syncNow();
    const dc = await desk.conflicts();
    expect((dc[0].server as Account).internal_notes).toBe("web-2");
    await desk.resolveConflict(dc[0].id, "server");
    await a.core.syncNow();
    expect((await desk.bundle(acct.id))!.account.internal_notes).toBe("web-2");
    expect((await a.core.syncStatus()).pending).toBe(0);
  });

  it("devices, settings and idle-lock preference work from both", async () => {
    const { a, desk, web } = await setup();
    const devs = await web.devices();
    expect(devs.map((d) => d.name)).toContain("PC-A");
    expect((await desk.devices()).length).toBe(devs.length);
    await web.exec("saveSetting", { key: "public_whatsapp", value: "+92 300 1112223" });
    await a.core.syncNow();
    expect((await desk.list("settings")).find((s) => s.key === "public_whatsapp")?.value).toBe("+92 300 1112223");
    await desk.exec("saveSetting", { key: "store_tagline", value: "From desktop" });
    await a.core.syncNow();
    expect((await web.list("settings")).find((s) => s.key === "store_tagline")?.value).toBe("From desktop");
    expect((await web.prefs!()).idle_minutes).toBe(10);
    expect((await desk.prefs!()).idle_minutes).toBe(10);
    await web.revokeDevice(devs.find((d) => d.name === "PC-A")!.id);
    const r = await a.core.syncNow();
    expect(r.error).toMatch(/Sign in|401/);
  });

  it("an encrypted backup downloaded from the website restores into the desktop app", async () => {
    const { a, desk, web, downloads, device } = await setup();
    const acct = await desk.exec<Account>("createAccount", { account: accountInput(), links: [{ kind: "phone", identifier: "+923007654321" }] });
    await desk.unlockVault(VAULT_PW);
    await desk.saveSharedPassword(acct.id, "in-the-backup");
    await a.core.syncNow();
    await expect(web.exportBackup!("short", { loginPassword: PW })).rejects.toThrow();
    await web.exportBackup!("Cloud-Backup-Pass-1!", { loginPassword: PW });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/\.cxbackup$/);
    expect(downloads[0].text).not.toContain("in-the-backup");
    const fresh = await device("Fresh-PC");
    expect((await fresh.core.restoreBackup(downloads[0].text, "Cloud-Backup-Pass-1!")).accounts).toBe(1);
    await fresh.core.login("owner", PW);
    await fresh.core.unlockVault(VAULT_PW);
    const b = (await fresh.core.bundle(acct.id))!;
    expect(b.account.description_public).toBe(accountInput().description_public);
    expect(fresh.core.revealCredential(b.credential!)).toBe("in-the-backup");
  });
});
