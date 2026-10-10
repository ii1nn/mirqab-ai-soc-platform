/**
 * Verifies the two distinct Suggested Solutions empty-state messages against
 * real, already-existing incident data. Read-only navigation and text
 * assertions only — no action-triggering buttons are clicked.
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
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Switch to English for a stable, unambiguous text check.
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(300);

  async function openIncidentByCaseId(caseId) {
    await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
    const search = page.locator('input[placeholder*="Search by title"]');
    await search.waitFor({ timeout: 15000 });
    await search.fill(caseId);
    await page.getByText(caseId, { exact: false }).first().click();
    await page.waitForSelector(`text=${caseId}`, { timeout: 15000 });
    await page.waitForTimeout(1000);
  }

  const report = {};

  // --- Group 2: real topMatch (82% similarity), zero recommendations ---
  await openIncidentByCaseId('INC-20260909-0021');
  const bodyText1 = await page.locator('body').innerText();
  report.group2_noRecommendationHistory = {
    showsCase1Message: bodyText1.includes(
      'Similar incidents were found, but there is not enough recorded successful response history',
    ),
    showsCase2Message: bodyText1.includes('No comparable incidents are available'),
    showsRealSimilarityPercent: bodyText1.includes('82%'),
    showsApplyButton: (await page.getByText('Apply Suggested Solutions').count()) > 0,
  };
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '09-empty-state-case1.png') });

  // --- Group 1: real topMatch + real recommendation (DISABLE_ACCOUNT) — must be unaffected ---
  await openIncidentByCaseId('INC-20260907-0013');
  const bodyText2 = await page.locator('body').innerText();
  report.group1_hasRecommendation = {
    showsCase1Message: bodyText2.includes(
      'Similar incidents were found, but there is not enough recorded successful response history',
    ),
    showsApplyButton: (await page.getByText('Apply Suggested Solutions').count()) > 0,
    showsDisableAccount: bodyText2.includes('Disable account'),
  };
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '10-still-has-recommendation.png') });

  await browser.close();
  console.log('===EMPTY_STATE_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===EMPTY_STATE_CHECK_REPORT_END===');
}

main().catch((err) => {
  console.error('EMPTY_STATE_CHECK_FAILED:', err);
  process.exit(1);
});
