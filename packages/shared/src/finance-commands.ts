import { addDays, isCalendarDate } from "./calendar";
import { audit, checkRev, load, metaFor, recordSale, SETTING_IDS, voidSale, write, type EntityStore, type SaleInput } from "./commands";
import { allocateDebtPayment, computeDebtState, parseCharges } from "./debts";
import type { Debt, DebtCharge, DebtDirection, InstallmentPlan, Payment, PaymentKind, PayMethod } from "./entities";
import { PAY_METHODS } from "./entities";
import {
  autoSchedule,
  computePlanState,
  reviseSchedule,
  settlementQuote,
  suggestAllocation,
  validateAllocation,
  type Allocation,
  type ExtraEnd,
  type FineMode,
  type Revision,
  type ScheduleItem,
} from "./installments";
import { convertMinor, PAY_CURRENCIES, type PayCurrency } from "./money";
import { buildPaymentReceipt, buildPlanReceipt, parseSchedule, parseWaivers, planCore, planRef, receiptNumber, type WaiverRecord } from "./receipt-data";
import { RuleError } from "./rules";
import { isValidUsdtPkrMicro } from "./fx";

/**
 * Commands for installment plans, payments, money to receive / to pay and receipts. Like every command,
 * each one runs in ONE transaction of the store (desktop SQLite + sync outbox, or the server's Postgres),
 * validates the rows it writes and records audit events. Retries are safe: records carry ids chosen by
 * the caller, and a second submission of the same id is reported as "already recorded".
 */

export interface PlanAgreementInput {
  customer_name: string;
  customer_phone?: string | null;
  customer_whatsapp?: string | null;
  account_ref?: string | null;
  original_minor: number;
  advance_minor: number;
  advance_due_on?: string | null;
  start_on: string;
  duration_months?: number | null;
  duration_days?: number | null;
  schedule_mode: "auto" | "manual";
  interval_days?: number | null;
  first_due_on: string;
  schedule: ScheduleItem[];
  extra_rate_minor: number;
  extra_free_days: number;
  extra_end: ExtraEnd;
  extra_end_on?: string | null;
  extra_days?: number | null;
  fine_minor: number;
  fine_mode: FineMode;
  fine_grace_days: number;
  payment_notes?: string;
  agreement_ref?: string | null;
  agreement_notes?: string;
}

export interface PaymentInput {
  id: string;
  paid_on: string;
  amount_minor: number;
  currency: PayCurrency;
  /** Plan/record currency per 1 unit of the payment currency (x1e6) when the currencies differ. */
  rate_micro?: number | null;
  rate_source?: string | null;
  rate_at?: string | null;
  /** PKR per 1 unit of the payment currency at payment time (x1e6), for PKR reports. */
  pkr_micro?: number | null;
  pkr_source?: string | null;
  pkr_at?: string | null;
  method: PayMethod;
  reference?: string | null;
  notes?: string | null;
}

const clean = (s: string | null | undefined, max = 4000) => {
  const v = (s ?? "").trim();
  return v ? v.slice(0, max) : null;
};

function today(store: EntityStore) {
  return store.now().slice(0, 10);
}

function checkPaidOn(store: EntityStore, d: string) {
  if (!isCalendarDate(d)) throw new RuleError("pay_date", "Enter a valid payment date");
  if (d > addDays(today(store), 1)) throw new RuleError("pay_date", "A payment cannot be dated in the future");
}

/** Converted amount + rate/PKR snapshot fields of a payment. Never converts without an explicit rate. */
function money(p: PaymentInput, creditCurrency: PayCurrency) {
  if (!PAY_CURRENCIES.includes(p.currency)) throw new RuleError("pay_currency", "Choose PKR, USD or USDT");
  if (!Number.isInteger(p.amount_minor) || p.amount_minor <= 0) throw new RuleError("pay_amount", "Enter the amount received");
  if (!PAY_METHODS.includes(p.method)) throw new RuleError("pay_method", "Choose how the money was paid");
  let credited = p.amount_minor;
  let rate: number | null = null;
  if (p.currency !== creditCurrency) {
    if (!p.rate_micro || !Number.isInteger(p.rate_micro) || p.rate_micro <= 0)
      throw new RuleError("rate_required", `Enter the rate used: ${creditCurrency} per 1 ${p.currency}. Amounts are never converted 1:1 automatically.`);
    if (!clean(p.rate_source, 100)) throw new RuleError("rate_source", "Record where the conversion rate came from");
    rate = p.rate_micro;
    credited = convertMinor(p.amount_minor, rate);
    if (credited <= 0) throw new RuleError("pay_amount", "The converted amount is zero");
  }
  let pkr = p.currency === "PKR" ? null : (p.pkr_micro ?? null);
  let pkrSource = p.currency === "PKR" ? null : clean(p.pkr_source, 100);
  let pkrAt = p.currency === "PKR" ? null : clean(p.pkr_at, 40);
  if (p.currency !== "PKR" && creditCurrency === "PKR" && rate) {
    pkr = rate; // a PKR plan paid in USD/USDT: the conversion rate IS the PKR rate
    pkrSource = clean(p.rate_source, 100);
    pkrAt = clean(p.rate_at, 40) ?? `${p.paid_on}T00:00:00.000Z`;
  }
  if (pkr !== null && (!Number.isInteger(pkr) || pkr <= 0)) throw new RuleError("pkr_rate", "Invalid PKR rate");
  if (pkr !== null && !pkrSource) pkrSource = "manual";
  if (pkr === null) pkrSource = pkrAt = null;
  if (p.currency === "USDT" && pkr !== null && !isValidUsdtPkrMicro(pkr)) throw new RuleError("pkr_rate", "The USDT/PKR rate is outside a realistic range");
  return {
    amount_minor: p.amount_minor,
    currency: p.currency,
    credited_minor: credited,
    rate_micro: rate,
    rate_source: rate ? clean(p.rate_source, 100) : null,
    rate_at: rate ? (clean(p.rate_at, 40) ?? `${p.paid_on}T00:00:00.000Z`) : null,
    pkr_micro: pkr,
    pkr_source: pkrSource,
    pkr_at: pkr !== null ? (pkrAt ?? `${p.paid_on}T00:00:00.000Z`) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

function agreementFields(a: PlanAgreementInput) {
  return {
    customer_name: (a.customer_name ?? "").trim(),
    customer_phone: clean(a.customer_phone, 40),
    customer_whatsapp: clean(a.customer_whatsapp, 40),
    account_ref: clean(a.account_ref, 100),
    original_minor: a.original_minor,
    advance_minor: a.advance_minor,
    advance_due_on: a.advance_minor > 0 ? (a.advance_due_on ?? a.start_on) : null,
    start_on: a.start_on,
    duration_months: a.duration_months ?? null,
    duration_days: a.duration_months ? null : (a.duration_days ?? null),
    schedule_mode: a.schedule_mode,
    interval_days: a.schedule_mode === "auto" ? (a.interval_days ?? null) : (a.interval_days ?? null),
    first_due_on: a.schedule[0]?.due_on ?? a.first_due_on,
    schedule_json: JSON.stringify(a.schedule.map((s) => ({ n: s.n, due_on: s.due_on, principal_minor: s.principal_minor }))),
    extra_rate_minor: a.extra_rate_minor,
    extra_free_days: a.extra_free_days,
    extra_end: a.extra_end,
    extra_end_on: a.extra_end === "date" ? (a.extra_end_on ?? null) : null,
    extra_days: a.extra_end === "days" ? (a.extra_days ?? null) : null,
    fine_minor: a.fine_minor,
    fine_mode: a.fine_mode,
    fine_grace_days: a.fine_grace_days,
    payment_notes: (a.payment_notes ?? "").slice(0, 4000),
    agreement_ref: clean(a.agreement_ref, 200),
    agreement_notes: (a.agreement_notes ?? "").slice(0, 4000),
  };
}

async function issuePlanReceiptRow(store: EntityStore, plan: InstallmentPlan, id: string, issuedOn: string) {
  const payments = await store.list("payments", { plan_id: plan.id });
  const settings = await store.list("settings", {});
  const at = store.now();
  const receipt_no = receiptNumber("PP", id, issuedOn);
  const data = buildPlanReceipt({ plan, payments, settings, receipt_no, issued_at: at, issued_on: issuedOn });
  const r = await write(
    store,
    "receipts",
    { ...metaFor(store, id), receipt_no, kind: "plan", plan_id: plan.id, payment_id: null, issued_at: at, revision: plan.revision, data_json: JSON.stringify(data) },
    null,
  );
  await audit(store, "receipts", r.id, "receipt.issued", { kind: "plan", receipt_no, plan_id: plan.id, account_id: plan.account_id, revision: plan.revision });
  return r;
}

async function recordPlanPaymentRow(
  store: EntityStore,
  plan: InstallmentPlan,
  input: PaymentInput & { kind: "advance" | "installment" | "settlement"; allocations?: Allocation[] | null; receipt_id?: string },
): Promise<Payment> {
  if (await store.get("payments", input.id)) throw new RuleError("exists", "This payment is already recorded");
  if (plan.status === "cancelled") throw new RuleError("plan_cancelled", "This plan is cancelled; no more payments can be recorded");
  checkPaidOn(store, input.paid_on);
  const m = money(input, plan.currency);
  const existing = await store.list("payments", { plan_id: plan.id });
  const core = planCore(plan, existing);
  let allocations: Allocation[];
  if (input.allocations && input.allocations.length) {
    validateAllocation(core, input.paid_on, m.credited_minor, input.allocations);
    allocations = input.allocations.map((a) => ({ n: a.n, part: a.part, minor: a.minor }));
  } else allocations = suggestAllocation(core, input.paid_on, m.credited_minor).allocations;
  if (input.kind === "settlement") {
    const q = settlementQuote(core, input.paid_on);
    if (m.credited_minor < q.total) throw new RuleError("settle_short", "This amount does not clear the plan. Record it as an installment payment instead.");
  }
  if (input.kind === "advance" && plan.advance_minor === 0) throw new RuleError("no_advance", "This plan has no advance");
  const firstN = allocations.filter((a) => a.part !== "credit").map((a) => a.n);
  const at = store.now();
  const payment = await write(
    store,
    "payments",
    {
      ...metaFor(store, input.id),
      receipt_no: receiptNumber("PR", input.id, input.paid_on),
      target: "plan",
      plan_id: plan.id,
      debt_id: null,
      kind: input.kind,
      installment_no: firstN.length ? Math.min(...firstN) : null,
      paid_on: input.paid_on,
      ...m,
      method: input.method,
      reference: clean(input.reference, 200),
      notes: clean(input.notes, 2000),
      allocations_json: JSON.stringify(allocations),
      actor: store.actor,
      status: "recorded",
      reversed_at: null,
      reversal_reason: null,
    },
    null,
  );
  const settings = await store.list("settings", {});
  const data = buildPaymentReceipt({ plan, payments: existing, payment, settings, issued_at: at });
  const receiptId = input.receipt_id ?? store.newId();
  await write(
    store,
    "receipts",
    { ...metaFor(store, receiptId), receipt_no: payment.receipt_no, kind: "payment", plan_id: plan.id, payment_id: payment.id, issued_at: at, revision: plan.revision, data_json: JSON.stringify(data) },
    null,
  );
  await audit(store, "payments", payment.id, "payment.recorded", {
    account_id: plan.account_id,
    plan_id: plan.id,
    receipt_no: payment.receipt_no,
    kind: payment.kind,
    amount_minor: payment.amount_minor,
    currency: payment.currency,
    credited_minor: payment.credited_minor,
    plan_currency: plan.currency,
    paid_on: payment.paid_on,
    allocations,
  });
  return payment;
}

/**
 * Mark as Sold → Installments. One transaction: the sale (at the ORIGINAL price, counted once), the plan,
 * the advance payment when it was received now, and the Payment Plan receipt.
 */
export async function createInstallmentSale(
  store: EntityStore,
  args: {
    sale: Omit<SaleInput, "amount_minor" | "buyer_name" | "buyer_contact" | "currency"> & { id: string };
    plan_id: string;
    plan: PlanAgreementInput;
    currency: "USD" | "PKR";
    advance_payment?: PaymentInput | null;
    receipt_id: string;
    issued_on: string;
  },
): Promise<{ plan: InstallmentPlan }> {
  if (await store.get("installment_plans", args.plan_id)) throw new RuleError("exists", "This plan is already recorded");
  const a = args.plan;
  if (a.schedule_mode === "auto") {
    if (!a.interval_days) throw new RuleError("plan_interval", "Choose the interval between installments");
    const expected = autoSchedule({ first_due_on: a.first_due_on, count: a.schedule.length, interval_days: a.interval_days, principal_minor: a.original_minor - a.advance_minor });
    if (JSON.stringify(expected) !== JSON.stringify(a.schedule.map((s) => ({ n: s.n, due_on: s.due_on, principal_minor: s.principal_minor }))))
      throw new RuleError("plan_schedule", "The automatic schedule does not match its settings. Regenerate it and try again.");
  }
  const acct = await load(store, "accounts", args.sale.account_id, "Account");
  const fields = agreementFields(a);
  const contact = fields.customer_whatsapp ?? fields.customer_phone;
  await recordSale(store, {
    ...args.sale,
    amount_minor: a.original_minor,
    currency: args.currency,
    buyer_name: fields.customer_name,
    buyer_contact: contact,
    reference: args.sale.reference ?? "Installment plan",
    notes: args.sale.notes ?? null,
  });
  const plan = await write(
    store,
    "installment_plans",
    {
      ...metaFor(store, args.plan_id),
      account_id: acct.id,
      sale_id: args.sale.id,
      account_title: acct.title,
      currency: args.currency,
      ...fields,
      status: "active",
      cancelled_on: null,
      cancel_reason: null,
      revision: 0,
      waivers_json: "[]",
    },
    null,
  );
  await audit(store, "installment_plans", plan.id, "plan.created", {
    account_id: acct.id,
    sale_id: args.sale.id,
    plan_ref: planRef(plan),
    currency: plan.currency,
    original_minor: plan.original_minor,
    advance_minor: plan.advance_minor,
    installments: parseSchedule(plan).length,
    interval_days: plan.interval_days,
    extra_rate_minor: plan.extra_rate_minor,
    extra_free_days: plan.extra_free_days,
    fine_minor: plan.fine_minor,
  });
  if (args.advance_payment && plan.advance_minor > 0) await recordPlanPaymentRow(store, plan, { ...args.advance_payment, kind: "advance" });
  await issuePlanReceiptRow(store, plan, args.receipt_id, args.issued_on);
  return { plan };
}

export async function recordPlanPayment(
  store: EntityStore,
  args: PaymentInput & { plan_id: string; kind: "advance" | "installment" | "settlement"; allocations?: Allocation[] | null; receipt_id?: string },
): Promise<Payment> {
  const plan = await load(store, "installment_plans", args.plan_id, "Plan");
  return recordPlanPaymentRow(store, plan, args);
}

/** A payment is never edited or deleted: it is reversed (kept, with the reason) and stops counting. */
export async function reversePayment(store: EntityStore, args: { id: string; reason: string }): Promise<Payment> {
  const prev = await load(store, "payments", args.id, "Payment");
  if (prev.status === "reversed") throw new RuleError("already_reversed", "This payment is already reversed");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason for reversing this payment");
  const saved = await write(store, "payments", { ...prev, status: "reversed", reversed_at: store.now(), reversal_reason: reason.slice(0, 1000), updated_at: store.now() }, prev);
  let accountId: string | null = null;
  if (prev.plan_id) accountId = (await store.get("installment_plans", prev.plan_id))?.account_id ?? null;
  await audit(store, "payments", saved.id, "payment.reversed", {
    ...(accountId ? { account_id: accountId } : {}),
    plan_id: prev.plan_id,
    debt_id: prev.debt_id,
    receipt_no: prev.receipt_no,
    amount_minor: prev.amount_minor,
    currency: prev.currency,
    reason,
  });
  return saved;
}

export async function revisePlan(
  store: EntityStore,
  args: { plan_id: string; expected_rev?: number; revision: Revision; reason: string; as_of: string },
): Promise<InstallmentPlan> {
  const prev = await load(store, "installment_plans", args.plan_id, "Plan");
  checkRev(prev, args.expected_rev);
  if (prev.status === "cancelled") throw new RuleError("plan_cancelled", "This plan is cancelled");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason for this change (kept in the plan history)");
  const payments = await store.list("payments", { plan_id: prev.id });
  const result = reviseSchedule(planCore(prev, payments), args.revision, isCalendarDate(args.as_of) ? args.as_of : today(store));
  const r = args.revision;
  const next = {
    ...prev,
    schedule_json: JSON.stringify(result.schedule),
    first_due_on: result.schedule[0].due_on,
    interval_days: r.kind === "regenerate" ? r.interval_days : prev.interval_days,
    revision: prev.revision + 1,
    updated_at: store.now(),
  };
  const saved = await write(store, "installment_plans", next, prev);
  await audit(store, "installment_plans", saved.id, "plan.revised", {
    account_id: saved.account_id,
    revision: saved.revision,
    kind: r.kind,
    ...(r.kind === "move" ? { scope: r.scope } : {}),
    reason,
    changes: result.diff.filter((d) => d.changed).map((d) => ({ n: d.n, from: d.before, to: d.after })),
    extra_before: result.extra_before,
    extra_after: result.extra_after,
  });
  return saved;
}

const INFO_FIELDS = ["customer_name", "customer_phone", "customer_whatsapp", "account_ref", "payment_notes", "agreement_ref", "agreement_notes"] as const;

export async function updatePlanInfo(
  store: EntityStore,
  args: { plan_id: string; expected_rev?: number; info: Partial<Record<(typeof INFO_FIELDS)[number], string | null>> },
): Promise<InstallmentPlan> {
  const prev = await load(store, "installment_plans", args.plan_id, "Plan");
  checkRev(prev, args.expected_rev);
  const next: Record<string, unknown> = { ...prev, updated_at: store.now() };
  const changed: string[] = [];
  for (const k of INFO_FIELDS) {
    if (!(k in args.info)) continue;
    const v = args.info[k];
    const val = k === "customer_name" ? (v ?? "").trim() : k === "payment_notes" || k === "agreement_notes" ? (v ?? "").slice(0, 4000) : clean(v, k === "agreement_ref" ? 200 : 100);
    if (val !== (prev as Record<string, unknown>)[k]) {
      next[k] = val;
      changed.push(k);
    }
  }
  if (!changed.length) return prev;
  const saved = await write(store, "installment_plans", next, prev);
  await audit(store, "installment_plans", saved.id, "plan.info_changed", { account_id: saved.account_id, fields: changed });
  return saved;
}

const TERM_FIELDS = ["extra_rate_minor", "extra_free_days", "extra_end", "extra_end_on", "extra_days", "fine_minor", "fine_mode", "fine_grace_days"] as const;

/** Daily Extra / late fine terms can change only before any installment payment exists (the agreement is then still open). */
export async function updatePlanTerms(
  store: EntityStore,
  args: { plan_id: string; expected_rev?: number; terms: Partial<Pick<InstallmentPlan, (typeof TERM_FIELDS)[number]>>; reason: string },
): Promise<InstallmentPlan> {
  const prev = await load(store, "installment_plans", args.plan_id, "Plan");
  checkRev(prev, args.expected_rev);
  if (prev.status === "cancelled") throw new RuleError("plan_cancelled", "This plan is cancelled");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason for changing the agreement");
  const payments = (await store.list("payments", { plan_id: prev.id })).filter((p) => p.status === "recorded");
  if (payments.some((p) => planCore(prev, [p]).payments[0].allocations.some((a) => a.n > 0)))
    throw new RuleError("terms_locked", "Installment payments already exist; Daily Extra and fine terms can no longer change. Use a schedule change instead.");
  const next: Record<string, unknown> = { ...prev, updated_at: store.now() };
  for (const k of TERM_FIELDS) if (k in args.terms) next[k] = (args.terms as Record<string, unknown>)[k];
  if (next.extra_end !== "date") next.extra_end_on = null;
  if (next.extra_end !== "days") next.extra_days = null;
  next.revision = prev.revision + 1;
  const saved = await write(store, "installment_plans", next, prev);
  const pickTerms = (p: Record<string, unknown>) => Object.fromEntries(TERM_FIELDS.map((k) => [k, p[k]]));
  await audit(store, "installment_plans", saved.id, "plan.terms_changed", {
    account_id: saved.account_id,
    revision: saved.revision,
    reason,
    from: pickTerms(prev as unknown as Record<string, unknown>),
    to: pickTerms(saved as unknown as Record<string, unknown>),
  });
  return saved;
}

export async function waiveFine(
  store: EntityStore,
  args: { plan_id: string; n: number; minor: number; reason: string; as_of: string; id?: string },
): Promise<InstallmentPlan> {
  const prev = await load(store, "installment_plans", args.plan_id, "Plan");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason for the waiver");
  if (!Number.isInteger(args.minor) || args.minor <= 0) throw new RuleError("waive_amount", "Enter the amount to waive");
  const payments = await store.list("payments", { plan_id: prev.id });
  const state = computePlanState(planCore(prev, payments), isCalendarDate(args.as_of) ? args.as_of : today(store));
  const e = state.entries[args.n];
  if (!e || args.n < 1) throw new RuleError("waive_entry", "Choose an installment");
  if (args.minor > e.fine_remaining) throw new RuleError("waive_exceeds", "You can waive at most the unpaid fine of this installment");
  const waivers = parseWaivers(prev);
  const w: WaiverRecord = { id: args.id ?? store.newId(), n: args.n, minor: args.minor, reason: reason.slice(0, 1000), at: store.now(), actor: store.actor, undone_at: null, undo_reason: null };
  const saved = await write(store, "installment_plans", { ...prev, waivers_json: JSON.stringify([...waivers, w]), updated_at: store.now() }, prev);
  await audit(store, "installment_plans", saved.id, "fine.waived", { account_id: saved.account_id, installment: args.n, minor: args.minor, reason, waiver_id: w.id });
  return saved;
}

export async function undoFineWaiver(store: EntityStore, args: { plan_id: string; waiver_id: string; reason: string }): Promise<InstallmentPlan> {
  const prev = await load(store, "installment_plans", args.plan_id, "Plan");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason");
  const waivers = parseWaivers(prev);
  const w = waivers.find((x) => x.id === args.waiver_id);
  if (!w || w.undone_at) throw new RuleError("waiver", "Waiver not found");
  const next = waivers.map((x) => (x.id === w.id ? { ...x, undone_at: store.now(), undo_reason: reason.slice(0, 1000) } : x));
  const saved = await write(store, "installment_plans", { ...prev, waivers_json: JSON.stringify(next), updated_at: store.now() }, prev);
  await audit(store, "installment_plans", saved.id, "fine.waiver_reversed", { account_id: saved.account_id, installment: w.n, minor: w.minor, reason, waiver_id: w.id });
  return saved;
}

/**
 * Cancel a plan. Default: the customer keeps the account and the unpaid balance is written off (it stops
 * counting as money to receive). `undo_sale` (only when nothing was paid) also voids the sale and puts the
 * account back in stock — for a plan recorded by mistake.
 */
export async function cancelPlan(store: EntityStore, args: { plan_id: string; reason: string; cancelled_on: string; undo_sale?: boolean }): Promise<InstallmentPlan> {
  const prev = await load(store, "installment_plans", args.plan_id, "Plan");
  if (prev.status === "cancelled") throw new RuleError("plan_cancelled", "This plan is already cancelled");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason for cancelling");
  if (!isCalendarDate(args.cancelled_on)) throw new RuleError("cancel_date", "Enter the cancellation date");
  const payments = await store.list("payments", { plan_id: prev.id });
  const live = payments.filter((p) => p.status === "recorded");
  const state = computePlanState(planCore(prev, payments), args.cancelled_on);
  if (args.undo_sale) {
    if (live.length) throw new RuleError("cancel_paid", "Payments exist for this plan. Reverse them first, or cancel without undoing the sale.");
  }
  const saved = await write(
    store,
    "installment_plans",
    { ...prev, status: "cancelled", cancelled_on: args.cancelled_on, cancel_reason: reason.slice(0, 1000), updated_at: store.now() },
    prev,
  );
  await audit(store, "installment_plans", saved.id, "plan.cancelled", {
    account_id: saved.account_id,
    reason,
    undo_sale: !!args.undo_sale,
    written_off_principal: args.undo_sale ? 0 : state.totals.remaining_principal,
    currency: saved.currency,
  });
  if (args.undo_sale) await voidSale(store, { id: prev.sale_id, reason: `Installment plan cancelled: ${reason}` });
  return saved;
}

export async function issuePlanReceipt(store: EntityStore, args: { id: string; plan_id: string; issued_on: string }) {
  if (await store.get("receipts", args.id)) throw new RuleError("exists", "This receipt is already issued");
  const plan = await load(store, "installment_plans", args.plan_id, "Plan");
  return issuePlanReceiptRow(store, plan, args.id, isCalendarDate(args.issued_on) ? args.issued_on : today(store));
}

/* ------------------------------------------------------------------ */
/* Money to receive / to pay                                           */
/* ------------------------------------------------------------------ */

export interface DebtInput {
  direction: DebtDirection;
  party_name: string;
  party_contact?: string | null;
  description?: string;
  original_minor: number;
  currency: PayCurrency;
  txn_on: string;
  due_on?: string | null;
  notes?: string;
}

export async function saveDebt(store: EntityStore, args: { id?: string; expected_rev?: number; debt: DebtInput; reason?: string }): Promise<Debt> {
  const prev = args.id ? await store.get("debts", args.id) : null;
  if (prev?.deleted) throw new RuleError("not_found", "Record not found");
  if (prev) checkRev(prev, args.expected_rev);
  const d = args.debt;
  if (prev) {
    const paid = (await store.list("payments", { debt_id: prev.id })).some((p) => p.status === "recorded");
    if (paid && (d.direction !== prev.direction || d.currency !== prev.currency))
      throw new RuleError("debt_locked", "Payments exist: the direction and currency can no longer change");
    if (prev.original_minor !== d.original_minor && (args.reason ?? "").trim().length < 3)
      throw new RuleError("reason", "Give a reason for correcting the amount");
  }
  const fields = {
    direction: d.direction,
    party_name: (d.party_name ?? "").trim(),
    party_contact: clean(d.party_contact, 100),
    description: (d.description ?? "").slice(0, 2000),
    original_minor: d.original_minor,
    currency: d.currency,
    txn_on: d.txn_on,
    due_on: d.due_on || null,
    notes: (d.notes ?? "").slice(0, 4000),
  };
  const next = prev
    ? { ...prev, ...fields, updated_at: store.now() }
    : { ...metaFor(store, args.id), ...fields, charges_json: "[]", status: "open", cancelled_at: null, cancel_reason: null };
  const saved = await write(store, "debts", next, prev);
  await audit(store, "debts", saved.id, prev ? "debt.updated" : "debt.created", {
    direction: saved.direction,
    party: saved.party_name,
    ...(prev ? { from: { amount: prev.original_minor, currency: prev.currency } } : {}),
    to: { amount: saved.original_minor, currency: saved.currency },
    ...(args.reason ? { reason: args.reason.trim().slice(0, 500) } : {}),
  });
  return saved;
}

/** Interest / service charge (kept separate from the principal) or a discount. */
export async function addDebtCharge(store: EntityStore, args: { debt_id: string; kind: "charge" | "discount"; minor: number; label: string; on: string; id?: string }): Promise<Debt> {
  const prev = await load(store, "debts", args.debt_id, "Record");
  if (prev.status === "cancelled") throw new RuleError("debt_cancelled", "This record is cancelled");
  if (!Number.isInteger(args.minor) || args.minor <= 0) throw new RuleError("charge_amount", "Enter the amount");
  if (!isCalendarDate(args.on)) throw new RuleError("charge_date", "Enter a valid date");
  const label = (args.label ?? "").trim();
  if (!label) throw new RuleError("charge_label", "Describe the charge");
  const c: DebtCharge = { id: args.id ?? store.newId(), kind: args.kind, minor: args.minor, label: label.slice(0, 200), on: args.on, at: store.now() };
  const saved = await write(store, "debts", { ...prev, charges_json: JSON.stringify([...parseCharges(prev), c]), updated_at: store.now() }, prev);
  await audit(store, "debts", saved.id, args.kind === "charge" ? "debt.charge_added" : "debt.discount_added", { minor: c.minor, currency: saved.currency, label: c.label });
  return saved;
}

export async function recordDebtPayment(store: EntityStore, args: PaymentInput & { debt_id: string }): Promise<Payment> {
  if (await store.get("payments", args.id)) throw new RuleError("exists", "This payment is already recorded");
  const debt = await load(store, "debts", args.debt_id, "Record");
  if (debt.status === "cancelled") throw new RuleError("debt_cancelled", "This record is cancelled");
  checkPaidOn(store, args.paid_on);
  const m = money(args, debt.currency);
  const state = computeDebtState(debt, await store.list("payments", { debt_id: debt.id }), args.paid_on);
  const allocations = allocateDebtPayment(state, m.credited_minor);
  const kind: PaymentKind = debt.direction === "receive" ? "receive" : "pay";
  const saved = await write(
    store,
    "payments",
    {
      ...metaFor(store, args.id),
      receipt_no: receiptNumber("PM", args.id, args.paid_on),
      target: "debt",
      plan_id: null,
      debt_id: debt.id,
      kind,
      installment_no: null,
      paid_on: args.paid_on,
      ...m,
      method: args.method,
      reference: clean(args.reference, 200),
      notes: clean(args.notes, 2000),
      allocations_json: JSON.stringify(allocations.map((a) => ({ n: 0, part: a.part, minor: a.minor }))),
      actor: store.actor,
      status: "recorded",
      reversed_at: null,
      reversal_reason: null,
    },
    null,
  );
  await audit(store, "payments", saved.id, kind === "receive" ? "debt.payment_received" : "debt.payment_made", {
    debt_id: debt.id,
    party: debt.party_name,
    amount_minor: saved.amount_minor,
    currency: saved.currency,
    credited_minor: saved.credited_minor,
    record_currency: debt.currency,
  });
  return saved;
}

export async function cancelDebt(store: EntityStore, args: { id: string; reason: string }): Promise<Debt> {
  const prev = await load(store, "debts", args.id, "Record");
  if (prev.status === "cancelled") throw new RuleError("debt_cancelled", "Already cancelled");
  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) throw new RuleError("reason", "Give a reason for cancelling");
  const saved = await write(store, "debts", { ...prev, status: "cancelled", cancelled_at: store.now(), cancel_reason: reason.slice(0, 1000), updated_at: store.now() }, prev);
  await audit(store, "debts", saved.id, "debt.cancelled", { direction: saved.direction, party: saved.party_name, reason });
  return saved;
}

/* ------------------------------------------------------------------ */
/* USDT/PKR owner rate                                                 */
/* ------------------------------------------------------------------ */

export interface ManualUsdtRate {
  rate_micro: number;
  effective_on: string;
  note: string | null;
  set_at: string;
}

export function parseManualUsdtRate(value: string | null | undefined): ManualUsdtRate | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as ManualUsdtRate;
    return isValidUsdtPkrMicro(v?.rate_micro) && isCalendarDate(v.effective_on) ? v : null;
  } catch {
    return null;
  }
}

/** The owner's own USDT/PKR rate (e.g. the P2P rate actually used) and whether it overrides the reference rate. */
export async function setUsdtRate(store: EntityStore, args: { mode: "provider" | "manual"; rate_micro?: number | null; effective_on?: string | null; note?: string | null }) {
  if (args.mode !== "provider" && args.mode !== "manual") throw new RuleError("usdt_mode", "Choose the reference rate or your own rate");
  const put = async (key: "usdt_rate_mode" | "usdt_pkr_manual", value: string) => {
    const id = SETTING_IDS[key];
    const prev = await store.get("settings", id);
    const next = prev ? { ...prev, value, deleted: false, updated_at: store.now() } : { ...metaFor(store, id), key, value };
    return write(store, "settings", next, prev);
  };
  let manual: ManualUsdtRate | null = null;
  if (args.rate_micro !== undefined && args.rate_micro !== null) {
    if (!isValidUsdtPkrMicro(args.rate_micro)) throw new RuleError("usdt_rate", "Enter a realistic USDT rate in PKR (e.g. 281.50)");
    const eff = args.effective_on && isCalendarDate(args.effective_on) ? args.effective_on : today(store);
    manual = { rate_micro: args.rate_micro, effective_on: eff, note: clean(args.note, 200), set_at: store.now() };
    await put("usdt_pkr_manual", JSON.stringify(manual));
  }
  if (args.mode === "manual" && !manual) {
    const existing = await store.get("settings", SETTING_IDS.usdt_pkr_manual);
    if (!parseManualUsdtRate(existing?.value)) throw new RuleError("usdt_rate", "Enter your USDT rate first");
  }
  await put("usdt_rate_mode", args.mode);
  await audit(store, "settings", SETTING_IDS.usdt_rate_mode, "fx.usdt_rate_set", {
    mode: args.mode,
    ...(manual ? { usdt_pkr_micro: manual.rate_micro, effective_on: manual.effective_on, note: manual.note } : {}),
  });
  return { mode: args.mode, manual };
}
