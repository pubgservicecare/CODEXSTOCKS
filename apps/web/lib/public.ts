import "server-only";
import { cache } from "react";
import { queryPublicListing, queryPublicListings, queryPublicSettings, queryPublicSitemap, resolvePublicListing } from "@codex/server";
import type { PublicListing, PublicSettings } from "@codex/shared";
import { getDb } from "./server";

/** Storefront data access: ONLY the explicit public DTOs (allowlisted fields). */
export async function listings(opts: { q?: string; currency?: string; sort?: string; usdPkrMicro?: number | null }): Promise<PublicListing[]> {
  return queryPublicListings(await getDb(), opts);
}

export const listing = cache(async (id: string): Promise<PublicListing | null> => queryPublicListing(await getDb(), id));

export const settings = cache(async (): Promise<PublicSettings> => queryPublicSettings(await getDb()));

/** Account page lookup: current slug -> listing; old slug or old id URL -> the slug to redirect to. */
export const resolveListing = cache(async (key: string) => resolvePublicListing(await getDb(), key));

export async function sitemapListings(): Promise<{ slug: string; updated_at: string }[]> {
  return queryPublicSitemap(await getDb());
}
