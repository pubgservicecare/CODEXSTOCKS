import type { Account } from "./entities";
import type { Currency } from "./money";
import { normalizeNewlines, youtubeId } from "./text";

/**
 * PUBLIC listing DTO — an explicit ALLOWLIST. Anything not listed here
 * (costs, notes, login links, credentials, backup codes, old-owner contact,
 * audit data, revisions) can never reach anonymous customers.
 */
export interface PublicListing {
  id: string;
  /** Canonical URL name: /accounts/<slug>. */
  slug: string;
  title: string;
  price_minor: number | null;
  currency: Currency | null;
  description: string;
  image_url: string | null;
  youtube_id: string | null;
  previous_owner: string | null;
  /** Optional owner-written search title / description (otherwise generated from the listing). */
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
}

export interface PublicSettings {
  store_name: string;
  store_tagline: string;
  whatsapp: string | null;
}

export const PUBLIC_LISTING_KEYS: (keyof PublicListing)[] = [
  "id", "slug", "title", "price_minor", "currency", "description", "image_url", "youtube_id", "previous_owner", "seo_title", "seo_description", "updated_at",
];

export function toPublicListing(
  a: Pick<
    Account,
    | "id" | "title" | "list_price_minor" | "list_currency" | "description_public" | "image_url" | "youtube_url"
    | "old_owner_name" | "show_old_owner_public" | "updated_at"
  > &
    Partial<Pick<Account, "slug" | "seo_title" | "seo_description">>,
): PublicListing {
  return {
    id: a.id,
    slug: a.slug ?? a.id,
    title: a.title,
    price_minor: a.list_price_minor,
    currency: a.list_currency,
    description: normalizeNewlines(a.description_public),
    image_url: a.image_url,
    youtube_id: youtubeId(a.youtube_url),
    previous_owner: a.show_old_owner_public ? a.old_owner_name : null,
    seo_title: a.seo_title?.trim() || null,
    seo_description: a.seo_description?.trim() || null,
    updated_at: a.updated_at,
  };
}
