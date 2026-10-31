// Currency display (storefront + admin) and the exchange-rate rules of the admin forms.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account, Expense, FxQuote, PublicListing } from "@codex/shared";
import { Price, RateNote } from "../../../apps/web/app/(store)/ui";
import { FxEquivalent, FxPreview } from "../src/fx-ui";
import { resolveSaleFx } from "../src/pages/MarkSold";
import { purchaseFx } from "../src/pages/AccountForm";
import { expenseFx } from "../src/pages/Expenses";
import { FxProviderForTest } from "./fx-helpers";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const quote: FxQuote = {
  pair: "USD/PKR", usd_pkr_micro: 280_000_000, source: "ExchangeRate-API", source_url: "https://www.exchangerate-api.com",
  effective_at: "2026-10-30T00:02:31.000Z", retrieved_at: "2026-10-30T06:00:00.000Z", next_update_at: null, frequency: "daily", status: "fresh",
};
const pkrListing = { price_minor: 10_000_000, currency: "PKR" } as Pick<PublicListing, "price_minor" | "currency">; // Rs 100,000
const usdListing = { price_minor: 10_000, currency: "USD" } as Pick<PublicListing, "price_minor" | "currency">; // $100
// Tags become spaces: the two price lines are separate elements on the page.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("storefront prices", () => {
  it("Pakistan visitor: PKR first, USD equivalent underneath", () => {
    const t = text(renderToStaticMarkup(<Price l={pkrListing} view={{ display: "PKR", fx: quote }} />));
    expect(t).toBe("Rs 100,000.00 PKR ≈ $357.14 USD");
  });
  it("international visitor: USD equivalent first, the listed PKR price still visible", () => {
    const t = text(renderToStaticMarkup(<Price l={pkrListing} view={{ display: "USD", fx: quote }} />));
    expect(t).toBe("≈ $357.14 USD Listed at Rs 100,000.00 PKR");
  });
  it("a USD listing for a Pakistan visitor shows the PKR equivalent first and the USD price as listed", () => {
    expect(text(renderToStaticMarkup(<Price l={usdListing} view={{ display: "PKR", fx: quote }} />))).toBe("≈ Rs 28,000.00 PKR Listed at $100.00 USD");
    expect(text(renderToStaticMarkup(<Price l={usdListing} view={{ display: "USD", fx: quote }} />))).toBe("$100.00 USD ≈ Rs 28,000.00 PKR");
  });
  it("without a rate only the listed price is shown — nothing converted or invented", () => {
    const t = text(renderToStaticMarkup(<Price l={pkrListing} view={{ display: "USD", fx: null }} />));
    expect(t).toBe("Rs 100,000.00 PKR");
    expect(text(renderToStaticMarkup(<RateNote fx={null} />))).toMatch(/currency the owner listed/);
  });
  it("labels the rate as a daily reference, shows its time, flags staleness and credits the provider", () => {
    const t = text(renderToStaticMarkup(<RateNote fx={{ ...quote, status: "stale" }} />));
    expect(t).toMatch(/approximate/);
    expect(t).toMatch(/1 USD = 280 PKR \(daily reference rate, updated Fri, 30 Oct 2026 00:02:31 UTC, may be out of date\)/);
    expect(t).toMatch(/Rates By Exchange Rate API/);
    expect(t).not.toMatch(/live|real-time/i);
  });
});

describe("admin conversion previews", () => {
  it("Add/Edit form preview: entered amount, its equivalent and the rate used", () => {
    const t = text(renderToStaticMarkup(<FxProviderForTest quote={quote}><FxPreview amount="100,000" currency="PKR" label="Listing price" /></FxProviderForTest>));
    expect(t).toMatch(/Listing price: Rs 100,000.00 PKR ≈ \$357.14 USD/);
    expect(t).toMatch(/1 USD = 280 PKR · ExchangeRate-API daily reference/);
    const usd = text(renderToStaticMarkup(<FxProviderForTest quote={quote}><FxPreview amount="100" currency="USD" /></FxProviderForTest>));
    expect(usd).toMatch(/\$100.00 USD ≈ Rs 28,000.00 PKR/);
  });
  it("shows no conversion when no rate is available, and nothing for an empty or invalid amount", () => {
    expect(text(renderToStaticMarkup(<FxProviderForTest quote={null}><FxPreview amount="100" currency="USD" /></FxProviderForTest>))).toMatch(/No USD\/PKR rate available/);
    expect(renderToStaticMarkup(<FxProviderForTest quote={quote}><FxPreview amount="" currency="USD" /></FxProviderForTest>)).toBe("");
    expect(renderToStaticMarkup(<FxProviderForTest quote={quote}><FxPreview amount="abc" currency="USD" /></FxProviderForTest>)).toBe("");
  });
  it("inventory cards and detail pages show an approximate equivalent", () => {
    expect(text(renderToStaticMarkup(<FxProviderForTest quote={quote}><FxEquivalent minor={2_500_000} currency="PKR" /></FxProviderForTest>))).toBe("≈ $89.29");
    expect(renderToStaticMarkup(<FxProviderForTest quote={null}><FxEquivalent minor={2_500_000} currency="PKR" /></FxProviderForTest>)).toBe("");
  });
});

describe("sale exchange rate (Mark as Sold)", () => {
  const base = { rateInput: "280", quote, reason: "", staleConfirmed: false, now: NOW };
  it("PKR sale of a PKR purchase: no rate needed, reference kept for information", () => {
    expect(resolveSaleFx({ ...base, purchase: "PKR", sale: "PKR" })).toMatchObject({ exchange_rate_micro: null, fx_usd_pkr_micro: 280_000_000, fx_override_reason: null });
    expect(resolveSaleFx({ ...base, purchase: "PKR", sale: "PKR", quote: null })).toMatchObject({ fx_usd_pkr_micro: null });
  });
  it("USD sale: the reference quote is used and recorded with its source and time", () => {
    const fx = resolveSaleFx({ ...base, purchase: "PKR", sale: "USD" });
    expect(fx).toMatchObject({ fx_usd_pkr_micro: 280_000_000, fx_source: "ExchangeRate-API", fx_at: quote.effective_at, fx_override_reason: null, exchange_rate_micro: 3_571 });
    expect(resolveSaleFx({ ...base, purchase: "USD", sale: "PKR" }).exchange_rate_micro).toBe(280_000_000);
    expect(resolveSaleFx({ ...base, purchase: "USD", sale: "USD" }).exchange_rate_micro).toBeNull();
  });
  it("a different rate is a manual override that needs a reason", () => {
    expect(() => resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", rateInput: "290" })).toThrow(/reason/);
    const fx = resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", rateInput: "290", reason: "Paid at open-market rate" });
    expect(fx).toMatchObject({ fx_usd_pkr_micro: 290_000_000, fx_source: "manual", fx_override_reason: "Paid at open-market rate", fx_at: NOW.toISOString() });
  });
  it("offline with an old cached rate: needs an explicit confirmation or a manual rate", () => {
    const old = { ...quote, effective_at: "2026-10-25T00:00:00.000Z", retrieved_at: "2026-10-25T06:00:00.000Z" };
    expect(() => resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", quote: old })).toThrow(/Confirm/);
    expect(resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", quote: old, staleConfirmed: true }).fx_source).toBe("ExchangeRate-API");
    expect(resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", quote: old, rateInput: "281", reason: "today's bank rate" }).fx_source).toBe("manual");
  });
  it("no quote at all (fresh offline PC): a manual rate with a reason is required", () => {
    expect(() => resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", quote: null, rateInput: "" })).toThrow(/Enter the USD\/PKR/);
    expect(() => resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", quote: null })).toThrow(/reason/);
    expect(() => resolveSaleFx({ ...base, purchase: "PKR", sale: "USD", rateInput: "0", reason: "x" })).toThrow();
  });
});

describe("purchase and expense snapshots", () => {
  const acct = (over: Partial<Account>) => ({ purchase_currency: "USD", purchase_cost_minor: 5_000, purchase_fx_micro: null, purchase_fx_source: null, purchase_fx_at: null, ...over }) as Account;
  it("records the rate for a new USD purchase, keeps it on later edits of other fields, and never for PKR", () => {
    expect(purchaseFx({ purchase_currency: "USD", purchase_cost_minor: 5_000 }, null, quote)).toEqual({ purchase_fx_micro: 280_000_000, purchase_fx_source: "ExchangeRate-API", purchase_fx_at: quote.effective_at });
    const saved = acct({ purchase_fx_micro: 275_000_000, purchase_fx_source: "ExchangeRate-API", purchase_fx_at: "2026-09-01T00:00:00.000Z" });
    expect(purchaseFx({ purchase_currency: "USD", purchase_cost_minor: 5_000 }, saved, quote).purchase_fx_micro).toBe(275_000_000); // not rewritten
    expect(purchaseFx({ purchase_currency: "PKR", purchase_cost_minor: 5_000 }, saved, quote).purchase_fx_micro).toBeNull();
    expect(purchaseFx({ purchase_currency: "USD", purchase_cost_minor: 5_000 }, null, null).purchase_fx_micro).toBeNull();
  });
  it("records the rate for USD expenses only and keeps it when an edit does not change the amount", () => {
    expect(expenseFx({ amount_minor: 1_000, currency: "USD" }, null, quote).fx_usd_pkr_micro).toBe(280_000_000);
    expect(expenseFx({ amount_minor: 1_000, currency: "PKR" }, null, quote).fx_usd_pkr_micro).toBeNull();
    const prev = { currency: "USD", amount_minor: 1_000, fx_usd_pkr_micro: 270_000_000, fx_source: "ExchangeRate-API", fx_at: "2026-09-01T00:00:00.000Z" } as Expense;
    expect(expenseFx({ amount_minor: 1_000, currency: "USD" }, prev, quote).fx_usd_pkr_micro).toBe(270_000_000);
  });
});
