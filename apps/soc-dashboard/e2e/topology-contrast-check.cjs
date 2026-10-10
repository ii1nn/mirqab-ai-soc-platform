const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `topology-fix-${n}.png`);

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
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name }).click();
  await page.waitForTimeout(300);
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await login(page, email, password);

  // 1) English + Light
  await setTheme(page, /^(Light|فاتح)$/);
  await page.getByRole('button', { name: /^EN$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/citadel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: SHOT('01-citadel-en-light'), fullPage: true });

  // Also the smaller dashboard widget (populated view, good for close inspection)
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('02-dashboard-map-en-light'), fullPage: true });

  // 2) English + Dark
  await setTheme(page, /^Dark$/);
  await page.goto(`${BASE_URL}/citadel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: SHOT('03-citadel-en-dark'), fullPage: true });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('04-dashboard-map-en-dark'), fullPage: true });

  // 3) Arabic + Light
  await page.getByRole('button', { name: /^AR$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  await setTheme(page, /فاتح/);
  await page.goto(`${BASE_URL}/citadel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: SHOT('05-citadel-ar-light'), fullPage: true });

  // 4) Arabic + Dark
  await setTheme(page, /داكن/);
  await page.goto(`${BASE_URL}/citadel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: SHOT('06-citadel-ar-dark'), fullPage: true });

  await browser.close();
  console.log('consoleErrors:', JSON.stringify(consoleErrors, null, 2));
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
