import { beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  autoSchedule,
  computeConsolidated,
  computeReport,
  newId,
  planStateOf,
  type InstallmentPlan,
  type PaymentReceiptData,
  type PlanReceiptData,
} from "@codex/shared";
import { migrationStatus, MIGRATIONS, PgEntityStore, resolvePublicListing, queryPublicSitemap, queryPublicListings, getUsdtPkrQuote } from "../src";
import { setupOwner, startServer, type TestServer } from "./helpers";

const R = (rupees: number) => Math.round(rupees * 100);
const START = "2026-11-03";

let s: TestServer;
let token: string;
const cmd = async (name: string, args: unknown) => {
  const r = await s.call("POST", `/admin/commands/${name}`, { body: args, token });
  return r;
};
const ok = async (name: string, args: unknown) => {
  const r = await cmd(name, args);
  if (r.status !== 200) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.result;
};
const list = async (entity: string, q = "") => (await s.call("GET", `/admin/entities/${entity}${q}`, { token })).json;

async function newAccount(title = "Conqueror S12 — Glacier M416", price = R(100_000)) {
  const id = newId();
  await ok("createAccount", {
    id,
    account: { title, purchase_cost_minor: R(60_000), purchase_currency: "PKR", list_price_minor: price, list_currency: "PKR", description_public: "Glacier M416 lvl 7" },
    links: [{ kind: "email", identifier: "login@example.com" }],
  });
  return id;
}

/** Mark as Sold -> Installments with the owner's example. */
async function examplePlan(over: { advanceReceived?: boolean } = {}) {
  const accountId = await newAccount();
  const ids = { sale: newId(), plan: newId(), receipt: newId(), advance: newId() };
  const schedule = autoSchedule({ first_due_on: addDays(START, 20), count: 3, interval_days: 20, principal_minor: R(50_000) });
  await ok("createInstallmentSale", {
    sale: { id: ids.sale, account_id: accountId, sold_at: `${START}T10:00:00.000Z`, exchange_rate_micro: null, channel: "whatsapp", reference: null, notes: null },
    currency: "PKR",
    plan_id: ids.plan,
    receipt_id: ids.receipt,
    issued_on: START,
    plan: {
      customer_name: "Bilal", customer_whatsapp: "+92 300 1234567", original_minor: R(100_000), advance_minor: R(50_000), advance_due_on: START, start_on: START,
      duration_months: 3, schedule_mode: "auto", interval_days: 20, first_due_on: schedule[0].due_on, schedule,
      extra_rate_minor: R(400), extra_free_days: 30, extra_end: "final_due", fine_minor: R(1_500), fine_mode: "flat", fine_grace_days: 0,
    },
    advance_payment: over.advanceReceived === false ? null : { id: ids.advance, paid_on: START, amount_minor: R(50_000), currency: "PKR", method: "jazzcash", reference: "TID-1" },
  });
  return { accountId, ...ids, schedule };
}

beforeEach(async () => {
  s = await startServer({ now: () => new Date("2027-02-01T09:00:00.000Z") });
  token = (await setupOwner(s)).token;
});

describe("installment sale (Mark as Sold → Installments) through the API", () => {
  it("records the sale once at the original price, the plan, the advance and the Payment Plan receipt", async () => {
    const p = await examplePlan();
    const [sale] = await list("sales", `?account_id=${p.accountId}`);
    expect(sale).toMatchObject({ amount_minor: R(100_000), currency: "PKR", status: "completed", buyer_name: "Bilal" });
    const [acct] = (await list("accounts")).filter((a: { id: string }) => a.id === p.accountId);
    expect(acct.status).toBe("sold");
    expect(acct.published).toBe(false);

    const [plan] = (await list("installment_plans")) as InstallmentPlan[];
    const payments = await list("payments", `?plan_id=${plan.id}`);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ kind: "advance", amount_minor: R(50_000), credited_minor: R(50_000), receipt_no: expect.stringMatching(/^PR-261103-[0-9A-F]{6}$/) });

    const st = planStateOf(plan, payments, START);
    expect(st.entries.slice(1).map((e) => [e.principal, e.extra, e.due_total])).toEqual([
      [1_666_667, 0, 1_666_667],
      [1_666_667, R(4_000), 2_066_667],
      [1_666_666, R(8_000), 2_466_666],
    ]);
    expect(st.totals.grand_total).toBe(R(112_000));

    const receipts = await list("receipts", `?plan_id=${plan.id}`);
    const planReceipt = receipts.find((r: { kind: string }) => r.kind === "plan");
    const data = JSON.parse(planReceipt.data_json) as PlanReceiptData;
    expect(data.plan.advance_paid).toBe(true);
    expect(data.totals).toMatchObject({ original: R(100_000), advance: R(50_000), extra: R(12_000), grand_total: R(112_000) });
    expect(data.rows.map((r) => r.free)).toEqual([true, false, false]);
    // Only public business details: no login, password or private note fields in any receipt.
    for (const r of receipts) expect(r.data_json).not.toMatch(/login@example\.com|secret|password|internal_notes/i);
    const advReceipt = JSON.parse(receipts.find((r: { kind: string }) => r.kind === "payment").data_json) as PaymentReceiptData;
    expect(advReceipt.payment).toMatchObject({ is_advance: true, amount: R(50_000), method: "JazzCash" });
  });

  it("is idempotent: a resubmitted plan or payment is reported as already recorded, never duplicated", async () => {
    const p = await examplePlan();
    const again = await cmd("createInstallmentSale", { sale: { id: p.sale }, plan_id: p.plan, plan: {}, receipt_id: newId(), currency: "PKR", issued_on: START });
    expect(again.json.error.code).toBe("exists");
    const pay = { id: newId(), plan_id: p.plan, kind: "installment", paid_on: "2026-11-23", amount_minor: 1_666_667, currency: "PKR", method: "cash" };
    await ok("recordPlanPayment", pay);
    expect((await cmd("recordPlanPayment", pay)).json.error.code).toBe("exists");
    expect(await list("payments", `?plan_id=${p.plan}`)).toHaveLength(2);
  });

  it("partial payments, late fine, waiver and settlement with early payoff", async () => {
    const p = await examplePlan();
    await ok("recordPlanPayment", { id: newId(), plan_id: p.plan, kind: "installment", paid_on: "2026-11-23", amount_minor: 1_666_667, currency: "PKR", method: "cash" });
    // Installment 2 paid late (due 13 Dec): first 10,000, then the rest + fine.
    await ok("recordPlanPayment", { id: newId(), plan_id: p.plan, kind: "installment", paid_on: "2026-12-15", amount_minor: R(10_000), currency: "PKR", method: "cash" });
    let [plan] = (await list("installment_plans")) as InstallmentPlan[];
    let st = planStateOf(plan, await list("payments", `?plan_id=${p.plan}`), "2026-12-16");
    expect(st.entries[2].fine).toBe(R(1_500));
    expect(st.entries[2].status).toBe("overdue");
    await ok("waiveFine", { plan_id: p.plan, n: 2, minor: R(500), reason: "First time late", as_of: "2026-12-16" });
    // Settle everything on 20 Dec: Daily Extra only up to that day (days 41–47 for installment 3).
    const quoteDay = "2026-12-20";
    [plan] = (await list("installment_plans")) as InstallmentPlan[];
    st = planStateOf(plan, await list("payments", `?plan_id=${p.plan}`), quoteDay);
    const settle = await cmd("recordPlanPayment", { id: newId(), plan_id: p.plan, kind: "settlement", paid_on: quoteDay, amount_minor: R(1_000), currency: "PKR", method: "cash" });
    expect(settle.json.error.code).toBe("settle_short");
    const remaining = 2_066_667 - R(10_000) + R(1_000) + 1_666_666 + R(400) * 7;
    await ok("recordPlanPayment", { id: newId(), plan_id: p.plan, kind: "settlement", paid_on: quoteDay, amount_minor: remaining, currency: "PKR", method: "bank" });
    [plan] = (await list("installment_plans")) as InstallmentPlan[];
    st = planStateOf(plan, await list("payments", `?plan_id=${p.plan}`), "2027-02-01");
    expect(st.status).toBe("paid");
    expect(st.settled_on).toBe(quoteDay);
    expect(st.entries[3].extra).toBe(R(2_800));
    expect(st.totals.credit).toBe(0);

    // Reports: the sale counts once; profit adds only Daily Extra and the (net) fine actually collected.
    const [accounts, sales, payments, plans] = await Promise.all([list("accounts"), list("sales"), list("payments"), list("installment_plans")]);
    const r = computeReport({ accounts, sales, refunds: [], expenses: [], plans, payments, asOf: "2027-02-01" }).byCurrency.PKR;
    expect(r.grossSales).toBe(R(100_000));
    expect(r.planExtras).toBe(R(4_000) + R(2_800));
    expect(r.planFines).toBe(R(1_000));
    expect(r.netProfit).toBe(R(100_000) - R(60_000) + R(6_800) + R(1_000));
    expect(r.incoming).toBe(st.totals.received);
    const c = computeConsolidated({ accounts, sales, refunds: [], expenses: [], plans, payments, asOf: "2027-02-01" });
    expect(c.netProfit).toBe(r.netProfit);
  });

  it("payments are never edited: reversal keeps the record and its receipt", async () => {
    const p = await examplePlan();
    const id = newId();
    await ok("recordPlanPayment", { id, plan_id: p.plan, kind: "installment", paid_on: "2026-11-23", amount_minor: 1_666_667, currency: "PKR", method: "cash" });
    expect((await cmd("reversePayment", { id, reason: "x" })).json.error.code).toBe("reason");
    await ok("reversePayment", { id, reason: "Entered twice by mistake" });
    const pay = (await list("payments", `?plan_id=${p.plan}`)).find((x: { id: string }) => x.id === id);
    expect(pay).toMatchObject({ status: "reversed", reversal_reason: "Entered twice by mistake", amount_minor: 1_666_667 });
    expect((await list("receipts", `?plan_id=${p.plan}`)).some((r: { payment_id: string }) => r.payment_id === id)).toBe(true);
    // A raw sync push that tries to change a recorded payment's amount is refused.
    const row = { ...pay, amount_minor: 1, credited_minor: 1, allocations_json: JSON.stringify([{ n: 1, part: "principal", minor: 1 }]) };
    const push = await s.call("POST", "/sync/push", { token, body: { ops: [{ op_id: newId(), entity: "payments", id, base_rev: pay.rev, row }] } });
    expect(push.json.results[0]).toMatchObject({ status: "rejected", code: "payment_immutable" });
  });

  it("schedule revisions keep paid installments and are recorded with old/new dates and the reason", async () => {
    const p = await examplePlan();
    await ok("recordPlanPayment", { id: newId(), plan_id: p.plan, kind: "installment", paid_on: "2026-11-23", amount_minor: 1_666_667, currency: "PKR", method: "cash" });
    const bad = await cmd("revisePlan", { plan_id: p.plan, revision: { kind: "move", n: 1, due_on: "2026-11-30", scope: "one" }, reason: "test", as_of: "2026-11-24" });
    expect(bad.json.error.code).toBe("rev_paid");
    await ok("revisePlan", { plan_id: p.plan, revision: { kind: "move", n: 2, due_on: "2026-12-20", scope: "following", interval_days: 20 }, reason: "Customer travelling", as_of: "2026-11-24" });
    const [plan] = (await list("installment_plans")) as InstallmentPlan[];
    expect(plan.revision).toBe(1);
    expect(JSON.parse(plan.schedule_json).map((x: { due_on: string }) => x.due_on)).toEqual(["2026-11-23", "2026-12-20", "2027-01-09"]);
    const ev = (await s.call("GET", "/admin/audit", { token })).json.find((e: { action: string }) => e.action === "plan.revised");
    const d = JSON.parse(ev.details);
    expect(d).toMatchObject({ revision: 1, reason: "Customer travelling", kind: "move", scope: "following" });
    expect(d.changes[0]).toMatchObject({ n: 2, from: { due_on: "2026-12-13" }, to: { due_on: "2026-12-20" } });
  });

  it("a sale with plan payments cannot be voided or refunded; a mistaken plan can be cancelled with the sale undone", async () => {
    const p = await examplePlan();
    expect((await cmd("voidSale", { id: p.sale })).json.error.code).toBe("plan_has_payments");
    const q = await examplePlan({ advanceReceived: false });
    expect((await cmd("recordRefund", { sale_id: q.sale, refunded_at: "2026-11-04T00:00:00.000Z", amount_minor: R(1_000), restock: false })).json.error.code).toBe("plan_active");
    await ok("cancelPlan", { plan_id: q.plan, reason: "Entered by mistake", cancelled_on: START, undo_sale: true });
    const acct = (await list("accounts")).find((a: { id: string }) => a.id === q.accountId);
    expect(acct.status).toBe("available");
    const sale = (await list("sales")).find((x: { id: string }) => x.id === q.sale);
    expect(sale.status).toBe("voided");
  });

  it("a payment in USDT needs an explicit rate and is credited in the plan currency", async () => {
    const p = await examplePlan();
    const noRate = await cmd("recordPlanPayment", { id: newId(), plan_id: p.plan, kind: "installment", paid_on: "2026-11-23", amount_minor: 6_000, currency: "USDT", method: "usdt" });
    expect(noRate.json.error.code).toBe("rate_required");
    const id = newId();
    await ok("recordPlanPayment", { id, plan_id: p.plan, kind: "installment", paid_on: "2026-11-23", amount_minor: 6_000, currency: "USDT", rate_micro: 281_500_000, rate_source: "manual", method: "usdt", reference: "0xabc" });
    const pay = (await list("payments", `?plan_id=${p.plan}`)).find((x: { id: string }) => x.id === id);
    expect(pay).toMatchObject({ amount_minor: 6_000, currency: "USDT", credited_minor: R(16_890), rate_micro: 281_500_000, pkr_micro: 281_500_000 });
  });
});

describe("money to receive / to pay", () => {
  it("tracks partial payments (20,000 → 5,000, 10,000, 5,000) and keeps the principal out of profit", async () => {
    const id = newId();
    await ok("saveDebt", { id, debt: { direction: "receive", party_name: "Ali", original_minor: R(20_000), currency: "PKR", txn_on: "2026-10-01", due_on: "2026-12-01" } });
    for (const amt of [5_000, 10_000]) await ok("recordDebtPayment", { id: newId(), debt_id: id, paid_on: "2026-11-01", amount_minor: R(amt), currency: "PKR", method: "cash" });
    const { computeDebtState } = await import("@codex/shared");
    let [debt] = await list("debts");
    expect(computeDebtState(debt, await list("payments", `?debt_id=${id}`), "2026-11-02")).toMatchObject({ paid: R(15_000), remaining: R(5_000), status: "partial" });
    await ok("addDebtCharge", { debt_id: id, kind: "charge", minor: R(500), label: "Service charge", on: "2026-11-02" });
    await ok("recordDebtPayment", { id: newId(), debt_id: id, paid_on: "2026-11-05", amount_minor: R(5_500), currency: "PKR", method: "cash" });
    [debt] = await list("debts");
    expect(computeDebtState(debt, await list("payments", `?debt_id=${id}`), "2026-11-06")).toMatchObject({ remaining: 0, status: "settled", paid_principal: R(20_000), paid_charges: R(500) });
    const c = computeConsolidated({ accounts: [], sales: [], refunds: [], expenses: [], payments: await list("payments"), debts: await list("debts") });
    expect(c.netProfit).toBe(R(500)); // only the service charge
  });

  it("USDT records stay in USDT; paying them back is not an expense", async () => {
    const id = newId();
    await ok("saveDebt", { id, debt: { direction: "pay", party_name: "Supplier", original_minor: 30_000, currency: "USDT", txn_on: "2026-11-01" } });
    await ok("recordDebtPayment", { id: newId(), debt_id: id, paid_on: "2026-11-02", amount_minor: 10_000, currency: "USDT", method: "usdt", pkr_micro: 281_000_000, pkr_source: "manual" });
    const c = computeConsolidated({ accounts: [], sales: [], refunds: [], expenses: [], payments: await list("payments"), debts: await list("debts") });
    expect(c.netProfit).toBe(0);
    expect((await cmd("saveDebt", { id, expected_rev: 1, debt: { direction: "pay", party_name: "Supplier", original_minor: 30_000, currency: "USD", txn_on: "2026-11-01" } })).json.error.code).toBe("debt_locked");
  });
});

describe("readable account URLs", () => {
  it("assigns a slug from the title, a short suffix for duplicates, and redirects old slugs and old id links", async () => {
    const a = await newAccount("Blood Raven MAXX with Alan Walker Emote");
    const b = await newAccount("Blood Raven MAXX — with Alan Walker Emote!");
    for (const id of [a, b]) await ok("setPublished", { id, published: true });
    const accounts = await list("accounts");
    const slugA = accounts.find((x: { id: string }) => x.id === a).slug;
    const slugB = accounts.find((x: { id: string }) => x.id === b).slug;
    expect(slugA).toBe("blood-raven-maxx-with-alan-walker-emote");
    expect(slugB).toBe(`blood-raven-maxx-with-alan-walker-emote-${b.replace(/-/g, "").slice(-4)}`);
    expect(await resolvePublicListing(s.db, slugA)).toMatchObject({ listing: { id: a, slug: slugA } });
    expect(await resolvePublicListing(s.db, a)).toEqual({ redirect: slugA });
    // Title change: new slug, the old one redirects (never reused for another account).
    await ok("updateAccount", { id: a, account: { title: "Blood Raven X-Suit Maxed" } });
    const newSlug = (await list("accounts")).find((x: { id: string }) => x.id === a).slug;
    expect(newSlug).toBe("blood-raven-x-suit-maxed");
    expect(await resolvePublicListing(s.db, slugA)).toEqual({ redirect: newSlug });
    const c = await newAccount("Blood Raven MAXX with Alan Walker Emote");
    expect((await list("accounts")).find((x: { id: string }) => x.id === c).slug).not.toBe(slugA);
    // Sitemap: published accounts by canonical slug only.
    const map = await queryPublicSitemap(s.db);
    expect(map.map((m) => m.slug).sort()).toEqual([newSlug, slugB].sort());
    expect((await queryPublicListings(s.db)).every((l) => !!l.slug)).toBe(true);
    // Unpublished: no page, no redirect.
    await ok("setPublished", { id: b, published: false });
    expect(await resolvePublicListing(s.db, slugB)).toBeNull();
  });

  it("gives accounts saved before slugs existed a slug without bumping their revision", async () => {
    const id = await newAccount("Old account from 1.0.4");
    await s.db.query("UPDATE accounts SET slug = NULL WHERE id = $1", [id]);
    const before = (await s.db.query<{ rev: number }>("SELECT rev FROM accounts WHERE id = $1", [id])).rows[0].rev;
    const { backfillSlugs } = await import("../src");
    expect(await backfillSlugs(s.db)).toBe(1);
    const after = (await s.db.query<{ rev: number; slug: string }>("SELECT rev, slug FROM accounts WHERE id = $1", [id])).rows[0];
    expect(after).toEqual({ rev: before, slug: "old-account-from-1-0-4" });
  });
});

describe("database migration 0003", () => {
  it("is applied, additive and safe to run again", async () => {
    const st = await migrationStatus(s.db);
    expect(st.applied).toContain("0003_payments_slugs");
    expect(st.pending).toEqual([]);
    expect(MIGRATIONS.find((m) => m.id === "0003_payments_slugs")!.sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
    // The rate cache now also accepts the USDT/PKR pair (the widened check constraint).
    await s.db.query("INSERT INTO fx_rates (pair, rate_micro) VALUES ('USDT/PKR', 281000000)");
    await expect(s.db.query("INSERT INTO fx_rates (pair, rate_micro) VALUES ('EUR/PKR', 1)")).rejects.toThrow();
  });

  it("issued receipts are immutable", async () => {
    const p = await examplePlan();
    const [r] = await list("receipts", `?plan_id=${p.plan}`);
    const store = new PgEntityStore(s.db, "test");
    const { checkInvariants } = await import("@codex/shared");
    await expect(checkInvariants(store, "receipts", { ...r, data_json: "{}" }, r)).rejects.toThrow(/cannot be changed/);
  });
});

describe("USDT/PKR reference rate", () => {
  it("is cached from the provider, never invented, and shows as unavailable when the provider fails", async () => {
    let calls = 0;
    const good = (async () => {
      calls++;
      return new Response(JSON.stringify({ tether: { pkr: 281.37, last_updated_at: Math.floor(Date.parse("2027-02-01T08:55:00Z") / 1000) } }), { status: 200 });
    }) as unknown as typeof fetch;
    const now = new Date("2027-02-01T09:00:00.000Z");
    const q = await getUsdtPkrQuote(s.db, { fetchImpl: good, now, usdt: {} });
    expect(q).toMatchObject({ usdt_pkr_micro: 281_370_000, source: "CoinGecko", manual: false, status: "fresh" });
    await getUsdtPkrQuote(s.db, { fetchImpl: good, now, usdt: {} });
    expect(calls).toBe(1);
    const fresh = await startServer();
    const bad = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await getUsdtPkrQuote(fresh.db, { fetchImpl: bad, now, usdt: {} })).toBeNull();
    const weird = (async () => new Response(JSON.stringify({ tether: { pkr: -5 } }), { status: 200 })) as unknown as typeof fetch;
    const fresh2 = await startServer();
    expect(await getUsdtPkrQuote(fresh2.db, { fetchImpl: weird, now, usdt: {} })).toBeNull();
  });
});
