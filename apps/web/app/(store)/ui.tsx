import Link from "next/link";
import {
  convertUsdPkr,
  otherCurrency,
  PRESERVE_WHITESPACE_STYLE,
  whatsappLink,
  type Currency,
  type FxQuote,
  type PublicListing,
} from "@codex/shared";
import { cardArt } from "./art";
import { Glyph } from "./glyph";

export { Glyph };

/** How prices are shown to this visitor: their display currency and the current reference rate (if any). */
export interface PriceView {
  display: Currency;
  fx: FxQuote | null;
}

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "PKR 100,000" (whole rupees when there are no paisa) or "USD 357.14". `round` rounds PKR to whole rupees. */
export function money(minor: number, currency: Currency, { round = false } = {}): string {
  const sign = minor < 0 ? "-" : "";
  let abs = Math.abs(minor);
  if (round && currency === "PKR") abs = Math.round(abs / 100) * 100;
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  const withCents = currency === "USD" || cents !== 0;
  return `${currency} ${sign}${group(major)}${withCents ? "." + String(cents).padStart(2, "0") : ""}`;
}

/**
 * The listing price in the visitor's display currency, with the other currency on a small line underneath.
 * The owner's amount + currency is the real price; a converted amount is always marked "≈" and the listed
 * price stays visible. Without a rate only the listed price is shown. Cards drop the secondary line when the
 * main line already is the listed price, so they stay uncluttered.
 */
export function Price({ l, view, size = "detail" }: { l: Pick<PublicListing, "price_minor" | "currency">; view?: PriceView; size?: "card" | "detail" | "bar" }) {
  const cls = `price price--${size}`;
  if (l.price_minor === null || !l.currency)
    return (
      <span className={cls} data-testid="price">
        <span className="price-main is-request">Price on request</span>
      </span>
    );
  const listed = money(l.price_minor, l.currency);
  const fx = view?.fx ?? null;
  if (!view || !fx)
    return (
      <span className={cls} data-testid="price">
        <span className="price-main">{listed}</span>
      </span>
    );
  const other = otherCurrency(l.currency);
  const approx = `≈ ${money(convertUsdPkr(l.price_minor, l.currency, other, fx.usd_pkr_micro), other, { round: true })}`;
  const listedFirst = view.display === l.currency;
  return (
    <span className={cls} data-testid="price">
      <span className="price-main">{listedFirst ? listed : approx}</span>
      {listedFirst ? size !== "card" && <span className="price-alt">{approx}</span> : <span className="price-alt">Listed price {listed}</span>}
    </span>
  );
}

/** "≈ values are approximate, at 1 USD = 276.6 PKR (daily reference rate, updated …)" + the provider credit. */
export function RateNote({ fx }: { fx: FxQuote | null }) {
  if (!fx) return <p className="rate-note">Prices are shown in the currency the owner listed them in.</p>;
  const t = new Date(fx.effective_at ?? fx.retrieved_at).toUTCString().replace(" GMT", " UTC");
  const stale = fx.status === "stale";
  const rate = (fx.usd_pkr_micro / 1_000_000).toFixed(2).replace(/\.?0+$/, "");
  return (
    <p className={`rate-note${stale ? " is-stale" : ""}`}>
      ≈ values are approximate, at 1 USD = {rate} PKR ({fx.frequency} reference rate, updated {t}
      {stale ? ", may be out of date" : ""}). You pay the listed price — confirm it on WhatsApp.{" "}
      <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates By Exchange Rate API</a>
    </p>
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
    <a className={`btn btn-wa${big ? " btn-lg" : ""}`} href={href} target="_blank" rel="noopener noreferrer">
      <WhatsAppIcon />
      <span>{label}</span>
    </a>
  );
}

/** HUD corner brackets around media (decorative). */
export function Brackets() {
  return (
    <span className="brackets" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

/** A listing's own photo, or clearly-labelled artwork (not this account) when the owner has not added one. */
export function ListingMedia({ l, w, h, eager, labelLong, index, fit }: { l: PublicListing; w: number; h?: number; eager?: boolean; labelLong?: boolean; index?: number; fit?: boolean }) {
  if (l.image_url) {
    const tr = h ? `w-${w},h-${h},fo-auto` : `w-${w}`;
    return <img src={`${l.image_url}?tr=${tr}`} alt={`Photo of ${l.title}`} loading={eager ? "eager" : "lazy"} decoding="async" className={fit ? "is-photo is-fit" : "is-photo"} />;
  }
  return (
    <>
      <img src={cardArt(l.id, index)} alt="" loading={eager ? "eager" : "lazy"} decoding="async" className="is-art" />
      <span className="art-chip">{labelLong ? "Artwork for illustration — the seller hasn't added a photo of this account yet" : "Artwork · no account photo yet"}</span>
    </>
  );
}

export function ListingCard({ l, index = 0, view }: { l: PublicListing; index?: number; view?: PriceView }) {
  const first = l.description.split(/\r?\n/).find((x) => x.trim() !== "") ?? "";
  return (
    <Link href={`/accounts/${l.slug}`} className="acard" data-tilt data-reveal="card" style={{ ["--i" as string]: index % 8 }}>
      <span className="acard-in">
      <span className="acard-media">
        <ListingMedia l={l} w={800} h={600} index={index} />
        <span className="acard-scan" aria-hidden="true" />
        <span className="acard-status"><i /> Available</span>
        <span className="acard-ref">#{l.id.slice(-6).toUpperCase()}</span>
        <Brackets />
      </span>
      <span className="acard-body">
        <span className="acard-title">{l.title}</span>
        {first && <span className="acard-snippet">{first.trim()}</span>}
        <span className="acard-foot">
          <Price l={l} view={view} size="card" />
          <span className="acard-go">
            View <Glyph name="arrow" size={16} />
          </span>
        </span>
      </span>
      </span>
    </Link>
  );
}

/** Search field with its button attached; submits to the inventory page. */
export function SearchBar({ q = "", id, autoFocus, className = "" }: { q?: string; id?: string; autoFocus?: boolean; className?: string }) {
  return (
    <form className={`search-bar ${className}`} action="/accounts" method="get" role="search" id={id}>
      <label className="search-field">
        <Glyph name="search" />
        <input name="q" defaultValue={q} placeholder="Search accounts — Conqueror, Glacier, X-Suit…" aria-label="Search accounts" autoComplete="off" enterKeyHint="search" autoFocus={autoFocus} maxLength={100} />
      </label>
      <button className="btn btn-red" type="submit">Search</button>
    </form>
  );
}
