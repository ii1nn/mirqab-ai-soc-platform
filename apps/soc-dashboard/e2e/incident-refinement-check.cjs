const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `refine-${n}.png`);

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
async function openIncident(page, caseId) {
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const search = page.locator('input[placeholder*="Search"]');
  await search.waitFor({ timeout: 15000 });
  await search.fill(caseId);
  await page.waitForTimeout(400);
  await page.getByText(caseId, { exact: false }).first().click();
  await page.waitForSelector(`text=${caseId}`, { timeout: 15000 });
  await page.waitForTimeout(700);
}

async function geometry(page) {
  return page.evaluate(() => {
    const backdrop = document.querySelector('[aria-hidden="true"].backdrop-blur-sm');
    const h2s = [...document.querySelectorAll('h2')];
    const responseH2 = h2s.find((h) => h.textContent?.includes('Incident Response'));
    const investigationH2 = h2s.find((h) => h.textContent?.includes('Incident Investigation'));
    const responsePanel = responseH2?.closest('.glass-panel');
    const investigationPanel = investigationH2?.closest('.glass-panel');
    function box(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
    const backdropCs = backdrop ? getComputedStyle(backdrop) : null;
    return {
      backdrop: box(backdrop),
      backdropBg: backdropCs ? backdropCs.backgroundColor : null,
      backdropFilter: backdropCs ? (backdropCs.backdropFilter || backdropCs.webkitBackdropFilter) : null,
      response: box(responsePanel),
      investigation: box(investigationPanel),
      viewportHeight: window.innerHeight,
      dir: document.documentElement.dir,
      pointerEventsCheck: responsePanel ? getComputedStyle(responsePanel).pointerEvents : null,
    };
  });
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const CASE_ID = 'INC-20260816-0096';
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await login(page, email, password);
  const results = {};

  // English + Dark
  await setTheme(page, /^(Dark|داكن)$/);
  await setLang(page, /^EN$/);
  await openIncident(page, CASE_ID);
  await page.screenshot({ path: SHOT('01-en-dark'), fullPage: true });
  results.enDark = await geometry(page);

  // click inside response panel -> should stay open
  await page.getByText('Case ID', { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  results.enDark.stillOpenAfterPanelClick = await page.getByText('Incident Response', { exact: false }).isVisible().catch(() => false);

  // English + Light
  await setTheme(page, /^(Light|فاتح)$/);
  await openIncident(page, CASE_ID);
  await page.screenshot({ path: SHOT('02-en-light'), fullPage: true });
  results.enLight = await geometry(page);

  // Arabic + Light
  await setLang(page, /^AR$/);
  await openIncident(page, CASE_ID);
  await page.screenshot({ path: SHOT('03-ar-light'), fullPage: true });
  results.arLight = await geometry(page);

  // Arabic + Dark
  await setTheme(page, /داكن/);
  await openIncident(page, CASE_ID);
  await page.screenshot({ path: SHOT('04-ar-dark'), fullPage: true });
  results.arDark = await geometry(page);

  results.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT('05-mobile'), fullPage: true });
  results.mobileNoOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  console.log('consoleErrors:', JSON.stringify(consoleErrors.filter(e => !e.includes('validateDOMNesting') && !e.includes('400')), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
