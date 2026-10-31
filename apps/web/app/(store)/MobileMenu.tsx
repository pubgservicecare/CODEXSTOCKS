"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Phone navigation: a menu button that opens a full-width panel under the header. Hidden on wide screens. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="mnav">
      <button
        type="button"
        className="btn mnav-toggle"
        aria-expanded={open}
        aria-controls="mnav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <>
          <div className="mnav-back" onClick={close} aria-hidden="true" />
          <nav id="mnav-panel" className="mnav-panel" aria-label="Menu">
            <Link href="/#accounts" onClick={close}>Available accounts</Link>
            <Link href="/#how" onClick={close}>How it works</Link>
            <Link href="/#accounts" onClick={close} className="btn gold">Browse accounts</Link>
          </nav>
        </>
      )}
    </div>
  );
}
