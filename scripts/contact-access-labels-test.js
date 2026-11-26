/**
 * Chad Nov 25–26 2026 (t2061u–t2068u): side-specific contact labels, and access
 * questions only for heavy/big (path/stairs) or truly giant (doorway) pieces, on
 * BOTH pickup and delivery. Headless Chromium at iPhone width (390×844).
 * Screenshots: /workspace/reviews/contact-labels-*.png
 *              /workspace/reviews/access-conditional-*.png
 *   node scripts/contact-access-labels-test.js
 */
// Route dates come only from the CAD SCHEDULE digest; this older test runs against the stand-in built from the weekly catalog (never production).
if (!process.env.SHEET_DAYS_FIXTURE) process.env.SHEET_DAYS_FIXTURE = 'catalog';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright');
const ACCESS = require('../public/access');
const pricing = require('../lib/pricing');
const email = require('../lib/email');

const PORT = 4710 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = '/workspace/reviews';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');

const painting = (o = {}) => ({ id: 'pc1', type: 'painting', description: 'Canvas', w: '48', h: '60', d: '2', framed: 'no', glazing: 'no', value: '8000', photos: [], qty: 1, ...o });
const addr = (street, city, zip) => ({
  street, city, state: 'CA', zip, country: 'United States',
  contactName: 'Chad Chapman', contactPhone: '3105550199', sameAsMe: true, contactRole: '',
});
const orderBase = (items, extra = {}) => ({
  service: 'pickup_delivery',
  serviceLabel: 'Pickup + Delivery',
  items,
  contact: { name: 'Chad Chapman', email: 'chad@example.com', phone: '3105550199', clientType: 'Collector' },
  heard: { repeatAnswer: 'yes', repeatClient: true, source: '' },
  payer: 'pickup',
  pickup: addr('1 Main Street', 'Los Angeles', '90069'),
  dropoff: addr('2 Henry Adams St', 'San Francisco', '94103'),
  schedule: { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' },
  notes: '',
  ...extra,
});

// ---------- unit: thresholds, gaps, pricing, emails ----------
hdr('0. Access thresholds and labels (no browser)');
const pathYes = (it, why) => ok(ACCESS.isPathAccessPiece(it), 'path YES: ' + why);
const pathNo = (it, why) => ok(!ACCESS.isPathAccessPiece(it), 'path NO: ' + why);
const doorYes = (it, why) => ok(ACCESS.isDoorwayAccessPiece(it), 'doorway YES: ' + why);
const doorNo = (it, why) => ok(!ACCESS.isDoorwayAccessPiece(it), 'doorway NO: ' + why);

pathNo(painting(), 'unframed 48×60 painting (Chad’s live test / 60 in)');
pathNo(painting({ w: '72', h: '48' }), 'wall art exactly 72 in is not over 72');
pathYes(painting({ w: '73', h: '48' }), 'wall art longest side 73 in (> 72)');
doorNo(painting(), '48×60 is not giant');
doorNo(painting({ w: '80', h: '40' }), '80 in wall art gets path but not doorway (< 96)');
doorYes(painting({ w: '96', h: '40' }), 'wall art longest side 96 in');
pathYes(painting({ w: '80', h: '40' }), '80 in wall art gets path/stairs');

pathYes({ type: 'mirror', w: '60', h: '40', d: '2' }, 'mirror face 60 in (large-mirror transport threshold)');
pathNo({ type: 'mirror', w: '59', h: '40', d: '2' }, 'mirror face 59 in, no heavy weight');
pathYes({ type: 'mirror', w: '40', h: '30', d: '2', weight: '151' }, 'mirror over 150 lb');
doorNo({ type: 'mirror', w: '70', h: '40', d: '2' }, '70 in mirror is not >= 96 in');
doorYes({ type: 'mirror', w: '96', h: '40', d: '2' }, '96 in mirror is oversized wall-hung');
pathYes({ type: 'decor', furnitureKind: 'Mirror', w: '60', h: '40', d: '2' }, 'Décor → Mirror at 60 in face');

pathYes({ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium' }, 'sofa (any size class)');
pathYes({ type: 'furniture', furnitureKind: 'Loveseat', sizeClass: 'small' }, 'loveseat');
pathYes({ type: 'furniture', furnitureKind: 'Recliner / Lounge Chair', sizeClass: 'medium' }, 'recliner');
pathYes({ type: 'furniture', furnitureKind: 'Desk', sizeClass: 'medium' }, 'desk');
pathYes({ type: 'furniture', furnitureKind: 'Armchair / Accent Chair', sizeClass: 'large' }, 'large armchair (any large furniture)');
pathNo({ type: 'furniture', furnitureKind: 'Armchair / Accent Chair', sizeClass: 'medium' }, 'medium armchair — lean not to ask');
pathNo({ type: 'furniture', furnitureKind: 'Nightstand', sizeClass: 'medium' }, 'medium nightstand');
doorYes({ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium' }, 'sofa gets doorway');
doorYes({ type: 'furniture', furnitureKind: '2-Piece Sectional', sizeClass: 'medium' }, 'sectional gets doorway');
doorYes({ type: 'furniture', furnitureKind: 'Dining Table', sizeClass: 'medium' }, 'dining table gets doorway');
doorNo({ type: 'furniture', furnitureKind: 'Desk', sizeClass: 'medium' }, 'desk: path yes, doorway no');
doorNo({ type: 'furniture', furnitureKind: 'Recliner / Lounge Chair', sizeClass: 'large' }, 'recliner: path yes, doorway no');

pathNo({ type: 'sculpture', w: '20', h: '40', d: '20', weight: '99' }, 'sculpture 99 lb');
pathYes({ type: 'sculpture', w: '20', h: '40', d: '20', weight: '100' }, 'sculpture 100 lb');
doorYes({ type: 'sculpture', w: '20', h: '40', d: '20', weight: '100' }, 'sculpture 100 lb also doorway');
doorNo({ type: 'sculpture', w: '20', h: '96', d: '20' }, 'sculpture 96 in with no weight — lean not to ask doorway');

ok(!ACCESS.asksPathAccess([painting()]), '48×60 order does not ask path');
ok(!ACCESS.asksDoorwayAccess([painting()]), '48×60 order does not ask doorway');
ok(!ACCESS.gaps({ street: '1 Main Street' }, [painting()]).length, 'gaps empty for 48×60 with no access answers (pickup)');
ok(!ACCESS.gaps({ street: '2 Henry Adams St' }, [painting()]).length, 'gaps empty for 48×60 with no access answers (delivery)');
ok(ACCESS.gaps({}, [painting({ w: '80', h: '40' })]).includes('accessMode'), '80 in painting requires a path answer');

const pu = { street: '1 Main Street', city: 'Los Angeles', state: 'CA', zip: '90069', contactName: 'Chad Chapman', contactPhone: '3105550199' };
const de = { street: '2 Henry Adams St', city: 'San Francisco', state: 'CA', zip: '94103', contactName: 'Chad Chapman', contactPhone: '3105550199' };
const qNone = pricing.quote({ service: 'pickup_delivery', items: [painting()], pickup: pu, dropoff: de, schedule: { date: '2026-12-10' }, contact: { name: 'Chad Chapman', email: 'c@x.com' } });
const qGround = pricing.quote({ service: 'pickup_delivery', items: [painting()], pickup: { ...pu, accessMode: 'ground' }, dropoff: { ...de, accessMode: 'ground' }, schedule: { date: '2026-12-10' }, contact: { name: 'Chad Chapman', email: 'c@x.com' } });
const stairLines = (q) => (q.lines || []).filter((l) => /stair|elevator|access/i.test(l.label || ''));
ok(qNone && qGround && qNone.total === qGround.total, 'missing access prices the same as no-stairs / standard', { none: qNone && qNone.total, ground: qGround && qGround.total, lines: stairLines(qNone) });
ok(!stairLines(qNone).length, 'missing access adds no stairs or elevator fee', stairLines(qNone));

const html = email.TEMPLATES.confirmation({
  id: 'CAD-TEST',
  service: 'pickup_delivery',
  serviceLabel: 'Pickup + Delivery',
  contact: { name: 'Chad Chapman', email: 'chad@example.com' },
  schedule: { date: '2026-12-10', deliveryDate: '2026-12-11' },
  pickup: { ...pu, accessMode: 'ground' },
  dropoff: { ...de, accessMode: 'ground' },
  items: [painting()],
  quote: { total: 500, dueNow: 500, lines: [], paymentPlan: 'full' },
  payment: { status: 'paid', amount: 500, method: 'card' },
}).html;
ok(/Pickup contact/.test(html) && /Delivery contact/.test(html), 'confirmation email uses Pickup contact and Delivery contact', html.match(/<b>[^<]*[Cc]ontact[^<]*<\/b>/g));
ok(!/On-site contact/.test(html) && !/<b>Contact<\/b>/.test(html), 'confirmation email has no bare or On-site Contact label');

const shipHtml = email.TEMPLATES.confirmation({
  id: 'CAD-SHIP',
  service: 'crating_shipping',
  serviceLabel: 'Shipping',
  contact: { name: 'Chad Chapman', email: 'chad@example.com' },
  schedule: {},
  shipping: { serviceLevel: 'white_glove', flexible: true },
  pickup: { ...pu, accessMode: 'ground' },
  dropoff: { street: '350 5th Ave', city: 'New York', state: 'NY', zip: '10118', country: 'United States', contactName: 'Pat Recipient', contactPhone: '2125550100' },
  items: [painting()],
  quote: { total: 0, shipping: true, paymentPlan: 'quote' },
  status: 'pending_approval',
}).html;
ok(/Pickup contact/.test(shipHtml) && /Destination contact/.test(shipHtml), 'shipping email uses Pickup contact and Destination contact');

const installHtml = email.TEMPLATES.confirmation({
  id: 'CAD-IN',
  service: 'install_only',
  serviceLabel: 'Installation',
  contact: { name: 'Chad Chapman', email: 'chad@example.com' },
  schedule: { date: '2026-12-10' },
  dropoff: { ...de, accessMode: 'ground' },
  items: [painting()],
  quote: { total: 400, dueNow: 400, lines: [], paymentPlan: 'full' },
  payment: { status: 'paid', amount: 400, method: 'card' },
}).html;
ok(/Install contact/.test(installHtml), 'install email uses Install contact');

(async () => {
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-contact-')), TEST_MODE: '1', BASE_URL: BASE },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const settle = () => page.waitForFunction(() => !/Updating estimate/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const panel = () => page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? p.dataset.panel : ''; });
  const need = () => page.evaluate(() => { const n = document.querySelector('#needLine'); return n && !n.hidden ? n.textContent : ''; });
  const bodyText = () => page.evaluate(() => (document.querySelector('[data-panel]:not([hidden])') || document.body).innerText);
  const shot = async (n) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const hasAccessQs = async () => page.evaluate(() => {
    const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden);
    if (!p) return { path: false, doorway: false, panels: [] };
    const t = p.innerText || '';
    return {
      panel: p.dataset.panel,
      path: /How do we reach the spot/.test(t) || !!p.querySelector('[data-seg$=".pathPick"]'),
      doorway: /Standard doorway and hallway/.test(t) || !!p.querySelector('[data-seg$=".stdDoorway"]'),
      contact: (p.querySelector('[data-contactline]') || {}).textContent || '',
      panels: [...document.querySelectorAll('[data-panel]')].map((x) => x.dataset.panel),
    };
  });
  const seed = async (items, sub, step = 1) => {
    const st = orderBase(items);
    // Load a static asset first so a leftover app tab can't persist the previous step over the new draft.
    await page.goto(BASE + '/cad-logo.jpg');
    await page.evaluate(({ st, sub, step }) => {
      try { sessionStorage.clear(); localStorage.clear(); } catch (e) {}
      localStorage.setItem('cad-order', JSON.stringify(st));
      localStorage.setItem('cad-step', String(step));
      localStorage.setItem('cad-sub', sub);
      localStorage.setItem('cad-saved-at', String(Date.now()));
    }, { st, sub, step });
    await page.goto(BASE + '/?qa=' + Date.now());
    await page.waitForSelector('[data-panel]', { state: 'attached' });
    await page.waitForTimeout(600);
    await settle();
  };
  const next = async () => { await settle(); await page.click('#nextBtn', { force: true }); await page.waitForTimeout(400); };

  try {
    hdr('1. Unframed 48×60 painting: skip access on pickup AND delivery');
    await seed([painting()], 'pickup-addr');
    ok((await panel()) === 'pickup-addr', 'landed on pickup address', await panel());
    let info = await hasAccessQs();
    ok(!info.path && !info.doorway, 'pickup address has no stairs or doorway questions', info);
    ok(!info.panels.includes('pickup-access') && !info.panels.includes('dropoff-access') && !info.panels.includes('pickup-doors') && !info.panels.includes('dropoff-doors'), 'access panels are omitted on both sides for 48×60', info.panels);
    ok(/Pickup contact:\s*you \(Chad Chapman\)/.test(info.contact || (await bodyText())), 'pickup address shows Pickup contact: you (Chad Chapman)', info.contact || await bodyText());
    const needPu = await need();
    ok(!needPu || !/How do we reach|Standard doorway|Access/.test(needPu), 'fields left does not mention access questions on pickup', needPu);
    await shot('access-conditional-pickup-48x60');

    await next();
    ok((await panel()) === 'dropoff-addr', 'Continue goes to delivery address (pickup access skipped)', await panel());
    info = await hasAccessQs();
    ok(!info.path && !info.doorway, 'delivery address has no stairs or doorway questions', info);
    ok(/Delivery contact:\s*you \(Chad Chapman\)/.test(info.contact || (await bodyText())), 'delivery address shows Delivery contact: you (Chad Chapman)', info.contact || await bodyText());
    const needDe = await need();
    ok(!needDe || !/How do we reach|Standard doorway|Access/.test(needDe), 'fields left does not mention access questions on delivery', needDe);
    await shot('access-conditional-delivery-48x60');

    // Server must not require access answers for a 48×60 on either stop (date may still be missing).
    const posted = await page.evaluate(async () => {
      const o = JSON.parse(localStorage.getItem('cad-order'));
      o.pickup.accessMode = ''; o.dropoff.accessMode = '';
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, error: j.error || '', id: j.order && j.order.id };
    });
    const accessErr = /access|how do we get in|doorway|will everything fit/i.test(posted.error || '');
    ok(!accessErr, 'server does not require access answers for 48×60 on pickup or delivery', posted);

    hdr('2. 80 in painting: path/stairs on both sides, no doorway; contact labels');
    await seed([painting({ w: '80', h: '40', description: 'Large canvas' })], 'pickup-access');
    ok((await panel()) === 'pickup-access', '80 in painting opens pickup access', await panel());
    info = await hasAccessQs();
    ok(info.path, 'pickup access asks how we reach the spot', info);
    ok(!info.doorway, '80 in painting does not ask Standard doorway', info);
    ok(/Pickup contact:\s*you \(Chad Chapman\)/.test(info.contact) && /Change/.test(info.contact), 'pickup access: Pickup contact: you (Chad Chapman) Change', info.contact);
    ok(!/^Contact:/.test((info.contact || '').trim()) && !/(\n|^)Contact:/.test(info.contact || ''), 'pickup line is not a bare Contact:', info.contact);
    await shot('contact-labels-pickup');
    await shot('access-conditional-path-pickup');

    // Answer path so we can continue
    if (await page.$('[data-seg="pickup.pathPick"] [data-v="ground"]')) {
      await page.click('[data-seg="pickup.pathPick"] [data-v="ground"]');
      await page.waitForTimeout(300);
    }
    await next();
    ok((await panel()) === 'dropoff-addr' || (await panel()) === 'dropoff-access', 'after pickup access, delivery address or access', await panel());
    if ((await panel()) === 'dropoff-addr') await next();
    ok((await panel()) === 'dropoff-access', '80 in painting opens delivery access', await panel());
    info = await hasAccessQs();
    ok(info.path, 'delivery access asks how we reach the spot (same gate as pickup)', info);
    ok(!info.doorway, 'delivery does not ask Standard doorway for 80 in', info);
    ok(/Delivery contact:\s*you \(Chad Chapman\)/.test(info.contact) && /Change/.test(info.contact), 'delivery access: Delivery contact: you (Chad Chapman) Change', info.contact);
    await shot('contact-labels-delivery');
    await shot('access-conditional-path-delivery');

    if (await page.$('[data-seg="dropoff.pathPick"] [data-v="ground"]')) {
      await page.click('[data-seg="dropoff.pathPick"] [data-v="ground"]');
      await page.waitForTimeout(300);
    }

    // Jump to review
    await page.evaluate(() => { localStorage.setItem('cad-step', '3'); localStorage.setItem('cad-sub', 'review'); });
    await page.reload();
    await page.waitForTimeout(800);
    await settle();
    // If date is required we may land on When; click a day and continue if needed.
    for (let i = 0; i < 8 && (await panel()) !== 'review'; i++) {
      if (await page.locator('[data-reqblock="date"] .day:not(.rush):visible').count()) {
        await page.click('[data-reqblock="date"] .day:not(.rush):visible >> nth=0');
        await page.waitForTimeout(400);
      }
      if (await page.locator('[data-deldate]:not([data-off]):visible').count()) {
        await page.click('[data-deldate]:not([data-off]):visible >> nth=0');
        await page.waitForTimeout(400);
      }
      const before = await panel();
      await next();
      if ((await panel()) === before) break;
    }
    const reviewTxt = await bodyText();
    ok(/Pickup contact:/.test(reviewTxt) && /Delivery contact:/.test(reviewTxt), 'review shows Pickup contact and Delivery contact', reviewTxt.slice(0, 800));
    ok(!/On-site contact/.test(reviewTxt) && !/\bContact:/.test(reviewTxt.replace(/Pickup contact:|Delivery contact:|Install contact:|Destination contact:|Pickup and delivery contact:/g, '')), 'review has no bare Contact label', reviewTxt.match(/[A-Za-z ]*contact:?/gi));
    await shot('contact-labels-review');

    hdr('3. Giant item (96 in / sofa): doorway question on both sides');
    await seed([painting({ w: '96', h: '48', description: 'Oversized canvas' })], 'pickup-access');
    info = await hasAccessQs();
    ok(info.path && info.doorway, '96 in painting asks path and Standard doorway on pickup', info);
    await shot('access-conditional-doorway-pickup');
    if (await page.$('[data-seg="pickup.pathPick"] [data-v="ground"]')) await page.click('[data-seg="pickup.pathPick"] [data-v="ground"]');
    if (await page.$('[data-seg="pickup.stdDoorway"] [data-v="yes"]')) await page.click('[data-seg="pickup.stdDoorway"] [data-v="yes"]');
    await page.waitForTimeout(300);
    await next();
    if ((await panel()) === 'dropoff-addr') await next();
    info = await hasAccessQs();
    ok((await panel()) === 'dropoff-access' && info.path && info.doorway, '96 in painting asks path and Standard doorway on delivery too', { panel: await panel(), ...info });
    await shot('access-conditional-doorway-delivery');

    ok(pageErrors.length === 0, 'no page errors', pageErrors);
  } catch (e) {
    fail++;
    console.log('  FAIL: uncaught', e && e.stack || e);
    try { await shot('contact-access-error'); } catch {}
  } finally {
    await browser.close();
    child.kill();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
