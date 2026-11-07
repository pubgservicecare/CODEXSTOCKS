import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  amountsInPkr,
  convertMinor,
  crossRateMicro,
  formatDay,
  formatRate,
  localDate,
  parseMoney,
  parseRate,
  PAY_CURRENCIES,
  PAY_METHOD_LABELS,
  PAY_METHODS,
  pkrPerUnit,
  receiptMoney,
  type Amounts,
  type PayCurrency,
  type PayMethod,
  type PaymentInput,
} from "@codex/shared";
import { Field, useApp, useLoad } from "./components";
import { useFx } from "./fx-ui";

/** "PKR 16,666.67" / "USD 120" / "180.50 USDT" — the money format of the payments screens and receipts. */
export const fmt = (minor: number | null | undefined, c: PayCurrency) => (minor === null || minor === undefined ? "—" : receiptMoney(minor, c));
export const day = (d: string | null | undefined) => formatDay(d);

/** Everything the payments screens read. Receipts are loaded separately (they can be large). */
export function useFinanceData() {
  const { svc } = useApp();
  return useLoad(async () => {
    const [plans, payments, debts, accounts] = await Promise.all([svc.list("installment_plans"), svc.list("payments"), svc.list("debts"), svc.listAccounts()]);
    return { plans, payments, debts, accounts };
  }, []);
}

/** PKR-per-unit rates available right now (display only). */
export function useRates() {
  const { quote, usdt } = useFx();
  return useMemo(
    () => ({ PKR: 1_000_000, USD: pkrPerUnit("USD", quote, usdt), USDT: pkrPerUnit("USDT", quote, usdt) }) as Record<PayCurrency, number | null>,
    [quote, usdt],
  );
}

/** "PKR 120,000 · USD 300" (+ "≈ PKR 204,000" when more than one currency and the rates are known). */
export function AmountList({ amounts, empty = "—", total = true }: { amounts: Amounts; empty?: string; total?: boolean }) {
  const rates = useRates();
  const parts = (Object.entries(amounts) as [PayCurrency, number][]).filter(([, v]) => v);
  if (!parts.length) return <span className="faint">{empty}</span>;
  const pkr = amountsInPkr(amounts, rates);
  return (
    <span className="amount-list">
      {parts.map(([c, v], i) => (
        <span key={c}>
          {i > 0 && <span className="faint"> · </span>}
          {fmt(v, c)}
        </span>
      ))}
      {total && parts.length > 1 && !pkr.missing.length ? <span className="faint small"> ≈ {fmt(pkr.pkr, "PKR")}</span> : null}
    </span>
  );
}

const PLAN_TONE: Record<string, string> = { Active: "info", Paid: "ok", Overdue: "bad", Cancelled: "", Restructured: "warn" };
export function PlanStatusBadge({ label }: { label: string }) {
  return <span className={`badge ${PLAN_TONE[label] ?? ""}`}><span className={`dot ${PLAN_TONE[label] === "info" ? "" : PLAN_TONE[label] ?? ""}`} style={PLAN_TONE[label] === "info" ? { background: "var(--info)" } : undefined} />{label}</span>;
}

const ENTRY: Record<string, [string, string]> = {
  paid: ["Paid", "ok"],
  overdue: ["Overdue", "bad"],
  due: ["Due", "warn"],
  partial: ["Part paid", "warn"],
  upcoming: ["Upcoming", ""],
  cancelled: ["Cancelled", ""],
};
export function EntryBadge({ status }: { status: string }) {
  const [label, tone] = ENTRY[status] ?? [status, ""];
  return <span className={`badge ${tone}`}>{label}</span>;
}

const DEBT: Record<string, [string, string]> = {
  open: ["Open", "info"],
  partial: ["Part paid", "warn"],
  settled: ["Settled", "ok"],
  overdue: ["Overdue", "bad"],
  cancelled: ["Cancelled", ""],
};
export function DebtBadge({ status }: { status: string }) {
  const [label, tone] = DEBT[status] ?? [status, ""];
  return <span className={`badge ${tone === "info" ? "" : tone}`}>{label}</span>;
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "bad" | "warn"; icon?: ReactNode }) {
  return (
    <div className={`stat fin-stat ${tone ? `tone-${tone}` : ""}`}>
      <div className="label">{icon}{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money received / paid form                                          */
/* ------------------------------------------------------------------ */

export interface MoneyDraft {
  amount: string;
  currency: PayCurrency;
  rate: string;
  paid_on: string;
  method: PayMethod;
  reference: string;
  notes: string;
}

export function emptyMoney(currency: PayCurrency): MoneyDraft {
  return { amount: "", currency, rate: "", paid_on: localDate(), method: currency === "USDT" ? "usdt" : "cash", reference: "", notes: "" };
}

/**
 * Builds the payment fields. When the payment currency differs from the plan/record currency, the rate the
 * owner confirmed is REQUIRED and stored with its source (reference or manual) — never an automatic 1:1.
 */
export function moneyInput(d: MoneyDraft, target: PayCurrency, ctx: { rates: Record<PayCurrency, number | null>; sources: Record<PayCurrency, string | null> }, id: string): PaymentInput {
  if (!d.amount.trim()) throw new Error("Enter the amount");
  const amount_minor = parseMoney(d.amount, d.currency);
  if (amount_minor <= 0) throw new Error("The amount must be greater than zero");
  let rate_micro: number | null = null;
  let rate_source: string | null = null;
  if (d.currency !== target) {
    if (!d.rate.trim()) throw new Error(`Enter the rate: ${target} per 1 ${d.currency}`);
    rate_micro = parseRate(d.rate);
    const suggested = suggestRate(d.currency, target, ctx.rates);
    rate_source = suggested && suggested === rate_micro ? (ctx.sources[d.currency === "PKR" ? target : d.currency] ?? "reference") : "manual";
  }
  const pkr = d.currency === "PKR" ? null : ctx.rates[d.currency];
  const at = new Date().toISOString();
  return {
    id,
    paid_on: d.paid_on,
    amount_minor,
    currency: d.currency,
    rate_micro,
    rate_source,
    rate_at: rate_micro ? at : null,
    pkr_micro: pkr ?? null,
    pkr_source: pkr ? (ctx.sources[d.currency] ?? "reference") : null,
    pkr_at: pkr ? at : null,
    method: d.method,
    reference: d.reference.trim() || null,
    notes: d.notes.trim() || null,
  };
}

/** Target units per 1 payment unit (x1e6) from today's reference rates, or null. */
export function suggestRate(from: PayCurrency, to: PayCurrency, rates: Record<PayCurrency, number | null>): number | null {
  const a = rates[from];
  const b = rates[to];
  if (!a || !b || from === to) return null;
  return crossRateMicro(a, b);
}

export function useRateSources(): Record<PayCurrency, string | null> {
  const { quote, usdt } = useFx();
  return { PKR: null, USD: quote ? quote.source : null, USDT: usdt ? (usdt.manual ? "manual (your USDT rate)" : usdt.source) : null };
}

export function MoneyFields({ d, set, target, label = "Amount received" }: { d: MoneyDraft; set: (p: Partial<MoneyDraft>) => void; target: PayCurrency; label?: string }) {
  const rates = useRates();
  const suggested = suggestRate(d.currency, target, rates);
  useEffect(() => {
    if (d.currency !== target && !d.rate && suggested) set({ rate: formatRate(suggested) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.currency, target, suggested]);
  let credited: number | null = null;
  try {
    const amt = d.amount.trim() ? parseMoney(d.amount, d.currency) : null;
    if (amt !== null) credited = d.currency === target ? amt : d.rate.trim() ? convertMinor(amt, parseRate(d.rate)) : null;
  } catch {
    credited = null;
  }
  return (
    <>
      <Field label={`${label} *`}>
        <input value={d.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" placeholder="0" autoFocus />
      </Field>
      <Field label="Currency *" hint={d.currency === "USDT" ? "USDT (Tether) — its own currency, never treated as USD" : undefined}>
        <select value={d.currency} onChange={(e) => set({ currency: e.target.value as PayCurrency, rate: "" })}>
          {PAY_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      {d.currency !== target && (
        <div className="full">
          <Field
            label={`Rate * · ${target} per 1 ${d.currency}`}
            hint={suggested ? `Reference today: ${formatRate(suggested)}. Change it to the rate you actually used — it is saved with this payment.` : "No reference rate available. Enter the rate you actually used."}
          >
            <input value={d.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" placeholder="e.g. 281.50" />
          </Field>
          {credited !== null && <div className="fx-preview small">Credited: <b>{fmt(credited, target)}</b></div>}
        </div>
      )}
      <Field label="Payment date *">
        <input type="date" value={d.paid_on} max={localDate()} onChange={(e) => set({ paid_on: e.target.value })} />
      </Field>
      <Field label="Method *">
        <select value={d.method} onChange={(e) => set({ method: e.target.value as PayMethod })}>
          {PAY_METHODS.map((x) => <option key={x} value={x}>{PAY_METHOD_LABELS[x]}</option>)}
        </select>
      </Field>
      <Field label="Transaction reference" optional>
        <input value={d.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={200} placeholder="e.g. TID / TxHash" />
      </Field>
      <Field label="Notes" optional>
        <input value={d.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} />
      </Field>
    </>
  );
}

/** Tiny state helper for forms. */
export function useDraft<T extends object>(init: T | (() => T)) {
  const [d, setD] = useState<T>(init);
  return [d, (p: Partial<T>) => setD((x) => ({ ...x, ...p })), setD] as const;
}
