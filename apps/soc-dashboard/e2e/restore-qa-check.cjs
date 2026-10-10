/**
 * Live Playwright QA against the restored Mirqab backend/database
 * (mirqab-backend-restore-test + mirqab-pg-restore-test, reached through the
 * mirqab-qa-proxy sidecar). Read-only verification only — no isolation, no
 * auto-response, no Suggested Solutions applied, no data mutation.
 *
 * Credentials come from env vars so they never appear in this file or its
 * output. Screenshots are prefixed "restore-qa-" to avoid overwriting any
 * pre-existing e2e screenshots in this directory.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const CASE_LONG = 'INC-20260816-0096'; // 297-char description, has evidence + recommendations + similar history
const CASE_SHORT = 'INC-20260819-0026'; // 84-char description — must NOT show Read More

// Never click any of these, in either language — presentation/read-only only.
const FORBIDDEN_ACTION_TEXT = [
  'Isolate Endpoint',
  'Already Isolated',
  'Confirm isolation succeeded',
  'Mark failed',
  'Collect Evidence',
  'Download Case Report (PDF)',
  'تطبيق الاستجابة الموصى بها',
  'Apply Recommended Response',
  'نعم، طبّق هذه الإجراءات',
  'Yes, apply these actions',
  'نعم، عزل',
  'Yes, isolate',
];

function shot(name) {
  return path.join(SCREENSHOT_DIR, `restore-qa-${name}.png`);
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  if (!email || !password) throw new Error('MIRQAB_QA_EMAIL / MIRQAB_QA_PASSWORD env vars are required');

  const report = { phases: {} };
  const consoleErrors = [];
  const networkIssues = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    networkIssues.push(`FAILED ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) networkIssues.push(`${status} ${res.request().method()} ${res.url()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  async function assertNoForbiddenClicksPossible() {
    // We only ever click by exact accessible name for known-safe controls, so
    // this is a sanity guard: record which forbidden controls are present
    // (informational only — presence is expected/fine, we just must never
    // .click() them).
    const present = [];
    for (const text of FORBIDDEN_ACTION_TEXT) {
      const count = await page.getByText(text, { exact: false }).count();
      if (count > 0) present.push(text);
    }
    return present;
  }

  async function openIncidentByCaseId(caseId) {
    await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
    const search = page.locator('input[placeholder*="Search"]');
    await search.waitFor({ timeout: 15000 });
    await search.fill('');
    await search.fill(caseId);
    await page.waitForTimeout(400);
    const row = page.getByText(caseId, { exact: false }).first();
    await row.waitFor({ timeout: 15000 });
    await row.click();
    await page.waitForSelector(`text=${caseId}`, { timeout: 15000 });
    await page.waitForTimeout(600);
  }

  async function measureLayout(label) {
    const responseBox = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((n) => n.textContent?.includes('Incident Response'));
      const r = h?.closest('.glass-panel')?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right } : null;
    });
    const investigationBox = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((n) => n.textContent?.includes('Incident Investigation'));
      const r = h?.closest('.glass-panel')?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right } : null;
    });
    const sidebarBox = await page.evaluate(() => {
      const r = document.querySelector('aside')?.getBoundingClientRect();
      return r ? { x: r.x, width: r.width, right: r.right } : null;
    });
    const dir = await page.evaluate(() => document.documentElement.dir);
    const viewportWidth = 1600;

    const result = { label, dir, sidebarBox, responseBox, investigationBox };
    if (sidebarBox && responseBox && investigationBox) {
      const sidebarOnRight = sidebarBox.right >= viewportWidth - 5;
      result.sidebarOnRight = sidebarOnRight;
      result.noOverlap = sidebarOnRight
        ? investigationBox.right <= responseBox.x + 1 && responseBox.right <= sidebarBox.x + 1
        : responseBox.right <= investigationBox.x + 1 && investigationBox.right <= sidebarBox.x + 1;
      result.widthsRoughlyEqual = Math.abs(investigationBox.width - responseBox.width) < 5;
      result.heightsRoughlyEqual = Math.abs(investigationBox.height - responseBox.height) < 2;
      result.noHorizontalPageOverflow = null; // filled by caller after evaluate

      if (sidebarOnRight) {
        // RTL expectation: Investigation flush far-left, Response flush against sidebar's left edge.
        result.investigationFlushFarEdge = investigationBox.x <= 20;
        result.responseFlushAgainstSidebar = Math.abs(sidebarBox.x - responseBox.right) <= 20;
        result.gapBetweenPanels = responseBox.x - investigationBox.right;
      } else {
        // LTR expectation: Response flush against sidebar's right edge, Investigation flush far-right.
        result.responseFlushAgainstSidebar = Math.abs(sidebarBox.right - responseBox.x) <= 20;
        result.investigationFlushFarEdge = investigationBox.right >= viewportWidth - 20;
        result.gapBetweenPanels = investigationBox.x - responseBox.right;
      }
      const groupLeft = Math.min(responseBox.x, investigationBox.x);
      const groupRight = Math.max(responseBox.right, investigationBox.right);
      const contentAreaLeft = sidebarOnRight ? 0 : sidebarBox.right;
      const contentAreaRight = sidebarOnRight ? sidebarBox.x : viewportWidth;
      const centerOffset = (groupLeft + groupRight) / 2 - (contentAreaLeft + contentAreaRight) / 2;
      result.groupAppearsCenteredInContentArea = Math.abs(centerOffset) < 20;
    }
    result.noHorizontalPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );
    return result;
  }

  // ============ PHASE 4: AUTHENTICATION ============
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.screenshot({ path: shot('01-login') });
  report.phases.loginPageLoaded = true;

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  report.phases.loginSucceeded = !page.url().includes('/login');
  await page.screenshot({ path: shot('02-dashboard') });

  const authRelatedConsoleErrors = consoleErrors.filter((e) => /auth|401|403|token/i.test(e));
  report.phases.authConsoleErrors = authRelatedConsoleErrors;
  const authNetworkIssues = networkIssues.filter((e) => /\/auth\//.test(e));
  report.phases.unexpectedAuthNetworkIssues = authNetworkIssues;

  const adminRoleVisible = await page.getByText(/admin/i, { exact: false }).count();
  report.phases.adminRoleTextPresentSomewhere = adminRoleVisible > 0;

  // ============ PHASE 5: INCIDENT LIST ============
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const incidentRows = await page.locator('table tbody tr').count();
  report.phases.incidentListRowCount = incidentRows;

  // ============ PHASE 5/6/7: OPEN LONG INCIDENT (Arabic, default) ============
  await openIncidentByCaseId(CASE_LONG);
  report.phases.forbiddenControlsPresent_AR = await assertNoForbiddenClicksPossible();
  await page.screenshot({ path: shot('03-incident-panels-ar'), fullPage: true });

  const layoutAr = await measureLayout('AR (RTL, default)');
  report.phases.layoutAr = layoutAr;

  const bodyTextAr = await page.locator('body').innerText();
  report.phases.responseFields_AR = {
    hasCaseId: bodyTextAr.includes(CASE_LONG),
    hasDeviceLabel: bodyTextAr.includes('Device / Endpoint'),
    hasDepartmentLabel: bodyTextAr.includes('Department'),
    hasUserLabel: bodyTextAr.includes('User'),
    hasDetectionTimeLabel: bodyTextAr.includes('Detection time'),
    hasConfidenceRiskLabel: bodyTextAr.includes('Confidence / Risk'),
    hasResponseActionsLabel: bodyTextAr.includes('Response Actions'),
    hasDownloadCaseReportButton: bodyTextAr.includes('Download Case Report (PDF)'),
    structuralLabelsAreEnglishInArabicMode: bodyTextAr.includes('Case ID') && bodyTextAr.includes('Device / Endpoint'),
  };
  report.phases.investigationSections_AR = {
    hasWhatHappened: bodyTextAr.includes('What Happened'),
    hasAttackProgression: bodyTextAr.includes('Attack progression'),
    hasRelevantEvidence: /Relevant evidence \(\d+\)/.test(bodyTextAr),
    hasSecurityAnalysis: bodyTextAr.includes('Security Analysis'),
    hasAiAnalysis: bodyTextAr.includes('AI analysis'),
    hasSimilarIncidentsHeading: bodyTextAr.includes('الحوادث المشابهة'),
    hasSuggestedSolutionsTitle: bodyTextAr.includes('تحليل — مماثلة لهجوم سابق'),
    hasRecommendationsHeading: bodyTextAr.includes('التوصيات'),
    theseSectionHeadersStayedEnglishInArabicMode:
      bodyTextAr.includes('What Happened') || bodyTextAr.includes('Security Analysis'),
  };
  report.phases.rawKeyLeak_AR = /investigation\.[a-zA-Z]/.test(bodyTextAr);

  // --- Read More on description (long incident) ---
  const readMoreDescAr = page.getByRole('button', { name: 'قراءة المزيد' }).first();
  const hasReadMoreDescAr = (await readMoreDescAr.count()) > 0;
  report.phases.readMoreOnLongDescription_AR = hasReadMoreDescAr;
  if (hasReadMoreDescAr) {
    const before = await page.locator('body').innerText();
    await readMoreDescAr.click();
    await page.waitForTimeout(250);
    const after = await page.locator('body').innerText();
    report.phases.readMoreExpandsContent_AR = after.length > before.length;
    const showLessAr = page.getByRole('button', { name: 'عرض أقل' }).first();
    report.phases.showLessAppearsAfterExpand_AR = (await showLessAr.count()) > 0;
    if ((await showLessAr.count()) > 0) {
      await showLessAr.click();
      await page.waitForTimeout(250);
      const collapsedAgain = await page.locator('body').innerText();
      report.phases.collapsesBackAfterShowLess_AR = collapsedAgain.length < after.length;
    }
  }
  await page.screenshot({ path: shot('03b-suggested-solutions-ar') });

  // ============ PHASE 8: RELEVANT EVIDENCE (Arabic) ============
  const evidenceReadMoreAr = page.getByRole('button', { name: 'قراءة المزيد' });
  const evidenceCountAr = await evidenceReadMoreAr.count();
  report.phases.evidence_AR = { readMoreButtonsFound: evidenceCountAr };
  if (evidenceCountAr > 0) {
    // The last "read more" on the page (after the description one, if that
    // one is still expanded it has become "show less") is evidence's own —
    // use the evidence list item paragraph directly instead for robustness.
    const evidencePara = page.locator('p.whitespace-pre-wrap.break-words').first();
    const previewLen = (await evidencePara.innerText().catch(() => '')).length;
    report.phases.evidence_AR.previewLength = previewLen;
    await evidencePara.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: shot('06-evidence-ar') });
  }

  // ============ PHASE 4 (cont): dashboard KPI / role sanity, already covered ============

  // ============ PHASE 10: SWITCH TO ENGLISH ============
  await page.locator('.glass-panel').first().locator('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^EN$/, exact: true }).click();
  await page.waitForTimeout(500);

  await openIncidentByCaseId(CASE_LONG);
  report.phases.forbiddenControlsPresent_EN = await assertNoForbiddenClicksPossible();
  await page.screenshot({ path: shot('04-incident-panels-en'), fullPage: true });

  const layoutEn = await measureLayout('EN (LTR)');
  report.phases.layoutEn = layoutEn;

  const bodyTextEn = await page.locator('body').innerText();
  report.phases.investigationSections_EN = {
    hasSimilarIncidentsHeading: /similar incidents/i.test(bodyTextEn),
    hasSuggestedSolutionsTitle: bodyTextEn.toLowerCase().includes('analysis — similar to a previous attack'),
    hasRecommendationsHeading: /recommendations/i.test(bodyTextEn),
  };
  report.phases.rawKeyLeak_EN = /investigation\.[a-zA-Z]/.test(bodyTextEn);
  await page.screenshot({ path: shot('04b-suggested-solutions-en') });

  // ============ PHASE 9: SUGGESTED SOLUTIONS (read-only presentation) ============
  const suggestedSolutionsSection = page.locator('section', { hasText: 'Analysis — Similar to a Previous Attack' }).first();
  report.phases.suggestedSolutions_EN = {
    sectionVisible: await suggestedSolutionsSection.isVisible().catch(() => false),
    hasSimilarityPercent: /\d+%/.test(bodyTextEn),
  };
  const recommendationsSection = page.locator('section', { hasText: 'Recommendations' }).last();
  report.phases.recommendations_EN = {
    hasRiskLevelBadgeText: bodyTextEn.includes('Risk level') || bodyTextEn.includes('risk level'),
    hasApprovalRequiredText:
      bodyTextEn.toLowerCase().includes('requires analyst approval') ||
      bodyTextEn.toLowerCase().includes('no approval required'),
    hasConfidenceText: /confidence/i.test(bodyTextEn),
  };

  // ============ PHASE 7 cont: short-description incident, no Read More expected ============
  await openIncidentByCaseId(CASE_SHORT);
  const bodyTextShort = await page.locator('body').innerText();
  const descReadMoreEn = page.getByRole('button', { name: 'Read more' });
  // Heuristic: description itself is short (84 chars raw, well under any
  // reasonable preview threshold), so absence of "Read more" immediately
  // after the "Attack type:" line indicates correct no-truncation behavior.
  // We check the whole-page count only as a secondary signal since evidence
  // on this incident may still legitimately show its own Read more.
  report.phases.shortDescriptionCase = {
    caseId: CASE_SHORT,
    bodyIncludesCaseId: bodyTextShort.includes(CASE_SHORT),
    totalReadMoreButtonsOnPage: await descReadMoreEn.count(),
  };
  await page.screenshot({ path: shot('05-short-description-case-en') });

  // ============ Keyboard Enter check on Read more (reuse CASE_LONG's evidence) ============
  await openIncidentByCaseId(CASE_LONG);
  const readMoreEn = page.getByRole('button', { name: 'Read more' }).first();
  if ((await readMoreEn.count()) > 0) {
    await readMoreEn.focus();
    const isFocused = await readMoreEn.evaluate((el) => el === document.activeElement);
    const beforeKb = await page.locator('body').innerText();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const afterKb = await page.locator('body').innerText();
    report.phases.readMoreKeyboardEnter_EN = {
      wasFocusable: isFocused,
      expandedViaEnter: afterKb.length > beforeKb.length,
    };
  }
  await page.screenshot({ path: shot('06-evidence-expanded-en') });

  // ============ PHASE 5 cont: mobile viewport ============
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  report.phases.mobile = {
    noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  };
  await page.screenshot({ path: shot('08-mobile-layout'), fullPage: true });

  await browser.close();

  report.consoleErrors = consoleErrors;
  report.networkIssues = networkIssues;

  console.log('===RESTORE_QA_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===RESTORE_QA_REPORT_END===');
}

main().catch((err) => {
  console.error('RESTORE_QA_CHECK_FAILED:', err);
  process.exit(1);
});
