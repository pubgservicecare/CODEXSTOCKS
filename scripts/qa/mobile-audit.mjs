// Responsive audit: for every page x width, measure overflow / off-screen / tiny targets; screenshot selected widths.
// Usage (env): AUDIT_OUT=<dir> AUDIT_SHOTS=320,390 AUDIT_SET=store|admin
import { mkdirSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT = process.env.AUDIT_OUT;
const SET = process.env.AUDIT_SET ?? "store";
const WIDTHS = (process.env.AUDIT_WIDTHS ?? "320,360,375,390,414,430,768,1024,1280,1440").split(",").map(Number);
const SHOTS = new Set((process.env.AUDIT_SHOTS ?? "390").split(",").map(Number));
const ONLY = process.env.AUDIT_ONLY ? new Set(process.env.AUDIT_ONLY.split(",")) : null;

const measure = () => {
  const vw = document.documentElement.clientWidth;
  const overflowX = document.documentElement.scrollWidth - vw;
  const off = [];
  const small = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed" || el.closest(".skip,.sr-only")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // ignore content inside horizontal scrollers (intentional)
    let p = el.parentElement, scroller = false;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === "auto" || ps.overflowX === "scroll" || ps.overflowX === "hidden") { scroller = true; break; }
      p = p.parentElement;
    }
    if (!scroller && (r.right > vw + 1 || r.left < -1)) off.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    if (el.matches("a,button,input,select,textarea,[role=tab]") && !el.closest(".sr-only") && (r.height < 40 || r.width < 40) && cs.display !== "inline")
      small.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").join(".") : ""} "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  // text clipped by its own box
  const clipped = [];
  for (const el of document.querySelectorAll("h1,h2,h3,b,.title,.price,button,.badge")) {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") continue;
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== "visible") clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`);
  }
  const fontMin = Math.min(...[...document.querySelectorAll("p,span,small,td,dd,dt,label,a,button,li")].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize)));
  return { vw, overflowX, off: [...new Set(off)].slice(0, 12), small: [...new Set(small)].slice(0, 15), clipped: clipped.slice(0, 8), fontMin };
};

async function login(page) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  if (await page.locator(".cx-shell").count()) return;
  await page.fill('input[autocomplete="username"]', "demo");
  await page.fill('input[type="password"]', "Demo-Owner-Pass1!");
  await page.click("button.btn.primary");
  await page.waitForSelector(".cx-shell", { timeout: 60000 });
}

export default async function run(page) {
  mkdirSync(OUT, { recursive: true });
  const results = {};
  let pages;
  if (SET === "store") {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const href = await page.locator('a[href^="/accounts/"]').first().getAttribute("href");
    pages = [["home", "/"], ["detail", href], ["notfound", "/accounts/00000000-0000-7000-8000-00000000dead"]];
  } else {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto(`${BASE}/admin/accounts`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-account-row]");
    const href = await page.locator("a.inv-link, a.inv-card").first().getAttribute("href");
    pages = [
      ["dashboard", "/admin"], ["accounts", "/admin/accounts"], ["new", "/admin/accounts/new"], ["detail", href],
      ["sales", "/admin/sales"], ["expenses", "/admin/expenses"], ["history", "/admin/history"], ["sync", "/admin/sync"],
      ["devices", "/admin/devices"], ["settings", "/admin/settings"], ["backup", "/admin/backup"],
    ];
  }
  for (const [name, path] of pages) {
    if (ONLY && !ONLY.has(name)) continue;
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(350);
      results[`${name}@${w}`] = await page.evaluate(measure);
      if (SHOTS.has(w)) await page.screenshot({ path: `${OUT}/${SET}-${name}-${w}.png`, fullPage: true });
    }
  }
  const summary = {};
  for (const [k, v] of Object.entries(results)) {
    if (v.overflowX > 0 || v.off.length || v.clipped.length || v.fontMin < 11) summary[k] = v;
  }
  return { checked: Object.keys(results).length, problems: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { ox: v.overflowX, off: v.off, clipped: v.clipped, fontMin: v.fontMin }])), smallTargets390: Object.fromEntries(Object.entries(results).filter(([k]) => k.endsWith("@390")).map(([k, v]) => [k, v.small])) };
}
