// Screenshots for Chad's Nov 21 changes at 390 (iPhone 13) and 1440. BASE=<site> SHOTS=<dir> node scripts/nov21-shots.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const OUT = process.env.SHOTS || '/workspace/plates/nov21';
const TAG = process.env.TAG || 'local';
const stop = (street, city, zip, x = {}) => ({ street, city, state: 'CA', zip, country: 'United States', contactName: 'Jordan Lee', contactPhone: '3105550199', sameAsMe: true, accessMode: 'ground', pathPick: 'ground', fits: 'yes', ...x });
const piece = (x = {}) => ({ id: 'pcA' + Math.random().toString(36).slice(2, 6), type: 'painting', description: 'Oil on canvas', w: '40', h: '30', d: '2', framed: 'yes', glazing: 'no', frameType: '', value: '8000', weight: '', photos: [], hangHeight: 'standard', ...x });
const base = (service, items, x = {}) => ({ service, items, contact: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '3105550199', company: '', clientType: 'Collector' }, heard: { source: 'google' }, pickup: stop('2 Henry Adams St', 'San Francisco', '94103'), dropoff: stop('8678 Melrose Ave', 'West Hollywood', '90069'), schedule: { date: '', deliveryDate: '', timePref: 'none', deliveryTimePref: 'none' }, ...x });
(async () => {
  const browser = await chromium.launch();
  const out = [];
  for (const [vw, vh, name] of [[390, 844, '390'], [1440, 1000, '1440']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vw < 500 ? 3 : 1, isMobile: vw < 500, hasTouch: vw < 500 });
    const page = await ctx.newPage();
    const open = async (state, stepN, sub) => {
      await page.goto(BASE + '/cad-logo.jpg'); // same origin, no app script (so nothing re-saves the old step on unload)
      await page.evaluate(([s, st, sb]) => { sessionStorage.clear(); sessionStorage.setItem('cad-order', JSON.stringify(s)); sessionStorage.setItem('cad-step', String(st)); sessionStorage.setItem('cad-sub', sb); }, [state, stepN, sub]);
      await page.goto(BASE + '/?shot=' + Date.now());
      await page.waitForTimeout(1800);
    };
    const shot = async (file, full = true) => { const p = `${OUT}/${TAG}_${file}_${name}.png`; await page.screenshot({ path: p, fullPage: full }); out.push(p); };
    // Date screen: nothing picked, pickup picked, delivery picked first
    await open(base('pickup_delivery', [piece()]), 2, 'date');
    await page.waitForSelector('[data-deldate]', { timeout: 20000 });
    await shot('dates_empty');
    await page.click('[data-reqblock="date"] [data-date] >> nth=2'); await page.waitForTimeout(500);
    await shot('dates_pickup_first');
    await page.click('[data-clear="pu"]'); await page.waitForTimeout(300);
    await page.click('[data-reqblock="deldate"] [data-deldate]:not([data-off]) >> nth=1'); await page.waitForTimeout(500);
    await shot('dates_delivery_first');
    // Hardware screen (delivery + install, two hung pieces)
    await open(base('delivery_install', [piece({ description: 'Oil on canvas' }), piece({ type: 'mirror', description: 'Gilt mirror', framed: '', glazing: '' })]), 1, 'hang');
    await page.click('[data-seg="items.0.hardware"] [data-v="zbar"]', { timeout: 5000 }); await page.waitForTimeout(300);
    await shot('hardware');
    await open(base('delivery_install', [piece()]), 1, 'hang-p0');
    await page.click('[data-seg="items.0.hangPick"] [data-v="mantel"]'); await page.waitForTimeout(300);
    await shot('hang_height');
    // Weight block (450 lb painting) and a surcharge example (160 lb)
    await open(base('pickup_delivery', [piece({ weight: '450' })]), 0, 'p0c');
    await shot('weight_block');
    await open(base('pickup_delivery', [piece({ weight: '160' })]), 0, 'p0c');
    await shot('weight_160');
    // Glass on an unframed piece, path question, contact, address with collapsed extras, heard follow-up
    await open(base('pickup_delivery', [piece({ type: 'wallart', framed: 'no', glazing: '', description: 'Mixed media' })]), 0, 'p0b');
    await shot('glass_unframed');
    await open(base('pickup_delivery', [piece()], { pickup: stop('2 Henry Adams St', 'San Francisco', '94103', { accessMode: 'stairs', pathPick: 'stairs2', stairFlights: '2', stairDir: 'up' }) }), 1, 'pickup-access');
    await shot('path_pickup');
    await open(base('pickup_delivery', [piece()]), 1, 'dropoff-contact');
    await shot('contact_delivery');
    await open(base('pickup_delivery', [piece()]), 1, 'pickup-addr');
    await shot('address_extras_closed');
    await page.click('[data-extras="pickup"] summary'); await page.waitForTimeout(300);
    await shot('address_extras_open');
    await open(base('pickup_delivery', [piece()], { heard: { source: 'referral', referrerKind: 'friend' } }), 1, 'heard');
    await shot('heard_referral');
    await open(base('pickup_delivery', [piece()], { heard: { source: 'ai' } }), 1, 'heard');
    await shot('heard_ai');
    await open(base('pickup_delivery', [piece()]), 0, 'pieces-more');
    await shot('anything_else');
    await ctx.close();
  }
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
