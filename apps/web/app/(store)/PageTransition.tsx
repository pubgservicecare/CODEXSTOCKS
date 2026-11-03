"use client";

import { useEffect, useState } from "react";

let booted = false;

/**
 * Wraps each storefront page. The first page of a visit enters with the brand opening; every later (client-side)
 * navigation gets the curtain transition (CSS on .is-nav). The content itself is never transformed, so fixed
 * elements inside pages (buy bar) stay attached to the viewport.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const [nav] = useState(() => booted);
  useEffect(() => {
    booted = true;
  }, []);
  return <div className={nav ? "page-enter is-nav" : "page-enter"}>{children}</div>;
}
