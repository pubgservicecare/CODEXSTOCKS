import { convertMinor, CURRENCIES, type Currency } from "./money";
import { convertUsdPkr, isValidUsdPkrMicro, toPkrMinor, usdPkrFromSaleRate } from "./fx";
import type { Account, Expense, Refund, Sale } from "./entities";

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
  };
}

/** Cost of the sold account expressed in the sale currency. */
export function costInSaleCurrency(account: A, sale: S): number | null {
  if (account.purchase_currency === sale.currency) return account.purchase_cost_minor;
  if (!sale.exchange_rate_micro) return null;
  return convertMinor(account.purchase_cost_minor, sale.exchange_rate_micro);
}

export function computeReport(input: { accounts: A[]; sales: S[]; refunds: R[]; expenses: X[] }): FinancialReport {
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

  for (const c of CURRENCIES) {
    const r = by[c];
    r.netSales = r.grossSales - r.refunds;
    r.grossProfit = r.netSales - r.costOfSold;
    r.netProfit = r.grossProfit - r.expenses;
    r.incoming = r.grossSales;
    r.outgoing = r.purchases + r.expenses + r.refunds;
    r.netCash = r.incoming - r.outgoing;
  }
  return { counts, byCurrency: by };
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
  excluded: { sales: number; refunds: number; costs: number; purchases: number; expenses: number };
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
}

function toPkrEvents(input: { accounts: FA[]; sales: FS[]; refunds: FR[]; expenses: FX[] }) {
  const ev = { sales: [] as PkrEvent[], refunds: [] as PkrEvent[], purchases: [] as PkrEvent[], expenses: [] as PkrEvent[] };
  const excluded = { sales: 0, refunds: 0, costs: 0, purchases: 0, expenses: 0 };
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
    else ev.sales.push({ at: s.sold_at ?? "", pkr });
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
  return { ev, excluded, costOfSold, inventoryValue };
}

const total = (xs: PkrEvent[]) => xs.reduce((n, x) => n + x.pkr, 0);

export function computeConsolidated(input: { accounts: FA[]; sales: FS[]; refunds: FR[]; expenses: FX[] }): ConsolidatedReport {
  const { ev, excluded, costOfSold, inventoryValue } = toPkrEvents(input);
  const grossSales = total(ev.sales);
  const refunds = total(ev.refunds);
  const expenses = total(ev.expenses);
  const purchases = total(ev.purchases);
  const netSales = grossSales - refunds;
  const grossProfit = netSales - costOfSold;
  const outgoing = purchases + expenses + refunds;
  return {
    currency: "PKR", grossSales, refunds, netSales, costOfSold, grossProfit, expenses, netProfit: grossProfit - expenses,
    incoming: grossSales, purchases, outgoing, netCash: grossSales - outgoing, inventoryValue, excluded,
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
  input: { accounts: FA[]; sales: FS[]; refunds: FR[]; expenses: FX[] },
  months: string[],
): { buckets: FlowBucket[]; excluded: ConsolidatedReport["excluded"] } {
  const { ev, excluded } = toPkrEvents(input);
  const m = new Map(months.map((k) => [k, { key: k, in: 0, out: 0 }]));
  const add = (at: string, k: "in" | "out", v: number) => {
    const b = m.get(at.slice(0, 7));
    if (b) b[k] += v;
  };
  ev.sales.forEach((x) => add(x.at, "in", x.pkr));
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
