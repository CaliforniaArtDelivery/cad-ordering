/**
 * Endpoint integration tests (Atlas B2, Nov 19). The REAL server.js runs in this process, so the real /api/availability, /api/orders,
 * /api/orders/:id/pay and /api/discount-code handlers are exercised. Side effects are stubbed and COUNTED:
 *   - Stripe: require('stripe') is replaced by a stub (a counter on customers.create / checkout.sessions.create)
 *   - the schedule-sheet webhook: global fetch is wrapped (any POST to the webhook URL is counted and answered locally),
 *     and sheetSync.enqueue / sheetSync.alert are counted
 *   - email: email.send is counted
 *   - persistence: STORAGE_DIR is a temp folder, and orders.json is read straight from disk
 * Rejected requests must leave every counter at zero and orders.json untouched. Positive controls prove the counters are wired.
 *   node scripts/endpoint-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4500 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-endpoint-'));
const HOOK = 'http://127.0.0.1:9/sheet-webhook-stub';
Object.assign(process.env, { PORT: String(PORT), STORAGE_DIR: STORAGE, TEST_MODE: '1', BASE_URL: BASE, STRIPE_SECRET_KEY: 'sk_test_stub_not_real', SHEETS_WEBHOOK_URL: HOOK, SHEETS_WEBHOOK_SECRET: 'stub-secret' });
delete process.env.ADMIN_KEY;

// ---- counters and stubs (installed BEFORE server.js loads) ----
const calls = { stripeCustomer: 0, stripeSession: 0, sheetPost: 0, sheetEnqueue: 0, sheetAlert: 0, email: 0 };
const stripeStub = () => ({
  customers: { create: async () => { calls.stripeCustomer++; return { id: 'cus_stub' }; }, retrieve: async () => { calls.stripeCustomer++; return { id: 'cus_stub' }; } },
  checkout: { sessions: { create: async () => { calls.stripeSession++; return { id: 'cs_stub', url: 'https://stripe.invalid/session' }; }, retrieve: async () => ({}) } },
  webhooks: { constructEvent: () => { throw new Error('stub'); } },
});
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: stripeStub, children: [], paths: [] };
const realFetch = global.fetch;
global.fetch = (url, opts) => {
  if (String(url).startsWith(HOOK)) { calls.sheetPost++; return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); }
  if (/stripe\.com/.test(String(url))) { calls.stripeSession++; return Promise.reject(new Error('no real Stripe in tests')); }
  return realFetch(url, opts);
};
const sheetSync = require('../lib/sheets-sync');
for (const k of ['enqueue', 'alert']) { const orig = sheetSync[k]; sheetSync[k] = (...a) => { calls[k === 'enqueue' ? 'sheetEnqueue' : 'sheetAlert']++; return orig.apply(sheetSync, a); }; }
const email = require('../lib/email');
{ const orig = email.send; email.send = (...a) => { calls.email++; return orig.apply(email, a); }; }

const ORDERS = path.join(STORAGE, 'data', 'orders.json');
const saved = () => { try { return JSON.parse(fs.readFileSync(ORDERS, 'utf8')); } catch { return []; } };
const snap = () => JSON.stringify({ calls, orders: saved().length });
const zeroed = () => Object.values(calls).every((n) => n === 0);

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) => { const r = await realFetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };

const art = (value, o = {}) => ({ type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value, description: 'Endpoint test canvas', ...o });
const stop = (street, city, zip, extra = {}) => ({ street, city, state: 'CA', zip, contactName: 'Pat', contactPhone: '310-555-0110', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes', ...extra });
const body = (date, over = {}) => ({
  service: 'pickup_delivery', payer: 'me', notes: '', contact: { name: 'Endpoint Client', email: 'endpoint@example.com', phone: '310-555-0100', clientType: 'Collector' },
  pickup: stop('2 Henry Adams St', 'San Francisco', '94103'), dropoff: stop('1 Main St', 'San Francisco', '94110'),
  items: [art(5000)], schedule: { date, deliveryDate: date, timePref: 'midday' }, ...over,
});

(async () => {
  require('../server.js');
  for (let i = 0; i < 60; i++) { try { await realFetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
  await sleep(500);
  // Anything the server did while starting (queue pump, sheet-day refresh) is not what is being tested: count from here.
  for (const k of Object.keys(calls)) calls[k] = 0;
  const base0 = body('');
  const av = (await post('/api/availability', base0)).j;
  const D = av && av.days && av.days[0] && av.days[0].date;

  hdr('E1. /api/availability: an invalid address never gets a route or dates');
  {
    ok(!!D, `a valid address gets a route and dates (${D})`);
    const bad = await post('/api/availability', { ...base0, pickup: { ...base0.pickup, zip: '123456' }, dropoff: { ...base0.dropoff, zip: '123456' } });
    ok(bad.status === 400, 'ZIP 123456 -> HTTP 400', bad.status);
    ok(bad.j && Array.isArray(bad.j.days) && bad.j.days.length === 0 && (bad.j.rush || []).length === 0, 'ZIP 123456 -> no dates (days and rush empty)', bad.j);
    ok(bad.j && !bad.j.region && !bad.j.zone && !bad.j.area, 'ZIP 123456 -> no region, zone or area (no route assigned)', bad.j);
    const only = await post('/api/availability', { ...base0, dropoff: { ...base0.dropoff, zip: '9411' } });
    ok(only.status === 400 && only.j.invalid.includes('dropoff') && !only.j.invalid.includes('pickup'), 'a 4-digit delivery ZIP names the delivery stop only', only.j);
    const leg = await post('/api/availability', { ...base0, leg: 'dropoff', schedule: { date: D }, dropoff: { ...base0.dropoff, zip: '123456' } });
    ok(leg.status === 400 && (leg.j.days || []).length === 0, 'the delivery-leg availability call is refused too', leg.j);
    ok(zeroed() && saved().length === 0, 'availability refusals have no side effects', JSON.parse(snap()));
  }

  hdr('E2. /api/orders: a bad address is refused BEFORE anything is saved, charged or posted');
  const refused = async (name, over, pattern) => {
    const before = snap();
    const r = await post('/api/orders', body(D, over));
    ok(r.status === 400 && (!pattern || pattern.test((r.j || {}).error || '')), `${name} -> HTTP 400${pattern ? ' naming the problem' : ''}`, r);
    ok(snap() === before && zeroed() && saved().length === 0, `${name}: no order saved, no Stripe call, no sheet post/enqueue, no email`, JSON.parse(snap()));
  };
  await refused('ZIP 123456 (delivery)', { dropoff: stop('1 Main St', 'San Francisco', '123456') }, /ZIP/);
  await refused('ZIP 123456 (pickup)', { pickup: stop('2 Henry Adams St', 'San Francisco', '123456') }, /ZIP/);
  await refused('blank ZIP', { dropoff: stop('1 Main St', 'San Francisco', '') }, /ZIP/);
  await refused('street without a number and no checkbox', { pickup: stop('Henry Adams St', 'San Francisco', '94103') }, /street number/);
  await refused('implausible city', { dropoff: stop('1 Main St', '12', '94110') }, /city/);
  await refused('mojibake city (â€™)', { dropoff: stop('1 Main St', 'Oâ€™Fallon', '94110') }, /city/);

  hdr('E3. /api/orders: missing, undersized and malformed sizes fail on the server (browser bypassed)');
  await refused('blank sizes', { items: [art(5000, { w: '', h: '', d: '' })] }, /size/);
  await refused('sizes missing entirely', { items: [(() => { const x = art(5000); delete x.w; delete x.h; delete x.d; return x; })()] }, /size/);
  await refused('1 x 1 x 1', { items: [art(5000, { w: 1, h: 1, d: 1 })] }, /size/);
  await refused('width 3.9', { items: [art(5000, { w: 3.9 })] }, /size/);
  await refused('depth 0.5', { items: [art(5000, { d: 0.5 })] }, /size/);
  for (const [name, v] of [['hex "0x10"', '0x10'], ['exponent "1e3"', '1e3'], ['comma "4,5"', '4,5'], ['"NaN"', 'NaN'], ['"Infinity"', 'Infinity'], ['negative "-24"', '-24'], ['plus sign "+24"', '+24'], ['text "24 in"', '24 in'], ['array [24]', [24]], ['object {}', {}], ['boolean true', true], ['1e21 (number)', 1e21], ['huge digits', '9'.repeat(400)]]) {
    await refused(`bad size string ${name}`, { items: [art(5000, { w: v })] }, /size/);
  }
  await refused('bad size on a furniture piece (blank is fine, junk is not)', { items: [{ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Sofa', value: 3000, weight: 100, w: '0x10' }] }, /plain-number size|size/);

  hdr('E4. positive controls: counters really are wired, and valid input succeeds');
  let okOrder;
  {
    const zip4 = await post('/api/orders', body(D, { pickup: stop('2 Henry Adams St', 'San Francisco', '94103-1234'), dropoff: stop('1 Main St', 'San Francisco', '94110-5678') }));
    ok(zip4.status === 200 && zip4.j && zip4.j.id, 'valid ZIP+4 on both stops succeeds', zip4);
    ok(saved().length === 1, 'the valid order IS persisted (so "no order saved" above is meaningful)', saved().length);
    okOrder = zip4.j && zip4.j.order;
    const decimals = await post('/api/orders', body(D, { items: [art(5000, { w: '24.5', h: '.5'.replace('.5', '36'), d: ' 1.5 ' })], contact: { name: 'Second Client', email: 'second@example.com', phone: '310-555-0101', clientType: 'Collector' } }));
    ok(decimals.status === 200, 'plain decimals with spaces ("24.5", " 1.5 ") are accepted', decimals);
    const pay = await post(`/api/orders/${zip4.j.id}/pay`, { method: 'card' });
    ok(pay.status === 200 && calls.stripeSession === 1, 'paying a valid order reaches the Stripe stub (the counter works)', { pay: pay.status, calls });
    const rush = await post('/api/orders', body(D, { rush: true, contact: { name: 'Rush Client', email: 'rush@example.com', phone: '310-555-0102', clientType: 'Collector' } }));
    ok(rush.status === 200 && rush.j.status === 'pending_approval' && calls.sheetEnqueue >= 1 && calls.email >= 1, 'a rush request enqueues a sheet row and sends email (those counters work too)', { st: rush.status, calls });
  }

  hdr('E5. non-US shipping is relaxed; a US pickup in the same request stays strict');
  {
    const ship = (over = {}) => ({
      service: 'crating_shipping', payer: 'me', contact: { name: 'Ship Client', email: 'ship@example.com', phone: '310-555-0103', clientType: 'Collector' },
      pickup: stop('2 Henry Adams St', 'San Francisco', '94103'),
      dropoff: { street: 'Flat 2, Downing Court, SW1A 2AA', city: 'London', country: 'United Kingdom', contactName: 'Sam', contactPhone: '+44 20 7946 0000', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' },
      items: [art(9000, { weight: 40 })], shipping: { serviceLevel: 'standard', flexible: true }, ...over,
    });
    const good = await post('/api/orders', ship());
    ok(good.status === 200, 'UK destination: free-form postal code in the street line, no US ZIP needed', good);
    const usBad = await post('/api/orders', ship({ pickup: stop('2 Henry Adams St', 'San Francisco', '123456') }));
    ok(usBad.status === 400 && /ZIP/.test(usBad.j.error), 'the same shipment with a bad US pickup ZIP is refused (US stop stays strict)', usBad);
    const noCity = await post('/api/orders', ship({ dropoff: { street: 'Flat 2, Downing Court', city: '', country: 'United Kingdom', contactName: 'Sam', contactPhone: '+44 20 7946 0000', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' } }));
    ok(noCity.status === 400, 'international destination still needs a city', noCity);
    const usShip = await post('/api/orders', ship({ dropoff: stop('9 Broadway', 'New York', '1001', { state: 'NY' }) }));
    ok(usShip.status === 400 && /ZIP/.test(usShip.j.error), 'a US destination (even out of state) with a 4-digit ZIP is refused', usShip);
    const badDimShip = await post('/api/orders', ship({ items: [art(9000, { weight: 40, w: '1e3' })] }));
    ok(badDimShip.status === 400, 'shipping with an exponent size is refused too', badDimShip);
  }

  hdr('E6. oversized piece and "no street number" become manual-review requests (never refused, never payable)');
  {
    const big = await post('/api/orders', body(D, { items: [art(5000, { w: 130, h: 40, d: 3 })], contact: { name: 'Big Client', email: 'big@example.com', phone: '310-555-0104', clientType: 'Collector' } }));
    ok(big.status === 200 && big.j.status === 'pending_approval', 'a 130 in piece is accepted as a pending request (limit 120 in)', big);
    const rv = (big.j.order || {}).review || {};
    ok((rv.kinds || []).includes('oversized') && (rv.reasons || []).some((r) => /^Oversized piece: CAD will confirm handling/.test(r.text)), 'review reason reads "Oversized piece: CAD will confirm handling"', rv);
    const payBig = await post(`/api/orders/${big.j.id}/pay`, { method: 'card' });
    ok(payBig.status === 400, 'an oversized request cannot be paid until CAD approves', payBig);
    const edge = await post('/api/orders', body(D, { items: [art(5000, { w: 120, h: 40, d: 3 })], contact: { name: 'Edge Client', email: 'edge@example.com', phone: '310-555-0105', clientType: 'Collector' } }));
    ok(edge.status === 200 && edge.j.status === 'awaiting_payment' && !((edge.j.order || {}).review || {}).kinds, 'exactly 120 in is NOT reviewed (over the limit only)', edge.j && edge.j.status);
    const noNum = await post('/api/orders', body(D, { pickup: stop('Star Route', 'San Francisco', '94103', { noStreetNumber: true }), contact: { name: 'Rural Client', email: 'rural@example.com', phone: '310-555-0106', clientType: 'Collector' } }));
    ok(noNum.status === 200 && noNum.j.status === 'pending_approval' && (((noNum.j.order || {}).review || {}).kinds || []).includes('no_street_number'), '"Star Route" + the no-number checkbox -> pending manual review', noNum);
    ok(/No street number|NO STREET NUMBER|no street number/i.test(JSON.stringify((noNum.j.order || {}).review || {})) && ((noNum.j.order || {}).pickup || {}).street === 'Star Route', 'the stored street is exactly what the customer typed (no invented number)', ((noNum.j.order || {}).pickup || {}).street);
    const noNumNoBox = await post('/api/orders', body(D, { pickup: stop('Star Route', 'San Francisco', '94103') }));
    ok(noNumNoBox.status === 400, 'the same address without the checkbox is refused', noNumNoBox);
    const truthy = await post('/api/orders', body(D, { pickup: stop('Star Route', 'San Francisco', '94103', { noStreetNumber: 'true' }) }));
    ok(truthy.status === 400, 'only a real boolean true counts as the checkbox (the string "true" does not)', truthy);
    const avNo = await post('/api/availability', { ...base0, pickup: stop('Star Route', 'Big Sur', '93920', { noStreetNumber: true }) });
    ok(avNo.status === 200 && avNo.j.days.length > 0, 'availability still works for a ticked no-number address, with a real ZIP', avNo.status);
  }

  hdr('E7. protection opt-out, member flag and discount codes through the real handlers');
  {
    const mk = (over) => body(D, { contact: { name: 'Opt Client ' + Math.random().toString(36).slice(2, 6), email: 'opt@example.com', phone: '310-555-0107', clientType: 'Collector' }, items: [art(12344)], ...over });
    const dflt = await post('/api/quote', mk({}));
    ok(Math.abs(dflt.j.total - 385.16) < 0.006 && dflt.j.protection && dflt.j.protectionOption.declined === false, 'default: protection is included ($385.16)', dflt.j.total);
    for (const [n, v] of [['string "true"', 'true'], ['1', 1], ['"yes"', 'yes'], ['false', false], ['null', null]]) {
      const r = await post('/api/quote', mk({ protectionDeclined: v }));
      ok(r.j.protection && Math.abs(r.j.total - 385.16) < 0.006, `protectionDeclined = ${n} is ignored (only explicit true declines)`, r.j.total);
    }
    const dec = await post('/api/quote', mk({ protectionDeclined: true }));
    ok(!dec.j.protection && Math.abs(dec.j.total - 200) < 0.006 && dec.j.protectionOption.declined === true && dec.j.protectionOption.amount === 185.16, 'protectionDeclined = true: line drops ($200), add-back amount stays known ($185.16)', dec.j);
    const o1 = await post('/api/orders', mk({ protectionDeclined: true }));
    const stored = o1.j && o1.j.order;
    ok(o1.status === 200 && stored.protectionDeclined === true && !!stored.protectionDeclinedAt && stored.declaredValueProtection === false && !stored.quote.protection, 'the order record stores the opt-out, timestamp included', stored && { d: stored.protectionDeclined, at: stored.protectionDeclinedAt });
    const o2 = await post('/api/orders', mk({ protectionDeclined: true, items: [art(60000)] }));
    ok(o2.status === 200 && !o2.j.order.protectionDeclined, 'no opt-out is recorded when there was no protection to decline (piece over $50,000)', o2.j.order && o2.j.order.protectionDeclined);
    const o3 = await post('/api/orders', mk({}));
    ok(o3.status === 200 && !o3.j.order.protectionDeclined && o3.j.order.declaredValueProtection === true, 'default order: protection on, no opt-out recorded');

    const mem = await post('/api/quote', mk({ member: true, memberCode: 'JONES-TERWILLIGER', items: [art(5000)] }));
    const plain = await post('/api/quote', mk({ items: [art(5000)] }));
    ok(mem.j.total === plain.j.total && mem.j.member === false && !mem.j.lines.some((l) => /member/i.test(l.label)), 'member flag + code are ignored by /api/quote (same price as non-member)', { mem: mem.j.total, plain: plain.j.total });
    const memOrder = await post('/api/orders', mk({ member: true, memberCode: 'PALOMAS', memberCompany: 'X', items: [art(5000)] }));
    ok(memOrder.status === 200 && memOrder.j.order.member === false && !memOrder.j.order.memberCode && memOrder.j.order.quote.total === plain.j.total, 'member flag and code are never stored on an order and never change its price', memOrder.j.order && { m: memOrder.j.order.member, c: memOrder.j.order.memberCode });
    const gone = await realFetch(BASE + '/api/member-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'JONES-TERWILLIGER' }) });
    ok(gone.status === 404, 'the member-code endpoint is gone', gone.status);

    const jt = await post('/api/discount-code', { code: ' jt ', order: mk({}) });
    ok(jt.j.valid === true && jt.j.code === 'JT' && Math.abs(jt.j.amount - 96.29) < 0.006, 'JT (any case, trimmed) is valid: 25% of $385.16 = $96.29', jt.j);
    const bad = await post('/api/discount-code', { code: 'NOPE', order: mk({}) });
    ok(bad.j.valid === false && /isn.t valid/.test(bad.j.message), 'unknown code -> clear "isn’t valid" message', bad.j);
    const inactive = await post('/api/discount-code', { code: 'freedelivery500', order: mk({}) });
    ok(inactive.j.valid === false && inactive.j.message === bad.j.message, 'inactive code reads exactly like an unknown one (no hint it exists)', inactive.j);
    const empty = await post('/api/discount-code', { code: '  ' });
    ok(empty.status === 400 && empty.j.valid === false, 'blank code -> 400 "Enter a discount code."', empty.j);
    const withCode = await post('/api/orders', mk({ discountCode: 'jt' }));
    const oc = withCode.j && withCode.j.order;
    ok(withCode.status === 200 && oc.discountCode === 'JT' && oc.quote.discount.amount === 96.29 && oc.quote.lines.some((l) => /^Discount code JT/.test(l.label) && l.amount === -96.29) && Math.abs(oc.quote.total - 288.87) < 0.006, 'an order with code jt stores JT and prices $288.87 with its own discount line', oc && oc.quote.total);
    const fakeAmt = await post('/api/orders', mk({ discountCode: 'JT', discount: { amount: 9999 }, discountAmount: 9999 }));
    ok(fakeAmt.status === 200 && fakeAmt.j.order.quote.discount.amount === 96.29, 'a client-supplied discount amount is ignored; only the code counts', fakeAmt.j.order && fakeAmt.j.order.quote.discount);
    const fakeCode = await post('/api/orders', mk({ discountCode: 'FREEDELIVERY500' }));
    ok(fakeCode.status === 200 && !fakeCode.j.order.discountCode && Math.abs(fakeCode.j.order.quote.total - 385.16) < 0.006, 'an inactive code sent straight to /api/orders is ignored', fakeCode.j.order && fakeCode.j.order.discountCode);
    const tries = []; for (let i = 0; i < 14; i++) tries.push((await post('/api/discount-code', { code: 'GUESS' + i })).status);
    ok(tries.includes(429), 'guessing codes is rate-limited (429 after repeated misses)', tries);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED', e); process.exit(1); });
