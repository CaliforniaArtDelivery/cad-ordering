/**
 * Chad Nov 26 2026 (t2053u–t2056u): conditional weight on Value and care, special-handling
 * disclosure, and a required Yes/No for “I’ve ordered with CAD before?”.
 * Headless Chromium at iPhone width (390×844). Screenshots: /workspace/reviews/weight-conditional-*.png
 *   node scripts/weight-conditional-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright');

const PORT = 4700 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = '/workspace/reviews';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');

const HINT = 'Only for extremely fragile or awkward pieces, ones that can’t stand upright, or ones that may need custom crating.';

(async () => {
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-weight-')), TEST_MODE: '1', BASE_URL: BASE },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const quoteBodies = [];
  page.on('request', (r) => { if (/\/api\/quote$/.test(r.url()) && r.method() === 'POST') { try { quoteBodies.push(JSON.parse(r.postData())); } catch {} } });

  const settle = () => page.waitForFunction(() => !/Updating estimate/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const next = async () => { await settle(); await page.click('#nextBtn', { force: true }); await page.waitForTimeout(350); };
  const panel = () => page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? p.dataset.panel : ''; });
  const need = () => page.evaluate(() => { const n = document.querySelector('#needLine'); return n && !n.hidden ? n.textContent : ''; });
  const fill = (p, v) => page.fill(`[data-path="${p}"]`, String(v));
  const shot = async (n) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
  const start = async () => {
    await page.goto(BASE); await page.evaluate(() => (sessionStorage.clear(), localStorage.clear())); await page.goto(BASE);
    await page.waitForSelector('[data-service]'); await page.click('[data-service="pickup_delivery"]'); await settle(); await next();
  };
  const toCare = async ({ w, h, d = 2, framed = 'no', glass = 'no', desc = 'Canvas' } = {}) => {
    await start();
    await fill('items.0.description', desc); await next();
    await fill('items.0.w', w); await fill('items.0.h', h); await fill('items.0.d', d);
    if (await page.$('[data-seg="items.0.framed"]')) await page.click(`[data-seg="items.0.framed"] [data-v="${framed}"]`);
    if (await page.$('[data-seg="items.0.glazing"]')) await page.click(`[data-seg="items.0.glazing"] [data-v="${glass}"]`);
    if (await page.$('[data-seg="items.0.frameType"]')) await page.click('[data-seg="items.0.frameType"] [data-v="medium"]');
    await next();
    return panel();
  };
  const careText = () => page.textContent('[data-panel="p0c"]');
  const hasWeight = async () => !!(await page.$('[data-panel="p0c"]:not([hidden]) [data-weight="0"]'));

  try {
    hdr('1. 48×60 unframed, no glass: no weight question');
    ok((await toCare({ w: 48, h: 60, framed: 'no', glass: 'no', desc: 'Unframed painting' })) === 'p0c', 'landed on Value and care');
    ok(!(await hasWeight()), '48×60 unframed does not show the weight field, Not sure, or helper');
    ok(!/Approx\. weight|Pounds\. Approximate is fine|No problem, you can skip this|Price may be adjusted once the actual weight/.test(await careText()), 'no weight helper or adjustment copy', await careText());
    await fill('items.0.value', 8000); await settle();
    await shot('weight-conditional-unframed-48x60');
    const last = quoteBodies[quoteBodies.length - 1];
    const it = last && last.items && last.items[0];
    ok(it && !it.weight && !it.weightUnsure, 'quote payload sends blank / not-asked weight for the hidden field', it);

    hdr('2. Special handling disclosure: collapsed by default, new copy, divider, expands');
    ok(await page.isVisible('[data-panel="p0c"] details.handling > summary'), 'Special handling needed row is visible');
    const collapsed = await page.evaluate(() => {
      const d = document.querySelector('[data-panel="p0c"] details.handling');
      const body = d && d.querySelector('.handling-body');
      const cs = d && getComputedStyle(d);
      const bcs = body && getComputedStyle(body);
      const top = cs && cs.borderTopWidth;
      const bot = cs && cs.borderBottomWidth;
      return { open: !!(d && d.open), bodyDisplay: bcs && bcs.display, top, bot, summary: d && d.querySelector('summary') && d.querySelector('summary').textContent.trim() };
    });
    ok(collapsed.open === false, 'disclosure starts collapsed', collapsed);
    ok(!(await page.locator('[data-panel="p0c"] details.handling .handling-body').isVisible()), 'helper and toggle are hidden until the disclosure is opened');
    ok(collapsed.summary === 'Special handling needed', 'summary reads Special handling needed', collapsed.summary);
    ok(collapsed.top === '1px' && collapsed.bot === '1px', 'thin divider above and below the section', collapsed);
    ok(!/I’ve ordered with CAD before/.test(await careText()), 'about-you copy is not on this step');
    await shot('weight-conditional-handling-collapsed');
    await page.click('[data-panel="p0c"] details.handling > summary'); await page.waitForTimeout(150);
    const opened = await page.evaluate(() => {
      const d = document.querySelector('[data-panel="p0c"] details.handling');
      const body = d && d.querySelector('.handling-body');
      const tog = d && d.querySelector('input[data-path="items.0.fragile"]');
      const bcs = body && getComputedStyle(body);
      return { open: !!(d && d.open), bodyDisplay: bcs && bcs.display, checked: !!(tog && tog.checked), text: body && body.innerText };
    });
    ok(opened.open && opened.bodyDisplay !== 'none', 'tapping the row expands the helper and toggle', opened);
    ok(opened.checked === false, 'toggle defaults to off');
    ok(opened.text.includes(HINT), 'expanded helper uses the new copy', opened.text);
    await shot('weight-conditional-handling-expanded');
    await page.click('label.toggle:has([data-path="items.0.fragile"])'); await page.waitForTimeout(200);
    ok((await state()).items[0].fragile === true, 'toggle turns special handling on');
    ok(await page.evaluate(() => { const d = document.querySelector('[data-panel="p0c"] details.handling'); return !!(d && d.open); }), 'stays expanded when the toggle is on');
    ok(await page.isVisible('[data-photoreq="0"]'), 'photo requirement appears when special handling is on');

    hdr('3. 80×40 piece shows the weight question');
    ok((await toCare({ w: 80, h: 40, framed: 'no', glass: 'no', desc: 'Large canvas' })) === 'p0c', '80×40 landed on Value and care');
    ok(await hasWeight(), '80×40 (largest side over 72) shows the weight field');
    ok(/Approx\. weight — Piece 1 \(lb\)/.test(await careText()) && /Pounds\. Approximate is fine/.test(await careText()), 'approx weight label and helper are shown');
    await fill('items.0.value', 8000); await settle();
    await shot('weight-conditional-80x40');

    hdr('4. Framed 64×40 shows the weight question');
    ok((await toCare({ w: 64, h: 40, framed: 'yes', glass: 'no', desc: 'Framed canvas' })) === 'p0c', 'framed 64×40 landed on Value and care');
    ok(await hasWeight(), 'framed 64×40 (framed and over 60) shows the weight field');
    await fill('items.0.value', 8000); await settle();
    await shot('weight-conditional-framed-64x40');

    hdr('5. Boundary cases: 72 unframed hidden; 72 framed shown; 60 framed hidden; 61 framed shown');
    ok((await toCare({ w: 72, h: 40, framed: 'no' })) === 'p0c' && !(await hasWeight()), '72×40 unframed does not ask (not over 72)');
    ok((await toCare({ w: 72, h: 40, framed: 'yes' })) === 'p0c' && (await hasWeight()), '72×40 framed does ask (framed and over 60)');
    ok((await toCare({ w: 60, h: 40, framed: 'yes' })) === 'p0c' && !(await hasWeight()), '60×40 framed does not ask (not over 60)');
    ok((await toCare({ w: 61, h: 40, framed: 'yes' })) === 'p0c' && (await hasWeight()), '61×40 framed does ask');

    hdr('6. A little about you: required Yes/No instead of a default-off toggle');
    await toCare({ w: 48, h: 60, framed: 'no', glass: 'no', desc: 'Unframed painting' });
    await fill('items.0.value', 8000); await settle(); await next();
    ok((await panel()) === 'you', 'one piece continues to Let’s start with you', await panel());
    await fill('contact.name', 'Jordan Lee'); await fill('contact.email', 'jordan@example.com'); await fill('contact.phone', '3105550199');
    await next();
    ok((await panel()) === 'about', 'landed on A little about you', await panel());
    await page.selectOption('[data-path="contact.clientType"]', 'Collector'); await page.waitForTimeout(150);
    ok(!(await page.$('label.toggle:has([data-path="heard.repeatClient"])')), 'the old “I’ve ordered with CAD before” toggle is gone');
    ok(await page.isVisible('[data-seg="heard.repeatAnswer"]'), 'Yes/No pills are on the step');
    const unselected = await page.evaluate(() => ({
      on: [...document.querySelectorAll('[data-seg="heard.repeatAnswer"] button.on')].map((b) => b.dataset.v),
      source: !!document.querySelector('#f-heard\\.source'),
      welcome: /Welcome back/.test((document.querySelector('[data-panel="about"]') || {}).innerText || ''),
    }));
    ok(unselected.on.length === 0, 'neither Yes nor No is selected by default', unselected);
    ok(!unselected.source && !unselected.welcome, 'hear-about-us and Welcome back are hidden until a choice is made', unselected);
    const needUnselected = await need();
    ok(/I’ve ordered with CAD before\?/.test(needUnselected) || /ordered with CAD before/.test(needUnselected), 'fields-left names the Yes/No question', needUnselected);
    await shot('weight-conditional-about-unselected');

    await page.click('[data-seg="heard.repeatAnswer"] [data-v="yes"]'); await page.waitForTimeout(200);
    const yesState = await page.evaluate(() => ({
      on: [...document.querySelectorAll('[data-seg="heard.repeatAnswer"] button.on')].map((b) => b.dataset.v),
      source: !!document.querySelector('#f-heard\\.source'),
      welcome: /Welcome back/.test((document.querySelector('[data-panel="about"]') || {}).innerText || ''),
      need: (() => { const n = document.querySelector('#needLine'); return n && !n.hidden ? n.textContent : ''; })(),
      repeatClient: (JSON.parse(localStorage.getItem('cad-order') || '{}').heard || {}).repeatClient,
      repeatAnswer: (JSON.parse(localStorage.getItem('cad-order') || '{}').heard || {}).repeatAnswer,
    }));
    ok(yesState.on.join() === 'yes' && yesState.welcome, 'Yes shows Welcome back.', yesState);
    ok(!yesState.source, 'Yes hides How did you hear about us?');
    ok(!yesState.need, 'Yes clears the fields-left counter for this question (step can proceed once other fields are done)', yesState.need);
    ok(yesState.repeatClient === true && yesState.repeatAnswer === 'yes', 'payload flag repeatClient is true for a returning customer', yesState);
    await shot('weight-conditional-about-yes');

    await page.click('[data-seg="heard.repeatAnswer"] [data-v="no"]'); await page.waitForTimeout(200);
    const noState = await page.evaluate(() => ({
      on: [...document.querySelectorAll('[data-seg="heard.repeatAnswer"] button.on')].map((b) => b.dataset.v),
      source: !!document.querySelector('#f-heard\\.source'),
      required: !!document.querySelector('#f-heard\\.source') && /Required/.test((document.querySelector('label[for="f-heard.source"]') || {}).textContent || ''),
      welcome: /Welcome back/.test((document.querySelector('[data-panel="about"]') || {}).innerText || ''),
      need: (() => { const n = document.querySelector('#needLine'); return n && !n.hidden ? n.textContent : ''; })(),
      repeatClient: (JSON.parse(localStorage.getItem('cad-order') || '{}').heard || {}).repeatClient,
      repeatAnswer: (JSON.parse(localStorage.getItem('cad-order') || '{}').heard || {}).repeatAnswer,
    }));
    ok(noState.on.join() === 'no' && noState.source && noState.required, 'No reveals How did you hear about us? Required', noState);
    ok(!noState.welcome, 'Welcome back is not shown for No');
    ok(/How did you hear about us/.test(noState.need), 'fields-left asks for the referral source after No', noState.need);
    ok(noState.repeatClient === false && noState.repeatAnswer === 'no', 'payload flag repeatClient is false for a new customer', noState);
    await shot('weight-conditional-about-no');
    await page.selectOption('[data-path="heard.source"]', 'google'); await page.waitForTimeout(200);
    ok(!(await need()) || !/hear about us/.test(await need()), 'choosing a source clears the hear-about-us gap', await need());

    ok(pageErrors.length === 0, 'no page errors', pageErrors);
  } catch (e) {
    fail++;
    console.log('  FAIL: uncaught', e && e.stack || e);
    try { await shot('weight-conditional-error'); } catch {}
  } finally {
    await browser.close();
    child.kill();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
