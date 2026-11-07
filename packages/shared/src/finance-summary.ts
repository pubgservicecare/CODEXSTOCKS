import { addDays, localDate } from "./calendar";
import { computeDebtState, type DebtState } from "./debts";
import type { Debt, InstallmentPlan, Payment } from "./entities";
import type { EntryState, PlanState } from "./installments";
import type { PayCurrency } from "./money";
import { planStateOf } from "./receipt-data";

/**
 * Figures for the dashboard and the Payments overview. Amounts stay in their own currency (a map per
 * currency); the UI shows a PKR total with "≈" only when it converts with a rate it names.
 */
export type Amounts = Partial<Record<PayCurrency, number>>;

export function addAmount(m: Amounts, c: PayCurrency, v: number) {
  if (!v) return;
  m[c] = (m[c] ?? 0) + v;
}

export interface PlanRow {
  plan: InstallmentPlan;
  state: PlanState;
  payments: Payment[];
}

export interface DueItem {
  plan: InstallmentPlan;
  entry: EntryState;
  amount: number;
}

export interface FinanceSummary {
  as_of: string;
  plans: PlanRow[];
  debts: { debt: Debt; state: DebtState }[];
  activePlans: number;
  /** Money owed TO the owner: unpaid plan balances + Money to Receive. */
  owedToMe: Amounts;
  /** Money the owner owes: Money to Pay. */
  iOwe: Amounts;
  planOutstanding: Amounts;
  receivableOutstanding: Amounts;
  upcoming: { count: number; amounts: Amounts; items: DueItem[] };
  overdue: { count: number; amounts: Amounts; items: DueItem[] };
  extraExpected: Amounts;
  extraCollected: Amounts;
  finesOutstanding: Amounts;
  finesCollected: Amounts;
  customerCredit: Amounts;
  receivedToday: { count: number; amounts: Amounts };
  receivedMonth: { count: number; amounts: Amounts };
  paidOutMonth: { count: number; amounts: Amounts };
}

export function financeSummary(input: { plans: InstallmentPlan[]; payments: Payment[]; debts: Debt[]; asOf?: string; upcomingDays?: number }): FinanceSummary {
  const asOf = input.asOf ?? localDate();
  const horizon = addDays(asOf, input.upcomingDays ?? 7);
  const month = asOf.slice(0, 7);
  const s: FinanceSummary = {
    as_of: asOf,
    plans: [],
    debts: [],
    activePlans: 0,
    owedToMe: {},
    iOwe: {},
    planOutstanding: {},
    receivableOutstanding: {},
    upcoming: { count: 0, amounts: {}, items: [] },
    overdue: { count: 0, amounts: {}, items: [] },
    extraExpected: {},
    extraCollected: {},
    finesOutstanding: {},
    finesCollected: {},
    customerCredit: {},
    receivedToday: { count: 0, amounts: {} },
    receivedMonth: { count: 0, amounts: {} },
    paidOutMonth: { count: 0, amounts: {} },
  };
  const byPlan = new Map<string, Payment[]>();
  for (const p of input.payments) if (!p.deleted && p.plan_id) byPlan.set(p.plan_id, [...(byPlan.get(p.plan_id) ?? []), p]);

  for (const plan of input.plans) {
    if (plan.deleted) continue;
    const payments = byPlan.get(plan.id) ?? [];
    const state = planStateOf(plan, payments, asOf);
    s.plans.push({ plan, state, payments });
    const c = plan.currency;
    addAmount(s.extraCollected, c, state.totals.paid_extra);
    addAmount(s.finesCollected, c, state.totals.paid_fine);
    addAmount(s.customerCredit, c, state.totals.credit);
    if (plan.status === "cancelled") continue;
    if (state.status !== "paid") s.activePlans++;
    addAmount(s.planOutstanding, c, state.totals.remaining_total);
    addAmount(s.owedToMe, c, state.totals.remaining_total);
    addAmount(s.extraExpected, c, state.totals.extra);
    addAmount(s.finesOutstanding, c, state.totals.remaining_fine);
    for (const e of state.entries) {
      const owed = e.remaining + e.fine_remaining;
      if (!owed) continue;
      if (e.status === "overdue") {
        s.overdue.count++;
        addAmount(s.overdue.amounts, c, owed);
        s.overdue.items.push({ plan, entry: e, amount: owed });
      } else if (e.remaining > 0 && e.due_on <= horizon) {
        s.upcoming.count++;
        addAmount(s.upcoming.amounts, c, e.remaining);
        s.upcoming.items.push({ plan, entry: e, amount: e.remaining });
      }
    }
  }
  s.overdue.items.sort((a, b) => a.entry.due_on.localeCompare(b.entry.due_on));
  s.upcoming.items.sort((a, b) => a.entry.due_on.localeCompare(b.entry.due_on));

  for (const debt of input.debts) {
    if (debt.deleted) continue;
    const state = computeDebtState(debt, input.payments, asOf);
    s.debts.push({ debt, state });
    if (state.status === "cancelled") continue;
    if (debt.direction === "receive") {
      addAmount(s.owedToMe, debt.currency, state.remaining);
      addAmount(s.receivableOutstanding, debt.currency, state.remaining);
    } else addAmount(s.iOwe, debt.currency, state.remaining);
  }

  const debtDir = new Map(input.debts.map((d) => [d.id, d.direction]));
  for (const p of input.payments) {
    if (p.deleted || p.status !== "recorded") continue;
    const incoming = p.target === "plan" || debtDir.get(p.debt_id ?? "") === "receive";
    if (incoming) {
      if (p.paid_on === asOf) {
        s.receivedToday.count++;
        addAmount(s.receivedToday.amounts, p.currency, p.amount_minor);
      }
      if (p.paid_on.slice(0, 7) === month) {
        s.receivedMonth.count++;
        addAmount(s.receivedMonth.amounts, p.currency, p.amount_minor);
      }
    } else if (p.paid_on.slice(0, 7) === month) {
      s.paidOutMonth.count++;
      addAmount(s.paidOutMonth.amounts, p.currency, p.amount_minor);
    }
  }
  return s;
}

/** Total of an amounts map in PKR with the given PKR-per-unit rates; null parts are reported as missing. */
export function amountsInPkr(m: Amounts, rates: Partial<Record<PayCurrency, number | null>>): { pkr: number; converted: boolean; missing: PayCurrency[] } {
  let pkr = 0;
  let converted = false;
  const missing: PayCurrency[] = [];
  for (const [c, v] of Object.entries(m) as [PayCurrency, number][]) {
    if (!v) continue;
    if (c === "PKR") pkr += v;
    else {
      const r = rates[c];
      if (!r) missing.push(c);
      else {
        pkr += Math.round((v * r) / 1_000_000);
        converted = true;
      }
    }
  }
  return { pkr, converted, missing };
}
