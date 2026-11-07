"use client";

import { useEffect, useRef, useState } from "react";
import { Glyph } from "./glyph";
import { WhatsAppIcon } from "./ui";

/**
 * Share this account: the device's own share sheet where available (phones, most browsers), otherwise
 * WhatsApp and Copy link. Only the title and the public page link are shared — nothing private.
 */
export function ShareButton({ title, url, compact = false }: { title: string; url: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const message = `Check out this PUBG account: ${title}\n${url}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(message)}`;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const canNative = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
  const native = async () => {
    try {
      await navigator.share({ title, text: `Check out this PUBG account: ${title}`, url });
      return true;
    } catch (e) {
      return (e as Error)?.name === "AbortError";
    }
  };
  // Phones and tablets: the system share sheet straight away. Mouse/keyboard: a small menu.
  const share = async () => {
    if (canNative() && window.matchMedia?.("(pointer: coarse)").matches && (await native())) return;
    setOpen((v) => !v);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const t = document.createElement("textarea");
      t.value = url;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={`share${compact ? " share--compact" : ""}`} ref={box}>
      <button type="button" className={`btn btn-ghost${compact ? " btn-sm" : ""}`} onClick={() => void share()} aria-haspopup="menu" aria-expanded={open}>
        <Glyph name="share" size={17} />
        <span>Share</span>
      </button>
      {open && (
        <div className="share-menu" role="menu">
          <a role="menuitem" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <WhatsAppIcon size={17} /> WhatsApp
          </a>
          <button role="menuitem" type="button" onClick={() => void copy()}>
            <Glyph name="link" size={17} /> {copied ? "Link copied" : "Copy link"}
          </button>
          {canNative() && (
            <button role="menuitem" type="button" onClick={() => void native().then(() => setOpen(false))}>
              <Glyph name="share" size={17} /> More…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
