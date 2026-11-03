// Cycle 2 review: whole storefront at phone + desktop, story states, inventory + filter sheet, detail, menu,
// and an overflow / off-screen audit at every required width.
const BASE = process.env.QA_BASE || "http://localhost:3100";
const OUT = process.env.QA_OUT || "./qa-out";
export default async function run(page) {
  page.setDefaultTimeout(120000);
  const out = { errors: [], audit: {} };
  page.on("pageerror", (e) => out.errors.push(e.message));
  const settle = async () => {
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      // walk the page so every reveal fires, then return to the top
      for (let y = 0; y < document.body.scrollHeight; y += Math.round(innerHeight * 0.6)) {
        window.scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForTimeout(900);
  };
  const audit = () =>
    page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const off = [...document.querySelectorAll("body *")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (!r.width || cs.position === "fixed" || cs.visibility === "hidden") return false;
        if (e.closest(".ticker, .rail, .armory-rail, .hero-art, .story-media, .contact-sigil, .contact-bg, .detail-backdrop-clip, .intro, .skip, .sr-only, .mnav-panel, .filter-sheet")) return false;
        return r.right > w + 1 || r.left < -1;
      }).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`);
      return { scrollX: document.documentElement.scrollWidth - w, offscreen: [...new Set(off)].slice(0, 6) };
    });

  const detailHref = async () => page.locator('a.acard[href^="/accounts/"]').first().getAttribute("href");
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await settle();
    await page.screenshot({ path: `${OUT}/home-full-${w}.png`, fullPage: true });
    // story states
    const story = await page.evaluate(() => { const s = document.querySelector(".story"); const r = s.getBoundingClientRect(); return { top: r.top + scrollY, height: r.height }; });
    for (const [i, f] of [[0, 0.1], [1, 0.5], [2, 0.88]]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.round(story.top + (story.height - h) * f));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/story-${w}-${i}.png` });
    }
    out[`storyActive${w}`] = await page.evaluate(() => document.querySelector(".story").dataset.active);
    // inventory
    await page.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
    await settle();
    await page.screenshot({ path: `${OUT}/inventory-${w}.png` });
    if (w === 390) {
      await page.click(".filter-open");
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/inventory-filters-${w}.png` });
      await page.click(".sheet-head .icon-btn");
      await page.waitForTimeout(500);
    }
    // detail
    const href = await detailHref();
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await settle();
    await page.screenshot({ path: `${OUT}/detail-${w}.png` });
    await page.screenshot({ path: `${OUT}/detail-full-${w}.png`, fullPage: true });
    if (w === 390) {
      await page.click(".menu-btn");
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/menu-${w}.png` });
      await page.click(".menu-btn");
    }
  }
  // overflow audit at every width
  for (const w of [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 860 });
    const res = {};
    for (const path of ["/", "/accounts"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      res[path] = await audit();
    }
    const href = await detailHref();
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    res.detail = await audit();
    out.audit[w] = res;
  }
  return out;
}
