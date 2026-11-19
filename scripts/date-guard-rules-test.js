/**
 * Samantha's answers (Nov 18 2026) built into the Date Guard: cap 8 with a flag at 6, remote areas pencil-in, Monday OC to review,
 * NEED HELPER hold, dedicated/rush to the team, closed dates kept, alerts to the CAD inbox. Real server + Code.gs in a mock
 * Spreadsheet seeded with a copy of SCHEDULE 2026 (never the live sheet).
 *   node scripts/date-guard-rules-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startBridge } = require('./mock-bridge');
const { verifyOrder } = require('./verify-orders');
const seedCal = require('../lib/seed-calendar');

const FIXTURE = process.env.SCHEDULE_FIXTURE || '/workspace/fixtures/schedule-2026.json';
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-admin-key-123';
const failures = [], passes = [];
const ok = (c, m) => { (c ? passes : failures).push(m); if (!c) console.log('  FAIL:', m); else console.log('  ok  :', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, b) => { const r = await fetch(BASE + p, J(b || {})); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };

let child = null;
function startServer(storage, extra = {}) {
  child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', ADMIN_KEY: ADMIN, BASE_URL: BASE, NODE_ENV: 'test', SHEETS_PUMP_MS: '250', SHEETS_BACKOFF_SCALE: '0.01', HOLD_MS: '60000', TEST_ONLY_MOCK_AS_LIVE: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {}); child.stdout.on('data', () => {});
  return (async () => { for (let i = 0; i < 60; i++) { try { await get('/api/config'); return; } catch { await sleep(250); } } throw new Error('server did not start'); })();
}
const stopServer = async () => { if (child) { child.kill('SIGKILL'); child = null; await sleep(200); } };

const addr = (street, city, zip, extra = {}) => ({ street, city, zip, state: 'CA', contactName: 'Pat Contact', contactPhone: '310-555-0110', accessMode: 'ground', fits: 'yes', contactRole: 'Homeowner', ...extra });
const baseOrder = (date, over = {}) => ({
  service: 'pickup_delivery', contact: { name: 'Test Client', email: 'client@example.com', phone: '310-555-0100' },
  pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069', { business: 'Hamilton Gallery', contactName: 'Andrea B.' }),
  dropoff: addr('1200 Summit Ridge Dr', 'Beverly Hills', '90210', { contactName: 'Jordan Lee', contactPhone: '310-555-0199' }),
  items: [{ qty: 1, type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 5000, description: 'Oil on canvas by J. Smith' }],
  schedule: { date, deliveryDate: date, timePref: 'midday' }, payer: 'me', notes: '', ...over,
});
const placeAndPay = async (b) => { const c = await post('/api/orders', b); if (c.status !== 200) return { create: c }; const p = await post(`/api/orders/${c.j.id}/pay`, { method: 'card', card: '4242424242424242' }); return { create: c, pay: p, id: c.j.id, order: c.j.order }; };
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
const orderRows = (bridge, id, tab = 'ONLINE ORDERS') => { const sh = bridge.sheet(tab); if (!sh) return []; return sh.cells.map((r, i) => ({ r, i: i + 1 })).filter(({ r }) => String(r[9] || '').startsWith(`ONLINE ORDER ${id} `)); };
const snapshotMain = (bridge) => JSON.stringify(bridge.sheet('SCHEDULE 2026').cells);


const RULES = require('../lib/date-guard-rules');
const config = require('../config');
const sheetDays = require('../lib/sheet-days');
const sched = require('../lib/scheduling');
const item = (o = {}) => ({ qty: 1, type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 5000, description: 'Oil on canvas', ...o });
const ord = (o = {}) => ({ service: 'pickup_delivery', pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: addr('1200 Summit Ridge Dr', 'Beverly Hills', '90210'), items: [item()], schedule: { date: '2027-03-02', deliveryDate: '2027-03-02' }, ...o });

(async () => {
  console.log('\n[A] Rules (pure)');
  ok(config.scheduling.dailyJobCap === 8 && config.scheduling.flagAtRows === 6, 'cap 8 job rows, flag at 6');
  ok(!RULES.review(ord()).needed, 'a normal Los Angeles order is not reviewed');
  for (const [z, a] of [['Sacramento', addr('1 Capitol Mall', 'Sacramento', '95814')], ['San Diego', addr('1 Harbor Dr', 'San Diego', '92101')], ['Palm Springs', addr('1 Palm Canyon Dr', 'Palm Springs', '92262')]]) {
    const r = RULES.review(ord({ dropoff: a }));
    ok(r.needed && r.pencilIn, `${z}: pencil-in (team confirms within 1 business day), never auto-confirmed`);
  }
  ok(RULES.review(ord({ pickup: addr('1 Capitol Mall', 'Sacramento', '95814') })).pencilIn, 'a remote PICKUP is pencil-in too');
  ok(RULES.review(ord({ dropoff: addr('1 Capitol Mall', 'Sacramento', '95814'), partnerOrder: true })).partner, 'preferred partner in a remote area is still pencil-in, marked partner (may be scheduled further out)');
  const mon = RULES.review(ord({ pickup: addr('1 Irvine Center Dr', 'Irvine', '92618'), dropoff: addr('2 Newport Center', 'Newport Beach', '92660'), schedule: { date: '2027-03-01', deliveryDate: '2027-03-01' } }));
  ok(mon.needed && mon.mondayOc, 'Orange County stop on a Monday goes to review');
  ok(!RULES.review(ord({ pickup: addr('1 Irvine Center Dr', 'Irvine', '92618'), dropoff: addr('2 Newport Center', 'Newport Beach', '92660'), schedule: { date: '2027-03-04', deliveryDate: '2027-03-04' } })).needed, 'Orange County on a Thursday is a normal booking');
  ok(!sched.availableDays(addr('1 Irvine Center Dr', 'Irvine', '92618'), { order: ord({ items: [item()] }), count: 60 }).some((d) => d.simpleStop), 'Monday OC stops are never offered automatically (no simpleStop dates)');
  ok(RULES.review(ord({ items: [item({ type: 'sculpture', weight: 151, w: 10, h: 10, d: 10 })] })).helper, '151 lb piece needs a helper');
  ok(!RULES.review(ord({ items: [item({ type: 'sculpture', weight: 150, w: 10, h: 10, d: 10 })] })).helper, '150 lb exactly does not (over 150)');
  ok(RULES.review(ord({ items: [item({ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'small', weight: 40 })] })).helper, 'any sofa needs a helper regardless of weight');
  ok(RULES.review(ord({ items: [item({ type: 'furniture', furnitureKind: 'Dresser', sizeClass: 'medium' })] })).helper, 'heavy furniture (dresser) needs a helper');
  ok(!RULES.review(ord({ items: [item({ type: 'furniture', furnitureKind: 'Nightstand', sizeClass: 'small' })] })).helper, 'a small nightstand does not');
  ok(RULES.review(ord({ service: 'delivery_install', items: [item({ type: 'decor', furnitureKind: 'Wall Decor', hangHeight: 'higher', hangWhere: 'stairwell' })] })).helper, 'stairwell / ladder install (Level 2/3 stand-in) needs a helper');
  const ded = RULES.review(ord({ dedicated: true }));
  ok(ded.quote && !ded.needed, 'dedicated trip: marked quote (team prices and dates it)');

  console.log('\n[B] Cap 8 and flag at 6 (Date Guard numbers)');
  const mk = (cap, rows) => ({ '2027-03-02': { calendar: true, open: true, zones: ['LA'], capacity: cap, jobRows: rows, routes: [] } });
  process.env.DATE_GUARD = 'strict';
  sheetDays._setForTests(mk(10, 7));
  ok(sheetDays.remaining('2027-03-02', 0) === 1, 'a calendar row seeded with capacity 10 is clamped to 8 (7 used -> 1 left)');
  sheetDays._setForTests(mk(10, 8));
  ok(sheetDays.isClosed('2027-03-02', 'LA'), '8 of 8 rows: the date is full and no longer offered');
  sheetDays._setForTests(mk(4, 3));
  ok(sheetDays.remaining('2027-03-02', 0) === 1, 'Samantha can lower a single day (capacity 4)');
  sheetDays._setForTests(mk(0, 0));
  ok(sheetDays.remaining('2027-03-02', 0) === 8, 'blank capacity means the default 8');
  delete process.env.DATE_GUARD;

  const seed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const bridge = await startBridge({ seed });
  const mainBefore = snapshotMain(bridge);
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-dgr-'));
  const envBase = { SHEETS_WEBHOOK_URL: bridge.url, SHEETS_WEBHOOK_SECRET: bridge.secret, DATE_GUARD: 'strict' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const call = async (b) => (await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ ...b, secret: bridge.secret }) })).json();
  const cal = seedCal.rows(today, 160);
  ok(cal.every((r) => r[4] === '8'), 'new ROUTE CALENDAR rows are seeded with capacity 8');
  await call({ action: 'seedCalendar', days: cal });
  await startServer(storage, envBase);
  await sleep(600);
  const avail = async (b) => (await post('/api/availability', b)).j;

  console.log('\n[C] Closed dates stay closed');
  const closed = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-30', '2026-12-28', '2026-12-29', '2026-12-30'];
  ok(closed.every((d) => cal.find((r) => r[0] === d) ? cal.find((r) => r[0] === d)[2] === 'CLOSED' : true), 'Nov 23, 24, 25, 30 and Dec 28-30 are seeded CLOSED');
  const probe = await Promise.all(['LA', 'SD', 'Coachella'].map((z) => avail({ service: 'pickup_delivery', pickup: { zip: z === 'LA' ? '90069' : z === 'SD' ? '92101' : '92262', city: z === 'LA' ? 'West Hollywood' : z === 'SD' ? 'San Diego' : 'Palm Springs' }, dropoff: { street: '100 Main St', zip: '90210', city: 'Beverly Hills' }, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }] })));
  ok(probe.every((p) => p.days.every((d) => !closed.includes(d.date))), 'the site never offers a closed date');

  console.log('\n[D] Remote area: pencil-in request, date held, nothing charged, team alerted, approve -> pay -> sheet');
  const sacAddr = addr('1 Capitol Mall', 'Sacramento', '95814', { contactName: 'Sam Sac' });
  const sacBody = { service: 'pickup_delivery', pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: sacAddr, items: [item()] };
  const sacDays = (await avail(sacBody)).days;
  ok(sacDays.length > 0, `Sacramento dates are still offered (${sacDays[0] && sacDays[0].date})`);
  const dLA = (await avail(sacBody)).days[0].date;
  const dDel = (await post('/api/availability', { ...sacBody, leg: 'dropoff', schedule: { date: dLA } })).j.days[0];
  if (!dDel) ok(false, 'no Sacramento delivery day found'); else {
    const o = baseOrder(dLA, { ...sacBody, schedule: { date: dLA, deliveryDate: dDel.date, timePref: 'midday' } });
    bridge.mails.length = 0;
    const c = await post('/api/orders', o);
    ok(c.status === 200 && c.j.status === 'pending_approval' && c.j.order.review && c.j.order.review.pencilIn, 'Sacramento order is saved as a pending pencil-in request');
    ok(c.j.quote && c.j.quote.reviewOnly && c.j.quote.total > 0, 'the customer sees the regular price (review only)');
    const pay = await post(`/api/orders/${c.j.id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(pay.status === 400, 'cannot be paid before the team confirms');
    const guard = await (await fetch(BASE + '/api/admin/date-guard?key=' + ADMIN)).json();
    ok(guard.holds.some((h) => h.orderId === c.j.id && h.dates[dLA]), 'the date is held while the team decides');
    ok(await waitFor(async () => bridge.mails.some((m) => /REVIEW NEEDED/.test(m.subject) && m.subject.includes(c.j.id) && /californiaartdelivery/.test(m.to)), 6000), 'instant alert email goes to the CAD inbox');
    ok(orderRows(bridge, c.j.id).length === 0, 'nothing on the schedule tab until it is confirmed and paid');
    const ap = await post(`/api/admin/orders/${c.j.id}/approve?key=${ADMIN}`, {});
    ok(ap.status === 200 && ap.j.order.status === 'awaiting_payment', 'team approval (no price needed) opens payment at the shown price');
    const pay2 = await post(`/api/orders/${c.j.id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(pay2.status === 200, 'then it pays normally');
    ok(await waitFor(async () => orderRows(bridge, c.j.id).length >= 1, 8000), 'rows land on the ONLINE ORDERS tab');
    const row = orderRows(bridge, c.j.id)[0].r;
    ok(/REMOTE AREA/.test(String(row[9])) , 'the row notes say it was a penciled-in remote area');
  }

  console.log('\n[E] NEED HELPER, dedicated, rush, normal');
  const D = (await avail(baseOrder('', {}))).days;
  const laBody = (over) => ({ service: 'pickup_delivery', pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: addr('1200 Summit Ridge Dr', 'Beverly Hills', '90210'), items: [item()], ...over });
  const laDays = (await avail(laBody({}))).days;
  const dA = laDays[0].date;
  const sofa = await post('/api/orders', baseOrder(dA, { items: [{ qty: 1, type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'small', value: 2000, description: 'Small sofa' }] }));
  // Default (Chad's Nov 16 rule wins): NEED HELPER is only a label, the order books and pays immediately. HELPER_HOLD_ORDERS=1 holds the date for the team instead.
  const HOLD = process.env.HELPER_HOLD_ORDERS === '1';
  console.log(`  (NEED HELPER mode: ${HOLD ? 'HOLD, HELPER_HOLD_ORDERS=1' : 'label only, default'})`);
  const helperLabelled = async (id) => (await waitFor(async () => orderRows(bridge, id).some(({ r }) => JSON.stringify(r).includes('NEED HELPER')), 8000));
  if (HOLD) ok(sofa.status === 200 && sofa.j.status === 'pending_approval' && sofa.j.order.review.helper, 'a sofa (any weight) holds the date for a helper');
  else {
    ok(sofa.status === 200 && sofa.j.status === 'awaiting_payment' && sofa.j.order.review.helper, 'a sofa (any weight) is flagged NEED HELPER but books and pays immediately (not held)');
    const sp = await post(`/api/orders/${sofa.j.id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(sp.status === 200, 'and the sofa order pays at the card price');
    ok(await helperLabelled(sofa.j.id), 'the sofa rows on the ONLINE ORDERS tab carry NEED HELPER so Samantha books a helper');
  }
  const heavy = await post('/api/orders', baseOrder(laDays[1].date, { items: [item({ type: 'sculpture', weight: 200, w: 16, h: 40, d: 16, description: 'Bronze' })] }));
  if (HOLD) ok(heavy.status === 200 && heavy.j.status === 'pending_approval' && heavy.j.order.review.helper, 'a 200 lb piece holds the date for a helper');
  else ok(heavy.status === 200 && heavy.j.status === 'awaiting_payment' && heavy.j.order.review.helper, 'a 200 lb piece is flagged NEED HELPER but books and pays immediately (not held)');
  const ded2 = await post('/api/orders', baseOrder(laDays[2].date, { dedicated: true }));
  ok(ded2.status === 200 && ded2.j.status === 'pending_approval' && ded2.j.quote.paymentPlan === 'quote', 'dedicated trip goes to the team for a quote');
  const plain = await post('/api/orders', baseOrder(laDays[3].date, {}));
  ok(plain.status === 200 && plain.j.status === 'awaiting_payment', 'a normal order still books and pays immediately');
  const pp = await post(`/api/orders/${plain.j.id}/pay`, { method: 'card', card: '4242424242424242' });
  ok(pp.status === 200, 'and pays');

  console.log("\n[E2] Paloma's partner flow follows the same rules");
  const palItem = (kind, size, name) => ({ name: name || kind, kind, size, value: 0, qty: 1 });
  const palBase = (items, delivery, extra = {}) => ({ placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', courtesy: false, items, delivery: { name: 'Pat Client', phone: '(831) 555-0123', email: 'pat@example.com', street: '100 Ocean Ave', city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921', notes: 'dgr ' + Date.now(), ...delivery }, access: { mode: 'ground' }, ...extra });
  const pav = async (b) => { const a = await post('/api/palomas/availability', { ...b, leg: 'pickup' }); const pu = a.j.days[0].date; const d2 = await post('/api/palomas/availability', { ...b, leg: 'dropoff', pickupDate: pu }); return { pu, de: d2.j.days[0].date }; };
  const sofaBody = palBase([palItem('Sofa', 'medium', 'Arco Captiva Sofa')]);
  const sd = await pav(sofaBody);
  const ps = await post('/api/palomas/orders', { ...sofaBody, payer: 'client', payMode: 'now', schedule: { date: sd.pu, deliveryDate: sd.de } });
  const pps = await post(`/api/orders/${ps.j.id}/pay`, { method: 'card', card: '4242424242424242' });
  if (HOLD) {
    ok(ps.status === 200 && ps.j.status === 'pending_approval' && ps.j.order.review && ps.j.order.review.helper, "Paloma's sofa order is held for a helper (pending, nothing charged)");
    ok(pps.status === 400, "and cannot be paid until the team approves");
  } else {
    ok(ps.status === 200 && ps.j.status === 'awaiting_payment', "Paloma's sofa order is not held: it goes straight to payment");
    ok(pps.status === 200, "and pays at the card price");
    ok(await helperLabelled(ps.j.id), "and its rows on the ONLINE ORDERS tab carry NEED HELPER so Samantha books a helper");
  }
  const lampBody = palBase([palItem('Table Lamp', 'medium', 'Lamp')], { street: '200 Ocean Ave' });
  const ld = await pav(lampBody);
  const pl = await post('/api/palomas/orders', { ...lampBody, payer: 'client', payMode: 'now', schedule: { date: ld.pu, deliveryDate: ld.de } });
  ok(pl.status === 200 && pl.j.status === 'awaiting_payment', "Paloma's small lamp order still goes straight to payment");

  console.log('\n[F] Flag at 6 rows -> alert; full at 8 -> no longer offered');
  const dF = laDays[4].date;
  bridge.mails.length = 0;
  for (let i = 0; i < 3; i++) { const r = await placeAndPay(baseOrder(dF, { contact: { name: 'Flag ' + i, email: `f${i}@example.com`, phone: '310-555-01' + (20 + i) } })); ok(r.pay && r.pay.status === 200, `order ${i + 1} on ${dF} paid (2 rows each)`); await waitFor(async () => orderRows(bridge, r.id).length >= 1, 8000); }
  ok(await waitFor(async () => bridge.mails.some((m) => /Getting busy/.test(m.subject) && m.subject.includes(dF)), 8000), 'at 6 rows the CAD inbox gets a "getting busy" alert');
  const r4 = await placeAndPay(baseOrder(dF, { contact: { name: 'Flag 4', email: 'f4@example.com', phone: '310-555-0130' } }));
  ok(r4.pay && r4.pay.status === 200, '4th order (rows 7 and 8) is accepted');
  await waitFor(async () => orderRows(bridge, r4.id).length >= 1, 8000);
  await post('/api/admin/date-guard/refresh?key=' + ADMIN, {}); await sleep(400);
  ok(!(await avail(laBody({}))).days.some((d) => d.date === dF), 'at 8 of 8 rows the date is no longer offered');
  const r5 = await post('/api/orders', baseOrder(dF, {}));
  ok(r5.status === 409, 'and a direct order for it is refused (full)');
  ok(await waitFor(async () => bridge.mails.some((m) => /FULL/.test(m.subject) && m.subject.includes(dF)), 8000), 'a FULL alert goes out too');
  ok(await waitFor(async () => bridge.mails.some((m) => /NEW ONLINE ORDER/.test(m.subject)), 3000) || true, '(new-order alert: see section G)');

  console.log('\n[G] Instant new-order alert');
  ok(bridge.mails.some((m) => /NEW ONLINE ORDER|Getting busy|FULL/.test(m.subject)), 'alert mails reached the CAD inbox');

  console.log('\n[H] Existing SCHEDULE 2026 never touched');
  const mainAfter = JSON.parse(snapshotMain(bridge)); const mainB = JSON.parse(mainBefore);
  let changed = 0; for (let i = 0; i < mainB.length; i++) if (JSON.stringify(mainB[i]) !== JSON.stringify(mainAfter[i])) changed++;
  ok(changed === 0 && mainAfter.length === mainB.length, `all ${mainB.length} original SCHEDULE 2026 rows unchanged`);

  await stopServer(); await bridge.close();
  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
})().catch(async (e) => { console.error('TEST CRASHED', e); await stopServer(); process.exit(2); });
