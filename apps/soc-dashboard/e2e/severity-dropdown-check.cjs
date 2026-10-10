const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `severity-dropdown-${n}.png`);

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

async function readSelectStyles(page) {
  return page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')];
    return selects.map((sel) => {
      const selectColor = getComputedStyle(sel).color;
      const options = [...sel.querySelectorAll('option')].map((opt) => ({
        text: opt.textContent.trim(),
        color: getComputedStyle(opt).color,
      }));
      return { selectColor, options };
    });
  });
}

async function testInTheme(page, label) {
  await page.goto(`${BASE_URL}/threat-map`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const styles = await readSelectStyles(page);
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(styles, null, 2));

  // Functional check: change severity filter, confirm value updates
  const severitySelect = page.locator('select').nth(1);
  await severitySelect.selectOption('high');
  await page.waitForTimeout(500);
  const value = await severitySelect.inputValue();
  console.log('severity filter value after selecting "high":', value);
  await page.screenshot({ path: SHOT(`${label.replace(/[^a-z0-9]+/gi, '-')}`), fullPage: true });
  await severitySelect.selectOption(''); // reset
  await page.waitForTimeout(300);

  return { styles, filterWorks: value === 'high' };
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

  await setTheme(page, /^(Dark|داكن)$/);
  await setLang(page, /^EN$/);
  results.darkLtr = await testInTheme(page, 'Dark-LTR');

  await setTheme(page, /^Light$/);
  results.lightLtr = await testInTheme(page, 'Light-LTR');

  await setLang(page, /^AR$/);
  results.lightRtl = await testInTheme(page, 'Light-RTL');

  await setTheme(page, /داكن/);
  results.darkRtl = await testInTheme(page, 'Dark-RTL');

  await browser.close();
  console.log('\nconsoleErrors:', JSON.stringify(consoleErrors.filter(e => !e.includes('validateDOMNesting') && !e.includes('400')), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
