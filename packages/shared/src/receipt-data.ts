import { formatDay } from "./calendar";
import type { InstallmentPlan, Payment, PayMethod, Setting } from "./entities";
import { PAY_METHOD_LABELS, planTerms } from "./entities";
import {
  computePlanState,
  extraStartDate,
  installmentLabel,
  type Allocation,
  type FineWaiver,
  type PlanCore,
  type PlanState,
  type ScheduleItem,
} from "./installments";
import { formatMoney, type Currency, type PayCurrency } from "./money";

/**
 * Receipt SNAPSHOTS. A receipt is saved once, with exactly the figures shown on it, and is never edited:
 * the PNG is re-drawn from this snapshot at any time, so a later payment, revision or settings change can
 * never alter a receipt that was already issued. Only public business details appear on a receipt — no
 * login details, passwords, backup codes, internal notes or other customers' data.
 */

export interface BusinessContact {
  business_name: string;
  owner: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  hours: string | null;
  social: string[];
  other: string | null;
}

/** Public business details from the Admin Panel contact settings (nothing is invented when a field is empty). */
export function businessContact(settings: Pick<Setting, "key" | "value" | "deleted">[]): BusinessContact {
  const get = (k: string) => {
    const v = settings.find((s) => s.key === k && !s.deleted)?.value?.trim();
    return v ? v : null;
  };
  return {
    business_name: get("store_name") ?? "CODE X STOCKS",
    owner: get("contact_owner"),
    phone: get("contact_phone"),
    whatsapp: get("public_whatsapp"),
    email: get("contact_email"),
    website: get("contact_website"),
    address: get("contact_address"),
    hours: get("contact_hours"),
    social: (get("contact_social") ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 6),
    other: get("contact_other"),
  };
}

export function parseSchedule(p: Pick<InstallmentPlan, "schedule_json">): ScheduleItem[] {
  try {
    const v = JSON.parse(p.schedule_json) as ScheduleItem[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function parseAllocations(p: Pick<Payment, "allocations_json">): Allocation[] {
  try {
    const v = JSON.parse(p.allocations_json) as Allocation[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export interface WaiverRecord {
  id: string;
  n: number;
  minor: number;
  reason: string;
  at: string;
  actor: string;
  undone_at: string | null;
  undo_reason: string | null;
}

export function parseWaivers(p: Pick<InstallmentPlan, "waivers_json">): WaiverRecord[] {
  try {
    const v = JSON.parse(p.waivers_json) as WaiverRecord[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The engine's view of a stored plan and its stored payments. */
export function planCore(plan: InstallmentPlan, payments: Payment[]): PlanCore {
  return {
    terms: planTerms(plan),
    advance_due_on: plan.advance_due_on,
    schedule: parseSchedule(plan),
    payments: payments
      .filter((p) => !p.deleted && p.plan_id === plan.id)
      .map((p) => ({
        id: p.id,
        paid_on: p.paid_on,
        created_at: p.created_at,
        reversed: p.status === "reversed",
        credited_minor: p.credited_minor,
        allocations: parseAllocations(p),
      })),
    waivers: parseWaivers(plan).map((w): FineWaiver => ({ id: w.id, n: w.n, minor: w.minor, undone: !!w.undone_at })),
    cancelled_on: plan.status === "cancelled" ? plan.cancelled_on : null,
  };
}

export function planStateOf(plan: InstallmentPlan, payments: Payment[], asOf: string): PlanState {
  return computePlanState(planCore(plan, payments), asOf);
}

/** "PP-261103-7F3A2C": prefix, issue date (YYMMDD) and the record id's last 6 hex digits (random part). */
export function receiptNumber(prefix: "PP" | "PR" | "PM", id: string, date: string): string {
  return `${prefix}-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
}

export function durationLabel(p: Pick<InstallmentPlan, "duration_months" | "duration_days">): string | null {
  if (p.duration_months) return `${p.duration_months} month${p.duration_months === 1 ? "" : "s"}`;
  if (p.duration_days) return `${p.duration_days} days`;
  return null;
}

export function extraEndLabel(p: Pick<InstallmentPlan, "extra_end" | "extra_end_on" | "extra_days">): string {
  switch (p.extra_end) {
    case "date":
      return `until ${formatDay(p.extra_end_on)}`;
    case "days":
      return `for ${p.extra_days} days`;
    case "paid":
      return "until fully paid";
    default:
      return "until the final installment date";
  }
}

export interface PlanReceiptRow {
  n: number;
  label: string;
  from: string | null;
  to: string;
  principal: number;
  extra: number;
  extra_days: number;
  /** Whole period inside the free period: printed as "0 / Maaf". */
  free: boolean;
  total: number;
  paid: number;
  fine: number;
  fine_waived: number;
  status: string;
}

export interface PlanReceiptData {
  v: 1;
  kind: "plan";
  receipt_no: string;
  issued_at: string;
  issued_on: string;
  revision: number;
  business: BusinessContact;
  currency: Currency;
  customer: { name: string; phone: string | null; whatsapp: string | null };
  account: { title: string; ref: string | null };
  plan: {
    ref: string;
    agreement_ref: string | null;
    start_on: string;
    original: number;
    advance: number;
    advance_due_on: string | null;
    advance_paid: boolean;
    advance_paid_on: string | null;
    remaining_principal: number;
    count: number;
    duration: string | null;
    interval_days: number | null;
    schedule_mode: "auto" | "manual";
    extra_rate: number;
    extra_free_days: number;
    extra_start_on: string | null;
    extra_end: string;
    fine: number;
    fine_mode: "flat" | "per_day";
    fine_grace_days: number;
    status: string;
  };
  rows: PlanReceiptRow[];
  totals: {
    original: number;
    advance: number;
    remaining_principal: number;
    extra: number;
    fines: number;
    fines_waived: number;
    grand_total: number;
    collected: number;
    credit: number;
    remaining_total: number;
  };
  notes: { en: string; ur: string }[];
}

export interface PaymentReceiptData {
  v: 1;
  kind: "payment";
  receipt_no: string;
  issued_at: string;
  business: BusinessContact;
  customer: { name: string; phone: string | null; whatsapp: string | null };
  account: { title: string; ref: string | null };
  plan: { ref: string; agreement_ref: string | null; currency: Currency };
  payment: {
    type: string;
    is_advance: boolean;
    installment_no: number | null;
    paid_on: string;
    amount: number;
    currency: PayCurrency;
    credited: number;
    rate_micro: number | null;
    method: string;
    reference: string | null;
    allocation: { advance: number; principal: number; extra: number; fine: number; credit: number };
    installments: number[];
  };
  balances: {
    previously_paid: number;
    this_payment: number;
    total_collected: number;
    remaining_principal: number;
    remaining_total: number;
    credit: number;
    next_due_on: string | null;
    next_amount: number | null;
    next_label: string | null;
    /** Late fine included in next_amount (absent on receipts issued before this field existed). */
    next_fine?: number | null;
    plan_status: string;
  };
}

export const planRef = (plan: Pick<InstallmentPlan, "id">) => `IP-${plan.id.replace(/-/g, "").slice(-6).toUpperCase()}`;

const STATUS_LABEL: Record<string, string> = { active: "Active", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" };
export function planStatusLabel(plan: Pick<InstallmentPlan, "revision" | "status">, state: PlanState): string {
  if (plan.status === "cancelled") return "Cancelled";
  if (state.status === "paid") return "Paid";
  if (state.status === "overdue") return "Overdue";
  return plan.revision > 0 ? "Restructured" : STATUS_LABEL[state.status] ?? "Active";
}

function money(minor: number, c: Currency) {
  const s = formatMoney(minor, c).replace("Rs ", "PKR ").replace(/^\$/, "USD ");
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

function planNotes(plan: InstallmentPlan): { en: string; ur: string }[] {
  const c = plan.currency;
  const unitUr = c === "PKR" ? "روپے" : "ڈالر";
  const amt = (m: number) => money(m, c).replace(/^(PKR|USD) /, "");
  const notes: { en: string; ur: string }[] = [];
  if (plan.extra_rate_minor > 0) {
    if (plan.extra_free_days > 0)
      notes.push({
        en: `No Daily Extra for the first ${plan.extra_free_days} days (Maaf).`,
        ur: `پہلے ${plan.extra_free_days} دن ڈیلی ایکسٹرا معاف ہے۔`,
      });
    notes.push({
      en: `Then ${money(plan.extra_rate_minor, c)} per day is added to the next installment, ${extraEndLabel(plan)}.`,
      ur: `اس کے بعد روزانہ ${amt(plan.extra_rate_minor)} ${unitUr} ڈیلی ایکسٹرا اگلی قسط میں شامل ہوگا۔`,
    });
    notes.push({ en: "Paying the full balance early stops Daily Extra from the next day.", ur: "پوری رقم پہلے ادا کرنے پر اگلے دن سے ڈیلی ایکسٹرا ختم ہو جائے گا۔" });
  } else notes.push({ en: "No Daily Extra on this plan.", ur: "اس پلان پر کوئی ڈیلی ایکسٹرا نہیں۔" });
  if (plan.fine_minor > 0) {
    const grace = plan.fine_grace_days ? ` after ${plan.fine_grace_days} day${plan.fine_grace_days === 1 ? "" : "s"} grace` : "";
    notes.push(
      plan.fine_mode === "per_day"
        ? { en: `Late installment: ${money(plan.fine_minor, c)} fine per day${grace}, shown separately.`, ur: `قسط لیٹ ہونے پر روزانہ ${amt(plan.fine_minor)} ${unitUr} جرمانہ الگ سے ہوگا۔` }
        : { en: `Late installment: ${money(plan.fine_minor, c)} fine once${grace}, shown separately.`, ur: `قسط لیٹ ہونے پر ${amt(plan.fine_minor)} ${unitUr} جرمانہ الگ سے ہوگا۔` },
    );
  }
  return notes;
}

export function buildPlanReceipt(o: {
  plan: InstallmentPlan;
  payments: Payment[];
  settings: Pick<Setting, "key" | "value" | "deleted">[];
  receipt_no: string;
  issued_at: string;
  issued_on: string;
}): PlanReceiptData {
  const { plan } = o;
  const state = planStateOf(plan, o.payments, o.issued_on);
  const adv = state.entries[0];
  const rows: PlanReceiptRow[] = state.entries.slice(1).map((e) => ({
    n: e.n,
    label: installmentLabel(plan.interval_days, e.n),
    from: e.period_from,
    to: e.due_on,
    principal: e.principal,
    extra: e.extra,
    extra_days: e.extra_days,
    free: plan.extra_rate_minor > 0 && e.extra === 0,
    total: e.due_total,
    paid: e.paid_principal + e.paid_extra,
    fine: e.fine,
    fine_waived: e.fine_waived,
    status: e.status,
  }));
  return {
    v: 1,
    kind: "plan",
    receipt_no: o.receipt_no,
    issued_at: o.issued_at,
    issued_on: o.issued_on,
    revision: plan.revision,
    business: businessContact(o.settings),
    currency: plan.currency,
    customer: { name: plan.customer_name, phone: plan.customer_phone, whatsapp: plan.customer_whatsapp },
    account: { title: plan.account_title, ref: plan.account_ref },
    plan: {
      ref: planRef(plan),
      agreement_ref: plan.agreement_ref,
      start_on: plan.start_on,
      original: plan.original_minor,
      advance: plan.advance_minor,
      advance_due_on: plan.advance_due_on,
      advance_paid: plan.advance_minor > 0 && state.advance_paid,
      advance_paid_on: state.advance_paid ? adv.cleared_on : null,
      remaining_principal: plan.original_minor - plan.advance_minor,
      count: rows.length,
      duration: durationLabel(plan),
      interval_days: plan.interval_days,
      schedule_mode: plan.schedule_mode,
      extra_rate: plan.extra_rate_minor,
      extra_free_days: plan.extra_free_days,
      extra_start_on: plan.extra_rate_minor > 0 ? extraStartDate(plan) : null,
      extra_end: extraEndLabel(plan),
      fine: plan.fine_minor,
      fine_mode: plan.fine_mode,
      fine_grace_days: plan.fine_grace_days,
      status: planStatusLabel(plan, state),
    },
    rows,
    totals: {
      original: state.totals.principal,
      advance: plan.advance_minor,
      remaining_principal: state.totals.remaining_principal,
      extra: state.totals.extra,
      fines: state.totals.fine,
      fines_waived: state.totals.fine_waived,
      grand_total: state.totals.grand_total,
      collected: state.totals.collected,
      credit: state.totals.credit,
      remaining_total: state.totals.remaining_total,
    },
    notes: planNotes(plan),
  };
}

const KIND_LABEL: Record<string, string> = { advance: "Advance payment", installment: "Installment payment", settlement: "Full settlement" };

export function buildPaymentReceipt(o: {
  plan: InstallmentPlan;
  payments: Payment[];
  payment: Payment;
  settings: Pick<Setting, "key" | "value" | "deleted">[];
  issued_at: string;
}): PaymentReceiptData {
  const { plan, payment } = o;
  const others = o.payments.filter((p) => p.id !== payment.id);
  const before = planStateOf(plan, others, payment.paid_on);
  const after = planStateOf(plan, [...others, payment], payment.paid_on);
  const allocs = parseAllocations(payment);
  const part = (f: (a: Allocation) => boolean) => allocs.filter(f).reduce((a, x) => a + x.minor, 0);
  const installments = [...new Set(allocs.filter((a) => a.n > 0 && a.part !== "credit").map((a) => a.n))].sort((a, b) => a - b);
  const isAdvance = allocs.length > 0 && allocs.every((a) => a.n === 0 && a.part === "principal");
  const next = after.next;
  return {
    v: 1,
    kind: "payment",
    receipt_no: payment.receipt_no,
    issued_at: o.issued_at,
    business: businessContact(o.settings),
    customer: { name: plan.customer_name, phone: plan.customer_phone, whatsapp: plan.customer_whatsapp },
    account: { title: plan.account_title, ref: plan.account_ref },
    plan: { ref: planRef(plan), agreement_ref: plan.agreement_ref, currency: plan.currency },
    payment: {
      type: isAdvance ? "Advance payment" : (KIND_LABEL[payment.kind] ?? "Payment"),
      is_advance: isAdvance,
      installment_no: payment.installment_no,
      paid_on: payment.paid_on,
      amount: payment.amount_minor,
      currency: payment.currency,
      credited: payment.credited_minor,
      rate_micro: payment.rate_micro,
      method: PAY_METHOD_LABELS[payment.method as PayMethod] ?? payment.method,
      reference: payment.reference,
      allocation: {
        advance: part((a) => a.n === 0 && a.part === "principal"),
        principal: part((a) => a.n > 0 && a.part === "principal"),
        extra: part((a) => a.part === "extra"),
        fine: part((a) => a.part === "fine"),
        credit: part((a) => a.part === "credit"),
      },
      installments,
    },
    balances: {
      previously_paid: before.totals.collected,
      this_payment: payment.credited_minor,
      total_collected: after.totals.collected,
      remaining_principal: after.totals.remaining_principal,
      remaining_total: after.totals.remaining_total,
      credit: after.totals.credit,
      next_due_on: next ? next.due_on : null,
      next_amount: next ? next.remaining + next.fine_remaining : null,
      next_label: next ? (next.n === 0 ? "Advance" : installmentLabel(plan.interval_days, next.n)) : null,
      next_fine: next ? next.fine_remaining : null,
      plan_status: planStatusLabel(plan, after),
    },
  };
}

export function receiptMoney(minor: number, c: PayCurrency): string {
  const s = formatMoney(minor, c).replace("Rs ", "PKR ").replace(/^\$/, "USD ").replace(/^-\$/, "-USD ");
  return s.endsWith(".00") ? s.slice(0, -3) : s.endsWith(".00 USDT") ? s.replace(".00 USDT", " USDT") : s;
}
