// Demo-mode end-to-end at phone width: drawer, list cards, Mark as Sold sheet, public listing removal.
const BASE = "http://localhost:3100";
const OUT = process.env.AUDIT_OUT;
export default async function run(page) {
  const out = {};
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  if (!(await page.locator(".cx-shell").count())) {
    await page.fill('input[autocomplete="username"]', "demo");
    await page.fill('input[type="password"]', "Demo-Owner-Pass1!");
    await page.click("button.btn.primary");
    await page.waitForSelector(".cx-shell", { timeout: 60000 });
  }
  // Drawer
  await page.click("button.cx-menu");
  await page.waitForTimeout(400);
  out.drawerLinks = await page.locator(".cx-side .cx-nav a").count();
  await page.screenshot({ path: `${OUT}/m-drawer-390.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  out.drawerClosed = !(await page.locator(".drawer-open").count());

  // Public listings before
  const pubBefore = await page.evaluate(() => fetch("/api/v1/public/listings").then((r) => r.json()).catch(() => null));
  out.publicBefore = Array.isArray(pubBefore) ? pubBefore.map((l) => l.title) : Array.isArray(pubBefore?.listings) ? pubBefore.listings.map((l) => l.title) : typeof pubBefore;

  // Inventory list view as cards
  await page.goto(`${BASE}/admin/accounts`, { waitUntil: "networkidle" });
  await page.click('button[aria-label="List view"]');
  await page.waitForTimeout(400);
  await page.locator(".cx-main").evaluate((m) => (m.scrollTop = 260));
  await page.screenshot({ path: `${OUT}/m-accounts-list-390.png` });
  await page.click('button[aria-label="Grid view"]');

  // Mark as Sold from the first card
  const title = (await page.locator(".inv-card .title").first().innerText()).trim();
  out.title = title;
  await page.locator(".inv-actions button").first().click();
  await page.waitForSelector(".modal");
  out.amountPrefilled = await page.locator('.modal input[placeholder="Amount received"]').inputValue();
  // empty amount is refused
  await page.click('.modal button:has-text("Review sale")');
  out.emptyError = (await page.locator(".modal .notice.bad").innerText().catch(() => "")).trim();
  await page.fill('.modal input[placeholder="Amount received"]', "8,500");
  await page.fill('.modal input[maxlength="200"][autocomplete="off"]', "Test buyer");
  await page.screenshot({ path: `${OUT}/m-sell-form-390.png` });
  await page.click('.modal button:has-text("Review sale")');
  await page.waitForSelector(".confirm-sale");
  out.review = (await page.locator(".sale-review").innerText()).replace(/\n+/g, " | ");
  await page.screenshot({ path: `${OUT}/m-sell-review-390.png` });
  await page.click(".confirm-sale");
  await page.waitForSelector(".modal", { state: "detached", timeout: 30000 });
  await page.waitForTimeout(800);

  // Account now sold with the actual amount
  await page.locator(".inv-card", { hasText: title }).locator("a.inv-link").click();
  await page.waitForSelector(".detail-hero");
  out.detailStatus = (await page.locator(".detail-hero .badge").first().innerText()).trim();
  out.soldSummary = (await page.locator("[data-testid=sold-summary]").innerText().catch(() => "none")).replace(/\n+/g, " | ");
  out.markSoldStillShown = await page.locator(".detail-hero .mark-sold").count();
  await page.screenshot({ path: `${OUT}/m-detail-sold-390.png` });

  // Public site
  const pubAfter = await page.evaluate(() => fetch("/api/v1/public/listings").then((r) => r.json()).catch(() => null));
  out.publicAfter = Array.isArray(pubAfter) ? pubAfter.map((l) => l.title) : Array.isArray(pubAfter?.listings) ? pubAfter.listings.map((l) => l.title) : typeof pubAfter;
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  out.storeHasTitle = (await page.content()).includes(title.replace(/&/g, "&amp;"));

  // Sales page as cards
  await page.goto(`${BASE}/admin/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator(".cx-main").evaluate((m) => (m.scrollTop = 420));
  out.salesRowLabels = await page.locator(".table-wrap tbody tr td[data-label]").evaluateAll((tds) => tds.slice(0, 8).map((t) => t.getAttribute("data-label")));
  await page.screenshot({ path: `${OUT}/m-sales-390.png` });
  // Dashboard sold count
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  out.dashSold = (await page.locator(".stat", { hasText: "Sold" }).locator(".value").innerText()).trim();
  return out;
}
