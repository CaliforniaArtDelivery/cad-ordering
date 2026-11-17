/* Paloma's partner flow: price math, validation, order pipeline, copy rules. Run against a local server:
 *   ADMIN_KEY=<16+ chars> TEST_MODE=1 STORAGE_DIR=/tmp/paltest PORT=3111 node server.js &   then   BASE=http://localhost:3111 ADMIN_KEY=<same> node scripts/palomas-test.js */
const fs = require('fs');
const path = require('path');
const PAL = require('../lib/palomas');
const BASE = process.env.BASE || 'http://localhost:3111';
const KEY = process.env.ADMIN_KEY || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const near = (a, b) => Math.abs(a - b) < 0.0051;
const r2 = (n) => Math.round((n + 1e-9) * 100) / 100;
const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const get = async (u) => { const r = await fetch(BASE + u); return { s: r.status, t: await r.text() }; };
const base = (items, extra = {}) => ({
  placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', priceSensitive: false, items,
  delivery: { name: 'Pat Client', phone: '(831) 555-0123', email: 'pat@example.com', street: '100 Ocean Ave', city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921', notes: 'Call on arrival' },
  access: { mode: 'ground' }, ...extra,
});
const it = (kind, size, value, qty = 1, name = kind) => ({ name, kind, size, value, qty });

(async () => {
  console.log('\n1. Price math (server engine)');
  // single lamp: well under $1,000
  let q = PAL.partnerQuote(base([it('Table Lamp', 'small', 995)]));
  ok(!q.special && q.partner === 115 && q.standard === 150, `lamp: standard $150 → partner $115 (got ${q.standard} → ${q.partner})`);
  ok(q.volumeOff === 0 && q.sensitiveOff === 0, 'no 10% / 15% off on a small order');
  ok(near(q.protectionAmount, 14.93) || near(q.protectionAmount, 14.92), `protection 1.5% of $995 = $14.93 (got ${q.protectionAmount})`);
  ok(near(q.total, r2(q.partner + q.protectionAmount)), 'total = partner price + protection');
  // search combos (accents are cheap increments) to land under and over $1,000 partner price
  const kinds = [['Dining Table', 'medium'], ['Sofa', 'small'], ['Armchair / Accent Chair', 'medium'], ['Coffee Table', 'small'], ['Table Lamp', 'small'], ['Vases', 'large'], ['Chandelier', 'medium'], ['Console Table', 'small']];
  let under = null, over = null, exact = null;
  for (let a = 0; a < kinds.length; a++) for (let qa = 1; qa <= 4; qa++) for (let b = 0; b < kinds.length; b++) for (let qb = 0; qb <= 4; qb++) {
    const items = [it(kinds[a][0], kinds[a][1], 500, qa)]; if (qb) items.push(it(kinds[b][0], kinds[b][1], 500, qb, kinds[b][0] + ' 2'));
    const p = PAL.partnerQuote(base(items)).partner;
    if (p < 1000 && (!under || p > under.p)) under = { p, items };
    if (p >= 1000 && (!over || p < over.p)) over = { p, items };
    if (p === 1000 && !exact) exact = { p, items };
  }
  const qu = PAL.partnerQuote(base(under.items)), qo = PAL.partnerQuote(base(over.items));
  console.log(`   (closest under: partner $${under.p}; closest over: partner $${over.p}${exact ? '; exact $1,000 found' : ''})`);
  ok(qu.volumeOff === 0, `just under $1,000 (partner $${under.p}) gets no 10%`);
  ok(qo.volumeOff > 0 && near(qo.volumeOff, r2(qo.partner * 0.1)), `at/over $1,000 (partner $${over.p}) gets exactly 10% off ($${qo.volumeOff})`);
  ok(qo.delivery < qu.delivery || over.p - under.p > 150, `a job just over $1,000 costs ${qo.delivery < qu.delivery ? 'LESS' : 'about the same as'} one just under (${qo.delivery} vs ${qu.delivery}) as Chad described`);
  if (exact) { const qe = PAL.partnerQuote(base(exact.items)); ok(qe.volumeOff === 100, `exactly $1,000.00 gets the 10% ($${qe.volumeOff})`); }
  // checkbox on/off
  const on = PAL.partnerQuote(base(over.items, { priceSensitive: true }));
  ok(on.sensitive && near(on.sensitiveOff, r2(on.afterVolume * 0.15)), `price sensitive ON: 15% of the after-10% price ($${on.sensitiveOff} of $${on.afterVolume})`);
  ok(near(on.delivery, r2(on.afterVolume - on.sensitiveOff)), 'delivery price = after-10% minus 15%');
  ok(near(on.total, r2(on.delivery + on.protectionAmount)), 'total = delivery + protection (protection never discounted)');
  const off = PAL.partnerQuote(base(over.items, { priceSensitive: false }));
  ok(off.sensitiveOff === 0 && near(off.delivery, off.afterVolume), 'price sensitive OFF: no 15%');
  const smallOn = PAL.partnerQuote(base([it('Table Lamp', 'small', 995)], { priceSensitive: true }));
  ok(near(smallOn.sensitiveOff, r2(115 * 0.15)), `15% works on a small (<$1,000) order too ($${smallOn.sensitiveOff})`);
  // $950-ish illustration with the spec numbers, independent of the engine
  const spec = (partner, sens) => { const v = partner >= 1000 ? r2(partner * 0.1) : 0; const a = r2(partner - v); const s = sens ? r2(a * 0.15) : 0; return r2(a - s); };
  ok(spec(950, false) === 950 && spec(1001, false) === 900.9 && spec(1001, true) === 765.76, 'spec check: $950 → $950.00, $1,001 → $900.90, $1,001 + sensitive → $765.76');

  console.log('\n2. Declared value rules');
  const hv = PAL.partnerQuote(base([it('Sofa', 'medium', 60000)]));
  ok(!hv.protection && hv.protectionAmount === 0, 'over $50,000: no protection line');
  ok(hv.lines.every((l) => !PAL.isProtection(l)), 'over $50,000: no protection line in the line items');
  const hv0 = PAL.partnerQuote(base([it('Sofa', 'medium', 40000)]));
  ok(hv.partner > hv0.partner, `over $50,000 pays the high-value handling price inside the piece price ($${hv.partner} vs $${hv0.partner})`);
  ok(near(hv0.protectionAmount, 600), 'at $40,000: protection is 1.5% = $600');
  const edge = PAL.partnerQuote(base([it('Sofa', 'medium', 50000)]));
  ok(near(edge.protectionAmount, 750), 'exactly $50,000 still carries protection ($750)');

  console.log('\n3. Server validation (HTTP)');
  let r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { placedBy: { name: 'Other', other: '' } }));
  ok(r.s === 400 && /name of who/.test(r.j.error), 'Other with no name is refused');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { placedBy: { name: '' } }));
  ok(r.s === 400, 'no "who" is refused');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { pickupLocation: 'both' }));
  ok(r.s === 400 && /pickup location/.test(r.j.error), 'pickup must be exactly one of the two locations');
  r = await post('/api/palomas/orders', base([]));
  ok(r.s === 400, 'no items is refused');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 0)]));
  ok(r.s === 400 && /declared value/.test(r.j.error), 'declared value is required');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { schedule: {} }));
  ok(r.s === 400 && /days/.test(r.j.error), 'dates are required for in-state orders');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { delivery: { name: '', phone: '1', email: 'x', street: '', city: '', zip: '1' } }));
  ok(r.s === 400, 'client name / phone / email / address are required');

  console.log('\n4. Order pipeline (HTTP): Other name, Carmel pickup, price sensitive');
  const av = await post('/api/palomas/availability', { ...base([it('Dining Table', 'medium', 4500)]), leg: 'pickup' });
  const pu = av.j.days[0].date;
  const av2 = await post('/api/palomas/availability', { ...base([it('Dining Table', 'medium', 4500)]), leg: 'dropoff', pickupDate: pu });
  const de = av2.j.days[0].date;
  ok(av.j.days.length > 0 && av2.j.days.length > 0, `availability returns days (pickup ${pu}, delivery ${de})`);
  const body = base([it('Dining Table', 'large', 6900, 1, 'Carmel 4-Post Copper Dining Table (96" x 44")'), it('Armchair / Accent Chair', 'medium', 1595, 3, 'Arco Captiva Chair')],
    { placedBy: { name: 'Other', other: 'Dave Test' }, pickupLocation: 'carmel', priceSensitive: true, schedule: { date: pu, deliveryDate: de } });
  const quoted = PAL.partnerQuote(body);
  r = await post('/api/palomas/orders', body);
  ok(r.s === 200 && r.j.order && r.j.order.status === 'confirmed', `order placed and confirmed (${r.j.id})`);
  const o = r.j.order || {};
  ok(near(o.quote.total, quoted.total), `stored total matches the live quote ($${o.quote && o.quote.total})`);
  ok(o.contact.name === 'Dave Test', 'placed-by name from the Other field is saved');
  ok(/Carmel-by-the-Sea/.test(o.pickup.city) && /Mission/.test(o.pickup.street), 'Carmel showroom pickup saved (single choice)');
  ok(o.partnerInfo.priceSensitive === true && o.partnerInfo.sensitiveOff > 0, 'price sensitive flag + amount saved on the order');
  ok(o.quote.lines.some((l) => /Price sensitive client/.test(l.label) && l.amount < 0), 'order shows the 15% line item');
  ok(o.quote.lines.some((l) => /additional 10% off/.test(l.label) && l.amount < 0), 'order shows the 10% line item');
  ok(near(o.quote.lines.reduce((s, l) => s + l.amount, 0), o.quote.total), 'line items add up to the total');
  const dup = await post('/api/palomas/orders', body);
  ok(dup.j.duplicate && dup.j.id === r.j.id, 'double-submit returns the same order (no duplicate)');
  if (KEY) {
    const adm = await fetch(BASE + '/api/admin/orders?key=' + KEY).then((x) => x.json());
    ok(adm.orders.some((x) => x.id === r.j.id && x.partnerOrder), 'order appears in the admin list');
    const csv = await fetch(BASE + '/api/admin/schedule.csv?key=' + KEY).then((x) => x.text());
    ok(/Bill partner: Paloma/.test(csv) && /Partner billing/.test(csv), 'schedule CSV row says "Bill partner: Paloma\'s Home Furnishings"');
    ok(/PRICE SENSITIVE CLIENT/.test(csv), 'schedule CSV flags the price sensitive client');
    const mail = await fetch(BASE + '/outbox/' + o.emails[0].file + '?key=' + KEY).then((x) => x.text());
    ok(/Billed to Paloma/.test(mail) && !/Paid in full/.test(mail), 'confirmation email says billed to Paloma\'s (not "paid in full")');
    fs.writeFileSync('/tmp/paltest/last-email.html', mail);
  }

  console.log('\n5. Out of state → Shipping quote');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { delivery: { ...base([]).delivery, city: 'Phoenix', state: 'AZ', zip: '85001' } }));
  ok(r.s === 200 && r.j.status === 'pending_approval' && r.j.order.service === 'crating_shipping', 'out-of-state delivery becomes a Shipping quote request, no price shown');
  const qq = await post('/api/palomas/quote', base([it('Sofa', 'medium', 3000)], { delivery: { ...base([]).delivery, state: 'AZ', zip: '85001' } }));
  ok(qq.j.special === true, 'live quote says special/Shipping for out of state');

  console.log('\n6. Copy rules (no crating / moving / hoisting / COI)');
  const files = ['index.html', 'palomas.js', 'palomas.css'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'palomas', f), 'utf8'));
  const cfg = JSON.stringify((await get('/api/palomas/config')).t);
  const hay = files.join('\n') + cfg + (fs.existsSync('/tmp/paltest/last-email.html') ? fs.readFileSync('/tmp/paltest/last-email.html', 'utf8') : '');
  ok(!/\bcrat(e|ing|ed)\b|\bmov(e|ing|ers?)\b|\bhoist(ing|ed)?\b/i.test(hay.replace(/(user-)?select|remove/gi, '')) && !/\bCOI\b/.test(hay), 'none of the banned words appear in the page, catalog or email');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
