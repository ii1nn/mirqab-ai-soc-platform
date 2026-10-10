const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `toggle-fix-${n}.png`);

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 500 } })).newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // English LTR, Light
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name: /^(Light|فاتح)$/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^EN$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);

  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const first = page.locator('button[aria-label^="Toggle"]').first();
  await first.waitFor({ timeout: 10000 });
  await first.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: SHOT('en-off'), clip: { x: 0, y: 130, width: 700, height: 160 } });
  await first.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT('en-on'), clip: { x: 0, y: 130, width: 700, height: 160 } });
  await first.click(); // restore
  await page.waitForTimeout(500);

  // Arabic RTL, Light
  await page.getByRole('button', { name: /^AR$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const firstAr = page.locator('button[aria-label^="Toggle"]').first();
  await firstAr.waitFor({ timeout: 10000 });
  await firstAr.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: SHOT('ar-off'), clip: { x: 0, y: 130, width: 900, height: 160 } });
  await firstAr.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT('ar-on'), clip: { x: 0, y: 130, width: 900, height: 160 } });
  await firstAr.click(); // restore
  await page.waitForTimeout(500);

  await browser.close();
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
