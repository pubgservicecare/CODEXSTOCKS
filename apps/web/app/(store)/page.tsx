import Link from "next/link";
import { whatsappLink } from "@codex/shared";
import { ART, ART_ALT } from "@codex/ui/art";
import { Icon } from "@codex/ui/icons";
import { listings, settings } from "../../lib/public";
import { displayCurrency, storefrontFx } from "../../lib/currency";
import { ListingCard, RateNote, WhatsAppIcon, type PriceView } from "./ui";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).slice(0, 100);
  const currency = one(sp.currency);
  const sort = one(sp.sort);
  const filtered = Boolean(q || currency);

  let rows: Awaited<ReturnType<typeof listings>> = [];
  let failed = false;
  let store = { store_name: "CODE X STOCKS", store_tagline: "Verified PUBG Mobile accounts", whatsapp: null as string | null };
  const [fx, display] = await Promise.all([storefrontFx(), displayCurrency()]);
  const view: PriceView = { display: display.currency, fx };
  try {
    [rows, store] = await Promise.all([listings({ q, currency, sort, usdPkrMicro: fx?.usd_pkr_micro }), settings()]);
  } catch (e) {
    console.error("storefront: listings unavailable:", e instanceof Error ? e.message : e);
    failed = true;
  }
  const wa = whatsappLink(store.whatsapp, "Hi CODE X STOCKS, I'd like to ask about your PUBG Mobile accounts.");

  return (
    <main>
      <section className="hero">
        <picture>
          <source media="(max-width: 700px)" srcSet={ART.heroPortrait} />
          <source media="(max-width: 1500px)" srcSet={ART.heroMid} />
          <img src={ART.heroWide} alt={ART_ALT.hero} fetchPriority="high" />
        </picture>
        <div className="wrap hero-inner">
          <span className="eyebrow">
            <span className="pulse" /> {failed ? "PUBG Mobile accounts" : `${filtered ? "Accounts" : rows.length} available now`}
          </span>
          <h1>
            Drop in with an account{" "}
            <br />
            that&apos;s <em>ready to play.</em>
          </h1>
          <p>{store.store_tagline}. Every listing is hand-checked by the owner — browse, then deal directly on WhatsApp.</p>
          <div className="cta">
            <a href="#accounts" className="btn gold big">
              Browse accounts <Icon name="arrowDown" size={18} />
            </a>
            {wa && (
              <a href={wa} className="btn glass big" target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon /> Ask on WhatsApp
              </a>
            )}
          </div>
        </div>
        <span className="art-credit">Original illustration</span>
      </section>

      <section className="trust" aria-label="Why buy here">
        <div className="wrap">
          <div><Icon name="shieldCheck" size={20} /><span><b>Hand-checked</b> Every account is reviewed by the owner before it is listed.</span></div>
          <div><WhatsAppIcon size={20} /><span><b>Direct on WhatsApp</b> Talk to the owner; payment and handover are arranged with you.</span></div>
          <div><Icon name="tag" size={20} /><span><b>Clear prices</b> Every price in PKR and USD; the owner&apos;s listed price is what you pay.</span></div>
        </div>
      </section>

      <section className="wrap section" id="accounts">
        <div className="section-head">
          <div>
            <span className="kicker">Inventory</span>
            <h2>Available accounts</h2>
          </div>
          {!failed && <span className="count">{rows.length} {rows.length === 1 ? "account" : "accounts"}{filtered ? " match" : ""}</span>}
        </div>
        <form className="filters" method="get" action="/#accounts" role="search">
          <label className="search">
            <Icon name="search" size={18} />
            <input name="q" defaultValue={q} placeholder="Search: Conqueror, Glacier, X-Suit…" aria-label="Search accounts" />
          </label>
          <select name="currency" defaultValue={currency} aria-label="Listed in">
            <option value="">Listed in any currency</option>
            <option value="PKR">Listed in PKR</option>
            <option value="USD">Listed in USD</option>
          </select>
          <select name="sort" defaultValue={sort} aria-label="Sort">
            <option value="">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
          <button className="btn gold" type="submit">Search</button>
          {filtered && <Link href="/#accounts" className="btn ghost">Clear</Link>}
        </form>

        {failed ? (
          <div className="state" role="alert">
            <Icon name="alert" size={28} />
            <h3>Listings are unavailable right now</h3>
            <p>Please refresh in a moment.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="state">
            <Icon name={filtered ? "search" : "layers"} size={28} />
            <h3>{filtered ? "No accounts match your search" : "New accounts are coming soon"}</h3>
            <p>{filtered ? "Try a different keyword or currency." : "Check back shortly — or ask on WhatsApp what's arriving next."}</p>
            {filtered && <Link href="/#accounts" className="btn">Show all accounts</Link>}
          </div>
        ) : (
          <div className="grid">
            {rows.map((l, i) => <ListingCard key={l.id} l={l} index={i} view={view} />)}
          </div>
        )}
        {!failed && rows.length > 0 && <RateNote fx={fx} />}
      </section>

      <section className="wrap section" id="how">
        <div className="section-head">
          <div>
            <span className="kicker">How it works</span>
            <h2>Three steps to your next account</h2>
          </div>
        </div>
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <h3>Pick an account</h3>
            <p>Every listing shows the price, currency and the owner&apos;s full description, exactly as written.</p>
          </li>
          <li>
            <span className="n">2</span>
            <h3>Message on WhatsApp</h3>
            <p>Tap “Enquire on WhatsApp” — your message includes the account reference so the owner knows which one.</p>
          </li>
          <li>
            <span className="n">3</span>
            <h3>Agree and hand over</h3>
            <p>Payment and login handover are arranged directly and personally with the owner.</p>
          </li>
        </ol>
      </section>

      <section className="band">
        <img src={ART.storm} alt={ART_ALT.storm} loading="lazy" />
        <div className="wrap">
          <h2>Skip the grind.<br />Keep the glory.</h2>
          <p>Ranked accounts, rare outfits and upgraded weapons — listed honestly, with nothing hidden in the details.</p>
          <a href="#accounts" className="btn gold big">See what&apos;s available</a>
        </div>
      </section>
    </main>
  );
}
