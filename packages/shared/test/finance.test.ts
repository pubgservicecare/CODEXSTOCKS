import { describe, expect, it } from "vitest";
import {
  addDays,
  autoSchedule,
  buildPaymentReceipt,
  buildPlanReceipt,
  businessContact,
  computeDebtState,
  convertVia,
  crossRateMicro,
  financeSummary,
  formatMoney,
  parseMoney,
  parseUsdtPkr,
  pkrToUsdt,
  receiptNumber,
  resolveUsdtQuote,
  slugCandidates,
  slugify,
  usdtToPkr,
  type Debt,
  type InstallmentPlan,
  type Payment,
  type SettingKey,
  type UsdtQuote,
} from "../src";

const R = (rupees: number) => Math.round(rupees * 100);
const T = "2026-11-03T10:00:00.000Z";
const START = "2026-11-03";

function plan(over: Partial<InstallmentPlan> = {}): InstallmentPlan {
  const schedule = autoSchedule({ first_due_on: addDays(START, 20), count: 3, interval_days: 20, principal_minor: R(50_000) });
  return {
    id: "01a18d31-b84b-72e5-ba6b-550db1000001", rev: 1, deleted: false, created_at: T, updated_at: T,
    account_id: "01a18d31-b84b-72e5-ba6b-550db1000002", sale_id: "01a18d31-b84b-72e5-ba6b-550db1000003",
    customer_name: "Bilal", customer_phone: null, customer_whatsapp: "+92 300 1234567", account_title: "Conqueror S12", account_ref: "REF1",
    currency: "PKR", original_minor: R(100_000), advance_minor: R(50_000), advance_due_on: START, start_on: START,
    duration_months: 3, duration_days: null, schedule_mode: "auto", interval_days: 20, first_due_on: schedule[0].due_on, schedule_json: JSON.stringify(schedule),
    extra_rate_minor: R(400), extra_free_days: 30, extra_end: "final_due", extra_end_on: null, extra_days: null,
    fine_minor: R(1_500), fine_mode: "flat", fine_grace_days: 0, payment_notes: "", agreement_ref: null, agreement_notes: "",
    status: "active", cancelled_on: null, cancel_reason: null, revision: 0, waivers_json: "[]",
    ...over,
  };
}

function payment(over: Partial<Payment>): Payment {
  return {
    id: "01a18d31-b84b-72e5-ba6b-550db10000a1", rev: 1, deleted: false, created_at: T, updated_at: T,
    receipt_no: "PR-261103-0000A1", target: "plan", plan_id: plan().id, debt_id: null, kind: "advance", installment_no: 0,
    paid_on: START, amount_minor: R(50_000), currency: "PKR", credited_minor: R(50_000), rate_micro: null, rate_source: null, rate_at: null,
    pkr_micro: null, pkr_source: null, pkr_at: null, method: "jazzcash", reference: "TID", notes: null,
    allocations_json: JSON.stringify([{ n: 0, part: "principal", minor: R(50_000) }]), actor: "test", status: "recorded", reversed_at: null, reversal_reason: null,
    ...over,
  };
}

describe("readable slugs", () => {
  it("turns titles into clean, stable URL names", () => {
    expect(slugify("Blood Raven MAXX with Alan Walker Emote")).toBe("blood-raven-maxx-with-alan-walker-emote");
    expect(slugify("DEMO · Conqueror S12 · Glacier M416 lvl 7")).toBe("demo-conqueror-s12-glacier-m416-lvl-7");
    expect(slugify("Pharaoh's X-Suit & M416 (Max!!)")).toBe("pharaohs-x-suit-and-m416-max");
    expect(slugify("Café Ünïcode")).toBe("cafe-unicode");
    expect(slugify("قسط اکاؤنٹ")).toBe("pubg-account");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
    expect(slugify("  --  Hello   World  --  ")).toBe("hello-world");
  });
  it("offers short suffixes from the account id for duplicate titles", () => {
    const c = slugCandidates("Same Title", "01a18d31-b84b-72e5-ba6b-550db191af85");
    expect(c).toEqual(["same-title", "same-title-af85", "same-title-91af85", "same-title-b191af85", "same-title-550db191af85"]);
  });
});

describe("USDT (Tether) — a separate currency", () => {
  it("formats and parses USDT, and converts only with an explicit rate (never 1:1 from USD)", () => {
    expect(formatMoney(18_050, "USDT")).toBe("180.50 USDT");
    expect(parseMoney("180.5", "USDT")).toBe(18_050);
    expect(pkrToUsdt(R(50_000), 277_000_000)).toBe(18_051); // PKR 50,000 ≈ 180.51 USDT at 277.00
    expect(usdtToPkr(18_051, 277_000_000)).toBe(R(50_001.27));
    expect(convertVia(10_000, "USD", "USDT", 278_000_000, null)).toBeNull(); // no USDT rate -> no number
    expect(convertVia(10_000, "USD", "USDT", 278_000_000, 280_000_000)).toBe(9_929);
    expect(crossRateMicro(280_000_000, 278_000_000)).toBe(1_007_194); // USD per USDT
    expect(() => parseUsdtPkr("1")).toThrow(/realistic/);
  });

  it("uses the owner's own rate when chosen, marks old rates stale, and returns nothing rather than inventing one", () => {
    const now = new Date("2026-11-20T00:00:00.000Z");
    const provider: UsdtQuote = { pair: "USDT/PKR", usdt_pkr_micro: 281_000_000, source: "CoinGecko", source_url: null, effective_at: "2026-11-19T23:00:00.000Z", retrieved_at: "2026-11-19T23:00:00.000Z", frequency: "live", status: "fresh", manual: false };
    const manual = { rate_micro: 284_500_000, effective_on: "2026-11-10", note: "P2P", set_at: "2026-11-10T08:00:00.000Z" };
    expect(resolveUsdtQuote({ provider, manual, mode: "manual", now })).toMatchObject({ usdt_pkr_micro: 284_500_000, manual: true, status: "stale" });
    expect(resolveUsdtQuote({ provider, manual, mode: "provider", now })).toMatchObject({ usdt_pkr_micro: 281_000_000, manual: false, status: "fresh" });
    expect(resolveUsdtQuote({ provider: null, manual, mode: "provider", now })).toMatchObject({ manual: true });
    expect(resolveUsdtQuote({ provider: null, manual: null, mode: "provider", now })).toBeNull();
    expect(resolveUsdtQuote({ provider: { ...provider, effective_at: "2026-11-01T00:00:00.000Z" }, manual: null, mode: null, now })!.status).toBe("stale");
  });
});

describe("receipt snapshots", () => {
  const settings: { key: SettingKey; value: string; deleted: boolean }[] = [
    { key: "store_name", value: "CODE X STOCKS", deleted: false },
    { key: "public_whatsapp", value: "+92 300 0000000", deleted: false },
    { key: "contact_email", value: "", deleted: false },
    { key: "contact_social", value: "Instagram: @x\nTikTok: @y", deleted: false },
  ];

  it("contact block uses only the saved public settings (empty fields are left out, nothing invented)", () => {
    expect(businessContact(settings)).toEqual({
      business_name: "CODE X STOCKS", owner: null, phone: null, whatsapp: "+92 300 0000000", email: null, website: null, address: null, hours: null,
      social: ["Instagram: @x", "TikTok: @y"], other: null,
    });
  });

  it("Payment Plan: title amount is the ORIGINAL price; rows show qist + Daily Extra (0 / Maaf) and the totals never add the advance twice", () => {
    const p = plan();
    const d = buildPlanReceipt({ plan: p, payments: [payment({})], settings, receipt_no: receiptNumber("PP", p.id, START), issued_at: T, issued_on: START });
    expect(d.receipt_no).toMatch(/^PP-261103-[0-9A-F]{6}$/);
    expect(d.plan).toMatchObject({ original: R(100_000), advance: R(50_000), advance_paid: true, remaining_principal: R(50_000), count: 3, extra_start_on: "2026-12-04" });
    expect(d.rows.map((r) => [r.label, r.principal, r.extra, r.total, r.free])).toEqual([
      ["Qist 1", 1_666_667, 0, 1_666_667, true],
      ["Qist 2", 1_666_667, R(4_000), 2_066_667, false],
      ["Qist 3", 1_666_666, R(8_000), 2_466_666, false],
    ]);
    expect(d.totals).toMatchObject({ original: R(100_000), extra: R(12_000), grand_total: R(112_000), collected: R(50_000), remaining_total: R(62_000) });
    expect(d.notes.map((n) => n.ur).join(" ")).toContain("معاف");
    expect(JSON.stringify(d)).not.toMatch(/password|backup|internal/i);
  });

  it("Payment Received: allocation, balances before/after and the next installment", () => {
    const p = plan();
    const adv = payment({});
    const inst = payment({
      id: "01a18d31-b84b-72e5-ba6b-550db10000a2", receipt_no: "PR-261123-0000A2", kind: "installment", installment_no: 1, paid_on: "2026-11-23",
      amount_minor: 1_666_667, credited_minor: 1_666_667, allocations_json: JSON.stringify([{ n: 1, part: "principal", minor: 1_666_667 }]),
    });
    const d = buildPaymentReceipt({ plan: p, payments: [adv, inst], payment: inst, settings, issued_at: T });
    expect(d.payment).toMatchObject({ type: "Installment payment", is_advance: false, installments: [1], allocation: { principal: 1_666_667, extra: 0, fine: 0, credit: 0 } });
    expect(d.balances).toMatchObject({ previously_paid: R(50_000), this_payment: 1_666_667, total_collected: R(50_000) + 1_666_667, next_due_on: "2026-12-13", next_amount: 2_066_667, next_label: "Qist 2", next_fine: 0 });
    const a = buildPaymentReceipt({ plan: p, payments: [adv], payment: adv, settings, issued_at: T });
    expect(a.payment.is_advance).toBe(true);
    expect(a.payment.type).toBe("Advance payment");
  });
});

describe("dashboard summaries", () => {
  it("money owed, overdue, upcoming, collections and USDT records stay in their own currency", () => {
    const p = plan();
    const debt: Debt = {
      id: "01a18d31-b84b-72e5-ba6b-550db10000d1", rev: 1, deleted: false, created_at: T, updated_at: T, direction: "pay", party_name: "Supplier", party_contact: null,
      description: "", original_minor: 30_000, currency: "USDT", txn_on: START, due_on: null, notes: "", charges_json: "[]", status: "open", cancelled_at: null, cancel_reason: null,
    };
    const paidDebt = payment({ id: "01a18d31-b84b-72e5-ba6b-550db10000d2", target: "debt", plan_id: null, debt_id: debt.id, kind: "pay", currency: "USDT", amount_minor: 10_000, credited_minor: 10_000, allocations_json: JSON.stringify([{ n: 0, part: "principal", minor: 10_000 }]), paid_on: "2026-12-14" });
    const s = financeSummary({ plans: [p], payments: [payment({}), paidDebt], debts: [debt], asOf: "2026-12-15" });
    expect(s.activePlans).toBe(1);
    expect(s.overdue.count).toBe(2); // installments 1 and 2, with their fines
    expect(s.overdue.amounts.PKR).toBe(1_666_667 + R(1_500) + 2_066_667 + R(1_500));
    expect(s.owedToMe).toEqual({ PKR: R(62_000) + R(3_000) });
    expect(s.iOwe).toEqual({ USDT: 20_000 });
    expect(s.paidOutMonth.amounts).toEqual({ USDT: 10_000 });
    expect(computeDebtState(debt, [paidDebt]).remaining).toBe(20_000);
  });
});
