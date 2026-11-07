import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { adminHosts } from "../lib/hosts";
import { sitemapListings } from "../lib/public";
import { accountUrl, SITE } from "../lib/seo";

/**
 * XML sitemap: the home page, the inventory and every published, available account by its canonical slug.
 * Never lists private, sold, unpublished or deleted accounts, admin pages, the API or old id addresses.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = ((await headers()).get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (adminHosts(process.env.ADMIN_HOSTS).includes(host)) return [];
  const rows = await sitemapListings().catch(() => []);
  const newest = rows.reduce<string | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null);
  return [
    { url: `${SITE}/`, lastModified: newest ?? undefined, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/accounts`, lastModified: newest ?? undefined, changeFrequency: "daily", priority: 0.9 },
    ...rows.map((r) => ({ url: accountUrl(r.slug), lastModified: r.updated_at, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
