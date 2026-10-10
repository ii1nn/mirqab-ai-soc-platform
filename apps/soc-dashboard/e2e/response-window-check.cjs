/**
 * 5-minute response window — UI verification (EN/AR, LTR/RTL, dark/light).
 *
 * Logs in to the REAL running app and loads a REAL incident's history from
 * the backend, then injects each backend-authoritative `response` state via
 * Playwright route interception, so every state the backend can report is
 * rendered deterministically without waiting 5 minutes and WITHOUT ever
 * triggering containment:
 *   - POST /ai/incidents/:id/acknowledge is answered by the interceptor
 *     (never reaches the backend);
 *   - every POST to /ai/incidents/:id/actions (isolation etc.) is ABORTED
 *     and counted — the run fails if any is attempted.
 *
 * Env: MIRQAB_QA_EMAIL, MIRQAB_QA_PASSWORD, MIRQAB_QA_INCIDENT_ID (a real id).
 * Exit code 1 on any failed assertion.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const SHOT = (name) => path.join(__dirname, 'screenshots', `response-window-${name}.png`);
const WINDOW_MS = 300_000;

const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
}

function responseFor(state, base) {
  const now = new Date();
  const created = new Date(base.detectedAt);
  const common = {
    windowMs: WINDOW_MS,
    applicable: true,
    detectedAt: base.detectedAt,
    deadline: new Date(created.getTime() + WINDOW_MS).toISOString(),
    serverNow: now.toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    respondedInMs: null,
    respondedWithinWindow: null,
    containment: null,
    automatedContainment: { policyEnabled: true, providerAvailable: true, eligible: false, blockedReason: 'WINDOW_OPEN' },
  };
  const containment = (outcome, detail) => ({
    actionId: '00000000-0000-0000-0000-00000000a001',
    outcome,
    automated: true,
    performedBy: 'system:automated-containment',
    requestedAt: now.toISOString(),
    completedAt: outcome === 'PENDING' ? null : now.toISOString(),
    detail,
  });
  switch (state) {
    case 'waiting':
      return { ...common, state: 'WAITING_RESPONSE', remainingMs: 299_000 };
    case 'waiting-no-provider':
      return {
        ...common,
        state: 'WAITING_RESPONSE',
        remainingMs: 45_000,
        automatedContainment: { ...common.automatedContainment, providerAvailable: false },
      };
    case 'expired':
      return {
        ...common,
        state: 'WINDOW_EXPIRED',
        remainingMs: -10_000,
        automatedContainment: { policyEnabled: true, providerAvailable: false, eligible: false, blockedReason: 'PROVIDER_UNAVAILABLE' },
      };
    case 'acknowledged':
      return {
        ...common,
        state: 'ACKNOWLEDGED',
        remainingMs: 120_000,
        acknowledgedAt: new Date(created.getTime() + 134_000).toISOString(),
        acknowledgedBy: 'tech@mirqab.local',
        respondedInMs: 134_000,
        respondedWithinWindow: true,
        automatedContainment: { ...common.automatedContainment, blockedReason: 'NOT_OPEN' },
      };
    case 'pending':
      return { ...common, state: 'CONTAINMENT_PENDING', remainingMs: -60_000, containment: containment('PENDING', 'Automated containment: awaiting provider result.') };
    case 'succeeded':
      return { ...common, state: 'CONTAINMENT_SUCCEEDED', remainingMs: -60_000, containment: containment('SUCCESS', 'Agent "IT-WKS-01" confirmed it executed the isolation script.') };
    case 'failed':
      return { ...common, state: 'CONTAINMENT_FAILED', remainingMs: -60_000, containment: containment('FAILED', 'fetch failed') };
    case 'succeeded-then-ack':
      return {
        ...responseFor('succeeded', base),
        acknowledgedAt: now.toISOString(),
        acknowledgedBy: 'tech@mirqab.local',
        respondedInMs: 600_000,
        respondedWithinWindow: false,
      };
    default:
      throw new Error(state);
  }
}

async function main() {
  const email = process.env.MIRQAB_QA_EMAIL;
  const password = process.env.MIRQAB_QA_PASSWORD;
  const incidentId = process.env.MIRQAB_QA_INCIDENT_ID;
  if (!email || !password || !incidentId) {
    throw new Error('MIRQAB_QA_EMAIL / MIRQAB_QA_PASSWORD / MIRQAB_QA_INCIDENT_ID are required');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  // ---- Safety net: no containment/response action can ever reach the backend.
  const blockedActionPosts = [];
  await page.route(/\/api\/v1\/ai\/incidents\/[^/]+\/(actions|apply-recommended)/, (route) => {
    if (route.request().method() !== 'GET') {
      blockedActionPosts.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });

  // ---- Response-state injection on top of the REAL history payload.
  let currentState = 'waiting';
  let realHistory = null;
  const acknowledgePosts = [];
  await page.route(new RegExp(`/api/v1/ai/incidents/${incidentId}/history$`), async (route) => {
    if (!realHistory) {
      const response = await route.fetch();
      realHistory = await response.json();
    }
    const body = { ...realHistory, response: responseFor(currentState, realHistory) };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(new RegExp(`/api/v1/ai/incidents/${incidentId}/acknowledge$`), async (route) => {
    acknowledgePosts.push(route.request().method());
    currentState = 'acknowledged';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ alreadyAcknowledged: false, response: responseFor('acknowledged', realHistory) }),
    });
  });

  async function setPrefs(language, theme) {
    await page.evaluate(
      ([lang, th]) => {
        localStorage.setItem('mirqab.language', lang);
        localStorage.setItem('mirqab.theme', th);
      },
      [language, theme],
    );
  }
  async function openIncident(state) {
    currentState = state;
    await page.goto(`${BASE_URL}/alerts?incidentId=${incidentId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="response-window"]', { timeout: 20000 });
    await page.waitForTimeout(600);
  }
  const card = () => page.locator('[data-testid="response-window"]');
  // textContent, not innerText: headings use CSS `uppercase`, which
  // innerText applies — the assertions check the real rendered strings.
  const cardText = async () => ((await card().textContent()) ?? '').replace(/\s+/g, ' ');
  const noHugeMinutes = (text) => !/\b\d{3,}:\d{2}\b/.test(text) && !/\d+d \d+h/.test(text);

  // ---- Login (real backend).
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  for (const [language, theme] of [
    ['en', 'dark'],
    ['en', 'light'],
    ['ar', 'dark'],
    ['ar', 'light'],
  ]) {
    await setPrefs(language, theme);
    const tag = `${language}-${theme}`;
    const en = language === 'en';

    await openIncident('waiting');
    const htmlDir = await page.evaluate(() => document.documentElement.dir);
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(`[${tag}] document direction is ${en ? 'ltr' : 'rtl'}`, htmlDir === (en ? 'ltr' : 'rtl'), htmlDir);
    check(`[${tag}] theme applied`, dataTheme === theme, dataTheme);

    let text = await cardText();
    check(`[${tag}] waiting: state attribute`, (await card().getAttribute('data-state')) === 'waiting-response');
    check(
      `[${tag}] waiting: "Response required" heading`,
      text.includes(en ? 'Response required' : 'الاستجابة مطلوبة'),
      text,
    );
    const countdown = await card().locator('bdi[dir="ltr"]').first().innerText();
    check(`[${tag}] waiting: MM:SS countdown starts at 04:59 or 04:58`, /^04:5[89]$/.test(countdown), countdown);
    check(`[${tag}] waiting: countdown is bidi-isolated LTR`, (await card().locator('bdi[dir="ltr"]').count()) > 0);
    check(
      `[${tag}] waiting: Acknowledge & Investigate button`,
      text.includes(en ? 'Acknowledge & Investigate' : 'إقرار وبدء التحقيق'),
    );
    check(`[${tag}] waiting: Review Incident button`, text.includes(en ? 'Review Incident' : 'مراجعة الحادثة'));
    check(`[${tag}] waiting: no huge raw minute values`, noHugeMinutes(text), text);
    await page.screenshot({ path: SHOT(`01-waiting-${tag}`) });

    await page.waitForTimeout(2200);
    const later = await card().locator('bdi[dir="ltr"]').first().innerText();
    check(`[${tag}] countdown ticks down (${countdown} → ${later})`, later < countdown, `${countdown} -> ${later}`);

    await openIncident('waiting-no-provider');
    text = await cardText();
    check(
      `[${tag}] waiting (no provider): 00:4x remaining + "unavailable" notice`,
      /00:4\d/.test(text) &&
        text.includes(en ? 'no endpoint-control provider configured' : 'لم يتم تكوين موفّر للتحكم في نقاط النهاية'),
      text,
    );

    await openIncident('expired');
    text = await cardText();
    check(`[${tag}] expired: state attribute`, (await card().getAttribute('data-state')) === 'window-expired');
    check(
      `[${tag}] expired: "Response window expired"`,
      text.includes(en ? 'Response window expired' : 'انتهت مهلة الاستجابة'),
      text,
    );
    check(`[${tag}] expired: shows 00:00, never a negative/huge value`, text.includes('00:00') && noHugeMinutes(text), text);
    await page.screenshot({ path: SHOT(`02-expired-${tag}`) });

    await openIncident('acknowledged');
    text = await cardText();
    check(`[${tag}] acknowledged: "Response received"`, text.includes(en ? 'Response received' : 'تم استلام الاستجابة'), text);
    check(`[${tag}] acknowledged: "Responded in 2m 14s"`, text.includes('2m 14s'), text);
    check(`[${tag}] acknowledged: actor shown`, text.includes('tech@mirqab.local'), text);
    check(
      `[${tag}] acknowledged: no automatic containment`,
      text.includes(en ? 'No automatic containment will be initiated.' : 'لن يتم بدء أي احتواء آلي.'),
      text,
    );
    check(
      `[${tag}] acknowledged: no acknowledge button any more`,
      !text.includes(en ? 'Acknowledge & Investigate' : 'إقرار وبدء التحقيق'),
    );
    await page.screenshot({ path: SHOT(`03-acknowledged-${tag}`) });

    for (const [state, statusText] of [
      ['pending', en ? 'Pending — awaiting verification' : 'قيد الانتظار'],
      ['succeeded', en ? 'Succeeded — verified' : 'نجح'],
      ['failed', en ? 'Failed' : 'فشل'],
    ]) {
      await openIncident(state);
      text = await cardText();
      const status = await page.locator('[data-testid="containment-status"]').innerText();
      check(`[${tag}] containment ${state}: "Containment triggered"`, text.includes(en ? 'Containment triggered' : 'تم تفعيل الاحتواء'), text);
      check(
        `[${tag}] containment ${state}: 5-minute reason`,
        text.includes(en ? 'no response was received within 5 minutes' : 'لم تتم أي استجابة خلال 5 دقائق'),
      );
      check(`[${tag}] containment ${state}: status "${statusText}"`, status.includes(statusText), status);
      if (state === 'pending') {
        check(`[${tag}] containment pending: never claims success`, !/Succeeded|نجح/.test(status), status);
      }
      if (state === 'failed') {
        check(`[${tag}] containment failed: real reason shown`, text.includes('fetch failed'), text);
      }
      await page.screenshot({ path: SHOT(`04-containment-${state}-${tag}`) });
    }

    await openIncident('succeeded-then-ack');
    text = await cardText();
    check(
      `[${tag}] late acknowledgement after successful containment: "already completed", no reversal`,
      text.includes(en ? 'Device isolation was already completed.' : 'تم إكمال عزل الجهاز بالفعل.') &&
        (await card().getAttribute('data-state')) === 'containment-succeeded',
      text,
    );
  }

  // ---- Acknowledge click flow (EN/dark): the interceptor answers the POST.
  await setPrefs('en', 'dark');
  await openIncident('waiting');
  await card().getByRole('button', { name: 'Acknowledge & Investigate' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="response-window"]')?.getAttribute('data-state') === 'acknowledged',
    null,
    { timeout: 10000 },
  );
  check('acknowledge click → POST /acknowledge sent once', acknowledgePosts.length === 1, JSON.stringify(acknowledgePosts));
  check('acknowledge click → card re-renders from backend state as acknowledged', true);
  await page.screenshot({ path: SHOT('05-after-acknowledge-click-en-dark') });

  // ---- Notifications page (structured, bilingual rendering).
  const deadline = new Date(Date.now() + 200_000).toISOString();
  const incidentBlock = {
    id: incidentId,
    caseId: 'INC-20260926-0001',
    title: 'Data Encrypted for Impact detected',
    severity: 'CRITICAL',
    deviceName: 'IT-WKS-01',
    departmentName: 'IT Operations',
    detectedAt: new Date(Date.now() - 100_000).toISOString(),
    responseDeadline: deadline,
    acknowledgedAt: null,
  };
  await page.route(/\/api\/v1\/notifications$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        serverNow: new Date().toISOString(),
        items: [
          { id: 'n1', kind: 'RESPONSE_REQUIRED', containmentResult: null, audience: 'ANALYST', createdAt: new Date().toISOString(), fallbackTitle: 'mirqab:response-required', fallbackBody: 'x', incident: incidentBlock },
          { id: 'n2', kind: 'CONTAINMENT_RESULT', containmentResult: 'FAILED', audience: 'ANALYST', createdAt: new Date().toISOString(), fallbackTitle: 'mirqab:containment:FAILED', fallbackBody: 'Reason: fetch failed', incident: { ...incidentBlock, responseDeadline: new Date(Date.now() - 1000).toISOString() } },
          { id: 'n3', kind: 'LEGACY', containmentResult: null, audience: 'ANALYST', createdAt: new Date(Date.now() - 86_400_000).toISOString(), fallbackTitle: 'New high severity incident', fallbackBody: 'T1486 Data Encrypted for Impact detected. Ticket auto-created.', incident: incidentBlock },
        ],
      }),
    }),
  );
  for (const [language, theme] of [
    ['en', 'dark'],
    ['ar', 'light'],
  ]) {
    await setPrefs(language, theme);
    const en = language === 'en';
    await page.goto(`${BASE_URL}/notifications`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="response-notifications"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    const text = (await page.locator('[data-testid="response-notifications"]').innerText()).replace(/\s+/g, ' ');
    check(
      `[notifications ${language}-${theme}] response-required rendered in ${language}`,
      text.includes(en ? 'Security incident detected on' : 'تم اكتشاف حادثة أمنية على الجهاز') && text.includes('IT-WKS-01'),
      text,
    );
    check(`[notifications ${language}-${theme}] live remaining MM:SS`, /0[23]:\d{2}/.test(text), text);
    check(
      `[notifications ${language}-${theme}] containment FAILED rendered in ${language}`,
      text.includes(en ? 'Automatic containment was attempted but did not succeed.' : 'تمت محاولة الاحتواء الآلي لكنها لم تنجح.'),
      text,
    );
    check(`[notifications ${language}-${theme}] legacy text shown as-is`, text.includes('New high severity incident'), text);
    check(`[notifications ${language}-${theme}] Case ID bidi-isolated`, (await page.locator('[data-testid="response-notifications"] bdi[dir="ltr"]', { hasText: 'INC-20260926-0001' }).count()) > 0);
    await page.screenshot({ path: SHOT(`06-notifications-${language}-${theme}`), fullPage: true });
  }

  check('SAFETY: no isolation/response-action POST was attempted', blockedActionPosts.length === 0, JSON.stringify(blockedActionPosts));
  const relevantErrors = consoleErrors.filter(
    (e) => !e.includes('validateDOMNesting') && !e.includes('Failed to load resource'),
  );
  check('no unexpected console errors', relevantErrors.length === 0, JSON.stringify(relevantErrors.slice(0, 5)));

  await browser.close();
  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
