import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { adminHosts } from "../lib/hosts";
import { SITE } from "../lib/seo";

/**
 * robots.txt for both hosts. Storefront: everything public may be crawled (CSS, JS and images included);
 * the private API is not. Admin host: nothing may be crawled (its pages also send noindex).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (adminHosts(process.env.ADMIN_HOSTS).includes(host)) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
