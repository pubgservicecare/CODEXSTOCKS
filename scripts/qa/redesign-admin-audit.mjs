// Admin website overflow audit at all ten required widths (production build, demo data).
const BASE = (process.env.QA_BASE || "http://localhost:3200") + "/admin";
export default async function run(page) {
  page.setDefaultTimeout(120000);
  const out = { errors: [], audit: {} };
  page.on("pageerror", (e) => out.errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".wl");
  await page.fill('input[autocomplete="username"]', "demo");
  await page.fill('input[type="password"]', "Demo-Owner-Pass1!");
  await page.click("button.btn.primary");
  await page.waitForSelector(".wx-shell", { timeout: 90000 });
  const audit = () =>
    page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const main = document.querySelector(".wx-main");
      const off = [...document.querySelectorAll(".wx-main *, .wx-tabbar *, .wx-top *")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (!r.width || cs.position === "fixed" || cs.visibility === "hidden") return false;
        if (e.closest(".table-wrap, .tabs, .seg, .wd-hero-art, .codes")) return false;
        return r.right > w + 1 || r.left < -1;
      }).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`);
      return { x: (document.documentElement.scrollWidth - w) + (main ? main.scrollWidth - main.clientWidth : 0), off: [...new Set(off)].slice(0, 4) };
    });
  for (const w of [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 860 });
    const res = {};
    for (const path of ["", "/accounts", "/accounts/new", "/sales", "/expenses", "/history", "/sync", "/devices", "/settings", "/backup"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".wx-shell");
      await page.waitForTimeout(500);
      const a = await audit();
      if (a.x || a.off.length) res[path || "/"] = a;
    }
    out.audit[w] = Object.keys(res).length ? res : "clean (10 pages)";
  }
  return out;
}
