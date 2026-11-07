import { convertMinor, CURRENCIES, type Currency } from "./money";
import { convertUsdPkr, isValidUsdPkrMicro, toPkrMinor, usdPkrFromSaleRate } from "./fx";
import type { Account, Debt, Expense, InstallmentPlan, Payment, Refund, Sale } from "./entities";
import { parseDebtAllocations } from "./debts";
import { planStateOf } from "./receipt-data";
import { localDate } from "./calendar";

/**
 * PROFIT FORMULA (computed separately for each currency C — USD and PKR are never mixed):
 *
 *   Gross sales (C)   = Σ amount of sales in C whose status is completed or refunded
 *   Refunds (C)       = Σ refunds in C (refunds are always in their sale's currency)
 *   Net sales (C)     = Gross sales − Refunds
 *   Cost of sold (C)  = Σ purchase cost of accounts whose sale in C is still "completed",
 *                       converted into C with the exchange rate recorded on that sale when the
 *                       purchase currency differs. Restock-refunded sales ("refunded") return the
 *                       account to inventory, so their cost is NOT counted.
 *   Gross profit (C)  = Net sales − Cost of sold
 *   Expenses (C)      = Σ expenses in C
 *   Net profit (C)    = Gross profit − Expenses
 *
 * CASH VIEW (actual money in/out per currency — separate from profit, no double counting):
 *   Incoming (C)      = Gross sales (C)
 *   Outgoing (C)      = Σ purchase cost of every recorded account bought in C + Expenses (C) + Refunds (C)
 *   Net cash (C)      = Incoming − Outgoing
 *
 *   Inventory at cost (C) = Σ purchase cost of available + reserved accounts bought in C
 *
 * INSTALLMENT SALES (plans): the sale is an ordinary sale at the ORIGINAL price, so it is counted ONCE, when
 * it was sold. Collecting the advance and the qist is NOT new revenue. Only what the plan adds on top is
 * extra profit, when it is actually collected:
 *   + Daily Extra collected (C)   + Late fines collected (C)   − unpaid balance of cancelled plans written off (C)
 * Cash view: an installment sale brings in the money actually received (advance, qist, Daily Extra, fines,
 * overpayments), not the full price on the sale date:
 *   Incoming (C) = Gross sales − installment sales + plan payments received
 * Money to receive / to pay (personal or business) is never mixed into these books: only its interest or
 * service charges count, in the consolidated PKR view (see below).
 *
 * Voided sales are treated as never having happened. Deleted rows are ignored.
 */
export interface CurrencyReport {
  currency: Currency;
  grossSales: number;
  refunds: number;
  netSales: number;
  costOfSold: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  incoming: number;
  outgoing: number;
  purchases: number;
  netCash: number;
  inventoryValue: number;
  salesCount: number;
  missingRates: number;
  /** Installment plans (in the plan currency). */
  installmentSales: number;
  planCollected: number;
  planExtras: number;
  planFines: number;
  planWriteOffs: number;
}

export interface InventoryCounts {
  total: number;
  available: number;
  reserved: number;
  sold: number;
  archived: number;
  published: number;
}

export interface FinancialReport {
  counts: InventoryCounts;
  byCurrency: Record<Currency, CurrencyReport>;
}

type A = Pick<Account, "id" | "status" | "published" | "deleted" | "purchase_cost_minor" | "purchase_currency">;
type S = Pick<Sale, "id" | "account_id" | "amount_minor" | "currency" | "exchange_rate_micro" | "status" | "deleted">;
type R = Pick<Refund, "sale_id" | "amount_minor" | "currency" | "deleted">;
type X = Pick<Expense, "amount_minor" | "currency" | "deleted">;

function empty(currency: Currency): CurrencyReport {
  return {
    currency, grossSales: 0, refunds: 0, netSales: 0, costOfSold: 0, grossProfit: 0, expenses: 0, netProfit: 0,
    incoming: 0, outgoing: 0, purchases: 0, netCash: 0, inventoryValue: 0, salesCount: 0, missingRates: 0,
    installmentSales: 0, planCollected: 0, planExtras: 0, planFines: 0, planWriteOffs: 0,
  };
}

/** Cost of the sold account expressed in the sale currency. */
export function costInSaleCurrency(account: A, sale: S): number | null {
  if (account.purchase_currency === sale.currency) return account.purchase_cost_minor;
  if (!sale.exchange_rate_micro) return null;
  return convertMinor(account.purchase_cost_minor, sale.exchange_rate_micro);
}

export function computeReport(input: { accounts: A[]; sales: S[]; refunds: R[]; expenses: X[]; plans?: InstallmentPlan[]; payments?: Payment[]; asOf?: string }): FinancialReport {
  const by = Object.fromEntries(CURRENCIES.map((c) => [c, empty(c)])) as Record<Currency, CurrencyReport>;
  const counts: InventoryCounts = { total: 0, available: 0, reserved: 0, sold: 0, archived: 0, published: 0 };
  const accounts = new Map<string, A>();

  for (const a of input.accounts) {
    if (a.deleted) continue;
    accounts.set(a.id, a);
    counts.total++;
    counts[a.status]++;
    if (a.published && a.status === "available") counts.published++;
    const r = by[a.purchase_currency];
    r.purchases += a.purchase_cost_minor;
    if (a.status === "available" || a.status === "reserved") r.inventoryValue += a.purchase_cost_minor;
  }

  const liveSales = new Map<string, S>();
  for (const s of input.sales) {
    if (s.deleted || s.status === "voided") continue;
    liveSales.set(s.id, s);
    const r = by[s.currency];
    r.grossSales += s.amount_minor;
    r.salesCount++;
    if (s.status === "completed") {
      const acct = accounts.get(s.account_id);
      if (acct) {
        const cost = costInSaleCurrency(acct, s);
        if (cost === null) r.missingRates++;
        else r.costOfSold += cost;
      }
    }
  }

  for (const f of input.refunds) {
    if (f.deleted || !liveSales.has(f.sale_id)) continue;
    by[f.currency].refunds += f.amount_minor;
  }
  for (const e of input.expenses) {
    if (e.deleted) continue;
    by[e.currency].expenses += e.amount_minor;
  }

  for (const pl of planFigures(input.plans ?? [], input.payments ?? [], liveSales, input.asOf)) {
    const r = by[pl.plan.currency];
    r.installmentSales += pl.saleAmount;
    r.planCollected += pl.received;
    r.planExtras += pl.extras;
    r.planFines += pl.fines;
    r.planWriteOffs += pl.writeOff;
  }

  for (const c of CURRENCIES) {
    const r = by[c];
    r.netSales = r.grossSales - r.refunds;
    r.grossProfit = r.netSales - r.costOfSold;
    r.netProfit = r.grossProfit - r.expenses + r.planExtras + r.planFines - r.planWriteOffs;
    r.incoming = r.grossSales - r.installmentSales + r.planCollected;
    r.outgoing = r.purchases + r.expenses + r.refunds;
    r.netCash = r.incoming - r.outgoing;
  }
  return { counts, byCurrency: by };
}

interface PlanFigures {
  plan: InstallmentPlan;
  /** Amount of its sale (plan currency); 0 when the sale was voided. */
  saleAmount: number;
  received: number;
  extras: number;
  fines: number;
  writeOff: number;
  credit: number;
  payments: Payment[];
}

/**
 * Per-plan figures in the plan currency, from the engine — so Daily Extra that an early payoff cancelled
 * counts as customer credit, not income.
 */
export function planFigures(
  plans: InstallmentPlan[],
  payments: Payment[],
  liveSales: Map<string, Pick<Sale, "id" | "amount_minor">>,
  asOf?: string,
): PlanFigures[] {
  const out: PlanFigures[] = [];
  const day = asOf ?? localDate();
  for (const plan of plans) {
    if (plan.deleted) continue;
    const sale = liveSales.get(plan.sale_id);
    const mine = payments.filter((p) => !p.deleted && p.plan_id === plan.id);
    const at = plan.status === "cancelled" && plan.cancelled_on && plan.cancelled_on < day ? plan.cancelled_on : day;
    const state = planStateOf(plan, mine, at);
    out.push({
      plan,
      saleAmount: sale ? sale.amount_minor : 0,
      received: state.totals.received,
      extras: state.totals.paid_extra,
      fines: state.totals.paid_fine,
      writeOff: plan.status === "cancelled" && sale ? state.totals.remaining_principal : 0,
      credit: state.totals.credit,
      payments: mine.filter((p) => p.status === "recorded"),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Consolidated (PKR-equivalent) reporting                             */
/* ------------------------------------------------------------------ */

/**
 * CONSOLIDATED VIEW — every transaction converted into PKR (the canonical reporting currency) with
 * the USD/PKR rate RECORDED ON THAT TRANSACTION (never the current rate), then added up:
 *
 *   sale amount        -> sale snapshot (fx_usd_pkr_micro; for older cross-currency sales, derived
 *                         from exchange_rate_micro)
 *   refund             -> its sale's snapshot (refunds are always in the sale currency)
 *   cost of a sold     -> the sale's snapshot (the same rate the per-currency profit uses), falling
 *   USD account           back to the purchase snapshot
 *   purchase / stock   -> the account's purchase snapshot (purchase_fx_micro)
 *   expense            -> the expense snapshot
 *
 * PKR amounts need no rate. A USD amount without any recorded rate is NOT guessed: it is left out and
 * counted in `excluded`. The per-currency report above stays the authoritative native view.
 */
export interface ConsolidatedReport {
  currency: "PKR";
  grossSales: number;
  refunds: number;
  netSales: number;
  costOfSold: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  incoming: number;
  purchases: number;
  outgoing: number;
  netCash: number;
  inventoryValue: number;
  /** Installment plans and money owed, PKR (each at its recorded rates). */
  installmentSales: number;
  planCash: number;
  planExtras: number;
  planFines: number;
  planWriteOffs: number;
  /** Overpayments held for customers — owed back or to be used, never income. */
  customerCredit: number;
  debtChargesIn: number;
  debtChargesOut: number;
  excluded: { sales: number; refunds: number; costs: number; purchases: number; expenses: number; payments: number };
}

type FA = A & Partial<Pick<Account, "purchase_fx_micro" | "purchased_at" | "created_at">>;
type FS = S & Partial<Pick<Sale, "fx_usd_pkr_micro" | "sold_at">>;
type FR = R & Partial<Pick<Refund, "refunded_at" | "account_id">>;
type FX = X & Partial<Pick<Expense, "fx_usd_pkr_micro" | "incurred_at">>;

/** USD/PKR rate that applies to a sale: its snapshot, or one derived from its cross-currency rate. */
export function saleUsdPkr(sale: FS, account: Pick<Account, "purchase_currency"> | undefined): number | null {
  if (isValidUsdPkrMicro(sale.fx_usd_pkr_micro)) return sale.fx_usd_pkr_micro;
  return account ? usdPkrFromSaleRate(account.purchase_currency, sale.currency, sale.exchange_rate_micro) : null;
}

interface PkrEvent {
  at: string;
  pkr: number;
  /** A sale made on installments (its money arrives as plan payments). */
  plan?: boolean;
}

export interface ConsolidationInput {
  accounts: FA[];
  sales: FS[];
  refunds: FR[];
  expenses: FX[];
  plans?: InstallmentPlan[];
  payments?: Payment[];
  debts?: Debt[];
  asOf?: string;
}

/** PKR value of a payment at ITS recorded rate (null when a non-PKR payment has no PKR rate). */
export function paymentPkr(p: Pick<Payment, "amount_minor" | "currency" | "pkr_micro">): number | null {
  if (p.currency === "PKR") return p.amount_minor;
  return p.pkr_micro && p.pkr_micro > 0 ? convertMinor(p.amount_minor, p.pkr_micro) : null;
}

function toPkrEvents(input: ConsolidationInput) {
  const ev = { sales: [] as PkrEvent[], refunds: [] as PkrEvent[], purchases: [] as PkrEvent[], expenses: [] as PkrEvent[], planCash: [] as PkrEvent[] };
  const excluded = { sales: 0, refunds: 0, costs: 0, purchases: 0, expenses: 0, payments: 0 };
  const planSales = new Set((input.plans ?? []).filter((p) => !p.deleted).map((p) => p.sale_id));
  const accounts = new Map<string, FA>();
  let costOfSold = 0;
  let inventoryValue = 0;
  for (const a of input.accounts) {
    if (a.deleted) continue;
    accounts.set(a.id, a);
    const pkr = toPkrMinor(a.purchase_cost_minor, a.purchase_currency, a.purchase_fx_micro);
    if (pkr === null) {
      excluded.purchases++;
      continue;
    }
    ev.purchases.push({ at: a.purchased_at ?? a.created_at ?? "", pkr });
    if (a.status === "available" || a.status === "reserved") inventoryValue += pkr;
  }
  const live = new Map<string, number | null>();
  for (const s of input.sales) {
    if (s.deleted || s.status === "voided") continue;
    const acct = accounts.get(s.account_id);
    const rate = saleUsdPkr(s, acct);
    live.set(s.id, rate);
    const pkr = toPkrMinor(s.amount_minor, s.currency, rate);
    if (pkr === null) excluded.sales++;
    else ev.sales.push({ at: s.sold_at ?? "", pkr, plan: planSales.has(s.id) });
    if (s.status === "completed" && acct) {
      const cost = toPkrMinor(acct.purchase_cost_minor, acct.purchase_currency, rate ?? acct.purchase_fx_micro);
      if (cost === null) excluded.costs++;
      else costOfSold += cost;
    }
  }
  for (const f of input.refunds) {
    if (f.deleted || !live.has(f.sale_id)) continue;
    const pkr = toPkrMinor(f.amount_minor, f.currency, live.get(f.sale_id));
    if (pkr === null) excluded.refunds++;
    else ev.refunds.push({ at: f.refunded_at ?? "", pkr });
  }
  for (const e of input.expenses) {
    if (e.deleted) continue;
    const pkr = toPkrMinor(e.amount_minor, e.currency, e.fx_usd_pkr_micro);
    if (pkr === null) excluded.expenses++;
    else ev.expenses.push({ at: e.incurred_at ?? "", pkr });
  }

  // Installment plans: cash as received, income only from Daily Extra and fines, write-offs of cancelled plans.
  const plan = { extras: 0, fines: 0, writeOffs: 0, credit: 0 };
  const salesById = new Map(input.sales.filter((s) => !s.deleted && s.status !== "voided").map((s) => [s.id, s]));
  for (const f of planFigures(input.plans ?? [], input.payments ?? [], salesById, input.asOf)) {
    const sale = salesById.get(f.plan.sale_id);
    const saleRate = sale ? saleUsdPkr(sale, accounts.get(sale.account_id)) : null;
    // PKR per plan-currency unit: the payments' own recorded rates (weighted), else the sale's rate.
    let pkrSum = 0;
    let creditedSum = 0;
    let missing = false;
    for (const p of f.payments) {
      const pkr = paymentPkr(p);
      if (pkr === null) {
        missing = true;
        excluded.payments++;
        continue;
      }
      pkrSum += pkr;
      creditedSum += p.credited_minor;
      ev.planCash.push({ at: p.paid_on, pkr });
    }
    const toPkr = (v: number): number | null => {
      if (!v) return 0;
      if (f.plan.currency === "PKR") return v;
      if (creditedSum > 0 && !missing) return Math.round((v * pkrSum) / creditedSum);
      return toPkrMinor(v, f.plan.currency, saleRate);
    };
    for (const [k, v] of [["extras", f.extras], ["fines", f.fines], ["writeOffs", f.writeOff], ["credit", f.credit]] as const) {
      const pkr = toPkr(v);
      if (pkr === null) excluded.payments++;
      else plan[k] += pkr;
    }
  }

  // Money to receive / to pay: only interest or service charges count (income / cost); the principal never does.
  const debt = { chargesIn: 0, chargesOut: 0 };
  const debtById = new Map((input.debts ?? []).filter((d) => !d.deleted).map((d) => [d.id, d]));
  for (const p of input.payments ?? []) {
    if (p.deleted || p.status !== "recorded" || p.target !== "debt" || !p.debt_id) continue;
    const d = debtById.get(p.debt_id);
    if (!d) continue;
    const charge = parseDebtAllocations(p).filter((a) => a.part === "charge").reduce((a, x) => a + x.minor, 0);
    if (!charge) continue;
    const pkr = paymentPkr(p);
    if (pkr === null) {
      excluded.payments++;
      continue;
    }
    const share = Math.round((pkr * charge) / p.credited_minor);
    if (d.direction === "receive") debt.chargesIn += share;
    else debt.chargesOut += share;
  }
  return { ev, excluded, costOfSold, inventoryValue, plan, debt };
}

const total = (xs: PkrEvent[]) => xs.reduce((n, x) => n + x.pkr, 0);

export function computeConsolidated(input: ConsolidationInput): ConsolidatedReport {
  const { ev, excluded, costOfSold, inventoryValue, plan, debt } = toPkrEvents(input);
  const grossSales = total(ev.sales);
  const installmentSales = total(ev.sales.filter((x) => x.plan));
  const refunds = total(ev.refunds);
  const expenses = total(ev.expenses);
  const purchases = total(ev.purchases);
  const planCash = total(ev.planCash);
  const netSales = grossSales - refunds;
  const grossProfit = netSales - costOfSold;
  const outgoing = purchases + expenses + refunds;
  const incoming = grossSales - installmentSales + planCash;
  return {
    currency: "PKR", grossSales, refunds, netSales, costOfSold, grossProfit, expenses,
    netProfit: grossProfit - expenses + plan.extras + plan.fines - plan.writeOffs + debt.chargesIn - debt.chargesOut,
    incoming, purchases, outgoing, netCash: incoming - outgoing, inventoryValue,
    installmentSales, planCash, planExtras: plan.extras, planFines: plan.fines, planWriteOffs: plan.writeOffs,
    customerCredit: plan.credit, debtChargesIn: debt.chargesIn, debtChargesOut: debt.chargesOut,
    excluded,
  };
}

export interface FlowBucket {
  key: string;
  /** Sales received, PKR minor (transaction-time rates). */
  in: number;
  /** Purchases + expenses + refunds, PKR minor (transaction-time rates). */
  out: number;
}

/**
 * ONE monthly series for the dashboard charts, built from every transaction regardless of its currency.
 * `months` are "YYYY-MM" keys. Both the PKR and the USD chart are drawn from this same series.
 */
export function consolidatedMonthlyFlow(
  input: ConsolidationInput,
  months: string[],
): { buckets: FlowBucket[]; excluded: ConsolidatedReport["excluded"] } {
  const { ev, excluded } = toPkrEvents(input);
  const m = new Map(months.map((k) => [k, { key: k, in: 0, out: 0 }]));
  const add = (at: string, k: "in" | "out", v: number) => {
    const b = m.get(at.slice(0, 7));
    if (b) b[k] += v;
  };
  // Money in: Instant Pay sales on their sale date; installment sales as their payments arrive (never both).
  ev.sales.forEach((x) => !x.plan && add(x.at, "in", x.pkr));
  ev.planCash.forEach((x) => add(x.at, "in", x.pkr));
  for (const list of [ev.purchases, ev.expenses, ev.refunds]) list.forEach((x) => add(x.at, "out", x.pkr));
  return { buckets: months.map((k) => m.get(k)!), excluded };
}

export interface DisplayBucket extends FlowBucket {
  /** Unrounded value in the display currency (minor units), used for bar heights. */
  inExact: number;
  outExact: number;
}

/**
 * Express the PKR series in the chart's display currency with ONE rate for the whole period, so the
 * PKR and USD charts differ only by a constant factor (identical rises and falls). `in`/`out` are
 * rounded minor units for labels; the exact values are for drawing. Null when USD has no rate.
 */
export function displayFlow(buckets: FlowBucket[], currency: Currency, displayUsdPkrMicro: number | null): DisplayBucket[] | null {
  if (currency === "PKR") return buckets.map((b) => ({ ...b, inExact: b.in, outExact: b.out }));
  if (!isValidUsdPkrMicro(displayUsdPkrMicro)) return null;
  const f = 1e6 / displayUsdPkrMicro;
  return buckets.map((b) => ({
    key: b.key,
    in: convertUsdPkr(b.in, "PKR", "USD", displayUsdPkrMicro),
    out: convertUsdPkr(b.out, "PKR", "USD", displayUsdPkrMicro),
    inExact: b.in * f,
    outExact: b.out * f,
  }));
}
