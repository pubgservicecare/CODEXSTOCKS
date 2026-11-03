"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The storefront's motion system (one instance for the whole site):
 *  - [data-reveal]  → gets .is-in when it scrolls into view (CSS does the animation; children stagger by --i).
 *  - [data-scroll]  → scroll-linked CSS variables: "hero" sets --hero-y (px scrolled through the hero),
 *                     "story" sets --p (0…1) and data-active (scene index), "band" sets --p for parallax bands.
 *  - [data-tilt]    → 3D tilt towards the pointer (mouse/pen only).
 *  - html.scrolled  → compact header once the page has scrolled.
 * One passive scroll listener, throttled to animation frames; it only writes CSS variables (no layout reads per
 * frame — element positions are cached and re-measured on resize). Disabled for prefers-reduced-motion.
 */
export function Motion() {
  const path = usePathname();
  useEffect(() => {
    const html = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reveals ---------------------------------------------------------------------------------------------
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    const scan = () => document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => (reduce ? el.classList.add("is-in") : io.observe(el)));
    scan();
    let pending = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        scan();
        measure();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Scroll-linked variables ------------------------------------------------------------------------------
    type Item = { el: HTMLElement; top: number; height: number; kind: string };
    let items: Item[] = [];
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const vh = window.innerHeight;
      html.classList.toggle("scrolled", y > 24);
      if (reduce) return;
      for (const it of items) {
        if (y + vh < it.top - vh * 0.5 || y > it.top + it.height + vh * 0.5) continue;
        if (it.kind === "hero") it.el.style.setProperty("--hero-y", String(Math.round(Math.max(0, Math.min(it.height, y - it.top)))));
        else if (it.kind === "story") {
          const p = Math.max(0, Math.min(1, (y - it.top) / Math.max(1, it.height - vh)));
          it.el.style.setProperty("--p", p.toFixed(4));
          const n = Number(it.el.dataset.count || 1);
          const active = String(Math.min(n - 1, Math.floor(p * n * 0.9999)));
          if (it.el.dataset.active !== active) it.el.dataset.active = active;
        } else {
          const p = (y + vh - it.top) / (it.height + vh);
          it.el.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(4));
        }
      }
    };
    const measure = () => {
      items = [...document.querySelectorAll<HTMLElement>("[data-scroll]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { el, top: r.top + window.scrollY, height: r.height, kind: el.dataset.scroll ?? "band" };
      });
      update();
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("load", measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.body);
    measure();

    // Pointer: hero depth and card tilt (mouse/pen only) -------------------------------------------------
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let tilted: HTMLElement | null = null;
    let rect: DOMRect | null = null;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (reduce || !fine) return;
      const target = (e.target as Element | null)?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (target !== tilted) {
        tilted?.style.removeProperty("--rx");
        tilted?.style.removeProperty("--ry");
        tilted = target;
        rect = target?.getBoundingClientRect() ?? null;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (tilted && rect) {
          const px = (e.clientX - rect.left) / rect.width - 0.5;
          const py = (e.clientY - rect.top) / rect.height - 0.5;
          tilted.style.setProperty("--rx", (-py * 7).toFixed(2) + "deg");
          tilted.style.setProperty("--ry", (px * 9).toFixed(2) + "deg");
          tilted.style.setProperty("--gx", ((px + 0.5) * 100).toFixed(1) + "%");
          tilted.style.setProperty("--gy", ((py + 0.5) * 100).toFixed(1) + "%");
        }
        const hero = document.querySelector<HTMLElement>(".hero");
        if (hero && window.scrollY < window.innerHeight) {
          hero.style.setProperty("--mx", ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
          hero.style.setProperty("--my", ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
        }
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(pending);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", measure);
      window.removeEventListener("pointermove", onMove);
    };
  }, [path]);
  return null;
}
