const { chromium } = require('@playwright/test');
const path = require('path');
const BASE_URL = 'http://localhost:5173';

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

// Returns { trackBox, knobBox, knobCenterFrac } — knobCenterFrac is 0..1,
// the knob's center position as a fraction of the track's width (0 = start
// edge, 1 = end edge) — direction-agnostic so LTR/RTL compare the same way.
async function readToggleGeometry(page, toggleButton) {
  const knob = toggleButton.locator('span').first();
  const trackBox = await toggleButton.boundingBox();
  const knobBox = await knob.boundingBox();
  const knobCenterFrac = (knobBox.x + knobBox.width / 2 - trackBox.x) / trackBox.width;
  return { trackBox, knobBox, knobCenterFrac };
}

async function testDirection(page, label, langButtonRegex) {
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const toggleButtons = page.locator('button[aria-label^="Toggle"]');
  const first = toggleButtons.first();
  await first.waitFor({ timeout: 10000 });

  const before = await readToggleGeometry(page, first);
  const wasEnabled = (await first.getAttribute('class')).includes('bg-mirqab-success');

  await first.click();
  await page.waitForTimeout(600); // wait for mutation + transition

  const after = await readToggleGeometry(page, first);
  const nowEnabled = (await first.getAttribute('class')).includes('bg-mirqab-success');

  const report = {
    label,
    wasEnabled,
    nowEnabled,
    stateFlipped: wasEnabled !== nowEnabled,
    beforeKnobFrac: before.knobCenterFrac.toFixed(2),
    afterKnobFrac: after.knobCenterFrac.toFixed(2),
    knobCrossedToOppositeSide: Math.abs(before.knobCenterFrac - after.knobCenterFrac) > 0.4,
    knobOnCorrectSideAfterClick:
      nowEnabled ? after.knobCenterFrac > 0.5 : after.knobCenterFrac < 0.5,
  };

  // refresh and confirm knob position matches the persisted (backend) state
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const afterRefresh = await readToggleGeometry(page, page.locator('button[aria-label^="Toggle"]').first());
  const stillEnabled = (await page.locator('button[aria-label^="Toggle"]').first().getAttribute('class')).includes('bg-mirqab-success');
  report.persistsAfterRefresh = {
    stillEnabled,
    knobFrac: afterRefresh.knobCenterFrac.toFixed(2),
    knobOnCorrectSide: stillEnabled ? afterRefresh.knobCenterFrac > 0.5 : afterRefresh.knobCenterFrac < 0.5,
  };

  // click again to restore original state (don't leave persisted test side effects)
  await page.locator('button[aria-label^="Toggle"]').first().click();
  await page.waitForTimeout(600);

  return report;
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await login(page, email, password);

  const results = {};

  // English + Dark
  await setTheme(page, /^(Dark|داكن)$/);
  await page.getByRole('button', { name: /^EN$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  results.englishDark = await testDirection(page, 'English + Dark (LTR)');

  // English + Light
  await setTheme(page, /^Light$/);
  results.englishLight = await testDirection(page, 'English + Light (LTR)');

  // Arabic + Light
  await page.getByRole('button', { name: /^AR$/, exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  results.arabicLight = await testDirection(page, 'Arabic + Light (RTL)');

  // Arabic + Dark
  await setTheme(page, /داكن/);
  results.arabicDark = await testDirection(page, 'Arabic + Dark (RTL)');

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
