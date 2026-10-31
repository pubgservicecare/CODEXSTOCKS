import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  convertUsdPkr,
  formatMoney,
  formatUsdPkr,
  otherCurrency,
  parseMoney,
  type Currency,
  type FxQuote,
} from "@codex/shared";
import type { DataService } from "./service";

interface FxState {
  quote: FxQuote | null;
  loaded: boolean;
  reload: () => void;
}
const FxCtx = createContext<FxState>({ quote: null, loaded: true, reload: () => undefined });

/** Loads the USD/PKR quote once per session and every 30 minutes (display conversions only). */
export function FxProvider({ svc, children, initial }: { svc: DataService; children: ReactNode; initial?: FxQuote | null }) {
  const [quote, setQuote] = useState<FxQuote | null>(initial ?? null);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    svc
      .fx()
      .then((q) => live && setQuote(q))
      .catch(() => undefined)
      .finally(() => live && setLoaded(true));
    const t = setInterval(() => setTick((x) => x + 1), 30 * 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [svc, tick]);
  return <FxCtx.Provider value={{ quote, loaded, reload: () => setTick((x) => x + 1) }}>{children}</FxCtx.Provider>;
}

export const useFx = () => useContext(FxCtx);

export function fmtFxTime(q: FxQuote): string {
  const t = q.effective_at ?? q.retrieved_at;
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "1 USD = 276.60 PKR · ExchangeRate-API daily reference · 30 Oct 2026, 05:02" (+ stale marker). */
export function FxRateLine({ quote, className = "" }: { quote: FxQuote; className?: string }) {
  return (
    <span className={`fx-line ${className}`}>
      {formatUsdPkr(quote.usd_pkr_micro)} · {quote.source} {quote.frequency} reference · {fmtFxTime(quote)}
      {quote.status === "stale" && <b className="fx-stale"> · stale</b>}
    </span>
  );
}

/** "≈ $361.53" — the other currency at the current reference rate; nothing when no rate is available. */
export function FxEquivalent({ minor, currency, className = "" }: { minor: number | null | undefined; currency: Currency | null | undefined; className?: string }) {
  const { quote } = useFx();
  if (minor === null || minor === undefined || !currency || !quote) return null;
  const to = otherCurrency(currency);
  const v = convertUsdPkr(minor, currency, to, quote.usd_pkr_micro);
  return (
    <span className={`fx-eq ${className}`} title={`Approximate, at ${formatUsdPkr(quote.usd_pkr_micro)} (${quote.source}, ${fmtFxTime(quote)})`}>
      ≈ {formatMoney(v, to)}
    </span>
  );
}

/**
 * Live preview next to an amount field: the entered amount, its equivalent, and the rate used.
 * The entered amount and currency stay the authoritative value; the equivalent is display only.
 */
export function FxPreview({ amount, currency, label = "Equivalent" }: { amount: string; currency: Currency; label?: string }) {
  const { quote, loaded } = useFx();
  let minor: number | null = null;
  try {
    minor = amount.trim() ? parseMoney(amount, currency) : null;
  } catch {
    minor = null;
  }
  if (minor === null) return null;
  const to = otherCurrency(currency);
  if (!quote)
    return (
      <div className="fx-preview muted" data-testid="fx-preview">
        {loaded ? `No USD/PKR rate available yet — shown in ${currency} only.` : "Loading exchange rate…"}
      </div>
    );
  return (
    <div className="fx-preview" data-testid="fx-preview">
      <div>
        <span className="faint">{label}:</span> <b>{formatMoney(minor, currency)} {currency}</b> ≈{" "}
        <b>{formatMoney(convertUsdPkr(minor, currency, to, quote.usd_pkr_micro), to)} {to}</b>
      </div>
      <FxRateLine quote={quote} className="small faint" />
    </div>
  );
}
