/**
 * Route regions (Chad t2094u, Dot CAD-ROUTE-REGIONS-001 CHANGES REQUIRED, Chad t2096u Thursday rule).
 *  - Dates come only from the live CAD SCHEDULE (here: a digest of the live SCHEDULE 2026 rows read Nov 25 2026,
 *    scripts/fixtures/sheet-days-live-2026-11-25.json). Stale, missing or disagreeing data hides dates.
 *  - "late & if quick" is never offered; San Jose as a bookend only with San Jose stops that day; OR branches only once chosen.
 *  - Thursday: East Bay cities on the drive up are offered, capped at config.scheduling.enRoute.maxStopsPerDay, midday windows only.
 *  - Same checks for display, pairing and checkout, main flow and Paloma's (server part at the end).
 *   node scripts/route-regions-test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
process.env.STORAGE_DIR = process.env.STORAGE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cad-rr-'));
delete process.env.SHEET_DAYS_FIXTURE;
const P = require('../lib/route-patterns');
const sched = require('../lib/scheduling');
const SD = require('../lib/sheet-days');
const holds = require('../lib/holds');
const RW = require('../lib/route-windows');
const config = require('../config');
const zones = require('../public/zones');

const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-days-live-2026-11-25.json'), 'utf8')).days;
const clone = (x) => JSON.parse(JSON.stringify(x));
const useSheet = (days, meta) => { SD._setForTests(days, meta); holds._reset(); };
const live = () => useSheet(clone(LIVE));

const from = new Date('2026-11-25T20:00:00Z');
const days = (addr, n = 12) => sched.availableDays(addr, { from, count: n });
const iso = (ds) => ds.map((d) => d.date);
const has = (addr, d) => days(addr, 40).some((x) => x.date === d);
const first = (addr) => (days(addr)[0] || {});

const A = (city, zip, street = '1 Main St') => ({ city, state: 'CA', zip, street });
const menlo = A('Menlo Park', '94025', '1 Santa Cruz Ave');
const palo = A('Palo Alto', '94301', '1 University Ave');
const sf = A('San Francisco', '94103', '2 Henry Adams St');
const oak = A('Oakland', '94607', '1 Broadway');
const berk = A('Berkeley', '94704', '1 Shattuck Ave');
const fremont = A('Fremont', '94538', '1 Mission Blvd');
const walnut = A('Walnut Creek', '94596', '1 Main St');
const livermore = A('Livermore', '94550', '1 First St');
const napa = A('Napa', '94559', '1 First St');
const heald = A('Healdsburg', '95448', '1 Healdsburg Ave');
const sj = A('San Jose', '95113', '1 S 1st St');
const sc = A('Santa Cruz', '95060', '1 Pacific Ave');
const aptos = A('Aptos', '95003', '1 Soquel Dr');
const capitola = A('Capitola', '95010', '1 Capitola Ave');
const carmel = A('Carmel-by-the-Sea', '93921', '1 Ocean Ave');
const la = A('Los Angeles', '90069', '8678 Melrose Ave');
const sb = A('Santa Barbara', '93101', '1 State St');
const pismo = A('Pismo Beach', '93449', '1 Price St');
const fresno = A('Fresno', '93721', '1 Van Ness Ave');
const sac = A('Sacramento', '95814', '1 Capitol Mall');
const truckee = A('Truckee', '96161', '1 Donner Pass Rd');
const southBay = [['Cupertino', '95014'], ['Santa Clara', '95050'], ['Campbell', '95008'], ['Milpitas', '95035'], ['Los Gatos', '95030'], ['Saratoga', '95070']].map(([c, z]) => A(c, z));

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

const WED = 'Silicon Valley, SF, Marin & Healdsburg', FRI = 'East Bay & Napa', THU = 'East Bay (morning) & Sacramento area';

console.log('[parse]');
const wed = P.parseRouteText('Silicon Valley → SF → Marin → Healdsburg → San Jose');
ok(wed.label === WED, 'Wednesday label names Healdsburg (not folded into Marin)', wed.label);
ok(P.roleFor(wed, 'BayWest', menlo) === 'primary', 'Menlo is primary on Wednesday');
ok(P.roleFor(wed, 'EastBay', oak) == null, 'Oakland is not on Wednesday');
const fri = P.parseRouteText('San Jose → East Bay → Napa → SF/Silicon Valley (late & if quick) → San Jose');
ok(fri.label === FRI, 'Friday label', fri.label);
ok(P.roleFor(fri, 'BayWest', menlo) === 'conditional', 'Menlo is only late / if-quick on Friday');
ok(P.roleFor(fri, 'BayWest', sj) === 'hub', 'San Jose is only a bookend on Friday (hub, not a stop)');
ok(P.roleFor(fri, 'EastBay', oak) === 'primary' && P.roleFor(fri, 'NapaWine', napa) === 'primary', 'Oakland and Napa are Friday stops');
const thu = P.parseRouteText('Sacramento & surrounding areas (priority) — East Bay only if quick / en route');
ok(thu.label === THU, 'Thursday label (Chad t2096u)', thu.label);
ok(P.roleFor(thu, 'Sacramento', sac) === 'primary', 'Sacramento is the Thursday focus');
ok(P.roleFor(thu, 'EastBay', oak) === 'enroute', 'East Bay is en route on Thursday');
ok(P.roleFor(thu, 'Tahoe', truckee) == null, 'Tahoe is not inferred from "Sacramento & surrounding areas"');
ok(P.roleFor(P.parseRouteText('LA, heading northwest (SB late or Fresno very late)'), 'SB', sb) === 'conditional', 'SB is late on the NorCal Monday');
const sun = P.parseRouteText('Central California: SLO/Pismo Beach → Santa Barbara OR Fresno → Santa Barbara');
ok(sun.orBranches && sun.branchParses.length === 2, 'Sunday has two OR branches');
ok(sun.branchParses[0].label === 'Central Coast & Santa Barbara' && sun.branchParses[1].label === 'Fresno & Santa Barbara', 'branch labels', sun.branchParses.map((b) => b.label));
const sat19 = P.parseRouteText('Carmel → stay the night in Central California or Santa Barbara → Central California');
ok(sat19.primaryZones.join() === 'Carmel', 'after "stay the night" the rest is the next day, not this date', sat19.primaryZones);
ok(P.parseRouteText('Carmel → Santa Cruz → Salinas').primaryZones.includes('SantaCruz'), 'a route that names Santa Cruz opens Santa Cruz');
ok(P.parseRouteText('LA, heading southeast toward the Irvine hub').label === 'Los Angeles', 'Irvine hub is not an OC day');

console.log('[zones]');
ok(sched.zoneFor(sc) === 'SantaCruz' && sched.zoneFor(aptos) === 'SantaCruz' && sched.zoneFor(capitola) === 'SantaCruz', 'Santa Cruz, Aptos and Capitola are their own area (not BayWest)');
ok(southBay.every((a) => sched.zoneFor(a) === 'BayWest'), 'South Bay cities stay on the Silicon Valley side');
const mm = zones.routeConflict(A('Oakland', '94025'), 'pickup');
ok(mm && mm.message === 'This city and ZIP don’t match. Check the pickup address.', 'mismatch copy is plain (pickup)', mm && mm.message);
ok(zones.routeConflict(A('Oakland', '94025'), 'delivery').message === 'This city and ZIP don’t match. Check the delivery address.', 'mismatch copy is plain (delivery)');
ok(!/SF Bay Area/.test(JSON.stringify(zones.routeConflict(A('Menlo Park', '94607')))), 'mismatch copy never says SF Bay Area');
ok(zones.routeConflict(A('Emeryville', '94608')) == null && zones.routeConflict(A('Carmel', '93923')) == null, 'valid postal aliases still pass');

console.log('[offer: live CAD SCHEDULE]');
live();
const m = days(menlo);
ok(m[0] && m[0].date === '2026-12-02', 'Menlo Park first day is Wed Dec 2', iso(m));
ok(!has(menlo, '2026-12-04') && !has(menlo, '2026-12-18'), 'Menlo Park is never offered the Friday East Bay loop', iso(m));
ok(m.every((d) => d.shortLabel === WED), 'Menlo days carry the Wednesday label', m.map((d) => d.shortLabel));
ok(first(palo).date === '2026-12-02' && first(sf).date === '2026-12-02' && first(heald).date === '2026-12-02', 'Palo Alto, SF and Healdsburg: Wed Dec 2');
ok(!has(sf, '2026-12-18'), 'SF is not offered Fri Dec 18 even though the sheet has an SF job that day');
ok(!has(heald, '2026-12-04'), 'Healdsburg is not offered Friday');
for (const a of southBay) ok(has(a, '2026-12-02') && !has(a, '2026-12-04') && days(a, 40).find((d) => d.date === '2026-12-02').shortLabel === WED, `${a.city}: Wednesday (regular), not Friday`, iso(days(a)));
const o = days(oak);
ok(has(oak, '2026-12-04') && o.find((d) => d.date === '2026-12-04').shortLabel === FRI, 'Oakland: Fri Dec 4, East Bay & Napa', o);
ok(first(napa).date === '2026-12-04' && first(napa).shortLabel === FRI, 'Napa: Fri Dec 4');
ok(!has(sj, '2026-12-04') && has(sj, '2026-12-02'), 'San Jose: Wed Dec 2 only (Friday has no San Jose stops on the sheet)', iso(days(sj)));
{ const s2 = clone(LIVE); s2['2026-12-04'].stops.push({ town: 'San Jose', type: 'DEL', win: '9AM-10AM', at: '' }); useSheet(s2);
  const d4 = days(sj, 40).find((d) => d.date === '2026-12-04');
  ok(d4 && d4.shortLabel === FRI, 'San Jose gets Fri Dec 4 once the sheet has a San Jose stop that day, labeled East Bay & Napa', d4); live(); }
ok([sc, aptos, capitola].every((a) => !has(a, '2026-12-02') && !has(a, '2026-12-16')), 'Santa Cruz / Aptos / Capitola are off Wednesday');
ok([sc, aptos, capitola].every((a) => days(a, 40).every((d) => d.enRoute)), 'Santa Cruz / Aptos / Capitola only get en-route dates (no regular day on the sheet)', iso(days(sc, 40)));
ok(!has(sc, '2026-12-15'), 'Santa Cruz is not on the Tuesday Carmel run unless the sheet names it');
{ const s2 = clone(LIVE); s2['2026-12-15'].routes = ['Carmel → Santa Cruz → Salinas']; useSheet(s2);
  const d15 = days(sc, 40).find((d) => d.date === '2026-12-15');
  ok(d15 && !d15.enRoute, 'Santa Cruz opens as a regular stop on a Monterey Bay day when the sheet names it', d15); live(); }
ok(!days(truckee, 40).length, 'Tahoe gets nothing from the Sacramento day (no confirmed route date at all)');
ok(first(carmel).date === '2026-12-01' && first(carmel).shortLabel === 'Monterey Bay & Salinas', 'Carmel: Tue Dec 1, Monterey Bay & Salinas');
ok(first(la).date === '2026-12-07' && days(la).every((d) => d.shortLabel === 'Los Angeles'), 'LA: Mon Dec 7, Los Angeles');
ok(!has(la, '2026-12-06'), 'Sunday Dec 6 does not offer LA');
ok(!iso(days(sb, 40)).some((d) => ['2026-12-06', '2026-12-14'].includes(d)), 'Santa Barbara: not Sun Dec 6 (branch not chosen) and not the late Monday add-on', iso(days(sb, 40)));
ok(!has(pismo, '2026-12-06') && !has(fresno, '2026-12-06'), 'SLO/Pismo and Fresno are not offered Sun Dec 6 before the branch is chosen');
ok(!has(fresno, '2026-12-19') && !has(pismo, '2026-12-19'), 'Sat Dec 19 overnight text does not open Central for that date');
ok(!iso(days(menlo, 40)).some((d) => d >= '2027-01-01'), 'no January dates (the sheet has no dated January route)', iso(days(menlo, 40)));

console.log('[Dec 6 branch]');
{ const s2 = clone(LIVE); s2['2026-12-06'].routes.push('Fresno → Santa Barbara'); useSheet(s2);
  const f6 = days(fresno, 40).find((d) => d.date === '2026-12-06');
  ok(f6 && f6.shortLabel === 'Fresno & Santa Barbara', 'after the sheet records the Fresno branch: Fresno gets Dec 6, labeled Fresno & Santa Barbara', f6);
  ok(!has(pismo, '2026-12-06'), '… and SLO/Pismo does not');
  ok(has(sb, '2026-12-06'), '… and Santa Barbara does');
  s2['2026-12-06'].routes = ['Central California: SLO/Pismo Beach → Santa Barbara OR Fresno → Santa Barbara', 'Central California: SLO/Pismo Beach → Santa Barbara']; useSheet(s2);
  const p6 = days(pismo, 40).find((d) => d.date === '2026-12-06');
  ok(p6 && p6.shortLabel === 'Central Coast & Santa Barbara' && !has(fresno, '2026-12-06'), 'coastal branch chosen: Pismo yes, Fresno no', p6);
  s2['2026-12-06'].routes = ['Central California: SLO/Pismo Beach → Santa Barbara OR Fresno → Santa Barbara', 'Los Angeles']; useSheet(s2);
  ok(!has(sb, '2026-12-06') && !has(la, '2026-12-06'), 'a row that matches no branch = disagreement: date hidden'); live(); }

console.log('[stale / missing / conflicting data]');
useSheet(clone(LIVE), { fetchedAt: Date.now() - 31 * 60 * 1000 });
ok(!days(menlo).length && !days(oak).length, 'sheet data older than 30 min: no dates at all');
useSheet({}, { fetchedAt: 0 });
ok(!days(menlo).length, 'sheet never read: no dates (the weekly catalog never fills in)');
{ const s2 = clone(LIVE); s2['2026-12-02'].routes.push('Los Angeles'); useSheet(s2);
  ok(!has(menlo, '2026-12-02') && !has(la, '2026-12-02'), 'two route rows for different areas on one date: date hidden'); }
{ const s2 = clone(LIVE); Object.assign(s2['2026-12-02'], { calendar: true, open: true, zones: ['LA'] }); useSheet(s2);
  ok(!has(menlo, '2026-12-02'), 'ROUTE CALENDAR disagrees with the route text: date hidden'); }
{ const s2 = clone(LIVE); Object.assign(s2['2026-12-02'], { calendar: true, open: true, zones: ['BayWest', 'EastBay'] }); useSheet(s2);
  ok(has(menlo, '2026-12-02') && !has(oak, '2026-12-02'), 'a calendar can never widen the route (Oakland stays off Wednesday)'); }
{ const s2 = clone(LIVE); Object.assign(s2['2026-12-04'], { calendar: true, open: true, zones: ['EastBay'] }); useSheet(s2);
  ok(has(oak, '2026-12-04') && !has(napa, '2026-12-04'), 'a calendar can block one area of the route (Napa off, Oakland on)'); }
{ const s2 = clone(LIVE); s2['2026-12-02'].off = true; s2['2026-12-16'].off = true; useSheet(s2);
  ok(!days(menlo, 40).length, 'Menlo with no Wednesday open: nothing at all (no Friday if-quick fallback)', iso(days(menlo, 40)));
  ok(!has(menlo, '2026-12-04'), 'Menlo Dec 4 stays off even with no primary date in 14 days'); }
live();

console.log('[pairing]');
const pr = sched.availableDeliveryDays(oak, menlo, '2026-12-02', { items: [] }, 8);
ok(pr.some((d) => d.date === '2026-12-04'), 'Menlo Park Wed Dec 2 pickup still pairs with an Oakland Fri Dec 4 delivery', iso(pr));
ok(sched.canPairPickupDelivery('2026-12-02', menlo, oak, { items: [] }), 'canPair agrees (Dec 2 → Oakland)');
ok(!sched.canPairPickupDelivery('2026-12-04', menlo, oak, { items: [] }), 'Menlo cannot be picked up on the Friday loop');
{ const keep = config.scheduling.blackoutDates.slice();
  config.scheduling.blackoutDates.push('2026-12-04');
  const p2 = sched.availableDeliveryDays(oak, menlo, '2026-12-02', { items: [] }, 8);
  ok(!p2.some((d) => d.date === '2026-12-04') && !has(oak, '2026-12-04'), 'holiday on the delivery leg: that date leaves both the list and the pairs', iso(p2));
  config.scheduling.blackoutDates.push('2026-12-02');
  ok(!has(menlo, '2026-12-02') && !sched.canPairPickupDelivery('2026-12-02', menlo, oak, { items: [] }), 'holiday on the pickup leg: no pickup, no pair');
  config.scheduling.blackoutDates.length = 0; config.scheduling.blackoutDates.push(...keep); }

console.log('[Thursday en route, Chad t2096u]');
live();
const t3 = days(oak, 40).find((d) => d.date === '2026-12-03');
ok(t3 && t3.shortLabel === THU && t3.enRoute, 'Oakland is offered Thu Dec 3, labeled East Bay (morning) & Sacramento area', t3);
for (const a of [berk, fremont, walnut]) ok(has(a, '2026-12-03'), `${a.city} is on the drive up: Thursday offered`);
ok(!has(livermore, '2026-12-03') && has(livermore, '2026-12-04'), 'Livermore (east on I-580) is off the way: Friday only');
ok(!has(napa, '2026-12-03') && !has(menlo, '2026-12-03'), 'Napa and the Peninsula are not on Thursday');
const s3 = days(sac, 40).find((d) => d.date === '2026-12-03');
ok(s3 && s3.shortLabel === THU && !s3.enRoute, 'a Sacramento address gets Thursday Dec 3', s3);
const ev = RW.publicView(RW.evaluate(oak, '2026-12-03', {}));
ok(ev.windows.map((w) => w.v).join() === 'late_morning,midday' && ev.windows.every((w) => w.ok), 'Oakland Thursday shows only mid-morning to midday windows', ev);
const evF = RW.publicView(RW.evaluate(oak, '2026-12-04', {}));
ok(evF.windows.length > 2, 'Oakland Friday keeps its normal windows', evF.windows.map((w) => w.v));
const evS = RW.publicView(RW.evaluate(sac, '2026-12-03', {}));
ok(evS.windows.some((w) => w.v === 'afternoon'), 'Sacramento Thursday keeps afternoon windows');
ok(RW.selectionErrors({ service: 'delivery_only', dropoff: oak, schedule: { date: '2026-12-03', timePref: 'afternoon' } }, { delivery_only: { needsDropoff: true } }).length === 1, 'an afternoon window for Oakland on Thursday is refused at checkout');
// The same reserve the server's holdSlots runs (lib/holds + sched.orderLegs / isEnRouteStop / enRouteLeft).
const SVC = require('../lib/pricing').SERVICES;
const order = (id, pu, de, d1, d2) => ({ id, service: 'pickup_delivery', pickup: pu, dropoff: de, items: [], schedule: { date: d1, deliveryDate: d2 } });
const hold = (o2) => {
  const need = {}; for (const [d] of sched.orderLegs(o2)) need[d] = (need[d] || 0) + 1;
  const en = {}, ru = {}; for (const [d, a] of sched.orderLegs(o2)) { const r = sched.isEnRouteStop(a, d); if (r) { en[d] = (en[d] || 0) + 1; ru[d] = r; } }
  return holds.reserve(o2.id, need, (d, h) => SD.capacityLeft(d, h), { tags: Object.keys(en).length ? { enroute: { need: en, remainingFor: (d) => sched.enRouteLeft(d, o2.id, ru[d]) } } : null });
};
ok(!!SVC.pickup_delivery && sched.orderLegs(order('x', berk, napa, '2026-12-03', '2026-12-04')).length === 2, 'orderLegs lists both legs');
const cap = config.scheduling.enRoute.maxStopsPerDay;
const towns = [berk, fremont, walnut, oak];
for (let i = 0; i < cap; i++) ok(hold(order('en' + i, towns[i], napa, '2026-12-03', '2026-12-04')).ok, `en-route East Bay booking ${i + 1} of ${cap} on Thu Dec 3 is held`);
const r4 = hold(order('en4', oak, napa, '2026-12-03', '2026-12-04'));
ok(!r4.ok && r4.full.includes('2026-12-03'), `the ${cap + 1}th en-route East Bay booking on that Thursday is refused`, r4);
ok(!holds.snapshot().some((h) => h.orderId === 'en4'), 'and nothing is reserved for it (both legs or neither)');
ok(!has(oak, '2026-12-03') && has(sac, '2026-12-03'), 'once the cap is reached, Thursday leaves the East Bay list; Sacramento keeps it');
ok(hold(order('sac1', sac, napa, '2026-12-03', '2026-12-04')).ok, 'a Sacramento booking that Thursday is not counted against the East Bay cap');
holds._reset();
{ const s2 = clone(LIVE); s2['2026-12-03'].stops = [{ town: 'Hayward', type: 'DEL', win: '', at: '' }, { town: 'Concord', type: 'PU', win: '', at: '' }, { town: 'Berkeley', type: 'DEL', win: '', at: '' }]; useSheet(s2);
  ok(!has(oak, '2026-12-03'), 'three East Bay stops already on the sheet that Thursday: no more en-route East Bay bookings'); live(); }

console.log('[Saturday Carmel run, south-bound en route, Chad t2098u]');
live(); holds._reset();
const losGatos = A('Los Gatos', '95030', '1 N Santa Cruz Ave'), saratoga = A('Saratoga', '95070', '1 Big Basin Way'), southSJ = A('San Jose', '95123', '1 Blossom Hill Rd');
const SAT = 'On the way to Carmel (midday stop)';
const lg5 = days(losGatos, 40).find((d) => d.date === '2026-12-05');
ok(lg5 && lg5.enRoute && lg5.shortLabel === SAT, 'Los Gatos gets the Carmel Saturday (Dec 5) as an en-route stop with its own label', lg5);
ok(days(losGatos, 40).find((d) => d.date === '2026-12-02').shortLabel === WED && !days(losGatos, 40).find((d) => d.date === '2026-12-02').enRoute, 'Los Gatos keeps Wednesday as its regular day');
const lgW = RW.publicView(RW.evaluate(losGatos, '2026-12-05', {}));
ok(lgW.windows.map((w) => w.v).join() === 'late_morning,midday', 'Los Gatos on the Carmel Saturday: late morning to midday windows only', lgW);
ok(RW.publicView(RW.evaluate(losGatos, '2026-12-02', {})).windows.length > 2, 'Los Gatos on Wednesday keeps its normal windows');
for (const a of [saratoga, southSJ, sc, aptos, capitola]) { const x = days(a, 40).find((d) => d.date === '2026-12-05'); ok(x && x.enRoute && x.shortLabel === SAT, `${a.city} ${a.zip}: Carmel Saturday en route`, x); }
ok(!has(sj, '2026-12-05'), 'downtown San Jose (95113) is not part of the south-bound Saturday run');
ok(!has(losGatos, '2026-12-01') && !has(sc, '2026-12-01'), 'the Tuesday Carmel run does not open these (Saturday only)');
ok(!has(menlo, '2026-12-05'), 'the Peninsula is not on the Saturday run');
ok(first(carmel).date === '2026-12-01' && days(carmel, 40).find((d) => d.date === '2026-12-05').shortLabel === 'Monterey Bay & Salinas', 'Carmel itself keeps its regular Saturday label');
{ const s2 = clone(LIVE); s2['2026-12-05'].routes = []; s2['2026-12-19'].routes = []; useSheet(s2);
  ok(!days(sc, 40).length && !has(losGatos, '2026-12-05'), 'no Carmel Saturday on the sheet: no Saturday en-route option (Santa Cruz then has no date)'); live(); }
for (let i = 0; i < cap; i++) { const hr = hold(order('sat' + i, [losGatos, saratoga, sc][i], menlo, '2026-12-05', '2026-12-16')); ok(hr.ok, `Saturday en-route booking ${i + 1} of ${cap} is held`, hr); }
const sat4 = hold(order('sat4', aptos, menlo, '2026-12-05', '2026-12-16'));
ok(!sat4.ok, `the ${cap + 1}th Saturday en-route booking is refused`, sat4);
ok(!has(losGatos, '2026-12-05') && has(carmel, '2026-12-05'), 'once full, the Saturday leaves the en-route list; Carmel keeps it');
holds._reset();

console.log('[Wednesday return leg, East Bay quick stop, Chad t2098u]');
live();
const quick = { service: 'pickup_delivery', items: [{ type: 'painting', w: 24, h: 30, d: 2, qty: 1 }] };
const WEDQ = 'Wed evening, quick stop only';
const oAuto = sched.availableDays(oak, { from, count: 12, order: quick });
ok(!oAuto.some((d) => d.date === '2026-12-02') && oAuto[0].date === '2026-12-03', 'Oakland: the Wednesday quick stop is never in the default list (Thursday / Friday exist)', iso(oAuto));
const oAll = sched.availableDays(oak, { from, count: 12, order: quick, quickStops: 'all' });
const w2 = oAll.find((d) => d.date === '2026-12-02');
ok(w2 && w2.quickStop && w2.enRoute && w2.shortLabel === WEDQ, 'later-date browsing shows Wed Dec 2 labeled "Wed evening, quick stop only"', w2);
const oW = RW.publicView(RW.evaluate(oak, '2026-12-02', {}));
ok(oW.windows.length && oW.windows.every((w) => ['evening', 'late_evening'].includes(w.v)) && oW.windows.some((w) => w.ok), 'Oakland on Wednesday: evening windows only', oW);
{ const s2 = clone(LIVE); for (const dd of ['2026-12-03', '2026-12-04', '2026-12-17', '2026-12-18']) s2[dd].off = true; useSheet(s2);
  const only = sched.availableDays(oak, { from, count: 12, order: quick });
  ok(only.length && only.every((d) => d.quickStop && d.shortLabel === WEDQ), 'no Thursday / Friday open: the Wednesday quick stop is offered (as a quick stop)', iso(only));
  const big = { service: 'delivery_install', items: [{ type: 'painting', w: 24, h: 30, d: 2, qty: 1 }] };
  ok(!sched.availableDays(oak, { from, count: 12, order: big }).length, 'an install job is never a Wednesday quick stop');
  const three = { service: 'pickup_delivery', items: [{ type: 'painting', w: 24, h: 30, d: 2, qty: 3 }] };
  ok(!sched.availableDays(oak, { from, count: 12, order: three }).length, '3+ pieces is never a Wednesday quick stop');
  live(); }
ok(!has(napa, '2026-12-02'), 'Napa is not on the Wednesday return');

// ---------------- server: main flow and Paloma's use the same checks; a direct checkout outside the list is refused ----------------
(async () => {
  console.log('[server: main + Paloma\'s]');
  // A copy of the live Dec 1-6 week moved onto the next bookable week, so the server (which uses today's date) sees it.
  const ymd = (t) => new Date(t).toISOString().slice(0, 10);
  const today = sched.ptYmd();
  let tue = Date.parse(today + 'T12:00:00Z') + 3 * 864e5; while (new Date(tue).getUTCDay() !== 2) tue += 864e5;
  const map = { '2026-12-01': 0, '2026-12-02': 1, '2026-12-03': 2, '2026-12-04': 3, '2026-12-05': 4, '2026-12-06': 5 };
  const dyn = {}; const D = {};
  for (const [src, off] of Object.entries(map)) { const d = ymd(tue + off * 864e5); dyn[d] = clone(LIVE[src]); D[src] = d; }
  const blocked = Object.values(D).filter((d) => sched.isBlockedDate(d));
  const fx = path.join(process.env.STORAGE_DIR, 'sheet-days-fixture.json');
  fs.writeFileSync(fx, JSON.stringify({ days: dyn }));
  const PORT = 5100 + Math.floor(Math.random() * 80), BASE = `http://127.0.0.1:${PORT}`;
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-rr-srv-')), SHEET_DAYS_FIXTURE: fx, TEST_MODE: '1', SKIP_GEOCODE: '1', BASE_URL: BASE, NODE_ENV: 'development' }, stdio: 'ignore' });
  const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  try {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/config'); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
    if (blocked.length) { console.log('  (skipped: a mapped date is a holiday this week)', blocked); return; }
    const site = (a) => ({ ...a, country: 'United States', sameAsMe: true, contactName: 'Route Tester', contactPhone: '4155550123', contactRole: '' });
    const ITEM = { id: 'pcA', type: 'painting', description: 'Canvas', w: '30', h: '24', d: '2', framed: 'no', value: '1000', photos: [], hangHeight: 'standard', crateStatus: 'not_sure' };
    const body = (pu, de, d1, d2, extra = {}) => ({ service: 'pickup_delivery', items: [{ ...ITEM }], pickup: site(pu), dropoff: site(de), contact: { name: 'Route Tester', email: `rt${Math.random().toString(36).slice(2, 8)}@example.com`, phone: '4155550123', company: '', clientType: 'Collector' }, heard: { repeatAnswer: 'yes', repeatClient: true }, payer: 'me', schedule: { date: d1, window: '', timePref: 'none', timeNote: '', deliveryLater: d2 > d1, deliveryDate: d2, deliveryTimePref: 'none', deliveryTimeNote: '' }, ...extra });
    const av = await post('/api/availability', { ...body(menlo, oak, '', ''), leg: 'pairs' });
    ok(av.status === 200 && av.j.days.map((d) => d.date).includes(D['2026-12-02']) && !av.j.days.some((d) => d.date === D['2026-12-04']), 'main flow: Menlo pickup gets the Wednesday, not the Friday', av.j && av.j.days);
    ok((av.j.pairs[D['2026-12-02']] || []).includes(D['2026-12-04']), 'main flow: Menlo Wed → Oakland Fri pairs', av.j && av.j.pairs);
    const avNo = await post('/api/availability', { ...body(truckee, oak, '', ''), leg: 'pairs' });
    ok(avNo.status === 200 && !avNo.j.days.length, 'main flow: a Truckee pickup gets no route dates', avNo.j);
    const avSc = await post('/api/availability', { ...body(sc, carmel, '', ''), leg: 'pairs' });
    ok(avSc.status === 200 && avSc.j.days.map((d) => d.date).join() === D['2026-12-05'] && avSc.j.days[0].enRoute, 'main flow: Santa Cruz pickup gets only the Carmel Saturday (en route)', avSc.j && avSc.j.days);
    const avOakW = await post('/api/availability', { ...body(oak, oak, '', ''), leg: 'pairs' });
    ok(!avOakW.j.days.some((d) => d.date === D['2026-12-02']), 'main flow: Oakland never sees the Wednesday quick stop by default', avOakW.j && avOakW.j.days.map((d) => d.date));
    const pal = (delivery) => ({ placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', courtesy: false, items: [{ name: 'Table Lamp', kind: 'Table Lamp', size: 'medium', value: 400, qty: 1 }], delivery: { name: 'Pat Client', phone: '(831) 555-0123', email: 'pat@example.com', state: 'CA', notes: 'rr ' + Math.random(), ...delivery }, access: { mode: 'ground' } });
    const palOak = pal({ street: '1 Broadway', city: 'Oakland', zip: '94607' });
    const deO = await post('/api/palomas/availability', { ...palOak, leg: 'dropoff', pickupDate: D['2026-12-01'] });
    ok(deO.j.days.some((d) => d.date === D['2026-12-04']), "Paloma's: Oakland delivery gets the Friday (before any bookings fill it)", deO.j && deO.j.days.map((d) => d.date));
    ok(deO.j.days.some((d) => d.date === D['2026-12-03'] && d.enRoute), "Paloma's: Oakland delivery also gets the Thursday drive-up", deO.j && deO.j.days.map((d) => d.date));
    const bad = await post('/api/orders', body(menlo, oak, D['2026-12-04'], D['2026-12-04']));
    ok(bad.status === 400 && /available route day/.test(bad.j.error || ''), 'main flow: a direct checkout for Menlo on the Friday loop is refused', bad);
    const bad2 = await post('/api/orders', body(oak, menlo, D['2026-12-04'], D['2026-12-06']));
    ok(bad2.status === 400, 'main flow: a direct checkout onto the unchosen Sunday branch is refused', bad2);
    const good = await post('/api/orders', body(menlo, oak, D['2026-12-02'], D['2026-12-04']));
    ok(good.status === 200, 'main flow: Menlo Wed → Oakland Fri books', good.j && (good.j.error || good.j.status));
    // Thursday cap through the real checkout: pickups on the drive up, delivery Friday in Napa.
    const thuRes = [];
    for (const a of [berk, fremont, walnut, oak]) thuRes.push(await post('/api/orders', body(a, napa, D['2026-12-03'], D['2026-12-04'])));
    ok(thuRes.slice(0, cap).every((r) => r.status === 200), `main flow: ${cap} en-route East Bay pickups on the Thursday book`, thuRes.map((r) => [r.status, r.j && r.j.error]));
    ok(thuRes[cap] && thuRes[cap].status !== 200, `main flow: the ${cap + 1}th en-route East Bay pickup that Thursday is refused`, thuRes[cap] && [thuRes[cap].status, thuRes[cap].j && thuRes[cap].j.error]);
    // Wednesday quick stop picked from a later-date list still books at checkout (same check, quickStops 'all'); an install job does not.
    const wq = await post('/api/orders', { ...body(oak, menlo, D['2026-12-02'], D['2026-12-02']), schedule: { date: D['2026-12-02'], window: '', timePref: 'evening', timeNote: '', deliveryLater: false, deliveryDate: D['2026-12-02'], deliveryTimePref: 'none', deliveryTimeNote: '' } });
    ok(wq.status !== 200, 'main flow: an Oakland pickup on the Wednesday return cannot be paired with an earlier Peninsula delivery the same day', wq.j && wq.j.error);
    const wq2 = await post('/api/orders', body(menlo, oak, D['2026-12-02'], D['2026-12-02']));
    ok(wq2.status === 200, 'main flow: Menlo Wed pickup → Oakland Wed evening quick drop-off books', wq2.j && (wq2.j.error || wq2.j.status));
    const wq3 = await post('/api/orders', { ...body(menlo, oak, D['2026-12-02'], D['2026-12-02']), service: 'delivery_install' });
    ok(wq3.status !== 200, 'main flow: an install job is refused as a Wednesday quick stop', wq3.j && wq3.j.error);
    const palMenlo = pal({ street: '1 Santa Cruz Ave', city: 'Menlo Park', zip: '94025' });
    const pu = await post('/api/palomas/availability', { ...palMenlo, leg: 'pickup' });
    const puDate = pu.j && pu.j.days[0] && pu.j.days[0].date;
    const de = await post('/api/palomas/availability', { ...palMenlo, leg: 'dropoff', pickupDate: puDate });
    ok(puDate === D['2026-12-01'] && de.j.days[0] && de.j.days[0].date === D['2026-12-02'] && !de.j.days.some((d) => d.date === D['2026-12-04']), "Paloma's: Menlo delivery gets the Wednesday, not the Friday", [puDate, de.j && de.j.days.map((d) => d.date)]);
    const palNo = pal({ street: '10 Donner Pass Rd', city: 'Truckee', zip: '96161' });
    const deN = await post('/api/palomas/availability', { ...palNo, leg: 'pickup' });
    ok(!deN.j.days.length, "Paloma's: a Truckee delivery gets no route dates", deN.j);
    const palSc = pal({ street: '1 Pacific Ave', city: 'Santa Cruz', zip: '95060' });
    const deS = await post('/api/palomas/availability', { ...palSc, leg: 'dropoff', pickupDate: D['2026-12-01'] });
    ok(deS.j.days.map((d) => d.date).join() === D['2026-12-05'], "Paloma's: Santa Cruz delivery gets the Carmel Saturday only", deS.j && deS.j.days);
    const pbad = await post('/api/palomas/orders', { ...palMenlo, payer: 'client', payMode: 'now', schedule: { date: D['2026-12-01'], deliveryDate: D['2026-12-04'] } });
    ok(pbad.status === 400, "Paloma's: a direct checkout for Menlo on the Friday loop is refused", pbad);
    const pgood = await post('/api/palomas/orders', { ...palMenlo, notes: 'x', delivery: { ...palMenlo.delivery, notes: 'rr ok' }, payer: 'client', payMode: 'now', schedule: { date: D['2026-12-01'], deliveryDate: D['2026-12-02'] } });
    ok(pgood.status === 200, "Paloma's: Menlo Tue → Wed books", pgood.j && (pgood.j.error || pgood.j.status));
    const mmA = await post('/api/availability', { ...body(A('Oakland', '94025', '1 Main St'), oak, '', ''), leg: 'pairs' });
    ok(mmA.status === 400 && mmA.j.error === 'This city and ZIP don’t match. Check the pickup address.', 'city/ZIP mismatch copy from the server', mmA.j && mmA.j.error);
  } finally {
    child.kill();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
