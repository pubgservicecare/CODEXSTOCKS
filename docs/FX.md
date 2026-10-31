# USD/PKR exchange rates, dual-currency prices and combined reporting

## Provider

| | |
|---|---|
| Provider | **ExchangeRate-API**, Open Access endpoint `https://open.er-api.com/v6/latest/USD` (no key). Optional `FX_API_KEY` switches to the same provider's keyed endpoint (same response format). |
| Why | Supports PKR; free; the documentation explicitly permits personal **and commercial** currency conversion and caching; no key to protect; simple JSON with publication timestamps. Requires attribution ("Rates By Exchange Rate API" link — shown next to converted prices and in the footer). Redistribution of the raw feed is not allowed (we only show conversions). |
| Verified | 2026-10-30: live request returned `USD/PKR = 276.603556`, `time_last_update_utc` 30 Oct 2026 00:02:31, next update 31 Oct 2026 00:27:41. Also verified end-to-end through `GET /api/v1/fx` of a local build. **Production 2026-10-31:** `https://codexstocks.org/api/v1/fx` returned `276.777696`, source ExchangeRate-API, published 31 Oct 2026 00:02:31 UTC, retrieved 16:47:05 UTC, frequency `daily`, status `fresh`; the same row was found in the production `fx_rates` table. |
| Frequency | **Daily** reference rate (published once per day). It is labelled "daily reference rate" everywhere — never "live" or "real-time". |
| Alternatives considered | Paid/keyed APIs with hourly or minute updates (Open Exchange Rates, FXFeed, AllRatesToday) — not needed for listing prices and their commercial terms were not confirmed; ECB/Frankfurter does not publish PKR; the State Bank of Pakistan publishes daily rates but no API. |

## How the rate is fetched and cached (server only)

`packages/server/src/fx.ts`. The browser, the storefront and the desktop app never call the provider.

- Stored in the database table `fx_rates` (one row: rate, source, publication time, next update time, retrieval time, last attempt, last error).
- A request re-fetches only when the cached value is older than `FX_REFRESH_MINUTES` (default **360**, minimum 60 — the provider asks for at most one request per hour) **and** the provider's announced next update time has passed.
- After a failed attempt the server waits `FX_RETRY_MINUTES` (default **30**) before trying again; concurrent requests claim the attempt in the database so only one calls the provider. Timeout 6 s.
- Validation: result must be `success`, base `USD`, PKR rate a finite number between 10 and 10,000; a publication time in the future is rejected. NaN, infinity, zero, negative and missing values are rejected.
- A failure never replaces a good value. The last verified rate keeps being served, marked **stale** once it is older than 36 h. If no valid rate was ever obtained, there is **no** conversion: prices are shown in their original currency only.
- `GET /api/v1/fx` (public, cached 5 min) returns the quote: rate, source, publication and retrieval times, frequency, status.
- `FX_DISABLED=1` turns fetching off (the cached value is still served).

## Listing prices

The owner's amount + currency (`list_price_minor`, `list_currency`) remain the only stored listing price. The other
currency is **computed at display time** from the latest quote and is always marked "≈". No second price is stored, so
nothing can become inconsistent, and a newer rate changes the displayed equivalent without touching the listing.

- Admin (desktop + website): live preview under the price and purchase-cost fields (amount, equivalent, rate, source,
  time); "≈" equivalents on inventory cards, the list view and the account page.
- Storefront: primary price in the visitor's display currency, the other underneath ("≈ $357.14 USD" or
  "Listed at Rs 100,000.00 PKR"), and a note with the rate, its publication time and the attribution. Price sorting
  compares PKR equivalents.

## Customer display currency

1. The visitor's own choice — the **PKR | USD** switcher in the header sets the `cx_ccy` cookie for a year (plus
   localStorage). No personal data.
2. Otherwise the visitor's **country** from the hosting platform's IP geolocation header (`x-vercel-ip-country` on
   Vercel): Pakistan → PKR, any other country → USD. No GPS and no browser permission prompt.
3. Otherwise `STORE_DEFAULT_DISPLAY_CURRENCY` (`PKR` by default).

Both currencies are always visible; the switcher only changes which comes first.

## Accounting snapshots (never rewritten)

Display conversions and accounting are separate. Each financial record stores the USD/PKR rate that applied when it
was recorded:

| Record | Fields | When |
|---|---|---|
| Account purchase | `purchase_fx_micro`, `purchase_fx_source`, `purchase_fx_at` | USD purchases, captured from the reference quote when the account is created (or when a USD cost is changed); kept on later edits |
| Sale | `fx_usd_pkr_micro`, `fx_source`, `fx_at`, `fx_override_reason` | Every sale when a quote is available; **required** when USD is involved (sale or purchase currency) |
| Expense | `fx_usd_pkr_micro`, `fx_source`, `fx_at` | USD expenses |
| Refund | — | uses its sale's snapshot (always in the sale currency) |

Mark as Sold pre-fills the reference rate and shows its source and time. A different rate is a **manual override**:
`fx_source = "manual"` and a reason are required (enforced by the server schema). On an offline PC the cached quote is
used; if it is older than 72 h the owner must confirm it or enter a rate. The sale's existing cross-currency
`exchange_rate_micro` is derived from the same rate and the server refuses a mismatch. The audit event records the
rate, source, time and reason. Syncing never changes a recorded rate; an older desktop version that does not know the
new fields cannot erase them (the server keeps stored values for fields a client did not send).

## Combined (PKR-equivalent) books and the two dashboard charts

`packages/shared/src/accounting.ts` — `computeConsolidated`, `consolidatedMonthlyFlow`, `displayFlow`.

- The native per-currency report is unchanged and still shown (PKR card, USD card, detailed tables).
- **Combined** card: every transaction converted to PKR (canonical reporting currency) at its **own recorded rate**,
  then added: incoming, outgoing, net cash, stock at cost, net profit (same formula as the native report). Shown with a
  USD equivalent at the current reference rate. USD records without any recorded rate are left out and counted
  ("N USD records without a saved exchange rate are not included") — never guessed.
- **Charts**: one monthly series (sales received vs purchases + expenses + refunds) built from all transactions in PKR
  at their recorded rates. The PKR chart shows it as is; the USD chart divides the whole series by **one** display rate.
  Bar heights for both are taken from the shared series, so the two charts are identical in shape by construction;
  labels show each currency's values. Refreshing the display rate rescales the USD labels only — recorded history is
  untouched.

## Database migration `0002_fx_snapshots` (additive)

Adds nullable columns to `accounts`, `sales`, `expenses` and the table `fx_rates`. Nothing is dropped, rewritten or
deleted; existing rows get NULL (no snapshot). Desktop SQLite adds the same columns automatically on start.

**Production order (done 2026-10-31, see [RELEASE_1.0.4.md](RELEASE_1.0.4.md)):**
1. Back up (desktop encrypted backup; optionally a Neon branch).
2. `npm run db:status` then `npm run db:migrate` against production (with `DATABASE_URL` from `.env.local`).
   This must happen **before** the new code is deployed — the new code reads the new columns.
   *The owner ran the migration; `db:status` then showed `0001_init, 0002_fx_snapshots` applied, none pending.*
3. Deploy. Optional env vars: `STORE_DEFAULT_DISPLAY_CURRENCY`, `FX_REFRESH_MINUTES`, `FX_RETRY_MINUTES`, `FX_API_KEY`, `FX_DISABLED`.
   *Deployed from commit `737b912` (no new env vars).*
4. Check `https://codexstocks.org/api/v1/fx` returns a quote. *Verified.*

## Known limitations

- Daily reference rate: the storefront equivalent can differ from today's open-market or bank rate; it is labelled approximate.
- Existing USD purchases/expenses/sales recorded before this release have no snapshot (older cross-currency sales
  derive one from their recorded rate). They stay in the native USD figures and are listed as excluded from combined
  totals until edited (editing a USD purchase or expense records the current rate).
- Country detection depends on the hosting platform's header (Vercel); locally it falls back to the default.
- Rounding: conversions are exact integer arithmetic rounded half away from zero to the paisa/cent.
