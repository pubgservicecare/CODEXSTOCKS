/**
 * Domain-based routing:
 *   admin.codexstocks.org/<path>  -> app/admin/<path>   (private admin, auth enforced by the API)
 *   codexstocks.org/<path>        -> public storefront; /admin/* is NOT reachable here
 * The API (/api/v1) is served on both hosts; private endpoints always require a session.
 */
export type RouteDecision = { action: "next" } | { action: "rewrite"; path: string } | { action: "notfound" };

export const DEFAULT_ADMIN_HOSTS = ["admin.codexstocks.org", "admin.localhost"];

export function adminHosts(env: string | undefined): string[] {
  const extra = (env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return extra.length ? extra : DEFAULT_ADMIN_HOSTS;
}

const PASSTHROUGH = /^\/(api\/|_next\/|favicon\.ico$|robots\.txt$|icon\.svg$)/;

export function decideRoute(hostHeader: string | null, pathname: string, admins: string[]): RouteDecision {
  const host = (hostHeader ?? "").toLowerCase().replace(/:\d+$/, "");
  if (PASSTHROUGH.test(pathname)) return { action: "next" };
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  if (admins.includes(host)) {
    if (isAdminPath) return { action: "next" };
    return { action: "rewrite", path: "/admin" + (pathname === "/" ? "" : pathname) };
  }
  if (isAdminPath) {
    // Local development convenience only: http://localhost:3000/admin
    if (host === "localhost" || host === "127.0.0.1") return { action: "next" };
    return { action: "notfound" };
  }
  return { action: "next" };
}
