/**
 * Read-only visual check: confirms the Open Tickets (pink) and Departments
 * (purple) KPI cards now render their box-shadow glow WITHOUT hover,
 * matching Critical/High Risk/Total Alerts (red/orange/blue), which were
 * already always-on. No interaction beyond login/navigation; no data
 * mutation.
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

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // The 5 KPI cards are the first 5 `.glass-card` elements on the page.
  const report = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.glass-card')).slice(0, 5);
    return cards.map((el) => ({
      boxShadow: getComputedStyle(el).boxShadow,
    }));
  });

  console.log('===KPI_GLOW_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===KPI_GLOW_CHECK_REPORT_END===');

  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '17-dashboard-kpi-glow-no-hover.png'),
  });

  await browser.close();
}

main().catch((err) => {
  console.error('KPI_GLOW_CHECK_FAILED:', err);
  process.exit(1);
});
