import type { Metadata } from "next";
import Link from "next/link";
import { whatsappLink } from "@codex/shared";
import { listings, settings } from "../../../lib/public";
import { displayCurrency, storefrontFx } from "../../../lib/currency";
import { BACKDROPS, BRAND } from "../art";
import { FilterSheet } from "../FilterSheet";
import { Glyph, ListingCard, RateNote, WhatsAppIcon, type PriceView } from "../ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "All accounts", description: "Every PUBG Mobile account currently listed on CODE X STOCKS." };

export default async function Inventory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).slice(0, 100);
  const currency = ["PKR", "USD"].includes(one(sp.currency)) ? one(sp.currency) : "";
  const sort = ["price_asc", "price_desc"].includes(one(sp.sort)) ? one(sp.sort) : "";
  const filtered = Boolean(q || currency);

  let rows: Awaited<ReturnType<typeof listings>> = [];
  let failed = false;
  let whatsapp: string | null = null;
  const [fx, display] = await Promise.all([storefrontFx(), displayCurrency()]);
  const view: PriceView = { display: display.currency, fx };
  try {
    const [found, store] = await Promise.all([listings({ q, currency, sort, usdPkrMicro: fx?.usd_pkr_micro }), settings()]);
    rows = found;
    whatsapp = store.whatsapp;
  } catch (e) {
    console.error("storefront: listings unavailable:", e instanceof Error ? e.message : e);
    failed = true;
  }
  const wa = whatsappLink(whatsapp, "Hi CODE X STOCKS, I'd like to ask about your PUBG Mobile accounts.");

  return (
    <main className="inventory">
      <section className="inv-head">
        <img
          className="inv-head-img"
          src={BACKDROPS.lineup}
          srcSet={`${BACKDROPS.lineupSmall} 800w, ${BACKDROPS.lineup} 1147w`}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
        <div className="wrap">
          <p className="kicker"><span className="live-dot" /> Live inventory</p>
          <h1 className="display-h inv-title">All accounts</h1>
          <p className="inv-count" aria-live="polite">
            {failed ? "Listings are unavailable right now" : `${rows.length} ${rows.length === 1 ? "account" : "accounts"}${filtered ? " match your search" : " in stock"}`}
          </p>
          <form className="inv-tools" id="inv" action="/accounts" method="get" role="search">
            <div className="search-bar" id="search">
              <label className="search-field">
                <Glyph name="search" />
                <input name="q" defaultValue={q} placeholder="Search accounts — Conqueror, Glacier, X-Suit…" aria-label="Search accounts" autoComplete="off" enterKeyHint="search" maxLength={100} />
              </label>
              <button className="btn btn-red" type="submit">Search</button>
            </div>
            <FilterSheet form="inv" currency={currency} sort={sort} active={(currency ? 1 : 0) + (sort ? 1 : 0)} />
            {(filtered || sort) && (
              <Link href="/accounts" className="btn btn-ghost inv-clear">Clear</Link>
            )}
          </form>
        </div>
      </section>

      <section className="wrap section inv-body" aria-label="Accounts">
        {failed ? (
          <div className="state" role="alert">
            <b>Listings are unavailable right now.</b>
            <span>Please refresh in a moment.</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="state state--empty">
            <img src={BRAND.x} alt="" width={48} height={52} />
            <div>
              <b>{filtered ? "No accounts match your search." : "New accounts are being prepared."}</b>
              <span>{filtered ? "Try a different keyword or currency." : "Nothing is listed at this moment — ask on WhatsApp what's arriving next."}</span>
            </div>
            {filtered ? (
              <Link href="/accounts" className="btn btn-ghost">Show all accounts</Link>
            ) : (
              wa && <a className="btn btn-wa" href={wa} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Ask on WhatsApp</a>
            )}
          </div>
        ) : (
          <>
            <div className="grid" data-reveal="stagger">
              {rows.map((l, i) => (
                <ListingCard key={l.id} l={l} index={i} view={view} />
              ))}
            </div>
            <RateNote fx={fx} />
          </>
        )}
      </section>
    </main>
  );
}
