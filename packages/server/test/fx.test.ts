// Server-side USD/PKR rate service (cache, refresh, stale fallback, validation) and snapshot persistence.
import { describe, expect, it } from "vitest";
import { newId } from "@codex/shared";
import { getUsdPkrQuote, migrationStatus, queryPublicListings } from "../src";
import { setupOwner, startServer } from "./helpers";

const H = 3_600_000;
const T0 = new Date("2026-10-30T06:00:00.000Z");

/** Fake ExchangeRate-API. `body` can be replaced to simulate bad data; `fail` makes it error. */
function provider(rate: unknown = 276.603556) {
  const p = {
    calls: 0,
    fail: false,
    body: null as Record<string, unknown> | null,
    published: Math.floor(Date.parse("2026-10-30T00:02:31Z") / 1000),
    fetch: (async (input: RequestInfo | URL) => {
      p.calls++;
      const url = String(input);
      if (p.fail) throw new TypeError("fetch failed");
      if (!url.startsWith("https://open.er-api.com/v6/latest/USD") && !url.startsWith("https://v6.exchangerate-api.com/")) return new Response("?", { status: 404 });
      return Response.json(
        p.body ?? { result: "success", base_code: "USD", time_last_update_unix: p.published, time_next_update_unix: p.published + 87_000, rates: { USD: 1, PKR: rate } },
      );
    }) as typeof fetch,
  };
  return p;
}

describe("USD/PKR rate service", () => {
  it("fetches once, then serves the cached daily rate without calling the provider again", async () => {
    const s = await startServer();
    const p = provider();
    const q = await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: T0, fx: {} });
    expect(q).toMatchObject({ pair: "USD/PKR", usd_pkr_micro: 276_603_556, source: "ExchangeRate-API", frequency: "daily", status: "fresh", effective_at: "2026-10-30T00:02:31.000Z" });
    for (let i = 1; i <= 5; i++) await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: new Date(T0.getTime() + i * H), fx: {} });
    expect(p.calls).toBe(1); // cached: within the refresh window and before the provider's next update
  });

  it("refreshes after the provider's next update and the refresh window have passed", async () => {
    const s = await startServer();
    const p = provider(276.6);
    await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: T0, fx: {} });
    p.published += 86_400;
    p.body = { result: "success", base_code: "USD", time_last_update_unix: p.published, time_next_update_unix: p.published + 86_400, rates: { PKR: 277.1 } };
    const later = new Date(T0.getTime() + 25 * H);
    const q = await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: later, fx: {} });
    expect(p.calls).toBe(2);
    expect(q?.usd_pkr_micro).toBe(277_100_000);
  });

  it("keeps the last verified rate when the provider fails, marks it stale, and retries only after a pause", async () => {
    const s = await startServer();
    const p = provider(276.6);
    await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: T0, fx: {} });
    p.fail = true;
    const t1 = new Date(T0.getTime() + 48 * H);
    const q1 = await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: t1, fx: {} });
    expect(q1).toMatchObject({ usd_pkr_micro: 276_600_000, status: "stale" }); // old value, honestly labelled
    expect(p.calls).toBe(2);
    await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: new Date(t1.getTime() + 10 * 60_000), fx: {} });
    expect(p.calls).toBe(2); // no hammering inside the retry pause
    const err = await s.db.query<{ last_error: string }>("SELECT last_error FROM fx_rates");
    expect(err.rows[0].last_error).toMatch(/fetch failed/);
    p.fail = false;
    await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: new Date(t1.getTime() + 31 * 60_000), fx: {} });
    expect(p.calls).toBe(3);
  });

  it("returns no rate at all when none was ever obtained (no fabricated value)", async () => {
    const s = await startServer();
    const p = provider();
    p.fail = true;
    expect(await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: T0, fx: {} })).toBeNull();
    expect(await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: T0, fx: { disabled: true } })).toBeNull();
  });

  it("rejects invalid provider data", async () => {
    const bad: Record<string, unknown>[] = [
      { result: "error", "error-type": "unsupported-code" },
      { result: "success", base_code: "EUR", rates: { PKR: 300 } },
      { result: "success", base_code: "USD", rates: { USD: 1 } },
      { result: "success", base_code: "USD", rates: { PKR: "NaN" } },
      { result: "success", base_code: "USD", rates: { PKR: 0 } },
      { result: "success", base_code: "USD", rates: { PKR: -276 } },
      { result: "success", base_code: "USD", rates: { PKR: 1e12 } },
      { result: "success", base_code: "USD", time_last_update_unix: Math.floor(T0.getTime() / 1000) + 86_400 * 5, rates: { PKR: 276 } },
    ];
    for (const body of bad) {
      const s = await startServer();
      const p = provider();
      p.body = body;
      expect(await getUsdPkrQuote(s.db, { fetchImpl: p.fetch, now: T0, fx: {} })).toBeNull();
    }
  });

  it("is available on the public /fx endpoint and never needs a client-side key", async () => {
    const p = provider(276.603556);
    const s = await startServer({ fetchImpl: p.fetch, fx: {}, now: () => T0 });
    const r = await s.call("GET", "/fx");
    expect(r.status).toBe(200);
    expect(r.json.quote).toMatchObject({ usd_pkr_micro: 276_603_556, frequency: "daily" });
    expect(JSON.stringify(r.json)).not.toMatch(/key|secret/i);
    expect(r.headers.get("cache-control")).toMatch(/max-age=300/);
  });
});

describe("exchange-rate snapshots in the database", () => {
  it("migration 0002 is additive: existing rows keep their values and get NULL snapshots", async () => {
    const s = await startServer();
    expect((await migrationStatus(s.db)).applied).toEqual(expect.arrayContaining(["0001_init", "0002_fx_snapshots"]));
    const cols = await s.db.query<{ table_name: string; column_name: string; is_nullable: string }>(
      "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE column_name LIKE '%fx%' ORDER BY table_name, column_name",
    );
    expect(cols.rows.every((c) => c.is_nullable === "YES")).toBe(true);
    expect(cols.rows.map((c) => `${c.table_name}.${c.column_name}`)).toEqual(
      expect.arrayContaining(["accounts.purchase_fx_micro", "sales.fx_usd_pkr_micro", "sales.fx_override_reason", "expenses.fx_usd_pkr_micro"]),
    );
  });

  async function owner() {
    const s = await startServer();
    const { token } = await setupOwner(s);
    const cmd = (name: string, body: unknown) => s.call("POST", `/admin/commands/${name}`, { token, body });
    return { s, token, cmd };
  }
  const links = [{ kind: "email", identifier: "a@b.cc" }];
  const account = (over: Record<string, unknown> = {}) => ({ title: "FX test", purchase_cost_minor: 5_000, purchase_currency: "USD", ...over });

  it("stores the sale's snapshot exactly, requires a reason for a manual rate, and refuses a mismatched rate", async () => {
    const { cmd } = await owner();
    const id = newId();
    expect((await cmd("createAccount", { id, account: account({ purchase_fx_micro: 280_000_000, purchase_fx_source: "ExchangeRate-API", purchase_fx_at: "2026-06-01T00:00:00.000Z" }), links })).status).toBe(200);
    const sale = { account_id: id, sold_at: "2026-07-01T10:00:00.000Z", amount_minor: 2_000_000, currency: "PKR", channel: "whatsapp" };
    const manualNoReason = await cmd("recordSale", { ...sale, exchange_rate_micro: 290_000_000, fx_usd_pkr_micro: 290_000_000, fx_source: "manual", fx_at: "2026-07-01T10:00:00.000Z" });
    expect(manualNoReason.status).toBe(400); // schema validation
    expect(manualNoReason.json.error.message).toMatch(/reason/i);
    const mismatch = await cmd("recordSale", { ...sale, exchange_rate_micro: 300_000_000, fx_usd_pkr_micro: 290_000_000, fx_source: "ExchangeRate-API", fx_at: "2026-07-01T00:00:00.000Z" });
    expect(mismatch.status).toBe(422);
    expect(mismatch.json.error.code).toBe("rate_mismatch");
    const ok = await cmd("recordSale", { ...sale, exchange_rate_micro: 290_000_000, fx_usd_pkr_micro: 290_000_000, fx_source: "manual", fx_at: "2026-07-01T10:00:00.000Z", fx_override_reason: "Buyer paid at open-market rate" });
    expect(ok.status).toBe(200);
    expect(ok.json.result).toMatchObject({ fx_usd_pkr_micro: 290_000_000, fx_source: "manual", fx_override_reason: "Buyer paid at open-market rate", exchange_rate_micro: 290_000_000 });
  });

  it("an older app that does not send the snapshot fields cannot erase them during sync", async () => {
    const { s, token, cmd } = await owner();
    const id = newId();
    await cmd("createAccount", { id, account: account({ purchase_fx_micro: 280_000_000, purchase_fx_source: "ExchangeRate-API", purchase_fx_at: "2026-06-01T00:00:00.000Z" }), links });
    const cur = (await s.call("GET", `/admin/entities/accounts/${id}`, { token })).json;
    const { purchase_fx_micro: _a, purchase_fx_source: _b, purchase_fx_at: _c, ...oldShape } = cur; // what a 1.0.3 desktop sends
    const push = await s.call("POST", "/sync/push", { token, body: { ops: [{ op_id: newId(), entity: "accounts", id, base_rev: cur.rev, row: { ...oldShape, title: "Edited on an old PC" } }] } });
    expect(push.json.results[0].status).toBe("applied");
    const after = (await s.call("GET", `/admin/entities/accounts/${id}`, { token })).json;
    expect(after).toMatchObject({ title: "Edited on an old PC", purchase_fx_micro: 280_000_000, purchase_fx_source: "ExchangeRate-API" });
  });

  it("sorts mixed-currency storefront listings by their PKR equivalent", async () => {
    const p = provider(280);
    const s = await startServer({ fetchImpl: p.fetch, fx: {}, now: () => T0 });
    const { token } = await setupOwner(s);
    const make = async (title: string, price: number, cur: string) => {
      const id = newId();
      await s.call("POST", "/admin/commands/createAccount", { token, body: { id, account: { title, purchase_cost_minor: 0, purchase_currency: "PKR", list_price_minor: price, list_currency: cur }, links } });
      await s.call("POST", "/admin/commands/setPublished", { token, body: { id, published: true } });
    };
    await make("Rs 50,000", 5_000_000, "PKR"); // = $178
    await make("$100", 10_000, "USD"); // = Rs 28,000
    await make("$500", 50_000, "USD"); // = Rs 140,000
    const asc = (await s.call("GET", "/public/listings?sort=price_asc")).json.map((l: { title: string }) => l.title);
    expect(asc).toEqual(["$100", "Rs 50,000", "$500"]);
    // The storefront always passes the rate; every other query shape must still work with it.
    for (const opts of [{}, { sort: "" }, { q: "$" }, { currency: "USD" }, { sort: "price_desc", currency: "PKR" }])
      expect((await queryPublicListings(s.db, { ...opts, usdPkrMicro: 280_000_000 })).length).toBeGreaterThan(0);
  });
});
