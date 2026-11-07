import "server-only";
import { createApi, type Db } from "@codex/server";
import { addDays, autoSchedule, localDate, newId } from "@codex/shared";

/**
 * DEMO data for local previews (DEMO_MODE=1 with no DATABASE_URL). Runs only against the
 * in-memory PGlite database created in lib/server.ts — never against Neon/production.
 */
export async function seedDemo(db: Db) {
  const api = createApi({
    db,
    setupToken: "demo-setup-token-0000",
    corsOrigins: [],
    adminOrigins: ["http://localhost:3000"],
    cookieSecure: false,
    passwordParams: { logN: 14, r: 8, p: 1, keyLen: 32 },
    log: () => undefined,
  });
  const call = async (path: string, body: unknown, token?: string) => {
    const r = await api(
      new Request(`http://localhost/api/v1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
    return r.json();
  };
  const { token } = await call("/auth/setup", {
    setup_token: "demo-setup-token-0000",
    username: "demo",
    password: "Demo-Owner-Pass1!",
    client: "desktop",
    device: { name: "Demo seeder", platform: "server" },
  });
  const cmd = (name: string, args: unknown) => call(`/admin/commands/${name}`, args, token);
  await cmd("saveSetting", { key: "public_whatsapp", value: "+92 300 0000000" });
  await cmd("saveSetting", { key: "store_tagline", value: "Verified PUBG Mobile accounts · DEMO DATA" });
  const items = [
    {
      title: "DEMO · Conqueror S12 · Glacier M416 lvl 7",
      price: 4500000,
      cur: "PKR",
      desc: "  ★ Conqueror x3   (S10, S11, S12)\n\n  WEAPONS\n  - M416  Glacier        lvl 7\n  - AKM   Glacier        lvl 4\n\n  OUTFITS\n\t• Golden Pharaoh X-Suit   (max)\n\t• Blood Raven X-Suit\n\nLogin: Facebook + email   |   Full access transfer",
    },
    { title: "DEMO · Ace Dominator · 2 Mythic sets", price: 18000, cur: "USD", desc: "Ace Dominator\n\nMythics:\n  1. Fiore\n  2. Silver Fang\n\nNo ban history." },
    { title: "DEMO · Budget starter · RP S20", price: 900000, cur: "PKR", desc: "Starter account\n   - RP S20 maxed\n   - 3 upgradable guns" },
  ];
  for (const it of items) {
    const id = newId();
    await cmd("createAccount", {
      id,
      account: {
        title: it.title, purchase_cost_minor: Math.round(it.price * 0.6), purchase_currency: it.cur,
        list_price_minor: it.price, list_currency: it.cur, description_public: it.desc, internal_notes: "DEMO private note",
      },
      links: [{ kind: "email", identifier: "demo-login@example.com", owner_name: "Demo owner" }],
    });
    await cmd("setPublished", { id, published: true });
  }
  await seedDemoFinance(cmd);
}

/**
 * DEMO payments data: an installment plan matching the owner's worked example (PKR 100,000, advance 50,000,
 * 3 × 20 days, Daily Extra 400/day after 30 days, late fine 1,500), a second plan with an upcoming installment,
 * money to receive / to pay with partial payments, and clearly fake contact details for receipts.
 */
async function seedDemoFinance(cmd: (name: string, args: unknown) => Promise<{ ok?: boolean; error?: { message: string } }>) {
  const check = async (name: string, args: unknown) => {
    const r = await cmd(name, args);
    if (!r?.ok) throw new Error(`demo ${name}: ${r?.error?.message ?? "failed"}`);
    return r;
  };
  const today = localDate();
  for (const [key, value] of [
    ["contact_owner", "Demo Owner"],
    ["contact_phone", "+92 300 0000000"],
    ["contact_email", "demo@example.com"],
    ["contact_website", "codexstocks.org"],
    ["contact_hours", "DEMO · 11 am – 11 pm"],
    ["contact_social", "Instagram: @codexstocks (demo)"],
  ] as const)
    await check("saveSetting", { key, value });

  const account = async (title: string, price: number, published = false) => {
    const id = newId();
    await check("createAccount", {
      id,
      account: { title, purchase_cost_minor: Math.round(price * 0.6), purchase_currency: "PKR", list_price_minor: price, list_currency: "PKR", description_public: "DEMO account for the payments preview.", internal_notes: "" },
      links: [{ kind: "email", identifier: "demo-login@example.com", owner_name: "Demo owner" }],
    });
    if (published) await check("setPublished", { id, published: true });
    return id;
  };
  // A readable public URL: /accounts/demo-blood-raven-maxx-with-alan-walker-emote
  await account("DEMO · Blood Raven MAXX with Alan Walker Emote", 12_500_000, true);

  const plan = async (o: { title: string; startDaysAgo: number; price: number; advance: number; count: number; interval: number; extra: number; free: number; fine: number; customer: string; whatsapp: string }) => {
    const accountId = await account(o.title, o.price);
    const start = addDays(today, -o.startDaysAgo);
    const schedule = autoSchedule({ first_due_on: addDays(start, o.interval), count: o.count, interval_days: o.interval, principal_minor: o.price - o.advance });
    const planId = newId();
    await check("createInstallmentSale", {
      sale: { id: newId(), account_id: accountId, sold_at: `${start}T12:00:00.000Z`, exchange_rate_micro: null, channel: "whatsapp", reference: "Installment plan", notes: null },
      currency: "PKR",
      plan_id: planId,
      receipt_id: newId(),
      issued_on: start,
      plan: {
        customer_name: o.customer, customer_phone: null, customer_whatsapp: o.whatsapp, account_ref: null,
        original_minor: o.price, advance_minor: o.advance, advance_due_on: start, start_on: start,
        duration_months: 3, duration_days: null, schedule_mode: "auto", interval_days: o.interval, first_due_on: schedule[0].due_on, schedule,
        extra_rate_minor: o.extra, extra_free_days: o.free, extra_end: "final_due", extra_end_on: null, extra_days: null,
        fine_minor: o.fine, fine_mode: "flat", fine_grace_days: 0, payment_notes: "DEMO plan", agreement_ref: null, agreement_notes: "",
      },
      advance_payment: { id: newId(), paid_on: start, amount_minor: o.advance, currency: "PKR", method: "jazzcash", reference: "DEMO-TID-1001", notes: null },
    });
    return { planId, start, schedule };
  };

  // The owner's example, started 50 days ago: installment 1 paid on time, installment 2 (day 40) now overdue.
  const a = await plan({ title: "DEMO · Ace Master · Glacier set", startDaysAgo: 50, price: 10_000_000, advance: 5_000_000, count: 3, interval: 20, extra: 40_000, free: 30, fine: 150_000, customer: "DEMO Customer Bilal", whatsapp: "+92 300 0000001" });
  await check("recordPlanPayment", { id: newId(), plan_id: a.planId, kind: "installment", paid_on: a.schedule[0].due_on, amount_minor: 1_666_667, currency: "PKR", method: "easypaisa", reference: "DEMO-TID-1002" });

  // A newer plan: first installment due within the week, one partial payment so far.
  const b = await plan({ title: "DEMO · Conqueror S14 · Pharaoh X-Suit", startDaysAgo: 25, price: 6_000_000, advance: 1_500_000, count: 3, interval: 30, extra: 20_000, free: 30, fine: 100_000, customer: "DEMO Customer Hira", whatsapp: "+92 300 0000002" });
  await check("recordPlanPayment", { id: newId(), plan_id: b.planId, kind: "installment", paid_on: addDays(today, -2), amount_minor: 500_000, currency: "PKR", method: "cash", reference: null });

  // Money to receive: 20,000 lent, 5,000 + 10,000 received so far (5,000 remaining).
  const loan = newId();
  await check("saveDebt", { id: loan, debt: { direction: "receive", party_name: "DEMO · Ali (friend)", party_contact: null, description: "Loan for a phone", original_minor: 2_000_000, currency: "PKR", txn_on: addDays(today, -40), due_on: addDays(today, 10), notes: "" } });
  await check("recordDebtPayment", { id: newId(), debt_id: loan, paid_on: addDays(today, -20), amount_minor: 500_000, currency: "PKR", method: "cash" });
  await check("recordDebtPayment", { id: newId(), debt_id: loan, paid_on: addDays(today, -5), amount_minor: 1_000_000, currency: "PKR", method: "jazzcash", reference: "DEMO-TID-2001" });

  // Money to pay, in USDT (its own currency): 300 USDT owed, 100 USDT paid.
  const owe = newId();
  await check("saveDebt", { id: owe, debt: { direction: "pay", party_name: "DEMO · Supplier Hamza", party_contact: null, description: "Account bought on credit", original_minor: 30_000, currency: "USDT", txn_on: addDays(today, -15), due_on: addDays(today, 15), notes: "" } });
  await check("recordDebtPayment", { id: newId(), debt_id: owe, paid_on: addDays(today, -3), amount_minor: 10_000, currency: "USDT", method: "usdt", reference: "DEMO-TX-HASH", pkr_micro: 281_000_000, pkr_source: "manual" });
}
