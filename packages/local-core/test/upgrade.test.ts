// Upgrading the desktop app: a local database written by a version without the exchange-rate snapshot columns
// (desktop 1.0.3 and earlier) is opened by the current version without losing or changing any data.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Account, Sale } from "@codex/shared";
import { accountInput, API, PW, T, VAULT_PW, world } from "./harness";
import { SETUP_TOKEN } from "../../server/test/helpers";

const SNAPSHOT_COLUMNS: Record<string, string[]> = {
  accounts: ["purchase_fx_micro", "purchase_fx_source", "purchase_fx_at"],
  sales: ["fx_usd_pkr_micro", "fx_source", "fx_at", "fx_override_reason"],
  expenses: ["fx_usd_pkr_micro", "fx_source", "fx_at"],
};
const links = [{ kind: "email", identifier: "x@y.zz" }];

describe("desktop upgrade from a database without exchange-rate columns", () => {
  it("adds the columns empty, keeps every existing row and secret, and records snapshots afterwards", async () => {
    const w = await world();
    const d = await w.device("Old-PC");
    await d.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const acct = await d.core.exec<Account>("createAccount", { account: accountInput(), links });
    await d.core.saveSharedPassword(acct.id, "Old-PC-secret!");
    const sale = await d.core.exec<Sale>("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 2_400_000, currency: "PKR", channel: "whatsapp" });
    expect((await d.core.syncNow()).error).toBeNull();
    const before = { account: (await d.core.get("accounts", acct.id))!, sale: (await d.core.get("sales", sale.id))! };
    d.driver.close();

    // Make the file look exactly like what the older version left behind.
    const raw = new DatabaseSync(d.path);
    for (const [table, cols] of Object.entries(SNAPSHOT_COLUMNS)) for (const c of cols) raw.exec(`ALTER TABLE ${table} DROP COLUMN ${c}`);
    raw.close();

    const again = await w.device("Old-PC", d.path, d.files);
    for (const [table, cols] of Object.entries(SNAPSHOT_COLUMNS)) {
      const have = (await again.core.db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
      expect(have).toEqual(expect.arrayContaining(cols));
    }
    await again.core.login("owner", PW);
    expect(await again.core.get("accounts", acct.id)).toEqual(before.account);
    expect(await again.core.get("sales", sale.id)).toEqual(before.sale);
    expect(before.sale).toMatchObject({ amount_minor: 2_400_000, fx_usd_pkr_micro: null });
    await again.core.unlockVault(VAULT_PW);
    const b = (await again.core.bundle(acct.id))!;
    expect(again.core.revealCredential(b.credential!)).toBe("Old-PC-secret!");

    // The upgraded database stores new snapshots and syncs them.
    const usd = await again.core.exec<Account>("createAccount", {
      account: accountInput({ title: "After upgrade", purchase_cost_minor: 5_000, purchase_currency: "USD", purchase_fx_micro: 280_000_000, purchase_fx_source: "ExchangeRate-API", purchase_fx_at: T() }),
      links,
    });
    expect((await again.core.syncNow()).error).toBeNull();
    const cloud = await w.server.db.query<{ purchase_fx_micro: string }>("SELECT purchase_fx_micro FROM accounts WHERE id = $1", [usd.id]);
    expect(Number(cloud.rows[0].purchase_fx_micro)).toBe(280_000_000);
    const old = await w.server.db.query<{ amount_minor: string }>("SELECT amount_minor FROM sales WHERE id = $1", [sale.id]);
    expect(Number(old.rows[0].amount_minor)).toBe(2_400_000);
  });
});
