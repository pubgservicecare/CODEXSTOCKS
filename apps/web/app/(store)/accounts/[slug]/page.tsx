import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { listings, resolveListing, settings } from "../../../../lib/public";
import { displayCurrency, storefrontFx } from "../../../../lib/currency";
import { accountJsonLd, accountUrl, BRAND, jsonLdScript, ogImage, seoDescription, seoTitle } from "../../../../lib/seo";
import { cardArt } from "../../art";
import { ShareButton } from "../../ShareButton";
import { Brackets, Description, Glyph, ListingCard, ListingMedia, Price, RateNote, WhatsAppButton, type PriceView } from "../../ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * Public account page at /accounts/<readable-slug>. An old slug (the title changed) or an old id link answers
 * with a permanent redirect to the current address, so shared links and search results keep working and only
 * one canonical address is indexed. This route has no loading placeholder on purpose: the redirect is decided
 * before anything is sent, so it is a real HTTP 308.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await resolveListing((await params).slug).catch(() => null);
  if (!found || "redirect" in found) return { title: "Account not found", robots: { index: false } };
  const l = found.listing;
  const title = seoTitle(l);
  const description = seoDescription(l);
  const url = accountUrl(l.slug);
  const img = ogImage(l);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: BRAND,
      url,
      title,
      description,
      images: [{ url: img.url, width: img.width, height: img.height, type: img.type, alt: l.image_url ? `Photo of ${l.title}` : `${BRAND} — PUBG Mobile accounts` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [img.url] },
  };
}

export default async function AccountPage({ params }: Params) {
  const { slug } = await params;
  const found = await resolveListing(slug);
  if (!found) notFound();
  if ("redirect" in found) permanentRedirect(`/accounts/${found.redirect}`);
  const l = found.listing;
  const [store, fx, display] = await Promise.all([settings(), storefrontFx(), displayCurrency()]);
  const view: PriceView = { display: display.currency, fx };
  const url = accountUrl(l.slug);
  const ref = l.id.slice(-8).toUpperCase();
  const more = (await listings({ usdPkrMicro: fx?.usd_pkr_micro }).catch(() => [])).filter((x) => x.id !== l.id).slice(0, 3);
  const backdrop = l.image_url ? `${l.image_url}?tr=w-600,bl-30` : cardArt(l.id);

  return (
    <main className="detail">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(accountJsonLd(l, ref)) }} />
      <div className="detail-backdrop-clip" aria-hidden="true">
        <div className="detail-backdrop" style={{ backgroundImage: `url(${backdrop})` }} />
      </div>
      <div className="wrap">
        <nav className="crumb" aria-label="Breadcrumb">
          <Link href="/accounts"><Glyph name="back" size={16} /> All accounts</Link>
          <span aria-hidden="true">/</span>
          <span className="crumb-ref">Ref {ref}</span>
        </nav>

        <div className="detail-grid">
          <div className="detail-media">
            <div className="media-frame" data-reveal="tilt">
              <ListingMedia l={l} w={1600} eager labelLong fit />
              <Brackets />
            </div>
            {l.youtube_id && (
              <div className="media-video" data-reveal="up">
                <span className="media-label"><Glyph name="play" size={14} /> Video</span>
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${l.youtube_id}`}
                  title={`Video of ${l.title}`}
                  loading="lazy"
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                />
              </div>
            )}
          </div>

          <aside className="detail-panel" aria-label="Price and enquiry">
            <div className="detail-tags">
              <span className="status-chip"><i /> Available</span>
              <span className="ref-chip">Ref {ref}</span>
            </div>
            <h1 className="detail-title">{l.title}</h1>
            <div className="detail-price">
              <Price l={l} view={view} size="detail" />
            </div>
            <RateNote fx={fx} />
            <div className="detail-buy">
              <WhatsAppButton big phone={store.whatsapp} listing={l} url={url} />
              <ShareButton title={l.title} url={url} />
            </div>
            <ul className="assure">
              <li><Glyph name="shield" size={16} /> Hand-checked by the owner before listing</li>
              <li><Glyph name="user" size={16} /> Payment and handover arranged personally on WhatsApp</li>
              <li><Glyph name="tag" size={16} /> Reference <b>{ref}</b> is included in your message</li>
            </ul>
            {l.previous_owner && <p className="note">Previous owner: {l.previous_owner}</p>}
          </aside>
        </div>

        <section className="dossier" aria-labelledby="dossier-title" data-reveal="up">
          <header>
            <p className="kicker">Account dossier</p>
            <h2 id="dossier-title">Account details</h2>
            <p className="note">Shown exactly as written by the owner.</p>
          </header>
          {l.description ? <Description text={l.description} /> : <p className="note">Message us for full details.</p>}
        </section>

        {more.length > 0 && (
          <section className="more" aria-labelledby="more-title">
            <header className="section-head" data-reveal="up">
              <h2 id="more-title" className="display-h display-h--sm">More accounts</h2>
              <Link href="/accounts" className="link-arrow">View all <Glyph name="arrow" size={16} /></Link>
            </header>
            <div className="grid grid--3" data-reveal="stagger">
              {more.map((m, i) => (
                <ListingCard key={m.id} l={m} index={i + 1} view={view} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="mobile-buy">
        <Price l={l} view={view} size="bar" />
        <ShareButton title={l.title} url={url} compact />
        <WhatsAppButton phone={store.whatsapp} listing={l} url={url} label="Enquire" />
      </div>
    </main>
  );
}
