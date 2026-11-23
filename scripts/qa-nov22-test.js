/**
 * QA audit Nov 22 2026 (ordering flow polish): server and static checks. No real money, nothing sent.
 *   node scripts/qa-nov22-test.js
 * - Shipping with BOTH ends in California is refused with a clear "choose Pickup + Delivery" message (and saves nothing).
 * - Shipping to another state or abroad is not touched by that guard.
 * - index.html has a meta description, share tags, PNG/ICO favicons; the share image and icons exist.
 * - Customer copy: no staff first names in shipping copy, no "fully insured" claim, no phone numbers, "white glove" never hyphenated.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PORT = 4600 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-qa22-'));
Object.assign(process.env, { PORT: String(PORT), STORAGE_DIR: STORAGE, TEST_MODE: '1', BASE_URL: BASE });
delete process.env.ADMIN_KEY; delete process.env.STRIPE_SECRET_KEY; delete process.env.SHEETS_WEBHOOK_URL;
const email = require('../lib/email'); email.send = async () => ({ skipped: true });
const sheetSync = require('../lib/sheets-sync'); sheetSync.enqueue = () => {}; sheetSync.alert = async () => {};

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const ORDERS = path.join(STORAGE, 'data', 'orders.json');
const saved = () => { try { return JSON.parse(fs.readFileSync(ORDERS, 'utf8')).length; } catch { return 0; } };
const stop = (street, city, zip, extra = {}) => ({ street, city, state: 'CA', zip, contactName: 'Pat', contactPhone: '310-555-0110', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes', ...extra });
const ship = (over = {}) => ({
  service: 'crating_shipping', payer: 'me', contact: { name: 'Ship Client', email: 'ship@example.com', phone: '310-555-0103', clientType: 'Collector' },
  pickup: stop('1 Ferry Building', 'San Francisco', '94111'), dropoff: { ...stop('200 Santa Monica Pier', 'Santa Monica', '90401'), country: 'United States', locationType: 'residential' },
  items: [{ type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 9000, weight: 40, description: 'QA canvas' }],
  shipping: { serviceLevel: 'standard', flexible: true }, ...over,
});

require('../server.js');
setTimeout(async () => {
  try {
    hdr('1. Shipping inside California is refused with a clear way forward');
    const before = saved();
    const r = await post('/api/orders', ship());
    ok(r.status === 400 && r.j && r.j.caToCa === true, 'SF to Santa Monica as Shipping returns 400 caToCa', r);
    ok(r.j && /Pickup \+ Delivery/.test(r.j.error) && !/Missing:/.test(r.j.error), 'message says to choose Pickup + Delivery (not a "Missing:" list)', r.j);
    ok(saved() === before, 'nothing saved');
    const zipOnly = await post('/api/orders', ship({ dropoff: { ...stop('200 Santa Monica Pier', 'Santa Monica', '90401', { state: '' }), country: '' } }));
    ok(zipOnly.status === 400 && zipOnly.j.caToCa, 'a California ZIP with a blank state is still caught', zipOnly);
    hdr('2. Out-of-state and international shipping are not touched by the guard');
    const ny = await post('/api/orders', ship({ dropoff: { ...stop('9 Broadway', 'New York', '10004', { state: 'NY' }), country: 'United States', locationType: 'residential' } }));
    ok(!(ny.j && ny.j.caToCa), 'SF to New York is not refused as CA-to-CA', ny);
    const uk = await post('/api/orders', ship({ dropoff: { street: 'Flat 2, Downing Court, SW1A 2AA', city: 'London', country: 'United Kingdom', contactName: 'Sam', contactPhone: '+44 20 7946 0000', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' } }));
    ok(!(uk.j && uk.j.caToCa), 'SF to London is not refused as CA-to-CA', uk);
    const pd = await post('/api/orders', { ...ship(), service: 'pickup_delivery' });
    ok(!(pd.j && pd.j.caToCa), 'the same addresses as Pickup + Delivery are never hit by the guard', pd);

    hdr('3. index.html: description, share tags, icons');
    const pub = (f) => path.join(__dirname, '..', 'public', f);
    const html = fs.readFileSync(pub('index.html'), 'utf8');
    ok(/<meta name="description" content="[^"]{60,}">/.test(html), 'meta description present');
    ok(/property="og:image" content="https:\/\/[^"]+og-image\.jpg"/.test(html) && /twitter:card" content="summary_large_image"/.test(html), 'og:image + twitter card');
    ok(/rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32\.png"/.test(html) && /href="\/favicon\.ico"/.test(html) && /apple-touch-icon" sizes="180x180"/.test(html), 'PNG + ICO favicon and 180px apple-touch-icon');
    ok(!/cad-logo\.jpg" ?>?\s*$/m.test(html.split('\n').filter((l) => /rel="(icon|apple-touch-icon)"/.test(l)).join('\n')), 'favicon is no longer the 1023px JPG');
    for (const f of ['og-image.jpg', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png']) ok(fs.existsSync(pub(f)) && fs.statSync(pub(f)).size > 500, `${f} exists`);
    ok(/id="dockErr"/.test(html), 'dock has an error line next to the primary button');

    hdr('4. Customer copy');
    const app = fs.readFileSync(pub('app.js'), 'utf8');
    const custom = app.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    ok(!/Samantha/.test(custom.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'no staff first name in customer-facing app copy');
    ok(!/fully insured/i.test(app), 'no "fully insured" claim');
    ok(!/white-glove/i.test(app + html), '"white glove" never hyphenated');
    ok(!/\(\d{3}\)\s?\d{3}-\d{4}(?![^<]*placeholder)/.test(html) && !/call us/i.test(app + html), 'no CAD phone number or "call us" text');
    ok(/Art, furniture, decor, and antiques/.test(app), 'service intro says "art, furniture, decor, and antiques"');
    ok(/We couldn’t send that\. Check your connection and tap again\./.test(app), 'network error copy updated');
    const em = fs.readFileSync(path.join(__dirname, '..', 'lib', 'email.js'), 'utf8');
    ok(!/Samantha (prices|is preparing|is pricing)|She’ll email/.test(em), 'customer emails say "our team", not a staff first name');
    hdr('5. Round 2 (QA re-check): state vs ZIP, badge, placeholders, review address');
    const V = require('../public/validate');
    const P = (a) => V.addressProblems({ street: '350 5th Ave', city: 'New York', ...a });
    ok(P({ state: 'CA', zip: '10001' }).some((x) => x.field === 'zip' && /isn’t in California/.test(x.message)), '"New York, CA 10001" is refused (ZIP not in California)');
    ok(P({ state: 'NY', zip: '94111' }).some((x) => x.field === 'state'), 'a California ZIP with state NY is refused');
    ok(P({ state: 'NY', zip: '10001' }).length === 0 && P({ state: '', zip: '10001' }).length === 0, 'NY + 10001 and a blank state are fine');
    const nyca = await post('/api/orders', ship({ dropoff: { ...stop('350 5th Ave', 'New York', '10001'), country: 'United States', locationType: 'residential' } }));
    ok(nyca.status === 400 && /ZIP code that matches the state/.test(nyca.j.error), 'server refuses a "New York, CA 10001" destination', nyca);
    const cfg = await (await fetch(BASE + '/api/config')).json();
    ok(cfg.stripeTestMode === false && cfg.livemode === false, 'config reports stripeTestMode only when a Stripe test key is in use');
    ok(/CFG\.stripeTestMode && !CFG\.livemode \? 'Stripe test mode' : 'Secure payment by Stripe'/.test(app), 'badge says "Stripe test mode" only in Stripe test mode');
    ok(/shipDest \? '350 5th Ave'/.test(app) && /shipDest \? 'New York'/.test(app) && /shipDest \? '10118'/.test(app), 'Shipping destination uses out-of-state examples');
    ok(/\[a\.state, a\.zip\]/.test(app), 'in-state review shows state and ZIP');
    ok(/zipMismatch\[key\]/.test(app) && /City and ZIP don’t match/.test(app), 'a city/ZIP mismatch is a required fix (blocks Next)');
    ok(/state: a\.state == null \? 'CA'/.test(app) && /function normShipState/.test(app), 'Shipping destination State starts blank');
  } catch (e) { fail++; console.log('  FAIL: exception', e && e.stack); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 700);
