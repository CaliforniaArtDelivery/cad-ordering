/**
 * Dedicated trips per side (Chad, Nov 25 2026: t2069u, t2071u, t2073u, t2074u, t2075u).
 *   - Pricing (internal, config.dedicatedTrip): pooled round-trip extra hours, $100/h for the first 5 h, $50/h after, $50 minimum,
 *     +$100 weekend, folded into the price (no line item, rate or hours shown to the customer).
 *   - Dates: a dedicated side drops the route-date requirement; any open date that fits the CAD SCHEDULE; Next enables once picked.
 *   - Custom date request when no dedicated date works.
 * API + headless Chromium at 390 px. Screenshots (optional): DED_SHOTS=1 -> /workspace/reviews/dedicated-local-*.png
 *   node scripts/dedicated-dates-test.js
 */
// Route dates come only from the CAD SCHEDULE digest; this older test runs against the stand-in built from the weekly catalog (never production).
if (!process.env.SHEET_DAYS_FIXTURE) process.env.SHEET_DAYS_FIXTURE = 'catalog';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');
const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };

const F = require('../lib/dedicated-fee');
const { quote } = require('../lib/pricing');
const cfg = require('../config').dedicatedTrip;

const ITEM = { id: 'pcA', type: 'painting', description: 'Abstract canvas', w: '60', h: '40', d: '2', framed: 'no', value: '3000', photos: [], hangHeight: 'standard', crateStatus: 'not_sure' };
const site = (street, city, zip) => ({ street, city, state: 'CA', zip, country: 'United States', sameAsMe: true, contactName: 'Dedicated Tester', contactPhone: '4155550123', contactRole: '' });
const ORDER = () => ({
  service: 'pickup_delivery', items: [{ ...ITEM }],
  pickup: site('1000 Main St', 'Napa', '94559'), dropoff: site('73000 El Paseo', 'Palm Desert', '92260'),
  contact: { name: 'Dedicated Tester', email: 'ded@example.com', phone: '4155550123', company: '', clientType: 'Collector' },
  heard: { repeatAnswer: 'yes', repeatClient: true }, payer: 'me',
  schedule: { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' },
});
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => iso(Date.parse(d + 'T12:00:00Z') + n * 864e5);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();

(async () => {
  hdr('Fee rules (config.dedicatedTrip, internal)');
  ok(F.sideHours({ city: 'Carmel', state: 'CA' }, '').hours === 3 && F.feeForHours(3) === 300, 'Carmel from San Jose: ~3 h round trip = +$300', F.sideHours({ city: 'Carmel' }, ''));
  ok(F.sideHours({ city: 'Sacramento', state: 'CA' }, '').hours === 5 && F.feeForHours(5) === 500, 'Sacramento from San Jose: ~5 h = +$500', F.sideHours({ city: 'Sacramento' }, ''));
  ok(F.feeForHours(7) === 600, '7 h pool = 5 x $100 + 2 x $50 = $600', F.feeForHours(7));
  ok(F.feeForHours(0.5) === 50 && F.feeForHours(0) === 50, 'near-hub minimum $50');
  ok(F.sideHours({ city: 'Irvine', state: 'CA' }, '').from === 'Irvine', 'SoCal addresses start from the Irvine hub');
  const base = { ...ORDER(), pickup: site('1 Ocean Ave', 'Carmel', '93923'), dropoff: site('1 Capitol Mall', 'Sacramento', '95814') };
  // A weekday with no route regions near either address is hard to guarantee; price with no date (hubs only).
  const reg = quote(base).total;
  const pu = quote({ ...base, dedicatedPickup: true }).total, de = quote({ ...base, dedicatedDelivery: true }).total, both = quote({ ...base, dedicatedPickup: true, dedicatedDelivery: true }).total;
  ok(pu - reg === 300, `dedicated pickup (Carmel) adds $300: ${reg} -> ${pu}`);
  ok(de - reg === 500, `dedicated delivery (Sacramento) adds $500: ${reg} -> ${de}`);
  ok(both - reg === 650, `both sides pool 3 + 5 = 8 h = $650: ${reg} -> ${both}`);
  const sat = (() => { let d = F.window().min; while (dow(d) !== 6 || F.dateProblem(d)) d = addDays(d, 1); return d; })();
  const satOrder = { ...base, dedicatedPickup: true, schedule: { ...base.schedule, date: sat, deliveryDate: addDays(sat, 3) } };
  const satFee = F.fees(satOrder);
  ok(satFee.weekend && satFee.fee === F.feeForHours(satFee.hours) + cfg.weekendFee, `weekend dedicated date (${sat}) adds $${cfg.weekendFee}`, satFee);
  const nearHub = { ...base, pickup: site('100 Gradell Pl', 'San Jose', '95148'), dedicatedPickup: true };
  ok(F.fees(nearHub).fee === 50, 'near-hub dedicated pickup = $50 minimum', F.fees(nearHub));
  const q = quote({ ...base, dedicatedPickup: true, dedicatedDelivery: true });
  ok(q.paymentPlan !== 'quote' && !q.quoteRange, 'one exact price, no range, payable online', q.paymentPlan);
  const txt = JSON.stringify(q);
  ok(!/dedicated trip|\/h|per hour|hours|hub|Gradell|weekend/i.test(q.lines.map((l) => l.label).join(' ')) && !/"fee"|"hours"|"hub"|"from"/.test(txt), 'no dedicated line item, rate, hours or hub in the customer quote', q.lines);
  ok(Math.round(q.total) % 5 === 0, 'total rounded to the nearest $5', q.total);

  hdr('Server: dates and orders');
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-ded-')), TEST_MODE: '1', SKIP_GEOCODE: '1', BASE_URL: BASE }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
  let browser;
  try {
    const conf = await (await fetch(BASE + '/api/config')).json();
    ok(conf.dedicated && conf.dedicated.min && !('ratePerHour' in conf.dedicated) && !JSON.stringify(conf).includes('ratePerHour'), '/api/config sends dedicated dates only, never the fee rules', conf.dedicated && Object.keys(conf.dedicated));
    const o = ORDER();
    const av = (await post('/api/availability', { ...o, leg: 'pairs' })).j;
    ok(av && av.days.length && av.delivery.days.length && av.dedicatedBlocked, 'pairs availability includes route days and dedicated blocked dates');
    const rPu = av.days[0].date, rDe = av.pairs[rPu][0];
    const pick = (blocked, from, avoid = []) => { let d = from; while (blocked.includes(d) || [0, 6].includes(dow(d)) || avoid.includes(d) || F.dateProblem(d)) d = addDays(d, 1); return d; };
    const dPu = pick(av.dedicatedBlocked.pickup, conf.dedicated.min, av.days.map((x) => x.date));
    const dDe = pick(av.dedicatedBlocked.delivery, addDays(dPu, 1), av.delivery.days.map((x) => x.date));
    const delAfter = (av.deliveryAny || []).find((x) => x.date >= dPu);
    const cases = [
      ['route dates only', {}, { date: rPu, deliveryDate: rDe }, 'awaiting_payment'],
      ['dedicated pickup only', { dedicatedPickup: true }, { date: dPu, deliveryDate: delAfter && delAfter.date }, 'awaiting_payment'],
      ['dedicated delivery only', { dedicatedDelivery: true }, { date: rPu, deliveryDate: pick(av.dedicatedBlocked.delivery, rPu, av.delivery.days.map((x) => x.date)) }, 'awaiting_payment'],
      ['both dedicated', { dedicatedPickup: true, dedicatedDelivery: true }, { date: dPu, deliveryDate: dDe }, 'awaiting_payment'],
    ];
    const totals = {};
    for (const [name, flags, sc, status] of cases) {
      const body = { ...ORDER(), ...flags, dedicated: !!(flags.dedicatedPickup || flags.dedicatedDelivery), contact: { ...ORDER().contact, email: `ded+${name.replace(/\W/g, '')}@example.com` }, schedule: { ...ORDER().schedule, ...sc } };
      const qq = (await post('/api/quote', body)).j; totals[name] = qq && qq.total;
      const r = await post('/api/orders', body);
      ok(r.status === 200 && r.j && r.j.status === status, `${name}: order accepted (${sc.date} / ${sc.deliveryDate}), total $${qq && qq.total}`, r.j);
      if (r.j && r.j.order) {
        const ord = r.j.order;
        ok(!!ord.dedicatedPickup === !!flags.dedicatedPickup && !!ord.dedicatedDelivery === !!flags.dedicatedDelivery, `${name}: order records which sides are dedicated`);
        const rows = JSON.stringify(require('../lib/schedule').rowsForOrder(ord));
        if (flags.dedicatedPickup || flags.dedicatedDelivery) ok(/DEDICATED TRIP: /.test(rows) && (!flags.dedicatedPickup || /PICKUP \d{4}/.test(rows)) && (!flags.dedicatedDelivery || /DELIVERY \d{4}/.test(rows)) && /Dedicated trip \(off the regular route\)/.test(rows), `${name}: sheet rows label the dedicated side(s) and the internal fee`);
        else ok(!/DEDICATED/.test(rows), `${name}: no dedicated label on the sheet`);
        const mail = JSON.stringify(require('../lib/email').confirmationText(ord, false));
        ok(!/\/h|per hour|hours|Gradell|hub|weekend/i.test(mail) && (!(flags.dedicatedPickup || flags.dedicatedDelivery) || /dedicated (pickup|delivery)/.test(mail)), `${name}: confirmation email names the dedicated side, no fee breakdown`);
      }
    }
    ok(totals['dedicated pickup only'] > totals['route dates only'] && totals['both dedicated'] > totals['dedicated pickup only'], 'prices step up: route < one side < both', totals);
    // A route-only order on a non-route date is still refused (toggle off restores the requirement).
    const bad = await post('/api/orders', { ...ORDER(), contact: { ...ORDER().contact, email: 'ded+bad@example.com' }, schedule: { ...ORDER().schedule, date: dPu, deliveryDate: dDe } });
    ok(bad.status === 400 && /route day/i.test(bad.j && bad.j.error), 'without a dedicated side, a non-route date is refused', bad.j);
    const tooSoon = await post('/api/orders', { ...ORDER(), dedicatedPickup: true, dedicated: true, contact: { ...ORDER().contact, email: 'ded+soon@example.com' }, schedule: { ...ORDER().schedule, date: iso(Date.now()), deliveryDate: dDe } });
    ok(tooSoon.status === 400, 'a dedicated date inside the lead time is refused', tooSoon.j);
    const custom = await post('/api/orders', { ...ORDER(), dedicatedPickup: true, dedicated: true, customDate: true, contact: { ...ORDER().contact, email: 'ded+custom@example.com' }, schedule: { ...ORDER().schedule, customDateNote: 'Any weekday the week of Jan 4' } });
    ok(custom.status === 200 && custom.j.status === 'pending_approval' && custom.j.order.customDate && /CUSTOM DATE REQUEST/.test(JSON.stringify(custom.j.order.review || {})), 'custom date request goes to the team as a request (pending, recorded)', custom.j);
    ok(/CUSTOM DATE REQUEST/.test(JSON.stringify(require('../lib/schedule').rowsForOrder(custom.j.order))), 'custom date request is labelled on the sheet rows');
    ok(/Custom date request/.test(JSON.stringify(require('../lib/email').requestText(custom.j.order, false))), 'request email names the custom date request');

    hdr('Browser at 390 px');
    const pw = require('playwright');
    browser = await pw.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript((seed) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('cad-order', JSON.stringify(seed)); localStorage.setItem('cad-step', '2'); localStorage.setItem('cad-saved-at', String(Date.now())); } }, ORDER());
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '/'); await page.waitForSelector('[data-ded="pickup"]');
    const settle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !/Updating/.test((document.querySelector('#estLabel') || {}).textContent || '') && !document.querySelector('#nextBtn').classList.contains('is-busy'), null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500); };
    const state = () => page.evaluate(() => ({ wait: document.querySelector('#nextBtn').classList.contains('is-wait') || document.querySelector('#nextBtn').disabled, left: ((document.querySelector('.dock') || document.body).innerText.split('\n')[0] || ''), total: (document.querySelector('#estTotal') || {}).textContent, body: document.querySelector('main, #app, body').innerText }));
    const shot = async (n) => { if (process.env.DED_SHOTS) await page.screenshot({ path: `/workspace/reviews/dedicated-local-${n}.png`, fullPage: true }); };
    let s0 = await state();
    ok(/None of these dates work for you\?/.test(s0.body) && /Select a dedicated trip/.test(s0.body) && /on a date that works for you/.test(s0.body) && !/at a time that works/.test(s0.body), 'copy: question, toggle label and helper text');
    ok(/1 field left: Pickup date/.test(s0.left) && s0.wait, 'route dates only: Next waits for the pickup date', s0.left);
    ok(!/call us|phone/i.test(s0.body), 'no phone prompts on the date step');
    await shot('toggle-off');
    await page.click('[data-ded="pickup"] .sw'); await settle();
    let s1 = await state();
    ok(await page.$('[data-deddate="pickup"]') && /1 field left: Pickup date/.test(s1.left), 'dedicated pickup on: a date picker replaces the route days; still 1 field left', s1.left);
    await page.fill('[data-deddate="pickup"]', dPu); await settle();
    const delCard = await page.$(`[data-deldate="${delAfter.date}"]`);
    ok(!!delCard, 'delivery route days on/after the dedicated pickup are offered');
    if (delCard) await delCard.click(); await settle();
    let s2 = await state();
    const qPu = (await post('/api/quote', { ...ORDER(), dedicatedPickup: true, dedicated: true, schedule: { ...ORDER().schedule, date: dPu, deliveryDate: delAfter.date } })).j.total;
    ok(!s2.wait && !/field/.test(s2.left), 'dedicated pickup with a date chosen: Next is enabled', s2.left);
    ok(s2.total === '$' + qPu.toLocaleString('en-US'), `one exact price shown (${s2.total}), matches the server`, [s2.total, qPu]);
    ok(!/–/.test(s2.total) && !/per hour|\/hr|hours? of driving|drive time/i.test(s2.body), 'no range and no fee breakdown on screen');
    await shot('pickup-dedicated');
    await page.click('[data-ded="delivery"] .sw'); await settle();
    let s3 = await state();
    ok(/1 field left: Delivery date/.test(s3.left) && s3.wait, 'dedicated delivery on: Next waits for the delivery date', s3.left);
    await page.fill('[data-deddate="delivery"]', dDe); await settle();
    let s4 = await state();
    const qBoth = (await post('/api/quote', { ...ORDER(), dedicatedPickup: true, dedicatedDelivery: true, dedicated: true, schedule: { ...ORDER().schedule, date: dPu, deliveryDate: dDe } })).j.total;
    ok(!s4.wait && s4.total === '$' + qBoth.toLocaleString('en-US'), `both dedicated: Next enabled, ${s4.total}`, [s4.left, s4.total, qBoth]);
    await shot('both-dedicated');
    await page.click('[data-ded="pickup"] .sw'); await settle();
    let s5 = await state();
    ok(s5.wait && /Pickup date/.test(s5.left) && await page.$('[data-ded="pickup"] [data-deddate]') === null, 'toggle off: the route-date requirement comes back', s5.left);
    // Custom date request
    await page.click('[data-ded="pickup"] .sw'); await settle();
    await page.check('[data-path="customDate"]'); await settle();
    let s6 = await state();
    ok(/Dates that would work/.test(s6.left), 'custom date request asks which dates would work', s6.left);
    await page.fill('[id="f-schedule.customDateNote"]', 'Any weekday in January'); await settle();
    let s7 = await state();
    ok(!s7.wait, 'custom date request with a note: Next enabled', s7.left);
    ok(!errs.length, 'no page errors', errs);
  } finally {
    if (browser) await browser.close();
    child.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
