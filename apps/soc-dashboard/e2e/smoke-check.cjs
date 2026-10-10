/**
 * One-off manual browser smoke check for the Suggested Solutions / AI
 * Auto-Response feature. Not a permanent CI test — a disposable script for
 * this QA pass. Reads credentials from env vars (MIRQAB_QA_EMAIL /
 * MIRQAB_QA_PASSWORD) so they never appear in this file or its diff.
 *
 * SAFETY: never clicks "Apply Suggested Solutions" / "Isolate Endpoint" /
 * "Log action" or any policy toggle — read-only navigation and assertions
 * only.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const FORBIDDEN_SELECTORS_TEXT = [
  'تطبيق الحلول المقترحة',
  'Apply Suggested Solutions',
  'تطبيق الاستجابة الموصى بها',
  'Apply Recommended Response',
  'نعم، طبّق هذه الإجراءات',
  'Yes, apply these actions',
  'Yes, isolate this endpoint',
  'نعم، عزل',
];

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  if (!email || !password) {
    throw new Error('MIRQAB_QA_EMAIL / MIRQAB_QA_PASSWORD env vars are required');
  }

  const consoleErrors = [];
  const networkErrors = [];
  const report = {};

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    networkErrors.push(`FAILED ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) {
      networkErrors.push(`${status} ${res.request().method()} ${res.url()}`);
    }
  });

  // --- A. Application availability ---
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-login.png') });
  report.loginPageLoaded = true;

  // --- B. Authentication ---
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|alerts)?$/, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  report.loggedIn = !page.url().includes('/login');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-post-login.png') });

  async function guardAgainstForbiddenClicks() {
    for (const text of FORBIDDEN_SELECTORS_TEXT) {
      const count = await page.getByText(text, { exact: false }).count();
      if (count > 0) report[`forbidden_text_present__${text}`] = true;
    }
  }

  async function openIncidentByCaseId(caseId) {
    await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
    const search = page.locator('input[placeholder*="Search by title"]');
    await search.waitFor({ timeout: 15000 });
    await search.fill(caseId);
    const row = page.getByText(caseId, { exact: false }).first();
    await row.waitFor({ timeout: 15000 });
    await row.click();
    // Panel is real data — wait for the case id to also appear inside the
    // panel itself (mono <dd>), proving the investigation payload loaded.
    await page.waitForSelector(`text=${caseId}`, { timeout: 15000 });
    await page.waitForTimeout(500); // let the investigation query settle
  }

  // --- C/D/E. INC2 — DISABLE_ACCOUNT recommended, real Suggested Solutions data ---
  const CASE_INC2 = 'INC-20260907-0013';
  await openIncidentByCaseId(CASE_INC2);
  await guardAgainstForbiddenClicks();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-inc2-panel-ar.png'), fullPage: true });
  // Scroll the panel's own internal overflow (fixed element, not page
  // scroll) down to the Suggested Solutions card specifically.
  await page
    .getByText('تحليل — مماثلة لهجوم سابق')
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03b-inc2-suggested-solutions-ar.png') });

  const bodyTextAr = await page.locator('body').innerText();
  report.inc2_ar = {
    hasSuggestedSolutionsTitle: bodyTextAr.includes('تحليل — مماثلة لهجوم سابق'),
    hasSimilarityLabel: bodyTextAr.includes('تشابه مع حادث سابق'),
    hasPreviousCaseLabel: bodyTextAr.includes('الحادثة السابقة') || bodyTextAr.includes('INC-20260816-0072'),
    hasInsufficientHistoricalData: bodyTextAr.includes('بيانات تاريخية غير كافية'),
    hasDisableAccountLabel: bodyTextAr.includes('تعطيل الحساب'),
    hasApplyButtonText: bodyTextAr.includes('تطبيق الحلول المقترحة') || bodyTextAr.includes('تطبيق الاستجابة الموصى بها'),
    hasRawKeyLeak: /investigation\.[a-zA-Z]/.test(bodyTextAr),
    dir: await page.evaluate(() => document.documentElement.dir),
  };

  // --- G. Language toggle: AR -> EN ---
  // Close the panel first — it's a `fixed` overlay that sits above the
  // Topbar's language button at this viewport size, so it must be
  // dismissed before that button is clickable (a real user would do the
  // same to reach the topbar while the panel is open).
  await page.locator('div.glass-panel.fixed').locator('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(500);
  // Reopen the same incident to see it rendered in English.
  await openIncidentByCaseId(CASE_INC2);
  await guardAgainstForbiddenClicks();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-inc2-panel-en.png'), fullPage: true });
  await page
    .getByText('Analysis — Similar to a Previous Attack', { exact: false })
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04b-inc2-suggested-solutions-en.png') });
  // Section headers use an `uppercase` CSS class and Badge text uses a
  // `capitalize` CSS class (both pre-existing, reused as-is) — Playwright's
  // innerText() reflects the visually-rendered (transformed) case, so
  // checks below are case-insensitive on purpose, not a leniency hack.
  const bodyTextEn = await page.locator('body').innerText();
  const bodyTextEnLower = bodyTextEn.toLowerCase();
  report.inc2_en = {
    hasSuggestedSolutionsTitle: bodyTextEnLower.includes('analysis — similar to a previous attack'),
    hasSimilarityLabel: bodyTextEnLower.includes('similarity to a previous incident'),
    hasInsufficientHistoricalData: bodyTextEnLower.includes('insufficient historical data'),
    hasDisableAccountLabel: bodyTextEnLower.includes('disable account'),
    hasApplyButtonText:
      bodyTextEnLower.includes('apply suggested solutions') ||
      bodyTextEnLower.includes('apply recommended response'),
    hasRawKeyLeak: /investigation\.[a-zA-Z]/.test(bodyTextEn),
    dir: await page.evaluate(() => document.documentElement.dir),
  };
  await guardAgainstForbiddenClicks();

  // --- F. Refresh persistence check ---
  // What IS checkable live: the language preference (real localStorage,
  // not app-memory-only) and the recommendation data survive a hard reload
  // unchanged — i.e. nothing is fabricated fresh per-render. The 5-minute
  // response window's server-computed deadline is covered by
  // response-sla.service.spec.ts and e2e/response-window-check.cjs.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const langAfterReload = await page.evaluate(() => document.documentElement.lang);
  await openIncidentByCaseId(CASE_INC2);
  const bodyTextAfterReloadLower = (await page.locator('body').innerText()).toLowerCase();
  report.afterReload = {
    languageStillEnglish: langAfterReload === 'en',
    recommendationDataUnchanged:
      bodyTextAfterReloadLower.includes('disable account') &&
      bodyTextAfterReloadLower.includes('insufficient historical data'),
    hasRawKeyLeak: /investigation\.[a-zA-Z]/.test(bodyTextAfterReloadLower),
  };

  // --- E. INC1 — ALREADY_ACTIONED, must show no misleading timer ---
  // topMatch IS real here (82% similarity) but has zero successful actions,
  // and recommendations[] is empty — so the honest text is
  // noActionsRecorded, NOT the "no comparable history at all" noHistory
  // text (that only applies when topMatch itself is null).
  const CASE_INC1 = 'INC-20260909-0021';
  await openIncidentByCaseId(CASE_INC1);
  await guardAgainstForbiddenClicks();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-inc1-panel-en.png'), fullPage: true });
  const bodyTextInc1Lower = (await page.locator('body').innerText()).toLowerCase();
  report.inc1_en = {
    hasRealTopMatchCaseId: bodyTextInc1Lower.includes('inc-20260816-0050'),
    hasNoActionsRecordedMessage: bodyTextInc1Lower.includes('no response action was recorded'),
    hasTimeRemainingLabel_mustBeFalse: bodyTextInc1Lower.includes('time remaining'),
    hasRawKeyLeak: /investigation\.[a-zA-Z]/.test(bodyTextInc1Lower),
  };

  await browser.close();

  report.consoleErrors = consoleErrors;
  report.networkErrors = networkErrors;
  console.log('===MIRQAB_QA_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===MIRQAB_QA_REPORT_END===');
}

main().catch((err) => {
  console.error('SMOKE_CHECK_FAILED:', err);
  process.exit(1);
});
