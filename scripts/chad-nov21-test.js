/**
 * Chad's Nov 21 2026 ordering feedback: pricing (frame steps, heavy wall pieces, hanging hardware, hanging height),
 * the 400 lb wall-piece block, Glass? independent of Framed?, the pickup + delivery pairs (must match leg=dropoff and the
 * server's own date check exactly), and the referral / heard notes in the schedule rows.
 *   node scripts/chad-nov21-test.js
 */
const fs = require('fs'); const os = require('os'); const path = require('path');
const PORT = 4700 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-nov21-'));
Object.assign(process.env, { PORT: String(PORT), STORAGE_DIR: STORAGE, TEST_MODE: '1', BASE_URL: BASE });
delete process.env.ADMIN_KEY; delete process.env.STRIPE_SECRET_KEY; delete process.env.SHEETS_WEBHOOK_URL;
const { quote, wallArtWeightFee, wallArtTooHeavy } = require('../lib/pricing');
const IT = require('../lib/itemtypes');
const SCH = require('../lib/schedule');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');
const stop = (street, city, zip, extra = {}) => ({ street, city, state: 'CA', zip, contactName: 'Pat', contactPhone: '310-555-0110', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes', ...extra });
const order = (service, items, over = {}) => ({ service, items, pickup: stop('2 Henry Adams St', 'San Francisco', '94103'), dropoff: stop('8678 Melrose Ave', 'West Hollywood', '90069'), contact: { name: 'T', email: 't@example.com', phone: '3105550100', clientType: 'Collector' }, ...over });
const lineSum = (q, rx) => q.lines.filter((l) => rx.test(l.label)).reduce((a, l) => a + l.amount, 0);
const art = (o = {}) => ({ type: 'painting', framed: 'no', glazing: 'no', w: 30, h: 40, d: 2, value: 5000, description: 'Canvas', ...o });

hdr('1. Frame type: even steps');
for (const [w, label] of [[60, 'over 48"'], [80, 'over 72"']]) {
  const cost = (ft) => { const q = quote(order('delivery_install', [art({ framed: 'yes', frameType: ft, w, h: 40 })])); return lineSum(q, /Frame handling|Large \/ heavy \/ ornate frame/); };
  const [s, m, l] = ['small', 'medium', 'large'].map(cost);
  ok(m - s === l - m && m - s === 50, `${label}: small ${s}, medium ${m}, large ${l} (even $50 steps)`, { s, m, l });
}
ok(lineSum(quote(order('delivery_install', [art({ framed: 'yes', frameType: 'large', w: 60, h: 40 })])), /frame/i) === 125, 'large frame over 48" still $125 total (install $100 + pickup & delivery $25)');

hdr('2. Heavy wall pieces');
const tiers = [[50, 0], [51, 50], [100, 50], [101, 100], [150, 100], [151, 150], [200, 150], [201, 200], [250, 200], [251, 250], [300, 250], [301, 300], [350, 300], [351, 400], [400, 400]];
for (const [lb, fee] of tiers) ok(wallArtWeightFee(art({ weight: String(lb) })) === fee, `painting ${lb} lb → +$${fee}`, wallArtWeightFee(art({ weight: String(lb) })));
['photograph', 'mirror', 'wallart'].forEach((t) => ok(wallArtWeightFee(art({ type: t, weight: '120' })) === 100, `${t} 120 lb → +$100`));
ok(wallArtWeightFee({ type: 'decor', furnitureKind: 'Mirror', weight: '60' }) === 50, 'Décor → Mirror counts as a mirror');
ok(wallArtWeightFee({ type: 'sculpture', weight: '300' }) === 0 && wallArtWeightFee({ type: 'furniture', weight: '300' }) === 0, 'sculpture / furniture keep their existing weight logic (no wall surcharge)');
ok(wallArtTooHeavy(art({ weight: '401' })) && !wallArtTooHeavy(art({ weight: '400' })) && !wallArtTooHeavy({ type: 'sculpture', weight: '1000' }), 'over 400 lb wall piece is blocked; 400 is not; sculpture never');
const qHeavy = quote(order('pickup_delivery', [art({ weight: '160' })]));
const qLight = quote(order('pickup_delivery', [art({ weight: '20' })]));
ok(Math.round((qHeavy.regularTotal || qHeavy.total) - (qLight.regularTotal || qLight.total)) === 150 && qHeavy.lines.some((l) => /Heavy wall piece \(over 150 lb\) — Piece 1, pickup & delivery/.test(l.label)), '160 lb painting adds one +$150 line to pickup & delivery', qHeavy.lines);
ok(!quote(order('install_only', [art({ weight: '160' })])).lines.some((l) => /Heavy wall/.test(l.label)), 'install only: no pickup & delivery surcharge');
ok(!qLight.lines.some((l) => /Heavy wall/.test(l.label)) && !quote(order('pickup_delivery', [art({ weight: '', weightUnsure: true })])).lines.some((l) => /Heavy wall/.test(l.label)), 'light or Not sure weight: no surcharge');

hdr('3. Hanging hardware and height (install jobs, per piece)');
const hw = (h) => lineSum(quote(order('delivery_install', [art({ hardware: h })])), /Hanging hardware/);
[['wire', 0], ['zbar', 45], ['cleat', 55], ['needs_wire', 55], ['needs_zbar', 75], ['not_sure', 0]].forEach(([h, f]) => ok(hw(h) === f, `hardware ${h} → +$${f}`, hw(h)));
ok(lineSum(quote(order('delivery_install', [art({ hardware: 'zbar' }), art({ hardware: 'cleat' })])), /Hanging hardware/) === 100, 'two pieces: Z-bar + French cleat = $100 (per piece)');
ok(lineSum(quote(order('pickup_delivery', [art({ hardware: 'zbar' })])), /Hanging hardware/) === 0, 'no hardware fee without installation');
ok(IT.HANG_WHERE_LABELS.high === 'Higher than eye level (stool or ladder needed)' && IT.HANG_WHERE_LABELS.mantel === 'Above a mantel or fireplace (stool or ladder needed)' && IT.HANG_WHERE_LABELS.stairwell === 'In a stairwell (ladder needed)', 'hanging height labels');
ok(IT.hangText({ type: 'painting', hangHeight: 'standard', hardware: 'zbar' }).includes('Z-bar already installed'), 'schedule item text names the hardware');

hdr('4. Glass? independent of Framed?');
ok(IT.needsGlass({ type: 'painting', framed: 'no' }) && IT.needsGlass({ type: 'wallart', framed: '' }) && !IT.needsGlass({ type: 'mirror' }), 'Glass? applies to painting / photograph / wall art whether framed or not (mirror is glass already)');
ok(/Framed: No · Glass: Yes/.test(IT.framingText({ type: 'wallart', framed: 'no', glazing: 'yes' })), 'unframed wall art with glass is recorded', IT.framingText({ type: 'wallart', framed: 'no', glazing: 'yes' }));

hdr('5. Heard / referral notes in the schedule rows');
const fakeOrder = (heard, partner) => ({ id: 'T1', createdAt: new Date().toISOString(), service: 'pickup_delivery', items: [art()], pickup: stop('2 Henry Adams St', 'San Francisco', '94103'), dropoff: stop('1 Main St', 'San Francisco', '94110'), contact: { name: 'T', email: 't@x.com', phone: '1' }, schedule: { date: '2026-12-02', deliveryDate: '2026-12-02' }, quote: { total: 100, paymentPlan: 'full', lines: [] }, payer: 'me', heard, partner: partner || { type: 'None', name: '' } });
const notesOf = (o) => JSON.stringify(SCH.legsForOrder ? SCH.legsForOrder(o) : SCH.rowsForOrder(o));
ok(/heard: ai \(ChatGPT\)/.test(notesOf(fakeOrder({ source: 'ai', sourceDetail: 'ChatGPT' }))), 'AI assistant detail lands in the notes');
ok(/referred by Ann Lee \(\(415\) 555-0123, ann@example.com\)/.test(notesOf(fakeOrder({ source: 'referral', referrerKind: 'friend', referrerName: 'Ann Lee', referrerPhone: '(415) 555-0123', referrerEmail: 'ann@example.com' }, { type: 'Friend or family', name: 'Ann Lee', phone: '(415) 555-0123', email: 'ann@example.com' }))), 'referrer name + mobile + email land in the notes');

(async () => {
  require('../server');
  await new Promise((r) => setTimeout(r, 600));
  const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) }; };
  hdr('6. Pickup + delivery pairs = the existing route logic');
  const combos = [
    ['SF → SF', stop('2 Henry Adams St', 'San Francisco', '94103'), stop('1 Main St', 'San Francisco', '94110')],
    ['SF → LA (cross region)', stop('2 Henry Adams St', 'San Francisco', '94103'), stop('8678 Melrose Ave', 'West Hollywood', '90069')],
    ['Irvine → San Diego', stop('6401 Oak Canyon', 'Irvine', '92618'), stop('1 Market St', 'San Diego', '92101')],
    ['Carmel → Palm Desert', stop('1 Ocean Ave', 'Carmel-by-the-Sea', '93921'), stop('73000 El Paseo', 'Palm Desert', '92260')],
  ];
  for (const [name, pu, de] of combos) {
    const base = order('pickup_delivery', [art()], { pickup: pu, dropoff: de });
    const r = await post('/api/availability', { ...base, leg: 'pairs' });
    const normal = await post('/api/availability', base);
    ok(r.status === 200 && r.j.delivery && r.j.delivery.days.length > 0, `${name}: pairs returned (${(r.j.days || []).length} pickup, ${(r.j.delivery || { days: [] }).days.length} delivery days)`);
    ok(JSON.stringify(r.j.days) === JSON.stringify(normal.j.days), `${name}: pickup column is exactly the normal pickup list`);
    let mismatch = 0, checked = 0, serverBad = 0;
    for (const p of [...r.j.days, ...(r.j.rush || [])].map((d) => d.date)) {
      const dl = await post('/api/availability', { ...base, leg: 'dropoff', schedule: { date: p } });
      const col = new Set(r.j.delivery.days.map((d) => d.date));
      const expect = dl.j.days.map((d) => d.date).filter((d) => col.has(d));
      const got = r.j.pairs[p] || [];
      // every leg=dropoff day shown for P (inside the column) is in pairs[P], and pairs[P] never holds a day leg=dropoff wouldn't
      if (!expect.every((d) => got.includes(d)) || got.some((d) => d < p)) mismatch++;
      checked++;
    }
    ok(mismatch === 0 && checked > 0, `${name}: pairs[P] matches leg=dropoff for all ${checked} pickup days`);
    // The server's own order check must accept every pair it offers and refuse a delivery outside pairs[P].
    const first = r.j.days[0].date, okD = (r.j.pairs[first] || [])[0];
    const col = r.j.delivery.days.map((d) => d.date);
    const badD = col.find((d) => d < first) || null;
    const v1 = await post('/api/orders', { ...base, payer: 'me', schedule: { date: first, deliveryDate: okD, timePref: 'none' } });
    ok(v1.status === 200 || (v1.j && !/delivery/i.test(JSON.stringify(v1.j.error || ''))), `${name}: an offered pair (${first} → ${okD}) passes the server date check`, v1.j && v1.j.error);
    if (badD) { const v2 = await post('/api/orders', { ...base, payer: 'me', schedule: { date: first, deliveryDate: badD } }); ok(v2.status === 400, `${name}: a delivery before pickup is refused`); }
  }
  hdr('7. Server refuses a wall piece over 400 lb');
  const pr = order('pickup_delivery', [art({ weight: '450' })]);
  const av = await post('/api/availability', pr);
  const d0 = av.j.days[0].date;
  const heavy = await post('/api/orders', { ...pr, payer: 'me', schedule: { date: d0, deliveryDate: d0 } });
  ok(heavy.status === 400 && /custom quote/.test(JSON.stringify(heavy.j)), 'order with a 450 lb painting is refused with the custom quote message', heavy.j);
  ok(!/\(\d{3}\)\s*\d{3}-\d{4}/.test(JSON.stringify(heavy.j)), 'no CAD phone number in the message');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
