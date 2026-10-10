/**
 * Verifies that "Apply Recommended Response" for a real ISOLATE_DEVICE
 * recommendation routes into the EXISTING isolation confirmation modal
 * ("Confirm isolation") instead of the generic apply-recommended modal —
 * and that Cancel closes it without any mutation. Also verifies a DIFFERENT
 * incident with a non-isolate recommendation still uses the original
 * generic flow, unaffected.
 *
 * SAFETY: never clicks "Yes, isolate this endpoint" (the real confirm
 * button) or any other action-triggering control — only opens/inspects/
 * cancels. Read-only otherwise.
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

  // --- Real incident: single ISOLATE_DEVICE recommendation (10% confidence, "1 of 10") ---
  await openIncidentByCaseId('INC-20260907-0002');

  // Historical "Succeeded in N of M" text is present and purely informational.
  const bodyBefore = await page.locator('body').innerText();
  report.historicalTextPresentBeforeClick = /Succeeded in \d+ of \d+ attempt/.test(bodyBefore);
  report.noFailedTextBeforeAnyClick = !bodyBefore.includes('Isolation failed');

  // Count IncidentAction-ish rows in the response log before clicking, to
  // later confirm no duplicate was created.
  const responseLogCountBefore = (bodyBefore.match(/Isolate device/g) || []).length;

  await page.getByRole('button', { name: 'Apply Recommended Response' }).click();
  await page.waitForTimeout(400);

  report.isolateConfirmModalOpened = (await page.getByText('Confirm isolation', { exact: false }).count()) > 0;
  report.genericApplyModalDidNotOpen =
    (await page.getByText('Confirm recommended response', { exact: false }).count()) === 0;
  report.confirmIsolationButtonVisible =
    (await page.getByRole('button', { name: /yes, isolate this endpoint/i }).count()) > 0;

  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '12-isolate-recommendation-routes-to-real-confirm.png'),
  });

  // Cancel — must close without any mutation.
  const cancelButtons = page.getByRole('button', { name: 'Cancel', exact: true });
  const cancelCount = await cancelButtons.count();
  console.log('DEBUG cancel button count:', cancelCount);
  await cancelButtons.last().click();
  await page.waitForTimeout(1200);
  const confirmIsolationCountAfterCancel = await page
    .getByText('Confirm isolation', { exact: false })
    .count();
  console.log('DEBUG "Confirm isolation" text count after cancel click:', confirmIsolationCountAfterCancel);
  report.modalClosedAfterCancel = confirmIsolationCountAfterCancel === 0;

  const bodyAfterCancel = await page.locator('body').innerText();
  const responseLogCountAfter = (bodyAfterCancel.match(/Isolate device/g) || []).length;
  report.noDuplicateActionCreated = responseLogCountAfter === responseLogCountBefore;
  report.stillNoFailedTextAfterCancel = !bodyAfterCancel.includes('Isolation failed');

  // --- Different incident: DISABLE_ACCOUNT recommendation — must use the ORIGINAL generic flow unaffected ---
  await openIncidentByCaseId('INC-20260907-0013');
  await page.getByRole('button', { name: 'Apply Recommended Response' }).click();
  await page.waitForTimeout(400);
  report.disableAccount_genericModalOpened =
    (await page.getByText('Confirm recommended response', { exact: false }).count()) > 0;
  report.disableAccount_isolateModalDidNotOpen =
    (await page.getByRole('button', { name: /yes, isolate this endpoint/i }).count()) === 0;
  await page.getByRole('button', { name: 'Cancel' }).click();

  await browser.close();
  console.log('===ISOLATE_ROUTING_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===ISOLATE_ROUTING_CHECK_REPORT_END===');
}

main().catch((err) => {
  console.error('ISOLATE_ROUTING_CHECK_FAILED:', err);
  process.exit(1);
});
