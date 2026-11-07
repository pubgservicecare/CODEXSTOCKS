import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { whatsappLink } from "@codex/shared";
import { listings, settings } from "../../../lib/public";
import { displayCurrency, storefrontFx } from "../../../lib/currency";
import { BACKDROPS, BRAND } from "../art";
import { Armory } from "../Armory";
import { Hero } from "../Hero";
import { Story } from "../Story";
import { Ticker } from "../Ticker";
import { Glyph, ListingCard, RateNote, WhatsAppIcon, type PriceView } from "../ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/", images: [{ url: "/og/codex-stocks-share.png", width: 1200, height: 630, type: "image/png" }] },
  twitter: { card: "summary_large_image", images: ["/og/codex-stocks-share.png"] },
};

const PROOF = ["Hand-checked", "Honest listings", "Owner-confirmed handover", "PKR · USD prices", "Exact descriptions", "WhatsApp enquiries"];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Searches used to live on the home page; keep old links working.
  const sp = await searchParams;
  const keep = new URLSearchParams();
  for (const k of ["q", "currency", "sort"]) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) keep.set(k, s);
  }
  if ([...keep.keys()].length) redirect(`/accounts?${keep.toString()}`);

  let rows: Awaited<ReturnType<typeof listings>> = [];
  let failed = false;
  let store = { store_name: "CODE X STOCKS", store_tagline: "Verified PUBG Mobile accounts", whatsapp: null as string | null };
  const [fx, display] = await Promise.all([storefrontFx(), displayCurrency()]);
  const view: PriceView = { display: display.currency, fx };
  try {
    [rows, store] = await Promise.all([listings({ usdPkrMicro: fx?.usd_pkr_micro }), settings()]);
  } catch (e) {
    console.error("storefront: listings unavailable:", e instanceof Error ? e.message : e);
    failed = true;
  }
  const wa = whatsappLink(store.whatsapp, "Hi CODE X STOCKS, I'd like to ask about your PUBG Mobile accounts.");
  const featured = rows.slice(0, 6);

  return (
    <main className="home">
      <Hero count={failed ? null : rows.length} wa={wa} />
      <Ticker variant="outline" items={PROOF} seconds={46} label="Why buy here" />

      <section className="wrap section in-stock" id="in-stock" aria-labelledby="in-stock-title">
        <header className="section-head" data-reveal="up">
          <div>
            <p className="kicker"><span className="live-dot" /> Live inventory</p>
            <h2 id="in-stock-title" className="display-h">In stock now</h2>
          </div>
          {!failed && rows.length > 0 && (
            <Link href="/accounts" className="link-arrow">
              View all {rows.length} <Glyph name="arrow" size={16} />
            </Link>
          )}
        </header>
        {failed ? (
          <div className="state" role="alert" data-reveal="up">
            <b>Listings are unavailable right now.</b>
            <span>Please refresh in a moment.</span>
          </div>
        ) : featured.length === 0 ? (
          <div className="state state--empty" data-reveal="up">
            <img src={BRAND.x} alt="" width={48} height={52} />
            <div>
              <b>New accounts are being prepared.</b>
              <span>Nothing is listed at this moment — ask on WhatsApp what&apos;s arriving next.</span>
            </div>
            {wa && (
              <a className="btn btn-wa" href={wa} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Ask on WhatsApp</a>
            )}
          </div>
        ) : (
          <>
            <div className="rail" data-reveal="stagger">
              {featured.map((l, i) => (
                <ListingCard key={l.id} l={l} index={i} view={view} />
              ))}
            </div>
            <RateNote fx={fx} />
          </>
        )}
      </section>

      <Story />

      <Armory />

      <section className="wrap section how" id="how" aria-labelledby="how-title">
        <header className="section-head" data-reveal="up">
          <div>
            <p className="kicker">How it works</p>
            <h2 id="how-title" className="display-h">Three steps to your next account</h2>
          </div>
        </header>
        <ol className="steps" data-reveal="stagger">
          <li style={{ ["--i" as string]: 0 }}>
            <span className="step-n">01</span>
            <h3>Pick an account</h3>
            <p>Every listing shows its price and the owner&apos;s full description, exactly as written.</p>
          </li>
          <li style={{ ["--i" as string]: 1 }}>
            <span className="step-n">02</span>
            <h3>Message on WhatsApp</h3>
            <p>Tap “Enquire on WhatsApp” — your message carries the account reference, so the owner knows which one.</p>
          </li>
          <li style={{ ["--i" as string]: 2 }}>
            <span className="step-n">03</span>
            <h3>Agree and hand over</h3>
            <p>Payment and the login handover are arranged directly and personally with the owner.</p>
          </li>
        </ol>
      </section>

      <section className="contact-band" data-scroll="band" aria-labelledby="contact-title">
        <img className="contact-bg" src={BACKDROPS.goldRush} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        <div className="contact-sigil" aria-hidden="true" style={{ WebkitMaskImage: `url(${BRAND.x})`, maskImage: `url(${BRAND.x})` }} />
        <div className="wrap contact-inner" data-reveal="up">
          <p className="kicker">Talk to the owner</p>
          <h2 id="contact-title" className="display-h">Questions first.<br />Deal second.</h2>
          <p>Ask for details, screenshots or a price in your currency before you decide — there&apos;s no obligation.</p>
          <div className="hero-actions">
            {wa && (
              <a href={wa} className="btn btn-wa btn-lg" target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Message on WhatsApp</a>
            )}
            <Link href="/accounts" className="btn btn-glass btn-lg">Browse accounts <Glyph name="arrow" /></Link>
          </div>
        </div>
      </section>
    </main>
  );
}
