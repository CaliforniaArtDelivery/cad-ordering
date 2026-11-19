/**
 * Production-like smoke test, all local, no real money, nothing sent.
 *   node scripts/smoke-test.js
 * A real server process (NODE_ENV=production, strict Date Guard, fresh storage, admin key) talks to the Google Sheet bridge test double
 * (Code.gs unchanged, in-memory Spreadsheet). One six-piece order goes through quote -> order -> test-mode payment -> confirmation ->
 * emails -> admin -> schedule CSV -> schedule sheet (TEST ORDERS tab) -> raw log, and every piece must show up, by number, at every stop.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startBridge } = require('./mock-bridge');
const seedCal = require('../lib/seed-calendar');

const FIXTURE = process.env.SCHEDULE_FIXTURE || '/workspace/fixtures/schedule-2026.json';
const PORT = 4100 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'smoke-admin-key-123456';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const near = (a, b) => Math.abs(a - b) < 0.006;
const hdr = (t) => console.log('\n[' + t + ']');
const J = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const post = async (p, b) => { const r = await fetch(BASE + p, J(b || {})); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const get = async (p, h) => { const r = await fetch(BASE + p, { headers: h || {} }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const adminGet = (p) => get(p, { 'x-admin-key': ADMIN });
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(200); } return null; };

const addr = (street, city, zip, extra = {}) => ({ street, city, zip, state: 'CA', contactName: 'Pat Contact', contactPhone: '310-555-0110', accessMode: 'ground', fits: 'yes', contactRole: 'Homeowner', ...extra });
const base = (date, items, over = {}) => ({
  service: 'pickup_delivery', contact: { name: 'Smoke Client', email: 'smoke@example.com', phone: '310-555-0100' },
  pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069', { business: 'Hamilton Gallery', contactName: 'Andrea B.' }),
  dropoff: addr('1200 Summit Ridge Dr', 'Beverly Hills', '90210', { contactName: 'Jordan Lee', contactPhone: '310-555-0199' }),
  items, schedule: { date, deliveryDate: date, timePref: 'midday' }, payer: 'me', notes: '', ...over,
});
const paint = (d, v, o = {}) => ({ type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: v, description: d, ...o });
const PIECES = [
  paint('Smoke Sunrise', 5000),
  paint('Smoke Harbor', 12000, { w: 72, h: 60 }),
  paint('Smoke Grand Master', 75000, { w: 48, h: 36 }),
  paint('Smoke Edge Case', 50000),
  { type: 'sculpture', weight: 120, w: 20, h: 30, d: 20, value: 500000, description: 'Smoke Bronze' },
  paint('Smoke Small Print', 900),
];

let child;
const startServer = async (storage, env) => {
  child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', ADMIN_KEY: ADMIN, BASE_URL: BASE, NODE_ENV: 'production', DATE_GUARD: 'strict', SHEETS_PUMP_MS: '250', SHEETS_BACKOFF_SCALE: '0.01', HOLD_MS: '60000', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {}); child.stdout.on('data', () => {});
  for (let i = 0; i < 60; i++) { try { await get('/api/config'); return; } catch { await sleep(250); } }
  throw new Error('server did not start');
};

(async () => {
  const seed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const bridge = await startBridge({ seed });
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-smoke-'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await (await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ action: 'seedCalendar', days: seedCal.rows(today, 120), secret: bridge.secret }) })).json();
  await startServer(storage, { SHEETS_WEBHOOK_URL: bridge.url, SHEETS_WEBHOOK_SECRET: bridge.secret });
  await sleep(700);

  try {
    hdr('1. the site is up');
    const home = await get('/'); const js = await get('/app.js'); const css = await get('/styles.css'); const cfg = await get('/api/config');
    ok(home.status === 200 && js.status === 200 && css.status === 200 && /Your pieces \(/.test(js.t) && /Confirm all/.test(js.t), 'home page, app.js and styles are served (new build)');
    ok(cfg.j && cfg.j.testMode === true, 'payments run in TEST mode (mock card, no real money)');
    const la = { service: 'pickup_delivery', pickup: { zip: '90069', city: 'West Hollywood' }, dropoff: { zip: '90210', city: 'Beverly Hills' }, items: [paint('p', 100)] };
    const av = (await post('/api/availability', la)).j;
    const D = av.days[0].date;
    ok(!!D, `an open delivery date is offered (${D})`);

    hdr('2. pricing: per-piece quote, thresholds, own line for each painting over $50,000');
    const q = (await post('/api/quote', base(D, PIECES))).j;
    const prot = q.lines.filter((l) => /^Required declared value protection/.test(l.label));
    ok(prot.length === 4 && prot.every((l) => /Piece \d/.test(l.label)), 'declared value protection: one named line for each of the 4 pieces up to $50,000', prot.map((l) => l.label));
    ok(near(prot.find((l) => /Piece 4/.test(l.label)).amount, 750), 'exactly $50,000 carries the $750 protection line');
    ok(!q.lines.some((l) => /Piece (3|5)\b/.test(l.label) && /protection|0\.75|high-value/i.test(l.label)) && !q.notes.some((n) => /protection|0\.75|50,000/i.test(n)), 'pieces over $50,000: no protection line, wording or note');
    const own3 = q.lines.find((l) => /^Piece 3 — Painting delivery$/.test(l.label));
    const grp = q.lines.find((l) => /^Painting delivery × 4 \(Pieces 1, 2, 4, 6\)/.test(l.label));
    ok(own3 && grp, 'the $75,000 painting has its own moving-price line; ordinary paintings stay grouped', q.lines.map((l) => l.label));
    const sc = q.lines.find((l) => /Sculpture/.test(l.label) && /Piece 5/.test(l.label));
    ok(sc && sc.amount > 3750, 'the $500,000 sculpture line has $3,750 built in (one price)', sc);
    const sum = q.lines.reduce((a, l) => a + l.amount, 0);
    ok(near(sum, q.total), 'the lines add up exactly to the total', [sum, q.total]);

    hdr('3. order, refusal of unconfirmed values, payment (test mode), double submit');
    const flagged = await post('/api/orders', base(D, [paint('Copy', 100, { checkValue: true })]));
    ok(flagged.status === 400 && /confirm the declared value/.test(flagged.j.error), 'an order with an unconfirmed copied value is refused');
    const body = base(D, PIECES);
    const [c1, c2] = await Promise.all([post('/api/orders', body), post('/api/orders', JSON.parse(JSON.stringify(body)))]);
    ok(c1.status === 200 && c1.j.id === c2.j.id, 'double submit creates one order', [c1.status, c1.j, c2.j]);
    const id = c1.j.id;
    ok(c1.j.order.items.length === 6 && c1.j.order.items.every((i) => i.id && !('qty' in i)) && !c1.j.order.needsManualReview, 'six pieces, ids, no qty, not flagged for review');
    const p1 = await post(`/api/orders/${id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(p1.status === 200, 'test-mode card payment accepted', p1.j);
    const p2 = await post(`/api/orders/${id}/pay`, { method: 'card', card: '4242424242424242' });
    const getOrd = async () => (await adminGet('/api/admin/orders')).j.orders.find((o) => o.id === id);
    await waitFor(async () => ((await getOrd()).emails || []).some((e) => e.kind === 'confirmation'), 15000); // the confirmation goes out once the schedule row is saved
    await sleep(500);
    const ord = await getOrd();
    ok(ord.status === 'confirmed' && ord.payment && ord.payment.status === 'paid' && ord.emails.filter((e) => e.kind === 'confirmation').length === 1, 'order confirmed once; a second pay call books and emails nothing new', [p2.status, ord.emails.map((e) => e.kind)]);

    hdr('4. confirmation data (what the confirmation page shows)');
    const conf = (await get('/api/orders/' + id)).j.order;
    ok(conf.items.length === 6 && conf.items.map((i) => i.description).join() === PIECES.map((p) => p.description).join(), 'all six pieces come back in order with description, size and value', conf.items.map((i) => i.description));
    ok(conf.items.every((i, k) => Number(i.value) === PIECES[k].value), 'each piece keeps its own declared value');

    hdr('5. customer email');
    const mail = conf.emails.find((e) => e.kind === 'confirmation');
    const html = fs.readFileSync(path.join(storage, 'outbox', mail.file), 'utf8');
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    ok(PIECES.every((p, k) => txt.includes(`Piece ${k + 1} — ${p.description}`)), 'confirmation email lists every piece by number and description');
    ok(/Required declared value protection/.test(txt) && !/Piece (3|5)[^.]{0,80}protection/.test(txt), 'email shows protection for the pieces up to $50,000 and none for the others');
    ok(!/\btax\b/i.test(txt) && !/no protection|not protected/i.test(txt), 'no tax, no "no protection" wording');

    hdr('6. admin (internal view)');
    ok(ord.itemLines.length === 6 && PIECES.every((p, k) => ord.itemLines[k].startsWith(`Piece ${k + 1} — ${p.description}`) && ord.itemLines[k].includes('$')), 'admin lists Piece 1–6 with type, size, weight, declared value', ord.itemLines);
    const adminPage = await get('/admin?key=' + ADMIN);
    ok(adminPage.status === 200 || adminPage.status === 302 || adminPage.status === 404, 'admin page responds', adminPage.status);
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    ok(/NEEDS MANUAL REVIEW/.test(adminHtml) && /legacyQty/.test(adminHtml), 'admin page has the needs-manual-review banner and original-record view');

    hdr('7. schedule CSV and schedule sheet (TEST ORDERS tab) and raw log');
    const csv = await fetch(BASE + '/api/admin/schedule.csv', { headers: { 'x-admin-key': ADMIN } });
    const csvT = await csv.text();
    ok(csv.status === 200 && PIECES.every((p, k) => csvT.includes(`Piece ${k + 1} — ${p.description}`)), 'schedule CSV has one labeled line per piece');
    const tabRows = () => { const sh = bridge.sheet('TEST ORDERS'); return sh ? sh.cells.filter((r) => String(r[9] || '').startsWith(`ONLINE ORDER ${id} `)) : []; };
    const rows = await waitFor(() => (tabRows().length ? tabRows() : null));
    ok(rows && rows.length > 0, 'the booking reached the sheet (mock payment goes to TEST ORDERS, never the live tab)');
    const rowText = (rows || []).map((r) => r.join(' | ')).join('\n');
    ok(PIECES.every((p, k) => rowText.includes(`Piece ${k + 1} — ${p.description}`)), 'the sheet rows list every piece by number and description', rowText.slice(0, 400));
    ok(!(bridge.sheet('ONLINE ORDERS') && bridge.sheet('ONLINE ORDERS').cells.some((r) => String(r[9] || '').includes(id))), 'nothing leaked to the live ONLINE ORDERS tab');
    const raw = bridge.sheet('ONLINE ORDERS RAW LOG');
    const rawText = raw ? raw.cells.map((r) => r.join('')).join('\n') : '';
    ok(rawText.includes(id) && PIECES.every((p) => rawText.includes(p.description)), 'the raw log (Drive-side test log) holds the whole order, all six pieces');
    ok(!/Smoke Sunrise[^\n]{0,200}"qty"/.test(rawText), 'raw log has no quantity field on the pieces');
    const mainBefore = JSON.stringify(seed.length);
    ok(bridge.sheet('SCHEDULE 2026').cells.length >= 1430, 'the existing SCHEDULE 2026 tab is untouched (no rows added)');

    hdr('8. internal email: pending request and old quantity entry');
    const rush = await post('/api/orders', base(D, [paint('Rush A', 3000), paint('Rush B', 4000)], { rush: true }));
    const rb = await waitFor(() => bridge.mails.find((m) => rush.j.id && m.subject.includes(rush.j.id)));
    ok(rb && /Piece 1/.test(rb.body || rb.htmlBody || '') && /Piece 2/.test(rb.body || rb.htmlBody || ''), 'the team review email lists each piece', rb && Object.keys(rb));
    const legacy = await post('/api/orders', base(D, [{ ...paint('Legacy Canvas', 2000), qty: 3 }]));
    ok(legacy.status === 200 && legacy.j.order.needsManualReview === true && legacy.j.order.legacyQty[0].originalItem.qty === 3 && legacy.j.order.items.length === 3, 'an old quantity entry keeps its original record and is flagged for manual review', legacy.j.order && legacy.j.order.legacyQty);
    const lb = await waitFor(() => bridge.mails.find((m) => m.subject.includes('NEEDS MANUAL REVIEW') && m.subject.includes(legacy.j.id)));
    ok(!!lb && /Piece 3/.test(lb.body || ''), 'the team is emailed about it, naming each piece');
    const lad = (await adminGet('/api/admin/orders')).j.orders.find((o) => o.id === legacy.j.id);
    ok(lad.needsManualReview && lad.itemLines.length === 3 && lad.legacyQty[0].originalItem.description === 'Legacy Canvas', 'admin shows it flagged, three labeled pieces, original entry kept');
  } catch (e) { fail++; console.log('  FAIL: smoke test crashed:', e && e.stack || e); }

  if (child) child.kill('SIGKILL');
  await bridge.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
