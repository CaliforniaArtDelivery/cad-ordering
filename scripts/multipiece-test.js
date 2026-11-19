/**
 * Multi-piece tests (Chad, Nov 18 2026): one entry = one piece. Starts its own server on a temp STORAGE_DIR and drives it with
 * the HTTP API and a headless Chromium at 390×844 (mobile).   node scripts/multipiece-test.js
 *   SHOTS=/path   screenshots of the key screens (default /workspace/multipiece_shots)
 *   ONLY=api|ui   run one half
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 3300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));
const ADMIN = 'test-admin-key-123456';
const SHOTS = process.env.SHOTS || '/workspace/multipiece_shots';
const ONLY = process.env.ONLY || '';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
let group = '';
const ok = (c, m, extra) => { results.push({ group, ok: !!c, m }); if (c) console.log('  ok  :', m); else console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); };
const near = (a, b) => Math.abs(a - b) < 0.006;
const J = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const post = async (p, b) => { const r = await fetch(BASE + p, J(b || {})); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const get = async (p, h) => { const r = await fetch(BASE + p, { headers: h || {} }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const adminGet = (p) => get(p, { 'x-admin-key': ADMIN });
const orders = () => { try { return JSON.parse(fs.readFileSync(path.join(STORAGE, 'data', 'orders.json'), 'utf8')); } catch { return []; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = (g) => { group = g; console.log('\n[' + g + ']'); };

let child;
async function startServer() {
  child = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, STORAGE_DIR: STORAGE, TEST_MODE: '1', ADMIN_KEY: ADMIN, BASE_URL: BASE, HELPER_HOLD_ORDERS: '0', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => { if (process.env.DEBUG) process.stderr.write(d); }); child.stdout.on('data', () => {});
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/config'); if (r.ok) return; } catch {} await sleep(250); }
  throw new Error('server did not start');
}

// ---- API fixtures ----
const paint = (o = {}) => ({ type: 'painting', description: 'Canvas', w: 72, h: 60, d: 2, framed: 'no', value: 12000, ...o });
const sculpt = (o = {}) => ({ type: 'sculpture', description: 'Bronze', w: 20, h: 30, d: 20, weight: 120, value: 5000, ...o });
let availCache = null;
async function dates() {
  if (availCache) return availCache;
  const a = await post('/api/availability', { service: 'pickup_delivery', items: [paint()], pickup: { street: '8678 Melrose Ave', city: 'West Hollywood', state: 'CA', zip: '90069' }, dropoff: { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', state: 'CA', zip: '90210' } });
  const d = a.j.days[0].date;
  const b = await post('/api/availability', { service: 'pickup_delivery', leg: 'dropoff', items: [paint()], schedule: { date: d }, pickup: { street: '8678 Melrose Ave', city: 'West Hollywood', state: 'CA', zip: '90069' }, dropoff: { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', state: 'CA', zip: '90210' } });
  availCache = { pu: d, del: b.j.days[0].date };
  return availCache;
}
let uniq = 0;
const stop = (k, street, city, zip) => ({ street, city, state: 'CA', zip, contactName: 'Jordan Lee', contactPhone: '(310) 555-0199', contactRole: 'Homeowner', accessMode: 'ground', dock: 'no', doorway: 'single', fits: 'yes' });
async function orderBody(items, extra = {}) {
  const d = await dates(); uniq++;
  return { service: 'pickup_delivery', items, pickup: stop('p', '8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: stop('d', '1200 Summit Ridge Dr', 'Beverly Hills', '90210'),
    contact: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '(310) 555-0199', company: '', clientType: 'Collector' }, heard: { source: 'google' },
    payer: 'me', schedule: { date: d.pu, window: '', timePref: 'none', timeNote: '', deliveryLater: d.del > d.pu, deliveryDate: d.del, deliveryTimePref: 'none', deliveryTimeNote: '' }, notes: 'multipiece test ' + uniq, ...extra };
}
const quoteOf = async (items, service = 'pickup_delivery') => (await post('/api/quote', { service, items })).j;
const lines = (q, re) => (q.lines || []).filter((l) => re.test(l.label));
const sum = (ls) => Math.round(ls.reduce((t, l) => t + l.amount, 0) * 100) / 100;
const DVP = /^Required declared value protection/;

async function apiTests() {
  hdr('API 1: one piece');
  {
    const q = await quoteOf([paint({ value: 12000, w: 40, h: 30, d: 2 })]);
    // 1 painting delivery $200 + protection 1.5% of $12,000 = $180
    ok(q.total === 380 && lines(q, DVP).length === 1 && lines(q, DVP)[0].amount === 180, '1 painting 40×30, $12,000: $200 + $180 protection = $380', q.lines);
    ok(lines(q, DVP)[0].label === 'Required declared value protection: 1.5% of $12,000', 'single piece keeps the plain protection label');
    const o = await post('/api/orders', await orderBody([paint({ value: 12000, w: 40, h: 30, d: 2, description: 'Solo canvas' })]));
    ok(o.status === 200 && o.j.order.items.length === 1 && !('qty' in o.j.order.items[0]) && /^[\w-]+$/.test(o.j.order.items[0].id), 'order stored with one piece, an id and no qty', o.j);
  }

  hdr('API 2: Chad\'s case, legacy "quantity 10" is expanded into ten pieces');
  {
    const legacy = { type: 'painting', qty: 10, description: 'Canvas', w: 72, h: 60, d: 2, framed: 'no', value: 12000 };
    const q = await quoteOf([legacy]);
    // delivery table: 7 pieces $575, +$50 each after = $725 for 10. Oversize 72"+: $100 × 10. Protection 1.5% × $12,000 = $180 × 10.
    ok(q.total === 3525, '10 × 72×60 painting at $12,000: $725 + $1,000 oversize + $1,800 protection = $3,525 (matches the old math)', q.total);
    ok(lines(q, DVP).length === 10 && sum(lines(q, DVP)) === 1800 && lines(q, DVP).every((l, i) => new RegExp(`Piece ${i + 1} \\(Canvas\\)`).test(l.label)), 'ten labeled protection lines: Piece 1 (Canvas) … Piece 10 (Canvas)', lines(q, DVP).map((l) => l.label));
    ok(lines(q, /^Painting delivery/)[0].label.includes('Pieces 1–10') && lines(q, /^Oversize painting \(72"\+\) delivery/)[0].label.includes('Pieces 1–10'), 'tiered group lines name the pieces they cover (Pieces 1–10)', q.lines.map((l) => l.label));
    ok(q.protection.pieces.length === 10 && q.protection.pieces[9].piece === 10, 'quote.protection.pieces has one entry per piece');
    const body = await orderBody([legacy]);
    const o = await post('/api/orders', body);
    const st = o.j && o.j.order;
    ok(o.status === 200 && st.items.length === 10 && st.items.every((it) => !('qty' in it) && it.value === 12000) && new Set(st.items.map((it) => it.id)).size === 10, 'server expands qty 10 into 10 stored pieces with unique ids', o.j);
    ok(st && st.quote.total === 3525, 'stored order total is $3,525');
    ok(st.needsManualReview === true && /quantity 10/.test(st.manualReviewReason) && st.legacyQty.length === 1 && st.legacyQty[0].qty === 10 && st.legacyQty[0].originalItem.qty === 10 && st.legacyQty[0].originalItem.description === 'Canvas' && st.legacyQty[0].firstPiece === 1 && st.legacyQty[0].lastPiece === 10, 'a submitted qty-10 entry keeps its ORIGINAL record (legacyQty/originalItem) and is flagged needs manual review', st.legacyQty);
    {
      const adm0 = await adminGet('/api/admin/orders'); const a0 = adm0.j.orders.find((x) => x.id === st.id);
      ok(a0 && a0.needsManualReview && a0.legacyQty[0].originalItem.qty === 10, 'admin API returns the flag and the original record');
    }
    {
      const clean = await post('/api/orders', await orderBody([paint({ description: 'Clean single' })]));
      ok(clean.status === 200 && !clean.j.order.needsManualReview && !clean.j.order.legacyQty, 'a normal one-piece order is not flagged');
      const flagged = await post('/api/orders', await orderBody([paint({ description: 'Needs confirm', checkValue: true })]));
      ok(flagged.status === 400 && /confirm the declared value for Piece 1/.test(flagged.j.error), 'the server refuses an order while a piece still says check value', flagged.j);
      const two = await post('/api/orders', await orderBody([paint({ description: 'A' }), paint({ description: 'B', checkValue: true }), paint({ description: 'C', checkValue: true })]));
      ok(two.status === 400 && /Piece 2.*Piece 3/.test(two.j.error), 'the refusal names every unconfirmed piece', two.j);
    }
    const adm = await adminGet('/api/admin/orders');
    const ao = adm.j.orders.find((x) => x.id === st.id);
    ok(ao.itemLines.length === 10 && ao.itemLines.every((l, i) => l.startsWith(`Piece ${i + 1} — Canvas`)) && /72 × 60 × 2 in/.test(ao.itemLines[0]) && /\$12,000/.test(ao.itemLines[0]), 'admin shows Piece 1 — Canvas … Piece 10 with size and value each', ao.itemLines);
    const sched = require(path.join(ROOT, 'lib', 'schedule'));
    const rows = sched.rowsForOrder(st);
    const col = sched.COLUMNS.indexOf('Item(s) and dimensions, weight, value, etc-');
    const txt = rows[0][col].split('\n');
    ok(txt.length === 10 && txt.every((l, i) => l.startsWith(`Piece ${i + 1} — Canvas`)) && rows.every((r) => r[col] === rows[0][col]), 'schedule sheet text has exactly one line per piece (10 lines, Piece 1 … Piece 10) on every row', txt);
    ok(!/10x|10×/.test(rows[0][col]), 'schedule text never says "10x"');
  }

  hdr('API 3: 10 different pieces, priced by hand');
  {
    const small = (v, n) => paint({ w: 30, h: 40, d: 2, value: v, description: 'Small ' + n });
    const big = (v, n) => paint({ w: 72, h: 60, d: 2, value: v, description: 'Large ' + n });
    const items = [1, 2, 3, 4, 5].map((n) => small(1000 * n, n)).concat([1, 2, 3, 4, 5].map((n) => big(2000 * n, n)));
    const q = await quoteOf(items);
    // delivery 725, oversize 5×100 = 500; protection = 1.5% × (1+2+3+4+5)k + 1.5% × 2×(1+..+5)k = 225 + 450
    const expected = 725 + 500 + 225 + 450;
    ok(q.total === expected, `10 different paintings = $${expected}`, q.total);
    ok(lines(q, DVP).length === 10 && lines(q, DVP).map((l) => l.amount).join() === '15,30,45,60,75,30,60,90,120,150', 'protection per piece = 1.5% of that piece alone', lines(q, DVP).map((l) => l.amount));
    ok(lines(q, /^Oversize painting \(72"\+\) delivery/)[0].label.includes('Pieces 6–10'), 'oversize line names Pieces 6–10', q.lines.map((l) => l.label));
    const mixedTypes = await quoteOf([paint({ w: 30, h: 40, value: 3000 }), sculpt({ description: 'Bust', value: 4000 }), { type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Sofa', value: 2000 }]);
    ok(lines(mixedTypes, /^Piece 2 — Sculpture/).length === 1 && lines(mixedTypes, /^Piece 3 — Sofa/).length === 1, 'sculpture and furniture lines carry their own piece label', mixedTypes.lines.map((l) => l.label));
    ok(near(mixedTypes.total, sum(mixedTypes.lines)), 'total equals the sum of the lines (mixed types)');
  }

  hdr('API 4: $49,999, $50,000, $50,001 (threshold is per piece)');
  {
    const base = 400; // 120 lb sculpture, one piece
    const a = await quoteOf([sculpt({ value: 49999 })]);
    const b = await quoteOf([sculpt({ value: 50000 })]);
    const c = await quoteOf([sculpt({ value: 50001 })]);
    ok(near(a.total, base + 749.99) && lines(a, DVP).length === 1, '$49,999: $400 + $749.99 protection', a.lines);
    ok(near(b.total, base + 750) && lines(b, DVP).length === 1 && lines(b, DVP)[0].amount === 750, '$50,000 exactly counts as standard: protection $750', b.lines);
    ok(near(c.total, 775.01) && !lines(c, DVP).length && !c.protection && !c.notes.some((n) => /50,000|protection|0\.75/i.test(n)) && c.lines.length === 1, '$50,001: $400 + 0.75% of $50,001 ($375.01) = $775.01 in ONE line; no protection line, wording or note', c);
    for (const [v, built] of [[75000, 562.5], [500000, 3750]]) { const r = await quoteOf([sculpt({ value: v })]); ok(near(r.total, 400 + built) && r.lines.length === 1 && !r.protection && !r.notes.some((n) => /protection|0\.75|50,000/i.test(n)), `$${v.toLocaleString()}: $${built} built in → $${(400 + built).toFixed(2)}, one line, no wording`, r); }
    const two = await quoteOf([sculpt({ value: 30000, description: 'A' }), sculpt({ value: 30000, description: 'B' })]);
    ok(lines(two, DVP).length === 2 && sum(lines(two, DVP)) === 900 && two.total === 800 + 900, 'two pieces at $30,000 (order total $60,000): both still get protection, since the limit is per piece', two.lines);
    const mix = await quoteOf([sculpt({ value: 49999, description: 'A' }), sculpt({ value: 50000, description: 'B' }), sculpt({ value: 50001, description: 'C' }), sculpt({ value: 1000, description: 'D' })]);
    // A 749.99 + B 750 + D 15 protection; C has $375.01 built into its own price line
    ok(near(mix.total, 1600 + 749.99 + 750 + 375.01 + 15) && lines(mix, DVP).length === 3 && !lines(mix, /Piece 3.*protection/i).length, 'mixed under / exactly / over $50,000 priced per piece', mix.lines);
    ok(mix.protection.pieces.map((x) => x.piece).join() === '1,2,4', 'protection covers pieces 1, 2 and 4 only');
    ok(mix.highValueItems.length === 1 && mix.highValueItems[0].index === 2 && mix.highValueItems[0].perPiece === 375.01, 'admin record of the built-in amount is for piece 3 only ($375.01)');
  }

  hdr('API 5: $0 / blank declared value');
  {
    const lowq = await quoteOf([sculpt({ value: 1 })]);
    ok(near(lowq.total, 400.02) && lines(lowq, DVP)[0].amount === 0.02, '$1 value: protection rounds to $0.02, there is no minimum fee', lowq.lines);
    const q0 = await quoteOf([sculpt({ value: 0 })]);
    ok(!lines(q0, DVP).length && !q0.protection, 'quote: $0 value adds no protection and no markup (nothing to protect)');
    const r0 = await post('/api/orders', await orderBody([sculpt({ value: 0, description: 'Zero piece' })]));
    ok(r0.status === 400 && /declared value above \$0 for Piece 1 — Zero piece/.test(r0.j.error), 'order: $0 is refused and names the piece', r0.j);
    const rb = await post('/api/orders', await orderBody([sculpt({ description: 'ok' }), sculpt({ value: '', description: 'Blank piece' })]));
    ok(rb.status === 400 && /Piece 2 — Blank piece/.test(rb.j.error) && !/Piece 1 —/.test(rb.j.error.replace(/Piece 2.*/, '')), 'order: blank value refused and only Piece 2 is named', rb.j);
    const rc = await post('/api/orders', await orderBody([{ type: 'custom', description: 'Collect two items from a framer' }]));
    ok(rc.status === 200 && rc.j.status === 'pending_approval', 'custom request needs no value and goes to CAD (the one case without a value)', rc.j);
  }

  hdr('API 6: 30 pieces, 60 limit, per-piece errors');
  {
    const items = Array.from({ length: 30 }, (_, i) => paint({ description: 'Canvas ' + (i + 1), value: 12000 }));
    const q = await quoteOf(items);
    // 575 + 23×50 = 1725; oversize 3000; protection 30 × 180
    ok(q.total === 1725 + 3000 + 5400, '30 identical large paintings = $10,125', q.total);
    ok(lines(q, DVP).length === 30 && lines(q, DVP)[6].label.includes('Piece 7 (Canvas 7)'), '30 protection lines, Piece 7 labeled with its description');
    const o = await post('/api/orders', await orderBody(items));
    ok(o.status === 200 && o.j.order.items.length === 30 && o.j.quote.total === 10125, '30 pieces accepted as one order', o.j && o.j.error);
    const many = Array.from({ length: 61 }, (_, i) => paint({ description: 'x' + i }));
    const r = await post('/api/orders', await orderBody(many));
    ok(r.status === 400 && /no more than 60 pieces/.test(r.j.error), '61 pieces refused', r.j);
    const huge = await post('/api/orders', await orderBody([{ ...paint(), qty: 5000 }]));
    ok(huge.status === 400 && /no more than 60 pieces/.test(huge.j.error), 'legacy qty 5000 refused cleanly (no crash)', huge.j);
    const bad = Array.from({ length: 9 }, (_, i) => sculpt({ description: 'S' + (i + 1) }));
    bad[6] = sculpt({ description: 'S7', weight: '', weightUnsure: false });
    const rb = await post('/api/orders', await orderBody(bad));
    ok(rb.status === 400 && /Piece 7 — S7/.test(rb.j.error) && !/Piece 6 —/.test(rb.j.error), 'a missing weight on piece 7 names only piece 7', rb.j);
  }

  hdr('API 7: photos required when weight is "Not sure", per piece');
  {
    const a = sculpt({ description: 'Known', weight: 50 });
    const b = paint({ description: 'Unsure', weightUnsure: true, w: 30, h: 40 });
    const r1 = await post('/api/orders', await orderBody([a, b]));
    ok(r1.status === 400 && /photos[^;]*Piece 2 — Unsure/.test(r1.j.error) && !/Piece 1 — Known/.test(r1.j.error), 'only the "Not sure" piece (Piece 2) needs photos', r1.j);
    const r2 = await post('/api/orders', await orderBody([a, { ...b, photos: ['/uploads/example.jpg'] }]));
    ok(r2.status === 200, 'with that piece\'s own photo the order goes through', r2.j);
    const c = await post('/api/orders', await orderBody([{ ...a, fragile: true }, b]));
    ok(c.status === 400 && /Piece 1 — Known/.test(c.j.error) && /Piece 2 — Unsure/.test(c.j.error), 'special handling also needs its own photos (both pieces named)', c.j);
  }

  hdr('API 8: double submit creates exactly one order');
  {
    const before = orders().length;
    const body = await orderBody([paint({ w: 40, h: 30, description: 'Twice', value: 3000 })]);
    const [x, y, z] = await Promise.all([post('/api/orders', body), post('/api/orders', body), post('/api/orders', body)]);
    await sleep(200);
    ok(x.j.id === y.j.id && y.j.id === z.j.id && orders().length === before + 1, 'three simultaneous identical submits make exactly one order', [x.j.id, y.j.id, z.j.id]);
    ok([x, y, z].filter((r) => r.j.duplicate).length === 2, 'the repeats are answered as duplicates');
    const legacyBody = await orderBody([{ ...paint({ description: 'Legacy twice', w: 40, h: 30, value: 3000 }), qty: 3 }]);
    const [p, q2] = await Promise.all([post('/api/orders', legacyBody), post('/api/orders', JSON.parse(JSON.stringify(legacyBody)))]);
    ok(p.j.id === q2.j.id && orders().filter((o) => o.id === p.j.id).length === 1 && p.j.order.items.length === 3, 'double submit of a legacy qty-3 payload: one order, three pieces');
  }

  hdr('API 9: saved legacy orders (qty > 1 in orders.json) never crash');
  {
    const f = path.join(STORAGE, 'data', 'orders.json');
    const all = orders();
    const legacy = JSON.parse(JSON.stringify(all.find((o) => o.items.length === 1)));
    legacy.id = 'CAD-LEGACY1'; legacy.fingerprint = 'legacy-fp'; legacy.status = 'confirmed';
    legacy.items = [{ type: 'painting', qty: 3, description: 'Old canvas', w: 40, h: 30, d: 2, framed: 'no', value: 3000 }, { type: 'sculpture', qty: 2, description: 'Old bronze', weight: 120, value: 5000 }];
    legacy.payment = { status: 'paid', method: 'mock_card', amount: 100, ref: 'mock_legacy' };
    all.unshift(legacy); fs.writeFileSync(f, JSON.stringify(all, null, 2));
    const g = await get('/api/orders/CAD-LEGACY1');
    ok(g.j.order.needsManualReview === true && g.j.order.legacyQty.length === 2 && g.j.order.legacyQty[0].originalItem.qty === 3 && g.j.order.legacyQty[1].originalItem.qty === 2 && g.j.order.legacyQty[1].firstPiece === 4, 'a STORED qty order keeps the original entries and is flagged needs manual review (not silently converted)', g.j.order.legacyQty);
    ok(g.j.order.quote.total === JSON.parse(fs.readFileSync(path.join(STORAGE, 'data', 'orders.json'), 'utf8')).find((x) => x.id === 'CAD-LEGACY1').quote.total, 'its stored quote is unchanged');
    ok(g.status === 200 && g.j.order.items.length === 5 && g.j.order.items.every((it) => !it.qty || it.qty === undefined) && new Set(g.j.order.items.map((i) => i.id)).size === 5, 'GET a saved qty order: 5 separate pieces with unique ids', g.j && g.j.order && g.j.order.items);
    const adm = await adminGet('/api/admin/orders');
    const ao = adm.j.orders.find((x) => x.id === 'CAD-LEGACY1');
    ok(ao && ao.itemLines.length === 5 && ao.itemLines[3].startsWith('Piece 4 — Old bronze'), 'admin lists the legacy order as Piece 1 … Piece 5', ao && ao.itemLines);
    const csv = await fetch(BASE + '/api/admin/schedule.csv', { headers: { 'x-admin-key': ADMIN } });
    ok(csv.status === 200 && /Piece 5 — Old bronze/.test(await csv.text()), 'schedule CSV lists the legacy order one line per piece');
    // Send the legacy confirmation email in a child process that writes to the temp outbox (never the repo's).
    const { spawnSync } = require('child_process');
    const run = spawnSync('node', ['-e', `const o=JSON.parse(process.env.LEG);require('./lib/email').send('confirmation',o)`], { cwd: ROOT, env: { ...process.env, STORAGE_DIR: STORAGE, LEG: JSON.stringify(legacy) }, encoding: 'utf8' });
    const outHtml = fs.readdirSync(path.join(STORAGE, 'outbox')).filter((f) => f.startsWith('CAD-LEGACY1-confirmation')).map((f) => fs.readFileSync(path.join(STORAGE, 'outbox', f), 'utf8')).join('').replace(/<[^>]*>/g, ' ');
    ok(run.status === 0 && /Piece 5 — Old bronze/.test(outHtml) && !/[23]× Old/.test(outHtml), 'confirmation email for the legacy order lists five labeled pieces, no "3×"', run.stderr);
  }

  hdr('API 10: confirmation email and Pay');
  {
    const items = [paint({ description: 'Alpha', w: 30, h: 40, value: 3000 }), paint({ description: 'Beta', w: 72, h: 60, value: 8000 }), sculpt({ description: 'Gamma', value: 60000 })];
    const o = await post('/api/orders', await orderBody(items));
    ok(o.status === 200 && o.j.status === 'awaiting_payment', 'three-piece order created', o.j);
    const id = o.j.id;
    const pay = await post(`/api/orders/${id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(pay.status === 200 && pay.j.order && pay.j.order.status === 'confirmed', 'mock payment confirms it', pay.j);
    await sleep(300);
    const files = fs.readdirSync(path.join(STORAGE, 'outbox')).filter((f) => f.startsWith(id + '-'));
    const txt = files.map((f) => fs.readFileSync(path.join(STORAGE, 'outbox', f), 'utf8')).join('\n').replace(/<[^>]*>/g, ' ');
    ok(files.length > 0 && /Piece 1 — Alpha/.test(txt) && /Piece 2 — Beta/.test(txt) && /Piece 3 — Gamma/.test(txt), 'confirmation email lists Piece 1 — Alpha, Piece 2 — Beta, Piece 3 — Gamma', files);
    ok(/Piece 1 — Alpha[^]*Piece 2 — Beta/.test(txt) && /Piece 1 \(Alpha\)|Piece 1 — Alpha: \$45/.test(txt), 'email protection lines are per piece');
    ok(!/Piece 3 — Gamma: \$[\d,.]+ \(1\.5%/.test(txt) && /Piece 2 — Beta: \$120 \(1\.5% of \$8,000\)/.test(txt), 'piece 3 ($60,000) has no protection line in the email; piece 2 shows $120 (1.5% of $8,000)', txt.match(/Required declared value protection[^]{0,300}/));
    const st = orders().find((x) => x.id === id);
    ok(st.quote.protection.pieces.map((p) => p.piece).join() === '1,2', 'order record: protection on pieces 1 and 2 only');
  }
}

module.exports = { ok, hdr, results, BASE, STORAGE, SHOTS, post, get, adminGet, orders, sleep, startServer, apiTests, near, quoteOf, orderBody, paint, sculpt, lines, sum, DVP, ROOT, ADMIN, getChild: () => child };

if (require.main === module) {
  (async () => {
    await startServer();
    try {
      if (ONLY !== 'ui') await apiTests();
      if (ONLY !== 'api') await require('./multipiece-ui-test').uiTests(module.exports);
    } catch (e) { ok(false, 'test run crashed: ' + (e && e.stack || e)); }
    child.kill();
    const bad = results.filter((r) => !r.ok);
    console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
    fs.writeFileSync(process.env.RESULTS || '/workspace/multipiece_test_results.json', JSON.stringify({ at: new Date().toISOString(), passed: results.length - bad.length, failed: bad.length, results }, null, 1));
    process.exit(bad.length ? 1 : 0);
  })();
}
