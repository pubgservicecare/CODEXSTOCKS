import "server-only";
import { cache } from "react";
import { queryPublicListing, queryPublicListings, queryPublicSettings } from "@codex/server";
import type { PublicListing, PublicSettings } from "@codex/shared";
import { getDb } from "./server";

/** Storefront data access: ONLY the explicit public DTOs (allowlisted fields). */
export async function listings(opts: { q?: string; currency?: string; sort?: string; usdPkrMicro?: number | null }): Promise<PublicListing[]> {
  return queryPublicListings(await getDb(), opts);
}

export const listing = cache(async (id: string): Promise<PublicListing | null> => queryPublicListing(await getDb(), id));

export const settings = cache(async (): Promise<PublicSettings> => queryPublicSettings(await getDb()));
