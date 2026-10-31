// Owner login on every installation, photo at account creation (offline queue), and Mark as Sold
// with the actual amount — exercised on the real desktop engine against the real server API.
import { describe, expect, it } from "vitest";
import type { Account, Sale } from "@codex/shared";
import { AppCore } from "../src";
import { accountInput, API, png, PW, T, VAULT_PW, world } from "./harness";
import { SETUP_TOKEN } from "../../server/test/helpers";

/** The production situation: the single owner already exists (created once from the first PC). */
async function ownerExists() {
  const w = await world();
  const first = await w.device("First-PC");
  await first.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
  return { ...w, first };
}

const ownerCount = async (w: Awaited<ReturnType<typeof world>>) =>
  (await w.server.db.query<{ n: number }>("SELECT count(*)::int AS n FROM owner")).rows[0].n;

async function newAccount(core: AppCore, over: Record<string, unknown> = {}) {
  return core.exec<Account>("createAccount", { account: accountInput(over), links: [{ kind: "email", identifier: "login@example.com" }] });
}

describe("owner login on a fresh installation", () => {
  it("signs in as the existing owner, enrols this PC, downloads the inventory and never creates an owner", async () => {
    const w = await ownerExists();
    const acct = await newAccount(w.first.core, { title: "Synced before the new PC" });
    await w.first.core.syncNow();

    const fresh = await w.device("New-PC");
    expect((await fresh.core.state()).setup).toBe(false);
    await expect(fresh.core.connectExisting({ apiBase: API, username: "owner", password: "wrong-password" })).rejects.toThrow(/Incorrect/);
    expect((await fresh.core.state()).setup).toBe(false);

    const { vaultExists } = await fresh.core.connectExisting({ apiBase: API, username: "owner", password: PW });
    expect(vaultExists).toBe(true);
    const st = await fresh.core.state();
    expect(st).toMatchObject({ setup: true, loggedIn: true, paired: true });
    expect((await fresh.core.listAccounts()).map((a) => a.title)).toContain("Synced before the new PC");
    expect(await ownerCount(w)).toBe(1);
    const devices = await w.server.db.query<{ name: string }>("SELECT name FROM devices ORDER BY created_at");
    expect(devices.rows.map((d) => d.name)).toEqual(["First-PC", "New-PC"]);

    // Third-party passwords stay encrypted until the vault is unlocked on this PC.
    await w.first.core.unlockVault(VAULT_PW);
    await w.first.core.saveSharedPassword(acct.id, "game-pass-1");
    await w.first.core.syncNow();
    await fresh.core.syncNow();
    const b = (await fresh.core.bundle(acct.id))!;
    expect(() => fresh.core.revealCredential(b.credential!)).toThrow(/Unlock/);
    await fresh.core.unlockVault(VAULT_PW);
    expect(fresh.core.revealCredential(b.credential!)).toBe("game-pass-1");
  });

  it("cannot sign in for the first time without internet and does not set anything up", async () => {
    const w = await ownerExists();
    w.net.online = false;
    const fresh = await w.device("Offline-New-PC");
    const err = await fresh.core.connectExisting({ apiBase: API, username: "owner", password: PW }).catch((e) => e);
    expect(err).toMatchObject({ status: 0 }); // the UI shows "Connect to the internet to sign in and authorise this PC for the first time."
    expect((await fresh.core.state())).toMatchObject({ setup: false, loggedIn: false });
    await expect(fresh.core.listAccounts()).rejects.toThrow();
    expect(await ownerCount(w)).toBe(1);
  });

  it("an already authorised PC signs in offline, keeps working and syncs when the internet returns", async () => {
    const w = await ownerExists();
    const pc = await w.device("Enrolled-PC");
    await pc.core.connectExisting({ apiBase: API, username: "owner", password: PW });
    await newAccount(pc.core, { title: "Before going offline" });
    await pc.core.syncNow();
    pc.core.logout();
    pc.driver.close();

    w.net.online = false;
    const again = await w.device("Enrolled-PC", pc.path, pc.files);
    await expect(again.core.login("owner", "wrong")).rejects.toThrow(/Incorrect/);
    await again.core.login("owner", PW);
    expect((await again.core.refreshCloudSession(PW))).toBe("offline");
    const offline = await newAccount(again.core, { title: "Added offline" });
    expect((await again.core.listAccounts()).map((a) => a.title).sort()).toEqual(["Added offline", "Before going offline"]);

    w.net.online = true;
    expect((await again.core.syncNow()).error).toBeNull();
    await w.first.core.syncNow();
    expect((await w.first.core.get("accounts", offline.id))?.title).toBe("Added offline");
  });

  it("restoring an encrypted backup never creates a cloud owner", async () => {
    const w = await ownerExists();
    await newAccount(w.first.core);
    const file = await w.first.core.exportBackup("Backup-Pass-123!");
    const fresh = await w.device("Restore-PC");
    await fresh.core.restoreBackup(file, "Backup-Pass-123!");
    expect(await ownerCount(w)).toBe(1);
  });
});

describe("photo chosen in the Add Account form", () => {
  it("offline: account and photo are kept locally, then uploaded and attached when online", async () => {
    const w = await ownerExists();
    const pc = w.first;
    w.net.online = false;
    // Same order as the form: create the account, then attach the chosen photo to its id.
    const acct = await newAccount(pc.core, { title: "Photo offline" });
    const item = await pc.core.setAccountImage(acct.id, png());
    expect(item.status).toBe("queued");
    expect(pc.files.map.has(item.file_name)).toBe(true);
    await pc.core.syncNow();
    expect((await pc.core.media.get(item.id))!.status).toBe("failed");
    expect(pc.files.map.has(item.file_name)).toBe(true);
    expect((await pc.core.get("accounts", acct.id))!.image_url).toBeNull();

    w.net.online = true;
    w.net.imagekitFails = 1; // first upload after reconnecting fails
    await pc.core.media.retry(item.id);
    await pc.core.syncNow();
    expect((await pc.core.media.get(item.id))!.status).toBe("failed");
    expect(pc.files.map.has(item.file_name)).toBe(true); // a failed upload never deletes the local photo
    await pc.core.media.retry(item.id); // "Retry now"
    await pc.core.syncNow();
    const done = (await pc.core.media.get(item.id))!;
    expect(done.status).toBe("uploaded");
    const saved = (await pc.core.get("accounts", acct.id))!;
    expect(saved.image_url).toBe(done.remote_url);
    expect(saved.image_file_id).toBe(done.remote_file_id);
    expect(pc.files.map.has(item.file_name)).toBe(true); // kept as offline cache

    // Published account shows the photo on the public website.
    await pc.core.exec("setPublished", { id: acct.id, published: true });
    await pc.core.syncNow();
    const pub = await w.server.call("GET", `/public/listings/${acct.id}`);
    expect(pub.status).toBe(200);
    expect(pub.json.image_url).toBe(done.remote_url);
  });

  it("an account created without a photo is fine", async () => {
    const w = await ownerExists();
    const acct = await newAccount(w.first.core, { title: "No photo" });
    await w.first.core.syncNow();
    expect((await w.first.core.media.localFor(acct.id))).toBeNull();
    expect((await w.server.call("GET", "/admin/entities/accounts/" + acct.id, { token: undefined })).status).toBe(401);
    expect((await w.first.core.get("accounts", acct.id))!.image_url).toBeNull();
  });
});

describe("Mark as Sold with the actual amount", () => {
  it("offline sale for a different amount than the listing price syncs exactly once and drives the reports", async () => {
    const w = await ownerExists();
    const pc = w.first.core;
    const acct = await newAccount(pc, { purchase_cost_minor: 1_500_000, list_price_minor: 2_500_000 });
    await pc.exec("setPublished", { id: acct.id, published: true });
    await pc.syncNow();
    expect((await w.server.call("GET", "/public/listings")).json.map((l: { id: string }) => l.id)).toContain(acct.id);

    w.net.online = false;
    const saleId = "01a1a000-0000-7000-8000-00000000a001";
    const args = { id: saleId, account_id: acct.id, sold_at: T(), amount_minor: 2_200_000, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp", buyer_name: null, buyer_contact: null, reference: "JazzCash", notes: null };
    await pc.exec("recordSale", args);
    // A repeated submission of the same sale is refused, never duplicated.
    await expect(pc.exec("recordSale", args)).rejects.toThrow(/already/);
    const local = (await pc.bundle(acct.id))!;
    expect(local.account).toMatchObject({ status: "sold", published: false });
    expect(local.sales).toHaveLength(1);
    expect(local.sales[0]).toMatchObject({ amount_minor: 2_200_000, currency: "PKR", status: "completed" });

    w.net.online = true;
    w.net.dropNextResponse = true; // response lost: the retry must not create a second sale
    await pc.syncNow();
    expect((await pc.syncNow()).error).toBeNull();
    const cloudSales = await w.server.db.query<{ n: number }>("SELECT count(*)::int AS n FROM sales WHERE account_id = $1", [acct.id]);
    expect(cloudSales.rows[0].n).toBe(1);

    const report = (await pc.dashboard()).report;
    expect(report.byCurrency.PKR).toMatchObject({ grossSales: 2_200_000, costOfSold: 1_500_000, grossProfit: 700_000, salesCount: 1 });
    expect(report.counts).toMatchObject({ sold: 1, available: 0, published: 0 });
    const actions = (await pc.audit(acct.id)).map((e) => e.action);
    expect(actions).toContain("sale.recorded");
    // Gone from the public website, including its old URL.
    expect((await w.server.call("GET", "/public/listings")).json.map((l: { id: string }) => l.id)).not.toContain(acct.id);
    expect((await w.server.call("GET", `/public/listings/${acct.id}`)).status).toBe(404);
  });

  it("requires a recorded exchange rate when the sale currency differs and keeps PKR and USD separate", async () => {
    const w = await ownerExists();
    const pc = w.first.core;
    const acct = await newAccount(pc, { purchase_cost_minor: 2_800_000, purchase_currency: "PKR", list_price_minor: 15_000, list_currency: "USD" });
    const base = { account_id: acct.id, sold_at: T(), amount_minor: 12_000, currency: "USD", channel: "whatsapp" };
    await expect(pc.exec("recordSale", { ...base, exchange_rate_micro: null })).rejects.toThrow(/exchange rate/);
    expect((await pc.get("accounts", acct.id))!.status).toBe("available"); // failed sale leaves the account unsold
    // 1 PKR = 0.00357 USD
    await pc.exec("recordSale", { ...base, exchange_rate_micro: 3_570 });
    const r = (await pc.dashboard()).report.byCurrency;
    expect(r.USD).toMatchObject({ grossSales: 12_000, costOfSold: 9_996, grossProfit: 2_004 });
    expect(r.PKR).toMatchObject({ grossSales: 0, costOfSold: 0, purchases: 2_800_000 });
  });

  it("a restocking refund reverses the sale with history kept, and the account can be sold again", async () => {
    const w = await ownerExists();
    const pc = w.first.core;
    const acct = await newAccount(pc);
    const sale = await pc.exec<Sale>("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 2_000_000, currency: "PKR", exchange_rate_micro: null, channel: "direct" });
    await pc.exec("recordRefund", { sale_id: sale.id, refunded_at: T(), amount_minor: 2_000_000, reason: "returned", restock: true });
    const b = (await pc.bundle(acct.id))!;
    expect(b.account.status).toBe("available");
    expect(b.sales[0].status).toBe("refunded"); // original sale kept
    const r1 = (await pc.dashboard()).report.byCurrency.PKR;
    expect(r1).toMatchObject({ grossSales: 2_000_000, refunds: 2_000_000, netSales: 0, costOfSold: 0, grossProfit: 0 });
    await pc.exec("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 1_900_000, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp" });
    const r2 = (await pc.dashboard()).report.byCurrency.PKR;
    expect(r2).toMatchObject({ grossSales: 3_900_000, refunds: 2_000_000, netSales: 1_900_000, costOfSold: 1_500_000, grossProfit: 400_000 });
  });
});
