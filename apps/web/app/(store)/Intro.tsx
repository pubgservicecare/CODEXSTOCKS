"use client";

import { useEffect } from "react";
import { BRAND } from "./art";

/** Runs before first paint (inline in <head>): marks JS support, decides whether the opening plays, and guarantees
 *  it ends even if the page's JavaScript never loads. Skipped on later visits in this tab and for reduced motion. */
export const INTRO_BOOT = `(function(){var h=document.documentElement;h.classList.add('js');var s=false;try{s=!!sessionStorage.getItem('cx_intro')||matchMedia('(prefers-reduced-motion: reduce)').matches;sessionStorage.setItem('cx_intro','1')}catch(e){}if(s){h.classList.add('no-intro')}else{setTimeout(function(){h.classList.add('intro-out')},2600);setTimeout(function(){h.classList.add('intro-gone')},3400)}})();`;

/**
 * First-visit brand opening: the two strokes of the CODE X mark are drawn, a crosshair locks on, the wordmark
 * rises, then the screen splits along the X to reveal the page. It is part of the server-rendered HTML (never a
 * blank screen) and leaves as soon as the fonts and hero artwork are ready — the only wait is for the mark to
 * finish drawing and register (≈1.25 s after navigation), never a loader delay; it is capped at 2.3 s.
 */
export function Intro() {
  useEffect(() => {
    const html = document.documentElement;
    if (html.classList.contains("no-intro") || html.classList.contains("intro-out")) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // The mark is fully drawn ≈0.8 s after the first paint; hold it a beat so it registers.
      const paint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
      const wait = Math.max(0, paint + 1150 - performance.now());
      window.setTimeout(() => {
        html.classList.add("intro-out");
        window.setTimeout(() => html.classList.add("intro-gone"), 850);
      }, wait);
    };
    const art = document.querySelector<HTMLImageElement>(".hero .hero-portrait");
    const waits: Promise<unknown>[] = [];
    if (document.fonts?.ready) waits.push(document.fonts.ready);
    if (art && !art.complete) waits.push(art.decode().catch(() => undefined));
    void Promise.all(waits).then(finish);
    const cap = window.setTimeout(finish, Math.max(0, 2300 - performance.now()));
    return () => window.clearTimeout(cap);
  }, []);
  const mask = { WebkitMaskImage: `url(${BRAND.x})`, maskImage: `url(${BRAND.x})` } as React.CSSProperties;
  return (
    <div className="intro" aria-hidden="true">
      <div className="intro-half intro-half--a" />
      <div className="intro-half intro-half--b" />
      <div className="intro-core">
        <svg className="intro-ring" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" />
          <path d="M100 0v18M100 182v18M0 100h18M182 100h18" />
        </svg>
        <div className="intro-x">
          <span className="intro-stroke intro-stroke--1" style={mask} />
          <span className="intro-stroke intro-stroke--2" style={mask} />
          <span className="intro-flash" style={mask} />
        </div>
        <img className="intro-word" src={BRAND.word} alt="" />
        <span className="intro-sub">Stocks</span>
        <span className="intro-load"><i /></span>
      </div>
    </div>
  );
}
