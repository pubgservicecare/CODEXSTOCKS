import { addDays, dayNumber, daysBetween, fromDayNumber, isCalendarDate } from "./calendar";
import { RuleError } from "./rules";

/**
 * INSTALLMENT PLANS — the calculation engine shared by the desktop app, the admin website and the server.
 *
 * Everything is integer minor units (paisa / cents) in the PLAN currency and whole calendar days, so the
 * same inputs give the same result on every device. Nothing here is stored except what the owner entered:
 * Daily Extra and late fines are DERIVED from the agreement, the schedule and the recorded payments, which
 * is why a retried or re-synced payment can never add a charge twice.
 *
 * Days are counted from the plan start ("Day 0"). Installment n covers the days (D[n-1], D[n]] where D[n]
 * is its due day and D[0] = 0.
 *
 * DAILY EXTRA (a per-day charge added to the NEXT installment, never collected at the end):
 *   chargeable days  = first..last, first = free days + 1 (e.g. "starts after 30 days" -> day 31)
 *   last             = final due day ("final_due"), an end date ("date"), free days + N ("days"), or
 *                      open-ended until the plan is fully paid ("paid"); never after the day the whole
 *                      principal was paid (early payoff stops accrual) or the plan was cancelled
 *   installment n    = rate x chargeable days inside its period; days after the final due day go to the
 *                      final installment. Periods do not overlap, so no day is ever counted twice.
 *
 * LATE FINE (separate from Daily Extra): when an installment's qist + Daily Extra is not fully paid by
 *   due day + grace days, it is late from the next day. "flat" = one fine per late installment,
 *   "per_day" = fine x late days (until the day it is fully paid). Waivers reduce it; they never delete it.
 *
 * PAYMENTS store their own allocation (advance / qist / Daily Extra / fine / customer credit). The default
 * order is oldest first; inside an installment Daily Extra, then qist, then its late fine. Anything beyond
 * what is owed is CUSTOMER CREDIT (an overpayment), never income.
 */

export const EXTRA_ENDS = ["final_due", "date", "days", "paid"] as const;
export type ExtraEnd = (typeof EXTRA_ENDS)[number];
export const FINE_MODES = ["flat", "per_day"] as const;
export type FineMode = (typeof FINE_MODES)[number];
export const ALLOC_PARTS = ["principal", "extra", "fine", "credit"] as const;
export type AllocPart = (typeof ALLOC_PARTS)[number];

/** Choices offered in the plan form (custom values are always allowed). */
export const INTERVAL_PRESETS = [10, 15, 20, 30] as const;
export const DURATION_PRESETS = [3, 6, 9, 12] as const;
export const DAILY_EXTRA_PRESETS = [100, 200, 400, 500] as const;
export const MAX_INSTALLMENTS = 120;

export interface PlanTerms {
  original_minor: number;
  advance_minor: number;
  /** Day 0 of the agreement. */
  start_on: string;
  /** Daily Extra per day; 0 = none. */
  extra_rate_minor: number;
  extra_free_days: number;
  extra_end: ExtraEnd;
  extra_end_on: string | null;
  extra_days: number | null;
  /** Late fine; 0 = none. */
  fine_minor: number;
  fine_mode: FineMode;
  fine_grace_days: number;
}

export interface ScheduleItem {
  n: number;
  due_on: string;
  principal_minor: number;
}

export interface Allocation {
  /** 0 = the advance. */
  n: number;
  part: AllocPart;
  minor: number;
}

export interface PlanPayment {
  id: string;
  paid_on: string;
  created_at: string;
  reversed: boolean;
  /** Amount credited to the plan, in the plan currency. */
  credited_minor: number;
  allocations: Allocation[];
}

export interface FineWaiver {
  id: string;
  n: number;
  minor: number;
  undone: boolean;
}

export interface PlanCore {
  terms: PlanTerms;
  advance_due_on: string | null;
  schedule: ScheduleItem[];
  payments: PlanPayment[];
  waivers: FineWaiver[];
  cancelled_on: string | null;
}

export type EntryStatus = "paid" | "overdue" | "due" | "partial" | "upcoming" | "cancelled";

export interface EntryState {
  /** 0 = advance, 1..N = installments. */
  n: number;
  due_on: string;
  /** First day of this installment's Daily Extra period (null for the advance). */
  period_from: string | null;
  principal: number;
  /** Daily Extra of this installment (scheduled; after any early-payoff or cancellation cut-off). */
  extra: number;
  extra_days: number;
  /** Part of `extra` for days up to the as-of date. */
  extra_accrued: number;
  /** Late fine assessed up to the as-of date (before waivers). */
  fine: number;
  fine_waived: number;
  late_days: number;
  paid_principal: number;
  paid_extra: number;
  paid_fine: number;
  /** qist + Daily Extra. */
  due_total: number;
  /** Unpaid qist + Daily Extra. */
  remaining: number;
  fine_remaining: number;
  cleared_on: string | null;
  last_paid_on: string | null;
  status: EntryStatus;
}

export interface PlanTotals {
  /** Original account price = advance + all qist. */
  principal: number;
  extra: number;
  extra_accrued: number;
  fine: number;
  fine_waived: number;
  /** Original price + Daily Extra + (fines − waivers). The advance is part of the price, never added twice. */
  grand_total: number;
  paid_principal: number;
  paid_extra: number;
  paid_fine: number;
  /** Everything applied to what was owed (advance, qist, Daily Extra, fines). */
  collected: number;
  /** Overpayment held for the customer. Not income. */
  credit: number;
  /** All money received for this plan = collected + credit. */
  received: number;
  remaining_principal: number;
  remaining_extra: number;
  remaining_fine: number;
  remaining_total: number;
  overdue_count: number;
  overdue_amount: number;
}

export type PlanStatus = "active" | "paid" | "overdue" | "cancelled";

export interface PlanState {
  as_of: string;
  entries: EntryState[];
  totals: PlanTotals;
  status: PlanStatus;
  /** Date the whole price was paid (early payoff stops Daily Extra from the next day). */
  settled_on: string | null;
  /** First entry that is not fully paid. */
  next: EntryState | null;
  advance_paid: boolean;
}

/* ------------------------------------------------------------------ */
/* Schedule generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Split the remaining principal into `count` installments: each one is the exact share rounded half up
 * to the minor unit and the FINAL installment absorbs the rounding (50,000 / 3 -> 16,666.67, 16,666.67,
 * 16,666.66). Never negative.
 */
export function splitPrincipal(total: number, count: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RuleError("plan_principal", "Remaining amount must be a whole number of minor units");
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) throw new RuleError("plan_count", `Number of installments must be 1–${MAX_INSTALLMENTS}`);
  let share = Math.floor((total * 2 + count) / (2 * count)); // round half up
  if (share * (count - 1) > total) share = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i < count - 1 ? share : total - share * (count - 1)));
}

/** Due dates every `intervalDays` from the first due date (real calendar arithmetic). */
export function autoDueDates(firstDueOn: string, count: number, intervalDays: number): string[] {
  if (!isCalendarDate(firstDueOn)) throw new RuleError("plan_date", "Enter a valid first due date");
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 366) throw new RuleError("plan_interval", "Interval must be 1–366 days");
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) throw new RuleError("plan_count", `Number of installments must be 1–${MAX_INSTALLMENTS}`);
  return Array.from({ length: count }, (_, i) => addDays(firstDueOn, i * intervalDays));
}

export function autoSchedule(o: { first_due_on: string; count: number; interval_days: number; principal_minor: number }): ScheduleItem[] {
  const dates = autoDueDates(o.first_due_on, o.count, o.interval_days);
  const amounts = splitPrincipal(o.principal_minor, o.count);
  return dates.map((due_on, i) => ({ n: i + 1, due_on, principal_minor: amounts[i] }));
}

/** Validates an agreement + schedule. Throws a RuleError with an owner-readable message. */
export function validatePlan(terms: PlanTerms, schedule: ScheduleItem[]): void {
  const t = terms;
  if (!isCalendarDate(t.start_on)) throw new RuleError("plan_start", "Enter a valid plan start date");
  for (const [k, v] of [["original price", t.original_minor], ["advance", t.advance_minor], ["Daily Extra", t.extra_rate_minor], ["late fine", t.fine_minor]] as const)
    if (!Number.isInteger(v) || v < 0) throw new RuleError("plan_amount", `The ${k} must be zero or more`);
  if (t.original_minor <= 0) throw new RuleError("plan_price", "Enter the original account price");
  if (t.advance_minor >= t.original_minor) throw new RuleError("plan_advance", "The advance must be less than the original price (otherwise use Instant Pay)");
  if (!Number.isInteger(t.extra_free_days) || t.extra_free_days < 0 || t.extra_free_days > 3660) throw new RuleError("plan_free", "Free period must be 0–3660 days");
  if (!Number.isInteger(t.fine_grace_days) || t.fine_grace_days < 0 || t.fine_grace_days > 365) throw new RuleError("plan_grace", "Grace period must be 0–365 days");
  if (t.extra_rate_minor > 0) {
    if (t.extra_end === "date" && (!t.extra_end_on || !isCalendarDate(t.extra_end_on) || dayNumber(t.extra_end_on) <= dayNumber(t.start_on)))
      throw new RuleError("plan_extra_end", "Enter the date Daily Extra ends (after the start date)");
    if (t.extra_end === "days" && (!Number.isInteger(t.extra_days) || (t.extra_days ?? 0) < 1 || (t.extra_days ?? 0) > 3660))
      throw new RuleError("plan_extra_days", "Enter for how many days Daily Extra is charged (1–3660)");
  }
  if (!schedule.length) throw new RuleError("plan_count", "Add at least one installment");
  if (schedule.length > MAX_INSTALLMENTS) throw new RuleError("plan_count", `At most ${MAX_INSTALLMENTS} installments`);
  let prev = dayNumber(t.start_on) - 1;
  let sum = 0;
  schedule.forEach((s, i) => {
    if (s.n !== i + 1) throw new RuleError("plan_order", "Installments must be numbered 1, 2, 3 …");
    if (!isCalendarDate(s.due_on)) throw new RuleError("plan_date", `Installment ${s.n}: enter a valid due date`);
    const d = dayNumber(s.due_on);
    if (d <= prev)
      throw new RuleError("plan_date_order", i === 0 ? "The first due date cannot be before the plan start date" : `Installment ${s.n} must be due after installment ${s.n - 1}`);
    prev = d;
    if (!Number.isInteger(s.principal_minor) || s.principal_minor < 0) throw new RuleError("plan_amount", `Installment ${s.n}: enter a valid amount`);
    sum += s.principal_minor;
  });
  if (sum !== t.original_minor - t.advance_minor)
    throw new RuleError("plan_sum", `Installments must add up to the remaining amount (original price − advance). Difference: ${(t.original_minor - t.advance_minor - sum) / 100}`);
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const byTime = (a: PlanPayment, b: PlanPayment) =>
  a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;

/** Last chargeable Daily Extra day (relative to Day 0) given settlement / cancellation / as-of days. */
function extraLastDay(t: PlanTerms, finalDue: number, asOfDay: number, settled: number | null, cancelled: number | null): number {
  let last: number;
  const start = dayNumber(t.start_on);
  switch (t.extra_end) {
    case "date":
      last = t.extra_end_on ? dayNumber(t.extra_end_on) - start : finalDue;
      break;
    case "days":
      last = t.extra_free_days + (t.extra_days ?? 0);
      break;
    case "paid":
      last = settled ?? Math.max(finalDue, asOfDay);
      break;
    default:
      last = finalDue;
  }
  if (settled !== null) last = Math.min(last, settled);
  if (cancelled !== null) last = Math.min(last, cancelled);
  return last;
}

/**
 * Full state of a plan on `asOf` (YYYY-MM-DD). `assumeSettledOn` (used to quote an early payoff) treats the
 * whole remaining price as paid on that date.
 */
export function computePlanState(core: PlanCore, asOf: string, opts: { assumeSettledOn?: string } = {}): PlanState {
  const t = core.terms;
  const start = dayNumber(t.start_on);
  const rel = (d: string) => dayNumber(d) - start;
  const asOfDay = rel(asOf);
  const sched = core.schedule;
  const N = sched.length;
  const D = sched.map((s) => rel(s.due_on));
  const finalDue = D[N - 1] ?? 0;
  const cancelled = core.cancelled_on ? rel(core.cancelled_on) : null;

  // Entries: advance (0) then installments.
  const principal = [t.advance_minor, ...sched.map((s) => s.principal_minor)];
  const dueOn = [core.advance_due_on ?? t.start_on, ...sched.map((s) => s.due_on)];
  const idx = (n: number) => (n >= 0 && n <= N ? n : -1);

  const live = core.payments.filter((p) => !p.reversed).sort(byTime);

  // Settlement day: the first payment after which every entry's principal is covered.
  let settled: number | null = opts.assumeSettledOn ? rel(opts.assumeSettledOn) : null;
  if (settled === null) {
    const cum = new Array(N + 1).fill(0);
    for (const p of live) {
      for (const a of p.allocations) if (a.part === "principal" && idx(a.n) >= 0) cum[a.n] += a.minor;
      if (principal.every((v, i) => cum[i] >= v)) {
        settled = rel(p.paid_on);
        break;
      }
    }
  }

  // Daily Extra per installment.
  const rate = t.extra_rate_minor;
  const first = t.extra_free_days + 1;
  const last = extraLastDay(t, finalDue, asOfDay, settled, cancelled);
  const extraDays = new Array(N + 1).fill(0);
  const accruedDays = new Array(N + 1).fill(0);
  const periodFrom: (string | null)[] = [null];
  for (let n = 1; n <= N; n++) {
    const lo = Math.max(first, (n === 1 ? 0 : D[n - 2]) + 1);
    const hi = n === N ? last : Math.min(last, D[n - 1]);
    periodFrom.push(fromDayNumber(start + (n === 1 ? 0 : D[n - 2]) + 1));
    if (rate > 0) {
      extraDays[n] = Math.max(0, hi - lo + 1);
      accruedDays[n] = Math.max(0, Math.min(hi, asOfDay) - lo + 1);
    }
  }
  const extra = extraDays.map((d) => d * rate);

  // Paid per entry and component (raw), and the day qist + Daily Extra was fully covered.
  const paidP = new Array(N + 1).fill(0);
  const paidX = new Array(N + 1).fill(0);
  const paidF = new Array(N + 1).fill(0);
  const lastPaid: (string | null)[] = new Array(N + 1).fill(null);
  // Nothing owed (e.g. no Daily Extra on a zero qist): cleared on its own due day, so never late.
  const cleared: (number | null)[] = principal.map((p, i) => (p + extra[i] === 0 ? (i === 0 ? rel(dueOn[0]) : D[i - 1]) : null));
  let creditAlloc = 0;
  for (const p of live) {
    for (const a of p.allocations) {
      if (a.part === "credit") {
        creditAlloc += a.minor;
        continue;
      }
      const i = idx(a.n);
      if (i < 0) {
        creditAlloc += a.minor; // allocation to an installment that no longer exists: held as credit
        continue;
      }
      if (a.part === "principal") paidP[i] += a.minor;
      else if (a.part === "extra") paidX[i] += a.minor;
      else paidF[i] += a.minor;
      lastPaid[i] = p.paid_on;
    }
    for (let i = 0; i <= N; i++)
      if (cleared[i] === null && paidP[i] >= principal[i] && paidX[i] >= extra[i]) cleared[i] = rel(p.paid_on);
  }

  // Late fines.
  const waived = new Array(N + 1).fill(0);
  for (const w of core.waivers) if (!w.undone && idx(w.n) > 0) waived[w.n] += w.minor;
  const fine = new Array(N + 1).fill(0);
  const lateDays = new Array(N + 1).fill(0);
  if (t.fine_minor > 0)
    for (let n = 1; n <= N; n++) {
      const lateFrom = D[n - 1] + t.fine_grace_days + 1;
      let end = Math.min(cleared[n] ?? Infinity, asOfDay);
      if (cancelled !== null) end = Math.min(end, cancelled);
      const days = Math.max(0, end - lateFrom + 1);
      lateDays[n] = days;
      fine[n] = days === 0 ? 0 : t.fine_mode === "per_day" ? days * t.fine_minor : t.fine_minor;
    }

  // Entry states (paid amounts capped at what is owed; any excess becomes customer credit).
  let excess = 0;
  const entries: EntryState[] = principal.map((p, i) => {
    const fw = Math.min(fine[i], waived[i]);
    const pp = Math.min(paidP[i], p);
    const px = Math.min(paidX[i], extra[i]);
    const pf = Math.min(paidF[i], fine[i] - fw);
    excess += paidP[i] - pp + paidX[i] - px + paidF[i] - pf;
    const remaining = p - pp + extra[i] - px;
    const graceEnd = i === 0 ? rel(dueOn[0]) : D[i - 1] + t.fine_grace_days;
    const dueDay = i === 0 ? rel(dueOn[0]) : D[i - 1];
    let status: EntryStatus;
    if (remaining === 0) status = "paid";
    else if (cancelled !== null) status = "cancelled";
    else if (asOfDay > graceEnd) status = "overdue";
    else if (asOfDay >= dueDay) status = "due";
    else status = pp + px > 0 ? "partial" : "upcoming";
    return {
      n: i,
      due_on: dueOn[i],
      period_from: periodFrom[i],
      principal: p,
      extra: extra[i],
      extra_days: extraDays[i],
      extra_accrued: accruedDays[i] * rate,
      fine: fine[i],
      fine_waived: fw,
      late_days: lateDays[i],
      paid_principal: pp,
      paid_extra: px,
      paid_fine: pf,
      due_total: p + extra[i],
      remaining,
      fine_remaining: fine[i] - fw - pf,
      cleared_on: cleared[i] === null ? null : fromDayNumber(start + cleared[i]!),
      last_paid_on: lastPaid[i],
      status,
    };
  });

  const sum = (f: (e: EntryState) => number) => entries.reduce((a, e) => a + f(e), 0);
  const credit = creditAlloc + excess;
  const totals: PlanTotals = {
    principal: sum((e) => e.principal),
    extra: sum((e) => e.extra),
    extra_accrued: sum((e) => e.extra_accrued),
    fine: sum((e) => e.fine),
    fine_waived: sum((e) => e.fine_waived),
    grand_total: 0,
    paid_principal: sum((e) => e.paid_principal),
    paid_extra: sum((e) => e.paid_extra),
    paid_fine: sum((e) => e.paid_fine),
    collected: 0,
    credit,
    received: live.reduce((a, p) => a + p.credited_minor, 0),
    remaining_principal: sum((e) => e.principal - e.paid_principal),
    remaining_extra: sum((e) => e.extra - e.paid_extra),
    remaining_fine: sum((e) => e.fine_remaining),
    remaining_total: 0,
    overdue_count: entries.filter((e) => e.status === "overdue").length,
    overdue_amount: sum((e) => (e.status === "overdue" ? e.remaining + e.fine_remaining : 0)),
  };
  totals.grand_total = totals.principal + totals.extra + totals.fine - totals.fine_waived;
  totals.collected = totals.paid_principal + totals.paid_extra + totals.paid_fine;
  totals.remaining_total = totals.remaining_principal + totals.remaining_extra + totals.remaining_fine;

  const next = entries.find((e) => e.remaining > 0) ?? null;
  const status: PlanStatus =
    cancelled !== null ? "cancelled" : totals.remaining_total === 0 && totals.remaining_principal === 0 ? "paid" : totals.overdue_count > 0 ? "overdue" : "active";
  return {
    as_of: asOf,
    entries,
    totals,
    status,
    settled_on: settled === null ? null : fromDayNumber(start + settled),
    next,
    advance_paid: entries[0].remaining === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export interface SettlementQuote {
  principal: number;
  extra: number;
  fine: number;
  total: number;
}

/** What the customer must pay on `on` to clear the plan completely (Daily Extra only up to that day). */
export function settlementQuote(core: PlanCore, on: string): SettlementQuote {
  const s = computePlanState(core, on, { assumeSettledOn: on });
  return {
    principal: s.totals.remaining_principal,
    extra: s.totals.remaining_extra,
    fine: s.totals.remaining_fine,
    total: s.totals.remaining_total,
  };
}

function outstandingOrder(s: PlanState): Allocation[] {
  const out: Allocation[] = [];
  for (const e of s.entries) {
    if (e.n === 0) {
      if (e.principal - e.paid_principal > 0) out.push({ n: 0, part: "principal", minor: e.principal - e.paid_principal });
      continue;
    }
    if (e.extra - e.paid_extra > 0) out.push({ n: e.n, part: "extra", minor: e.extra - e.paid_extra });
    if (e.principal - e.paid_principal > 0) out.push({ n: e.n, part: "principal", minor: e.principal - e.paid_principal });
    if (e.fine_remaining > 0) out.push({ n: e.n, part: "fine", minor: e.fine_remaining });
  }
  return out;
}

/**
 * Default allocation of a payment of `credited` (plan currency) received on `paidOn`: oldest first; inside an
 * installment Daily Extra, then qist, then its late fine; the rest is customer credit. When the payment clears
 * the whole plan, Daily Extra is only charged up to the payment day (early payoff).
 */
export function suggestAllocation(core: PlanCore, paidOn: string, credited: number): { allocations: Allocation[]; settles: boolean; credit: number } {
  if (!Number.isInteger(credited) || credited <= 0) throw new RuleError("pay_amount", "The payment must be greater than zero");
  const quote = settlementQuote(core, paidOn);
  const settles = quote.total > 0 && credited >= quote.total;
  const state = settles ? computePlanState(core, paidOn, { assumeSettledOn: paidOn }) : computePlanState(core, paidOn);
  let left = credited;
  const allocations: Allocation[] = [];
  for (const o of outstandingOrder(state)) {
    if (left <= 0) break;
    const take = Math.min(left, o.minor);
    allocations.push({ ...o, minor: take });
    left -= take;
  }
  if (left > 0) allocations.push({ n: 0, part: "credit", minor: left });
  return { allocations, settles, credit: left };
}

/** Checks an owner-entered allocation: valid parts, nothing more than is owed, and it adds up to the payment. */
export function validateAllocation(core: PlanCore, paidOn: string, credited: number, allocations: Allocation[]): void {
  if (!allocations.length) throw new RuleError("alloc_empty", "Allocate the payment");
  const seen = new Set<string>();
  let sum = 0;
  const projected = computePlanState(core, paidOn);
  const settled = computePlanState(core, paidOn, { assumeSettledOn: paidOn });
  const cap = (s: PlanState, n: number, part: AllocPart) => {
    const e = s.entries[n];
    if (!e) return -1;
    if (part === "principal") return e.principal - e.paid_principal;
    if (part === "extra") return e.extra - e.paid_extra;
    if (part === "fine") return e.fine_remaining;
    return Infinity;
  };
  for (const a of allocations) {
    if (!Number.isInteger(a.minor) || a.minor <= 0) throw new RuleError("alloc_amount", "Allocated amounts must be greater than zero");
    if (!ALLOC_PARTS.includes(a.part)) throw new RuleError("alloc_part", "Unknown allocation part");
    if (a.part !== "credit" && (a.n < 0 || a.n >= projected.entries.length)) throw new RuleError("alloc_entry", `Installment ${a.n} does not exist`);
    if (a.n === 0 && (a.part === "extra" || a.part === "fine")) throw new RuleError("alloc_advance", "The advance has no Daily Extra or fine");
    const key = `${a.n}:${a.part}`;
    if (seen.has(key)) throw new RuleError("alloc_duplicate", "Each part can be allocated once per payment");
    seen.add(key);
    if (a.part !== "credit" && a.minor > Math.max(cap(projected, a.n, a.part), cap(settled, a.n, a.part)))
      throw new RuleError("alloc_exceeds", `${a.n === 0 ? "Advance" : `Installment ${a.n}`}: more ${a.part === "principal" ? "qist" : a.part === "extra" ? "Daily Extra" : "fine"} than is owed — put the rest into customer credit`);
    sum += a.minor;
  }
  if (sum !== credited) throw new RuleError("alloc_sum", "The allocation must add up to exactly the amount received");
}

/* ------------------------------------------------------------------ */
/* Schedule revisions                                                  */
/* ------------------------------------------------------------------ */

export type Revision =
  /** Change one due date ("one") or this and every later one ("following", re-spaced by the interval or shifted). */
  | { kind: "move"; n: number; due_on: string; scope: "one" | "following"; interval_days?: number | null }
  /** New qist amounts for unpaid installments; the total stays the same. */
  | { kind: "amounts"; amounts: { n: number; principal_minor: number }[] }
  /** Replace every installment from `from_n` on (all unpaid) with a new count, interval and first date. */
  | { kind: "regenerate"; from_n: number; count: number; interval_days: number; first_due_on: string };

export interface RevisionDiffRow {
  n: number;
  before: { due_on: string; principal: number; extra: number } | null;
  after: { due_on: string; principal: number; extra: number } | null;
  changed: boolean;
}

export interface RevisionResult {
  schedule: ScheduleItem[];
  diff: RevisionDiffRow[];
  extra_before: number;
  extra_after: number;
}

/**
 * Preview (and validate) a schedule change. Paid installments are never changed: their date, qist and
 * Daily Extra must stay exactly the same, and no installment may end up owing less than was already paid.
 */
export function reviseSchedule(core: PlanCore, rev: Revision, asOf: string): RevisionResult {
  const before = computePlanState(core, asOf);
  const old = core.schedule;
  const paidEntry = (n: number) => before.entries[n]?.status === "paid";
  const touched = (n: number) => {
    const e = before.entries[n];
    return !!e && e.paid_principal + e.paid_extra > 0;
  };
  let next: ScheduleItem[];
  switch (rev.kind) {
    case "move": {
      const i = rev.n - 1;
      if (!old[i]) throw new RuleError("rev_entry", `Installment ${rev.n} does not exist`);
      if (!isCalendarDate(rev.due_on)) throw new RuleError("rev_date", "Enter a valid date");
      if (paidEntry(rev.n)) throw new RuleError("rev_paid", `Installment ${rev.n} is already paid; its date cannot change`);
      const delta = daysBetween(old[i].due_on, rev.due_on);
      next = old.map((s, k) => {
        if (k < i) return s;
        if (k === i) return { ...s, due_on: rev.due_on };
        if (rev.scope === "one") return s;
        const due_on = rev.interval_days ? addDays(rev.due_on, (k - i) * rev.interval_days) : addDays(s.due_on, delta);
        return { ...s, due_on };
      });
      break;
    }
    case "amounts": {
      next = old.map((s) => ({ ...s }));
      for (const a of rev.amounts) {
        const s = next[a.n - 1];
        if (!s) throw new RuleError("rev_entry", `Installment ${a.n} does not exist`);
        if (!Number.isInteger(a.principal_minor) || a.principal_minor < 0) throw new RuleError("rev_amount", `Installment ${a.n}: enter a valid amount`);
        if (a.principal_minor === s.principal_minor) continue;
        if (paidEntry(a.n)) throw new RuleError("rev_paid", `Installment ${a.n} is already paid; its amount cannot change`);
        if (a.principal_minor < before.entries[a.n].paid_principal)
          throw new RuleError("rev_below_paid", `Installment ${a.n}: the new qist is less than what was already paid`);
        s.principal_minor = a.principal_minor;
      }
      break;
    }
    case "regenerate": {
      const from = rev.from_n;
      if (!Number.isInteger(from) || from < 1 || from > old.length) throw new RuleError("rev_entry", "Choose the first installment to reschedule");
      for (let n = from; n <= old.length; n++)
        if (touched(n)) throw new RuleError("rev_paid", `Installment ${n} already has a payment; reschedule from installment ${n + 1}`);
      const keep = old.slice(0, from - 1);
      const remaining = old.slice(from - 1).reduce((a, s) => a + s.principal_minor, 0);
      const gen = autoSchedule({ first_due_on: rev.first_due_on, count: rev.count, interval_days: rev.interval_days, principal_minor: remaining });
      next = [...keep, ...gen.map((g, k) => ({ ...g, n: from + k }))];
      break;
    }
    default:
      throw new RuleError("rev_kind", "Unknown schedule change");
  }

  validatePlan(core.terms, next);
  const after = computePlanState({ ...core, schedule: next }, asOf);
  const rows: RevisionDiffRow[] = [];
  const len = Math.max(old.length, next.length);
  for (let k = 1; k <= len; k++) {
    const b = before.entries[k];
    const a = after.entries[k];
    const bv = b ? { due_on: b.due_on, principal: b.principal, extra: b.extra } : null;
    const av = a ? { due_on: a.due_on, principal: a.principal, extra: a.extra } : null;
    const changed = JSON.stringify(bv) !== JSON.stringify(av);
    if (changed && b && b.status === "paid")
      throw new RuleError("rev_paid_extra", `This change would alter installment ${k}, which is already paid (date, qist or Daily Extra). Choose another change.`);
    if (a && b && (a.extra < b.paid_extra || a.principal < b.paid_principal))
      throw new RuleError("rev_below_paid", `Installment ${k} would owe less than was already paid`);
    rows.push({ n: k, before: bv, after: av, changed });
  }
  if (!rows.some((r) => r.changed)) throw new RuleError("rev_nochange", "Nothing changes with these values");
  return { schedule: next, diff: rows, extra_before: before.totals.extra, extra_after: after.totals.extra };
}

/* ------------------------------------------------------------------ */
/* Helpers for receipts and summaries                                  */
/* ------------------------------------------------------------------ */

/** "Month 1" when installments fall roughly monthly, otherwise "Qist 1". */
export function installmentLabel(intervalDays: number | null | undefined, n: number): string {
  return intervalDays && intervalDays >= 28 && intervalDays <= 31 ? `Month ${n}` : `Qist ${n}`;
}

/** Calendar date of the first chargeable Daily Extra day. */
export function extraStartDate(t: Pick<PlanTerms, "start_on" | "extra_free_days">): string {
  return addDays(t.start_on, t.extra_free_days + 1);
}
