/**
 * Targeted browser check for the Relevant Evidence "Read more"/"Show less"
 * interaction, against the real running app and real incident data.
 * Reads credentials from env vars so they never appear in this file.
 * SAFETY: read-only navigation/assertions only — no apply/isolate/log-action
 * clicks, no policy toggles.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const CASE_ID = 'INC-20260907-0013'; // real evidence text is 171 chars — just over the 160-char preview threshold

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  if (!email || !password) throw new Error('MIRQAB_QA_EMAIL / MIRQAB_QA_PASSWORD env vars are required');

  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('input[placeholder*="Search by title"]');
  await search.waitFor({ timeout: 15000 });
  await search.fill(CASE_ID);
  await page.getByText(CASE_ID, { exact: false }).first().click();
  await page.waitForSelector(`text=${CASE_ID}`, { timeout: 15000 });
  await page.waitForTimeout(500);

  const report = {};

  // --- Arabic (default) pass ---
  const readMoreBtnAr = page.getByRole('button', { name: 'قراءة المزيد' });
  report.ar_readMoreButtonVisible = await readMoreBtnAr.isVisible().catch(() => false);
  const previewTextAr = await page.locator('p.whitespace-pre-wrap.break-words').first().innerText();
  report.ar_previewEndsWithEllipsis = previewTextAr.endsWith('…');
  report.ar_previewLength = previewTextAr.length;
  report.ar_ariaExpandedBeforeClick = await readMoreBtnAr.getAttribute('aria-expanded');

  await readMoreBtnAr.click();
  await page.waitForTimeout(200);
  const expandedTextAr = await page.locator('p.whitespace-pre-wrap.break-words').first().innerText();
  report.ar_expandedLength = expandedTextAr.length;
  report.ar_expandedTextSnippet = expandedTextAr.slice(0, 60);
  const showLessBtnAr = page.getByRole('button', { name: 'عرض أقل' });
  report.ar_showLessButtonVisibleAfterExpand = await showLessBtnAr.isVisible().catch(() => false);
  report.ar_ariaExpandedAfterClick = await showLessBtnAr.getAttribute('aria-expanded');

  await showLessBtnAr.click();
  await page.waitForTimeout(200);
  const collapsedAgainAr = await page.locator('p.whitespace-pre-wrap.break-words').first().innerText();
  report.ar_collapsesBackToPreview = collapsedAgainAr === previewTextAr;

  // --- Switch to English, reopen same incident ---
  await page.locator('div.glass-panel.fixed').locator('button').first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  const search2 = page.locator('input[placeholder*="Search by title"]');
  await search2.waitFor({ timeout: 15000 });
  await search2.fill(CASE_ID);
  await page.getByText(CASE_ID, { exact: false }).first().click();
  await page.waitForSelector(`text=${CASE_ID}`, { timeout: 15000 });
  await page.waitForTimeout(500);

  const readMoreBtnEn = page.getByRole('button', { name: 'Read more' });
  report.en_readMoreButtonVisible = await readMoreBtnEn.isVisible().catch(() => false);
  const previewTextEn = await page.locator('p.whitespace-pre-wrap.break-words').first().innerText();
  report.en_previewEndsWithEllipsis = previewTextEn.endsWith('…');

  await readMoreBtnEn.click();
  await page.waitForTimeout(200);
  const expandedTextEn = await page.locator('p.whitespace-pre-wrap.break-words').first().innerText();
  report.en_expandedLength = expandedTextEn.length;
  report.en_expandedMatchesArExpanded = expandedTextEn === expandedTextAr;
  const showLessBtnEn = page.getByRole('button', { name: 'Show less' });
  report.en_showLessButtonVisibleAfterExpand = await showLessBtnEn.isVisible().catch(() => false);

  // --- Keyboard accessibility: focus + activate via keyboard alone ---
  await showLessBtnEn.click();
  await page.waitForTimeout(200);
  await readMoreBtnEn.focus();
  report.en_readMoreIsFocusable = await readMoreBtnEn.evaluate((el) => el === document.activeElement);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const expandedViaKeyboard = await page.locator('p.whitespace-pre-wrap.break-words').first().innerText();
  report.en_expandsViaKeyboardEnter = expandedViaKeyboard.length === expandedTextEn.length;

  await page.screenshot({ path: path.join(__dirname, 'screenshots', '06-evidence-expanded-en.png') });

  await browser.close();
  report.consoleErrors = consoleErrors;
  console.log('===EVIDENCE_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===EVIDENCE_CHECK_REPORT_END===');
}

main().catch((err) => {
  console.error('EVIDENCE_CHECK_FAILED:', err);
  process.exit(1);
});
