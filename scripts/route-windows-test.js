/**
 * Route-aware time windows + saved progress (CAD-TIMESLOTS-001, Nov 25 2026).
 *   node scripts/route-windows-test.js
 * Part A: the rules on fixture days (no network). Part B: real server + the UNCHANGED apps-script/Code.gs (days digest v5) in the
 * mock bridge, seeded with fixture rows (never the live sheet). Part C: the browser keeps progress in localStorage, restores it,
 * clears it after booking and never stores card data.
 */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const failures = [], passes = [];
const ok = (c, m) => { (c ? passes : failures).push(m); console.log(c ? '  ok  :' : '  FAIL:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RW = require('../lib/route-windows');
const SD = require('../lib/sheet-days');
const sched = require('../lib/scheduling');
const addr = (street, city, zip, extra = {}) => ({ street, city, zip, state: 'CA', contactName: 'Pat Contact', contactPhone: '310-555-0110', accessMode: 'ground', fits: 'yes', contactRole: 'Homeowner', ...extra });
const st = (town, win, type = 'DEL') => ({ town, win, at: '', type });
const winMap = (r) => Object.fromEntries(r.windows.map((w) => [w.v, w.ok ? 'open' : 'GRAY: ' + w.why]));
const openSet = (r) => r.windows.filter((w) => w.ok).map((w) => w.v);
const show = (name, r) => console.log(`    ${name}: ${r.fallback ? 'FALLBACK (' + r.fallback + ')' : r.routeType + ' / ' + r.shapeFrom} -> ${JSON.stringify(winMap(r))}`);

// Fixture days (dates chosen so the weekly catalog agrees: Wed Feb 10 2027 = Bay Area down-and-back from San Jose,
// Mon Feb 8 = LA heading northwest (straight-through), Tue Feb 9 = Carmel, Thu Feb 4 = Orange County down-and-back).
const DAYS = {
  '2027-02-10': { routes: ['Silicon Valley → SF → Marin → Healdsburg → San Jose'], jobRows: 3, stops: [st('San Rafael', '11AM-12PM'), st('Healdsburg', '12:30PM-1:30PM'), st('San Francisco', '3PM-4PM')] },
  '2027-02-08': { routes: ['Max drives North (LA/Central Valley stops along the way)'], jobRows: 3, stops: [st('Los Angeles', '10AM-10:30AM', 'PU'), st('Santa Barbara', '2PM-2:30PM'), st('Buellton', '6:30PM-7PM')] },
  '2027-02-09': { routes: ['Carmel'], jobRows: 2, stops: [st('Salinas', '11AM-1PM', 'PU'), st('Carmel', '12:30PM-2:30PM')] },
  '2027-02-04': { routes: ['Orange County'], jobRows: 3, stops: [st('Irvine', '8:30-9AM'), st('Newport Beach', '9:30-10AM'), st('San Clemente', '5PM-6PM')] },
  '2027-02-01': { routes: ['LA, heading southeast toward the Irvine hub'], jobRows: 5, stops: [st('Fresno', '9AM-10AM'), st('Fresno', '10:30AM-12PM'), st('Bakersfield', '12PM-1:30PM'), st('Bakersfield', '2PM-4PM'), st('Bakersfield', '4:30PM-5:30PM'), st('Bakersfield', '6PM-7PM')] },
  '2027-02-24': { routes: ['Silicon Valley → SF → Marin → Healdsburg → San Jose'], jobRows: 0, stops: [] },
  '2027-02-23': { routes: ['Carmel'], jobRows: 1, stops: [st('Carmel', 'All day')] },
};

function partA() {
  console.log('\n[A] Rules on fixture days (route rules judged with the Morning gate unlocked; the gate itself is tested in [A2])');
  const CFG = require('../config'); CFG.scheduling.morningUnlockStops = 0;
  SD._setForTests(JSON.parse(JSON.stringify(DAYS)));
  const paloAlto = addr('1 University Ave', 'Palo Alto', '94301');
  // 1. Down-and-back: van leaves San Jose, goes north to Marin / Healdsburg at midday, comes back through SF.
  const db = RW.evaluate(paloAlto, '2027-02-10'); show('down-and-back, Palo Alto', db);
  ok(db.routeType === 'downAndBack', 'Feb 10 is read as a down-and-back day (hub San Jose)');
  ok(winMap(db).morning === 'open', 'down-and-back: Morning (on the way out) stays open near the hub');
  ok(/farther north/.test(winMap(db).midday) && /farther north/.test(winMap(db).early_afternoon), 'down-and-back: Midday / Early afternoon gray with "Our van is farther north at this time"');
  ok(winMap(db).late_afternoon === 'open' || winMap(db).early_evening === 'open', 'down-and-back: a late window (on the way back) is open again');
  // 2. Straight-through: LA in the morning, Santa Barbara at 2, Buellton at 6:30; the van keeps driving away.
  const smo = addr('100 Wilshire Blvd', 'Santa Monica', '90401');
  const th = RW.evaluate(smo, '2027-02-08'); show('straight-through, Santa Monica', th);
  ok(th.routeType === 'through', 'Feb 8 is read as a straight-through day');
  ok(winMap(th).morning === 'open', 'straight-through: Morning is open where the van passes early');
  ok(['afternoon', 'late_afternoon', 'early_evening', 'evening', 'late_evening'].every((v) => winMap(th)[v] !== 'open'), 'straight-through: every window after the van has left the area is grayed');
  ok(/moved on/.test(winMap(th).evening) && /moved on/.test(winMap(th).afternoon), 'straight-through: the reason says "Our van has moved on from your area by then"');
  const sb = RW.evaluate(addr('1 State St', 'Santa Barbara', '93101'), '2027-02-08'); show('straight-through, Santa Barbara', sb);
  ok(winMap(sb).early_afternoon === 'open' && winMap(sb).morning !== 'open', 'straight-through: Santa Barbara fits when the van gets there (early afternoon), not in the morning when it is still in LA');
  // 3. Nearby add-on: Pebble Beach is minutes from the Carmel stop, so it fits around that stop's time; a far address does not.
  const pb = RW.evaluate(addr('1700 17 Mile Dr', 'Pebble Beach', '93953'), '2027-02-09'); show('nearby add-on, Pebble Beach', pb);
  ok(winMap(pb).midday === 'open' && winMap(pb).early_afternoon === 'open', 'nearby add-on: windows around the Carmel stop (midday, early afternoon) are open');
  const gilroy = RW.evaluate(addr('1 Monterey Rd', 'Big Sur', '93920'), '2027-02-09'); show('farther add-on, Big Sur', gilroy);
  ok(openSet(gilroy).length < openSet(pb).length, 'a stop farther from the route gets fewer open windows than the nearby one');
  // 4. No route data: nothing grayed, reason recorded.
  const nd = RW.evaluate(paloAlto, '2027-02-24'); show('no-data day', nd);
  ok(nd.fallback && openSet(nd).length === 9, 'no-data day (no timed stops): all 9 windows open, fallback reason recorded');
  const ad = RW.evaluate(addr('1 Ocean Ave', 'Carmel', '93921'), '2027-02-23'); show('"All day" only', ad);
  ok(ad.fallback && openSet(ad).length === 9, 'a day whose only stop says "All day" is ambiguous: all windows open');
  ok(RW.evaluate(paloAlto, '2027-05-05').fallback && openSet(RW.evaluate(paloAlto, '2027-05-05')).length === 9, 'a date with no schedule rows at all: all windows open');
  SD._setForTests({ '2027-02-10': { routes: ['x'], jobRows: 2 } });
  ok(/no stop list/.test(RW.evaluate(paloAlto, '2027-02-10').fallback || ''), 'old digest without a stop list (today\'s live v4 bridge): all windows open');
  SD._setForTests(JSON.parse(JSON.stringify(DAYS)), { fetchedAt: Date.now() - 3 * 3600 * 1000 });
  ok(/no fresh schedule/.test(RW.evaluate(paloAlto, '2027-02-10').fallback || ''), 'stale schedule data (3 h old): all windows open');
  SD._setForTests(JSON.parse(JSON.stringify(DAYS)));
  ok(RW.evaluate(addr('1 X St', 'Nowhereville', ''), '2027-02-10').fallback, 'an address we cannot place: all windows open');
  ok(openSet(RW.evaluate(paloAlto, '2027-02-10', { order: { rush: true } })).length === 9 && openSet(RW.evaluate(paloAlto, '2027-02-10', { order: { dedicated: true } })).length === 9, 'rush and dedicated trips are never narrowed');
  // 5. Firm 10-hour day: Irvine 8:30 ... San Clemente 5 PM; a late-evening stop would stretch the day past 10 hours.
  const ten = RW.evaluate(addr('1 Irvine Center Dr', 'Irvine', '92618'), '2027-02-04'); show('10-hour day, Irvine', ten);
  ok(/route hours/.test(winMap(ten).late_evening), '10-hour rule: Late evening grays with "Outside our route hours that day"');
  // 6. Keep one window open or drop the date.
  const full = RW.evaluate(addr('100 Wilshire Blvd', 'Santa Monica', '90401'), '2027-02-01'); show('nothing fits, Santa Monica', full);
  ok(full.noFit === true, 'a day where no window fits is flagged noFit');
  // Route dates come only from the sheet: Feb 8 here is a plain Los Angeles day (the "along the way" text above is not a regular LA day).
  { const d2 = JSON.parse(JSON.stringify(DAYS)); d2['2027-02-08'].routes = ['Los Angeles']; SD._setForTests(d2); }
  const offered = sched.availableDays(addr('100 Wilshire Blvd', 'Santa Monica', '90401'), { from: new Date('2027-01-25T12:00:00Z'), count: 6, leadTime: 0 }).map((d) => d.date);
  SD._setForTests(JSON.parse(JSON.stringify(DAYS)));
  ok(!offered.includes('2027-02-01') && offered.includes('2027-02-08'), `that date is not offered at all (offered: ${offered.join(', ')})`);
  ok(Object.keys(DAYS).every((iso) => { const r = RW.evaluate(paloAlto, iso); return r.noFit || openSet(r).length >= 1; }), 'every date that is offered keeps at least one window open');
  // 7. Pickup + delivery as one booking (same day): pickup first, with drive time.
  const pu = addr('1 Market St', 'San Francisco', '94105'), de = addr('1 Ralston Ave', 'Belmont', '94002');
  SD._setForTests({ '2027-02-10': { routes: ['Silicon Valley → SF → Marin → Healdsburg → San Jose'], jobRows: 1, stops: [st('San Rafael', '11AM-12PM')] } });
  const p1 = RW.pair(pu, de, '2027-02-10', '2027-02-10', {}); show('same day pickup SF', p1.pickup); show('same day delivery Belmont', p1.delivery);
  ok(winMap(p1.pickup).late_evening !== 'open', 'same day: the last pickup window grays (no delivery window left after it)');
  const p1b = RW.pair(pu, de, '2027-02-10', '2027-02-10', { puPref: ['midday'] });
  ok(/Pickup comes first/.test(winMap(p1b.delivery).morning) && winMap(p1b.delivery).late_morning !== 'open' && winMap(p1b.delivery).early_afternoon === 'open', 'same day: with a Midday pickup, Morning delivery grays with "Pickup comes first, so this is too early for delivery"');
  const p2 = RW.pair(pu, de, '2027-02-10', '2027-02-10', { puPref: ['early_afternoon'] });
  ok(winMap(p2.delivery).midday !== 'open' && winMap(p2.delivery).late_afternoon === 'open', 'same day: picking an Early afternoon pickup narrows delivery to later windows');
  const p3 = RW.pair(pu, de, '2027-02-10', '2027-02-11', {});
  ok(!p3.sameDay && openSet(p3.delivery).length === 9, 'different days: each date is judged on its own');
  // 8. Server-side re-check (submit / pay).
  const SV = { pickup_delivery: { needsPickup: true, needsDropoff: true } };
  ok(RW.selectionErrors({ service: 'pickup_delivery', pickup: pu, dropoff: de, schedule: { date: '2027-02-10', deliveryDate: '2027-02-10', timePref: 'early_afternoon', deliveryTimePref: 'morning' } }, SV)[0] || ''.length, 'submit check: a delivery time before the pickup is refused');
  ok(/^TIME: .*Nothing has been charged/.test(RW.selectionErrors({ service: 'pickup_delivery', pickup: pu, dropoff: de, schedule: { date: '2027-02-10', deliveryDate: '2027-02-10', timePref: 'early_afternoon', deliveryTimePref: 'morning' } }, SV)[0] || ''), 'submit check message says nothing was charged and asks for another time');
  ok(RW.selectionErrors({ service: 'pickup_delivery', pickup: pu, dropoff: de, schedule: { date: '2027-02-10', deliveryDate: '2027-02-10', timePref: 'morning', deliveryTimePref: 'late_afternoon' } }, SV).length === 0, 'submit check: pickup Morning + delivery Late afternoon is accepted');
  ok(RW.selectionErrors({ service: 'pickup_delivery', pickup: pu, dropoff: de, schedule: { date: '2027-02-10', deliveryDate: '2027-02-10', timePref: 'none', deliveryTimePref: 'none' } }, SV).length === 0, 'submit check: No preference is always accepted on an offered date');
  // 9. Customer wording: short, no staff names, no phone / call prompts, no internal words.
  const words = Object.values(RW.REASONS).join(' | ');
  ok(!/\b(max|alex|kaila|sam|samantha|maezie|alyssa|chad|brandon|call|phone|review|confirm|confirmed|pending|sheet|schedule|driver|tbd)\b|\d{3}-\d{3}/i.test(words), `reasons are customer-safe: ${words}`);
  // 10. Window parsing from the live sheet formats.
  ok(JSON.stringify([RW.parseWindow('11AM-1PM'), RW.parseWindow('8:30-9AM'), RW.parseWindow('1:30PM-3PM'), RW.parseWindow('12:30pm-1pm'), RW.parseWindow('All day'), RW.parseWindow('', '10:45 AM')]) === JSON.stringify([[11, 13], [8.5, 9], [13.5, 15], [12.5, 13], null, [10.75, 11.25]]), 'sheet window formats parse (11AM-1PM, 8:30-9AM, 1:30PM-3PM, 12:30pm-1pm, All day, 10:45 AM)');
}

// ---------- B: real server + Code.gs v5 digest in the mock bridge ----------
const { startBridge } = require('./mock-bridge');
const PORT = 3990 + Math.floor(Math.random() * 9); const BASE = `http://127.0.0.1:${PORT}`;
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
async function partB() {
  console.log('\n[B] Real server + apps-script/Code.gs days digest v5 (mock bridge, fixture rows)');
  const hdr = JSON.parse(fs.readFileSync('/workspace/fixtures/schedule-2026.json', 'utf8')).slice(0, 2);
  const row = (iso, route, type, town, win, assign = '') => { const r = Array(36).fill(''); r[0] = false; r[1] = { $date: iso }; r[4] = route; r[5] = type; r[6] = assign; r[7] = town; r[10] = win; return r; };
  const seed = [...hdr,
    row('2027-02-10', 'Silicon Valley → SF → Marin → Healdsburg → San Jose', 'DEL', 'San Rafael', '11AM-12PM'),
    row('2027-02-10', 'Silicon Valley → SF → Marin → Healdsburg → San Jose', 'DEL + INST', 'Healdsburg', '12:30PM-1:30PM'),
    row('2027-02-10', 'Silicon Valley → SF → Marin → Healdsburg → San Jose', 'PU', 'San Francisco', '3PM-4PM'),
    row('2027-02-10', 'Silicon Valley → SF → Marin → Healdsburg → San Jose', 'PU', 'Fresno', '9AM-10AM', 'PENDINGJOB'), // pending: not a stop
    row('2027-02-24', 'Silicon Valley → SF → Marin → Healdsburg → San Jose', '', '', ''),
  ];
  const bridge = await startBridge({ seed });
  const dg = JSON.parse((await (await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ action: 'days', secret: bridge.secret }) })).text()));
  const d10 = dg.days && dg.days['2027-02-10'];
  ok(dg.digest >= 5 && d10 && Array.isArray(d10.stops) && d10.stops.length === 3, `Code.gs digest v5+ lists each date's stops (Feb 10: ${d10 && d10.stops.map((s) => s.town + ' ' + s.win).join('; ')})`);
  ok(d10 && !d10.stops.some((s) => s.town === 'Fresno'), 'a PENDINGJOB row is not counted as a planned stop');
  { const before = JSON.stringify(bridge.sheet('SCHEDULE 2026').cells); await (await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ action: 'days', secret: bridge.secret }) })).text(); ok(JSON.stringify(bridge.sheet('SCHEDULE 2026').cells) === before, 'the days digest is read-only (sheet unchanged after reading it)'); }
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-tw-'));
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', ADMIN_KEY: 'test-admin-key-1234567', BASE_URL: BASE, NODE_ENV: 'test', SKIP_GEOCODE: '1', SHEETS_WEBHOOK_URL: bridge.url, SHEETS_WEBHOOK_SECRET: bridge.secret, SHEETS_PUMP_MS: '250', HOLD_MS: '60000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
    await sleep(900);
    const pa = addr('1 University Ave', 'Palo Alto', '94301'), sf = addr('1 Market St', 'San Francisco', '94105');
    const o = { service: 'pickup_delivery', pickup: pa, dropoff: sf, items: [{ type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 5000, description: 'Oil on canvas' }], contact: { name: 'Test Client', email: 'client@example.com', phone: '650-555-0100' }, payer: 'me' };
    const tw = (await post('/api/time-windows', { ...o, schedule: { date: '2027-02-10', deliveryDate: '2027-02-24' } })).j || {};
    const m = Object.fromEntries(((tw.pickup || {}).windows || []).map((w) => [w.v, w.ok ? 'open' : w.why]));
    console.log('    /api/time-windows pickup Feb 10:', JSON.stringify(m));
    ok(tw.pickup && tw.pickup.basis === 'route' && m.late_afternoon === 'open' && /farther north/.test(m.midday || ''), 'server: Feb 10 pickup in Palo Alto: Late afternoon open (on the way back), Midday grayed "Our van is farther north at this time"');
    ok(!('morning' in m), 'server: Feb 10 has fewer than 5 stops, so Morning is not offered');
    ok(tw.delivery && tw.delivery.basis === 'open' && tw.delivery.windows.every((w) => w.ok) && !tw.delivery.windows.some((w) => w.v === 'morning'), 'server: Feb 24 (no timed stops) delivery windows all open except Morning (not offered on a quiet day)');
    ok(!JSON.stringify(tw).match(/fallback|digest|Apps Script|anchor/i), 'server answer carries no internal wording');
    const bad = await post('/api/orders', { ...o, schedule: { date: '2027-02-10', deliveryDate: '2027-02-24', timePref: 'midday', deliveryTimePref: 'none' } });
    ok(bad.status === 409 && bad.j && bad.j.timeConflict && /no longer fits/.test(bad.j.error) && /Nothing has been charged/.test(bad.j.error), `submit with a grayed time is refused before any charge (${bad.status}: ${bad.j && bad.j.error})`);
    const mor = await post('/api/orders', { ...o, schedule: { date: '2027-02-10', deliveryDate: '2027-02-24', timePref: 'morning', deliveryTimePref: 'none' } });
    ok(mor.status === 409 && mor.j && mor.j.timeConflict, `submit with Morning on a quiet day is refused at the server (${mor.status})`);
    const good = await post('/api/orders', { ...o, schedule: { date: '2027-02-10', deliveryDate: '2027-02-24', timePref: 'late_afternoon', deliveryTimePref: 'none' } });
    ok(good.status === 200 && good.j && good.j.id, `submit with an open time is accepted (${good.status}${good.j && good.j.error ? ': ' + good.j.error : ''})`);
  } finally { child.kill('SIGKILL'); await bridge.close(); }
}

// ---------- C: saved progress in the browser ----------
// ---------- A2: Morning gate (Chad, Nov 25 2026): Morning only on days that already have >= 5 stops ----------
function partA2() {
  console.log('\n[A2] Morning window gate (morningUnlockStops)');
  const CFG = require('../config'); CFG.scheduling.morningUnlockStops = 5;
  const pa = addr('1 University Ave', 'Palo Alto', '94301');
  const busy = { routes: ['Silicon Valley → SF → Marin → Healdsburg → San Jose'], jobRows: 5, stops: [st('San Jose', '9AM-10AM'), st('San Rafael', '11AM-12PM'), st('Healdsburg', '12:30PM-1:30PM'), st('San Francisco', '3PM-4PM'), st('Palo Alto', '5PM-6PM')] };
  const fourStops = { ...busy, jobRows: 4, stops: busy.stops.slice(0, 4) };
  const fourPlusOnline = { ...fourStops, jobRows: 5, bookedSinceRefresh: 1 }; // 4 sheet stops + 1 online order booked since the last refresh (sheet-days.bump)
  const fourPlusPending = { ...fourStops, jobRows: 6 }; // 4 stops + 2 PENDING JOB rows (count toward capacity, not toward Morning)
  SD._setForTests({ '2027-03-03': busy, '2027-03-10': fourStops, '2027-03-17': fourPlusOnline, '2027-03-31': fourPlusPending, '2027-03-24': { routes: ['Carmel'], jobRows: 0, stops: [] } });
  const hidden = (r) => { const w = r.windows.find((x) => x.v === 'morning'); return w && w.hidden && !w.ok; };
  const r5 = RW.evaluate(pa, '2027-03-03'), r4 = RW.evaluate(pa, '2027-03-10'), r4o = RW.evaluate(pa, '2027-03-17'), r0 = RW.evaluate(pa, '2027-03-24');
  ok(!hidden(r5) && (RW.publicView(r5).windows.some((w) => w.v === 'morning')), 'day with 5 stops: Morning is offered');
  ok(hidden(r4) && !RW.publicView(r4).windows.some((w) => w.v === 'morning'), 'day with 4 stops: Morning is not offered at all (left out of the list, not grayed)');
  ok(RW.publicView(r4).windows[0].v === 'late_morning', 'day with 4 stops: earliest window offered is Late morning');
  ok(!hidden(r4o), '4 schedule stops + 1 booked online order = 5: Morning is offered');
  ok(hidden(RW.evaluate(pa, '2027-03-31')), '4 stops + 2 pending (unconfirmed) jobs: Morning still hidden (pending jobs are not stops)');
  ok(hidden(r0) && r0.fallback && openSet(r0).length === 8, 'no-data day: route windows stay open but Morning is hidden (8 windows)');
  SD._setForTests({ '2027-03-03': busy }, { fetchedAt: Date.now() - 3 * 3600 * 1000 });
  ok(hidden(RW.evaluate(pa, '2027-03-03')), 'stale data: Morning hidden even on a busy day (safe default)');
  SD._setForTests({});
  ok(hidden(RW.evaluate(pa, '2027-05-05')), 'date with no schedule rows: Morning hidden');
  ok(hidden(RW.evaluate(pa, '2027-05-05', { order: { dedicated: true } })), 'dedicated / rush trips: Morning also hidden on a quiet day');
  SD._setForTests({ '2027-03-03': busy, '2027-03-10': fourStops });
  const SVCS = require('../lib/pricing').SERVICES;
  const o = (date, del, tp, dtp, extra = {}) => ({ service: 'pickup_delivery', pickup: pa, dropoff: addr('1 Market St', 'San Francisco', '94105'), schedule: { date, deliveryDate: del, timePref: tp, deliveryTimePref: dtp }, ...extra });
  ok(RW.selectionErrors(o('2027-03-10', '2027-03-03', 'morning', 'none'), SVCS).length === 1, 'submit check: Morning pickup on a 4-stop day is refused (no charge)');
  ok(RW.selectionErrors(o('2027-03-03', '2027-03-10', 'none', 'morning'), SVCS).length === 1, 'submit check: Morning delivery on a 4-stop day is refused');
  const firstOpen = RW.publicView(RW.pair(o('2027-03-10').pickup, o('2027-03-10').dropoff, '2027-03-10', '2027-03-03', {}).pickup).windows.find((w) => w.ok).v;
  ok(firstOpen !== 'morning' && RW.selectionErrors(o('2027-03-10', '2027-03-03', firstOpen, 'none'), SVCS).length === 0, `submit check: an open later window on the same day is accepted (${firstOpen})`);
  ok(RW.selectionErrors(o('2027-03-10', '2027-03-10', 'morning', 'none', { dedicated: true }), SVCS).length === 1, 'submit check: Morning refused for a dedicated trip on a quiet day too');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok(/const twHidden = /.test(src) && /TIME_PREF_OPTS\.filter\(\(\[v\]\) => !twHidden\(prefPath, v\)\)/.test(src), 'browser: the Morning chip is left out of both pickup and delivery choices unless the server lists it');
}

async function partC() {
  console.log('\n[C] Saved progress (localStorage) in a real browser');
  let chromium; try { ({ chromium } = require('playwright')); } catch { ok(false, 'playwright not installed'); return; }
  const P2 = PORT + 20, B2 = `http://127.0.0.1:${P2}`;
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-tw-ui-'));
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: P2, STORAGE_DIR: storage, TEST_MODE: '1', BASE_URL: B2, NODE_ENV: 'test', SKIP_GEOCODE: '1', SHEETS_WEBHOOK_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(B2 + '/api/config'); break; } catch { await sleep(250); } }
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(B2 + '/'); await page.waitForTimeout(600);
    const before = await page.evaluate(() => Object.keys(localStorage));
    await page.locator('.svc, [data-service], button').first().click().catch(() => {});
    await page.waitForTimeout(300);
    const saved1 = await page.evaluate(() => ({ order: localStorage.getItem('cad-order'), at: localStorage.getItem('cad-saved-at'), sess: sessionStorage.getItem('cad-order') }));
    ok(!!saved1.order && !!saved1.at && !saved1.sess, `progress is saved in localStorage (not per-tab sessionStorage); keys before click: ${before.join(',') || 'none'}`);
    // Put a recognizable long order in, as if typed, then close the tab and come back in a new tab.
    await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('cad-order')); o.items = Array.from({ length: 15 }, (_, i) => ({ ...(o.items[0] || {}), id: 'pcT' + i, description: 'Painting ' + (i + 1) })); o.contact = { ...(o.contact || {}), name: 'Restore Tester' }; o.card = '4242 4242 4242 4242'; o.cvc = '123'; localStorage.setItem('cad-order', JSON.stringify(o)); });
    await page.close();
    const page2 = await ctx.newPage();
    await page2.goto(B2 + '/'); await page2.waitForTimeout(800);
    const restored = await page2.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
    ok(restored && restored.items.length === 15 && restored.items[14].description === 'Painting 15' && restored.contact.name === 'Restore Tester', 'a 15-piece draft comes back in a new tab after the old one was closed');
    const banner = await page2.evaluate(() => document.body.innerText);
    ok(!/restored|welcome back|saved draft/i.test(banner), 'restored quietly (no pop-up or banner)');
    await page2.evaluate(() => { document.querySelector('button') && document.querySelector('button').click(); });
    await page2.waitForTimeout(300);
    const afterSave = await page2.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
    ok(afterSave && !('card' in afterSave) && !('cvc' in afterSave), 'card fields are never stored in the draft (stripped on load and on save)');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    ok(/name === 'Done' && confirmed\) \{ draftStore\.clear\(\)/.test(src), 'the draft is cleared when the booking is done (confirmation screen)');
    ok(!/draftStore\.setItem\([^)]*#card/.test(src) && /NEVER_SAVE = \['card'/.test(src), 'payment inputs are read from the payment screen only, never saved');
    // Expiry: an old draft is dropped.
    await page2.evaluate(() => localStorage.setItem('cad-saved-at', String(Date.now() - 20 * 864e5)));
    const page3 = await ctx.newPage(); await page3.goto(B2 + '/'); await page3.waitForTimeout(600);
    const old = await page3.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
    ok(!old || !(old.contact && old.contact.name === 'Restore Tester'), 'a draft older than 14 days is dropped');
  } finally { if (browser) await browser.close(); child.kill('SIGKILL'); }
}

(async () => {
  partA();
  partA2();
  await partB();
  if (!process.env.SKIP_UI) await partC();
  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
