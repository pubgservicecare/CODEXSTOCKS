import { describe, expect, it } from "vitest";
import {
  accountSchema,
  assertLinkLimits,
  assertManualTransition,
  availableLinkKinds,
  computeReport,
  convertMinor,
  formatMoney,
  loginLinkSchema,
  newId,
  normalizeNewlines,
  parseMoney,
  parseRate,
  threeWayMerge,
  toPublicListing,
  twoStepWarning,
  validateBackupCodes,
  youtubeId,
  type Account,
} from "../src";

const T = "2026-01-01T00:00:00.000Z";
function account(over: Partial<Account> = {}): Account {
  return {
    id: newId(), rev: 0, deleted: false, created_at: T, updated_at: T, title: "Conqueror account", status: "available",
    published: false, purchase_cost_minor: 0, purchase_currency: "PKR", purchased_at: null, purchase_reference: null,
    list_price_minor: null, list_currency: null, description_public: "", youtube_url: null, image_url: null,
    image_file_id: null, old_owner_name: null, old_owner_whatsapp: null, show_old_owner_public: false, internal_notes: "",
    ...over,
  };
}

describe("account schema", () => {
  it("requires a title and allows an explicit zero purchase cost", () => {
    expect(accountSchema.safeParse(account({ purchase_cost_minor: 0 })).success).toBe(true);
    expect(accountSchema.safeParse(account({ title: "   " })).success).toBe(false);
    expect(accountSchema.safeParse({ ...account(), purchase_cost_minor: undefined }).success).toBe(false);
    expect(accountSchema.safeParse(account({ purchase_cost_minor: -1 })).success).toBe(false);
    expect(accountSchema.safeParse(account({ purchase_cost_minor: 1.5 })).success).toBe(false);
  });
  it("pairs sale price with sale currency", () => {
    expect(accountSchema.safeParse(account({ list_price_minor: 100 })).success).toBe(false);
    expect(accountSchema.safeParse(account({ list_price_minor: 100, list_currency: "USD" })).success).toBe(true);
  });
});

describe("login links", () => {
  const L = (kind: "social" | "phone" | "email") => ({ kind, deleted: false });
  it("enforces max 2 social, 1 phone, 1 email, 4 total", () => {
    expect(() => assertLinkLimits([L("social"), L("social"), L("phone"), L("email")])).not.toThrow();
    expect(() => assertLinkLimits([L("social"), L("social"), L("social")])).toThrow(/at most 2 social/);
    expect(() => assertLinkLimits([L("phone"), L("phone")])).toThrow(/at most 1 phone/);
    expect(() => assertLinkLimits([L("email"), L("email")])).toThrow(/at most 1 email/);
    expect(() => assertLinkLimits([{ kind: "social", deleted: true }, L("social"), L("social")])).not.toThrow();
    expect(availableLinkKinds([L("social"), L("social"), L("phone"), L("email")])).toEqual([]);
    expect(availableLinkKinds([L("social")])).toEqual(["social", "phone", "email"]);
  });
  it("validates kind-specific fields", () => {
    const base = {
      id: newId(), rev: 0, deleted: false, created_at: T, updated_at: T, account_id: newId(), provider: null,
      identifier: null, display_name: null, owner_name: "Ali", owner_contact: null, owner_notes: null, status: "active",
      credential_id: null, two_step_enabled: false, two_step_method: "none", two_step_destination: null,
      two_step_accessible: null, recovery_info: null,
    } as const;
    expect(loginLinkSchema.safeParse({ ...base, kind: "social" }).success).toBe(false); // provider missing
    expect(loginLinkSchema.safeParse({ ...base, kind: "social", provider: "google" }).success).toBe(true);
    expect(loginLinkSchema.safeParse({ ...base, kind: "social", provider: "google", credential_id: newId() }).success).toBe(false);
    expect(loginLinkSchema.safeParse({ ...base, kind: "email", identifier: "not-an-email" }).success).toBe(false);
    expect(loginLinkSchema.safeParse({ ...base, kind: "email", identifier: "a@b.co" }).success).toBe(true);
    expect(loginLinkSchema.safeParse({ ...base, kind: "phone", identifier: "+92 300 1234567" }).success).toBe(true);
  });
  it("warns when 2SV is on with no usable recovery", () => {
    expect(twoStepWarning({ kind: "email", two_step_enabled: true, two_step_accessible: false }, 0)).toMatch(/unrecoverable/);
    expect(twoStepWarning({ kind: "email", two_step_enabled: true, two_step_accessible: false }, 3)).toBeNull();
    expect(twoStepWarning({ kind: "email", two_step_enabled: false, two_step_accessible: false }, 0)).toBeNull();
  });
});

describe("backup codes", () => {
  it("requires 8 digits, keeps leading zeros, rejects duplicates and >10", () => {
    expect(validateBackupCodes(["00012345", "99999999"])).toEqual(["00012345", "99999999"]);
    expect(() => validateBackupCodes(["1234567"])).toThrow(/8 digits/);
    expect(() => validateBackupCodes(["1234567a"])).toThrow(/8 digits/);
    expect(() => validateBackupCodes(["00000001", "00000001"])).toThrow(/duplicate/);
    expect(() => validateBackupCodes(Array.from({ length: 11 }, (_, i) => String(i).padStart(8, "0")))).toThrow(/at most 10/);
  });
});

describe("status transitions", () => {
  it("only allows sold via sales", () => {
    expect(() => assertManualTransition("available", "reserved")).not.toThrow();
    expect(() => assertManualTransition("available", "sold")).toThrow(/Record a sale/);
    expect(() => assertManualTransition("sold", "available")).toThrow(/Void the sale/);
    expect(() => assertManualTransition("archived", "available")).not.toThrow();
  });
});

describe("money", () => {
  it("parses and formats minor units exactly", () => {
    expect(parseMoney("1,250.5", "USD")).toBe(125050);
    expect(parseMoney("0", "PKR")).toBe(0);
    expect(() => parseMoney("1.234", "USD")).toThrow();
    expect(() => parseMoney("-5", "USD")).toThrow();
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
    expect(formatMoney(28000000, "PKR")).toBe("Rs 280,000.00");
  });
  it("converts with recorded rates and rounds half away from zero", () => {
    const rate = parseRate("280.5");
    expect(convertMinor(1000, rate)).toBe(280500); // $10.00 -> Rs 2,805.00
    expect(convertMinor(1, parseRate("0.005"))).toBe(0); // 0.005 -> 0 (0.005 minor rounds to 0)
    expect(convertMinor(1, parseRate("0.5"))).toBe(1); // half rounds up
    expect(convertMinor(333, parseRate("0.003571"))).toBe(1); // 1.189 -> 1
  });
});

describe("accounting", () => {
  const a1 = account({ id: "a1", purchase_cost_minor: 1000000, purchase_currency: "PKR", status: "sold" }); // Rs 10,000
  const a2 = account({ id: "a2", purchase_cost_minor: 500000, purchase_currency: "PKR", status: "sold" }); // Rs 5,000
  const a3 = account({ id: "a3", purchase_cost_minor: 0, purchase_currency: "USD", status: "sold" }); // free
  const a4 = account({ id: "a4", purchase_cost_minor: 2000, purchase_currency: "USD", status: "sold" }); // $20 sold in PKR
  const a5 = account({ id: "a5", purchase_cost_minor: 300000, purchase_currency: "PKR", status: "available", published: true });
  const sale = (id: string, account_id: string, amount: number, currency: "USD" | "PKR", rate: number | null = null, status: "completed" | "refunded" | "voided" = "completed") =>
    ({ id, account_id, amount_minor: amount, currency, exchange_rate_micro: rate, status, deleted: false }) as const;

  const report = computeReport({
    accounts: [a1, a2, a3, a4, a5],
    sales: [
      sale("s1", "a1", 1500000, "PKR"), // profit Rs 5,000
      sale("s2", "a2", 400000, "PKR"), // loss Rs 1,000
      sale("s3", "a3", 1500, "USD"), // zero cost -> $15 profit
      sale("s4", "a4", 700000, "PKR", parseRate("280")), // $20 cost = Rs 5,600 -> profit Rs 1,400
    ],
    refunds: [{ sale_id: "s1", amount_minor: 100000, currency: "PKR", deleted: false }],
    expenses: [
      { amount_minor: 50000, currency: "PKR", deleted: false },
      { amount_minor: 300, currency: "USD", deleted: false },
    ],
  });

  it("keeps PKR and USD totals separate", () => {
    const pkr = report.byCurrency.PKR;
    expect(pkr.grossSales).toBe(1500000 + 400000 + 700000);
    expect(pkr.refunds).toBe(100000);
    expect(pkr.costOfSold).toBe(1000000 + 500000 + 560000);
    expect(pkr.expenses).toBe(50000);
    expect(pkr.netProfit).toBe(2600000 - 100000 - 2060000 - 50000);
    const usd = report.byCurrency.USD;
    expect(usd.grossSales).toBe(1500);
    expect(usd.costOfSold).toBe(0);
    expect(usd.netProfit).toBe(1500 - 300);
  });
  it("profitable, loss-making and zero-cost sales", () => {
    const one = (s: ReturnType<typeof sale>, a: Account) =>
      computeReport({ accounts: [a], sales: [s], refunds: [], expenses: [] }).byCurrency[s.currency].grossProfit;
    expect(one(sale("s1", "a1", 1500000, "PKR"), a1)).toBe(500000);
    expect(one(sale("s2", "a2", 400000, "PKR"), a2)).toBe(-100000);
    expect(one(sale("s3", "a3", 1500, "USD"), a3)).toBe(1500);
  });
  it("cash view counts purchases once and inventory value only for unsold", () => {
    const pkr = report.byCurrency.PKR;
    expect(pkr.purchases).toBe(1000000 + 500000 + 300000);
    expect(pkr.outgoing).toBe(pkr.purchases + 50000 + 100000);
    expect(pkr.inventoryValue).toBe(300000);
    expect(report.byCurrency.USD.purchases).toBe(2000);
    expect(report.counts).toMatchObject({ total: 5, sold: 4, available: 1, published: 1 });
  });
  it("restock refunds remove cost of sold; voided sales are ignored", () => {
    const r = computeReport({
      accounts: [account({ id: "x", purchase_cost_minor: 1000, purchase_currency: "USD" })],
      sales: [sale("v", "x", 5000, "USD", null, "voided"), sale("r", "x", 2000, "USD", null, "refunded")],
      refunds: [{ sale_id: "r", amount_minor: 2000, currency: "USD", deleted: false }],
      expenses: [],
    }).byCurrency.USD;
    expect(r.grossSales).toBe(2000);
    expect(r.netSales).toBe(0);
    expect(r.costOfSold).toBe(0);
    expect(r.netProfit).toBe(0);
  });
  it("flags cross-currency sales without a rate", () => {
    const r = computeReport({ accounts: [a4], sales: [sale("s", "a4", 100, "PKR")], refunds: [], expenses: [] });
    expect(r.byCurrency.PKR.missingRates).toBe(1);
  });
});

describe("TXT descriptions and public DTO", () => {
  const txt = "  Level 80   Conqueror\n\n\n  - M416 Glacier\n\tX-Suit   (max)\n   trailing   ";
  it("public DTO preserves whitespace exactly and exposes only allowlisted fields", () => {
    const a = account({
      description_public: txt,
      internal_notes: "PRIVATE NOTE",
      old_owner_name: "Old Owner",
      old_owner_whatsapp: "+923001112222",
      purchase_cost_minor: 999,
      list_price_minor: 5000,
      list_currency: "USD",
    });
    const dto = toPublicListing(a);
    expect(dto.description).toBe(txt);
    const json = JSON.stringify(dto);
    for (const leak of ["PRIVATE NOTE", "Old Owner", "923001112222", "999", "purchase", "internal"]) expect(json).not.toContain(leak);
    expect(toPublicListing({ ...a, show_old_owner_public: true }).previous_owner).toBe("Old Owner");
  });
  it("only normalises CRLF line endings", () => {
    expect(normalizeNewlines("a  b\r\n\r\nc\rd")).toBe("a  b\n\nc\nd");
  });
  it("parses YouTube URLs", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("javascript:alert(1)")).toBeNull();
    expect(youtubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("three-way merge", () => {
  it("merges non-overlapping edits and reports overlapping ones", () => {
    const base = account({ id: "m", title: "A", internal_notes: "n", rev: 1 });
    const local = { ...base, title: "Local title" };
    const server = { ...base, internal_notes: "server note", rev: 2 };
    const r = threeWayMerge(base, local, server);
    expect(r.conflictingFields).toEqual([]);
    expect(r.merged).toMatchObject({ title: "Local title", internal_notes: "server note", rev: 2 });
    const r2 = threeWayMerge(base, { ...base, title: "L" }, { ...base, title: "S", rev: 2 });
    expect(r2.conflictingFields).toEqual(["title"]);
  });
});
