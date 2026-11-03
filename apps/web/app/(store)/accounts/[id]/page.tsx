import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listing, listings, settings } from "../../../../lib/public";
import { displayCurrency, storefrontFx } from "../../../../lib/currency";
import { cardArt } from "../../art";
import { Brackets, Description, Glyph, ListingCard, ListingMedia, Price, RateNote, WhatsAppButton, type PriceView } from "../../ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const l = await listing((await params).id).catch(() => null);
  if (!l) return { title: "Account not found" };
  return { title: l.title, description: l.description.slice(0, 160), openGraph: l.image_url ? { images: [l.image_url] } : undefined };
}

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [l, store, fx, display] = await Promise.all([listing(id), settings(), storefrontFx(), displayCurrency()]);
  if (!l) notFound();
  const view: PriceView = { display: display.currency, fx };
  const site = process.env.PUBLIC_SITE_URL || "https://codexstocks.org";
  const url = `${site}/accounts/${l.id}`;
  const ref = l.id.slice(-8).toUpperCase();
  const more = (await listings({ usdPkrMicro: fx?.usd_pkr_micro }).catch(() => [])).filter((x) => x.id !== l.id).slice(0, 3);
  const backdrop = l.image_url ? `${l.image_url}?tr=w-600,bl-30` : cardArt(l.id);

  return (
    <main className="detail">
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
        <WhatsAppButton phone={store.whatsapp} listing={l} url={url} label="Enquire" />
      </div>
    </main>
  );
}
