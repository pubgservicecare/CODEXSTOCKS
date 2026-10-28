import Link from "next/link";
import { formatMoney, PRESERVE_WHITESPACE_STYLE, whatsappLink, type PublicListing } from "@codex/shared";
import { fallbackArt } from "@codex/ui/art";
import { Icon } from "@codex/ui/icons";

export function Price({ l, big }: { l: Pick<PublicListing, "price_minor" | "currency">; big?: boolean }) {
  if (l.price_minor === null || !l.currency) return <span className={`price ${big ? "big" : ""}`}><small>Price on request</small></span>;
  return (
    <span className={`price ${big ? "big" : ""}`}>
      {formatMoney(l.price_minor, l.currency)} <small>{l.currency}</small>
    </span>
  );
}

/**
 * The owner's TXT description, rendered EXACTLY: spaces, tabs, blank lines and line breaks are
 * preserved with white-space: pre-wrap. React escapes the text, so it is never treated as HTML.
 */
export function Description({ text }: { text: string }) {
  return (
    <pre className="desc" style={PRESERVE_WHITESPACE_STYLE} data-testid="public-description">
      {text}
    </pre>
  );
}

const WA_PATH =
  "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.2-1.6-1.2-3s.8-2.2 1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.3.1.2.1.8-.2 1.4Z";

export function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={WA_PATH} />
    </svg>
  );
}

export function WhatsAppButton({ phone, listing, url, big, label = "Enquire on WhatsApp" }: { phone: string | null; listing: PublicListing; url: string; big?: boolean; label?: string }) {
  const short = listing.id.slice(-8).toUpperCase();
  const href = whatsappLink(phone, `Hi CODE X STOCKS, I'm interested in "${listing.title}" (ref ${short}). ${url}`);
  if (!href) return <span className="note">WhatsApp contact coming soon.</span>;
  return (
    <a className={`btn wa ${big ? "big" : ""}`} href={href} target="_blank" rel="noopener noreferrer">
      <WhatsAppIcon />
      {label}
    </a>
  );
}

/** A listing's own photo, or clearly-labelled decorative artwork when the owner has not added one. */
export function ListingMedia({ l, w, h, eager, labelLong, index }: { l: PublicListing; w: number; h: number; eager?: boolean; labelLong?: boolean; index?: number }) {
  if (l.image_url)
    return <img src={`${l.image_url}?tr=w-${w},h-${h},fo-auto`} alt={`Photo of ${l.title}`} loading={eager ? "eager" : "lazy"} />;
  return (
    <>
      <img src={fallbackArt(l.id, index)} alt="" loading={eager ? "eager" : "lazy"} className="is-art" />
      <span className="art-chip">
        <Icon name="image" size={12} /> {labelLong ? "Illustration — the seller hasn't added a photo of this account" : "Illustration · no photo yet"}
      </span>
    </>
  );
}

export function ListingCard({ l, index }: { l: PublicListing; index?: number }) {
  const first = l.description.split(/\r?\n/).find((x) => x.trim() !== "") ?? "";
  return (
    <Link href={`/accounts/${l.id}`} className="card">
      <div className="img">
        <ListingMedia l={l} w={720} h={450} index={index} />
      </div>
      <div className="body">
        <span className="tag">Available</span>
        <h3>{l.title}</h3>
        {first && <div className="snippet">{first.trim()}</div>}
        <div className="foot">
          <Price l={l} />
          <span className="more">
            View <Icon name="chevronRight" size={16} />
          </span>
        </div>
      </div>
    </Link>
  );
}
