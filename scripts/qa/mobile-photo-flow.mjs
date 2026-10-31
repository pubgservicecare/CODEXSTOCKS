// Demo mode: Add Account with a photo chosen before saving (preview, change, invalid file, upload failure + retry UI).
import { writeFileSync } from "node:fs";
const BASE = "http://localhost:3100";
const OUT = process.env.AUDIT_OUT;
// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export default async function run(page) {
  const out = {};
  writeFileSync(`${OUT}/photo.png`, PNG);
  writeFileSync(`${OUT}/fake.png`, Buffer.from("this is not an image"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  if (!(await page.locator(".cx-shell").count())) {
    await page.fill('input[autocomplete="username"]', "demo");
    await page.fill('input[type="password"]', "Demo-Owner-Pass1!");
    await page.click("button.btn.primary");
    await page.waitForSelector(".cx-shell", { timeout: 60000 });
  }
  await page.goto(`${BASE}/admin/accounts/new`, { waitUntil: "networkidle" });
  const file = page.locator('[data-testid=image-picker] input[type=file]');
  await file.setInputFiles(`${OUT}/fake.png`);
  await page.waitForTimeout(300);
  out.invalidError = (await page.locator("[data-testid=image-picker] .err").innerText().catch(() => "")).trim();
  await file.setInputFiles(`${OUT}/photo.png`);
  await page.waitForTimeout(400);
  out.previewShown = await page.locator("[data-testid=image-picker] img").count();
  out.previewSrcIsBlob = (await page.locator("[data-testid=image-picker] img").getAttribute("src"))?.startsWith("blob:");
  out.hint = (await page.locator("[data-testid=image-picker] .hint").innerText()).trim();
  await page.locator(".cx-main").evaluate((m) => (m.scrollTop = 250));
  await page.screenshot({ path: `${OUT}/m-new-photo-390.png` });
  // remove + re-pick
  await page.click('button:has-text("Remove selection")');
  out.afterRemove = await page.locator("[data-testid=image-picker] img").count();
  await file.setInputFiles(`${OUT}/photo.png`);
  // fill required
  await page.fill(".form-section input[maxlength='200']", "PHONE TEST · photo at creation");
  await page.fill('input[placeholder="0"]', "1000");
  const ident = page.locator('.link-card input').first();
  await ident.fill("buyer-test@example.com");
  await page.click('button:has-text("Create account")');
  await page.waitForTimeout(4000);
  out.url = page.url();
  out.failNotice = (await page.locator(".notice.image-failed").innerText().catch(() => "")).trim();
  out.retryButton = await page.locator('button:has-text("Retry photo")').count();
  out.continueButton = await page.locator('button:has-text("Continue without photo")').count();
  out.createDisabled = await page.locator('button:has-text("Create account")').count();
  await page.screenshot({ path: `${OUT}/m-new-photo-failed-390.png` });
  // retry also fails honestly, then continue
  if (out.retryButton) {
    await page.click('button:has-text("Retry photo")');
    await page.waitForTimeout(3000);
    out.retryStillFailing = await page.locator(".notice.image-failed").count();
    await page.click('button:has-text("Continue without photo")');
    await page.waitForSelector(".detail-hero");
    out.detailTitle = (await page.locator(".detail-hero h1").innerText()).trim();
    out.accountsWithTitle = await page.evaluate(() => fetch("/api/v1/admin/entities/accounts").then((r) => r.json()).then((rows) => rows.filter((a) => a.title === "PHONE TEST · photo at creation").length).catch((e) => String(e)));
  }
  return out;
}
