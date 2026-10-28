/**
 * Money is always stored as an integer number of MINOR units (cents / paisa)
 * together with its currency. USD and PKR both use 2 decimal places.
 * Amounts in different currencies are never added together.
 */
export const CURRENCIES = ["USD", "PKR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MINOR_DIGITS: Record<Currency, number> = { USD: 2, PKR: 2 };
export const MAX_MINOR = 10_000_000_000_000; // 100 billion major units — far above any realistic value

/** Exchange rates are stored as integers scaled by 1e6 ("micro" units). */
export const RATE_SCALE = 1_000_000n;

export class MoneyError extends Error {}

/**
 * Parse a user-typed amount ("1,250.5", "0", "12.30") into minor units.
 * Rejects negatives, more decimals than the currency supports, and garbage.
 */
export function parseMoney(input: string, currency: Currency): number {
  const digits = MINOR_DIGITS[currency];
  const s = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new MoneyError("Enter a valid non-negative amount, e.g. 1250 or 1250.50");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > digits) throw new MoneyError(`${currency} amounts allow at most ${digits} decimal places`);
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt((frac + "0".repeat(digits)).slice(0, digits) || "0");
  if (minor > BigInt(MAX_MINOR)) throw new MoneyError("Amount is too large");
  return Number(minor);
}

/** Format minor units for display, e.g. 125050 USD -> "$1,250.50". */
export function formatMoney(minor: number, currency: Currency): string {
  const digits = MINOR_DIGITS[currency];
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const base = 10n ** BigInt(digits);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % base).toString().padStart(digits, "0");
  const sym = currency === "USD" ? "$" : "Rs ";
  return `${neg ? "-" : ""}${sym}${whole}.${frac}`;
}

/** Plain decimal string for form inputs, e.g. 125050 -> "1250.50". */
export function minorToDecimalString(minor: number, currency: Currency): string {
  const digits = MINOR_DIGITS[currency];
  const base = 10n ** BigInt(digits);
  const abs = BigInt(Math.abs(minor));
  return `${minor < 0 ? "-" : ""}${abs / base}.${(abs % base).toString().padStart(digits, "0")}`;
}

/** Parse a decimal exchange rate ("280.25") into micro units (280250000). Max 6 decimals. */
export function parseRate(input: string): number {
  const s = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new MoneyError("Enter a positive exchange rate with up to 6 decimals");
  const [whole, frac = ""] = s.split(".");
  const micro = BigInt(whole) * RATE_SCALE + BigInt((frac + "000000").slice(0, 6));
  if (micro <= 0n) throw new MoneyError("Exchange rate must be greater than zero");
  return Number(micro);
}

export function formatRate(micro: number): string {
  const m = BigInt(micro);
  const frac = (m % RATE_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${m / RATE_SCALE}${frac ? "." + frac : ""}`;
}

/**
 * Convert an amount using a rate expressed as "units of target currency per 1 unit of source".
 * Rounds half away from zero to the nearest minor unit. Both currencies use 2 decimals,
 * so minor units scale directly.
 */
export function convertMinor(amountMinor: number, rateMicro: number): number {
  const a = BigInt(amountMinor);
  const r = BigInt(rateMicro);
  const num = a * r;
  const q = num / RATE_SCALE;
  const rem = num % RATE_SCALE;
  const twice = (rem < 0n ? -rem : rem) * 2n;
  const rounded = twice >= RATE_SCALE ? q + (num < 0n ? -1n : 1n) : q;
  return Number(rounded);
}
