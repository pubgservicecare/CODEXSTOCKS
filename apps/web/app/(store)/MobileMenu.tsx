"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Phone navigation: a menu button that opens a full-screen panel with large links. Hidden on wide screens.
 * The panel is rendered at the end of <body> (portal): the header's backdrop blur would otherwise become the
 * containing block of the fixed panel.
 */
export function MobileMenu({ wa }: { wa: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const path = usePathname();
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    document.documentElement.classList.add("menu-open");
    return () => {
      window.removeEventListener("keydown", esc);
      document.documentElement.classList.remove("menu-open");
    };
  }, [open]);
  const close = () => setOpen(false);
  const panel = (
    <nav id="mnav-panel" className={`mnav-panel${open ? " is-open" : ""}`} aria-label="Menu" aria-hidden={!open} inert={!open}>
      <div className="mnav-links">
        <Link href="/" onClick={close} style={{ ["--i" as string]: 0 }}><small>01</small>Home</Link>
        <Link href="/accounts" onClick={close} style={{ ["--i" as string]: 1 }}><small>02</small>All accounts</Link>
        <Link href="/#how" onClick={close} style={{ ["--i" as string]: 2 }}><small>03</small>How it works</Link>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" onClick={close} style={{ ["--i" as string]: 3 }}><small>04</small>WhatsApp</a>
        )}
      </div>
      <form className="mnav-search" action="/accounts" method="get" role="search">
        <input name="q" placeholder="Search accounts…" aria-label="Search accounts" enterKeyHint="search" maxLength={100} />
        <button className="btn btn-red" type="submit">Go</button>
      </form>
    </nav>
  );
  return (
    <div className="mnav">
      <button
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-controls="mnav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="menu-lines" aria-hidden="true"><i /><i /></span>
      </button>
      {mounted && createPortal(panel, document.body)}
    </div>
  );
}
