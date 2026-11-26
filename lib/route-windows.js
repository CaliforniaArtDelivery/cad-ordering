/**
 * Route-aware time windows (Chad, Nov 25 2026; Kaila's suggestion).
 *
 * The customer picks preferred arrival windows (Morning ... Late evening). This module grays out the windows that do not fit the
 * day's planned route on the live CAD schedule (SCHEDULE 2026, read-only, through the Apps Script `days` digest: each date's
 * timed stops = TOWN REF + Arrival Time Window). It works like the pickup/delivery date graying: whichever date or leg is picked,
 * the windows narrow.
 *
 * Rules (plain English, also in /workspace/reviews/CAD-TIMESLOTS-001.txt):
 *  1. Only KNOWN conflicts are grayed. Every grayed window carries a short customer reason (never staff names, never a phone prompt).
 *  2. A new stop fits a window when the van can get there from the stop before it (its window start + stop time + drive) and still
 *     reach the next stop before that stop's window ends. A stop near an existing stop therefore fits around that stop's time.
 *  3. Down-and-back days (out from a hub and back): early windows (on the way out) and late windows (on the way back) fit near the
 *     hub side; midday, when the van is far away, does not.
 *  4. Straight-through days (the van keeps driving away): after the last planned stop, only places close to that last stop fit.
 *     Areas the van passes early fit only the early windows.
 *  5. Firm 10-hour driver day: a window that would stretch the day past 10 hours (or past what is already planned, when the sheet
 *     already runs longer) is grayed.
 *  6. Pickup + delivery are one booking. Same day: pickup comes first, with time to drive between them; a pickup window is offered
 *     only if at least one delivery window still fits after it, and the reverse.
 *  7. At least one window stays open on any date that is offered. If none fit, the date itself is not offered.
 *  8. FALLBACK: no fresh schedule data, a digest without a stop list, no timed stops that day, a town we can't place, or an address
 *     we can't place => every window stays OPEN (the reason is recorded in `fallback`). Closed / full days are handled by the
 *     Date Guard as before. Rush and dedicated trips are never narrowed (the time is arranged for them).
 * Nothing here writes anywhere.
 */
const WINDOWS = [ // value, label, start hour, end hour (PT). Labels match public/access.js TIME_PREFS.
  ['morning', 'Morning', 9, 10.5], ['late_morning', 'Late morning', 10.5, 12], ['midday', 'Midday', 12, 13.5],
  ['early_afternoon', 'Early afternoon', 13.5, 15], ['afternoon', 'Afternoon', 15, 16], ['late_afternoon', 'Late afternoon', 16, 17],
  ['early_evening', 'Early evening', 17, 18], ['evening', 'Evening', 18, 19], ['late_evening', 'Late evening', 19, 20.5],
].map(([v, label, s, e]) => ({ v, label, s, e }));
const SVC = 0.5;          // hours on site per stop (load / unload / paperwork)
const NEAR_H = 0.75;      // "close to" = within ~45 min drive
const DAY_MAX_H = 10;     // firm driver day
const REASONS = {
  north: 'Our van is farther north at this time', south: 'Our van is farther south at this time',
  east: 'Our van is farther east at this time', west: 'Our van is farther west at this time',
  busy: 'Our van is at another stop at this time', movedOn: 'Our van has moved on from your area by then',
  hours: 'Outside our route hours that day', puFirst: 'Pickup comes first, so this is too early for delivery',
  delAfter: 'Too late to deliver the same day after this pickup',
};

// ---------- geography (rough) ----------
// Zone centroids for the existing route zones (lib/scheduling.js ZONE_CITIES), plus common towns. Lat, lon.
const ZONE_CENTER = {
  LA: [34.05, -118.30], OC: [33.68, -117.83], SD: [32.85, -117.20], Coachella: [33.75, -116.40], SB: [34.35, -119.40],
  Central: [35.40, -120.30], Carmel: [36.60, -121.80], BayWest: [37.55, -122.20], EastBay: [37.82, -122.15],
  NapaWine: [38.35, -122.55], Sacramento: [38.60, -121.40], Tahoe: [39.10, -120.10],
};
const TOWNS = {
  'san francisco': [37.77, -122.42], 'sf': [37.77, -122.42], 'daly city': [37.69, -122.47], 'south san francisco': [37.65, -122.41],
  'millbrae': [37.60, -122.39], 'burlingame': [37.58, -122.35], 'san mateo': [37.56, -122.32], 'belmont': [37.52, -122.28],
  'san carlos': [37.51, -122.26], 'redwood city': [37.49, -122.24], 'atherton': [37.46, -122.20], 'menlo park': [37.45, -122.18],
  'woodside': [37.43, -122.25], 'palo alto': [37.44, -122.14], 'los altos': [37.38, -122.11], 'mountain view': [37.39, -122.08],
  'sunnyvale': [37.37, -122.04], 'cupertino': [37.32, -122.03], 'santa clara': [37.35, -121.95], 'san jose': [37.34, -121.89],
  'campbell': [37.29, -121.95], 'los gatos': [37.23, -121.96], 'saratoga': [37.26, -122.03], 'milpitas': [37.43, -121.90],
  'santa cruz': [36.97, -122.03], 'half moon bay': [37.46, -122.43], 'sausalito': [37.86, -122.49], 'mill valley': [37.91, -122.55],
  'tiburon': [37.87, -122.46], 'san rafael': [37.97, -122.53], 'novato': [38.11, -122.57], 'healdsburg': [38.61, -122.87],
  'oakland': [37.80, -122.27], 'berkeley': [37.87, -122.27], 'alameda': [37.77, -122.24], 'emeryville': [37.83, -122.29],
  'piedmont': [37.82, -122.23], 'walnut creek': [37.91, -122.06], 'lafayette': [37.89, -122.12], 'orinda': [37.88, -122.18],
  'concord': [37.98, -122.03], 'alamo': [37.85, -122.03], 'danville': [37.82, -122.00], 'san ramon': [37.78, -121.98],
  'pleasanton': [37.66, -121.87], 'dublin': [37.70, -121.94], 'livermore': [37.68, -121.77], 'fremont': [37.55, -121.99],
  'hayward': [37.67, -122.08], 'napa': [38.30, -122.29], 'st helena': [38.51, -122.47], 'saint helena': [38.51, -122.47],
  'yountville': [38.40, -122.36], 'calistoga': [38.58, -122.58], 'sonoma': [38.29, -122.46], 'santa rosa': [38.44, -122.71],
  'petaluma': [38.23, -122.64], 'sacramento': [38.58, -121.49], 'davis': [38.54, -121.74], 'folsom': [38.68, -121.18],
  'roseville': [38.75, -121.29], 'elk grove': [38.41, -121.37], 'auburn': [38.90, -121.08], 'truckee': [39.33, -120.18],
  'south lake tahoe': [38.94, -119.98], 'tahoe city': [39.17, -120.14], 'carmel': [36.56, -121.92], 'carmel valley': [36.48, -121.73],
  'pebble beach': [36.57, -121.95], 'monterey': [36.60, -121.89], 'pacific grove': [36.62, -121.92], 'salinas': [36.68, -121.66],
  'seaside': [36.61, -121.85], 'marina': [36.68, -121.80], 'gilroy': [37.01, -121.57], 'watsonville': [36.91, -121.76],
  'big sur': [36.27, -121.81], 'san luis obispo': [35.28, -120.66], 'slo': [35.28, -120.66], 'pismo': [35.14, -120.64],
  'paso robles': [35.63, -120.69], 'santa maria': [34.95, -120.44], 'buellton': [34.61, -120.19], 'solvang': [34.60, -120.14],
  'fresno': [36.74, -119.79], 'bakersfield': [35.37, -119.02], 'santa barbara': [34.42, -119.70], 'montecito': [34.44, -119.63],
  'goleta': [34.44, -119.83], 'carpinteria': [34.40, -119.52], 'ventura': [34.27, -119.23], 'ojai': [34.45, -119.24],
  'oxnard': [34.20, -119.18], 'camarillo': [34.22, -119.04], 'thousand oaks': [34.17, -118.84], 'westlake village': [34.15, -118.81],
  'calabasas': [34.16, -118.64], 'malibu': [34.03, -118.78], 'porter ranch': [34.28, -118.55], 'northridge': [34.23, -118.54],
  'woodland hills': [34.17, -118.61], 'encino': [34.16, -118.50], 'sherman oaks': [34.15, -118.45], 'studio city': [34.14, -118.40],
  'burbank': [34.18, -118.31], 'glendale': [34.14, -118.26], 'pasadena': [34.15, -118.14], 'altadena': [34.19, -118.13],
  'santa monica': [34.02, -118.49], 'venice': [33.99, -118.47], 'culver city': [34.02, -118.40], 'beverly hills': [34.07, -118.40],
  'west hollywood': [34.09, -118.36], 'hollywood': [34.10, -118.33], 'los angeles': [34.05, -118.25], 'bel air': [34.10, -118.46],
  'brentwood': [34.05, -118.48], 'pacific palisades': [34.05, -118.53], 'long beach': [33.77, -118.19], 'torrance': [33.84, -118.34],
  'manhattan beach': [33.88, -118.41], 'palos verdes estates': [33.79, -118.39], 'santa fe springs': [33.94, -118.09],
  'chino hills': [33.99, -117.73], 'irvine': [33.68, -117.79], 'newport beach': [33.62, -117.93], 'newport': [33.62, -117.93],
  'costa mesa': [33.64, -117.92], 'laguna beach': [33.54, -117.78], 'laguna niguel': [33.52, -117.71], 'dana point': [33.47, -117.70],
  'san clemente': [33.43, -117.61], 'huntington beach': [33.66, -118.00], 'anaheim': [33.84, -117.91], 'santa ana': [33.75, -117.87],
  'tustin': [33.75, -117.83], 'orange': [33.79, -117.85], 'oc': [33.68, -117.83], 'oceanside': [33.20, -117.38],
  'carlsbad': [33.16, -117.35], 'encinitas': [33.04, -117.29], 'del mar': [32.96, -117.27], 'rancho santa fe': [33.02, -117.20],
  'san marcos': [33.14, -117.17], 'escondido': [33.12, -117.09], 'la jolla': [32.84, -117.27], 'san diego': [32.72, -117.16],
  'coronado': [32.69, -117.18], 'lakeside': [32.86, -116.92], 'chula vista': [32.64, -117.08], 'palm springs': [33.83, -116.55],
  'cathedral city': [33.78, -116.47], 'rancho mirage': [33.74, -116.41], 'palm desert': [33.72, -116.37], 'indian wells': [33.72, -116.34],
  'la quinta': [33.66, -116.31], 'indio': [33.72, -116.22], 'coachella': [33.68, -116.17],
};
const ALIAS = [[/^sta\.?\s+/, 'santa '], [/^st\.?\s+/, 'st '], [/^mt\.?\s+/, 'mount '], [/^alta dena$/, 'altadena'], [/^bearpark\s+/, '']];
const normTown = (t) => {
  let s = String(t || '').toLowerCase().split(/[\n,(]/)[0].replace(/[^a-z. ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of ALIAS) s = s.replace(re, to);
  return s.replace(/\./g, '').trim();
};
const sched = () => require('./scheduling');
function placeTown(town) {
  const n = normTown(town);
  if (!n) return null;
  if (TOWNS[n]) return { ll: TOWNS[n], name: n };
  const words = n.split(' ');
  for (let k = words.length; k > 0; k--) { const p = words.slice(0, k).join(' '); if (TOWNS[p]) return { ll: TOWNS[p], name: p }; }
  const z = sched().cityZone(n);
  return z && ZONE_CENTER[z] ? { ll: ZONE_CENTER[z], name: n, rough: true } : null;
}
function placeAddress(a) {
  if (!a) return null;
  const t = placeTown(a.city);
  if (t && !t.rough) return t;
  const z = sched().zoneFor(a);
  if (t && t.rough) return t;
  return z && ZONE_CENTER[z] ? { ll: ZONE_CENTER[z], name: z, rough: true } : null;
}
const km = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Rough drive time in hours: road distance ~1.3x straight line; ~55 km/h on local trips, ~85 km/h on longer freeway runs.
const driveH = (a, b) => { const d = km(a, b) * 1.3; return d < 5 ? 0.15 : d / (d > 80 ? 85 : 55); };

// ---------- the day's planned route ----------
// "11AM-1PM", "1:30PM-3PM", "8:30-9AM", "12:30pm-1pm", "10:30 AM" -> [start, end] in hours. "All day" / blank -> null.
function parseWindow(win, at) {
  const toks = [];
  String(win || '').replace(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/gi, (m, h, mi, ap) => { toks.push({ h: +h, m: +(mi || 0), ap: ap ? ap[0].toLowerCase() : '' }); return m; });
  const hr = (t, ap) => { let h = t.h % 12; if ((t.ap || ap) === 'p') h += 12; else if (!(t.ap || ap) && t.h >= 1 && t.h <= 7) h += 12; return h + t.m / 60; };
  if (toks.length >= 2) {
    let s = hr(toks[0], toks[0].ap || toks[1].ap), e = hr(toks[1], toks[1].ap);
    if (s > e && !toks[0].ap) s = hr(toks[0], 'a');
    if (s > e || s < 5 || e > 23.5) return null;
    return [s, Math.max(e, s + 0.25)];
  }
  if (toks.length === 1) { const s = hr(toks[0], toks[0].ap); return s >= 5 && s <= 23 ? [s, s + 0.5] : null; }
  if (at) return parseWindow(at);
  return null;
}
// Down-and-back vs straight-through: the sheet's own route text first (a loop "San Jose -> ... -> San Jose", "drive south"),
// then the weekly catalog (config.scheduling.dayCatalog routeType). Hub = where a down-and-back day starts and ends.
function routeShape(iso, day) {
  const text = ((day && day.routes) || []).join(' | ');
  const info = sched().dayInfo(new Date(iso + 'T12:00:00Z'));
  const parts = text.split(/→|->/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3 && normTown(parts[0]) && normTown(parts[0]) === normTown(parts[parts.length - 1])) {
    const hub = placeTown(parts[0]);
    return { type: 'downAndBack', hub: hub && hub.ll, from: 'route text loop' };
  }
  if (/drive (south|north)|drives (north|south)|heading|stay (the )?night|then drive|night in/i.test(text)) return { type: 'through', hub: null, from: 'route text' };
  const type = info.routeType || 'through';
  let hub = null;
  if (type === 'downAndBack') hub = info.weekType === 'SoCal' ? TOWNS.irvine : TOWNS['san jose'];
  return { type, hub, from: 'weekly catalog' };
}
function anchorsFor(day) {
  const out = [], unplaced = [];
  for (const st of (day && day.stops) || []) {
    const w = parseWindow(st.win, st.at);
    if (!w) continue; // untimed stop ("All day", blank): not used as an anchor
    const p = placeTown(st.town);
    if (!p) { unplaced.push(st.town); continue; }
    out.push({ s: w[0], e: w[1], ll: p.ll, town: p.name });
  }
  out.sort((a, b) => a.s - b.s || a.e - b.e);
  return { anchors: out, unplaced };
}
function spanOf(anchors, shape, cand) {
  const pts = anchors.map((a) => ({ s: a.s, end: a.s + SVC, ll: a.ll }));
  if (cand) pts.push({ s: cand.a, end: cand.a + SVC, ll: cand.ll });
  if (!pts.length) return 0;
  pts.sort((x, y) => x.s - y.s);
  let start = pts[0].s, end = Math.max(...pts.map((p) => p.end));
  const lastPt = pts.reduce((m, p) => (p.end >= m.end ? p : m), pts[0]);
  if (shape.hub) { start -= driveH(shape.hub, pts[0].ll); if (shape.type === 'downAndBack') end += driveH(lastPt.ll, shape.hub); }
  return end - start;
}
const dirWhy = (van, me) => {
  if (!van) return REASONS.busy;
  if (km(van, me) < 25) return REASONS.busy;
  const dLat = van[0] - me[0], dLon = (van[1] - me[1]) * Math.cos(me[0] * Math.PI / 180);
  return Math.abs(dLat) >= Math.abs(dLon) ? (dLat > 0 ? REASONS.north : REASONS.south) : (dLon > 0 ? REASONS.east : REASONS.west);
};
// One window for one place on one planned day. Returns { ok, why, a } (a = earliest arrival hour that fits).
function fitWindow(w, me, anchors, shape, baseSpan) {
  let why = null, sawHours = false, sawMoved = false;
  for (let i = 0; i <= anchors.length; i++) {
    const prev = anchors[i - 1], next = anchors[i];
    const a = Math.max(w.s, prev ? prev.s + SVC + driveH(prev.ll, me) : w.s);
    if (a > w.e) continue;
    if (next && a + SVC + driveH(me, next.ll) > next.e) continue;
    if (!next && prev && shape.type === 'through' && driveH(prev.ll, me) > NEAR_H) { sawMoved = true; continue; }
    if (spanOf(anchors, shape, { a, ll: me }) > Math.max(DAY_MAX_H, baseSpan) + 1e-6) { sawHours = true; continue; }
    return { ok: true, a };
  }
  if (sawMoved && anchors.length && w.s >= anchors[anchors.length - 1].s) why = REASONS.movedOn;
  else if (sawHours && !why) {
    // The van could get there, but only by stretching the driver day past 10 hours.
    why = REASONS.hours;
  }
  // Straight-through: once the van has passed the planned stop nearest to this address, it is not coming back that day.
  if (!why && shape.type === 'through' && anchors.length) {
    const near = anchors.reduce((b, x) => (!b || km(x.ll, me) < km(b.ll, me) ? x : b), null);
    if (near && w.s >= near.e && near !== anchors[anchors.length - 1] && km(near.ll, me) < km(anchors[anchors.length - 1].ll, me)) why = REASONS.movedOn;
  }
  if (!why) {
    const mid = (w.s + w.e) / 2;
    const van = anchors.reduce((best, x) => (!best || Math.abs((x.s + x.e) / 2 - mid) < Math.abs((best.s + best.e) / 2 - mid) ? x : best), null);
    why = dirWhy(van && van.ll, me);
  }
  return { ok: false, why };
}

const allOpen = (fallback) => ({ fallback, windows: WINDOWS.map((w) => ({ v: w.v, label: w.label, ok: true })) });
/**
 * Morning gate (Chad, Nov 25 2026): the Morning window (9-10:30) is offered only on a day that already has at least
 * config.scheduling.morningUnlockStops (5) stops: SCHEDULE 2026 stops plus booked online orders for that date. Otherwise the
 * earliest window is Late morning. Missing or stale data HIDES Morning (safe default; it simply isn't shown, no wording).
 * A hidden window is ok:false + hidden:true; publicView leaves it out entirely.
 */
const morningUnlockStops = () => { const n = Number((require('../config').scheduling || {}).morningUnlockStops); return Number.isFinite(n) ? n : 5; };
function stopsOn(iso) {
  const SD = require('./sheet-days'); const snap = SD.snapshot();
  if (!snap.fetchedAt || snap.stale) return null;
  const day = SD.days()[iso]; if (!day) return null;
  const listed = Array.isArray(day.stops) ? day.stops.length : 0;
  return Math.max(listed, Number(day.jobRows || 0)); // jobRows also counts online orders booked since the last refresh (sheet-days.bump)
}
function morningOpen(iso) { const need = morningUnlockStops(); if (need <= 0) return true; const n = stopsOn(iso); return n != null && n >= need; } // 0 turns the gate off
function gateMorning(r, iso) {
  if (morningOpen(iso)) return { ...r, morningGate: 'open' };
  const windows = r.windows.map((w) => (w.v === 'morning' ? { v: w.v, label: w.label, ok: false, hidden: true } : w));
  return { ...r, windows, morningGate: 'hidden', noFit: !windows.some((w) => w.ok) };
}
/** Windows for one address on one date. opts.order: skip for rush / dedicated. */
function evaluate(addr, iso, opts = {}) { return gateMorning(evaluateRoute(addr, iso, opts), iso); }
function evaluateRoute(addr, iso, opts = {}) {
  const o = opts.order || {};
  if (o.rush || o.dedicated) return allOpen('rush or dedicated trip: time arranged directly');
  const SD = require('./sheet-days');
  const snap = SD.snapshot();
  if (!snap.fetchedAt || snap.stale) return allOpen('no fresh schedule data (fallback: windows open)');
  const day = SD.days()[iso];
  if (!day) return allOpen('no schedule rows for this date (fallback: windows open)');
  if (!Array.isArray(day.stops)) return allOpen('schedule digest has no stop list yet (Apps Script days digest v5 not deployed) (fallback: windows open)');
  const { anchors, unplaced } = anchorsFor(day);
  if (unplaced.length) return allOpen(`a stop's town could not be placed ("${String(unplaced[0]).trim()}") (fallback: windows open)`);
  if (!anchors.length) return allOpen('no timed stops on this date yet (fallback: windows open)');
  const me = placeAddress(addr);
  if (!me) return allOpen('address could not be placed on the map (fallback: windows open)');
  const shape = routeShape(iso, day);
  const baseSpan = spanOf(anchors, shape, null);
  const windows = WINDOWS.map((w) => { const f = fitWindow(w, me.ll, anchors, shape, baseSpan); return { v: w.v, label: w.label, ok: f.ok, ...(f.ok ? { a: f.a } : { why: f.why }) }; });
  return { fallback: null, routeType: shape.type, shapeFrom: shape.from, anchors: anchors.length, windows, noFit: !windows.some((w) => w.ok) };
}
const W = (v) => WINDOWS.find((w) => w.v === v);
/**
 * Pickup + delivery as one booking. Same date: pickup first, with time to drive between the two. A pickup window stays open only if
 * some delivery window still fits after it (and the reverse). Chosen preferences narrow the other leg, like the date columns.
 */
function pair(pickup, dropoff, puIso, delIso, opts = {}) {
  const pu = evaluate(pickup, puIso, opts), de = evaluate(dropoff, delIso, opts);
  if (puIso !== delIso || !puIso) return { pickup: pu, delivery: de, sameDay: false };
  const pl = placeAddress(pickup), dl = placeAddress(dropoff);
  const gap = SVC + (pl && dl ? driveH(pl.ll, dl.ll) : 1);
  const puArr = (x) => (x.a != null ? x.a : W(x.v).s), deLatest = (x) => W(x.v).e;
  const canFollow = (p, d) => puArr(p) + gap <= deLatest(d);
  const selPu = (opts.puPref || []).filter((v) => W(v)), selDe = (opts.delPref || []).filter((v) => W(v));
  const puOk = pu.windows.map((p) => {
    if (!p.ok) return p;
    const ds = de.windows.filter((d) => d.ok && (!selDe.length || selDe.includes(d.v)));
    return ds.some((d) => canFollow(p, d)) ? p : { ...p, ok: false, why: REASONS.delAfter };
  });
  const deOk = de.windows.map((d) => {
    if (!d.ok) return d;
    const ps = pu.windows.filter((p) => p.ok && (!selPu.length || selPu.includes(p.v)));
    return ps.some((p) => canFollow(p, d)) ? d : { ...d, ok: false, why: REASONS.puFirst };
  });
  return { sameDay: true, pickup: { ...pu, windows: puOk, noFit: !puOk.some((w) => w.ok) }, delivery: { ...de, windows: deOk, noFit: !deOk.some((w) => w.ok) } };
}
const prefList = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter((x) => W(x));
/** For a booking: is there at least one window on each date (and, same day, an ordered pair)? */
function dateFits(addr, iso, order) { return !evaluate(addr, iso, { order }).noFit; }
function pairFits(pickup, dropoff, puIso, delIso, order) { const r = pair(pickup, dropoff, puIso, delIso, { order }); return !r.pickup.noFit && !r.delivery.noFit; }
/** Server-side re-check at submit / pay. Returns [] or ['TIME: ...'] (the client sends the customer back to pick another time). */
function selectionErrors(o, SERVICES) {
  if (!o || !o.schedule || !o.schedule.date) return [];
  if (o.rush || o.dedicated) { // route fit is arranged directly, but the Morning gate still applies
    const svc0 = (SERVICES || {})[o.service] || {};
    const dIso = o.schedule.deliveryDate || o.schedule.date;
    const puM = prefList(o.schedule.timePref).includes('morning') && !morningOpen(o.schedule.date);
    const deM = svc0.needsPickup && svc0.needsDropoff && prefList(o.schedule.deliveryTimePref).includes('morning') && !morningOpen(dIso);
    if (!puM && !deM) return [];
    const which = puM && deM ? 'pickup and delivery times' : deM ? 'delivery time' : (svc0.needsPickup && svc0.needsDropoff ? 'pickup time' : 'time');
    return [`TIME: The ${which} you picked no longer fits our route that day. Nothing has been charged. Please pick another time.`];
  }
  const svc = (SERVICES || {})[o.service] || {};
  const two = svc.needsPickup && svc.needsDropoff;
  const puPref = prefList(o.schedule.timePref), dePref = prefList(o.schedule.deliveryTimePref);
  const bad = [];
  if (two) {
    const r = pair(o.pickup, o.dropoff, o.schedule.date, o.schedule.deliveryDate || o.schedule.date, { order: o, puPref, delPref: dePref });
    if (r.pickup.noFit || r.delivery.noFit) bad.push('date');
    if (puPref.some((v) => !(r.pickup.windows.find((w) => w.v === v) || {}).ok)) bad.push('pickup');
    if (dePref.some((v) => !(r.delivery.windows.find((w) => w.v === v) || {}).ok)) bad.push('delivery');
  } else {
    const addr = svc.needsPickup ? o.pickup : o.dropoff;
    const r = evaluate(addr, o.schedule.date, { order: o });
    if (r.noFit) bad.push('date');
    if (puPref.some((v) => !(r.windows.find((w) => w.v === v) || {}).ok)) bad.push('time');
  }
  if (!bad.length) return [];
  const which = bad.includes('date') ? 'date' : bad.includes('pickup') && bad.includes('delivery') ? 'pickup and delivery times' : bad.includes('pickup') ? 'pickup time' : bad.includes('delivery') ? 'delivery time' : 'time';
  return [`TIME: The ${which} you picked no longer fits our route that day. Nothing has been charged. Please pick another ${which === 'date' ? 'date' : 'time'}.`];
}
// Public shape for the browser: only window values, ok and a short customer reason (never internal notes).
const publicView = (r) => r && { basis: r.fallback ? 'open' : 'route', windows: r.windows.filter((w) => !w.hidden).map((w) => ({ v: w.v, ok: w.ok, ...(w.ok ? {} : { why: w.why }) })) };

module.exports = { WINDOWS, REASONS, evaluate, pair, dateFits, pairFits, selectionErrors, publicView, parseWindow, placeTown, placeAddress, driveH, routeShape, prefList, morningOpen, stopsOn, morningUnlockStops };
