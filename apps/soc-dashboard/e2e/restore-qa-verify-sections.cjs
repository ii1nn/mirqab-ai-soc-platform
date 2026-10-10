const { chromium } = require('@playwright/test');
const BASE_URL = 'http://localhost:5173';
const CASE_LONG = 'INC-20260816-0096';

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('input[placeholder*="Search"]');
  await search.waitFor({ timeout: 15000 });
  await search.fill(CASE_LONG);
  await page.waitForTimeout(400);
  await page.getByText(CASE_LONG, { exact: false }).first().click();
  await page.waitForSelector(`text=${CASE_LONG}`, { timeout: 15000 });
  await page.waitForTimeout(600);

  const bodyTextArLower = (await page.locator('body').innerText()).toLowerCase();
  const arChecks = {
    hasResponseActions: bodyTextArLower.includes('response actions'),
    hasWhatHappened: bodyTextArLower.includes('what happened'),
    hasAttackProgression: bodyTextArLower.includes('attack progression'),
    hasRelevantEvidence: /relevant evidence \(\d+\)/.test(bodyTextArLower),
    hasSecurityAnalysis: bodyTextArLower.includes('security analysis'),
    hasAiAnalysis: bodyTextArLower.includes('ai analysis'),
    hasCaseIdLabel: bodyTextArLower.includes('case id'),
    hasDeviceEndpointLabel: bodyTextArLower.includes('device / endpoint'),
    documentDir: await page.evaluate(() => document.documentElement.dir),
  };
  console.log('AR (uppercase-corrected):', JSON.stringify(arChecks, null, 2));

  // Switch to English and re-check the SAME headers are identical strings (confirms hardcoded, not translated)
  await page.locator('.glass-panel').first().locator('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^EN$/, exact: true }).click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await search.waitFor({ timeout: 15000 });
  await search.fill(CASE_LONG);
  await page.waitForTimeout(400);
  await page.getByText(CASE_LONG, { exact: false }).first().click();
  await page.waitForSelector(`text=${CASE_LONG}`, { timeout: 15000 });
  await page.waitForTimeout(600);

  const bodyTextEnLower = (await page.locator('body').innerText()).toLowerCase();
  const enChecks = {
    hasResponseActions: bodyTextEnLower.includes('response actions'),
    hasWhatHappened: bodyTextEnLower.includes('what happened'),
    hasAttackProgression: bodyTextEnLower.includes('attack progression'),
    hasRelevantEvidence: /relevant evidence \(\d+\)/.test(bodyTextEnLower),
    hasSecurityAnalysis: bodyTextEnLower.includes('security analysis'),
    hasAiAnalysis: bodyTextEnLower.includes('ai analysis'),
    documentDir: await page.evaluate(() => document.documentElement.dir),
  };
  console.log('EN:', JSON.stringify(enChecks, null, 2));

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
