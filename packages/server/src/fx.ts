import { FX_PAIR, fxStatus, USDT_PAIR, usdPkrMicroFromNumber, usdtPkrMicroFromNumber, type FxQuote, type UsdtQuote } from "@codex/shared";
import type { Db } from "./db";

/**
 * USD/PKR reference rate, fetched SERVER-SIDE and cached in the database (table fx_rates), so visitors
 * and page renders never call the provider directly.
 *
 * Provider: ExchangeRate-API. Without FX_API_KEY the free "Open Access" endpoint is used
 * (https://open.er-api.com/v6/latest/USD — no key, rates published ONCE PER DAY, attribution required,
 * caching allowed; the docs ask for at most one request per hour). With FX_API_KEY the keyed endpoint
 * of the same provider is used (same response shape). It is a daily reference rate — never "live".
 *
 * Refresh policy: re-fetch only when the cached value is older than FX_REFRESH_MINUTES (default 360)
 * AND the provider's announced next update time has passed; after a failure, wait
 * FX_RETRY_MINUTES (default 30) before trying again. A failed fetch never replaces a good value.
 */
export interface FxConfig {
  apiKey?: string;
  refreshMinutes?: number;
  retryMinutes?: number;
  timeoutMs?: number;
  /** Turn the provider off (the last cached value is still served, marked stale when old). */
  disabled?: boolean;
}

const OPEN_URL = "https://open.er-api.com/v6/latest/USD";
const keyedUrl = (key: string) => `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/USD`;
export const FX_SOURCE_NAME = "ExchangeRate-API";
export const FX_SOURCE_URL = "https://www.exchangerate-api.com";

interface Row {
  rate_micro: number | null;
  source: string | null;
  source_url: string | null;
  frequency: string | null;
  effective_at: string | null;
  next_update_at: string | null;
  retrieved_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);

async function readRow(db: Db): Promise<Row | null> {
  const r = await db.query<Record<string, unknown>>("SELECT * FROM fx_rates WHERE pair = $1", [FX_PAIR]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    rate_micro: x.rate_micro === null ? null : Number(x.rate_micro),
    source: (x.source as string) ?? null,
    source_url: (x.source_url as string) ?? null,
    frequency: (x.frequency as string) ?? null,
    effective_at: iso(x.effective_at),
    next_update_at: iso(x.next_update_at),
    retrieved_at: iso(x.retrieved_at),
    last_attempt_at: iso(x.last_attempt_at),
    last_error: (x.last_error as string) ?? null,
  };
}

/**
 * Another request claimed the provider call while no rate is stored yet: wait (up to ~10 s) for that call to
 * finish instead of answering "no rate" — the admin would otherwise keep showing no rate until its next refresh.
 */
async function awaitInFlight<T>(read: () => Promise<T>, settled: (r: T) => boolean, tries = 40, ms = 250): Promise<T> {
  let r = await read();
  for (let i = 0; i < tries && !settled(r); i++) {
    await new Promise((res) => setTimeout(res, ms));
    r = await read();
  }
  return r;
}

function toQuote(row: Row, now: Date): FxQuote | null {
  if (!row.rate_micro || !row.retrieved_at) return null;
  const q: FxQuote = {
    pair: FX_PAIR,
    usd_pkr_micro: row.rate_micro,
    source: row.source ?? FX_SOURCE_NAME,
    source_url: row.source_url,
    effective_at: row.effective_at,
    retrieved_at: row.retrieved_at,
    next_update_at: row.next_update_at,
    frequency: row.frequency === "hourly" || row.frequency === "live" ? row.frequency : "daily",
    status: "fresh",
  };
  q.status = fxStatus(q, now);
  return q;
}

/** Fetch and validate one quote from the provider. Throws on any problem; never invents a value. */
export async function fetchProviderQuote(fetchImpl: typeof fetch, cfg: FxConfig, now: Date) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 6000);
  let body: Record<string, unknown>;
  try {
    const res = await fetchImpl(cfg.apiKey ? keyedUrl(cfg.apiKey) : OPEN_URL, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Rate provider answered HTTP ${res.status}`);
    body = (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
  if (body.result !== "success") throw new Error(`Rate provider error: ${String(body["error-type"] ?? "unknown")}`);
  if (body.base_code !== "USD") throw new Error("Rate provider returned an unexpected base currency");
  const rates = (body.rates ?? body.conversion_rates) as Record<string, unknown> | undefined;
  const micro = usdPkrMicroFromNumber(rates?.PKR);
  const unix = (k: string) => (typeof body[k] === "number" && (body[k] as number) > 0 ? new Date((body[k] as number) * 1000).toISOString() : null);
  const effective = unix("time_last_update_unix");
  if (effective && Date.parse(effective) > now.getTime() + 3_600_000) throw new Error("Rate provider timestamp is in the future");
  return { rate_micro: micro, effective_at: effective, next_update_at: unix("time_next_update_unix") };
}

/**
 * The latest USD/PKR quote: the cached value, refreshed from the provider when due. Returns null when no
 * valid rate has ever been obtained (callers then show prices in their original currency only).
 */
export async function getUsdPkrQuote(db: Db, opts: { fetchImpl?: typeof fetch; now?: Date; fx?: FxConfig; log?: (m: string) => void } = {}): Promise<FxQuote | null> {
  const now = opts.now ?? new Date();
  const cfg = opts.fx ?? {};
  let row = await readRow(db);
  const age = (t: string | null) => (t ? now.getTime() - Date.parse(t) : Infinity);
  const due =
    !cfg.disabled &&
    age(row?.retrieved_at ?? null) > (cfg.refreshMinutes ?? 360) * 60_000 &&
    (!row?.next_update_at || Date.parse(row.next_update_at) <= now.getTime() || !row.rate_micro) &&
    age(row?.last_attempt_at ?? null) > (cfg.retryMinutes ?? 30) * 60_000;
  if (due) {
    // Claim the attempt first so concurrent requests do not all call the provider.
    const claim = await db.query(
      `INSERT INTO fx_rates (pair, last_attempt_at) VALUES ($1, $2)
       ON CONFLICT (pair) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at
       WHERE fx_rates.last_attempt_at IS NULL OR fx_rates.last_attempt_at < $3`,
      [FX_PAIR, now.toISOString(), new Date(now.getTime() - (cfg.retryMinutes ?? 30) * 60_000).toISOString()],
    );
    if (claim.rowCount) {
      try {
        const q = await fetchProviderQuote(opts.fetchImpl ?? fetch, cfg, now);
        await db.query(
          `UPDATE fx_rates SET rate_micro = $2, source = $3, source_url = $4, frequency = 'daily', effective_at = $5,
             next_update_at = $6, retrieved_at = $7, last_error = NULL WHERE pair = $1`,
          [FX_PAIR, q.rate_micro, FX_SOURCE_NAME, FX_SOURCE_URL, q.effective_at, q.next_update_at, now.toISOString()],
        );
      } catch (e) {
        const msg = (e as Error)?.name === "AbortError" ? "Rate provider timed out" : (e as Error)?.message ?? "Rate provider failed";
        opts.log?.(`fx: ${msg}`);
        await db.query("UPDATE fx_rates SET last_error = $2 WHERE pair = $1", [FX_PAIR, msg.slice(0, 300)]);
      }
      row = await readRow(db);
    } else if (!row?.rate_micro) {
      row = await awaitInFlight(() => readRow(db), (r) => !!r?.rate_micro || !!r?.last_error);
    }
  }
  return row ? toQuote(row, now) : null;
}

export function fxConfigFromEnv(env: Record<string, string | undefined>): FxConfig {
  const n = (v: string | undefined, d: number, min: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= min ? x : d;
  };
  return {
    apiKey: env.FX_API_KEY || undefined,
    refreshMinutes: n(env.FX_REFRESH_MINUTES, 360, 60),
    retryMinutes: n(env.FX_RETRY_MINUTES, 30, 5),
    disabled: env.FX_DISABLED === "1",
  };
}

/* ------------------------------------------------------------------ */
/* USDT/PKR reference rate                                             */
/* ------------------------------------------------------------------ */

/**
 * USDT (Tether) price in PKR from CoinGecko's simple-price endpoint, cached in fx_rates (pair USDT/PKR) and
 * refreshed at most every USDT_FX_REFRESH_MINUTES (default 60; CoinGecko asks for cached data to be refreshed
 * at least every 24 hours). Its terms require the credit "Powered by CoinGecko" wherever the rate is shown.
 * Without COINGECKO_API_KEY the keyless public endpoint is used; with a key, the Demo or Pro endpoint.
 * Like the USD/PKR rate, a failed fetch never replaces a good value and no value is ever invented.
 */
export interface UsdtFxConfig {
  apiKey?: string;
  plan?: "demo" | "pro";
  refreshMinutes?: number;
  retryMinutes?: number;
  timeoutMs?: number;
  disabled?: boolean;
}

export const USDT_SOURCE_NAME = "CoinGecko";
export const USDT_SOURCE_URL = "https://www.coingecko.com";

function usdtUrl(cfg: UsdtFxConfig): { url: string; headers: Record<string, string> } {
  const q = "/api/v3/simple/price?ids=tether&vs_currencies=pkr&include_last_updated_at=true";
  if (cfg.apiKey && cfg.plan === "pro") return { url: `https://pro-api.coingecko.com${q}`, headers: { "x-cg-pro-api-key": cfg.apiKey } };
  if (cfg.apiKey) return { url: `https://api.coingecko.com${q}`, headers: { "x-cg-demo-api-key": cfg.apiKey } };
  return { url: `https://api.coingecko.com${q}`, headers: {} };
}

export async function fetchUsdtQuote(fetchImpl: typeof fetch, cfg: UsdtFxConfig, now: Date) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 6000);
  let body: Record<string, unknown>;
  try {
    const { url, headers } = usdtUrl(cfg);
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...headers } });
    if (!res.ok) throw new Error(`USDT rate provider answered HTTP ${res.status}`);
    body = (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
  const t = body.tether as Record<string, unknown> | undefined;
  const micro = usdtPkrMicroFromNumber(t?.pkr);
  const ts = typeof t?.last_updated_at === "number" && t.last_updated_at > 0 ? new Date(t.last_updated_at * 1000).toISOString() : null;
  if (ts && Date.parse(ts) > now.getTime() + 3_600_000) throw new Error("USDT rate provider timestamp is in the future");
  return { rate_micro: micro, effective_at: ts };
}

export async function getUsdtPkrQuote(
  db: Db,
  opts: { fetchImpl?: typeof fetch; now?: Date; usdt?: UsdtFxConfig; log?: (m: string) => void } = {},
): Promise<UsdtQuote | null> {
  const now = opts.now ?? new Date();
  const cfg = opts.usdt ?? {};
  const read = async () => (await db.query<Record<string, unknown>>("SELECT * FROM fx_rates WHERE pair = $1", [USDT_PAIR])).rows[0] ?? null;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);
  let row = await read();
  const age = (t: unknown) => (iso(t) ? now.getTime() - Date.parse(iso(t)!) : Infinity);
  const due = !cfg.disabled && age(row?.retrieved_at) > (cfg.refreshMinutes ?? 60) * 60_000 && age(row?.last_attempt_at) > (cfg.retryMinutes ?? 30) * 60_000;
  if (due) {
    const claim = await db.query(
      `INSERT INTO fx_rates (pair, last_attempt_at) VALUES ($1, $2)
       ON CONFLICT (pair) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at
       WHERE fx_rates.last_attempt_at IS NULL OR fx_rates.last_attempt_at < $3`,
      [USDT_PAIR, now.toISOString(), new Date(now.getTime() - (cfg.retryMinutes ?? 30) * 60_000).toISOString()],
    );
    if (claim.rowCount) {
      try {
        const q = await fetchUsdtQuote(opts.fetchImpl ?? fetch, cfg, now);
        await db.query(
          `UPDATE fx_rates SET rate_micro = $2, source = $3, source_url = $4, frequency = 'live', effective_at = $5,
             next_update_at = NULL, retrieved_at = $6, last_error = NULL WHERE pair = $1`,
          [USDT_PAIR, q.rate_micro, USDT_SOURCE_NAME, USDT_SOURCE_URL, q.effective_at ?? now.toISOString(), now.toISOString()],
        );
      } catch (e) {
        const msg = (e as Error)?.name === "AbortError" ? "USDT rate provider timed out" : ((e as Error)?.message ?? "USDT rate provider failed");
        opts.log?.(`fx: ${msg}`);
        await db.query("UPDATE fx_rates SET last_error = $2 WHERE pair = $1", [USDT_PAIR, msg.slice(0, 300)]);
      }
      row = await read();
    } else if (row?.rate_micro === null || row?.rate_micro === undefined) {
      row = await awaitInFlight(read, (r) => (r?.rate_micro !== null && r?.rate_micro !== undefined) || !!r?.last_error);
    }
  }
  if (!row || row.rate_micro === null || row.rate_micro === undefined || !iso(row.retrieved_at)) return null;
  const q: UsdtQuote = {
    pair: USDT_PAIR,
    usdt_pkr_micro: Number(row.rate_micro),
    source: (row.source as string) ?? USDT_SOURCE_NAME,
    source_url: (row.source_url as string) ?? USDT_SOURCE_URL,
    effective_at: iso(row.effective_at),
    retrieved_at: iso(row.retrieved_at)!,
    frequency: "live",
    status: "fresh",
    manual: false,
  };
  q.status = fxStatus(q, now);
  return q;
}

export function usdtConfigFromEnv(env: Record<string, string | undefined>): UsdtFxConfig {
  const n = (v: string | undefined, d: number, min: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= min ? x : d;
  };
  return {
    apiKey: env.COINGECKO_API_KEY || undefined,
    plan: env.COINGECKO_PLAN === "pro" ? "pro" : "demo",
    refreshMinutes: Math.min(n(env.USDT_FX_REFRESH_MINUTES, 60, 10), 1440),
    retryMinutes: n(env.USDT_FX_RETRY_MINUTES, 30, 5),
    disabled: env.USDT_FX_DISABLED === "1",
  };
}
