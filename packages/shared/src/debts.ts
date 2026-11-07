import { localDate } from "./calendar";
import type { Debt, DebtCharge, Payment } from "./entities";
import type { PayCurrency } from "./money";

/**
 * MONEY TO RECEIVE / MONEY TO PAY — personal or business amounts that are not account sales.
 *
 *   owed       = original amount + charges (interest / service charges, recorded separately) − discounts
 *   payments   = principal first, then charges; anything beyond what is owed is an overpayment
 *   remaining  = owed − paid
 *
 * Receiving the principal of money owed to you is NOT profit, and paying back money you owe is NOT an
 * expense: only charges (interest / service charges) count in profit, as income (to receive) or as a cost
 * (to pay), when they are actually received or paid.
 */
export type DebtStatus = "open" | "partial" | "settled" | "overdue" | "cancelled";

export interface DebtAllocation {
  part: "principal" | "charge" | "credit";
  minor: number;
}

export interface DebtState {
  currency: PayCurrency;
  principal: number;
  charges: number;
  discounts: number;
  owed: number;
  paid_principal: number;
  paid_charges: number;
  paid: number;
  overpaid: number;
  remaining: number;
  remaining_principal: number;
  status: DebtStatus;
  payments: Payment[];
  last_paid_on: string | null;
}

export function parseCharges(d: Pick<Debt, "charges_json">): DebtCharge[] {
  try {
    const v = JSON.parse(d.charges_json) as DebtCharge[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function parseDebtAllocations(p: Pick<Payment, "allocations_json">): DebtAllocation[] {
  try {
    const v = JSON.parse(p.allocations_json) as DebtAllocation[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Live (not reversed, not deleted) payments of one record, oldest first. */
function livePayments(payments: Payment[], debtId: string): Payment[] {
  return payments
    .filter((p) => !p.deleted && p.status === "recorded" && p.debt_id === debtId)
    .sort((a, b) => a.paid_on.localeCompare(b.paid_on) || a.created_at.localeCompare(b.created_at));
}

export function computeDebtState(d: Debt, allPayments: Payment[], asOf: string = localDate()): DebtState {
  const charges = parseCharges(d);
  const chargeSum = charges.filter((c) => c.kind === "charge").reduce((a, c) => a + c.minor, 0);
  const discountSum = charges.filter((c) => c.kind === "discount").reduce((a, c) => a + c.minor, 0);
  const owed = Math.max(0, d.original_minor + chargeSum - discountSum);
  const payments = livePayments(allPayments, d.id);
  let paidP = 0;
  let paidC = 0;
  let credit = 0;
  for (const p of payments)
    for (const a of parseDebtAllocations(p)) {
      if (a.part === "principal") paidP += a.minor;
      else if (a.part === "charge") paidC += a.minor;
      else credit += a.minor;
    }
  // Discounts reduce the charges first, then the principal.
  const netCharges = Math.max(0, chargeSum - discountSum);
  const netPrincipal = Math.min(d.original_minor, owed);
  const capP = Math.min(paidP, netPrincipal);
  const capC = Math.min(paidC, netCharges);
  const overpaid = credit + (paidP - capP) + (paidC - capC);
  const paid = capP + capC;
  const remaining = owed - paid;
  let status: DebtStatus;
  if (d.status === "cancelled") status = "cancelled";
  else if (remaining <= 0) status = "settled";
  else if (d.due_on && asOf > d.due_on) status = "overdue";
  else status = paid > 0 ? "partial" : "open";
  return {
    currency: d.currency,
    principal: d.original_minor,
    charges: chargeSum,
    discounts: discountSum,
    owed,
    paid_principal: capP,
    paid_charges: capC,
    paid,
    overpaid,
    remaining,
    remaining_principal: netPrincipal - capP,
    status,
    payments,
    last_paid_on: payments.length ? payments[payments.length - 1].paid_on : null,
  };
}

/** Principal first, then charges; the rest is an overpayment. */
export function allocateDebtPayment(state: DebtState, credited: number): DebtAllocation[] {
  const out: DebtAllocation[] = [];
  let left = credited;
  const p = Math.min(left, state.remaining_principal);
  if (p > 0) out.push({ part: "principal", minor: p }), (left -= p);
  const c = Math.min(left, state.remaining - state.remaining_principal);
  if (c > 0) out.push({ part: "charge", minor: c }), (left -= c);
  if (left > 0) out.push({ part: "credit", minor: left });
  return out;
}
