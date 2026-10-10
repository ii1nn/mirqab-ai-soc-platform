/**
 * Read-only browser verification for the compact Incident Response /
 * Incident Investigation two-window layout refinement. Logs in, opens a
 * real incident, and checks: panel widths/positions (compact, non-
 * overlapping, Investigation left / Response right), Read more/Show less
 * behavior on a real long-text field, and topbar clearance. No security
 * actions are triggered.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const EMAIL = process.env.MIRQAB_EMAIL;
const PASSWORD = process.env.MIRQAB_PASSWORD;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('validateDOMNesting')) consoleErrors.push(msg.text());
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  await page.goto(`${BASE_URL}/alerts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const search = page.locator('input[placeholder*="Search"]');
  await search.waitFor({ timeout: 15000 });
  await search.fill('INC-20260919-0001');
  await page.waitForTimeout(500);

  const report = {};
  const rowCount = await page.locator('table tbody tr').count();
  report.incidentRowsFound = rowCount;

  if (rowCount > 0) {
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(1500);

    // Locate the two window headers and measure their bounding boxes.
    const responseHeader = page.getByText('Incident Response', { exact: false }).first();
    const investigationHeader = page.getByText('Incident Investigation', { exact: false }).first();
    await responseHeader.waitFor({ timeout: 10000 });
    await investigationHeader.waitFor({ timeout: 10000 });

    // Walk up to each window's outer glass-panel box for real dimensions.
    const responseBox = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((n) => n.textContent?.includes('Incident Response'));
      const panel = h?.closest('.glass-panel');
      const r = panel?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right } : null;
    });
    const investigationBox = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((n) => n.textContent?.includes('Incident Investigation'));
      const panel = h?.closest('.glass-panel');
      const r = panel?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right } : null;
    });

    const sidebarBox = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const r = aside?.getBoundingClientRect();
      return r ? { x: r.x, width: r.width, right: r.right } : null;
    });

    report.sidebarBox = sidebarBox;
    report.responseBox = responseBox;
    report.investigationBox = investigationBox;
    report.investigationIsLeftOfResponse = investigationBox && responseBox ? investigationBox.x < responseBox.x : null;
    report.noHorizontalOverlap =
      investigationBox && responseBox ? investigationBox.right <= responseBox.x + 1 : null;
    report.widthsRoughlyEqual =
      investigationBox && responseBox ? Math.abs(investigationBox.width - responseBox.width) < 5 : null;
    report.heightsEqual =
      investigationBox && responseBox ? Math.abs(investigationBox.height - responseBox.height) < 2 : null;
    report.viewportWidth = 1600;
    report.noHorizontalPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );

    // Neither panel should touch/overlap the sidebar, and neither should be
    // flush against the far viewport edge opposite the sidebar either — the
    // pair should sit centered inside the leftover content area.
    if (sidebarBox && responseBox && investigationBox) {
      const groupLeft = Math.min(responseBox.x, investigationBox.x);
      const groupRight = Math.max(responseBox.right, investigationBox.right);
      const sidebarOnRight = sidebarBox.right >= 1600 - 5;
      const clearsSidebar = sidebarOnRight
        ? groupRight <= sidebarBox.x + 1 // sidebar on the right (RTL)
        : groupLeft >= sidebarBox.right - 1; // sidebar on the left (LTR)
      report.groupClearsSidebar = clearsSidebar;
      report.gapLeftOfGroup = groupLeft;
      report.gapRightOfGroupToViewportEdge = 1600 - groupRight;
      const contentAreaLeft = sidebarBox.right <= 5 ? sidebarBox.right : 0;
      const contentAreaRight = sidebarBox.right <= 5 ? 1600 : sidebarBox.x;
      const contentAreaWidth = contentAreaRight - contentAreaLeft;
      const groupCenterOffsetFromContentCenter =
        (groupLeft + groupRight) / 2 - (contentAreaLeft + contentAreaRight) / 2;
      report.groupRoughlyCenteredInContentArea = Math.abs(groupCenterOffsetFromContentCenter) < 20;
    }

    await page.screenshot({ path: path.join(__dirname, 'screenshots', '25-centered-two-window-ar.png') });

    // Switch to English and re-measure — sidebar flips to the left, so the
    // content-area math (and therefore the group's centering) must flip too.
    const enToggle = page.getByRole('button', { name: 'EN', exact: true });
    report.topbarLangToggleClickable = await enToggle.isVisible().catch(() => false);
    await enToggle.click();
    await page.waitForTimeout(400);

    const responseBoxEn = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((n) => n.textContent?.includes('Incident Response'));
      const r = h?.closest('.glass-panel')?.getBoundingClientRect();
      return r ? { x: r.x, right: r.right } : null;
    });
    const investigationBoxEn = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((n) => n.textContent?.includes('Incident Investigation'));
      const r = h?.closest('.glass-panel')?.getBoundingClientRect();
      return r ? { x: r.x, right: r.right } : null;
    });
    const sidebarBoxEn = await page.evaluate(() => {
      const r = document.querySelector('aside')?.getBoundingClientRect();
      return r ? { x: r.x, right: r.right } : null;
    });
    report.en = { responseBoxEn, investigationBoxEn, sidebarBoxEn };
    if (sidebarBoxEn && responseBoxEn && investigationBoxEn) {
      report.en.investigationIsLeftOfResponse = investigationBoxEn.x < responseBoxEn.x;
      const groupLeft = Math.min(responseBoxEn.x, investigationBoxEn.x);
      const groupRight = Math.max(responseBoxEn.right, investigationBoxEn.right);
      const sidebarOnLeft = sidebarBoxEn.x <= 5;
      report.en.groupClearsSidebar = sidebarOnLeft
        ? groupLeft >= sidebarBoxEn.right - 1
        : groupRight <= sidebarBoxEn.x + 1;
      const contentAreaLeft = sidebarOnLeft ? sidebarBoxEn.right : 0;
      const contentAreaRight = sidebarOnLeft ? 1600 : sidebarBoxEn.x;
      report.en.groupRoughlyCenteredInContentArea =
        Math.abs((groupLeft + groupRight) / 2 - (contentAreaLeft + contentAreaRight) / 2) < 20;
    }
    await page.screenshot({ path: path.join(__dirname, 'screenshots', '26-centered-two-window-en.png') });

    // Read more / Show less check on the main description (real data,
    // long enough to truncate for the phishing test incident used here).
    const readMoreBtn = page.getByRole('button', { name: 'Read more', exact: true }).first();
    report.readMoreButtonFound = (await readMoreBtn.count()) > 0;
    if (report.readMoreButtonFound) {
      const beforeText = await page.locator('body').innerText();
      await readMoreBtn.click();
      await page.waitForTimeout(200);
      const afterText = await page.locator('body').innerText();
      report.expandedTextIsLonger = afterText.length > beforeText.length;
      report.showLessButtonAppeared = (await page.getByRole('button', { name: 'Show less', exact: true }).count()) > 0;
      await page.screenshot({ path: path.join(__dirname, 'screenshots', '23-read-more-expanded.png') });

      const showLessBtn = page.getByRole('button', { name: 'Show less', exact: true }).first();
      await showLessBtn.click();
      await page.waitForTimeout(200);
      report.collapsedAgain = (await page.getByRole('button', { name: 'Read more', exact: true }).count()) > 0;
    }

    // Mobile stacked check.
    await page.setViewportSize({ width: 500, height: 900 });
    await page.waitForTimeout(500);
    report.mobileNoHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );
    await page.screenshot({
      path: path.join(__dirname, 'screenshots', '24-compact-stacked-mobile.png'),
      fullPage: true,
    });
  }

  report.consoleErrors = consoleErrors;

  await browser.close();
  console.log('===TWO_WINDOW_CHECK_REPORT_START===');
  console.log(JSON.stringify(report, null, 2));
  console.log('===TWO_WINDOW_CHECK_REPORT_END===');
}

main().catch((err) => {
  console.error('TWO_WINDOW_CHECK_FAILED:', err);
  process.exit(1);
});
