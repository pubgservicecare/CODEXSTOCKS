import { NextResponse, type NextRequest } from "next/server";
import { adminCsp, storeCsp } from "./lib/csp";
import { adminHosts, decideRoute } from "./lib/hosts";

const ADMINS = adminHosts(process.env.ADMIN_HOSTS);

export function proxy(req: NextRequest) {
  const d = decideRoute(req.headers.get("host"), req.nextUrl.pathname, ADMINS);
  const isAdmin = d.action === "rewrite" || req.nextUrl.pathname === "/admin" || req.nextUrl.pathname.startsWith("/admin/");
  const secure = (res: NextResponse) => {
    if (req.nextUrl.pathname.startsWith("/api/")) return res;
    res.headers.set("Content-Security-Policy", isAdmin ? adminCsp : storeCsp);
    if (isAdmin) {
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return res;
  };
  if (d.action === "rewrite") {
    const url = req.nextUrl.clone();
    url.pathname = d.path;
    return secure(NextResponse.rewrite(url));
  }
  if (d.action === "notfound") {
    const url = req.nextUrl.clone();
    url.pathname = "/__not_found";
    return NextResponse.rewrite(url, { status: 404 });
  }
  return secure(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
