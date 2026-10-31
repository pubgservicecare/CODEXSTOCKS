// Desktop (offline-first) exchange rates: cached quote, offline transactions keep their recorded rate
// through sync, and both PCs report identical consolidated books.
import { describe, expect, it } from "vitest";
import { computeConsolidated, saleRateFromUsdPkr, type Account, type Expense, type Sale } from "@codex/shared";
import { accountInput, API, PW, T, VAULT_PW, world } from "./harness";
import { SETUP_TOKEN } from "../../server/test/helpers";

async function pair() {
  const w = await world();
  w.server.cfg.fx = {}; // enable the (simulated) rate provider
  const a = await w.device("PC-A");
  await a.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
  const b = await w.device("PC-B");
  await b.core.connectExisting({ apiBase: API, username: "owner", password: PW });
  return { ...w, a, b };
}

const links = [{ kind: "email", identifier: "x@y.zz" }];

describe("exchange rates on the desktop", () => {
  it("fetches the reference quote online, remembers it, and serves it offline with an honest status", async () => {
    const w = await pair();
    w.net.fxRate = 278.5;
    const online = await w.a.core.fxQuote();
    expect(online).toMatchObject({ usd_pkr_micro: 278_500_000, source: "ExchangeRate-API", frequency: "daily", status: "fresh" });
    w.net.online = false;
    const offline = await w.a.core.fxQuote();
    expect(offline).toMatchObject({ usd_pkr_micro: 278_500_000, status: "fresh" });
    // A PC that never received a quote has none offline (nothing is invented).
    const fresh = await w.device("PC-C");
    expect(await fresh.core.fxQuote()).toBeNull();
  });

  it("an offline USD sale keeps exactly the rate used when it was recorded, through sync and later rate changes", async () => {
    const w = await pair();
    w.net.fxRate = 280;
    const quote = (await w.a.core.fxQuote())!;
    const acct = await w.a.core.exec<Account>("createAccount", {
      account: accountInput({ purchase_cost_minor: 1_400_000, purchase_currency: "PKR", list_price_minor: 6_000, list_currency: "USD" }),
      links,
    });
    await w.a.core.syncNow();

    w.net.online = false;
    const cached = (await w.a.core.fxQuote())!; // offline: the remembered quote
    const sale = await w.a.core.exec<Sale>("recordSale", {
      account_id: acct.id, sold_at: T(), amount_minor: 6_000, currency: "USD", channel: "whatsapp",
      exchange_rate_micro: saleRateFromUsdPkr("PKR", "USD", cached.usd_pkr_micro),
      fx_usd_pkr_micro: cached.usd_pkr_micro, fx_source: cached.source, fx_at: cached.effective_at ?? cached.retrieved_at,
    });
    const expense = await w.a.core.exec<Expense>("saveExpense", {
      expense: { incurred_at: "2026-10-30", amount_minor: 1_000, currency: "USD", category: "advertising", description: "ads", account_id: null, sale_id: null,
        fx_usd_pkr_micro: cached.usd_pkr_micro, fx_source: cached.source, fx_at: cached.effective_at ?? cached.retrieved_at },
    });

    // Meanwhile the reference rate moves; syncing must NOT replace the recorded rate.
    w.net.online = true;
    w.net.fxRate = 300;
    w.server.cfg.fx = { refreshMinutes: 60 };
    await w.server.db.query("UPDATE fx_rates SET retrieved_at = now() - interval '2 days', next_update_at = now() - interval '1 hour', last_attempt_at = NULL");
    expect((await w.a.core.syncNow()).error).toBeNull();
    expect((await w.a.core.fxQuote())!.usd_pkr_micro).toBe(300_000_000);
    await w.b.core.syncNow();

    for (const core of [w.a.core, w.b.core]) {
      const s = (await core.get("sales", sale.id))!;
      expect(s).toMatchObject({ fx_usd_pkr_micro: quote.usd_pkr_micro, fx_source: "ExchangeRate-API", exchange_rate_micro: sale.exchange_rate_micro });
      expect((await core.get("expenses", expense.id))!.fx_usd_pkr_micro).toBe(280_000_000);
    }
    const cloud = await w.server.db.query<{ fx_usd_pkr_micro: string }>("SELECT fx_usd_pkr_micro FROM sales WHERE id = $1", [sale.id]);
    expect(Number(cloud.rows[0].fx_usd_pkr_micro)).toBe(280_000_000);

    // Both PCs compute identical consolidated books from the same recorded rates.
    const books = async (core: typeof w.a.core) =>
      computeConsolidated({ accounts: await core.list("accounts"), sales: await core.list("sales"), refunds: await core.list("refunds"), expenses: await core.list("expenses") });
    const [ba, bb] = [await books(w.a.core), await books(w.b.core)];
    expect(ba).toEqual(bb);
    expect(ba.grossSales).toBe(1_680_000); // $60 × 280, not × 300
    expect(ba.expenses).toBe(280_000); // $10 × 280
    expect(ba.costOfSold).toBe(1_400_000);

    const actions = (await w.a.core.audit(acct.id)).map((e) => e.action);
    expect(actions).toContain("sale.recorded");
    const ev = (await w.a.core.audit()).find((e) => e.action === "sale.recorded")!;
    expect(JSON.parse(ev.details)).toMatchObject({ usd_pkr_micro: 280_000_000, fx_source: "ExchangeRate-API" });
  });

  it("a refund uses its sale's recorded rate", async () => {
    const w = await pair();
    w.net.fxRate = 281;
    const q = (await w.a.core.fxQuote())!;
    const acct = await w.a.core.exec<Account>("createAccount", { account: accountInput({ purchase_cost_minor: 4_000, purchase_currency: "USD", purchase_fx_micro: q.usd_pkr_micro, purchase_fx_source: q.source, purchase_fx_at: q.retrieved_at }), links });
    const sale = await w.a.core.exec<Sale>("recordSale", { account_id: acct.id, sold_at: T(), amount_minor: 6_000, currency: "USD", channel: "direct", exchange_rate_micro: null, fx_usd_pkr_micro: q.usd_pkr_micro, fx_source: q.source, fx_at: q.retrieved_at });
    await w.a.core.exec("recordRefund", { sale_id: sale.id, refunded_at: T(), amount_minor: 6_000, reason: "returned", restock: true });
    const c = computeConsolidated({ accounts: await w.a.core.list("accounts"), sales: await w.a.core.list("sales"), refunds: await w.a.core.list("refunds"), expenses: [] });
    expect(c).toMatchObject({ grossSales: 1_686_000, refunds: 1_686_000, netSales: 0, costOfSold: 0, inventoryValue: 1_124_000 });
  });
});
