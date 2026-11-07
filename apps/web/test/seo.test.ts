import { describe, expect, it } from "vitest";
import type { PublicListing } from "@codex/shared";
import { accountJsonLd, accountUrl, jsonLdScript, OG_FALLBACK, ogImage, seoDescription, seoTitle, SITE } from "../lib/seo";

const listing = (o: Partial<PublicListing> = {}): PublicListing =>
  ({
    id: "01a1a05c-1143-72dd-8551-c2ba00541166",
    slug: "blood-raven-maxx-with-alan-walker-emote",
    title: "Blood Raven Maxx with Alan Walker Emote",
    description: "Glacier M416, Mythic sets.",
    price_minor: 12_500_000,
    currency: "PKR",
    image_url: null,
    seo_title: null,
    seo_description: null,
    ...o,
  }) as PublicListing;

describe("link previews (WhatsApp / Facebook / X)", () => {
  it("uses the account's own ImageKit photo as a public 1200x630 JPEG, dropping any existing query", () => {
    const img = ogImage(listing({ image_url: "https://ik.imagekit.io/codex/accounts/abc.webp?updatedAt=123" }));
    expect(img).toEqual({
      url: "https://ik.imagekit.io/codex/accounts/abc.webp?tr=w-1200,h-630,c-maintain_ratio,fo-auto,f-jpg,q-80",
      width: 1200,
      height: 630,
      type: "image/jpeg",
    });
    expect(img.url.startsWith("https://")).toBe(true);
    expect(img.url).not.toMatch(/signature|expire|token/i);
  });

  it("falls back to the neutral CODE X STOCKS card when the account has no photo", () => {
    expect(ogImage(listing())).toBe(OG_FALLBACK);
    expect(OG_FALLBACK.url).toBe(`${SITE}/og/codex-stocks-share.png`);
  });
});

describe("per-account SEO", () => {
  it("title, canonical URL and description come from the listing; owner overrides win", () => {
    expect(seoTitle(listing())).toBe("Blood Raven Maxx with Alan Walker Emote | PUBG Account for Sale | CODE X STOCKS");
    expect(seoTitle(listing({ seo_title: "  Custom title  " }))).toBe("Custom title");
    expect(accountUrl("blood-raven-maxx-with-alan-walker-emote")).toBe(`${SITE}/accounts/blood-raven-maxx-with-alan-walker-emote`);
    expect(seoDescription(listing())).toContain("PKR 125,000");
    expect(seoDescription(listing({ seo_description: "Owner text" }))).toBe("Owner text");
  });

  it("descriptions stay within 160 characters", () => {
    const d = seoDescription(listing({ description: "word ".repeat(200) }));
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
  });

  it("JSON-LD uses the slug URL, never the database id in the address, and cannot break out of its script tag", () => {
    const [product, crumbs] = accountJsonLd(listing({ title: "x</script><script>alert(1)" }), "00541166") as Record<string, any>[];
    expect(product.url).toBe(accountUrl("blood-raven-maxx-with-alan-walker-emote"));
    expect(product.offers.price).toBe("125000.00");
    expect(crumbs.itemListElement).toHaveLength(3);
    const s = jsonLdScript([product, crumbs]);
    expect(s).not.toContain("</script>");
    expect(JSON.stringify(product)).not.toContain("01a1a05c-1143");
  });
});
