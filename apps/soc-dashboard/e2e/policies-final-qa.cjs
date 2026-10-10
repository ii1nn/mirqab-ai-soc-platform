const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `policies-qa-${n}.png`);

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

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await login(page, email, password);

  // English + Light
  await setTheme(page, /^(Light|فاتح)$/);
  await page.getByRole('button', { name: /^EN$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT('01-en-light'), fullPage: true });

  // hover + focus state on the toggle
  const toggle = page.locator('button[aria-label^="Toggle"]').first();
  await toggle.hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: SHOT('02-en-light-hover') });
  await toggle.focus();
  await page.waitForTimeout(150);
  await page.screenshot({ path: SHOT('03-en-light-focus') });

  // English + Dark
  await setTheme(page, /^Dark$/);
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT('04-en-dark'), fullPage: true });

  // Arabic + Light
  await page.getByRole('button', { name: /^AR$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  await setTheme(page, /فاتح/);
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT('05-ar-light'), fullPage: true });

  // Arabic + Dark
  await setTheme(page, /داكن/);
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT('06-ar-dark'), fullPage: true });

  // Re-verify the (untouched) toggle still works: OFF->ON->OFF, RTL, currently active language is AR
  const t = page.locator('button[aria-label^="Toggle"], button[aria-label*="تبديل"]').first();
  const wasOn = (await t.getAttribute('class')).includes('bg-mirqab-success');
  await t.click();
  await page.waitForTimeout(500);
  const nowOn = (await t.getAttribute('class')).includes('bg-mirqab-success');
  const flipped = wasOn !== nowOn;
  await t.click(); // restore
  await page.waitForTimeout(500);
  const restoredOn = (await t.getAttribute('class')).includes('bg-mirqab-success');

  await browser.close();
  console.log('toggleStillWorks:', JSON.stringify({ wasOn, nowOn, flipped, restoredCorrectly: restoredOn === wasOn }));
  console.log('consoleErrors:', JSON.stringify(consoleErrors.filter(e => !e.includes('validateDOMNesting') && !e.includes('400')), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
