import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@codex/ui/icons";
import { listing, settings } from "../../../../lib/public";
import { Description, ListingMedia, Price, WhatsAppButton } from "../../ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const l = await listing((await params).id).catch(() => null);
  if (!l) return { title: "Account not found" };
  return { title: l.title, description: l.description.slice(0, 160), openGraph: l.image_url ? { images: [l.image_url] } : undefined };
}

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [l, store] = await Promise.all([listing(id), settings()]);
  if (!l) notFound();
  const site = process.env.PUBLIC_SITE_URL || "https://codexstocks.org";
  const url = `${site}/accounts/${l.id}`;
  return (
    <main className="wrap detail-page">
      <nav className="crumb" aria-label="Breadcrumb">
        <Link href="/#accounts"><Icon name="chevronLeft" size={16} /> All accounts</Link>
      </nav>
      <div className="detail">
        <div className="gallery">
          <div className="media">
            <ListingMedia l={l} w={1400} h={875} eager labelLong />
          </div>
          {l.youtube_id && (
            <div className="yt">
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
        <aside className="panel">
          <span className="tag">Available</span>
          <h1>{l.title}</h1>
          <Price l={l} big />
          <div className="buy">
            <WhatsAppButton big phone={store.whatsapp} listing={l} url={url} />
          </div>
          <ul className="assure">
            <li><Icon name="shieldCheck" size={16} /> Hand-checked by the owner before listing</li>
            <li><Icon name="user" size={16} /> Payment and handover arranged personally on WhatsApp</li>
            <li><Icon name="tag" size={16} /> Reference <b>{l.id.slice(-8).toUpperCase()}</b> is included in your message</li>
          </ul>
          {l.previous_owner && <p className="note">Previous owner: {l.previous_owner}</p>}
        </aside>
      </div>
      <section className="details">
        <h2>Account details</h2>
        <p className="note">Shown exactly as written by the owner.</p>
        {l.description ? <Description text={l.description} /> : <p className="note">Message us for full details.</p>}
      </section>
      <div className="mobile-buy">
        <Price l={l} />
        <WhatsAppButton phone={store.whatsapp} listing={l} url={url} label="Enquire" />
      </div>
    </main>
  );
}
