import type { PublicListing } from "@codex/shared";

/**
 * Search and link-preview data for public account pages. Everything comes from the listing the page shows —
 * no invented ratings, reviews, stock levels or prices, and no claim of affiliation with PUBG MOBILE.
 */
export const SITE = (process.env.PUBLIC_SITE_URL || "https://codexstocks.org").replace(/\/$/, "");
export const BRAND = "CODE X STOCKS";
/** Neutral CODE X STOCKS card for links to accounts without a photo (never an unrelated game picture). */
export const OG_FALLBACK = { url: `${SITE}/og/codex-stocks-share.png`, width: 1200, height: 630, type: "image/png" } as const;

export const accountUrl = (slug: string) => `${SITE}/accounts/${slug}`;

/**
 * The account's own (first and only) photo for WhatsApp/Facebook/X previews: an ImageKit URL transformation
 * that crops a 1200×630 JPEG (~100–200 KB) from the original — the stored original is never changed, and the
 * URL is public and permanent (not signed, not expiring). JPEG because some link-preview crawlers skip WebP.
 */
export function ogImage(l: Pick<PublicListing, "image_url">) {
  if (!l.image_url) return OG_FALLBACK;
  const base = l.image_url.split("?")[0];
  return { url: `${base}?tr=w-1200,h-630,c-maintain_ratio,fo-auto,f-jpg,q-80`, width: 1200, height: 630, type: "image/jpeg" } as const;
}

function priceText(l: Pick<PublicListing, "price_minor" | "currency">): string | null {
  if (l.price_minor === null || !l.currency) return null;
  const major = Math.floor(l.price_minor / 100);
  const cents = l.price_minor % 100;
  const n = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${l.currency} ${n}${cents || l.currency === "USD" ? "." + String(cents).padStart(2, "0") : ""}`;
}

export function seoTitle(l: Pick<PublicListing, "title" | "seo_title">): string {
  return l.seo_title?.trim() || `${l.title} | PUBG Account for Sale | ${BRAND}`;
}

/** Owner's override, or a summary built from the listing itself (title, price, first lines of its text). */
export function seoDescription(l: Pick<PublicListing, "title" | "seo_description" | "description" | "price_minor" | "currency">): string {
  if (l.seo_description?.trim()) return l.seo_description.trim();
  const price = priceText(l);
  const lead = `${l.title} — PUBG Mobile account for sale${price ? ` at ${price}` : ""} on ${BRAND}.`;
  const body = l.description.replace(/\s+/g, " ").trim();
  const text = body ? `${lead} ${body}` : `${lead} Hand-checked by the owner; ask on WhatsApp.`;
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
}

/** JSON-LD that matches the visible page: the account (with its listed price) and the breadcrumb trail. */
export function accountJsonLd(l: PublicListing, ref: string) {
  const url = accountUrl(l.slug);
  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: l.title,
    description: seoDescription(l),
    url,
    sku: ref,
    category: "Video game accounts",
    ...(l.image_url ? { image: [ogImage(l).url] } : {}),
  };
  if (l.price_minor !== null && l.currency)
    product.offers = {
      "@type": "Offer",
      url,
      price: (l.price_minor / 100).toFixed(2),
      priceCurrency: l.currency,
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/UsedCondition",
      seller: { "@type": "Organization", name: BRAND, url: SITE },
    };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Accounts", item: `${SITE}/accounts` },
      { "@type": "ListItem", position: 3, name: l.title, item: url },
    ],
  };
  return [product, crumbs];
}

/** Safe inline JSON for a <script type="application/ld+json"> block ("<" and line separators escaped). */
export function jsonLdScript(data: unknown): string {
  const BS = String.fromCharCode(92); // a backslash: the output must contain the escape sequence itself
  return JSON.stringify(data)
    .replace(/</g, `${BS}u003c`)
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), `${BS}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), `${BS}u2029`);
}
