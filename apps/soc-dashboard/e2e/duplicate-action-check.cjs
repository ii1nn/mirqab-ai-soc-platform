/**
 * Verifies the Suggested Solutions historical section no longer duplicates
 * the actionable "Apply" affordance already present in the Recommendations
 * section, against real, already-existing incident data. Read-only
 * navigation and text/element assertions only — no action-triggering
 * button is ever clicked.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const CASE_ID = 'INC-20260907-0013'; // real: historical DISABLE_ACCOUNT success + current DISABLE_ACCOUNT recommendation

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

  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(300);

  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('input[placeholder*="Search by title"]');
  await search.waitFor({ timeout: 15000 });
  await search.fill(CASE_ID);
  await page.getByText(CASE_ID, { exact: false }).first().click();
  await page.waitForSelector(`text=${CASE_ID}`, { timeout: 15000 });
  await page.waitForTimeout(1000);

  const bodyText = await page.locator('body').innerText();

  const report = {
    // Exactly one Apply button anywhere in the panel now.
    applyRecommendedButtonCount: await page.getByText('Apply Recommended Response', { exact: false }).count(),
    oldSuggestedSolutionsApplyButtonGone:
      (await page.getByText('Apply Suggested Solutions', { exact: false }).count()) === 0,
    showsHistoricalNote: bodyText.includes(
      'These are actions that were recorded/succeeded in similar past incidents',
    ),
    showsCurrentRecommendationNote: bodyText.includes(
      'This is a recommendation for the current incident and can be applied once the required approval is granted',
    ),
    // Both the historical checklist entry and the current recommendation
    // entry for Disable account should still both be visible (real data
    // preserved) — just only one of them is actionable.
    disableAccountMentionCount: (bodyText.match(/Disable account/g) || []).length,
    // Badge component applies a `capitalize` CSS class (pre-existing,
    // unrelated to this change) — innerText reflects the visually rendered
    // case, so this check is intentionally case-insensitive.
    showsRiskConfidenceApproval:
      bodyText.toLowerCase().includes('risk level') &&
      bodyText.toLowerCase().includes('requires analyst approval'),
  };

  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '11-no-duplicate-actionable.png'),
    fullPage: true,
  });

  await browser.close();
  console.log('===DUPLICATE_ACTION_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===DUPLICATE_ACTION_CHECK_REPORT_END===');
}

main().catch((err) => {
  console.error('DUPLICATE_ACTION_CHECK_FAILED:', err);
  process.exit(1);
});
