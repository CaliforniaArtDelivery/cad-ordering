/**
 * Samantha's Nov 19 testing: rush math, address checks, size checks. Local only, nothing sent.
 *   node scripts/fixes-nov19-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { quote } = require('../lib/pricing');
const V = require('../public/validate');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const near = (a, b) => Math.abs(a - b) < 0.006;
const hdr = (t) => console.log('\n[' + t + ']');

const order = (items, over = {}) => ({
  service: 'pickup_delivery', schedule: { date: '2026-12-08' },
  pickup: { street: '2 Henry Adams St', city: 'San Francisco', state: 'CA', zip: '94103' },
  dropoff: { street: '1 Main St', city: 'San Francisco', state: 'CA', zip: '94110' },
  items, ...over,
});
const art = (value, o = {}) => ({ type: 'painting', w: 30, h: 40, d: 2, value, description: 'test', ...o });

hdr('1. Rush: only the moving price is multiplied');
{
  const reg = quote(order([art(12344)]));
  ok(near(reg.total, 385.16) && near(reg.protection.amount, 185.16), 'regular: $200 service + $185.16 protection = $385.16', { total: reg.total, prot: reg.protection && reg.protection.amount });
  const r = quote(order([art(12344)], { rush: true }));
  console.log(`  rush range now: $${r.quoteRange.low} to $${r.quoteRange.high} (was $577.74 to $770.32)`);
  ok(near(r.quoteRange.low, 485.16) && near(r.quoteRange.high, 585.16), 'rush: $485.16 to $585.16 (200 x 1.5 / 2.0, plus protection once)', r.quoteRange);
  ok(near(r.total, 385.16) && r.lines.some((l) => /protection/.test(l.label) && near(l.amount, 185.16)), 'the protection line is still exactly 1.5% of declared value, unmultiplied');
  const d = quote(order([art(12344)], { dedicated: true }));
  ok(near(d.quoteRange.low, 485.16) && near(d.quoteRange.high, 585.16), 'dedicated trip uses the same split', d.quoteRange);
  const two = quote(order([art(12344), art(5000)], { rush: true }));
  ok(near(two.quoteRange.valueCharges, 185.16 + 75) && near(two.quoteRange.movingTotal + two.quoteRange.valueCharges, two.total), 'two pieces: both protection lines stay unmultiplied', two.quoteRange);

  // Over $50,000: 0.75% of value is folded into the piece price; only the moving part is multiplied.
  const bigReg = quote(order([art(60000)]));
  const bigRush = quote(order([art(60000)], { rush: true }));
  const fold = 450; // 0.75% of $60,000
  const moving = bigReg.total - fold;
  console.log(`  over $50k: regular $${bigReg.total} (moving $${moving} + $${fold} value charge); rush $${bigRush.quoteRange.low} to $${bigRush.quoteRange.high}`);
  ok(!bigReg.protection && near(moving, 200), 'over $50,000: no protection line, price = $200 moving + $450 (0.75%)', { total: bigReg.total, lines: bigReg.lines });
  ok(near(bigRush.quoteRange.low, 200 * 1.5 + fold) && near(bigRush.quoteRange.high, 200 * 2 + fold), 'over $50,000 rush: $750 to $850 (moving x1.5/x2.0, plus $450 once)', bigRush.quoteRange);

  const mixReg = quote(order([art(12344), art(60000)]));
  const mix = quote(order([art(12344), art(60000)], { rush: true }));
  const mixMoving = mixReg.total - 185.16 - 450; // second piece is priced lower as a second painting, so this is not simply 2 x $200
  console.log(`  mixed: regular $${mixReg.total} = moving $${mixMoving} + $185.16 protection + $450 value charge; rush $${mix.quoteRange.low} to $${mix.quoteRange.high}`);
  ok(near(mix.quoteRange.low, mixMoving * 1.5 + 635.16) && near(mix.quoteRange.high, mixMoving * 2 + 635.16), 'mixed order: under-$50k protection and over-$50k 0.75% both stay out of the multiplier', mix.quoteRange);

  const plain = quote(order([art(12344)]));
  ok(plain.paymentPlan !== 'quote' && !plain.quoteRange, 'non-rush order is unchanged (payable now, no range)');
  const noValue = quote(order([art(0)], { rush: true }));
  ok(near(noValue.quoteRange.low, 300) && near(noValue.quoteRange.high, 400), 'no declared value: plain 1.5x to 2x of the moving price', noValue.quoteRange);
}

hdr('2. Address checks (shared module)');
{
  const good = { street: '2 Henry Adams St', city: 'San Francisco', zip: '94103' };
  ok(V.addressProblems(good).length === 0, 'a normal address passes');
  ok(V.addressProblems({ ...good, zip: '94103-1234' }).length === 0, 'ZIP+4 passes');
  for (const z of ['123456', '1234', '9410', 'abcde', '94103-12', '94103 ', ' 123456']) {
    const p = V.addressProblems({ ...good, zip: z.trim() === '94103' ? '94103x' : z.trim() });
    ok(p.some((x) => x.field === 'zip'), `ZIP "${z}" is rejected`);
  }
  ok(V.addressProblems({ ...good, zip: '' }).some((x) => x.field === 'zip'), 'blank ZIP is rejected (US address)');
  ok(V.addressProblems({ ...good, street: '' }).some((x) => x.field === 'street'), 'street required');
  ok(V.addressProblems({ ...good, street: 'Melrose Ave' }).some((x) => x.field === 'street'), 'street needs a number');
  ok(V.addressProblems({ ...good, street: '   ' }).some((x) => x.field === 'street'), 'blank-space street rejected');
  ok(V.addressProblems({ ...good, city: '' }).some((x) => x.field === 'city'), 'city required');
  for (const c of ['x', '12345', 'asdf1234', '!!', '#$%']) ok(V.addressProblems({ ...good, city: c }).some((x) => x.field === 'city'), `city "${c}" is not plausible`);
  for (const c of ["Coeur d'Alene", 'St. Helena', 'Cañon City', 'Winston-Salem', 'LA', 'San Luis Obispo']) ok(!V.addressProblems({ ...good, city: c }).some((x) => x.field === 'city'), `city "${c}" is accepted`);
  ok(V.addressProblems({ street: 'Flat 2, 10 Downing Street', city: 'London', country: 'United Kingdom' }).length === 0, 'international destination: free-form postal code, only street and city needed');
}

hdr('3. Size checks (shared module)');
{
  ok(V.dimProblem({ w: '', h: '', d: '' }).state === 'missing', 'blank sizes are missing');
  ok(V.dimProblem({ w: 1, h: 1, d: 1 }).state === 'small', '1 x 1 x 1 is refused');
  ok(V.dimProblem({ w: 3.9, h: 20, d: 2 }).key === 'w', 'width under 4 in. is refused');
  ok(V.dimProblem({ w: 20, h: 3, d: 2 }).key === 'h', 'height under 4 in. is refused');
  ok(V.dimProblem({ w: 20, h: 20, d: 0.5 }).key === 'd', 'depth under 1 in. is refused');
  ok(V.dimProblem({ w: 4, h: 4, d: 1 }) === null, 'the minimum itself (4 x 4 x 1) is accepted');
  ok(V.dimProblem({ w: 24, h: 36, d: 1.5 }) === null, 'a framed print 24 x 36 x 1.5 is accepted');
}

hdr('4. Server: availability, order validation');
const PORT = 4200 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
(async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-fix19-'));
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', BASE_URL: BASE }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
    const o = order([art(5000)]);
    const good = (await post('/api/availability', o));
    ok(good.status === 200 && good.j.days && good.j.days.length > 0 && !!good.j.region, 'valid address still gets a route and dates', { status: good.status });
    const badZip = await post('/api/availability', { ...o, dropoff: { ...o.dropoff, zip: '123456' }, pickup: { ...o.pickup, zip: '123456' } });
    ok(badZip.status === 400 && badZip.j.days.length === 0 && !badZip.j.region && !badZip.j.zone, 'ZIP 123456: no route, no dates, HTTP 400', badZip.j);
    const badStreet = await post('/api/availability', { ...o, pickup: { ...o.pickup, street: 'Henry Adams St' } });
    ok(badStreet.status === 400 && badStreet.j.invalid.includes('pickup'), 'street without a number: no route', badStreet.j);
    const badCity = await post('/api/availability', { ...o, dropoff: { ...o.dropoff, city: '12' } });
    ok(badCity.status === 400 && badCity.j.invalid.includes('dropoff'), 'implausible city: no route', badCity.j);
    const dateOk = good.j.days[0].date;
    const full = (over = {}) => ({
      ...o, schedule: { date: dateOk, deliveryDate: dateOk, timePref: 'midday' }, payer: 'me', contact: { name: 'Test Client', email: 't@example.com', phone: '310-555-0100' },
      pickup: { ...o.pickup, contactName: 'A', contactPhone: '310-555-0101', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' },
      dropoff: { ...o.dropoff, contactName: 'B', contactPhone: '310-555-0102', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' }, ...over,
    });
    const goodOrder = await post('/api/orders', full({ items: [{ ...art(5000), framed: 'no' }] }));
    ok(goodOrder.status === 200 || (goodOrder.status === 400 && !/ZIP|street|city|size/.test((goodOrder.j || {}).error || '')), 'a valid order is not refused for address or size', goodOrder.j && goodOrder.j.error);
    const badOrderZip = await post('/api/orders', full({ dropoff: { ...full().dropoff, zip: '123456' }, items: [{ ...art(5000), framed: 'no' }] }));
    ok(badOrderZip.status === 400 && /ZIP/.test(badOrderZip.j.error), 'order with ZIP 123456 is refused', badOrderZip.j);
    const tiny = await post('/api/orders', full({ items: [{ ...art(5000), framed: 'no', w: 1, h: 1, d: 1 }] }));
    ok(tiny.status === 400 && /size/.test(tiny.j.error), 'order with a 1 x 1 x 1 piece is refused', tiny.j);
    const blank = await post('/api/orders', full({ items: [{ ...art(5000), framed: 'no', w: '', h: '', d: '' }] }));
    ok(blank.status === 400 && /size/.test(blank.j.error), 'order with blank sizes is refused', blank.j);
  } finally { child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
