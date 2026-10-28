import { convertMinor, CURRENCIES, type Currency } from "./money";
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
