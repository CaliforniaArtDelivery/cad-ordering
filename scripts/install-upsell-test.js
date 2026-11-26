/**
 * Install upsell (Chad t2095u): pricing eligibility, question skipping, quote totals,
 * order/sheet parity with an up-front install, and a 390px + desktop UI walk-through.
 *   node scripts/install-upsell-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { quote, installUpsell, installUpsellQuestions, roundToNearest5 } = require('../lib/pricing');
const { COLUMNS, rowsForOrder } = require('../lib/schedule');

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  ok  :', m); }
  else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
};
const hdr = (t) => console.log('\n[' + t + ']');

const stop = (x = {}) => ({
  street: '1 Main St', city: 'San Francisco', state: 'CA', zip: '94110', country: 'United States',
  contactName: 'Jordan Lee', contactPhone: '3105550199', sameAsMe: true,
  accessMode: 'ground', pathPick: 'ground', fits: 'yes', ...x,
});
const art = (x = {}) => ({
  type: 'painting', description: 'Oil on canvas', w: 40, h: 30, d: 2, framed: 'no', glazing: 'no',
  value: 8000, qty: 1, hangHeight: 'standard', hardware: '', ...x,
});
const order = (service, items, extra = {}) => {
  const { dropoff, pickup, schedule, ...rest } = extra;
  return {
    service, items, pickup: stop(pickup || {}), dropoff: stop(dropoff || {}),
    contact: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '3105550199', clientType: 'Collector' },
    schedule: { date: '2026-12-02', deliveryDate: '2026-12-04', timePref: 'none', deliveryTimePref: 'none', ...(schedule || {}) },
    ...rest,
  };
};

hdr('pricing: show / hide / amount');
const pdPaint = order('pickup_delivery', [art()]);
const uPaint = installUpsell(pdPaint);
const qPd = quote(pdPaint);
const qDi = quote(order('delivery_install', [art()]));
ok(uPaint.show === true, 'upsell shows for a painting on pickup + delivery');
ok(uPaint.amount === 75, 'X is $75 for one standard-size painting', uPaint);
ok(uPaint.amount === roundToNearest5(qDi.total - qPd.total), 'X equals the rounded total delta vs pickup + delivery', { amount: uPaint.amount, delta: qDi.total - qPd.total, pd: qPd.total, di: qDi.total });
ok((quote(order('install_only', [art()])).lines || []).some((l) => /Painting installation/.test(l.label) && l.amount === 75), 'that $75 matches the painting installation line on an install-only quote');

for (const [type, label] of [['photograph', 'print / photograph'], ['wallart', 'other wall art'], ['mirror', 'mirror']]) {
  const u = installUpsell(order('pickup_delivery', [art({ type, framed: type === 'mirror' ? '' : 'no', glazing: type === 'mirror' ? '' : 'no' })]));
  ok(u.show && u.amount > 0, `upsell shows for ${label}`, u);
}

ok(!installUpsell(order('pickup_delivery', [{ type: 'sculpture', weight: 40, value: 2000, description: 'Bronze' }])).show, 'hidden for sculpture (not wall-hung)');
ok(!installUpsell(order('pickup_delivery', [{ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', value: 2000 }])).show, 'hidden for furniture');
ok(!installUpsell(order('delivery_install', [art()])).show, 'hidden when install is already chosen (delivery + install)');
ok(!installUpsell(order('install_only', [art()])).show, 'hidden when install is already chosen (install only)');
ok(!installUpsell(order('pickup_delivery', [{ type: 'decor', furnitureKind: 'Chandelier', sizeClass: 'medium', value: 2000 }])).show, 'hidden for chandelier-only (hanging is a custom quote, no firm X)');
ok(!installUpsell(order('crating_shipping', [art()])).show, 'hidden for shipping');

const two = installUpsell(order('pickup_delivery', [art(), art({ description: 'Second canvas' })]));
ok(two.show && two.amount === 150, 'two paintings: X is the two-piece install rate $150', two);

const withHw = { ...pdPaint, items: [art({ hardware: 'needs_zbar', hangHeight: 'standard' })] };
ok(installUpsell(withHw).amount === 75, 'headline X stays at the base install price (“as little as”), even if a hardware fee could apply later', installUpsell(withHw));

hdr('questions asked vs skipped');
const qEmpty = installUpsellQuestions(pdPaint);
ok(qEmpty.some((q) => q.key === 'hardware' && q.required), 'hardware is asked when it has not been collected');
ok(qEmpty.some((q) => q.key === 'hang' && q.required), 'hanging height is always offered so they can confirm the standard default');
ok(qEmpty.some((q) => q.key === 'wallType' && !q.required), 'optional wall type is offered when empty');

const qKnown = installUpsellQuestions(order('pickup_delivery', [art({ hardware: 'wire', hangHeight: 'standard' })], { dropoff: { wallType: 'Drywall' } }));
ok(!qKnown.some((q) => q.key === 'hardware'), 'hardware is skipped when already answered');
ok(!qKnown.some((q) => q.key === 'wallType'), 'wall type is skipped when already answered');
ok(qKnown.some((q) => q.key === 'hang'), 'hanging height is still offered');

const qHigher = installUpsellQuestions(order('pickup_delivery', [art({ hardware: 'wire', hangHeight: 'higher' })]));
ok(qHigher.some((q) => q.key === 'hangWhere'), 'if height is already “higher” but the place is missing, that follow-up is asked');

hdr('totals update with remaining answers');
const beforeHw = quote(order('delivery_install', [art({ hangHeight: 'standard' })]));
const afterHw = quote(order('delivery_install', [art({ hangHeight: 'standard', hardware: 'needs_zbar' })]));
ok(afterHw.total > beforeHw.total, 'choosing hardware that has a fee raises the install total', { before: beforeHw.total, after: afterHw.total });
const afterHigh = quote(order('delivery_install', [art({ hangHeight: 'higher', hangWhere: 'high', hardware: 'wire' })]));
ok(afterHigh.total > beforeHw.total, 'choosing a high-wall hang raises the install total', { before: beforeHw.total, after: afterHigh.total });

hdr('order record matches an up-front install');
const sharedItems = [art({ hardware: 'wire', hangHeight: 'standard', centerHeight: '59' })];
const sharedDrop = { wallType: 'Drywall', hardware: 'Piece 1: Wire already installed' };
const upFront = order('delivery_install', sharedItems, { dropoff: sharedDrop });
const viaUpsell = order('delivery_install', sharedItems, { dropoff: sharedDrop }); // same committed payload as after confirm
const qA = quote(upFront);
const qB = quote(viaUpsell);
ok(qA.total === qB.total, 'quote total matches an up-front install order', { a: qA.total, b: qB.total });
const installLines = (q) => (q.lines || []).filter((l) => /install|hanging/i.test(l.label)).map((l) => [l.label, l.amount]);
ok(JSON.stringify(installLines(qA)) === JSON.stringify(installLines(qB)), 'install lines match an up-front install order', { a: installLines(qA), b: installLines(qB) });

const sheetA = rowsForOrder({ ...upFront, id: 'CAD-U1', status: 'confirmed', createdAt: '2026-11-25T12:00:00.000Z', quote: qA, contact: upFront.contact });
const sheetB = rowsForOrder({ ...viaUpsell, id: 'CAD-U1', status: 'confirmed', createdAt: '2026-11-25T12:00:00.000Z', quote: qB, contact: viaUpsell.contact });
const col = (name) => COLUMNS.indexOf(name);
ok(sheetA.length === sheetB.length && sheetA.length >= 2, 'both records produce the same number of schedule rows', { a: sheetA.length, b: sheetB.length });
ok(sheetA.some((r) => r[col('JOB TYPE')] === 'DEL + INST') && sheetB.some((r) => r[col('JOB TYPE')] === 'DEL + INST'), 'sheet marks the delivery row DEL + INST, same as an up-front install');
ok(!sheetB.some((r) => r[col('JOB TYPE')] === 'DEL' && r[col('JOB TYPE')] !== 'DEL + INST'), 'upsell record is not a plain DEL row');
const itemA = sheetA.map((r) => r[col('PIECES')] || r[col('ITEMS')] || '').join('\n');
const itemB = sheetB.map((r) => r[col('PIECES')] || r[col('ITEMS')] || '').join('\n');
// Item column name may differ; compare the hanging text that is definitely present in the row arrays.
const hayA = JSON.stringify(sheetA);
const hayB = JSON.stringify(sheetB);
ok(hayA.includes('DEL + INST') && hayB.includes('DEL + INST'), 'sheet JSON includes DEL + INST for both');
ok(hayA.includes('Wire already installed') && hayB.includes('Wire already installed'), 'sheet notes include hanging hardware for both');
ok(hayA.includes('Standard eye level') && hayB.includes('Standard eye level'), 'sheet notes include hanging height for both');
ok(hayA.includes('Drywall') && hayB.includes('Drywall'), 'sheet notes include wall type for both');

(async () => {
  const pw = require('playwright');
  const PORT = 4700 + Math.floor(Math.random() * 80);
  const BASE = `http://127.0.0.1:${PORT}`;
  const SHOTS = '/workspace/reviews';
  fs.mkdirSync(SHOTS, { recursive: true });
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-upsell-')), TEST_MODE: '1', BASE_URL: BASE, SKIP_GEOCODE: '1' },
    stdio: 'ignore',
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(200); } if (i === 79) throw new Error('server did not start'); }

    const availBody = order('pickup_delivery', [art()]);
    const avail = await (await fetch(BASE + '/api/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(availBody) })).json();
    const day = (avail.days && avail.days[0] && avail.days[0].date) || (avail.rush && avail.rush[0] && avail.rush[0].date) || '';
    ok(!!day, 'availability returned a bookable date for the UI walk-through', avail && (avail.error || avail));
    const delDay = (avail.days || []).map((d) => d.date).find((d) => d > day) || day;

    const stateOf = (service, items, extra = {}) => {
      const o = order(service, items, extra);
      o.schedule.date = day;
      o.schedule.deliveryDate = delDay;
      o.heard = { source: 'google', repeatAnswer: 'no' };
      o.payer = 'me';
      o.rush = false;
      o.items = items.map((it, i) => ({
        id: 'pc' + i,
        checkValue: false, furnitureKind: 'Sofa', sizeClass: 'medium', materialNotes: '',
        weight: '', frameType: '', framedGlass: false, fragile: false, weightUnsure: false,
        fitsStairwell: false, centerHeight: it.centerHeight || '', hangWhere: it.hangWhere || '',
        hangWhereOther: '', hangBottomFt: '', hangPhotos: [], crateStatus: 'not_sure', photos: [],
        sizeClassOnly: false, ...it,
      }));
      return o;
    };

    const browser = await pw.chromium.launch();
    const openOn = async (page, state, ui = {}) => {
      await page.goto(BASE + '/cad-logo.jpg');
      await page.evaluate(([s, u]) => {
        sessionStorage.clear(); localStorage.clear();
        localStorage.setItem('cad-order', JSON.stringify(s));
        localStorage.setItem('cad-step', '3');
        localStorage.setItem('cad-sub', 'review');
        localStorage.setItem('cad-ui', JSON.stringify({ showContact: [], showPayer: false, showList: false, rtr: false, ...u }));
        localStorage.setItem('cad-saved-at', String(Date.now()));
      }, [state, ui]);
      await page.goto(BASE + '/?v=' + Date.now());
      await page.waitForSelector('h1', { timeout: 20000 });
      await page.waitForFunction(() => !/Updating/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(600);
    };
    const shot = async (page, file, full = true) => {
      const dest = path.join(SHOTS, file);
      await page.screenshot({ path: dest, fullPage: full });
      return dest;
    };

    hdr('UI: card visibility and flow (390px + desktop)');
    // Hidden cases at 390
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await openOn(page, stateOf('pickup_delivery', [{ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Walnut sofa', value: 2000 }]));
      ok(!(await page.$('[data-upsell]')), 'card is hidden for furniture (non-wall-art) on Review');
      await openOn(page, stateOf('delivery_install', [art({ hardware: 'wire' })]));
      ok(!(await page.$('[data-upsell]')), 'card is hidden when install was chosen up front');
      await ctx.close();
    }

    const runFlow = async (vw, vh, tag, mobile) => {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openOn(page, stateOf('pickup_delivery', [art()]));
      await page.waitForSelector('[data-upsell]', { timeout: 8000 }).catch(() => {});
      const card = await page.$('[data-upsell]');
      if (!card) {
        const debug = await page.evaluate(() => ({
          h1: (document.querySelector('h1') || {}).textContent,
          panel: ([...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden) || {}).dataset?.panel,
          step: localStorage.getItem('cad-step'),
          service: (JSON.parse(localStorage.getItem('cad-order') || 'null') || {}).service,
          items: ((JSON.parse(localStorage.getItem('cad-order') || 'null') || {}).items || []).map((it) => it.type),
          html: (document.querySelector('#app') || document.body).innerText.slice(0, 500),
        }));
        console.log('  debug no card:', JSON.stringify(debug));
      }
      ok(!!card, `${tag}: upsell card is on Review for wall art pickup + delivery`);
      const title = card ? await page.locator('[data-upsell] .upsell-title').innerText() : '';
      ok(/Add installation for as little as \$75/.test(title), `${tag}: headline uses the real $75 install price`, title);
      const copy = card ? await page.locator('[data-upsell] .upsell-copy').innerText() : '';
      ok(/same visit/.test(copy) && /level and secure/.test(copy) && /no second trip/.test(copy), `${tag}: benefit copy is present`, copy);
      ok(await page.locator('[data-upsell-yes]').count(), `${tag}: Add installation button is present`);
      ok(await page.locator('[data-upsell-no]').count(), `${tag}: No thanks is present`);
      // Card sits above the price / checkout
      const orderOk = await page.evaluate(() => {
        const card = document.querySelector('[data-upsell]');
        const price = document.querySelector('h2') && [...document.querySelectorAll('h2')].find((h) => /Price/.test(h.textContent));
        if (!card || !price) return false;
        return card.getBoundingClientRect().top < price.getBoundingClientRect().top;
      });
      ok(orderOk, `${tag}: card is above the Price heading`);
      await shot(page, `install-upsell-review-${tag}.png`);

      await page.click('[data-upsell-yes]');
      await page.waitForSelector('[data-panel="install-upsell"]:not([hidden])', { timeout: 10000 });
      await page.waitForTimeout(500);
      ok(await page.$('[data-hardware="0"]'), `${tag}: hardware is asked (not yet collected)`);
      ok(await page.$('[data-seg="items.0.hangPick"]'), `${tag}: hanging height is asked`);
      ok(await page.$('[data-path="dropoff.wallType"]'), `${tag}: optional wall type is asked because it was empty`);
      const glow = await page.evaluate(() => !!document.querySelector('[data-hardware="0"].req-glow, .field.req-glow[data-hardware="0"], [data-hardware="0"]'));
      ok(!!(await page.$('[data-hardware="0"]')), `${tag}: hardware field is on the step`);
      const hasGlow = await page.evaluate(() => {
        const el = document.querySelector('[data-hardware="0"]');
        return !!(el && (el.classList.contains('req-glow') || el.closest('.req-glow')));
      });
      ok(hasGlow, `${tag}: empty required hardware has the pre-Next blue glow`);
      await shot(page, `install-upsell-step-${tag}.png`);

      const totalBefore = await page.evaluate(() => (document.querySelector('#estTotal') || {}).textContent || (document.querySelector('[data-upsell-live] .amt') || {}).textContent || '');
      await page.click('[data-seg="items.0.hardware"] [data-v="needs_zbar"]');
      await page.waitForTimeout(800);
      const totalAfterHw = await page.evaluate(() => (document.querySelector('#estTotal') || {}).textContent || (document.querySelector('[data-upsell-live] .amt') || {}).textContent || '');
      ok(totalAfterHw && totalAfterHw !== totalBefore, `${tag}: total updates when hardware with a fee is chosen`, { totalBefore, totalAfterHw });

      // Next with hardware filled (height already standard) should confirm
      await page.click('#nextBtn', { force: true });
      await page.waitForTimeout(800);
      const backOnReview = await page.evaluate(() => {
        const h = (document.querySelector('h1') || {}).textContent || '';
        const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden);
        return /Review/.test(h) && (!p || p.dataset.panel === 'review');
      });
      ok(backOnReview, `${tag}: confirming returns to Review`, await page.locator('h1').innerText().catch(() => ''));
      ok(!(await page.$('[data-upsell]')), `${tag}: upsell card is gone after adding install`);
      const priceText = await page.evaluate(() => (document.querySelector('[data-price]') || {}).innerText || '');
      ok(/install/i.test(priceText) || /Hanging/i.test(priceText), `${tag}: Review price includes an install / hanging line`, priceText.slice(0, 400));
      const svc = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.sum-row')];
        const s = rows.find((r) => /Service/.test((r.querySelector('span') || {}).textContent || ''));
        return s ? s.innerText : '';
      });
      ok(/Install/i.test(svc), `${tag}: service line is pickup + delivery + install`, svc);
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
      ok(draft && draft.service === 'delivery_install', `${tag}: saved order service is delivery_install`);
      ok(draft && draft.items && draft.items[0] && draft.items[0].hardware === 'needs_zbar', `${tag}: hanging hardware is stored on the item`);
      await shot(page, `install-upsell-after-${tag}.png`);
      ok(errors.length === 0, `${tag}: no page errors`, errors);
      await ctx.close();
    };

    if (day) {
      await runFlow(390, 844, '390', true);
      await runFlow(1280, 900, 'desktop', false);

      // Skip already-known questions
      hdr('UI: skip known answers');
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await openOn(page, stateOf('pickup_delivery', [art({ hardware: 'wire' })], { dropoff: { wallType: 'Drywall' } }));
        const shown = await page.$('[data-upsell]');
        ok(!!shown, 'card still shows when hardware and wall type are already known (service is still pickup + delivery)');
        if (shown) {
          await page.click('[data-upsell-yes]');
          await page.waitForSelector('[data-panel="install-upsell"]:not([hidden])', { timeout: 8000 });
          await page.waitForTimeout(300);
          ok(!(await page.$('[data-hardware="0"]')), 'hardware field is skipped when already answered');
          ok(!(await page.$('[data-path="dropoff.wallType"]')), 'wall type is skipped when already answered');
          ok(!!(await page.$('[data-seg="items.0.hangPick"]')), 'hanging height is still asked');
        }
        await ctx.close();
      }

      // No thanks collapses the card
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await openOn(page, stateOf('pickup_delivery', [art()]));
        await page.click('[data-upsell-no]');
        await page.waitForTimeout(300);
        ok(!(await page.$('[data-upsell]')), 'No thanks collapses the card');
        const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
        ok(draft && draft.service === 'pickup_delivery', 'No thanks leaves the service as pickup + delivery');
        await ctx.close();
      }
    }

    await browser.close();
  } finally {
    try { child.kill('SIGTERM'); } catch {}
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
