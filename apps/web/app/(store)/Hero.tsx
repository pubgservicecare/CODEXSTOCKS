import Link from "next/link";
import { BRAND, HERO } from "./art";
import { Glyph, SearchBar, WhatsAppIcon } from "./ui";

// Deterministic ember particles (server-rendered, animated by CSS transform/opacity only).
const EMBERS = Array.from({ length: 18 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { left: `${(r(1) * 100).toFixed(1)}%`, delay: `${(-r(2) * 9).toFixed(2)}s`, dur: `${(6 + r(3) * 6).toFixed(2)}s`, size: `${(2 + r(4) * 3).toFixed(1)}px`, drift: `${((r(5) - 0.5) * 80).toFixed(0)}px` };
});

// 1×1 transparent GIF: on phones the side panels are swapped for this, so their pictures are never downloaded.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Optional licensed hero video. Off by default: the Pinterest clip supplied as a reference is an unlicensed,
 * watermarked fan edit of game footage, so it is not used. To use a video you have the rights to, put it in
 * apps/web/public/media/ (MP4/H.264, muted; a poster frame as WebP) and set e.g.
 *   { src: "/media/hero.mp4", poster: "/media/hero-poster.webp" }
 * It plays muted, looped and inline over the pictures, is skipped for reduced motion, and the pictures stay as the
 * instant fallback while it loads.
 */
const HERO_VIDEO = null as { src: string; poster: string } | null;

/**
 * Cinematic hero. Phones: one full-screen X-Suit portrait. Wider screens: three angled "character select" panels
 * that rise in after the brand opening, drift apart as the page scrolls and follow the pointer; hovering a panel
 * widens it. Rising embers, the CODE X sigil and a HUD frame on top; headline revealed line by line.
 */
export function Hero({ count, wa }: { count: number | null; wa: string | null }) {
  const sigil = { WebkitMaskImage: `url(${BRAND.x})`, maskImage: `url(${BRAND.x})` } as React.CSSProperties;
  return (
    <section className="hero" data-scroll="hero" aria-labelledby="hero-title">
      <div className="hero-art" aria-hidden="true">
        <div className="hero-ambient" style={{ backgroundImage: `url(${HERO.portrait})` }} />
        <div className="hero-sigil" style={sigil} />
        <img className="hero-portrait" src={HERO.portrait} alt="" fetchPriority="high" decoding="async" />
        <div className="hero-panels">
          {HERO.panels.map((src, i) => (
            <figure className={`hp hp--${i}`} key={i} style={{ ["--i" as string]: i }}>
              <span className="hp-frame">
                <picture>
                  {i !== 1 && <source media="(max-width: 860px)" srcSet={BLANK} />}
                  <img src={src} alt="" decoding="async" />
                </picture>
              </span>
            </figure>
          ))}
        </div>
        {HERO_VIDEO && (
          <video className="hero-video" autoPlay muted loop playsInline preload="metadata" poster={HERO_VIDEO.poster}>
            <source src={HERO_VIDEO.src} type="video/mp4" />
          </video>
        )}
        <div className="hero-embers">
          {EMBERS.map((e, i) => (
            <i key={i} style={{ left: e.left, animationDelay: e.delay, animationDuration: e.dur, width: e.size, height: e.size, ["--drift" as string]: e.drift }} />
          ))}
        </div>
        <div className="hero-shade" />
      </div>

      <div className="hero-hud" aria-hidden="true">
        <span className="hud-corner hud-corner--tl" />
        <span className="hud-corner hud-corner--tr" />
        <span className="hud-corner hud-corner--bl" />
        <span className="hud-corner hud-corner--br" />
        <span className="hud-coord">CODE X · PUBG Mobile marketplace</span>
      </div>

      <div className="wrap hero-copy">
        <p className="hero-eyebrow intro-seq" style={{ ["--d" as string]: "0s" }}>
          <span className="live-dot" /> {count === null ? "PUBG Mobile accounts" : `${count} ${count === 1 ? "account" : "accounts"} in stock`}
          <span className="sep" /> Hand-checked
        </p>
        <h1 id="hero-title" className="hero-title">
          <span className="line"><span className="intro-seq" style={{ ["--d" as string]: ".08s" }}>Skip the grind.</span></span>
          <span className="line line--red"><span className="intro-seq" style={{ ["--d" as string]: ".18s" }}>Wear the legend.</span></span>
        </h1>
        <p className="hero-sub intro-seq" style={{ ["--d" as string]: ".3s" }}>
          Premium PUBG Mobile accounts, each one checked by the owner. Browse what&apos;s in stock, then deal directly on WhatsApp.
        </p>
        <div className="hero-actions intro-seq" style={{ ["--d" as string]: ".4s" }}>
          <Link href="/accounts" className="btn btn-red btn-lg">
            Browse<span className="hide-xs">&nbsp;accounts</span> <Glyph name="arrow" />
          </Link>
          {wa && (
            <a href={wa} className="btn btn-glass btn-lg" target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon /> WhatsApp
            </a>
          )}
        </div>
        <SearchBar className="hero-search intro-seq" />
      </div>

      <a className="hero-scroll" href="#in-stock" aria-label="Scroll to accounts in stock">
        <span>Scroll</span>
        <i />
      </a>
      <span className="art-credit">Illustrative artwork</span>
    </section>
  );
}
