export default async function run(page) {
  const OUT = process.env.AUDIT_OUT; const out = {};
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("http://localhost:3100/", { waitUntil: "networkidle" });
  await page.click("button.mnav-toggle");
  await page.waitForTimeout(300);
  out.menuLinks = await page.locator(".mnav-panel a").allInnerTexts();
  await page.screenshot({ path: `${OUT}/s-menu-375.png` });
  await page.click('.mnav-panel a:has-text("How it works")');
  await page.waitForTimeout(600);
  out.menuClosedAfterTap = !(await page.locator(".mnav-panel").count());
  const href = await page.locator('a[href^="/accounts/"]').first().getAttribute("href");
  await page.goto("http://localhost:3100" + href, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/s-detail-375-top.png` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/s-detail-375-bottom.png` });
  const bar = await page.locator(".mobile-buy").boundingBox();
  const last = await page.evaluate(() => { const r = document.querySelector(".site-foot .legal").getBoundingClientRect(); return { bottom: r.bottom }; });
  out.stickyBar = bar; out.footerLegalBottom = last.bottom; out.footerVisibleAboveBar = last.bottom <= bar.y + 1;
  out.waHref = await page.locator(".mobile-buy a").getAttribute("href");
  return out;
}
