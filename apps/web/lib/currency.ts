import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { fxConfigFromEnv, getUsdPkrQuote } from "@codex/server";
import { chooseDisplayCurrency, type Currency, type FxQuote } from "@codex/shared";
import { getDb } from "./server";

/** Cookie holding the customer's own PKR/USD choice (set by the switcher; no personal data). */
export const CURRENCY_COOKIE = "cx_ccy";

/**
 * Latest USD/PKR reference quote for the storefront. Served from the database cache; the provider is
 * called at most once per refresh window by the server, never per visitor. Null when no valid rate
 * exists — prices are then shown in their original currency only.
 */
export const storefrontFx = cache(async (): Promise<FxQuote | null> => {
  try {
    return await getUsdPkrQuote(await getDb(), { fx: fxConfigFromEnv(process.env as Record<string, string | undefined>) });
  } catch {
    return null;
  }
});

/**
 * Which currency to show first: the customer's saved choice, otherwise their COUNTRY from the hosting
 * platform's IP geolocation header (Vercel: x-vercel-ip-country; no GPS, no browser permission),
 * otherwise STORE_DEFAULT_DISPLAY_CURRENCY (default PKR).
 */
export const displayCurrency = cache(async (): Promise<{ currency: Currency; source: "choice" | "country" | "default" }> => {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const preference = jar.get(CURRENCY_COOKIE)?.value ?? null;
  const country = h.get("x-vercel-ip-country");
  const envDefault = process.env.STORE_DEFAULT_DISPLAY_CURRENCY === "USD" ? "USD" : "PKR";
  const currency = chooseDisplayCurrency({ preference, country, fallback: envDefault });
  const chosen = preference === "PKR" || preference === "USD";
  const located = !!country && /^[A-Z]{2}$/i.test(country) && !["XX", "T1"].includes(country.toUpperCase());
  return { currency, source: chosen ? "choice" : located ? "country" : "default" };
});
