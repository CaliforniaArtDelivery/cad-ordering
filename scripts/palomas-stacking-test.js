/* Paloma's discount stacking, as implemented (Nov 19 2026, Kaila's question). Pure checks on lib/palomas.js + lib/pricing.js, then the HTTP
 * endpoints when a server is running:  BASE=http://localhost:3111 node scripts/palomas-stacking-test.js
 * Rules (see lib/palomas.js header): standard CAD price -> 25% partnership price -> partnership price >= $1,000 earns an extra 10% ->
 * the staff / employee code unlocks Manager's courtesy: an extra 15% off what is LEFT. Discount codes from config.discountCodes (JT, ...) do NOT apply in this flow. */
const PAL = require('../lib/palomas');
const { quote } = require('../lib/pricing');
const BASE = process.env.BASE || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const r2 = (n) => Math.round((n + 1e-9) * 100) / 100;
const body = (items, extra = {}) => ({
  payer: 'client', payMode: 'now', placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', courtesy: false, items,
  delivery: { name: 'Pat Client', phone: '(831) 555-0123', email: 'pat@example.com', street: '100 Ocean Ave', city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921' },
  access: { mode: 'ground' }, ...extra,
});
const it = (kind, size, qty = 1, name = kind) => ({ name, kind, size, qty, value: 0 });
const small = [it('Table Lamp', 'small')];                         // under $1,000
const big = [it('Sofa', 'large', 4), it('Dining Table', 'large', 2)]; // well over $1,000 after partnership pricing

(async () => {
  console.log('\nStacking rules in lib/palomas.js (server-authoritative)');
  const rows = [];
  for (const [label, items] of [['small order (1 lamp)', small], ['large order (4 sofas + 2 dining tables)', big]]) {
    const a = PAL.partnerQuote(body(items)), b = PAL.partnerQuote(body(items, { courtesy: true }));
    rows.push([label, a, b]);
    ok(!a.special && r2(a.partner) <= r2(a.standard), `${label}: partnership price (${a.partner}) is at or below the standard price (${a.standard})`);
    ok(a.volumeEligible === (a.partner >= 1000) && a.volumeOff === (a.partner >= 1000 ? r2(a.partner * 0.10) : 0), `${label}: extra 10% only when the partnership price is $1,000 or more (partner $${a.partner}, 10% off = $${a.volumeOff})`);
    ok(a.courtesyOff === 0 && a.total === r2(a.partner - a.volumeOff), `${label}: no staff code means no courtesy; total $${a.total}`);
    ok(b.courtesyOff === r2((b.partner - b.volumeOff) * 0.15), `${label}: courtesy is 15% of what is left after the 10% ($${b.afterVolume} x 15% = $${b.courtesyOff})`);
    ok(b.total === r2(b.afterVolume - b.courtesyOff), `${label}: total with courtesy = $${b.total}`);
    ok(b.standard === a.standard && b.partner === a.partner && b.volumeOff === a.volumeOff, `${label}: the courtesy does not change the partnership price or the 10% (it is applied last, and never counts toward the $1,000)`);
  }
  // the courtesy never pushes a job over or under the $1,000 line: the threshold looks at the partnership price only
  const edge = PAL.applyExtras(1000, true), edge2 = PAL.applyExtras(999.99, true);
  ok(edge.volumeEligible && edge.volumeOff === 100 && edge.afterVolume === 900 && edge.courtesyOff === 135 && edge.delivery === 765, 'exactly $1,000: 10% = $100.00, courtesy = $135.00, total $765.00');
  ok(!edge2.volumeEligible && edge2.volumeOff === 0 && edge2.courtesyOff === 150 && edge2.delivery === 849.99, '$999.99: no 10%, courtesy 15% = $150.00 (rounded), total $849.99');

  console.log('\nOther discount codes do NOT stack in the Paloma\'s flow');
  const base = PAL.partnerQuote(body(big));
  const withCode = PAL.partnerQuote({ ...body(big), discountCode: 'JT' });
  ok(withCode.total === base.total && !withCode.discount, `a server discount code (JT, 25%) typed into a Paloma's order changes nothing (total $${withCode.total} either way)`);
  const eng = PAL.engineOrder(body(big), { member: true });
  const q0 = quote(eng), qJt = quote({ ...eng, discountCode: 'JT' });
  ok(qJt.total === q0.total && !(qJt.discount && qJt.discount.applied), 'the pricing engine itself skips discount codes for partner orders (lib/pricing.js: partner orders are excluded)');
  const reg = { service: 'pickup_delivery', items: [{ type: 'furniture', description: 'Sofa', furnitureKind: 'Sofa', sizeClass: 'medium', qty: 1, value: 0 }], pickup: PAL.pickupAddress('salinas'), dropoff: { street: '100 Ocean Ave', city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921', country: 'United States', accessMode: 'ground' } };
  const r0 = quote(reg), rJt = quote({ ...reg, discountCode: 'JT' });
  console.log(`   (for comparison, the regular public flow: Sofa $${r0.total} -> with JT $${rJt.total})`);

  if (BASE) {
    console.log('\nHTTP: the code is checked on the server, every time');
    const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const noCode = await post('/api/palomas/quote', body(big, { courtesy: true }));
    ok(noCode.j.courtesyOff === 0 && noCode.j.total === base.total, `courtesy requested WITHOUT the staff code is ignored (total $${noCode.j.total})`);
    const bad = await post('/api/palomas/quote', body(big, { courtesy: true, pin: 'wrong' }));
    ok(bad.j.courtesyOff === 0 && bad.j.total === base.total, 'courtesy with a WRONG code is ignored');
    const good = await post('/api/palomas/quote', body(big, { courtesy: true, pin: 'Palomas' }));
    const want = PAL.partnerQuote(body(big, { courtesy: true }));
    ok(good.j.courtesyOff === want.courtesyOff && good.j.total === want.total, `courtesy with the staff code (any capitalization) applies: total $${good.j.total}`);
    const jt = await post('/api/palomas/quote', { ...body(big, { courtesy: true, pin: 'Palomas' }), discountCode: 'JT' });
    ok(jt.j.total === want.total, 'staff code + a JT discount code: JT is ignored, only partnership + 10% + courtesy apply');
    const unlock = await post('/api/palomas/unlock', { code: 'Palomas' }), unlockBad = await post('/api/palomas/unlock', { code: 'nope' });
    ok(unlock.j.ok === true && unlockBad.j.ok === false, 'the unlock check used by the labeled field accepts the staff code and rejects others');
  }
  console.log('\nExample numbers');
  rows.forEach(([label, a, b]) => console.log(`   ${label}: standard $${a.standard} -> partnership $${a.partner} -> after 10% $${a.afterVolume}${a.volumeOff ? ` (-$${a.volumeOff})` : ' (not eligible)'} -> with staff code $${b.total} (courtesy -$${b.courtesyOff}); without $${a.total}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
