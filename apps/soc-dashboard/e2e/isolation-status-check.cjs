/**
 * Verifies the corrected isolation status messaging against real, already-
 * existing pending IncidentAction rows — no isolation is requested, no
 * button that triggers a real action is ever clicked. Read-only navigation
 * and text assertions only.
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

  async function openIncidentByCaseId(caseId) {
    await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
    const search = page.locator('input[placeholder*="Search by title"]');
    await search.waitFor({ timeout: 15000 });
    await search.fill(caseId);
    await page.getByText(caseId, { exact: false }).first().click();
    await page.waitForSelector(`text=${caseId}`, { timeout: 15000 });
    await page.waitForTimeout(500);
  }

  const report = {};

  // --- INC-20260906-0004: real PENDING_APPROVAL ISOLATE_DEVICE action (Arabic, default) ---
  await openIncidentByCaseId('INC-20260906-0004');
  await page.waitForTimeout(1000);
  const bodyText1ar = await page.locator('body').innerText();
  report.pendingApproval_ar = {
    showsAwaitingApprovalText: bodyText1ar.includes(
      'بانتظار موافقة المحلل قبل المتابعة',
    ),
    showsIncorrectNoIntegrationClaim: bodyText1ar.includes(
      'لا يوجد تكامل آلي للتحكم بنقطة النهاية مُهيّأ',
    ),
    showsConfirmMarkFailedButtons: (await page.getByText('Confirm isolation succeeded').count()) > 0,
  };
  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '07-isolation-pending-approval-ar.png'),
  });

  // Switch to English and recheck the same incident
  await page.locator('div.glass-panel.fixed').locator('button').first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(300);
  await openIncidentByCaseId('INC-20260906-0004');
  const bodyText1en = await page.locator('body').innerText();
  report.pendingApproval_en = {
    showsAwaitingApprovalText: bodyText1en.includes(
      'awaiting analyst approval before it can proceed',
    ),
    showsIncorrectNoIntegrationClaim: bodyText1en
      .toLowerCase()
      .includes('no automated endpoint-control integration is configured'),
    showsConfirmMarkFailedButtons: (await page.getByText('Confirm isolation succeeded').count()) > 0,
  };
  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '07b-isolation-pending-approval-en.png'),
  });

  // --- INC-20260910-0002: real NOT_REQUIRED PENDING (genuine no-integration case), English ---
  await openIncidentByCaseId('INC-20260910-0002');
  const bodyText2en = await page.locator('body').innerText();
  report.manualPendingNoIntegration_en = {
    showsPendingHeading: bodyText2en.includes('Isolation pending confirmation'),
    showsManualRequiredText: bodyText2en.includes(
      'No automated endpoint-control integration is configured',
    ),
    showsConfirmMarkFailedButtons: (await page.getByText('Confirm isolation succeeded').count()) > 0,
  };
  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '08-isolation-manual-pending-en.png'),
  });

  await browser.close();
  console.log('===ISOLATION_STATUS_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===ISOLATION_STATUS_CHECK_REPORT_END===');
}

main().catch((err) => {
  console.error('ISOLATION_STATUS_CHECK_FAILED:', err);
  process.exit(1);
});
