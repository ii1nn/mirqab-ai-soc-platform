const { chromium } = require('@playwright/test');
const BASE_URL = 'http://localhost:5173';

function parseColor(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
}
function relLum({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
function contrastRatio(c1, c2) {
  const l1 = relLum(c1) + 0.05;
  const l2 = relLum(c2) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}
// Composite a (possibly translucent) color onto an OPAQUE backdrop.
function flatten(fg, backdrop) {
  const a = fg.a;
  return {
    r: fg.r * a + backdrop.r * (1 - a),
    g: fg.g * a + backdrop.g * (1 - a),
    b: fg.b * a + backdrop.b * (1 - a),
  };
}
// fgStr/bgStr are raw CSS color strings (possibly rgba); backdropChain composites
// each in order onto pageBg first, so every comparison uses fully-opaque colors.
function contrastAgainstPage(fgStr, bgChainStrs, pageBg) {
  let backdrop = pageBg;
  for (const s of bgChainStrs) {
    const c = parseColor(s);
    if (!c || c.a === 0) continue;
    backdrop = flatten(c, backdrop);
  }
  const fg = parseColor(fgStr);
  const flatFg = flatten(fg, backdrop);
  return contrastRatio(flatFg, backdrop).toFixed(2);
}

async function auditTheme(page, themeName, radioName) {
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name: radioName }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const pageBgStr = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const pageBg = parseColor(pageBgStr);

  const data = await page.evaluate(() => {
    function styleOf(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    }
    const cards = [...document.querySelectorAll('.glass-card')];
    const card = cards[0];
    const title = card ? card.querySelector('h3') : null;
    const category = card ? card.querySelector('p.uppercase') : null;
    const paragraphs = card ? [...card.querySelectorAll('p')] : [];
    const description = paragraphs.find((p) => !p.className.includes('uppercase') && !p.textContent.includes('Updated') && !p.textContent.includes('تحديث'));
    const timestamp = paragraphs.find((p) => p.textContent.includes('Updated') || p.textContent.includes('تحديث'));
    const complianceLabel = card ? [...card.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Compliance' || s.textContent.includes('الالتزام') || s.textContent.includes('امتثال')) : null;

    // Find a definitively ON and a definitively OFF toggle by actual class,
    // not by label text (robust regardless of language/content).
    const allToggles = [...document.querySelectorAll('button[aria-label^="Toggle"], button[aria-label*="تبديل"]')];
    const onToggle = allToggles.find((b) => b.className.includes('bg-mirqab-success'));
    const offToggle = allToggles.find((b) => !b.className.includes('bg-mirqab-success'));
    const progressTrack = card ? card.querySelector('.h-1\\.5.w-full') : null;

    return {
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      title: styleOf(title),
      category: styleOf(category),
      description: styleOf(description),
      timestamp: styleOf(timestamp),
      complianceLabel: styleOf(complianceLabel),
      onTrack: styleOf(onToggle),
      offTrack: styleOf(offToggle),
      onKnob: onToggle ? styleOf(onToggle.querySelector('span')) : null,
      offKnob: offToggle ? styleOf(offToggle.querySelector('span')) : null,
      progressTrack: styleOf(progressTrack),
    };
  });

  console.log(`\n=== ${themeName} ===`);
  console.log('page bg:', pageBgStr);
  console.log('card bg (raw):', data.cardBg);

  const results = {};
  if (data.title) results.titleVsCard = contrastAgainstPage(data.title.color, [data.cardBg], pageBg);
  if (data.category) results.categoryVsCard = contrastAgainstPage(data.category.color, [data.cardBg], pageBg);
  if (data.description) results.descriptionVsCard = contrastAgainstPage(data.description.color, [data.cardBg], pageBg);
  if (data.timestamp) results.timestampVsCard = contrastAgainstPage(data.timestamp.color, [data.cardBg], pageBg);
  if (data.complianceLabel) results.complianceLabelVsCard = contrastAgainstPage(data.complianceLabel.color, [data.cardBg], pageBg);
  if (data.offTrack) results.offTrackVsCard = contrastAgainstPage(data.offTrack.bg, [data.cardBg], pageBg);
  if (data.offKnob && data.offTrack) results.offKnobVsOffTrack = contrastAgainstPage(data.offKnob.bg, [data.cardBg, data.offTrack.bg], pageBg);
  if (data.onKnob && data.onTrack) results.onKnobVsOnTrack = contrastAgainstPage(data.onKnob.bg, [data.cardBg, data.onTrack.bg], pageBg);
  if (data.progressTrack) results.progressTrackVsCard = contrastAgainstPage(data.progressTrack.bg, [data.cardBg], pageBg);

  console.log('raw styles:', JSON.stringify(data, null, 2));
  console.log('contrast ratios (WCAG AA needs >=4.5 for normal text, >=3 for large text/UI components):');
  console.log(JSON.stringify(results, null, 2));
  return results;
}

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
  await page.waitForTimeout(1000);

  await auditTheme(page, 'LIGHT', /^(Light|فاتح)$/);
  await auditTheme(page, 'DARK', /^(Dark|داكن)$/);

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
