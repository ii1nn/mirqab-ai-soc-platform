/**
 * Verifies the department filter <select>'s option text color on the
 * Devices page. Read-only — navigates and inspects computed styles only,
 * no data mutation of any kind.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://localhost:5173';

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  if (!email || !password) throw new Error('MIRQAB_QA_EMAIL / MIRQAB_QA_PASSWORD env vars are required');

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('BROWSER CONSOLE ERROR:', msg.text()); });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.waitForTimeout(300);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  await page.goto(`${BASE_URL}/devices`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  console.log('DEBUG url:', page.url());
  console.log('DEBUG select count:', await page.locator('select').count());

  const report = await page.evaluate(() => {
    const select = document.querySelector('select');
    if (!select) return { error: 'select not found' };
    const options = Array.from(select.querySelectorAll('option'));
    return {
      optionCount: options.length,
      options: options.map((opt) => ({
        text: opt.textContent?.trim(),
        color: getComputedStyle(opt).color,
      })),
      selectClosedColor: getComputedStyle(select).color,
    };
  });

  console.log('===DEVICES_DROPDOWN_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===DEVICES_DROPDOWN_CHECK_REPORT_END===');

  // Also confirm the device table / filtering still renders real data unaffected.
  const bodyText = await page.locator('body').innerText();
  console.log('DEBUG devices count line present:', /\d+ virtual devices/.test(bodyText));

  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '14-devices-dropdown-page.png'),
  });

  await browser.close();
}

main().catch((err) => {
  console.error('DEVICES_DROPDOWN_CHECK_FAILED:', err);
  process.exit(1);
});
