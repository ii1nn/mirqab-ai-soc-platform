/**
 * Verifies the department filter <select>'s option text color on the
 * Incidents (live-alerts) page. Read-only — navigates and inspects
 * computed styles only, no data mutation of any kind.
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
  page.on('response', (res) => {
    if (res.url().includes('/auth/login')) {
      console.log('DEBUG login response:', res.status());
    }
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.waitForTimeout(300);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  console.log('DEBUG post-login url:', page.url());
  console.log('DEBUG post-login body snippet:', (await page.locator('body').innerText()).slice(0, 300));

  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  console.log('DEBUG url:', page.url());
  console.log('DEBUG select count:', await page.locator('select').count());
  console.log('DEBUG title text:', await page.title());

  // Native <select>/<option> popups aren't part of the DOM screenshot-able
  // render tree in headless Chromium the way in-page elements are, so we
  // verify via computed style on each <option> element directly — this is
  // exactly what the browser uses to paint the native popup list.
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
    };
  });

  console.log('===DEPARTMENT_DROPDOWN_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===DEPARTMENT_DROPDOWN_CHECK_REPORT_END===');

  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '13-department-dropdown-page.png'),
  });

  await browser.close();
}

main().catch((err) => {
  console.error('DEPARTMENT_DROPDOWN_CHECK_FAILED:', err);
  process.exit(1);
});
