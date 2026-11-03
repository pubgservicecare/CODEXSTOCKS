// Final screenshot set (production build, demo data, localhost:3200). Nothing is created, sold or deleted.
const BASE = process.env.QA_BASE || "http://localhost:3200";
const OUT = process.env.QA_OUT || "./qa-out";
export default async function run(page) {
  page.setDefaultTimeout(120000);
  const ctx = page.context();
  const out = { errors: [], shots: 0 };
  const instantWalk = (p) =>
    p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += Math.round(innerHeight * 0.6)) {
        window.scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  const shoot = async (p, name, full = false) => {
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
    out.shots++;
  };

  // ---------- opening (fresh tabs: first visit) ----------
  for (const [w, h, times] of [[390, 844, [250, 550, 850, 1150, 1500]], [1440, 900, [700, 1100]]]) {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => out.errors.push(e.message));
    await p.setViewportSize({ width: w, height: h });
    const t0 = Date.now();
    await p.goto(`${BASE}/`, { waitUntil: "commit" });
    for (const ms of times) {
      const wait = ms - (Date.now() - t0);
      if (wait > 0) await p.waitForTimeout(wait);
      await shoot(p, `public-opening-${w}-${String(ms).padStart(4, "0")}ms`);
    }
    await p.close();
  }

  // ---------- storefront ----------
  const s = await ctx.newPage();
  s.on("pageerror", (e) => out.errors.push(e.message));
  await s.goto(`${BASE}/`, { waitUntil: "networkidle" }); // first visit in this tab; later loads skip the opening
  await s.waitForTimeout(2600);
  for (const [w, h] of [[320, 640], [360, 760], [375, 812], [390, 844], [414, 896], [430, 932]]) {
    await s.setViewportSize({ width: w, height: h });
    await s.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await s.waitForTimeout(1600);
    await shoot(s, `public-home-first-screen-${w}`);
  }
  for (const [w, h] of [[768, 1024], [1024, 768], [1280, 800], [1440, 900]]) {
    await s.setViewportSize({ width: w, height: h });
    await s.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await s.waitForTimeout(1600);
    await shoot(s, `public-hero-${w}`);
  }
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await s.setViewportSize({ width: w, height: h });
    await s.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await instantWalk(s);
    await s.waitForTimeout(900);
    await shoot(s, `public-home-full-${w}`, true);
    if (w === 1440) {
      await shoot(s, "public-ticker-signal-1440");
      await s.locator(".ticker--signal").screenshot({ path: `${OUT}/public-ticker-signal-strip-1440.png` });
      await s.locator(".ticker--outline").screenshot({ path: `${OUT}/public-ticker-outline-strip-1440.png` });
      out.shots += 2;
    }
    const st = await s.evaluate(() => { const e = document.querySelector(".story"); const r = e.getBoundingClientRect(); return { top: r.top + scrollY, height: r.height }; });
    for (const [i, f] of [[1, 0.08], [2, 0.5], [3, 0.9]]) {
      await s.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.round(st.top + (st.height - h) * f));
      await s.waitForTimeout(1600);
      await shoot(s, `public-scroll-story-${i}-${w}`);
    }
    await s.evaluate(() => document.querySelector(".contact-band").scrollIntoView({ behavior: "instant", block: "center" }));
    await s.waitForTimeout(1200);
    await shoot(s, `public-scroll-contact-${w}`);
    // inventory
    await s.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
    await instantWalk(s);
    await s.waitForTimeout(900);
    await shoot(s, `public-inventory-${w}`);
    if (w === 390) {
      await s.click(".filter-open");
      await s.waitForTimeout(800);
      await shoot(s, "public-inventory-filters-sheet-390");
      await s.keyboard.press("Escape");
      await s.waitForTimeout(400);
    }
    // detail
    const href = await s.locator("a.acard").first().getAttribute("href");
    await s.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await instantWalk(s);
    await s.waitForTimeout(900);
    await shoot(s, `public-account-detail-${w}`);
    await shoot(s, `public-account-detail-full-${w}`, true);
    if (w === 390) {
      await s.click(".menu-btn");
      await s.waitForTimeout(900);
      await shoot(s, "public-menu-390");
      await s.click(".menu-btn");
    }
  }
  await s.close();

  // ---------- admin ----------
  const a = await ctx.newPage();
  a.on("pageerror", (e) => out.errors.push(e.message));
  const go = async (path) => {
    await a.goto(`${BASE}/admin${path}`, { waitUntil: "networkidle" });
    await a.waitForSelector(".wx-shell, .wl", { timeout: 90000 });
    await a.waitForTimeout(1300);
  };
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await a.setViewportSize({ width: w, height: h });
    await a.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await a.waitForSelector(".wl");
    await a.waitForTimeout(1200);
    await shoot(a, `admin-owner-login-${w}`);
  }
  await a.fill('input[autocomplete="username"]', "demo");
  await a.fill('input[type="password"]', "Demo-Owner-Pass1!");
  await a.click("button.btn.primary");
  await a.waitForSelector(".wx-shell", { timeout: 90000 });
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await a.setViewportSize({ width: w, height: h });
    for (const [path, name] of [["", "dashboard"], ["/accounts", "inventory"], ["/accounts/new", "add-account-image-picker"], ["/sales", "sales"], ["/expenses", "expenses"], ["/history", "history"], ["/sync", "sync"], ["/devices", "devices"], ["/settings", "settings"], ["/backup", "backup"]]) {
      await go(path);
      await shoot(a, `admin-${name}-${w}`);
    }
    await go("");
    await a.evaluate(() => document.querySelector(".wd-flow")?.scrollIntoView({ behavior: "instant", block: "start" }));
    await a.waitForTimeout(1200);
    await shoot(a, `admin-usd-pkr-reporting-${w}`);
    await go("/accounts");
    await a.locator(".inv-card a.inv-link, tr.clickable").first().click();
    await a.waitForSelector(".detail-hero", { timeout: 60000 });
    await a.waitForTimeout(1200);
    await shoot(a, `admin-account-detail-${w}`);
    const tab = a.locator(".tabs button", { hasText: /login/i }).first();
    if (await tab.count()) {
      await tab.click();
      await a.waitForTimeout(800);
      await shoot(a, `admin-credential-vault-${w}`);
    }
    await go("/accounts");
    await a.locator("button", { hasText: "Mark as Sold" }).first().click();
    await a.waitForSelector(".modal");
    await a.waitForTimeout(800);
    await shoot(a, `admin-mark-as-sold-${w}`);
    const cancel = a.locator(".modal button", { hasText: "Cancel" }).first();
    if (await cancel.count()) await cancel.click();
    await a.waitForTimeout(400);
    if (w === 390) {
      await go("");
      await a.click(".wx-menu");
      await a.waitForTimeout(700);
      await shoot(a, "admin-drawer-390");
      await a.keyboard.press("Escape");
    }
  }
  return out;
}
