/**
 * SUPERSEDED by e2e/response-window-check.cjs — this script screenshots the
 * removed severity-SLA ResponseTimer ("due in"/"overdue by"). Kept only for
 * history; its text heuristics no longer match the 5-minute response
 * window card.
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';
const SHOT = (n) => path.join(__dirname, 'screenshots', `response-timer-${n}.png`);

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
async function readTimerText(page) {
  return page.evaluate(() => {
    const timerIcons = [...document.querySelectorAll('svg')];
    // Grab the whole Response Actions-adjacent timer box by looking for
    // "RESPONSE OVERDUE"/"RESPONSE DUE"/"RESPONDED"/"SLA"/"CLOSED" text.
    const candidates = [...document.querySelectorAll('div')].filter((el) => {
      const txt = el.textContent || '';
      return (
        el.children.length <= 4 &&
        (txt.includes('OVERDUE') || txt.includes('DUE') || txt.includes('RESPONDED') || txt.includes('SLA') || txt.includes('window closed'))
      );
    });
    return candidates.map((el) => el.textContent.trim()).slice(0, 3);
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
  await setTheme(page, /^(Dark|داكن)$/);
  await setLang(page, /^EN$/);

  const results = {};

  // A/B: open, MEDIUM severity (not auto-response-eligible, so it stays
  // stable across the backend's real 30s sweep), overdue, no ack —
  // created Sep 6, same age as the original bug report's incident.
  await openIncident(page, 'INC-20260906-0003');
  results.overdueTimerText = await readTimerText(page);
  await page.screenshot({ path: SHOT('01-overdue-en-dark'), fullPage: true });

  // C: acknowledged incident
  await openIncident(page, 'INC-20260816-0074');
  results.acknowledgedTimerText = await readTimerText(page);
  await page.screenshot({ path: SHOT('02-acknowledged-en-dark'), fullPage: true });

  // D: resolved/closed incident
  await openIncident(page, 'INC-20260816-0092');
  results.resolvedTimerText = await readTimerText(page);
  await page.screenshot({ path: SHOT('03-resolved-en-dark'), fullPage: true });

  // Light theme, same overdue incident
  await setTheme(page, /^Light$/);
  await openIncident(page, 'INC-20260906-0004');
  await page.screenshot({ path: SHOT('04-overdue-en-light'), fullPage: true });

  // Arabic + Light
  await setLang(page, /^AR$/);
  await openIncident(page, 'INC-20260906-0004');
  results.overdueTimerTextAr = await readTimerText(page);
  await page.screenshot({ path: SHOT('05-overdue-ar-light'), fullPage: true });

  // Arabic + Dark
  await setTheme(page, /داكن/);
  await openIncident(page, 'INC-20260906-0004');
  await page.screenshot({ path: SHOT('06-overdue-ar-dark'), fullPage: true });

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  console.log('consoleErrors:', JSON.stringify(consoleErrors.filter(e => !e.includes('validateDOMNesting') && !e.includes('400')), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
