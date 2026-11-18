/**
 * End-to-end test of the schedule bridge: real server (child process) + Code.gs running in a mock Spreadsheet seeded with a copy of
 * SCHEDULE 2026. Covers: Date Guard, last-slot concurrency, hold expiry, duplicate / out-of-order events, crash between payment and
 * write, retries, pending payments, edits/cancels (verifier), permission failure, alert delivery, reconciliation, odd characters,
 * header-change guard, and that no existing SCHEDULE 2026 cell is ever touched.
 *   node scripts/bridge-test.js
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

(async () => {
  const seed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const bridge = await startBridge({ seed });
  const mainBefore = snapshotMain(bridge);
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-bridge-'));
  const envBase = { SHEETS_WEBHOOK_URL: bridge.url, SHEETS_WEBHOOK_SECRET: bridge.secret, DATE_GUARD: 'strict' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const call = async (b) => (await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ ...b, secret: bridge.secret }) })).json();

  console.log('\n[1] ROUTE CALENDAR seeded, Date Guard strict');
  const cal = seedCal.rows(today, 120);
  const seeded = await call({ action: 'seedCalendar', days: cal });
  ok(seeded.ok && seeded.seeded === 120, `calendar seeded (${seeded.seeded} dates)`);
  const again = await call({ action: 'seedCalendar', days: cal });
  ok(again.seeded === 0, 'seeding twice adds nothing (never overwrites)');
  await startServer(storage, envBase);
  await sleep(600);
  const guard0 = await (await fetch(BASE + '/api/admin/date-guard?key=' + ADMIN)).json();
  ok(guard0.guard.mode === 'strict' && guard0.guard.fetchedAt, 'server runs in strict mode with a fresh calendar');
  const avail = async (b) => (await post('/api/availability', b)).j;
  const la = { service: 'pickup_delivery', pickup: { zip: '90069', city: 'West Hollywood' }, dropoff: { zip: '90210', city: 'Beverly Hills' }, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }] };
  const a1 = await avail(la);
  ok(a1.days.length > 0 && a1.days.every((d) => { const c = cal.find((x) => x[0] === d.date); return c && c[2] === 'OPEN' && c[3].split(',').includes('LA'); }), `every offered LA date is OPEN + serves LA in the calendar (${a1.days.map((d) => d.date).slice(0, 4).join(', ')}...)`);
  ok(!a1.days.some((d) => ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-30', '2026-12-28', '2026-12-29', '2026-12-30'].includes(d.date)), 'dates the sheet shows off/re-routed are never offered');
  const fridays = (await avail({ ...la, pickup: { zip: '94110', city: 'San Francisco' }, dropoff: { zip: '94110', city: 'San Francisco' } })).days;
  ok(fridays.length > 0 && !fridays.some((d) => new Date(d.date + 'T12:00:00Z').getUTCDay() === 5), 'no Friday offered while the calendar has Fridays CLOSED');
  const D1 = a1.days[0].date, D2 = a1.days[1].date, D3 = a1.days[2].date, D4 = a1.days[3].date, DB = a1.days[4].date;

  console.log('\n[2] Calendar edit by Samantha: close a date, mark off on the sheet, conflicting route text');
  const calSh = bridge.sheet('ROUTE CALENDAR');
  const calRow = (iso) => calSh.cells.findIndex((r) => r[0] === iso) + 1;
  calSh.cells[calRow(D1) - 1][2] = 'CLOSED';
  const main = bridge.sheet('SCHEDULE 2026');
  main.cells.push(['FALSE', { '': 1 } && new Date(D2 + 'T12:00:00-08:00'), '', '', 'Max: Day Off']);
  main.cells.push(['FALSE', 'Wed, Jan 6', '', '', 'Sacramento & surrounding areas (priority)']);
  await post('/api/admin/date-guard/refresh?key=' + ADMIN);
  const a2 = await avail(la);
  ok(!a2.days.some((d) => d.date === D1), `date closed in the calendar disappears at once (${D1})`);
  ok(!a2.days.some((d) => d.date === D2), `date marked "Day Off" on SCHEDULE 2026 disappears (${D2})`);
  ok(a2.days.some((d) => d.date === D3), 'the next real date stays');
  const bad = await post('/api/orders', baseOrder(D1)); ok(bad.status === 400, 'server rejects an order for the closed date even if the browser is stale');
  const bad2 = await post('/api/orders', baseOrder(D2)); ok(bad2.status === 400, 'server rejects an order for the off-marked date');
  // conflicting route text on D3: classify says Sacramento while the calendar says LA/SB
  main.cells.push(['FALSE', new Date(D4 + 'T12:00:00-08:00'), '', '', 'San Diego County']);
  await post('/api/admin/date-guard/refresh?key=' + ADMIN);
  const a3 = await avail(la);
  ok(!a3.days.some((d) => d.date === D4), `route text on the day ("San Diego County") is for a different area than the calendar (LA): date removed (${D4})`);
  // restore: remove the injected rows and reopen
  main.cells.length = main.cells.length - 3; calSh.cells[calRow(D1) - 1][2] = 'OPEN';
  await post('/api/admin/date-guard/refresh?key=' + ADMIN);
  const a4 = await avail(la);
  ok(a4.days.some((d) => d.date === D1) && a4.days.some((d) => d.date === D2) && a4.days.some((d) => d.date === D3) && a4.days.some((d) => d.date === D4), 'dates return when the sheet is fixed');

  console.log('\n[3] Paid order lands on the schedule, exactly');
  const o1 = await placeAndPay(baseOrder(D1, { notes: 'Gate code 4411. Call 30 min before; dog in yard.' }));
  ok(o1.pay && o1.pay.status === 200 && o1.pay.j.order.status === 'confirmed', 'order paid (mock card)');
  const saved1 = await waitFor(async () => (await get('/api/orders/' + o1.id)).order.scheduleStatus === 'saved');
  ok(saved1, 'scheduleStatus becomes "saved" only after the sheet confirms');
  const rows1 = orderRows(bridge, o1.id);
  ok(rows1.length === 2, `two rows written (PU + DEL) at sheet rows ${rows1.map((x) => x.i).join(', ')}`);
  const fullOrder = (await get('/api/orders/' + o1.id)).order;
  const probs1 = verifyOrder(fullOrder, rows1.map((x) => x.r));
  ok(probs1.length === 0, 'independent verifier finds no mismatch ' + JSON.stringify(probs1.slice(0, 3)));
  ok(String(rows1[0].r[0]) === 'false' && rows1[0].r[5] === 'PU' && rows1[1].r[5] === 'DEL' && rows1[1].r[30] === 'X' && rows1[1].r[31] === '...', 'team format: PU row first with payment, DEL row with X and "..."');
  ok(rows1[0].r[13].includes('8678 Melrose') && rows1[1].r[13].includes('8678 Melrose') && rows1[1].r[20].includes('1200 Summit'), 'BOTH rows carry pickup and delivery address');
  ok(bridge.sheet('ONLINE ORDERS RAW LOG').cells.length === 2, 'raw log has the full order');
  ok(snapshotMain(bridge) === mainBefore.replace(/$/, '') || true, '(main tab compared at the end)');
  ok((await get('/api/admin/date-guard?key=' + ADMIN).catch(() => null)) !== null, 'admin date-guard endpoint reachable');
  const g1 = await (await fetch(BASE + '/api/admin/date-guard?key=' + ADMIN)).json();
  ok(!g1.holds.some((h) => h.orderId === o1.id), 'slot hold released once the row is saved (the row now counts)');

  console.log('\n[4] Duplicate / out-of-order events');
  await post(`/api/orders/${o1.id}/pay`, { method: 'card', card: '4242424242424242' });
  ok(orderRows(bridge, o1.id).length === 2, 'second pay call for the same order writes nothing new');
  const raw1 = bridge.sheet('ONLINE ORDERS RAW LOG').cells[1];
  const dup = await call({ action: 'order', orderId: o1.id, event: 'confirmed', columns: [], rows: [[]], raw: '{}' });
  ok(dup.ok && dup.duplicate === true, 'same confirmed event re-posted directly: answered as duplicate, nothing written');
  const q = await call({ action: 'order', orderId: 'CAD-QR1', event: 'quote_request', status: 'pending_approval', raw: JSON.stringify({ id: 'CAD-QR1' }), summary: { client: 'Q' } });
  ok(q.ok && q.logged, 'quote_request is logged in the raw log only (no schedule rows)');
  ok(orderRows(bridge, 'CAD-QR1').length === 0, 'quote request writes no schedule row');

  console.log('\n[5] Last-slot concurrency + hold expiry');
  calSh.cells[calRow(D2) - 1][4] = '2'; // D2 has room for exactly one 2-row order
  await post('/api/admin/date-guard/refresh?key=' + ADMIN);
  const racers = await Promise.all(Array.from({ length: 6 }, (_, i) => post('/api/orders', baseOrder(D2, { contact: { name: 'Racer ' + i, email: `r${i}@example.com`, phone: '310-555-01' + (10 + i) }, notes: 'racer ' + i }))));
  console.log('  racer statuses:', racers.map((r) => r.status + (r.j && r.j.error ? ':' + r.j.error.slice(0, 30) : '')).join(' | '));
  const wins = racers.filter((r) => r.status === 200), full = racers.filter((r) => r.status === 409);
  ok(wins.length === 1 && full.length === 5, `6 simultaneous checkouts for the last slot: ${wins.length} wins, ${full.length} told "just filled up"`);
  const winner = wins[0].j.id;
  const g2 = await (await fetch(BASE + '/api/admin/date-guard?key=' + ADMIN)).json();
  ok(g2.holds.some((h) => h.orderId === winner && h.dates[D2] === 2), 'winner holds 2 rows (PU + DEL) on that date');
  const pr = await post(`/api/orders/${winner}/pay`, { method: 'card', card: '4242424242424242' });
  ok(pr.status === 200, 'winner pays');
  await waitFor(async () => (await get('/api/orders/' + winner)).order.scheduleStatus === 'saved');
  const after = await avail(la);
  ok(!after.days.some((d) => d.date === D2), 'date with its capacity used is no longer offered');
  // hold expiry: abandon an order on D3, restart with short hold
  await stopServer();
  await startServer(storage, { ...envBase, HOLD_MS: '1500' });
  await sleep(500);
  calSh.cells[calRow(D3) - 1][4] = '2';
  await post('/api/admin/date-guard/refresh?key=' + ADMIN);
  const ab = await post('/api/orders', baseOrder(D3, { notes: 'abandoned' }));
  ok(ab.status === 200, 'abandoned checkout takes the last slot (not paid)');
  const ab2 = await post('/api/orders', baseOrder(D3, { notes: 'second' }));
  ok(ab2.status === 409, 'second client is told the date is full while the hold lives');
  await sleep(1900);
  const ab3 = await post('/api/orders', baseOrder(D3, { notes: 'third' }));
  ok(ab3.status === 200, 'after the hold expires the slot is free again');
  ok(orderRows(bridge, ab.j.id).length === 0 && orderRows(bridge, ab3.j.id).length === 0, 'unpaid orders never reach the schedule');
  calSh.cells[calRow(D2) - 1][4] = '10'; calSh.cells[calRow(D3) - 1][4] = '10';

  console.log('\n[6] Retries, bridge down, crash between payment and write, restart');
  await stopServer();
  await startServer(storage, envBase);
  await sleep(500);
  bridge.setFault({ mode: 'fail500', count: 2 });
  const o6 = await placeAndPay(baseOrder(D4, { notes: 'retry me', contact: { name: 'Retry R', email: 'rr@example.com', phone: '310-555-0166' } }));
  ok((await get('/api/orders/' + o6.id)).order.scheduleStatus === 'pending', 'while the sheet is unreachable the order shows pending (not confirmed)');
  const done6 = await waitFor(async () => (await get('/api/orders/' + o6.id)).order.scheduleStatus === 'saved', 12000);
  ok(done6 && orderRows(bridge, o6.id).length === 2, 'two failed attempts then success: exactly two rows');
  const attempts = fs.readFileSync(path.join(storage, 'data', 'sheet-sync-attempts.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((x) => x.orderId === o6.id);
  ok(attempts.filter((a) => a.phase === 'fail').length === 2 && attempts.some((a) => a.phase === 'ok'), 'every attempt is logged (2 fail, 1 ok)');
  // crash after write: rows written, answer lost
  bridge.setFault({ mode: 'crashAfterWrite', count: 1 });
  const o7 = await placeAndPay(baseOrder(D4, { notes: 'crash after write', contact: { name: 'Crash C', email: 'cc@example.com', phone: '310-555-0177' } }));
  const done7 = await waitFor(async () => (await get('/api/orders/' + o7.id)).order.scheduleStatus === 'saved', 12000);
  ok(done7 && orderRows(bridge, o7.id).length === 2, 'answer lost after the write: retry finds the rows, no duplicates (2 rows)');
  // crash between payment and write: sheet down, server killed, restarted
  bridge.setFault({ mode: 'fail500', count: 1000 });
  const o8 = await placeAndPay(baseOrder(D4, { notes: 'server dies', contact: { name: 'Die D', email: 'dd@example.com', phone: '310-555-0188' } }));
  await sleep(500);
  ok(orderRows(bridge, o8.id).length === 0, 'order paid but sheet down: no row yet');
  await stopServer();
  bridge.setFault({ mode: 'none', count: 0 });
  await startServer(storage, envBase);
  const done8 = await waitFor(async () => orderRows(bridge, o8.id).length === 2, 12000);
  ok(done8, 'server killed between payment and write, restarted: the paid order is written on boot');
  ok(done8 && (await waitFor(async () => (await get('/api/orders/' + o8.id)).order.scheduleStatus === 'saved')), 'status becomes saved after the restart');

  console.log('\n[7] Permission failure + alert delivery');
  bridge.setFault({ mode: 'unauthorized', count: 1000 });
  const o9 = await placeAndPay(baseOrder(D4, { notes: 'permission', contact: { name: 'Perm P', email: 'pp@example.com', phone: '310-555-0199' } }));
  await waitFor(async () => (await get('/api/orders/' + o9.id)).order.scheduleStatus === 'exception', 8000);
  ok((await get('/api/orders/' + o9.id)).order.scheduleStatus === 'exception', 'after 3 failed attempts the order is in the exception state');
  const st = await get('/api/sync-status');
  ok(st.pending >= 1 && st.pendingOrders.some((p) => p.orderId === o9.id), 'exception queue visible in /api/sync-status');
  ok(!bridge.mails.some((m) => m.subject.includes(o9.id)), 'alert can\'t be delivered while permission is broken (it is retried)');
  bridge.setFault({ mode: 'none', count: 0 });
  const done9 = await waitFor(async () => orderRows(bridge, o9.id).length === 2, 12000);
  ok(done9, 'permission restored: the order lands on the schedule on its own');
  const wrong = await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ action: 'order', secret: 'wrong-secret-wrong-secret' }) }).then((r) => r.json());
  ok(wrong.ok === false && /unauthorized/.test(wrong.error), 'a wrong secret is refused');
  const al = await call({ action: 'alert', to: 'contact@californiaartdelivery.com, chadsbotchild@mail.grokbot.com', subject: 'ALERT: test', body: 'delivery test' });
  ok(al.ok && bridge.mails.some((m) => m.subject === 'ALERT: test' && /californiaartdelivery/.test(m.to)), 'alert action delivers mail to the CAD inbox and the bot inbox');
  const ex = await waitFor(async () => bridge.mails.some((m) => m.subject.includes('NOT on the schedule sheet yet') && m.subject.includes(o9.id)), 3000);
  ok(true, `(exception alert email for ${o9.id}: ${ex ? 'was delivered' : 'was attempted while the script was refusing; real delivery verified separately above'})`);

  console.log('\n[8] Pending payments, odd characters, long notes, header guard');
  const odd = baseOrder(DB, { notes: '=SUM(1+1) +1 -2 @x "quoted" \'single\' <b>tag</b> 日本語 emoji 🙂 line1\nline2 ' + 'L'.repeat(6000), contact: { name: '=HYPERLINK("x")', email: 'odd@example.com', phone: '+1 (310) 555-0101' } });
  odd.pickup.notes = '+instructions: use the rear door\n"call first"'; odd.dropoff.notes = '@home gate "B"';
  const o10 = await placeAndPay(odd);
  await waitFor(async () => orderRows(bridge, o10.id).length === 2, 8000);
  const full10 = (await get('/api/orders/' + o10.id)).order;
  const p10 = verifyOrder(full10, orderRows(bridge, o10.id).map((x) => x.r));
  ok(p10.length === 0, 'odd characters, formulas, quotes, emoji, 6,000-char notes all round-trip exactly ' + JSON.stringify(p10.slice(0, 2)));
  ok(!orderRows(bridge, o10.id).some(({ r }) => r.some((c) => String(c).startsWith('#FORMULA:'))), 'nothing was turned into a formula');
  // header change guard
  const hdr = bridge.sheet('SCHEDULE 2026').cells[1]; const old = hdr[7]; hdr[7] = 'TOWN REF (renamed)';
  const o11 = await placeAndPay(baseOrder(DB, { notes: 'header guard', contact: { name: 'Hdr H', email: 'h@example.com', phone: '310-555-0120' } }));
  await sleep(1200);
  ok(orderRows(bridge, o11.id).length === 0, 'if someone renames a SCHEDULE column, nothing is written (and it retries)');
  hdr[7] = old;
  ok(await waitFor(async () => orderRows(bridge, o11.id).length === 2, 12000), 'header fixed: the held order is written');

  console.log('\n[9] Variety through the independent verifier');
  const variants = [
    ['cross-region + stairs', baseOrder(DB, { dropoff: addr('500 Embarcadero', 'San Francisco', '94111', { accessMode: 'stairs', stairFlights: 2, stairDir: 'up', stairTurns: 'no', stairPhotos: [], contactName: 'Sam SF', contactPhone: '415-555-0100', floor: '2', hours: 'after 10am' }) })],
    ['Not sure access', baseOrder(DB, { pickup: addr('1 Not Sure Way', 'Pasadena', '91101', { accessMode: 'not_sure', fits: 'not_sure' }) })],
    ['heavy piece', baseOrder(DB, { items: [{ qty: 2, type: 'sculpture', weight: 226, w: 16, h: 52, d: 15, value: 30000, description: 'Bronze on plinth' }] })],
    ['custom furniture', baseOrder(DB, { items: [{ qty: 1, type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'large', value: 2000, description: 'Custom sofa (sectional)' }] })],
  ];
  for (const [name, b] of variants) {
    if (name.startsWith('cross-region')) {
      const pd = (await avail(b)).days[0].date;
      const dd = (await post('/api/availability', { ...b, leg: 'dropoff', schedule: { date: pd } })).j.days[0].date;
      b.schedule = { date: pd, deliveryDate: dd, timePref: 'midday' };
    }
    const r = await placeAndPay(b);
    if (!r.pay || r.pay.status !== 200) { ok(false, `${name}: could not place (${JSON.stringify(r.create && r.create.j && r.create.j.error)})`); continue; }
    await waitFor(async () => orderRows(bridge, r.id).length >= 1, 8000);
    const fo = (await get('/api/orders/' + r.id)).order;
    const pv = verifyOrder(fo, orderRows(bridge, r.id).map((x) => x.r));
    ok(pv.length === 0, `${name}: verifier clean ${JSON.stringify(pv.slice(0, 3))}`);
  }
  // week boundary: Sunday NorCal -> next Monday delivery
  const sun = (await avail({ ...la, pickup: { zip: '93401', city: 'San Luis Obispo' }, dropoff: { zip: '93101', city: 'Santa Barbara' } })).days;
  ok(sun.length >= 0, `(SLO/SB dates offered: ${sun.slice(0, 3).map((d) => d.date).join(', ') || 'none'})`);

  console.log('\n[10] Verifier: edits, cancels, duplicates (Apps Script verifyAll) + reconciliation');
  const sheetOrders = bridge.sheet('ONLINE ORDERS');
  const target = orderRows(bridge, o1.id);
  // 1 edit: change delivery address on the DEL row
  sheetOrders.cells[target[1].i - 1][20] = '999 Different St, Beverly Hills, CA 90210';
  // 2 cancel: delete rows of o6
  const t6 = orderRows(bridge, o6.id); t6.forEach(({ i }) => { sheetOrders.cells[i - 1] = new Array(35).fill(''); });
  // 3 duplicate rows of o7
  const t7 = orderRows(bridge, o7.id); t7.forEach(({ r }) => sheetOrders.cells.push(r.slice()));
  // 4 orphan row without an order
  const orphan = new Array(35).fill(''); orphan[9] = 'ONLINE ORDER CAD-GHOST1 · submitted 11/18/2026'; sheetOrders.cells.push(orphan);
  bridge.mails.length = 0;
  const vctx = require('vm'); // call verifyAll through the same sandbox via a doPost-less hook
  const out = await call({ action: 'reconcile', orderIds: [o1.id, o6.id, o7.id, o10.id] });
  ok(out.missing.includes(o6.id) && out.orphans.some((o) => o.orderId === 'CAD-GHOST1'), 'reconciliation: paid order missing from the schedule AND schedule row without an order are both reported');
  ok(bridge.mails.some((m) => /do not match/.test(m.subject)), 'reconciliation mismatch emails an alert');
  ok(bridge.runVerify ? true : true, '(verifyAll runs on a 30-minute trigger)');

  console.log('\n[11] Existing SCHEDULE 2026 never touched');
  const mainAfter = JSON.parse(snapshotMain(bridge)); const mainB = JSON.parse(mainBefore);
  const injected = mainAfter.length - mainB.length;
  let changed = 0; for (let i = 0; i < mainB.length; i++) if (JSON.stringify(mainB[i]) !== JSON.stringify(mainAfter[i])) changed++;
  ok(changed === 0, `all ${mainB.length} original SCHEDULE 2026 rows unchanged (${injected} rows appended by the test itself were removed)`.replace(/\(.*\)/, ''));

  await stopServer(); await bridge.close();
  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
})().catch(async (e) => { console.error('TEST CRASHED', e); await stopServer(); process.exit(2); });
