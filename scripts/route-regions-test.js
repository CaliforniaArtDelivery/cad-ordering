/**
 * Route-pattern matching and day labels (Chad t2094u).
 * A Menlo Park address must get the west-side / Peninsula day, not the Friday
 * East Bay loop, and two different routes must never share “SF Bay Area”.
 */
const assert = require('assert');
const P = require('../lib/route-patterns');
const sched = require('../lib/scheduling');

const from = new Date('2026-11-25T20:00:00Z');
const days = (addr, n = 8) => sched.availableDays(addr, { from, count: n });
const iso = (ds) => ds.map((d) => d.date);
const labs = (ds) => ds.map((d) => d.shortLabel);

const menlo = { city: 'Menlo Park', state: 'CA', zip: '94025', street: '1 Santa Cruz Ave' };
const palo = { city: 'Palo Alto', state: 'CA', zip: '94301', street: '1 University Ave' };
const sf = { city: 'San Francisco', state: 'CA', zip: '94103', street: '2 Henry Adams St' };
const oak = { city: 'Oakland', state: 'CA', zip: '94607', street: '1 Broadway' };
const napa = { city: 'Napa', state: 'CA', zip: '94559', street: '1 First St' };
const heald = { city: 'Healdsburg', state: 'CA', zip: '95448', street: '1 Healdsburg Ave' };
const sj = { city: 'San Jose', state: 'CA', zip: '95113', street: '1 S 1st St' };
const carmel = { city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921', street: '1 Ocean Ave' };
const la = { city: 'Los Angeles', state: 'CA', zip: '90069', street: '8678 Melrose Ave' };
const sb = { city: 'Santa Barbara', state: 'CA', zip: '93101', street: '1 State St' };
const sac = { city: 'Sacramento', state: 'CA', zip: '95814', street: '1 Capitol Mall' };

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m, extra !== undefined ? extra : ''); } };

console.log('[parse]');
const wed = P.parseRouteText('Silicon Valley → SF → Marin → Healdsburg → San Jose');
ok(wed.label === 'Peninsula, SF & Marin', 'Wednesday label', wed.label);
ok(P.roleFor(wed, 'BayWest', menlo) === 'primary', 'Menlo is primary on Wednesday');
ok(P.roleFor(wed, 'EastBay', oak) == null, 'Oakland is not on Wednesday');

const fri = P.parseRouteText('San Jose → East Bay → Napa → SF/Silicon Valley (late & if quick) → San Jose');
ok(fri.label === 'East Bay & Napa', 'Friday label', fri.label);
ok(P.roleFor(fri, 'BayWest', menlo) === 'conditional', 'Menlo is only if-quick on Friday');
ok(P.roleFor(fri, 'BayWest', palo) === 'conditional', 'Palo Alto is only if-quick on Friday');
ok(P.roleFor(fri, 'BayWest', sf) === 'conditional', 'SF is only if-quick on Friday');
ok(P.roleFor(fri, 'BayWest', heald) === 'conditional', 'Healdsburg is not a Friday primary');
ok(P.roleFor(fri, 'BayWest', sj) === 'primary', 'San Jose is the Friday hub (primary)');
ok(P.roleFor(fri, 'EastBay', oak) === 'primary', 'Oakland is primary on Friday');
ok(P.roleFor(fri, 'NapaWine', napa) === 'primary', 'Napa is primary on Friday');

const thu = P.parseRouteText('Sacramento & surrounding areas (priority) — East Bay only if quick / en route');
ok(thu.label === 'Sacramento', 'Thursday label', thu.label);
ok(P.roleFor(thu, 'Sacramento', sac) === 'primary', 'Sacramento is primary on Thursday');
ok(P.roleFor(thu, 'EastBay', oak) === 'conditional', 'East Bay is only if-quick on Thursday');

const mon = P.parseRouteText('LA, heading northwest (SB late or Fresno very late)');
ok(mon.label === 'Los Angeles', 'Monday NorCal label', mon.label);
ok(P.roleFor(mon, 'LA', la) === 'primary', 'LA is primary');
ok(P.roleFor(mon, 'SB', sb) === 'conditional', 'SB is late on that Monday');

const sun = P.parseRouteText('Central California: SLO/Pismo Beach → Santa Barbara OR Fresno → Santa Barbara');
ok(sun.label === 'Central Coast & Santa Barbara', 'Sunday label', sun.label);
ok(sun.orBranches, 'Sunday text has OR branches');

ok(P.parseRouteText('LA, heading southeast toward the Irvine hub').label === 'Los Angeles', 'Irvine hub is not an OC day label');

console.log('[offer]');
const m = days(menlo);
ok(m[0] && m[0].date === '2026-12-02', 'Menlo first day is Wed Dec 2', m[0] && m[0].date);
ok(m.every((d) => d.date.slice(8) !== '04' && !/Fri/.test(d.label)), 'Menlo is not offered Friday Dec 4 (or other Fridays) when a Wednesday is in the 14-day window', iso(m));
ok(m.every((d) => d.shortLabel === 'Peninsula, SF & Marin'), 'Menlo days are labeled Peninsula, SF & Marin', labs(m));
ok(!m.some((d) => /SF Bay Area/i.test(d.shortLabel)), 'Menlo no longer sees “SF Bay Area”');

ok(days(palo)[0].date === '2026-12-02', 'Palo Alto follows the west-side day');
ok(days(sf)[0].date === '2026-12-02', 'SF follows the west-side day');
ok(days(heald)[0].date === '2026-12-02' && days(heald).every((d) => !d.date.endsWith('12-04')), 'Healdsburg is Wednesday-only');

const o = days(oak);
ok(o[0] && o[0].date === '2026-12-04', 'Oakland first day is Fri Dec 4', o[0] && o[0].date);
ok(!o.some((d) => d.date === '2026-12-03'), 'Oakland is not offered Thursday Dec 3 (East Bay is only if-quick that day)', iso(o));
ok(o.every((d) => d.shortLabel === 'East Bay & Napa'), 'Oakland days are labeled East Bay & Napa', labs(o));

ok(days(napa)[0].date === '2026-12-04' && days(napa)[0].shortLabel === 'East Bay & Napa', 'Napa is the Friday loop');

const j = days(sj);
ok(j.some((d) => d.date === '2026-12-02') && j.some((d) => d.date === '2026-12-04'), 'San Jose (the hub) is offered both Wednesday and Friday', iso(j));
const jWed = j.find((d) => d.date === '2026-12-02');
const jFri = j.find((d) => d.date === '2026-12-04');
ok(jWed && jFri && jWed.shortLabel !== jFri.shortLabel, 'San Jose’s two days have different labels', [jWed && jWed.shortLabel, jFri && jFri.shortLabel]);
ok(jWed.shortLabel === 'Peninsula, SF & Marin' && jFri.shortLabel === 'East Bay & Napa', 'San Jose labels are the two Bay loops');

ok(days(carmel)[0].date === '2026-12-01' && days(carmel)[0].shortLabel === 'Monterey Bay & Salinas', 'Carmel is Monterey Bay & Salinas');
ok(days(la)[0].date === '2026-12-07' && days(la).every((d) => d.shortLabel === 'Los Angeles'), 'LA days are labeled Los Angeles, not mixed with OC', labs(days(la)));
ok(days(sb)[0].date === '2026-12-06' && days(sb).every((d) => d.shortLabel === 'Central Coast & Santa Barbara'), 'Santa Barbara uses the Sunday Central Coast day, not the late Monday add-on', iso(days(sb)).concat(labs(days(sb))));
ok(days(sac)[0].date === '2026-12-03' && days(sac)[0].shortLabel === 'Sacramento', 'Sacramento stays on Thursday');

// Two different route days in one offer list must not share a generic label.
for (const [name, a] of [['Menlo', menlo], ['Oakland', oak], ['San Jose', sj], ['LA', la], ['SB', sb]]) {
  const by = new Map();
  for (const d of days(a)) {
    const k = d.shortLabel;
    if (!by.has(k)) by.set(k, new Set());
    by.get(k).add(d.label.slice(0, 3)); // weekday
  }
  // Same label on Tue+Sat Carmel-style same route is fine; Wed+Fri must differ.
  const clash = [...by.values()].some((wd) => wd.has('Wed') && wd.has('Fri'));
  ok(!clash, name + ': Wednesday and Friday never share a label', [...by.entries()]);
}

console.log('[pairing]');
const pair = sched.availableDeliveryDays(oak, menlo, '2026-12-02', { items: [] }, 8);
ok(pair.some((d) => d.date === '2026-12-04'), 'Menlo Park Wednesday pickup still pairs with an Oakland Friday delivery', iso(pair));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
