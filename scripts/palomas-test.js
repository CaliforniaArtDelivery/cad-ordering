/* Paloma's partner flow: price math, validation, order pipeline, copy rules. Run against a local server:
 *   ADMIN_KEY=<16+ chars> TEST_MODE=1 STORAGE_DIR=/tmp/paltest PORT=3111 node server.js &   then   BASE=http://localhost:3111 ADMIN_KEY=<same> node scripts/palomas-test.js */
const fs = require('fs');
const path = require('path');
const PAL = require('../lib/palomas');
const BASE = process.env.BASE || 'http://localhost:3111';
const KEY = process.env.ADMIN_KEY || '';
let pass = 0, fail = 0;
const RUN = Date.now().toString(36); // keeps reruns against the same server from tripping duplicate-order protection
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const near = (a, b) => Math.abs(a - b) < 0.0051;
const r2 = (n) => Math.round((n + 1e-9) * 100) / 100;
const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const get = async (u) => { const r = await fetch(BASE + u); return { s: r.status, t: await r.text() }; };
const base = (items, extra = {}) => ({
  placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', courtesy: false, items,
  delivery: { name: 'Pat Client', phone: '(831) 555-0123', email: 'pat@example.com', street: '100 Ocean Ave', city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921', notes: 'Call on arrival ' + RUN },
  access: { mode: 'ground' }, ...extra,
});
const it = (kind, size, value, qty = 1, name = kind) => ({ name, kind, size, value, qty });

(async () => {
  console.log('\n1. Price math (server engine)');
  // single lamp: well under $1,000
  let q = PAL.partnerQuote(base([it('Table Lamp', 'small', 995)]));
  ok(!q.special && q.partner === 115 && q.standard === 150, `lamp: standard $150 → partner $115 (got ${q.standard} → ${q.partner})`);
  ok(q.volumeOff === 0 && q.courtesyOff === 0, 'no 10% / 15% off on a small order');
  ok(q.protectionAmount === 0 && !q.protection && near(q.total, q.partner), 'no declared value protection for Paloma\'s: total = partner price even with a $995 declared value');
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
  const on = PAL.partnerQuote(base(over.items, { courtesy: true }));
  ok(on.courtesy && near(on.courtesyOff, r2(on.afterVolume * 0.15)), `Manager's courtesy ON: 15% of the after-10% price ($${on.courtesyOff} of $${on.afterVolume})`);
  ok(near(on.delivery, r2(on.afterVolume - on.courtesyOff)), 'delivery price = after-10% minus 15%');
  ok(near(on.total, on.delivery), 'total = delivery price (no protection line)');
  const off = PAL.partnerQuote(base(over.items, { courtesy: false }));
  ok(off.courtesyOff === 0 && near(off.delivery, off.afterVolume), "Manager's courtesy OFF: no 15%");
  const smallOn = PAL.partnerQuote(base([it('Table Lamp', 'small', 995)], { courtesy: true }));
  ok(near(smallOn.courtesyOff, r2(115 * 0.15)), `15% works on a small (<$1,000) order too ($${smallOn.courtesyOff})`);
  // $950-ish illustration with the spec numbers, independent of the engine
  const spec = (partner, sens) => { const v = partner >= 1000 ? r2(partner * 0.1) : 0; const a = r2(partner - v); const s = sens ? r2(a * 0.15) : 0; return r2(a - s); };
  ok(spec(950, false) === 950 && spec(1001, false) === 900.9 && spec(1001, true) === 765.76, 'spec check: $950 → $950.00, $1,001 → $900.90, $1,001 + courtesy → $765.76');

  // per-line all-in prices must add up to the order total to the cent
  console.log('\n1b. Per-item pricing (standard struck, partnership price, all-in price after the 10% / 15%)');
  const mix = [it('Armchair / Accent Chair', 'medium', 1595, 3, 'Chair'), it('Dining Table', 'large', 6900, 1, 'Table'), it('Table Lamp', 'small', 500, 1, 'Lamp'), it('Vases', 'large', 90, 7, 'Vases')];
  for (const [label, extra, items] of [['both 10% and 15%', { courtesy: true }, mix], ['10% only', { courtesy: false }, mix], ['neither (small order)', { courtesy: false }, [it('Table Lamp', 'small', 500, 1, 'Lamp')]], ['15% only (small order)', { courtesy: true }, [it('Table Lamp', 'small', 500, 3, 'Lamp'), it('Vases', 'small', 90, 1, 'Vases')]]]) {
    const qm = PAL.partnerQuote(base(items, extra));
    const sumAfter = r2(qm.lines.reduce((x, l) => x + l.after, 0));
    ok(Math.abs(Math.round(sumAfter * 100) - Math.round(qm.total * 100)) === 0, `${label}: per-item all-in prices add up exactly to the total ($${sumAfter} = $${qm.total})`);
    ok(qm.lines.every((l) => l.standard > 0 && l.amount > 0 && l.standard >= l.amount), `${label}: every line has a standard price and a lower partnership price`);
    ok(near(qm.lines.reduce((x, l) => x + l.amount, 0), qm.partner) && near(qm.lines.reduce((x, l) => x + l.standard, 0), qm.standard), `${label}: line prices add up to the standard and partnership totals`);
    ok(qm.lines.every((l) => l.each > 0 && Math.abs(l.each * l.qty - l.after) < 0.5 * l.qty + 0.01), `${label}: per-unit price is consistent with the line`);
  }
  const lastCheck = PAL.partnerQuote(base([it('Table Lamp', 'small', 500, 1, 'A'), it('Table Lamp', 'small', 500, 1, 'B'), it('Table Lamp', 'small', 500, 1, 'C'), it('Table Lamp', 'small', 500, 1, 'D'), it('Table Lamp', 'small', 500, 1, 'E'), it('Table Lamp', 'small', 500, 1, 'F'), it('Table Lamp', 'small', 500, 1, 'G'), it('Table Lamp', 'small', 500, 1, 'H'), it('Table Lamp', 'small', 500, 1, 'I'), it('Table Lamp', 'small', 500, 1, 'J')], { courtesy: true }));
  ok(near(r2(lastCheck.lines.reduce((x, l) => x + l.after, 0)), lastCheck.total), `10 identical lines + both extras: still exact to the cent; rounding remainder lands on the last line (${lastCheck.lines.map((l) => l.after).join(', ')})`);

  console.log('\n1c. The $1,000 threshold (basis: delivery subtotal after the 25% partnership discount)');
  for (const [amt, eligible] of [[999.99, false], [1000.0, true], [1000.01, true]]) {
    const x = PAL.applyExtras(amt, false);
    ok(x.volumeEligible === eligible && (eligible ? near(x.volumeOff, r2(amt * 0.1)) && near(x.delivery, r2(amt - r2(amt * 0.1))) : x.volumeOff === 0 && x.delivery === amt), `$${amt.toFixed(2)} partnership subtotal: ${eligible ? `10% off ($${x.volumeOff}) → $${x.delivery}` : `no 10% off, stays $${x.delivery}`}`);
  }
  ok(PAL.applyExtras(1000.01, true).delivery === r2(r2(1000.01 - 100) * 0.85) || near(PAL.applyExtras(1000.01, true).delivery, r2(r2(1000.01 - r2(100.001)) * 0.85)), '$1,000.01 with the Manager\'s courtesy: 10% then 15% of what is left');
  {
    // the real thing through the engine: the basis is the partnership price, NOT the standard price
    const probe = PAL.partnerQuote(base([it('Dining Table', 'large', 6900, 2)]));
    ok(probe.standard > probe.partner && probe.volumeEligible === (probe.partner >= 1000), `through the engine: standard $${probe.standard}, partnership $${probe.partner} → 10% ${probe.volumeEligible ? 'applies' : 'does not apply'} (basis is the partnership price)`);
    const near1k = PAL.partnerQuote(base([it('Dining Table', 'large', 500, 3)])); // standard 1410, partner 1057.5
    ok(near1k.standard >= 1000 && near1k.partner >= 1000 ? near1k.volumeEligible : true, 'order over $1,000 after partnership pricing gets the 10%');
    const justStd = PAL.partnerQuote(base([it('Dining Table', 'large', 500, 2), it('Table Lamp', 'small', 500, 1)])); // standard 1090, partner 817.5
    ok(justStd.standard >= 1000 && justStd.partner < 1000 && !justStd.volumeEligible && justStd.volumeOff === 0, `standard $${justStd.standard} but partnership $${justStd.partner} is under $1,000 → no 10% (basis is after the 25%)`);
  }

  console.log('\n1d. Item size and handling come from the catalog (no size, oversized or value inputs)');
  const C = (name) => PAL.catalog.find((x) => x.name === name);
  const sofa = C('Arco Captiva Sofa'), lamp = PAL.catalog.find((x) => x.kind === 'Table Lamp'), sect = PAL.catalog.find((x) => /Sectional/.test(x.kind));
  const ci = (c, qty = 1) => ({ name: c.name, kind: c.kind, catalogId: c.id, qty });
  ok(PAL.engineItems([ci(sofa)])[0].sizeClass === 'large' && PAL.engineItems([ci(sect)])[0].sizeClass === 'large', 'sofas and sectionals are the large tier, straight from the catalog');
  ok(PAL.catalog.filter((x) => ['Sofa', 'Loveseat'].includes(x.kind)).every((x) => x.size === 'large'), 'every catalog sofa and loveseat is large');
  ok(PAL.engineItems([{ name: 'Custom sofa', kind: 'Sofa', qty: 1, custom: true }])[0].sizeClass === 'large' && PAL.engineItems([{ name: 'Custom armoire', kind: 'Armoire', qty: 1, custom: true }])[0].sizeClass === 'large', 'custom sofas and armoires default to large with no size asked');
  ok(PAL.engineItems([{ ...ci(sofa), size: 'small', oversized: true, value: 99999 }])[0].sizeClass === 'large', 'a client-sent size, oversized flag or value cannot lower or change the catalog tier');
  ok(PAL.engineItems([{ name: 'Wall mirror', kind: 'Mirror', qty: 1, custom: true }])[0].sizeClass === 'medium', 'other custom pieces default to medium');
  ok(PAL.engineItems([ci(lamp)]).every((x) => x.value === 0) && PAL.engineItems([ci(sofa)])[0].value === 0, 'no declared value reaches the engine (always 0)');
  ok(PAL.validate(base([{ name: 'Sofa', kind: 'Sofa', qty: 1 }], { schedule: { date: '2026-12-01', deliveryDate: '2026-12-02' } })).length === 0, 'an item with no size and no value validates');
  const hvq = PAL.partnerQuote(base([{ ...ci(sofa), value: 90000 }]));
  ok(!hvq.protection && hvq.protectionAmount === 0 && near(hvq.total, hvq.partner), 'no protection and no >$50,000 high-value handling (value is not collected, so the old rule is gone)');
  const plain = (a) => PAL.partnerQuote(base([ci(sofa, 2), ci(lamp)], { access: a }));
  const g = plain({ mode: 'ground' }), st2 = plain({ mode: 'stairs', flights: '2' }), sth = plain({ mode: 'stairs', flights: 'half' }), el = plain({ mode: 'elevator', floor: '3', elevatorType: 'freight', elevSteps: 'no' });
  const stairLine = (qq) => qq.lines.find((l) => /^Stairs/.test(l.label));
  ok(!stairLine(g) && !stairLine(el), 'no stairs fee on ground-level or elevator access');
  ok(stairLine(st2) && stairLine(st2).amount === 200 && stairLine(st2).qty === 2, `2 flights x 2 large sofas = 4 x $50 = $200 (main site rule: per flight, per piece; line "${stairLine(st2) && stairLine(st2).label}")`);
  ok(stairLine(sth) && stairLine(sth).amount === 50, 'half a flight counts as 0.5 flight');
  ok(near(st2.partner - g.partner, 200) && near(st2.partner, r2(st2.lines.reduce((x, l) => x + l.amount, 0))), 'the stairs fee adds to the delivery subtotal at full price (not partnership-discounted), and the lines still add up');
  ok(!st2.lines.some((l) => /^Stairs/.test(l.label) && l.standard !== l.amount), 'stairs line: standard = partnership price (no 25% off on access fees)');
  ok(near(r2(st2.lines.reduce((x, l) => x + l.after, 0)), st2.total), 'all-in per-line prices (incl. stairs) add up to the total to the cent');
  const lampOnly = PAL.partnerQuote(base([ci(lamp)], { access: { mode: 'stairs', flights: '3' } }));
  ok(!stairLine(lampOnly), 'stairs fee applies to large pieces only (a medium lamp pays none)');
  const longPiece = PAL.catalog.find((x) => PAL.resolveItem({ catalogId: x.id, kind: x.kind }).dim > 80);
  if (longPiece) { const lq = PAL.partnerQuote(base([ci(longPiece)], { access: { mode: 'stairs', flights: '1' } })); ok(stairLine(lq) && stairLine(lq).amount === 100, `a piece over 80" (${longPiece.name}, ${longPiece.dims}) is $100 per flight`); }
  const pubq = await post('/api/palomas/quote', base([ci(sofa, 2), ci(lamp)], { access: { mode: 'stairs', flights: '2' } }));
  ok(pubq.j.lines.some((l) => /^Stairs/.test(l.label)) && !/stairs can add a fee|we confirm it/i.test(JSON.stringify(pubq.j)), 'the live quote shows the stairs line, with no "stairs can add a fee / we confirm it" wording');
  ok(PAL.ACCESS_FEE_NOTE === 'Today’s price covers the delivery as quoted.' && !/stair|approv|reschedul/i.test(PAL.ACCESS_FEE_NOTE), 'access-fee note is one minimal sentence and does not imply stairs are confirmed later');

  console.log('\n2. Staff code (both hidden controls), checked on the server');
  const un = (code) => post('/api/palomas/unlock', { code });
  ok((await un('Palomas')).j.ok === true && (await un('palomas')).j.ok === true && (await un('PALOMAS ')).j.ok === true, 'the code works in any capitalization');
  ok((await un('')).j.ok === false && (await un('Paloma')).j.ok === false && (await un('nope')).j.ok === false, 'wrong or empty codes are refused');
  ok(PAL.staffCodeOk('Palomas') && !PAL.staffCodeOk('Paloma\'s') && !PAL.staffCodeOk(undefined) && !PAL.staffCodeOk({ a: 1 }), 'server check: right code only, junk input is refused');
  const jsAll = ['index.html', 'palomas.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'palomas', f), 'utf8')).join('\n') + (await get('/api/palomas/config')).t;
  ok(!/["']palomas["']\s*[;,)]\s*\/\/|staff code is|code\s*===?\s*['"]/i.test(jsAll) && !jsAll.includes('a2b6a7') && !jsAll.includes(require('crypto').createHash('sha256').update('palomas').digest('hex')), 'neither the code nor its hash is shipped to the browser');
  const qNoPin = await post('/api/palomas/quote', base([ci(sofa, 2)], { courtesy: true }));
  const qPin = await post('/api/palomas/quote', base([ci(sofa, 2)], { courtesy: true, pin: 'Palomas' }));
  ok(!qNoPin.j.courtesy && qNoPin.j.courtesyOff === 0 && qPin.j.courtesy && qPin.j.courtesyOff > 0, 'a quote applies the courtesy only with the code');
  console.log('\n3. Server validation (HTTP)');
  let r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { placedBy: { name: 'Other', other: '' } }));
  ok(r.s === 400 && /name of who/.test(r.j.error), 'Other with no name is refused');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { placedBy: { name: '' } }));
  ok(r.s === 400, 'no "who" is refused');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { pickupLocation: 'both' }));
  ok(r.s === 400 && /pickup location/.test(r.j.error), 'pickup must be exactly one of the two locations');
  r = await post('/api/palomas/orders', base([]));
  ok(r.s === 400, 'no items is refused');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { schedule: {} }));
  ok(r.s === 400 && /days/.test(r.j.error), 'dates are required for in-state orders');
  r = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { delivery: { name: '', phone: '1', email: 'x', street: '', city: '', zip: '1' } }));
  ok(r.s === 400, 'client name / phone / email / address are required');

  console.log("\n4. Order pipeline (HTTP): Other name, Carmel pickup, Manager's courtesy");
  const av = await post('/api/palomas/availability', { ...base([it('Dining Table', 'medium', 4500)]), leg: 'pickup' });
  const pu = av.j.days[0].date;
  const av2 = await post('/api/palomas/availability', { ...base([it('Dining Table', 'medium', 4500)]), leg: 'dropoff', pickupDate: pu });
  const de = av2.j.days[0].date;
  ok(av.j.days.length > 0 && av2.j.days.length > 0, `availability returns days (pickup ${pu}, delivery ${de})`);
  const body = base([it('Dining Table', 'large', 6900, 1, 'Carmel 4-Post Copper Dining Table (96" x 44")'), it('Armchair / Accent Chair', 'medium', 1595, 3, 'Arco Captiva Chair')],
    { placedBy: { name: 'Other', other: 'Dave Test' }, pickupLocation: 'carmel', courtesy: true, pin: 'Palomas', schedule: { date: pu, deliveryDate: de } });
  const quoted = PAL.partnerQuote(body);
  const mailOf = (e) => fetch(BASE + '/outbox/' + e.file + '?key=' + KEY).then((x) => x.text());
  const pay = (id, b2 = { method: 'card', card: '4242 4242 4242 4242' }) => post(`/api/orders/${id}/pay`, b2);
  console.log('   4a. Path 1: client pays now by card (default)');
  r = await post('/api/palomas/orders', { ...body, payer: 'client', payMode: 'now' });
  ok(r.s === 200 && r.j.order && r.j.order.status === 'awaiting_payment', `order created awaiting card payment (${r.j.id})`);
  let o = r.j.order || {};
  ok(near(o.quote.total, quoted.total), `stored total matches the live quote ($${o.quote && o.quote.total})`);
  ok(o.contact.name === 'Pat Client' && o.contact.email === 'pat@example.com' && o.payer === 'me', 'payer is the client: name and email prefilled from the delivery info');
  ok(o.partnerInfo.placedBy === 'Dave Test', 'placed-by name from the Other field is saved');
  ok(/Carmel-by-the-Sea/.test(o.pickup.city) && /Mission/.test(o.pickup.street), 'Carmel showroom pickup saved (single choice)');
  ok(o.partnerInfo.courtesy === true && o.partnerInfo.courtesyOff > 0, "Manager's courtesy flag + amount saved on the order");
  ok(o.quote.lines.some((l) => /^Manager's courtesy$/.test(l.label) && l.amount < 0), 'order shows the 15% line item');
  ok(o.quote.lines.some((l) => /additional 10% off/.test(l.label) && l.amount < 0), 'order shows the 10% line item');
  ok(near(o.quote.lines.reduce((s2, l) => s2 + l.amount, 0), o.quote.total), 'line items add up to the total');
  ok(o.quote.dueNow > 0 && (o.quote.total >= 3000 ? o.quote.paymentPlan === 'deposit' : o.quote.paymentPlan === 'full' && near(o.quote.dueNow, o.quote.total)), `same payment plan as the main site (paid in full; 50% at booking from $3,000): due now $${o.quote.dueNow} of $${o.quote.total}`);
  const dup = await post('/api/palomas/orders', { ...body, payer: 'client', payMode: 'now' });
  ok(dup.j.duplicate && dup.j.id === r.j.id, 'double-submit returns the same order (no duplicate)');
  let pr = await pay(r.j.id, { method: 'card', card: '12' });
  ok(pr.s === 400, 'bad card number is refused by the main site payment endpoint');
  pr = await pay(r.j.id);
  ok(pr.s === 200 && pr.j.order.status === 'confirmed' && pr.j.order.payment.status === 'paid' && near(pr.j.order.payment.amount, o.quote.dueNow), 'card payment confirms the order and charges the amount due now');
  const o1 = pr.j.order;
  if (KEY) {
    const adm = await fetch(BASE + '/api/admin/orders?key=' + KEY).then((x) => x.json());
    ok(adm.orders.some((x) => x.id === o1.id && x.partnerOrder), 'order appears in the admin list');
    const csv = await fetch(BASE + '/api/admin/schedule.csv?key=' + KEY).then((x) => x.text());
    ok(csv.includes(o1.id) && !/Bill partner|Partner billing/.test(csv), 'schedule CSV has the paid order and no "bill partner" wording');
    ok(/Manager's courtesy applied/.test(csv), "schedule CSV flags the Manager's courtesy");
    const conf = o1.emails.find((e) => e.kind === 'confirmation');
    const mail = conf ? await mailOf(conf) : '';
    ok(conf && conf.to === 'pat@example.com' && !/Billed to Paloma/.test(mail), 'confirmation email goes to the client and is a normal paid confirmation');
    fs.writeFileSync('/tmp/paltest/last-email.html', mail);
  }

  console.log('   4b. Path 2: Paloma\'s is paying (same card flow, payer = Paloma\'s)');
  const body2 = { ...body, payer: 'palomas', payMode: 'now', courtesy: false, pin: 'Palomas' };
  r = await post('/api/palomas/orders', body2);
  o = r.j.order || {};
  ok(r.s === 200 && o.status === 'awaiting_payment' && o.payer === 'other' && o.payerOther.email === 'palomas@palomascarmel.com', 'payer is Paloma\'s (palomas@palomascarmel.com), order awaits card payment');
  ok(o.contact.email === 'pat@example.com', 'client stays the delivery contact');
  pr = await pay(r.j.id, { method: 'apple_pay' });
  ok(pr.s === 200 && pr.j.order.status === 'confirmed', 'wallet payment confirms (same endpoint as the main site)');
  if (KEY) {
    const rc = pr.j.order.emails.find((e) => e.kind === 'payer_receipt');
    ok(rc && rc.to === 'palomas@palomascarmel.com', 'Paloma\'s gets the payer receipt email');
  }
  r = await post('/api/palomas/orders', { ...body, payer: 'palomas', payMode: 'link', pin: 'Palomas' });
  ok(r.s === 400 && /payment link/.test(r.j.error), 'a payment link is for the client only (not combined with "Paloma\'s is paying")');
  r = await post('/api/palomas/orders', { ...body, payer: 'someone' });
  ok(r.s === 400, 'unknown payer is refused');

  console.log('   4c. Path 3: email the client a payment link; daily reminders until paid');
  const body3 = { ...body, courtesy: false, payer: 'client', payMode: 'link', delivery: { ...body.delivery, email: 'link.client@example.com' } };
  r = await post('/api/palomas/orders', body3);
  o = r.j.order || {};
  ok(r.s === 200 && o.status === 'awaiting_payment' && o.statusNote === 'Awaiting payment — not scheduled until paid' && !o.payment, `order created: "${o.statusNote}"`);
  const pl = (o.emails || []).find((e) => e.kind === 'payment_link');
  ok(pl && pl.to === 'link.client@example.com', 'payment link email sent to the client');
  if (KEY) {
    const mail = await mailOf(pl);
    ok(mail.includes(`order=${o.id}`) && /pay=1/.test(mail) && /isn’t scheduled until payment/.test(mail), 'email has the pay button link and says it is not scheduled until paid');
    ok(!/\bcrat(e|ing|ed)\b|\bmov(e|ing|ers?)\b|\bhoist(ing|ed)?\b|\bCOI\b/i.test(mail), 'payment link email follows the copy rules');
    const csv0 = await fetch(BASE + '/api/admin/schedule.csv?key=' + KEY).then((x) => x.text());
    ok(!csv0.includes(o.id), 'not on the schedule (no CSV row) until paid');
    const run = (h) => fetch(BASE + '/api/admin/payment-reminders/run?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asOf: new Date(Date.now() + h * 3600e3).toISOString() }) }).then((x) => x.json());
    let rr = await run(2); ok(!rr.sent.includes(o.id), 'no reminder within the first day');
    rr = await run(25); ok(rr.sent.includes(o.id), 'reminder #1 goes out after 24h');
    rr = await run(26); ok(!rr.sent.includes(o.id), 'only one reminder per day (nothing an hour later)');
    rr = await run(50); ok(rr.sent.includes(o.id), 'reminder #2 the next day');
    const od = (await fetch(BASE + '/api/admin/orders?key=' + KEY).then((x) => x.json())).orders.find((x) => x.id === o.id);
    ok(od.paymentLink.reminders === 2 && od.emails.filter((e) => e.kind === 'payment_reminder').length === 2, 'two reminder emails recorded on the order');
    pr = await pay(o.id);
    ok(pr.s === 200 && pr.j.order.status === 'confirmed' && !pr.j.order.statusNote, 'paying via the link marks the order paid and confirmed');
    const csv1 = await fetch(BASE + '/api/admin/schedule.csv?key=' + KEY).then((x) => x.text());
    ok(csv1.includes(o.id), 'order lands on the schedule once paid');
    rr = await run(120); ok(!rr.sent.includes(o.id), 'reminders stop once paid');
  } else {
    pr = await pay(o.id);
    ok(pr.s === 200 && pr.j.order.status === 'confirmed' && !pr.j.order.statusNote, 'paying via the link marks the order paid and confirmed');
    console.log('   (admin key not provided: reminder, CSV and outbox checks skipped)');
  }
  const pg = await get(`/?order=${o.id}&pay=1`);
  ok(pg.s === 200, 'the payment link URL (/?order=ID&pay=1) loads the main site payment page');

  console.log('   4d. Access follow-ups and the schedule notes');
  const accBody = base([{ name: 'Marble-top Sofa Table', kind: 'Console Table', qty: 1 }, it('Table Lamp', 'small', 100, 1, 'Lamp')],
    { access: { mode: 'elevator', floor: '4', elevatorType: 'freight', elevatorReserve: true, elevSteps: 'yes', elevStepsN: '4', hours: 'Weekdays 9am-4pm via the front desk' }, schedule: { date: pu, deliveryDate: de },
      delivery: { ...body.delivery, notes: 'Gate code 1234, narrow turn past the lobby ' + RUN } });
  let bad = await post('/api/palomas/orders', { ...accBody, access: { mode: 'elevator', floor: '4' } });
  ok(bad.s === 400 && /elevator type/.test(bad.j.error), 'elevator without freight/passenger answer is refused');
  bad = await post('/api/palomas/orders', { ...accBody, access: { mode: 'elevator', floor: '4', elevatorType: 'freight' } });
  ok(bad.s === 400 && /steps before or after the elevator/.test(bad.j.error), 'elevator without the steps answer (yes / no / not sure) is refused');
  bad = await post('/api/palomas/orders', { ...accBody, access: { mode: 'elevator', floor: '4', elevatorType: 'freight', elevSteps: 'yes' } });
  ok(bad.s === 400 && /how many steps/.test(bad.j.error), 'steps = Yes without a count is refused');
  r = await post('/api/palomas/orders', accBody);
  o = r.j.order || {};
  ok(r.s === 200 && o.dropoff.serviceElevator === 'yes' && o.dropoff.hours === 'Weekdays 9am-4pm via the front desk', 'freight elevator + building hours saved on the order (same fields as the main site)');
  ok(/must be reserved in advance/.test(o.dropoff.notes) && /narrow turn past the lobby/.test(o.dropoff.notes) && /Gate code 1234/.test(o.dropoff.notes), 'reservation, and the single notes field (gate code + anything tight) are all in the delivery notes');
  ok(/Steps before\/after the elevator: yes, 4 steps/.test(o.dropoff.notes) && o.dropoff.elevatorStairs === 'not_sure' && o.accessReview === true, 'elevator steps (4) saved in the notes; more than 3 steps is flagged for CAD to confirm');
  for (const [ans, n, want] of [['no', '', 'no'], ['yes', '2', 'steps'], ['not_sure', '', 'not_sure']]) {
    const e = PAL.buildDropoff(base([]).delivery, { mode: 'elevator', floor: '2', elevatorType: 'passenger', elevSteps: ans, elevStepsN: n });
    ok(e.elevatorStairs === want && /Steps before\/after the elevator/.test(e.notes), `elevator steps "${ans}${n ? ' ' + n : ''}" → main-site answer "${want}", noted for the crew`);
  }
  ok(!JSON.stringify(PAL.buildDropoff(base([]).delivery, { mode: 'ground', tight: 'x' })).includes('Tight fit'), 'there is no separate tight-fit field any more');
  pr = await pay(r.j.id);
  ok(pr.s === 200 && pr.j.order.status === 'confirmed', 'access order paid and confirmed');
  if (KEY) {
    const csv = await fetch(BASE + '/api/admin/schedule.csv?key=' + KEY).then((x) => x.text());
    ok(/Hours: Weekdays 9am-4pm/.test(csv) && /must be reserved in advance/.test(csv) && /narrow turn past the lobby/.test(csv), 'schedule notes (DE Notes) carry hours, elevator reservation and the notes field');
    ok(/Steps before\/after the elevator: yes, 4 steps/.test(csv), 'schedule notes (DE Notes) carry the steps before/after the elevator');
  }
  const pAcc = await post('/api/palomas/orders', { ...accBody, access: { mode: 'stairs', flights: '2', hours: '' }, delivery: { ...body.delivery, notes: 'stairs ' + RUN } });
  ok(pAcc.s === 200 && pAcc.j.order.dropoff.stairFlights === '2', 'stairs: flights saved');
  const dAv = await post('/api/palomas/availability', { ...base([it('Sofa', 'medium', 3000)]), leg: 'pickup' });
  ok(dAv.j.days.length > 6 && dAv.j.days.length <= 14, `availability returns up to 14 days (${dAv.j.days.length}), the page shows the first 6 then "More dates"`);
  const laterD = new Date(Date.parse(dAv.j.days[dAv.j.days.length - 1].date + 'T12:00:00Z') + 20 * 864e5).toISOString().slice(0, 10);
  const lAv = await post('/api/palomas/availability', { ...base([it('Sofa', 'medium', 3000)]), leg: 'pickup', from: laterD });
  ok(lAv.j.days.length > 0 && lAv.j.days[0].date >= laterD, `"Later date" ${laterD} → days start on or after it (${lAv.j.days[0] && lAv.j.days[0].date})`);
  const lPick = lAv.j.days[0].date;
  const lDe = await post('/api/palomas/availability', { ...base([it('Sofa', 'medium', 3000)]), leg: 'dropoff', pickupDate: lPick });
  ok(lDe.j.days.length > 0 && lDe.j.days[0].date >= lPick, 'delivery days follow a later pickup date');
  const lOrder = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { schedule: { date: lPick, deliveryDate: lDe.j.days[0].date }, delivery: { ...body.delivery, notes: 'later ' + RUN } }));
  ok(lOrder.s === 200, 'an order on a later date (beyond the first 14 days) is accepted by the same scheduling rules');
  const badDay = await post('/api/palomas/orders', base([it('Sofa', 'medium', 3000)], { schedule: { date: '2026-12-26', deliveryDate: '2026-12-27' }, delivery: { ...body.delivery, notes: 'blackout ' + RUN } }));
  ok(badDay.s === 400, 'a non-route day / holiday is still refused');

  console.log('   4e. Access-fee copy and Manager\'s courtesy visibility (summary, receipt, emails)');
  const FEE = PAL.ACCESS_FEE_NOTE;
  ok(/covers the delivery as quoted/i.test(FEE) && !/\bcrat|\bmov(e|ing)|hoist|\bCOI\b/i.test(FEE), 'access-fee note: one sentence, price covers the delivery as quoted, copy rules respected');
  const qpub = await post('/api/palomas/quote', base([it('Sofa', 'medium', 3000)]));
  ok(qpub.j.accessFeeNote === FEE && qpub.j.payment.paymentSummary === 'Covers the delivery as quoted', 'live quote carries the note and no longer says "Paid in full at booking"');
  const mkCourt = (court, tag) => ({ ...body, courtesy: court, pin: court ? 'Palomas' : undefined, payer: 'client', payMode: 'link', delivery: { ...body.delivery, notes: `court-${tag} ${RUN}`, email: `court-${tag}@example.com` } });
  const rOff = await post('/api/palomas/orders', mkCourt(false, 'off'));
  const rOn = await post('/api/palomas/orders', mkCourt(true, 'on'));
  ok(rOff.j.order.quote.partnerPricing.courtesyOff === 0 && !rOff.j.order.quote.lines.some((l) => /courtesy/i.test(l.label)) && !(rOff.j.order.quote.notes || []).some((n) => /courtesy/i.test(n)), 'courtesy unchecked: no courtesy line or note on the order quote');
  ok(rOn.j.order.quote.lines.some((l) => l.label === "Manager's courtesy" && l.amount < 0), 'courtesy checked: the "Manager\'s courtesy" line is on the order');
  ok(rOn.j.order.quote.accessFeeNote === FEE && !(rOn.j.order.quote.notes || []).includes('Access isn’t confirmed yet. If it needs an added fee, we’ll go over it with you and get your OK before charging it.'), 'order quote carries the access-fee note (not the generic "access isn\'t confirmed" note)');
  if (KEY) {
    const mOff = await mailOf(rOff.j.order.emails.find((e) => e.kind === 'payment_link'));
    const mOn = await mailOf(rOn.j.order.emails.find((e) => e.kind === 'payment_link'));
    ok(!/courtesy/i.test(mOff), 'courtesy unchecked: the option never appears in the payment-link email');
    ok(/Manager's courtesy<\/b> −\$/.test(mOn), 'courtesy checked: the "Manager\'s courtesy" line shows in the payment-link email');
    ok(mOn.includes(FEE.replace(/’/g, '’')) || mOn.includes(FEE), 'payment-link email carries the access-fee note');
    ok(!/Paid in full at booking/.test(mOn) && !/\bcrat(e|ing|ed)\b|\bmov(e|ing|ers?)\b|\bhoist(ing|ed)?\b|\bCOI\b/i.test(mOn), 'payment-link email: no "Paid in full at booking", copy rules respected');
    const pOn = await pay(rOn.j.id);
    const conf = pOn.j.order.emails.find((e) => e.kind === 'confirmation');
    const cm = await mailOf(conf);
    ok(/Paid today/.test(cm) && !/Paid in full at booking/.test(cm) && cm.includes(FEE), 'confirmation/receipt email: "Paid today" + access-fee note');
    const pOff = await pay(rOff.j.id);
    const cmo = await mailOf(pOff.j.order.emails.find((e) => e.kind === 'confirmation'));
    ok(!/courtesy/i.test(cmo) && /Manager's courtesy<\/b> −\$/.test(cm), "courtesy unchecked: never in the receipt email; checked: the line shows on the receipt");
  } else { await pay(rOn.j.id); await pay(rOff.j.id); }

  console.log('\n4f. Staff code on submit, second client, stairs on an order');
  const gated = (extra, tag) => ({ ...body, courtesy: false, payer: 'client', payMode: 'now', delivery: { ...body.delivery, notes: `gate-${tag} ${RUN}` }, ...extra });
  let g1 = await post('/api/palomas/orders', gated({ courtesy: true, pin: undefined }, 'c1'));
  ok(g1.s === 403, "Manager's courtesy without the code is rejected by the server");
  g1 = await post('/api/palomas/orders', gated({ courtesy: true, pin: 'wrong' }, 'c2'));
  ok(g1.s === 403, "Manager's courtesy with a wrong code is rejected");
  g1 = await post('/api/palomas/orders', gated({ payer: 'palomas', pin: undefined }, 'p1'));
  ok(g1.s === 403, "Paloma's Pay without the code is rejected");
  g1 = await post('/api/palomas/orders', gated({ payer: 'palomas', pin: 'wrong' }, 'p2'));
  ok(g1.s === 403 && !/courtesy|discount|paloma/i.test(g1.j.error || ''), "Paloma's Pay with a wrong code is rejected, and the error says nothing about what it is");
  g1 = await post('/api/palomas/orders', gated({ payer: 'palomas', pin: 'PALOMAS' }, 'p3'));
  ok(g1.s === 200 && g1.j.order.payer === 'other' && g1.j.order.partnerInfo.payer === 'palomas', "Paloma's Pay with the code (any capitalization) is accepted");
  g1 = await post('/api/palomas/orders', gated({ courtesy: true, pin: 'palomas' }, 'c3'));
  ok(g1.s === 200 && g1.j.order.partnerInfo.courtesy === true, "Manager's courtesy with the code is accepted");
  g1 = await post('/api/palomas/orders', gated({}, 'plain'));
  ok(g1.s === 200 && g1.j.order.partnerInfo.courtesy === false && g1.j.order.partnerInfo.payer === 'client', 'the default order (client pays, no courtesy) needs no code');
  ok(!JSON.stringify(g1.j.order).includes('Palomas') || !('pin' in g1.j.order), 'the code is never stored on the order');

  const c2Body = gated({ delivery: { ...body.delivery, notes: 'two-clients ' + RUN, client2: { name: 'Sam Spouse', phone: '(831) 555-0199', email: 'sam@example.com' } } }, 'x');
  const c2 = await post('/api/palomas/orders', c2Body);
  ok(c2.s === 200 && c2.j.order.contact2 && c2.j.order.contact2.name === 'Sam Spouse' && c2.j.order.contact.name === 'Pat Client', 'second client saved on the order next to the first');
  ok(/Second client: Sam Spouse \(?831|Second client: Sam Spouse \(831\) 555-0199 sam@example.com/.test(c2.j.order.dropoff.notes), 'second client name, phone and email land in the delivery notes (and so in the schedule)');
  let c2bad = await post('/api/palomas/orders', gated({ delivery: { ...body.delivery, notes: 'c2bad ' + RUN, client2: { name: '', phone: '', email: 'x' } } }, 'y'));
  ok(c2bad.s === 400 && /second client/.test(c2bad.j.error), 'a started second client needs a name and a phone or email');
  c2bad = await post('/api/palomas/orders', gated({ delivery: { ...body.delivery, notes: 'c2none ' + RUN, client2: null } }, 'z'));
  ok(c2bad.s === 200 && !c2bad.j.order.contact2, 'the second client is optional');

  const stAv = await post('/api/palomas/orders', { ...gated({}, 'stairs'), items: [{ name: sofa.name, kind: sofa.kind, catalogId: sofa.id, qty: 1 }], access: { mode: 'stairs', flights: '3' } });
  ok(stAv.s === 200 && stAv.j.order.quote.lines.some((l) => /^Stairs/.test(l.label) && l.amount === 150), 'a stairs order carries the stairs fee line up front (1 large sofa x 3 flights x $50 = $150)');
  ok(stAv.j.order.accessReview === false, 'stairs no longer sends the order to access review (it is priced up front)');
  ok(near(stAv.j.order.quote.dueNow, stAv.j.order.quote.total), 'the stairs fee is part of what is due today');

  console.log('\n4g. Stripe Checkout (full dynamic payment methods) behind env vars');
  const SC = require('../lib/stripe-checkout');
  const mkO = (partner) => ({ id: 'CAD-TEST1', partnerOrder: partner, contact: { email: 'a@b.co' }, serviceLabel: 'Delivery', quote: { dueNow: 123.45 } });
  const sp = SC.sessionParams(mkO(true), { baseUrl: 'https://x.test', currency: 'usd', companyName: 'CAD' });
  ok(sp.mode === 'payment' && !('payment_method_types' in sp) && !('payment_method_options' in sp), "Paloma's orders: no payment_method_types, so Checkout offers every method enabled on the account (cards, Apple Pay, Google Pay, Link, bank debit...)");
  ok(sp.line_items[0].price_data.unit_amount === 12345 && sp.metadata.orderId === 'CAD-TEST1' && sp.metadata.partner === '1', 'session carries the exact amount due and the order id');
  ok(sp.success_url.includes('{CHECKOUT_SESSION_ID}') && sp.cancel_url.includes('CAD-TEST1'), 'success and cancel URLs return to the order');
  ok(SC.sessionParams(mkO(false), { baseUrl: 'https://x.test', currency: 'usd', companyName: 'CAD' }).payment_method_types.join() === 'card,us_bank_account', 'main-site orders are unchanged (card + bank)');
  const sess = (st, extra = {}) => ({ id: 'cs_test_1', payment_status: st, amount_total: 12345, payment_method_types: ['card', 'link'], metadata: { orderId: 'CAD-TEST1', partner: '1', saveMethod: '0' }, ...extra });
  ok(SC.paymentFromSession(sess('paid'), 'CAD-TEST1').status === 'paid' && SC.paymentFromSession(sess('paid'), 'CAD-TEST1').amount === 123.45, 'a paid session becomes a paid payment for the right amount');
  ok(SC.paymentFromSession(sess('processing'), 'CAD-TEST1').status === 'ach_processing', 'a still-processing bank payment confirms the job and is labeled processing');
  ok(SC.paymentFromSession(sess('unpaid'), 'CAD-TEST1') === null && SC.paymentFromSession(sess('paid'), 'CAD-OTHER') === null, 'unpaid sessions and sessions for another order are ignored');
  ok(SC.orderFromEvent({ type: 'checkout.session.completed', data: { object: sess('paid') } }).orderId === 'CAD-TEST1', 'webhook: checkout.session.completed (paid) settles the order');
  ok(SC.orderFromEvent({ type: 'checkout.session.async_payment_succeeded', data: { object: sess('paid') } }).orderId === 'CAD-TEST1', 'webhook: async_payment_succeeded settles the order');
  ok(SC.orderFromEvent({ type: 'checkout.session.completed', data: { object: sess('unpaid') } }) === null && SC.orderFromEvent({ type: 'payment_intent.created', data: { object: sess('paid') } }) === null, 'webhook: unpaid or unrelated events do nothing');
  const wh = await fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok([400, 503].includes(wh.status), `webhook endpoint exists and refuses unsigned calls (${wh.status}; 503 = Stripe keys not set on this server)`);
  const cfgj = (await get('/api/palomas/config')); const cj = JSON.parse(cfgj.t);
  ok(cj.pay && 'stripe' in cj.pay, `config reports Stripe on/off (stripe: ${cj.pay && cj.pay.stripe}); with no key the mock card flow is used in test mode`);

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
  ok(!/price[ -]sensitive/i.test(hay), 'the words "price sensitive" appear nowhere in the page, catalog or email');
  ok(!/Your call|no approval needed|Staff options/i.test(files.join('\n')), 'no "Your call, no approval needed" or "Staff options" text anywhere in the Paloma\'s page');
  ok(!/declared value protection/i.test(files.join('\n')), 'no declared value protection wording on the Paloma\'s page');
  ok(!/Declared value|Oversized or very heavy|Size tier|Anything tight\?|stairs can add a fee|Paloma's is paying/i.test(files.join('\n')), 'removed wording is gone: declared value, oversized, size tier, anything tight, stairs-can-add-a-fee, "Paloma\'s is paying"');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
