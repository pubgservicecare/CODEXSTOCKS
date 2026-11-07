import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  convertUsdPkr,
  formatMoney,
  formatUsdPkr,
  otherCurrency,
  parseManualUsdtRate,
  parseMoney,
  resolveUsdtQuote,
  type Currency,
  type FxQuote,
  type UsdtQuote,
} from "@codex/shared";
import type { DataService } from "./service";

interface FxState {
  quote: FxQuote | null;
  /** USDT/PKR to use: the owner's own rate when chosen in Settings, otherwise the reference rate. */
  usdt: UsdtQuote | null;
  /** The reference (provider) USDT quote, whatever the owner chose. */
  usdtProvider: UsdtQuote | null;
  usdtMode: "provider" | "manual";
  loaded: boolean;
  reload: () => void;
}
const FxCtx = createContext<FxState>({ quote: null, usdt: null, usdtProvider: null, usdtMode: "provider", loaded: true, reload: () => undefined });

/**
 * Loads the USD/PKR and USDT/PKR quotes once per session and every 30 minutes (display conversions only),
 * and re-reads the owner's USDT rate setting whenever data changes.
 */
export function FxProvider({ svc, children, initial }: { svc: DataService; children: ReactNode; initial?: FxQuote | null }) {
  const [quote, setQuote] = useState<FxQuote | null>(initial ?? null);
  const [usdtProvider, setUsdtProvider] = useState<UsdtQuote | null>(null);
  const [manual, setManual] = useState<{ mode: string | null; value: string | null }>({ mode: null, value: null });
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    svc
      .fx()
      .then((q) => live && setQuote(q))
      .catch(() => undefined)
      .finally(() => live && setLoaded(true));
    svc
      .fxUsdt?.()
      .then((q) => live && setUsdtProvider(q))
      .catch(() => undefined);
    const t = setInterval(() => setTick((x) => x + 1), 30 * 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [svc, tick]);
  useEffect(() => {
    let live = true;
    const read = () =>
      svc
        .list("settings")
        .then((rows) => {
          if (!live) return;
          const get = (k: string) => rows.find((r) => r.key === k && !r.deleted)?.value ?? null;
          setManual({ mode: get("usdt_rate_mode"), value: get("usdt_pkr_manual") });
        })
        .catch(() => undefined);
    void read();
    const off = svc.subscribe(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [svc]);
  const usdt = resolveUsdtQuote({ provider: usdtProvider, manual: parseManualUsdtRate(manual.value), mode: manual.mode, now: new Date() });
  const usdtMode = manual.mode === "manual" ? "manual" : "provider";
  return <FxCtx.Provider value={{ quote, usdt, usdtProvider, usdtMode, loaded, reload: () => setTick((x) => x + 1) }}>{children}</FxCtx.Provider>;
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
