/**
 * Read-only Playwright QA for the Dark/Light/System theme feature.
 * Credentials from env vars so they never appear in this file.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
function shot(name) {
  return path.join(SCREENSHOT_DIR, `theme-qa-${name}.png`);
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  if (!email || !password) throw new Error('MIRQAB_QA_EMAIL / MIRQAB_QA_PASSWORD env vars required');

  const report = {};
  const consoleErrors = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  async function getDataTheme() {
    return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  }
  async function getDir() {
    return page.evaluate(() => document.documentElement.dir);
  }
  async function getBgColor() {
    return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  }

  // ---- A. Login page respects theme before auth ----
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  report.loginPageInitialTheme = await getDataTheme();
  await page.screenshot({ path: shot('01-login-dark-default') });

  // Log in
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // ---- B. Select Light, verify applied + persists across refresh ----
  await page.getByRole('radio', { name: /^(Light|فاتح)$/ }).click();
  await page.waitForTimeout(300);
  report.afterSelectingLight = { dataTheme: await getDataTheme(), bg: await getBgColor() };
  await page.screenshot({ path: shot('02-settings-light') });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  report.lightPersistsAfterRefresh = { dataTheme: await getDataTheme(), bg: await getBgColor() };

  // Dashboard in light mode
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('03-dashboard-light'), fullPage: true });
  report.dashboardLightNoOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2,
  );

  // ---- C. Select Dark, verify applied + persists ----
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: /^(Dark|داكن)$/ }).click();
  await page.waitForTimeout(300);
  report.afterSelectingDark = { dataTheme: await getDataTheme() };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  report.darkPersistsAfterRefresh = { dataTheme: await getDataTheme() };
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('04-dashboard-dark'), fullPage: true });

  // ---- D. Select System ----
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: /^(System|حسب النظام)$/ }).click();
  await page.waitForTimeout(300);
  report.afterSelectingSystem = { dataTheme: await getDataTheme() };

  // Emulate OS dark preference and verify it's followed live (no reload)
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  report.systemFollowsOsDark = await getDataTheme();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  report.systemFollowsOsLight = await getDataTheme();

  // ---- E. Incident UI in both themes (Arabic default) ----
  await page.getByRole('radio', { name: /^Light$/ }).click().catch(async () => {
    await page.getByRole('radio', { name: /فاتح/ }).click();
  });
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const search = page.locator('input[placeholder*="Search"]');
  await search.waitFor({ timeout: 15000 });
  await search.fill('INC-20260816-0096');
  await page.waitForTimeout(500);
  const rowCount = await page.locator('table tbody tr').count();
  report.incidentRowsFoundLight = rowCount;
  if (rowCount > 0) {
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot('05-incident-panels-light-ar'), fullPage: true });
    report.dirDuringIncidentPanelLight = await getDir();

    const readMoreAr = page.getByRole('button', { name: 'قراءة المزيد' }).first();
    if ((await readMoreAr.count()) > 0) {
      await readMoreAr.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: shot('06-evidence-expanded-light-ar') });
    }
    // close panel
    await page.locator('.glass-panel').first().locator('button').first().click().catch(() => {});
  }

  // Switch to English, still Light
  await page.getByRole('button', { name: /^EN$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(400);
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const search2 = page.locator('input[placeholder*="Search"]');
  await search2.waitFor({ timeout: 15000 });
  await search2.fill('INC-20260816-0096');
  await page.waitForTimeout(500);
  if ((await page.locator('table tbody tr').count()) > 0) {
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot('07-incident-panels-light-en'), fullPage: true });
    report.dirDuringIncidentPanelLightEn = await getDir();
  }

  // Back to dark for topology screenshot
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: /^Dark$/ }).click();
  await page.waitForTimeout(300);

  // ---- G. Digital Twin (Citadel Live View) in both themes ----
  await page.goto(`${BASE_URL}/citadel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('08-digital-twin-dark'), fullPage: true });

  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: /^Light$/ }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/citadel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('09-digital-twin-light'), fullPage: true });

  await browser.close();
  report.consoleErrors = consoleErrors;
  console.log('===THEME_QA_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===THEME_QA_REPORT_END===');
}

main().catch((err) => { console.error('THEME_QA_FAILED:', err); process.exit(1); });
