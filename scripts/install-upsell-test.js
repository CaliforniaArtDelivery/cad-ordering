/**
 * Install upsell (Chad t2095u): pricing eligibility, question skipping, quote totals,
 * order/sheet parity with an up-front install, and a 390px + desktop UI walk-through.
 *   node scripts/install-upsell-test.js
 */
// Route dates come only from the CAD SCHEDULE digest; this test runs against the stand-in built from the weekly catalog (never production).
if (!process.env.SHEET_DAYS_FIXTURE) process.env.SHEET_DAYS_FIXTURE = 'catalog';
if (!process.env.DAILY_JOB_CAP) process.env.DAILY_JOB_CAP = '500';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { quote, installUpsell, installUpsellQuestions, quoteIsNonFirm, hardwareFee, hardwareUnsure } = require('../lib/pricing');
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const { COLUMNS, rowsForOrder } = require('../lib/schedule');
const { installVisitFit, isConditionalOnlyStop, MSG: FIT_MSG } = require('../lib/install-visit-fit');
const PAL = require('../lib/palomas');
const config = require('../config');

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
    schedule: { date: '2026-12-02', deliveryDate: '2026-12-02', timePref: 'none', deliveryTimePref: 'none', ...(schedule || {}) },
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
ok(uPaint.amount === money(qDi.total - qPd.total), 'X is the difference between the two already-rounded totals (not rounded again)', { amount: uPaint.amount, delta: qDi.total - qPd.total, pd: qPd.total, di: qDi.total });
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
ok(installUpsell(withHw).amount === 150, 'when paid hardware is already known, X is the real minimum (install $75 + Z-bar hanging labor $75)', installUpsell(withHw));
ok(installUpsell(withHw).asLittle === true, '“as little as” stays on until a higher hang is confirmed, because they can still raise the price on the step', installUpsell(withHw));
const firmHigh = installUpsell(order('pickup_delivery', [art({ hardware: 'wire', hangHeight: 'higher', hangWhere: 'high' })]));
ok(firmHigh.show && firmHigh.asLittle === false, 'headline is a firm price once hardware and a higher hang are already known', firmHigh);

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


hdr('protection label (customers see totals only)');
const protLine = (quote(pdPaint).lines || []).find((l) => /protection/i.test(l.label));
ok(protLine && protLine.label === 'Declared value protection', 'price block says Declared value protection, not 1.5% of $X', protLine);
ok(protLine && protLine.amount === 120, 'protection amount is still $120 on an $8,000 piece', protLine);

hdr('hardware rate card and I’m-not-sure');
const hw = config.pricing.hangHardware;
ok(hw.zbar && hw.zbar.fee === 45, 'Z-bar already installed is $45 on the rate card (hanging labor, fee is correct)');
ok(hw.cleat && hw.cleat.fee === 55, 'French cleat already installed is $55 on the rate card (hanging labor, fee is correct)');
ok(/hanging labor/i.test(hw.zbar.label) && /Z-bar already installed/i.test(hw.zbar.label), 'Z-bar label says what the charge covers', hw.zbar.label);
ok(/hanging labor/i.test(hw.cleat.label) && /French cleat already installed/i.test(hw.cleat.label), 'French cleat label says what the charge covers', hw.cleat.label);
ok(hw.not_sure && hw.not_sure.unsure === true && hw.not_sure.fee === 0, 'I’m not sure is flagged unsure and is not a $0 hardware price', hw.not_sure);
ok(hardwareUnsure({ hardware: 'not_sure' }) === true, 'hardwareUnsure is true for I’m not sure');
ok(hardwareFee({ hardware: 'not_sure' }) === 0, 'hardwareFee does not invent a charge for I’m not sure');
ok(hardwareFee({ hardware: 'zbar' }) === 45 && hardwareFee({ hardware: 'cleat' }) === 55, 'hardwareFee matches the rate card for Z-bar and French cleat');

hdr('hide the card when the price is not firm');
ok(!installUpsell(order('pickup_delivery', [art()], { rush: true })).show, 'hidden for rush');
ok(!installUpsell(order('pickup_delivery', [art()], { paymentPlan: 'quote' })).show, 'hidden when the payment plan is a manual / send-to-team quote');
ok(!installUpsell(order('pickup_delivery', [art()], { quoteOnly: true })).show, 'hidden for quote-only');
ok(!installUpsell(order('pickup_delivery', [art()], { customDate: true })).show, 'hidden for a custom date request');
ok(!installUpsell(order('pickup_delivery', [art()], { pickup: { state: 'NY', zip: '10001' }, dropoff: { state: 'NY', zip: '10001' } })).show, 'hidden for out-of-state');
const heavy = installUpsell(order('pickup_delivery', [art({ weight: 80, weightUnsure: true })]));
ok(!installUpsell(order('pickup_delivery', [{ type: 'sculpture', weightUnsure: true, value: 2000, description: 'Bronze', w: 20, h: 20, d: 20 }])).show
  || quoteIsNonFirm(quote(order('pickup_delivery', [{ type: 'sculpture', weightUnsure: true, value: 2000, description: 'Bronze', w: 20, h: 20, d: 20 }])), order('pickup_delivery', [{ type: 'sculpture', weightUnsure: true, value: 2000, description: 'Bronze', w: 20, h: 20, d: 20 }])),
  'non-firm weight hides a firm upsell (or the quote is already non-firm)');
ok(!installUpsell(order('pickup_delivery', [art()], { dropoff: { accessMode: 'not_sure' } })).show, 'hidden when access still needs review');

hdr('mixed orders and high / stairwell hangs');
const mixed = installUpsell(order('pickup_delivery', [art(), { type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', value: 2000, description: 'Sofa' }]));
ok(mixed.show && mixed.amount === 75, 'mixed wall-art + sofa: X is the painting install only', mixed);
const qMix = installUpsellQuestions(order('pickup_delivery', [art(), { type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', value: 2000, description: 'Sofa' }]));
ok(qMix.every((q) => !/sofa/i.test(q.label || q.key || '')), 'questions are only about the pieces being hung', qMix);
const highQ = quote(order('delivery_install', [art({ hangHeight: 'higher', hangWhere: 'high', hardware: 'wire' })]));
const stairQ = quote(order('delivery_install', [art({ hangHeight: 'higher', hangWhere: 'stairwell', hardware: 'wire' })]));
ok(highQ.total > qDi.total, 'a high hang raises the install total', { high: highQ.total, base: qDi.total });
ok(stairQ.total > qDi.total, 'a stairwell hang raises the install total', { stair: stairQ.total, base: qDi.total });

hdr('visit fit: SF Wed Dec 2 is eligible; Fri Dec 4 is a rejection fixture');
const fitOrder = (dd) => order('delivery_install', [art({ hardware: 'wire' })], { schedule: { date: '2026-12-02', deliveryDate: dd, timePref: 'none', deliveryTimePref: 'none' } });
ok(installVisitFit(fitOrder('2026-12-02')).ok === true, 'SF on Wed Dec 2 fits an installation', installVisitFit(fitOrder('2026-12-02')));
const fri = installVisitFit(fitOrder('2026-12-04'));
ok(fri.ok === false, 'SF on Fri Dec 4 does not fit (conditional / if-quick stop)', fri);
ok(fri.message === FIT_MSG && !/call|phone|\d{3}[-.]?\d{3}/i.test(fri.message || ''), 'rejection message is plain and has no phone prompt', fri);
ok(isConditionalOnlyStop('San Jose → East Bay → Napa → SF/Silicon Valley (late & if quick) → San Jose', { city: 'San Francisco', zip: '94110', state: 'CA' }), 'the old Friday route text is kept as a conditional-only rejection fixture');

hdr('Paloma member install rate, payer rules, and sheet write');
const palItem = (x = {}) => ({ catalogId: '15', custom: false, qty: 1, value: 395, hardware: '', ...x });
const palBody = (extra = {}) => ({
  items: extra.items || [palItem()],
  pickupLocation: 'showroom',
  delivery: { street: '1 Main St', city: 'San Francisco', state: 'CA', zip: '94110', name: 'Jordan Lee', email: 'jordan@example.com', phone: '3105550199', wallType: extra.wallType || '' },
  schedule: { date: '2026-12-02', deliveryDate: '2026-12-02' },
  payer: extra.payer || 'client', payMode: extra.payMode || 'now',
  placedBy: { name: 'Heather' },
  service: extra.service || 'pickup_delivery',
  customDate: !!extra.customDate,
});
const palQ = PAL.partnerQuote(palBody());
ok(palQ.installUpsell && palQ.installUpsell.amount === 55, 'Paloma upsell X is the member first-piece rate $55', palQ.installUpsell);
ok((palQ.lines || []).every((l) => !/1\.5%/.test(l.label)), 'Paloma price lines do not show the 1.5% formula', palQ.lines.map((l) => l.label));
const palTwo = PAL.partnerQuote(palBody({ items: [palItem(), palItem({ catalogId: '315', value: 59 })] }));
ok(palTwo.installUpsell && palTwo.installUpsell.amount === 110, 'Paloma two-piece member install is $110 ($55 + $55)', palTwo.installUpsell);
const palInst = PAL.partnerQuote(palBody({ service: 'delivery_install', items: [palItem({ hardware: 'wire', hangHeight: 'standard' })] }));
ok(palInst.total === money((palQ.total || 0) + 55), 'Paloma live install total is the partnership delivery total plus the $55 add-on, not re-rounded', { base: palQ.total, inst: palInst.total });
ok((palInst.lines || []).some((l) => /hanging|install/i.test(l.label) && l.amount === 55), 'Paloma install line is $55 member hanging', palInst.lines);
ok(palInst.payment && palInst.payment.paymentPlan === palQ.payment.paymentPlan, 'adding install keeps Paloma payment timing', { before: palQ.payment, after: palInst.payment });
const palBigItems = [palItem({ value: 8000 }), palItem({ catalogId: '205', value: 1195 }), palItem({ catalogId: '791', value: 2249 }), palItem({ catalogId: '792', value: 1249 })];
// enough value / delivery that the total can cross the deposit threshold
const palBig = PAL.partnerQuote(palBody({ items: palBigItems }));
const palBigInst = PAL.partnerQuote(palBody({ service: 'delivery_install', items: palBigItems.map((it) => ({ ...it, hardware: 'wire', hangHeight: 'standard' })) }));
ok(palBigInst.payment && palBig.payment && palBigInst.payment.paymentPlan === palBig.payment.paymentPlan, 'a larger Paloma order keeps the same payment plan after install is added', { before: palBig.payment, after: palBigInst.payment });
if ((palBigInst.payment || {}).paymentPlan === 'deposit') {
  ok(/delivery/i.test(palBigInst.payment.balanceWhen || palBigInst.payment.paymentSummary || ''), 'when a balance is collected later, it is still at delivery (Paloma timing unchanged)', palBigInst.payment);
}

const palEo = PAL.engineOrder(palBody({ service: 'delivery_install', items: [palItem({ hardware: 'wire', hangHeight: 'standard' })], wallType: 'Drywall' }), { member: true });
ok(palEo.service === 'delivery_install', 'Paloma engine order uses delivery_install after add');
const palRows = rowsForOrder({
  ...palEo,
  id: 'CAD-P1', status: 'confirmed', createdAt: '2026-11-25T12:00:00.000Z',
  contact: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '3105550199' },
  partnerOrder: true, quote: palInst,
});
const palHay = JSON.stringify(palRows);
const palTypes = palRows.map((r) => r[col('JOB TYPE')]);
ok(palTypes.some((t) => t === 'DEL + INST'), 'Paloma schedule write marks the delivery row DEL + INST');
ok(!palTypes.some((t) => t === 'DEL'), 'DEL + INST is only on the delivery entry, not a second plain DEL row');
ok(!palTypes.filter((t) => t === 'DEL + INST').length || palTypes.filter((t) => t === 'DEL + INST').length === 1, 'exactly one DEL + INST row');
const palEoOff = PAL.engineOrder(palBody({ service: 'pickup_delivery', items: [palItem({ hardware: 'wire', hangHeight: 'standard' })] }), { member: true });
const palRowsOff = rowsForOrder({ ...palEoOff, id: 'CAD-P1', status: 'confirmed', createdAt: '2026-11-25T12:00:00.000Z', contact: palEo.contact || { name: 'Jordan Lee' }, partnerOrder: true, quote: palQ });
ok(JSON.stringify(palRowsOff).includes('DEL') && !JSON.stringify(palRowsOff).includes('DEL + INST'), 'removing install writes delivery-only (no DEL + INST)');


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
      o.schedule.date = (extra.schedule && extra.schedule.date) || '2026-12-02';
      o.schedule.deliveryDate = (extra.schedule && extra.schedule.deliveryDate) || '2026-12-02';
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


    const stepLayout = async (page, tag) => {
      const info = await page.evaluate(() => {
        const root = document.querySelector('[data-install-step], [data-panel="install-upsell"]:not([hidden])');
        const wall = root && (root.querySelector('#palWallType') || root.querySelector('[data-path="dropoff.wallType"]'));
        const hw = root && (root.querySelector('[data-hw], [data-hardware]'));
        const overflowing = [...(root ? root.querySelectorAll('*') : []), root].filter(Boolean)
          .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .map((el) => (el.tagName + '.' + (el.className || '')).slice(0, 80)).slice(0, 8);
        return {
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          bodyW: document.body.scrollWidth,
          wallAfterHw: !!(hw && wall && (hw.compareDocumentPosition(wall) & Node.DOCUMENT_POSITION_FOLLOWING)),
          glow: !!document.querySelector('.field.req-glow, [data-hardware="0"].req-glow, [data-hardware="0"].field.req-glow, .req-glow .hang-seg, .req-glow[data-hardware]'),
          overflowing,
        };
      });
      ok(info.scrollW <= info.clientW + 1, `${tag}: no horizontal scroll on the install step`, info);
      ok(!info.overflowing.length, `${tag}: no element overflows the viewport on the right`, info);
      ok(info.wallAfterHw, `${tag}: optional wall type sits below required hardware and height`, info);
      ok(info.glow, `${tag}: empty required fields show the soft blue glow`, info);
    };

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
      ok(copy.trim() === 'We hang it level and secure on the same visit.', `${tag}: benefit line is the agreed wording (no em dash)`, copy);
      const may = card ? await page.locator('[data-upsell] .upsell-may').innerText().catch(() => '') : '';
      ok(/Hardware or special placement may add cost/.test(may), `${tag}: may-add-cost line is present`, may);
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
      await shot(page, `install-upsell-v2-review-${tag}.png`);

      await page.click('[data-upsell-yes]');
      await page.waitForSelector('[data-panel="install-upsell"]:not([hidden])', { timeout: 10000 });
      await page.waitForTimeout(500);
      ok(await page.$('[data-hardware="0"]'), `${tag}: hardware is asked (not yet collected)`);
      ok(await page.$('[data-seg="items.0.hangPick"]'), `${tag}: hanging height is asked`);
      ok(await page.$('[data-path="dropoff.wallType"]'), `${tag}: optional wall type is asked because it was empty`);
      await stepLayout(page, tag);
      await shot(page, `install-upsell-v2-step-${tag}.png`, true);
      const totalBefore = await page.evaluate(() => (document.querySelector('[data-upsell-status]') || {}).textContent || '');
      await page.click('[data-seg="items.0.hardware"] [data-v="needs_zbar"]');
      await page.waitForTimeout(800);
      const totalAfterHw = await page.evaluate(() => (document.querySelector('[data-upsell-status]') || {}).textContent || '');
      ok(totalAfterHw && totalAfterHw !== totalBefore, `${tag}: status line updates when hardware with a fee is chosen`, { totalBefore, totalAfterHw });
      ok(/Installation adds/.test(totalAfterHw) && /New order total/.test(totalAfterHw), `${tag}: step shows Installation adds $X · New order total $Y once hardware is firm`, totalAfterHw);
      const dockDup = await page.evaluate(() => {
        const dock = (document.querySelector('#estTotal') || {}).textContent || '';
        const status = (document.querySelector('[data-upsell-status]') || {}).textContent || '';
        const big = [...document.querySelectorAll('.card, .price, [data-price]')].filter((el) => /New order total/.test(el.textContent) && !el.closest('[data-upsell-status]'));
        return { dock, status, extraBig: big.length };
      });
      ok(true, `${tag}: dock/status snapshot`, dockDup);

      // Next with hardware filled (height already standard) should confirm
      await page.click('#nextBtn', { force: true });
      await page.waitForTimeout(800);
      const backOnReview = await page.evaluate(() => {
        const h = (document.querySelector('h1') || {}).textContent || '';
        const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden);
        return /Review/.test(h) && (!p || p.dataset.panel === 'review');
      });
      ok(backOnReview, `${tag}: confirming returns to Review`, await page.locator('h1').innerText().catch(() => ''));
      ok(!(await page.$('[data-upsell]')), `${tag}: upsell offer card is gone after adding install`);
      const added = await page.$('[data-install-added]');
      ok(!!added, `${tag}: Installation added card is on Review`);
      ok(await page.locator('[data-upsell-edit]').count(), `${tag}: Edit is on the added card`);
      ok(await page.locator('[data-upsell-remove]').count(), `${tag}: Remove is on the added card`);
      const addedText = added ? await page.locator('[data-install-added]').innerText() : '';
      ok(/Installation added/.test(addedText), `${tag}: card says Installation added`, addedText);
      const priceText = await page.evaluate(() => (document.querySelector('[data-price]') || {}).innerText || '');
      ok(/install/i.test(priceText) || /Hanging/i.test(priceText), `${tag}: Review price includes an install / hanging line`, priceText.slice(0, 400));
      ok(!/1\.5%/.test(priceText), `${tag}: protection line does not show the 1.5% formula`, priceText.slice(0, 500));
      const svc = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.sum-row')];
        const s = rows.find((r) => /Service/.test((r.querySelector('span') || {}).textContent || ''));
        return s ? s.innerText : '';
      });
      ok(/Install/i.test(svc), `${tag}: service line is pickup + delivery + install`, svc);
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
      ok(draft && draft.service === 'delivery_install', `${tag}: saved order service is delivery_install`);
      ok(draft && draft.items && draft.items[0] && draft.items[0].hardware === 'needs_zbar', `${tag}: hanging hardware is stored on the item`);
      await shot(page, `install-upsell-v2-after-${tag}.png`);
      ok(errors.length === 0, `${tag}: no page errors`, errors);
      await ctx.close();
    };

    if (day) {
      await runFlow(390, 844, '390', true);
      await runFlow(360, 800, '360', true);
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
        const noBox = await page.evaluate(() => {
          const el = document.querySelector('[data-upsell-no]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { h: r.height, w: r.width };
        });
        ok(noBox && noBox.h >= 44, 'No thanks is at least a 44px tap target', noBox);
        await page.click('[data-upsell-no]');
        await page.waitForTimeout(300);
        ok(!(await page.$('[data-upsell]')), 'No thanks collapses the card');
        const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
        ok(draft && draft.service === 'pickup_delivery', 'No thanks leaves the service as pickup + delivery');
        await ctx.close();
      }

      hdr('UI: $X never sits alone at 390 / 375 / 360, Remove, Friday rejection, tracking');
      for (const w of [390, 375, 360]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await openOn(page, stateOf('pickup_delivery', [art()]));
        await page.waitForSelector('[data-upsell]', { timeout: 8000 }).catch(() => {});
        const wrap = await page.evaluate(() => {
          const el = document.querySelector('.upsell-aslittle') || document.querySelector('.upsell-title');
          if (!el) return { ok: false };
          const t = el.innerText;
          const alone = [...el.getClientRects()].some((r) => /^\s*\$\d+\s*$/.test(el.innerText) && r.height < 40);
          // The nowrap span should be a single box, so "$75" cannot wrap onto its own line.
          const boxes = el.getClientRects();
          return { text: t, boxCount: boxes.length, width: el.getBoundingClientRect().width };
        });
        ok(wrap && /\$75/.test(wrap.text || '') && wrap.boxCount === 1, `as little as $75 stays on one line at ${w}px`, wrap);
        await page.click('[data-upsell-yes]');
        await page.waitForSelector('[data-panel="install-upsell"]:not([hidden])', { timeout: 10000 });
        await page.waitForTimeout(300);
        await stepLayout(page, `main step ${w}px`);
        await ctx.close();
      }

      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await openOn(page, stateOf('pickup_delivery', [art()]));
        await page.click('[data-upsell-yes]');
        await page.waitForSelector('[data-panel="install-upsell"]:not([hidden])', { timeout: 10000 });
        await page.click('[data-seg="items.0.hardware"] [data-v="wire"]');
        await page.waitForTimeout(400);
        await page.click('#nextBtn', { force: true });
        await page.waitForTimeout(800);
        const before = await page.evaluate(() => {
          const d = JSON.parse(localStorage.getItem('cad-order') || 'null');
          return { service: d && d.service, total: (document.querySelector('#estTotal') || {}).textContent, name: d && d.contact && d.contact.name, items: (d && d.items || []).length };
        });
        ok(before.service === 'delivery_install', 'before Remove, service is delivery_install');
        await page.click('[data-upsell-remove]');
        await page.waitForTimeout(600);
        const after = await page.evaluate(() => {
          const d = JSON.parse(localStorage.getItem('cad-order') || 'null');
          return { service: d && d.service, total: (document.querySelector('#estTotal') || {}).textContent, name: d && d.contact && d.contact.name, items: (d && d.items || []).length, hasOffer: !!document.querySelector('[data-upsell]'), hasAdded: !!document.querySelector('[data-install-added]') };
        });
        ok(after.service === 'pickup_delivery', 'Remove restores pickup + delivery', after);
        ok(after.hasOffer && !after.hasAdded, 'Remove brings the offer card back and drops Installation added', after);
        ok(after.name === 'Jordan Lee' && after.items === 1, 'Remove does not lose the rest of the order', after);

        // A delivery that is only a stop on the way is rejected: Los Gatos on the Saturday Carmel run (an offered date, but no install time).
        // (SF on Friday Dec 4 is no longer an offered date at all, so the browser can't hold it; the server check above still rejects it.)
        await openOn(page, stateOf('pickup_delivery', [art()], { dropoff: { street: '1 N Santa Cruz Ave', city: 'Los Gatos', zip: '95030' }, schedule: { date: '2026-12-02', deliveryDate: '2026-12-05' } }));
        await page.waitForSelector('[data-upsell]', { timeout: 8000 }).catch(() => {});
        if (await page.$('[data-upsell-yes]')) {
          await page.click('[data-upsell-yes]');
          await page.waitForTimeout(900);
          const msg = await page.evaluate(() => (document.querySelector('.upsell-fit') || document.querySelector('[data-upsell]')) ? (document.querySelector('.upsell-fit') || document.body).innerText : '');
          const stillPd = await page.evaluate(() => (JSON.parse(localStorage.getItem('cad-order') || 'null') || {}).service);
          ok(/doesn’t fit this delivery day|doesn't fit this delivery day/.test(msg), 'Los Gatos on the Saturday run (stop on the way) shows a plain visit-fit message', msg.slice(0, 240));
          ok(!/call|phone/i.test(msg), 'visit-fit message has no phone prompt', msg.slice(0, 240));
          ok(stillPd === 'pickup_delivery', 'a rejected visit leaves pickup + delivery in place');
          ok(!(await page.$('[data-panel="install-upsell"]:not([hidden])')), 'the install step does not open when the visit does not fit');
        } else {
          ok(false, 'offer card missing for Friday rejection fixture');
        }
        await ctx.close();
      }

      {
        const ev = await (await fetch(BASE + '/api/events')).json();
        const names = (ev.events || ev || []).map((e) => e.name || e.event || e.type);
        const need = ['install_upsell_shown', 'install_upsell_add', 'install_upsell_no_thanks', 'install_upsell_confirm', 'install_upsell_remove'];
        need.forEach((n) => ok(names.includes(n), `tracking event ${n} was recorded`, names));
      }

      hdr('UI: Paloma Review card, step, and Remove (390 + desktop)');
      const openPal = async (page) => {
        await page.goto(BASE + '/palomas?v=' + Date.now());
        await page.waitForFunction(() => window.__CAD_PALOMAS__, null, { timeout: 20000 });
        await page.evaluate(() => {
          window.__CAD_PALOMAS__.bootReview({
            placedBy: 'Heather',
            pickup: 'showroom',
            items: [{ uid: 1, name: 'Four Caballos', kind: 'Wall Decor', qty: 1, catalogId: '15', custom: false, value: '395', w: '', h: '' }],
            pickupDate: '2026-12-02',
            deliveryDate: '2026-12-02',
            payer: 'client',
            service: 'pickup_delivery',
            installUpsell: '',
            fields: {
              placedBy: 'Heather',
              dName: 'Jordan Lee', dPhone: '3105550199', dEmail: 'jordan@example.com',
              dStreet: '1 Main St', dCity: 'San Francisco', dState: 'CA', dZip: '94110',
            },
          });
        });
        await page.waitForTimeout(900);
        await page.waitForFunction(() => !/Updating/.test((document.querySelector('#barTotal') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
        await page.waitForSelector('[data-upsell]', { timeout: 12000 }).catch(() => {});
      };
      const runPal = async (vw, vh, tag, mobile) => {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
        const page = await ctx.newPage();
        await openPal(page);
        const card = await page.$('[data-upsell]');
        ok(!!card, `Paloma ${tag}: upsell card is on Review`);
        const title = card ? await page.locator('[data-upsell] .upsell-title').innerText() : '';
        ok(/Add installation for/.test(title) && /as little as \$55/.test(title), `Paloma ${tag}: headline uses the member $55 rate`, title);
        const copy = card ? await page.locator('[data-upsell] .upsell-copy').innerText() : '';
        ok(copy.trim() === 'We hang it level and secure on the same visit.', `Paloma ${tag}: same benefit line`, copy);
        const headLayout = await page.evaluate(() => {
          const el = document.querySelector('[data-upsell] .upsell-title');
          const little = el && el.querySelector('.upsell-aslittle');
          if (!el || !little) return { missing: true };
          const cs = getComputedStyle(el);
          const t = el.getBoundingClientRect();
          const l = little.getBoundingClientRect();
          const flexRow = (cs.display === 'flex' || cs.display === 'inline-flex') && /^row/.test(cs.flexDirection || 'row');
          const wrapped = l.top - t.top > 8;
          return {
            display: cs.display,
            textAlign: cs.textAlign,
            flexRow,
            wrappedLeft: !wrapped || Math.abs(l.left - t.left) <= 8,
            littleText: (little.textContent || '').replace(/\s+/g, ' ').trim(),
            titleText: (el.innerText || '').replace(/\s+/g, ' ').trim(),
          };
        });
        ok(headLayout && !headLayout.missing && !headLayout.flexRow, `Paloma ${tag}: headline is one left-aligned block, not two flex columns`, headLayout);
        ok(headLayout && headLayout.wrappedLeft !== false, `Paloma ${tag}: if the headline wraps, the second line stays left-aligned`, headLayout);
        ok(headLayout && /as little as \$55/.test(headLayout.littleText || ''), `Paloma ${tag}: $55 stays with “as little as”, never alone on a line`, headLayout);
        const daysText = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('.rv')];
          const r = rows.find((el) => /^\s*Days\s*$/m.test((el.querySelector('.rv-l') || {}).textContent || ''));
          return r ? r.innerText : '';
        });
        ok(/Wed,\s*Dec\s*2/.test(daysText), `Paloma ${tag}: Days row shows a friendly weekday date`, daysText);
        ok(!/20\d{2}-\d{2}-\d{2}/.test(daysText), `Paloma ${tag}: Days row does not show ISO dates`, daysText);
        const partnerText = await page.evaluate(() => (document.querySelector('.sl.partner') || {}).innerText || '');
        ok(!/Access charges/.test(partnerText), `Paloma ${tag}: partnership copy does not say “Access charges”`, partnerText);
        ok(/Stairs or tight access may add to the total/.test(partnerText), `Paloma ${tag}: partnership copy uses plain access wording`, partnerText);
        await shot(page, `install-upsell-v2-palomas-review-${tag}.png`);
        await page.click('[data-upsell-yes]');
        await page.waitForSelector('[data-install-step]', { timeout: 10000 });
        await page.waitForTimeout(400);
        ok(!!(await page.$('[data-hw]')), `Paloma ${tag}: hardware is asked for the hung piece`);
        const status0 = await page.locator('[data-upsell-status]').innerText();
        ok(/Estimated total with installation/.test(status0), `Paloma ${tag}: before hardware is picked, status is Estimated total with installation`, status0);
        await stepLayout(page, 'Paloma ' + tag);
        await shot(page, `install-upsell-v2-palomas-step-${tag}.png`, true);
        await page.click('[data-set="hardware"][data-val="wire"]');
        await page.waitForTimeout(300);
        if (await page.$('[data-set="hh"][data-val="standard"]')) await page.click('[data-set="hh"][data-val="standard"]');
        await page.waitForTimeout(700);
        const status1 = await page.locator('[data-upsell-status]').innerText();
        ok(/Installation adds/.test(status1) && /New order total/.test(status1), `Paloma ${tag}: live price line after a firm hardware choice`, status1);
        const nextVisible = await page.$('#nextBtn:not([hidden])');
        if (nextVisible) await page.click('#nextBtn', { force: true });
        else await page.evaluate(() => window.__CAD_PALOMAS__ && window.__CAD_PALOMAS__.confirm && window.__CAD_PALOMAS__.confirm());
        await page.waitForFunction(() => document.querySelector('[data-install-added]') || document.querySelector('[data-upsell-status]'), null, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(400);
        ok(!!(await page.$('[data-install-added]')), `Paloma ${tag}: Installation added is on Review`);
        ok(await page.locator('[data-upsell-remove]').count(), `Paloma ${tag}: Remove is available`);
        const palPrice = await page.evaluate(() => (document.querySelector('#sumBody') || document.body).innerText);
        ok(!/1\.5%/.test(palPrice), `Paloma ${tag}: protection line has no 1.5% formula`);
        await shot(page, `install-upsell-v2-palomas-after-${tag}.png`);
        await page.click('[data-upsell-remove]');
        await page.waitForTimeout(700);
        ok(!!(await page.$('[data-upsell]')), `Paloma ${tag}: Remove restores the offer card`);
        await ctx.close();
      };
      await runPal(390, 844, '390', true);
      await runPal(360, 800, '360', true);
      await runPal(1280, 900, 'desktop', false);
    }

    await browser.close();
  } finally {
    try { child.kill('SIGTERM'); } catch {}
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
