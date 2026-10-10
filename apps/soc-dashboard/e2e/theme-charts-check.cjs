const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Force light via settings
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: /^(Light|فاتح)$/ }).click();
  await page.waitForTimeout(300);

  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'theme-qa-10-analytics-light.png'), fullPage: true });

  // hover a chart to show tooltip
  const chart = page.locator('.recharts-wrapper').first();
  if ((await chart.count()) > 0) {
    const box = await chart.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(__dirname, 'screenshots', 'theme-qa-11-analytics-tooltip-light.png') });
    }
  }

  await browser.close();
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
