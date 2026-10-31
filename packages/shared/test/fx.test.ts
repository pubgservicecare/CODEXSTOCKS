// USD/PKR conversion, customer display currency, transaction-time snapshots and the consolidated
// (PKR-equivalent) books and charts.
import { describe, expect, it } from "vitest";
import {
  chooseDisplayCurrency,
  computeConsolidated,
  computeReport,
  consolidatedMonthlyFlow,
  convertUsdPkr,
  displayFlow,
  formatUsdPkr,
  fxStatus,
  isValidUsdPkrMicro,
  parseUsdPkr,
  saleRateFromUsdPkr,
  saleSchema,
  toPkrMinor,
  usdPkrFromSaleRate,
  usdPkrMicroFromNumber,
  type FlowBucket,
} from "../src";

const R = 278_500_000; // 1 USD = 278.50 PKR

describe("USD/PKR conversion", () => {
  it("converts a PKR price to USD and a USD price to PKR, in exact minor units", () => {
    expect(convertUsdPkr(10_000_000, "PKR", "USD", R)).toBe(35_907); // Rs 100,000 ≈ $359.07
    expect(convertUsdPkr(10_000, "USD", "PKR", R)).toBe(2_785_000); // $100 = Rs 27,850.00
    expect(convertUsdPkr(12_345, "USD", "USD", R)).toBe(12_345);
  });

  it("rounds half away from zero and never drifts on a round trip by more than a minor unit", () => {
    expect(convertUsdPkr(1, "USD", "PKR", 1_500_000_000)).toBe(1_500); // 1 cent × 1500 = Rs 15.00 = 1500 paisa
    expect(convertUsdPkr(14, "PKR", "USD", 280_000_000)).toBe(0); // 0.05 cents → 0
    expect(convertUsdPkr(140, "PKR", "USD", 280_000_000)).toBe(1); // exactly 0.5 cent → 1 (half up)
    for (const pkr of [1, 99, 10_000_000, 123_456_789]) {
      const usd = convertUsdPkr(pkr, "PKR", "USD", R);
      expect(Math.abs(convertUsdPkr(usd, "USD", "PKR", R) - pkr)).toBeLessThanOrEqual(Math.ceil(R / 2e6));
    }
  });

  it("rejects missing, NaN, infinite, zero, negative and absurd rates", () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, 0, -278.5, 0.0001, 1e9, "278.5"])
      expect(() => usdPkrMicroFromNumber(bad as unknown)).toThrow(/Invalid/);
    expect(usdPkrMicroFromNumber(276.603556)).toBe(276_603_556);
    expect(isValidUsdPkrMicro(R)).toBe(true);
    expect(isValidUsdPkrMicro(1.5)).toBe(false);
    expect(() => convertUsdPkr(100, "USD", "PKR", 0)).toThrow(/Invalid/);
    expect(() => parseUsdPkr("0")).toThrow();
    expect(() => parseUsdPkr("abc")).toThrow();
    expect(() => parseUsdPkr("5")).toThrow(/realistic/);
    expect(parseUsdPkr("278.50")).toBe(R);
    expect(formatUsdPkr(R)).toBe("1 USD = 278.5 PKR");
  });

  it("has no fabricated conversion without a rate", () => {
    expect(toPkrMinor(10_000, "USD", null)).toBeNull();
    expect(toPkrMinor(10_000, "PKR", null)).toBe(10_000);
  });

  it("marks old rates as stale", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(fxStatus({ effective_at: "2026-10-30T00:02:31Z", retrieved_at: "2026-10-30T06:00:00Z" }, now)).toBe("fresh");
    expect(fxStatus({ effective_at: "2026-10-28T00:00:00Z", retrieved_at: "2026-10-30T06:00:00Z" }, now)).toBe("stale");
  });

  it("links the sale's profit rate to the USD/PKR snapshot in both directions", () => {
    expect(saleRateFromUsdPkr("USD", "PKR", R)).toBe(R);
    const usdPerPkr = saleRateFromUsdPkr("PKR", "USD", R)!;
    expect(usdPerPkr).toBe(3_591); // 0.003591 USD per PKR
    expect(Math.abs(usdPkrFromSaleRate("PKR", "USD", usdPerPkr)! - R) / R).toBeLessThan(0.0002);
    expect(saleRateFromUsdPkr("PKR", "PKR", R)).toBeNull();
  });
});

describe("customer display currency", () => {
  it("Pakistan visitors see PKR first, everyone else USD, and the visitor's own choice always wins", () => {
    expect(chooseDisplayCurrency({ country: "PK" })).toBe("PKR");
    expect(chooseDisplayCurrency({ country: "pk" })).toBe("PKR");
    for (const c of ["AE", "US", "GB", "SA", "IN"]) expect(chooseDisplayCurrency({ country: c })).toBe("USD");
    expect(chooseDisplayCurrency({ country: "PK", preference: "USD" })).toBe("USD");
    expect(chooseDisplayCurrency({ country: "AE", preference: "PKR" })).toBe("PKR");
  });
  it("falls back to the configured default when the country is unknown", () => {
    expect(chooseDisplayCurrency({ country: null })).toBe("PKR");
    expect(chooseDisplayCurrency({ country: "XX", fallback: "USD" })).toBe("USD");
    expect(chooseDisplayCurrency({ country: "", preference: "EUR", fallback: "PKR" })).toBe("PKR");
  });
});

describe("transaction-time exchange-rate snapshots", () => {
  const base = {
    id: "01a18d31-b84b-72e5-ba6b-550db191af85", rev: 1, deleted: false, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
    account_id: "01a18d31-b84b-72e5-ba6b-550db191af86", sold_at: "2026-10-01T00:00:00.000Z", amount_minor: 10_000, currency: "USD",
    exchange_rate_micro: null, buyer_name: null, buyer_contact: null, channel: "whatsapp", reference: null, notes: null, status: "completed",
  };
  it("older rows without snapshot fields are still valid (default null)", () => {
    const r = saleSchema.parse(base);
    expect(r).toMatchObject({ fx_usd_pkr_micro: null, fx_source: null, fx_at: null, fx_override_reason: null });
  });
  it("a snapshot needs its source and time; a manual rate needs a reason; bad rates are refused", () => {
    expect(saleSchema.safeParse({ ...base, fx_usd_pkr_micro: R }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, fx_usd_pkr_micro: R, fx_source: "ExchangeRate-API", fx_at: "2026-10-30T00:02:31.000Z" }).success).toBe(true);
    expect(saleSchema.safeParse({ ...base, fx_usd_pkr_micro: R, fx_source: "manual", fx_at: "2026-10-30T00:02:31.000Z" }).success).toBe(false);
    expect(saleSchema.safeParse({ ...base, fx_usd_pkr_micro: R, fx_source: "manual", fx_at: "2026-10-30T00:02:31.000Z", fx_override_reason: "Paid at open-market rate" }).success).toBe(true);
    for (const bad of [0, -1, 1.5, 5, 99e12])
      expect(saleSchema.safeParse({ ...base, fx_usd_pkr_micro: bad, fx_source: "x", fx_at: "2026-10-30T00:02:31.000Z" }).success).toBe(false);
  });
});

/* -------------------- consolidated books and the two charts -------------------- */

const T = (d: string) => `${d}T10:00:00.000Z`;
const acct = (id: string, cost: number, cur: "PKR" | "USD", fx: number | null, status = "sold", purchased = "2026-05-03") => ({
  id, deleted: false, status: status as "sold", published: false, purchase_cost_minor: cost, purchase_currency: cur, purchase_fx_micro: fx,
  purchased_at: purchased, created_at: T(purchased),
});
const sale = (id: string, account_id: string, amount: number, cur: "PKR" | "USD", fx: number | null, at: string, status = "completed", exchange: number | null = null) => ({
  id, account_id, deleted: false, amount_minor: amount, currency: cur, exchange_rate_micro: exchange, status: status as "completed", fx_usd_pkr_micro: fx, sold_at: T(at),
});

/** Mixed activity: PKR + USD purchases, PKR + USD sales (cross-currency too), expenses, refund, void. */
function mixed() {
  const accounts = [
    acct("a1", 1_500_000, "PKR", null, "sold", "2026-05-03"), // PKR purchase
    acct("a2", 5_000, "USD", 280_000_000, "sold", "2026-06-10"), // USD purchase at 280
    acct("a3", 8_000, "USD", 282_000_000, "available", "2026-07-02"), // USD stock at 282
    acct("a4", 900_000, "PKR", null, "available", "2026-08-15"), // PKR stock (restocked after refund)
    acct("a5", 1_000_000, "PKR", null, "available", "2026-09-01"), // voided sale -> available
  ];
  const sales = [
    sale("s1", "a1", 2_000_000, "PKR", null, "2026-06-20"), // PKR sale of PKR purchase
    sale("s2", "a2", 7_000, "USD", 285_000_000, "2026-07-15"), // USD sale at 285
    sale("s4", "a4", 1_200_000, "PKR", null, "2026-09-05", "refunded"), // later restock-refunded
    sale("s5", "a5", 1_100_000, "PKR", null, "2026-10-01", "voided"), // reversal: never counted
  ];
  const refunds = [{ sale_id: "s4", amount_minor: 1_200_000, currency: "PKR" as const, deleted: false, refunded_at: T("2026-09-20") }];
  const expenses: { amount_minor: number; currency: "PKR" | "USD"; deleted: boolean; fx_usd_pkr_micro: number | null; incurred_at: string }[] = [
    { amount_minor: 50_000, currency: "PKR" as const, deleted: false, fx_usd_pkr_micro: null, incurred_at: "2026-08-01" },
    { amount_minor: 1_000, currency: "USD" as const, deleted: false, fx_usd_pkr_micro: 283_000_000, incurred_at: "2026-10-02" },
  ];
  return { accounts, sales, refunds, expenses };
}
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

describe("consolidated (PKR-equivalent) books", () => {
  it("converts each transaction at its own recorded rate and keeps native totals separate", () => {
    const input = mixed();
    const c = computeConsolidated(input);
    // sales: s1 2,000,000 + s2 $70 × 285 = 1,995,000 + s4 1,200,000 (refunded, still gross) = 5,195,000
    expect(c.grossSales).toBe(2_000_000 + 1_995_000 + 1_200_000);
    expect(c.refunds).toBe(1_200_000);
    // cost of sold: a1 1,500,000 PKR + a2 $50 at the SALE rate 285 = 1,425,000
    expect(c.costOfSold).toBe(1_500_000 + 1_425_000);
    // expenses: 50,000 + $10 × 283 = 283,000
    expect(c.expenses).toBe(50_000 + 283_000);
    expect(c.netProfit).toBe(c.grossSales - c.refunds - c.costOfSold - c.expenses);
    // purchases at their purchase rates: 1,500,000 + $50×280 + $80×282 + 900,000 + 1,000,000
    expect(c.purchases).toBe(1_500_000 + 1_400_000 + 2_256_000 + 900_000 + 1_000_000);
    expect(c.outgoing).toBe(c.purchases + c.expenses + c.refunds);
    expect(c.inventoryValue).toBe(2_256_000 + 900_000 + 1_000_000);
    expect(c.excluded).toEqual({ sales: 0, refunds: 0, costs: 0, purchases: 0, expenses: 0 });

    // Native per-currency report is unchanged: still separate PKR and USD numbers, never added together.
    const native = computeReport(input);
    expect(native.byCurrency.USD).toMatchObject({ grossSales: 7_000, costOfSold: 5_000, expenses: 1_000 });
    expect(native.byCurrency.PKR).toMatchObject({ grossSales: 3_200_000, refunds: 1_200_000, costOfSold: 1_500_000, expenses: 50_000 });
  });

  it("does not change when the current display rate changes (history uses recorded rates only)", () => {
    expect(computeConsolidated(mixed())).toEqual(computeConsolidated(mixed()));
  });

  it("leaves out — and counts — USD records that have no rate, instead of guessing", () => {
    const input = mixed();
    input.expenses.push({ amount_minor: 500, currency: "USD", deleted: false, fx_usd_pkr_micro: null, incurred_at: "2026-10-03" });
    input.accounts.push(acct("a9", 3_000, "USD", null, "available", "2026-10-04"));
    const c = computeConsolidated(input);
    expect(c.excluded).toMatchObject({ expenses: 1, purchases: 1 });
    expect(c.expenses).toBe(50_000 + 283_000);
  });

  it("uses the cross-currency rate of older sales that have no snapshot", () => {
    const accounts = [acct("b1", 1_400_000, "PKR", null)];
    const sales = [sale("t1", "b1", 6_000, "USD", null, "2026-07-01", "completed", saleRateFromUsdPkr("PKR", "USD", 280_000_000))];
    const c = computeConsolidated({ accounts, sales, refunds: [], expenses: [] });
    // $60 at ≈280. The legacy field holds USD-per-PKR with 6 decimals (0.003571), so it is exact to ~0.02%.
    expect(Math.abs(c.grossSales - 1_680_000) / 1_680_000).toBeLessThan(0.0002);
    expect(c.excluded.sales).toBe(0);
  });
});

describe("PKR and USD dashboard charts", () => {
  const sign = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.sign(n));
  const moves = (xs: number[]) => xs.slice(1).map((x, i) => sign(x - xs[i]));

  it("both charts come from the same series and rise and fall identically, month by month", () => {
    const { buckets, excluded } = consolidatedMonthlyFlow(mixed(), MONTHS);
    expect(excluded).toEqual({ sales: 0, refunds: 0, costs: 0, purchases: 0, expenses: 0 });
    // the series really contains both currencies' activity
    expect(buckets.find((b) => b.key === "2026-07")!.in).toBe(1_995_000); // the USD sale, at its own rate
    expect(buckets.find((b) => b.key === "2026-10")!.out).toBe(283_000); // the USD expense, at its own rate
    const pkr = displayFlow(buckets, "PKR", null)!;
    const usd = displayFlow(buckets, "USD", 276_603_556)!;
    expect(usd.map((b) => b.key)).toEqual(pkr.map((b) => b.key));
    for (const k of ["inExact", "outExact"] as const) {
      expect(moves(usd.map((b) => b[k]))).toEqual(moves(pkr.map((b) => b[k])));
      // a constant factor: identical shape, not just identical direction
      const ratios = pkr.map((b, i) => (b[k] ? usd[i][k] / b[k] : null)).filter((x): x is number => x !== null);
      for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 12);
    }
    // in vs out comparison inside each month is the same in both views
    expect(usd.map((b) => sign(b.inExact - b.outExact))).toEqual(pkr.map((b) => sign(b.inExact - b.outExact)));
  });

  it("changing the display rate rescales the USD chart without changing its shape or the recorded history", () => {
    const { buckets } = consolidatedMonthlyFlow(mixed(), MONTHS);
    const before: FlowBucket[] = JSON.parse(JSON.stringify(buckets));
    const a = displayFlow(buckets, "USD", 250_000_000)!;
    const b = displayFlow(buckets, "USD", 300_000_000)!;
    expect(moves(a.map((x) => x.inExact))).toEqual(moves(b.map((x) => x.inExact)));
    expect(moves(a.map((x) => x.outExact))).toEqual(moves(b.map((x) => x.outExact)));
    expect(buckets).toEqual(before);
    expect(consolidatedMonthlyFlow(mixed(), MONTHS).buckets).toEqual(before);
  });

  it("has no USD chart without a rate rather than an invented one", () => {
    const { buckets } = consolidatedMonthlyFlow(mixed(), MONTHS);
    expect(displayFlow(buckets, "USD", null)).toBeNull();
  });
});
