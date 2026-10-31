import { convertMinor, formatRate, MoneyError, parseRate, RATE_SCALE, type Currency } from "./money";

/**
 * USD/PKR exchange rates.
 *
 * One rate is used everywhere: PKR per 1 USD, stored as an integer scaled by 1e6 ("usd_pkr_micro").
 * Two separate uses must never be confused:
 *  - DISPLAY conversion (listing prices, chart display): the latest cached reference rate. It can change
 *    at any time and never modifies stored data.
 *  - ACCOUNTING snapshots: the rate captured on a purchase, sale or expense when it was recorded. It is
 *    stored on that record and never rewritten when newer rates arrive.
 */
export const FX_PAIR = "USD/PKR";
/** Sanity bounds for a USD/PKR rate (PKR per USD). Anything outside is rejected as invalid data. */
export const FX_MIN_MICRO = 10_000_000; // 10 PKR per USD
export const FX_MAX_MICRO = 10_000_000_000; // 10,000 PKR per USD
/** A daily reference rate older than this is shown as stale (hours). */
export const FX_STALE_HOURS = 36;
/** Offline sales: a cached rate older than this needs an explicit decision or a manual rate (hours). */
export const FX_MAX_AUTO_AGE_HOURS = 72;

export const FX_SOURCE_MANUAL = "manual";

export interface FxQuote {
  pair: typeof FX_PAIR;
  /** PKR per 1 USD, x1e6. */
  usd_pkr_micro: number;
  /** Provider name, e.g. "ExchangeRate-API (open access)". */
  source: string;
  source_url: string | null;
  /** When the provider says the rate was published (daily feeds: once per day). */
  effective_at: string | null;
  /** When this server last fetched it successfully. */
  retrieved_at: string;
  next_update_at: string | null;
  /** How often the provider publishes new values. */
  frequency: "daily" | "hourly" | "live";
  /** Set by the consumer from the rate's age (see fxStatus). */
  status: "fresh" | "stale";
}

export class FxError extends MoneyError {}

/** True for a finite integer rate inside the sanity bounds. */
export function isValidUsdPkrMicro(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= FX_MIN_MICRO && v <= FX_MAX_MICRO;
}

export function assertUsdPkrMicro(v: unknown): number {
  if (!isValidUsdPkrMicro(v)) throw new FxError("Invalid USD/PKR exchange rate");
  return v;
}

/** Provider value (e.g. 276.603556 PKR per USD) -> micro. Rejects NaN, infinity, zero, negative, out-of-range. */
export function usdPkrMicroFromNumber(rate: unknown): number {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new FxError("Invalid USD/PKR exchange rate");
  return assertUsdPkrMicro(Math.round(rate * 1e6));
}

/** Owner-typed "PKR per 1 USD", e.g. "278.50". */
export function parseUsdPkr(input: string): number {
  const micro = parseRate(input);
  if (!isValidUsdPkrMicro(micro)) throw new FxError(`Enter a realistic rate in PKR per 1 USD (between ${FX_MIN_MICRO / 1e6} and ${FX_MAX_MICRO / 1e6})`);
  return micro;
}

export const formatUsdPkr = (micro: number) => `1 USD = ${formatRate(micro)} PKR`;

/** Convert an amount between USD and PKR with a PKR-per-USD rate. Half away from zero, minor units. */
export function convertUsdPkr(amountMinor: number, from: Currency, to: Currency, usdPkrMicro: number): number {
  assertUsdPkrMicro(usdPkrMicro);
  if (from === to) return amountMinor;
  if (from === "USD") return convertMinor(amountMinor, usdPkrMicro);
  // PKR -> USD: amount / rate, done in integers.
  const a = BigInt(amountMinor) * RATE_SCALE;
  const r = BigInt(usdPkrMicro);
  const q = a / r;
  const rem = a % r;
  const twice = (rem < 0n ? -rem : rem) * 2n;
  return Number(twice >= r ? q + (a < 0n ? -1n : 1n) : q);
}

/** Amount in PKR (the canonical reporting currency), or null when a USD amount has no rate. */
export function toPkrMinor(amountMinor: number, currency: Currency, usdPkrMicro: number | null | undefined): number | null {
  if (currency === "PKR") return amountMinor;
  if (!isValidUsdPkrMicro(usdPkrMicro)) return null;
  return convertUsdPkr(amountMinor, "USD", "PKR", usdPkrMicro);
}

/**
 * The sale's existing `exchange_rate_micro` ("sale currency per 1 purchase currency") derived from a
 * USD/PKR rate, or null when both currencies are the same.
 */
export function saleRateFromUsdPkr(purchase: Currency, sale: Currency, usdPkrMicro: number): number | null {
  if (purchase === sale) return null;
  assertUsdPkrMicro(usdPkrMicro);
  if (purchase === "USD") return usdPkrMicro; // PKR per USD
  // USD per PKR, x1e6, rounded half up
  const num = RATE_SCALE * RATE_SCALE;
  const r = BigInt(usdPkrMicro);
  const q = num / r;
  return Number((num % r) * 2n >= r ? q + 1n : q);
}

/** Inverse of saleRateFromUsdPkr, for records saved before snapshots existed. */
export function usdPkrFromSaleRate(purchase: Currency, sale: Currency, rateMicro: number | null | undefined): number | null {
  if (purchase === sale || !rateMicro || rateMicro <= 0) return null;
  if (purchase === "USD") return isValidUsdPkrMicro(rateMicro) ? rateMicro : null;
  const num = RATE_SCALE * RATE_SCALE;
  const r = BigInt(rateMicro);
  const v = Number((num + r / 2n) / r);
  return isValidUsdPkrMicro(v) ? v : null;
}

export function fxAgeHours(q: Pick<FxQuote, "effective_at" | "retrieved_at">, now: Date): number {
  const t = Date.parse(q.effective_at ?? q.retrieved_at);
  return Number.isNaN(t) ? Infinity : (now.getTime() - t) / 3_600_000;
}

/** "fresh" while within FX_STALE_HOURS of its publication time, otherwise "stale". */
export function fxStatus(q: Pick<FxQuote, "effective_at" | "retrieved_at">, now: Date, staleHours = FX_STALE_HOURS): "fresh" | "stale" {
  return fxAgeHours(q, now) <= staleHours ? "fresh" : "stale";
}

/** Snapshot fields stored on a record (purchase, sale or expense). */
export interface FxSnapshot {
  usd_pkr_micro: number;
  source: string;
  at: string;
}

export function snapshotFromQuote(q: FxQuote): FxSnapshot {
  return { usd_pkr_micro: q.usd_pkr_micro, source: q.source, at: q.effective_at ?? q.retrieved_at };
}

/** Customer display currency: explicit choice > country (Pakistan = PKR, elsewhere USD) > configured default. */
export function chooseDisplayCurrency(opts: { preference?: string | null; country?: string | null; fallback?: Currency }): Currency {
  const p = opts.preference?.toUpperCase();
  if (p === "PKR" || p === "USD") return p;
  const c = opts.country?.trim().toUpperCase();
  if (c && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1") return c === "PK" ? "PKR" : "USD";
  return opts.fallback ?? "PKR";
}

export const otherCurrency = (c: Currency): Currency => (c === "USD" ? "PKR" : "USD");
