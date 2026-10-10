const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `week-selector-${n}.png`);

async function login(page, email, password) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
}
async function setTheme(page, name) {
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name }).click();
  await page.waitForTimeout(300);
}
async function setLang(page, name) {
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name }).click().catch(() => {});
  await page.waitForTimeout(300);
}

function metricValues(bodyText) {
  return bodyText;
}

async function readMetrics(page) {
  return page.evaluate(() => {
    const labels = ['Total alerts', 'Acknowledged', 'Open incidents', 'Tickets', 'Resolved tickets', 'Avg. resolution'];
    const result = {};
    for (const label of labels) {
      const p = [...document.querySelectorAll('p')].find((el) => el.textContent === label);
      const valueEl = p?.parentElement?.querySelector('p:nth-child(2)');
      result[label] = valueEl ? valueEl.textContent : null;
    }
    return result;
  });
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await login(page, email, password);
  const results = {};

  // === Theme/language screenshots ===
  await setTheme(page, /^(Dark|داكن)$/);
  await setLang(page, /^EN$/);
  await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('01-en-dark'), fullPage: true });

  await setTheme(page, /^(Light|فاتح)$/);
  await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('02-en-light'), fullPage: true });

  await setLang(page, /^AR$/);
  await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('03-ar-light'), fullPage: true });

  await setTheme(page, /داكن/);
  await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('04-ar-dark'), fullPage: true });

  // === Back to English for functional tests ===
  await setLang(page, /^EN$/);
  await page.goto(`${BASE_URL}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Current week (default, no ?week param) — expect honest zeros
  results.currentWeekUrl = page.url();
  results.currentWeekMetrics = await readMetrics(page);
  results.currentWeekHasNoDataCopy = await page.getByText('No data for this week', { exact: false }).isVisible().catch(() => false);

  // Open selector, click "Older weeks" -> pick the earliest (Aug 2-8, known to have data: 100 alerts, 43 tickets)
  await page.getByLabel('Select Week').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT('05-dropdown-open') });
  const options = page.locator('[role="menuitemradio"]');
  const optionCount = await options.count();
  results.dropdownOptionCount = optionCount;
  // click the LAST option (oldest week in the list)
  await options.last().click();
  await page.waitForTimeout(1000);

  results.historicalWeekUrl = page.url();
  results.historicalWeekMetrics = await readMetrics(page);
  await page.screenshot({ path: SHOT('06-historical-week') });

  // Refresh and confirm the selection persists via URL
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  results.afterRefreshUrl = page.url();
  results.afterRefreshMetrics = await readMetrics(page);

  // Switch back to current week via selector
  await page.getByLabel('Select Week').click();
  await page.waitForTimeout(300);
  await page.locator('[role="menuitemradio"]').first().click();
  await page.waitForTimeout(1000);
  results.backToCurrentUrl = page.url();
  results.backToCurrentMetrics = await readMetrics(page);

  // Switch weeks repeatedly (stress the no-stale-data requirement)
  for (let i = 0; i < 3; i++) {
    await page.getByLabel('Select Week').click();
    await page.waitForTimeout(200);
    const opts = page.locator('[role="menuitemradio"]');
    const idx = (i % 2) + 1;
    await opts.nth(idx).click();
    await page.waitForTimeout(700);
  }
  results.afterRepeatedSwitching = await readMetrics(page);
  results.afterRepeatedSwitchingUrl = page.url();

  results.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  console.log('consoleErrors:', JSON.stringify(consoleErrors.filter(e => !e.includes('validateDOMNesting') && !e.includes('400')), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
