// Reduced-motion behaviour and scroll performance (production build, demo data).
const BASE = process.env.QA_BASE || "http://localhost:3200";
const OUT = process.env.QA_OUT || "./qa-out";
export default async function run(page) {
  const ctx = page.context();
  const out = {};

  // A. prefers-reduced-motion: reduce
  const p = await ctx.newPage();
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  out.reduced = await p.evaluate(() => {
    const html = document.documentElement;
    const intro = document.querySelector(".intro");
    const track = document.querySelector(".ticker-track");
    const story = document.querySelector(".story");
    const card = document.querySelector(".rail .acard:last-child") || document.querySelector(".acard");
    const cast = document.querySelector(".hp--1") || document.querySelector(".hero-portrait");
    return {
      noIntroClass: html.classList.contains("no-intro"),
      introDisplay: intro ? getComputedStyle(intro).display : "none",
      tickerAnimation: track ? getComputedStyle(track).animationName : null,
      storyHeight: story ? Math.round(story.getBoundingClientRect().height) : null,
      viewport: innerHeight,
      offscreenCardOpacity: card ? getComputedStyle(card).opacity : null,
      castTransform: cast ? getComputedStyle(cast).transform : null,
      emberDisplay: getComputedStyle(document.querySelector(".hero-embers")).display,
    };
  });
  await p.locator(".story").scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/public-reduced-motion-story-390.png` });
  await p.close();

  // B. Scroll performance at phone size with a 4x slower CPU
  const q = await ctx.newPage();
  await q.setViewportSize({ width: 390, height: 844 });
  const cdp = await ctx.newCDPSession(q);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await q.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await q.waitForTimeout(3500);
  out.scroll = await q.evaluate(async () => {
    const long = [];
    let cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: false });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) cls += e.value; })).observe({ type: "layout-shift", buffered: true });
    const frames = [];
    let last = performance.now();
    const end = document.body.scrollHeight - innerHeight;
    await new Promise((resolve) => {
      const step = (t) => {
        frames.push(t - last);
        last = t;
        window.scrollBy({ top: 14, behavior: "instant" });
        if (window.scrollY >= end - 2 || frames.length > 900) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const f = frames.slice(1);
    const sorted = [...f].sort((a, b) => a - b);
    return {
      frames: f.length,
      avgMs: +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(1),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      over50ms: f.filter((x) => x > 50).length,
      longTasksDuringScroll: long.length,
      cumulativeLayoutShift: +cls.toFixed(4),
    };
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await q.close();
  return out;
}
