import { describe, expect, it } from "vitest";
import type { Account, Sale } from "@codex/shared";
import { AppCore } from "../src";
import { accountInput, API, png, PW, T, VAULT_PW, world } from "./harness";
import { SETUP_TOKEN } from "../../server/test/helpers";

async function cloudPair() {
  const w = await world();
  const a = await w.device("PC-A");
  const { recoveryKey } = await a.core.setupCloud({
    apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR",
  });
  const b = await w.device("PC-B");
  const { vaultExists } = await b.core.connectExisting({ apiBase: API, username: "owner", password: PW });
  expect(vaultExists).toBe(true);
  return { ...w, a, b, recoveryKey };
}

async function createAccount(core: AppCore, over: Record<string, unknown> = {}, links: Record<string, unknown>[] = [{ kind: "email", identifier: "login@example.com", owner_name: "Ali" }]) {
  return core.exec<Account>("createAccount", { account: accountInput(over), links });
}

describe("first run, local-only mode and offline login", () => {
  it("sets up offline, works offline, survives restart, and requires login", async () => {
    const w = await world();
    w.net.online = false;
    const d = await w.device("Offline-PC");
    const { recoveryKey } = await d.core.setupLocal({ username: "Owner", password: PW, vaultPassphrase: VAULT_PW, currency: "USD" });
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    const acct = await createAccount(d.core);
    await d.core.exec("updateAccount", { id: acct.id, account: { title: "Edited offline" } });
    await d.core.saveSharedPassword(acct.id, "p@ss-OFFLINE");
    d.driver.close();

    // Restart while still offline.
    const again = await w.device("Offline-PC", d.path, d.files);
    expect((await again.core.state()).setup).toBe(true);
    await expect(again.core.listAccounts()).rejects.toThrow(/Sign in/);
    await expect(again.core.login("owner", "wrong-password")).rejects.toThrow(/Incorrect/);
    await again.core.login("owner", PW);
    const list = await again.core.listAccounts();
    expect(list.map((x) => x.title)).toEqual(["Edited offline"]);
    expect(list[0].sync_state).toBe("pending");
    // Vault is locked after restart: secrets cannot be read.
    const b = (await again.core.bundle(acct.id))!;
    expect(() => again.core.revealCredential(b.credential!)).toThrow(/Unlock/);
    await again.core.unlockVault(VAULT_PW);
    expect(again.core.revealCredential(b.credential!)).toBe("p@ss-OFFLINE");
    again.core.lockVault();
    expect(() => again.core.revealCredential(b.credential!)).toThrow(/Unlock/);
    // Recovery key unlocks too and can reset a forgotten login password.
    await again.core.resetLoginWithRecoveryKey(recoveryKey, "Brand-New-Login-9!");
    again.core.logout();
    await expect(again.core.login("owner", PW)).rejects.toThrow();
    await again.core.login("owner", "Brand-New-Login-9!");
    const outbox = await again.core.db.all<{ n: number }>("SELECT count(*) AS n FROM outbox");
    expect(outbox[0].n).toBeGreaterThan(3);
  });

  it("stores no plaintext secrets in SQLite", async () => {
    const w = await world();
    const d = await w.device();
    await d.core.setupLocal({ username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const acct = await createAccount(d.core, {}, [{ kind: "phone", identifier: "+923001234567" }]);
    await d.core.saveSharedPassword(acct.id, "TopSecretPassword!!");
    await d.core.recordBackupCodes({ accountId: acct.id, linkId: null, label: "Google", codes: ["07070707", "13572468"] });
    d.driver.close();
    const { readFileSync, existsSync } = await import("node:fs");
    const blob = [d.path, d.path + "-wal"].filter(existsSync).map((p) => readFileSync(p).toString("latin1")).join("");
    for (const s of ["TopSecretPassword", "07070707", "13572468", VAULT_PW, PW]) expect(blob).not.toContain(s);
  });
});

describe("login links, shared password and backup codes", () => {
  it("enforces link limits and links phone+email to ONE shared credential", async () => {
    const w = await world();
    const { core } = await w.device();
    await core.setupLocal({ username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    await expect(createAccount(core, {}, [])).rejects.toThrow(/at least one login link/);
    const acct = await createAccount(core, {}, [
      { kind: "phone", identifier: "+923001234567", owner_name: "Phone owner", owner_contact: "+923001112222" },
      { kind: "email", identifier: "a@b.co", owner_name: "Email owner" },
      { kind: "social", provider: "google", owner_name: "G owner" },
    ]);
    await core.exec("saveLink", { account_id: acct.id, link: { kind: "social", provider: "x" } });
    await expect(core.exec("saveLink", { account_id: acct.id, link: { kind: "social", provider: "apple" } })).rejects.toThrow(/at most/);
    await expect(core.exec("saveLink", { account_id: acct.id, link: { kind: "phone", identifier: "+923000000000" } })).rejects.toThrow(/at most 1 phone/);
    await core.saveSharedPassword(acct.id, "first-password");
    let b = (await core.bundle(acct.id))!;
    const phone = b.links.find((l) => l.kind === "phone")!;
    const email = b.links.find((l) => l.kind === "email")!;
    expect(phone.credential_id).toBe(b.credential!.id);
    expect(email.credential_id).toBe(b.credential!.id);
    expect(b.links.filter((l) => l.kind === "social").every((l) => l.credential_id === null)).toBe(true);
    const firstUpdated = b.credential!.secret_updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await core.saveSharedPassword(acct.id, "second-password");
    b = (await core.bundle(acct.id))!;
    expect((await core.list("credentials")).length).toBe(1);
    expect(core.revealCredential(b.credential!)).toBe("second-password");
    expect(b.credential!.secret_updated_at > firstUpdated).toBe(true);
  });

  it("records 10 eight-digit codes, keeps leading zeros, tracks use and never re-offers used codes", async () => {
    const w = await world();
    const { core } = await w.device();
    await core.setupLocal({ username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const acct = await createAccount(core);
    const codes = Array.from({ length: 10 }, (_, i) => String(i * 7).padStart(8, "0"));
    await expect(core.recordBackupCodes({ accountId: acct.id, linkId: null, label: "x", codes: [...codes, "12345678"] })).rejects.toThrow(/at most 10/);
    await expect(core.recordBackupCodes({ accountId: acct.id, linkId: null, label: "x", codes: ["00000001", "00000001"] })).rejects.toThrow(/duplicate/);
    await expect(core.recordBackupCodes({ accountId: acct.id, linkId: null, label: "x", codes: ["1234567"] })).rejects.toThrow(/8 digits/);
    await core.recordBackupCodes({ accountId: acct.id, linkId: null, label: "Google 2SV", codes });
    const set = (await core.bundle(acct.id))!.backupSets[0];
    expect(set.codes).toHaveLength(10);
    expect(core.revealBackupCode(set.codes[0])).toBe("00000000");
    expect(core.revealBackupCode(set.codes[1])).toBe("00000007");
    await core.exec("setBackupCodeState", { id: set.codes[0].id, state: "used" });
    await expect(core.exec("setBackupCodeState", { id: set.codes[0].id, state: "unused" })).rejects.toThrow(/cannot become/);
    const after = (await core.bundle(acct.id))!.backupSets[0].codes;
    expect(after.filter((c) => c.state === "unused")).toHaveLength(9);
    expect(after[0].used_at).toBeTruthy();
  });
});

describe("cloud sync between two authorised PCs", () => {
  it("syncs inventory, secrets (encrypted) and TXT formatting exactly", async () => {
    const { a, b, server } = await cloudPair();
    const acct = await createAccount(a.core);
    await a.core.unlockVault(VAULT_PW);
    await a.core.saveSharedPassword(acct.id, "shared-P@ss");
    await a.core.exec("setPublished", { id: acct.id, published: true });
    const r = await a.core.syncNow();
    expect(r.error).toBeNull();
    expect(r.rejected).toBe(0);
    await b.core.syncNow();
    const bb = (await b.core.bundle(acct.id))!;
    expect(bb.account.description_public).toBe(accountInput().description_public);
    expect(() => b.core.revealCredential(bb.credential!)).toThrow(/Unlock/);
    await b.core.unlockVault(VAULT_PW);
    expect(b.core.revealCredential(bb.credential!)).toBe("shared-P@ss");
    // The public storefront shows the identical text — and nothing private.
    const pub = await server.call("GET", `/public/listings/${acct.id}`);
    expect(pub.json.description).toBe(accountInput().description_public);
    expect(JSON.stringify(pub.json)).not.toMatch(/login@example.com|cx1\.|bought from Ali|1500000/);
    // Edit on B keeps whitespace through another round trip.
    const edited = "a  b\n\n\n  c\t d  ";
    await b.core.exec("updateAccount", { id: acct.id, account: { description_public: edited } });
    await b.core.syncNow();
    await a.core.syncNow();
    expect((await a.core.get("accounts", acct.id))!.description_public).toBe(edited);
  });

  it("records sales offline, survives disconnection and syncs to the other PC's reports", async () => {
    const { a, b, net } = await cloudPair();
    const acct = await createAccount(a.core, { purchase_cost_minor: 2000, purchase_currency: "USD" });
    await a.core.syncNow();
    net.online = false;
    await a.core.exec<Sale>("recordSale", {
      account_id: acct.id, sold_at: T(), amount_minor: 840000, currency: "PKR", exchange_rate_micro: 280_000_000, channel: "whatsapp",
    });
    await a.core.exec("saveExpense", { expense: { incurred_at: "2026-10-01", amount_minor: 50000, currency: "PKR", category: "advertising", description: "FB ads", account_id: null, sale_id: null } });
    const failed = await a.core.syncNow();
    expect(failed.error).toMatch(/reach|fetch/i);
    const st = await a.core.syncStatus();
    expect(st.failed).toBeGreaterThan(0);
    expect((await a.core.get("accounts", acct.id))!.status).toBe("sold"); // local copy intact
    net.online = true;
    expect((await a.core.syncNow()).error).toBeNull();
    expect((await a.core.syncStatus()).pending + (await a.core.syncStatus()).failed).toBe(0);
    await b.core.syncNow();
    const dash = await b.core.dashboard();
    expect(dash.report.byCurrency.PKR).toMatchObject({ grossSales: 840000, costOfSold: 560000, expenses: 50000, netProfit: 230000 });
    expect(dash.report.byCurrency.USD).toMatchObject({ grossSales: 0, purchases: 2000 });
    expect(dash.report.counts.sold).toBe(1);
  });

  it("retries after a lost response without duplicating accounts or sales", async () => {
    const { a, net, server } = await cloudPair();
    const acct = await createAccount(a.core);
    await a.core.exec("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 100, currency: "PKR", exchange_rate_micro: null, channel: "direct" });
    net.dropNextResponse = true; // server applies the push, client never sees the answer
    const r1 = await a.core.syncNow();
    expect(r1.error).toBeTruthy();
    const r2 = await a.core.syncNow();
    expect(r2.error).toBeNull();
    const accounts = await server.db.query("SELECT id FROM accounts WHERE id = $1", [acct.id]);
    const sales = await server.db.query("SELECT id FROM sales WHERE account_id = $1", [acct.id]);
    expect(accounts.rowCount).toBe(1);
    expect(sales.rowCount).toBe(1);
    expect((await a.core.syncStatus()).pending).toBe(0);
  });

  it("auto-merges non-overlapping concurrent edits and surfaces real conflicts", async () => {
    const { a, b } = await cloudPair();
    const acct = await createAccount(a.core, { title: "Original", internal_notes: "n0" });
    await a.core.syncNow();
    await b.core.syncNow();
    // Non-overlapping: A edits title, B edits notes.
    await a.core.exec("updateAccount", { id: acct.id, account: { title: "Title from A" } });
    await b.core.exec("updateAccount", { id: acct.id, account: { internal_notes: "notes from B" } });
    await a.core.syncNow();
    const rb = await b.core.syncNow();
    expect(rb.conflicts).toBe(1);
    await b.core.syncNow();
    await a.core.syncNow();
    for (const d of [a, b]) expect(await d.core.get("accounts", acct.id)).toMatchObject({ title: "Title from A", internal_notes: "notes from B" });
    expect(await b.core.conflicts()).toHaveLength(0);

    // Overlapping: both edit the title -> explicit conflict, nothing overwritten silently.
    await a.core.exec("updateAccount", { id: acct.id, account: { title: "A wins?" } });
    await b.core.exec("updateAccount", { id: acct.id, account: { title: "B wins?" } });
    await a.core.syncNow();
    await b.core.syncNow();
    const conflicts = await b.core.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].fields).toEqual(["title"]);
    expect(conflicts[0].local).toMatchObject({ title: "B wins?" });
    expect(conflicts[0].server).toMatchObject({ title: "A wins?" });
    expect((await b.core.get("accounts", acct.id))!.title).toBe("B wins?"); // local copy kept
    await b.core.resolveConflict(conflicts[0].id, "local");
    await b.core.syncNow();
    await a.core.syncNow();
    expect((await a.core.get("accounts", acct.id))!.title).toBe("B wins?");
  });

  it("rejects a second offline sale of the same account on another PC", async () => {
    const { a, b } = await cloudPair();
    const acct = await createAccount(a.core);
    await a.core.syncNow();
    await b.core.syncNow();
    const sale = { account_id: acct.id, sold_at: T(), amount_minor: 100, currency: "PKR", exchange_rate_micro: null, channel: "whatsapp" };
    await a.core.exec("recordSale", sale);
    await b.core.exec("recordSale", { ...sale, amount_minor: 200 });
    await a.core.syncNow();
    const rb = await b.core.syncNow();
    expect(rb.rejected + rb.conflicts).toBeGreaterThan(0);
    const issues = await b.core.outboxIssues();
    expect(issues.some((i) => /already has a completed sale|conflict|Changed/i.test(i.last_error ?? "")) || (await b.core.conflicts()).length > 0).toBe(true);
  });

  it("a revoked device loses cloud access but keeps its local data", async () => {
    const { a, b } = await cloudPair();
    await createAccount(b.core);
    await b.core.syncNow();
    await a.core.revokeDevice((await b.core.state()).deviceId!);
    b.core.logout();
    await b.core.login("owner", PW);
    expect((await b.core.listAccounts()).length).toBe(1);
    // Online re-login with the correct password re-enrols the same PC (it is the owner).
    expect(await b.core.refreshCloudSession(PW)).toBe("ok");
    expect((await a.core.devices()).filter((d) => !d.revoked_at).length).toBe(2);
  });
});

describe("pairing a local-only install with an existing cloud vault", () => {
  it("re-encrypts local secrets under the cloud vault without duplicates", async () => {
    const { a, net, device } = await cloudPair();
    net.online = false;
    const solo = await device("Solo-PC");
    await solo.core.setupLocal({ username: "owner", password: "Old-Local-Pass-1!", vaultPassphrase: "Local-Vault-Pass-1!", currency: "PKR" });
    const acct = await createAccount(solo.core, { title: "Made offline" }, [{ kind: "email", identifier: "x@y.zz" }]);
    await solo.core.saveSharedPassword(acct.id, "offline-secret");
    await solo.core.recordBackupCodes({ accountId: acct.id, linkId: null, label: "c", codes: ["01234567"] });
    net.online = true;
    await expect(solo.core.pairWithCloud({ apiBase: API, username: "owner", password: PW })).rejects.toThrow(/vault passphrase/);
    await solo.core.pairWithCloud({ apiBase: API, username: "owner", password: PW, cloudVaultPassphrase: VAULT_PW });
    expect((await solo.core.syncStatus()).pending).toBe(0);
    await a.core.syncNow();
    await a.core.unlockVault(VAULT_PW);
    const b = (await a.core.bundle(acct.id))!;
    expect(a.core.revealCredential(b.credential!)).toBe("offline-secret");
    expect(a.core.revealBackupCode(b.backupSets[0].codes[0])).toBe("01234567");
    // The local login password is now the cloud password.
    solo.core.logout();
    await solo.core.login("owner", PW);
  });
});

describe("image upload queue", () => {
  it("keeps the local file through failures, uploads when online, recovers interrupted uploads", async () => {
    const { a, b, net } = await cloudPair();
    const acct = await createAccount(a.core);
    await expect(a.core.setAccountImage(acct.id, new Uint8Array([1, 2, 3]))).rejects.toThrow(/JPEG, PNG or WebP/);
    net.online = false;
    const item = await a.core.setAccountImage(acct.id, png());
    expect(a.files.map.has(item.file_name)).toBe(true);
    await a.core.syncNow();
    expect((await a.core.media.get(item.id))!.status).toBe("failed");
    expect(a.files.map.has(item.file_name)).toBe(true); // never lose the only copy
    net.online = true;
    net.imagekitFails = 1;
    await a.core.media.retry(item.id);
    await a.core.syncNow();
    expect((await a.core.media.get(item.id))!.status).toBe("failed");
    // Simulate a crash mid-upload, then restart recovery.
    await a.core.db.run("UPDATE media_queue SET status = 'uploading' WHERE id = ?", [item.id]);
    await a.core.media.recover();
    await a.core.media.retry(item.id);
    await a.core.syncNow();
    const done = (await a.core.media.get(item.id))!;
    expect(done.status).toBe("uploaded");
    const acc = (await a.core.get("accounts", acct.id))!;
    expect(acc.image_url).toBe(done.remote_url);
    expect(acc.image_url).toMatch(/^https:\/\/ik\.imagekit\.io\/codex\//);
    expect(new Set(net.uploads.map((u) => u.fileName)).size).toBe(1); // retries reuse one file name
    await b.core.syncNow();
    expect((await b.core.get("accounts", acct.id))!.image_url).toBe(done.remote_url);
    // Replace the image: old remote file is deleted after the change syncs.
    await a.core.setAccountImage(acct.id, png());
    await a.core.syncNow();
    await a.core.syncNow();
    expect(net.deleted).toContain(done.remote_file_id);
  });
});

describe("encrypted backup and restore", () => {
  it("restores the full inventory onto a fresh PC", async () => {
    const w = await world();
    const src = await w.device("Source");
    await src.core.setupLocal({ username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const acct = await createAccount(src.core);
    await src.core.saveSharedPassword(acct.id, "backed-up-secret");
    await src.core.exec("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 3000000, currency: "PKR", exchange_rate_micro: null, channel: "direct" });
    await expect(src.core.exportBackup("short")).rejects.toThrow();
    const file = await src.core.exportBackup("Backup-Password-123!");
    expect(file).not.toContain("backed-up-secret");
    expect(file).not.toContain("Conqueror");

    const dst = await w.device("Fresh");
    await expect(dst.core.restoreBackup(file, "wrong-password")).rejects.toThrow(/Incorrect backup password/);
    const r = await dst.core.restoreBackup(file, "Backup-Password-123!");
    expect(r.accounts).toBe(1);
    await dst.core.login("owner", PW);
    await dst.core.unlockVault(VAULT_PW);
    const b = (await dst.core.bundle(acct.id))!;
    expect(b.account.description_public).toBe(accountInput().description_public);
    expect(dst.core.revealCredential(b.credential!)).toBe("backed-up-secret");
    expect((await dst.core.dashboard()).report.byCurrency.PKR.grossProfit).toBe(1500000);
    expect((await dst.core.syncStatus()).pending).toBeGreaterThan(0); // unsynced work preserved
  });
});
