const config = require('../config');
const S = config.scheduling;
const zones = require('../public/zones');
const routePatterns = require('./route-patterns');
const businessDays = require('./business-days');
const DAY = 86400000;
// Dated 2026–27 closure only (2026-12-20 through 2027-01-01). 2027-12-20 is not auto-blocked.
function isHolidayBlackout(iso) {
  return businessDays.isHolidayClosure(iso);
}
function calendarUnavailable() {
  if (process.env.DATE_GUARD !== 'strict') return false;
  const days = require('./sheet-days');
  const snap = days.snapshot();
  if (!snap.fetchedAt) return true;
  const age = Date.now() - new Date(snap.fetchedAt).getTime();
  return !Number.isFinite(age) || age > days.DEAD_MS;
}
const isBlockedDate = (iso) => isHolidayBlackout(iso) || S.blackoutDates.includes(iso);
// A date is closed when it is a holiday/blackout date OR the live CAD schedule sheet marks it off or full (lib/sheet-days.js).
const isClosed = (iso, zone, rows) => isBlockedDate(iso) || require('./sheet-days').isClosed(iso, zone, rows);

const ymd = (d) => d.toISOString().slice(0, 10);
const utcDate = (s) => new Date(s + 'T12:00:00Z');
// Calendar math is in America/Los_Angeles so Saturday evening doesn't roll “today” into Sunday.
const ptYmd = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// Macro region: CA ZIPs 900xx–935xx => SoCal, 936xx–961xx => NorCal (used for cross-region legs).
function regionFor(addr) {
  if (!addr) return null;
  const zip = zip5(addr);
  if (zip && zip.startsWith('9')) return parseInt(zip.slice(0, 3), 10) <= S.socalZipMax ? 'SoCal' : 'NorCal';
  const zone = zoneFor(addr);
  if (['LA', 'OC', 'SD', 'Coachella', 'SB'].includes(zone)) return 'SoCal';
  if (zone) return 'NorCal';
  return null;
}

function regionForDate(date) {
  const anchor = utcDate(S.anchorWeekStart);
  const d = utcDate(ymd(date));
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - dow * DAY);
  const weeks = Math.round((monday - anchor) / (7 * DAY));
  const other = S.anchorRegion === 'SoCal' ? 'NorCal' : 'SoCal';
  return ((weeks % 2) + 2) % 2 === 0 ? S.anchorRegion : other;
}

// City names (city field only, never the street). Matched as whole words; the longest matching name wins,
// so "Marina del Rey" is LA (not Carmel's "Marina") and "Orangevale" is not "Orange".
const ZONE_CITIES = {
  LA: ['la', 'agoura', 'alhambra', 'altadena', 'arcadia', 'bel air', 'beverly', 'beverly hills', 'brentwood', 'burbank', 'calabasas', 'carson', 'compton', 'culver', 'diamond bar', 'downey', 'echo park', 'el monte', 'el segundo', 'encino', 'flintridge', 'gardena', 'glendale', 'hawthorne', 'hermosa', 'hidden hills', 'hollywood', 'industry', 'inglewood', 'la canada', 'la canada flintridge', 'lakewood', 'long beach', 'los angeles', 'los feliz', 'malibu', 'manhattan beach', 'marina del rey', 'monrovia', 'northridge', 'norwalk', 'pacific palisades', 'palos verdes estates', 'pasadena', 'playa del rey', 'playa vista', 'pomona', 'rancho palos verdes', 'redondo', 'rolling hills', 'san fernando', 'san marino', 'san pedro', 'santa monica', 'sherman oaks', 'silver lake', 'south pasadena', 'studio city', 'thousand oaks', 'toluca', 'topanga', 'torrance', 'van nuys', 'venice', 'west hollywood', 'west los angeles', 'westlake village', 'westwood', 'whittier', 'wilmington', 'woodland hills'],
  OC: ['aliso viejo', 'anaheim', 'brea', 'corona del mar', 'costa mesa', 'coto de caza', 'cypress', 'dana point', 'fountain valley', 'fullerton', 'garden grove', 'huntington', 'huntington beach', 'irvine', 'laguna', 'laguna beach', 'laguna hills', 'laguna niguel', 'laguna woods', 'lake forest', 'los alamitos', 'mission viejo', 'newport', 'newport beach', 'newport coast', 'orange', 'rancho santa margarita', 'san clemente', 'santa ana', 'seal beach', 'tustin', 'westminster', 'yorba', 'yorba linda'],
  SD: ['cardiff', 'carlsbad', 'chula vista', 'coronado', 'del mar', 'el cajon', 'encinitas', 'escondido', 'imperial beach', 'la jolla', 'la mesa', 'leucadia', 'national city', 'oceanside', 'poway', 'rancho santa fe', 'san diego', 'solana'],
  Coachella: ['bermuda dunes', 'cathedral city', 'coachella', 'desert hot springs', 'indian wells', 'indio', 'la quinta', 'palm desert', 'palm springs', 'rancho mirage', 'thousand palms'],
  SB: ['camarillo', 'carpinteria', 'goleta', 'montecito', 'ojai', 'oxnard', 'santa barbara', 'santa paula', 'summerland', 'ventura'],
  Central: ['arroyo grande', 'atascadero', 'bakersfield', 'clovis', 'fresno', 'lompoc', 'morro bay', 'nipomo', 'paso robles', 'pismo', 'san luis obispo', 'santa maria', 'santa ynez', 'slo', 'solvang', 'visalia'],
  Carmel: ['big sur', 'carmel', 'carmel by the sea', 'carmel highlands', 'carmel valley', 'castroville', 'del rey oaks', 'gilroy', 'marina', 'monterey', 'pacific grove', 'pebble beach', 'prunedale', 'salinas', 'sand city', 'seaside', 'watsonville'],
  SantaCruz: ['aptos', 'ben lomond', 'boulder creek', 'capitola', 'felton', 'santa cruz', 'scotts valley', 'soquel'],
  BayWest: ['atherton', 'belmont', 'belvedere', 'bolinas', 'brisbane', 'burlingame', 'campbell', 'corte madera', 'cupertino', 'daly city', 'east palo alto', 'fairfax', 'foster city', 'greenbrae', 'half moon bay', 'healdsburg', 'hillsborough', 'kentfield', 'larkspur', 'los altos', 'los altos hills', 'los gatos', 'marin', 'menlo park', 'mill valley', 'millbrae', 'milpitas', 'mountain view', 'novato', 'pacifica', 'palo alto', 'portola valley', 'redwood city', 'ross', 'san anselmo', 'san bruno', 'san carlos', 'san francisco', 'san jose', 'san mateo', 'san rafael', 'santa clara', 'saratoga', 'sausalito', 'sf', 'south san francisco', 'stinson beach', 'sunnyvale', 'tiburon', 'woodside'],
  EastBay: ['alameda', 'alamo', 'albany', 'berkeley', 'castro valley', 'concord', 'danville', 'dublin', 'el cerrito', 'emeryville', 'fremont', 'hayward', 'lafayette', 'livermore', 'martinez', 'moraga', 'newark', 'oakland', 'orinda', 'piedmont', 'pleasant hill', 'pleasanton', 'richmond', 'san leandro', 'san lorenzo', 'san ramon', 'union city', 'walnut creek'],
  NapaWine: ['calistoga', 'deer park', 'glen ellen', 'kenwood', 'napa', 'oakville', 'petaluma', 'rutherford', 'saint helena', 'santa rosa', 'sebastopol', 'sonoma', 'st helena', 'yountville'],
  Sacramento: ['auburn', 'citrus heights', 'davis', 'el dorado', 'elk grove', 'fair oaks', 'folsom', 'grass valley', 'lincoln', 'orangevale', 'placerville', 'rancho cordova', 'rocklin', 'roseville', 'sacramento', 'west sacramento', 'woodland'],
  Tahoe: ['lake tahoe', 'carnelian bay', 'homewood', 'kings beach', 'olympic valley', 'south lake tahoe', 'tahoe city', 'tahoe vista', 'tahoma', 'truckee'],
};

// 3-digit ZIP prefixes (and a few specific 5-digit wine-country ZIPs that sit in the 945 prefix).
const ZONE_ZIPS = {
  LA: [900, 901, 902, 903, 904, 905, 906, 907, 908, 910, 911, 912, 913, 914, 915, 916, 917, 918],
  OC: [926, 927, 928],
  SD: [919, 920, 921],
  Coachella: [922],
  SB: [930, 931],
  Central: [932, 933, 934, 936, 937],
  Carmel: [939],
  BayWest: [940, 941, 943, 944, 949, 950, 951],
  EastBay: [946, 947, 948],
  Sacramento: [956, 957, 958, 959],
  Tahoe: [961],
};
// Some 3-digit prefixes cover more than one route zone. Only for these does the city name refine the ZIP.
// 945: East Bay vs Napa / Wine Country. 950: Silicon Valley / Santa Cruz vs Gilroy / Watsonville (Carmel days).
// 954: Sonoma / Wine Country vs Healdsburg (Wednesday SF / Marin route).
const MIXED_PREFIXES = { 945: 'EastBay', 950: 'BayWest', 954: 'NapaWine' };
const NAPA_945 = /^945(08|15|58|59|62|73|74|76|81|99)$/; // St Helena, Napa, Calistoga, Yountville, Deer Park, etc.
const ZIP5_ZONES = require('../public/zones').ZIP5_ZONES; // Gilroy, Watsonville, Healdsburg, Santa Cruz area (one copy, shared with the browser)
const SOCAL_ZONES = ['LA', 'OC', 'SD', 'Coachella', 'SB'];
const macroOfZone = (z) => (z ? (SOCAL_ZONES.includes(z) ? 'SoCal' : 'NorCal') : null);

function zip5(addr) {
  const m = String((addr && addr.zip) || '').match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}
const zip3 = (addr) => { const z = zip5(addr); return z && z.startsWith('9') ? z : null; };

const normCity = (c) => ` ${String(c || '').toLowerCase().replace(/,\s*(ca|calif\.?|california)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const CITY_INDEX = Object.entries(ZONE_CITIES)
  .flatMap(([zone, names]) => names.map((n) => ({ zone, name: ` ${n} ` })))
  .sort((x, y) => y.name.length - x.name.length);
// City field only (never the street). Longest whole-word match wins.
function cityZone(city) {
  const c = normCity(city);
  if (!c.trim()) return null;
  const hit = CITY_INDEX.find(({ name }) => c.includes(name));
  return hit ? hit.zone : null;
}

// ZIP first. The city refines the ZIP only inside a mixed prefix, and only when it agrees with the ZIP's region.
// No ZIP: city name only. The street is never used, so "Laguna St", "Marina Blvd", "Lincoln Ave" can't move a job.
function zoneFor(addr) {
  if (!addr) return null;
  const zip = zip3(addr);
  if (zip) {
    if (ZIP5_ZONES[zip]) return ZIP5_ZONES[zip];
    if (NAPA_945.test(zip)) return 'NapaWine';
    const p = parseInt(zip.slice(0, 3), 10);
    const macro = p <= S.socalZipMax ? 'SoCal' : 'NorCal';
    if (MIXED_PREFIXES[p]) {
      const cz = cityZone(addr.city);
      return cz && macroOfZone(cz) === macro ? cz : MIXED_PREFIXES[p];
    }
    for (const [z, prefixes] of Object.entries(ZONE_ZIPS)) {
      if (prefixes.includes(p)) return z;
    }
    // ZIP without a mapped prefix: the city can still place it (same region only), else the region's default corridor.
    const cz = cityZone(addr.city);
    if (cz && macroOfZone(cz) === macro) return cz;
    return macro === 'SoCal' ? 'LA' : 'BayWest';
  }
  return cityZone(addr.city);
}

// Customer-facing area names (never the van's internal direction, hub or "simple stop" notes).
const AREA_NAMES = {
  LA: 'Los Angeles', OC: 'Orange County', SD: 'San Diego', Coachella: 'Palm Springs & desert', SB: 'Santa Barbara & Ventura',
  Central: 'Central Coast & Valley', Carmel: 'Carmel & Monterey', BayWest: 'SF Bay Area', EastBay: 'East Bay',
  NapaWine: 'Napa & Sonoma', Sacramento: 'Sacramento', Tahoe: 'Lake Tahoe', SantaCruz: 'Santa Cruz',
};
const customerAreaName = (zone, macro) => AREA_NAMES[zone] || (macro === 'SoCal' ? 'Southern California' : macro === 'NorCal' ? 'Northern California' : 'Your area');
const customerRouteLabel = (zone, macro) => `${customerAreaName(zone, macro)} route day`;

function dayInfo(date) {
  const weekType = regionForDate(date);
  const dow = utcDate(ymd(date)).getUTCDay();
  const entry = (S.dayCatalog[weekType] || {})[dow] || { zones: [], label: weekType };
  return { weekType, dow, ...entry, region: weekType };
}

function pieceCount(items) {
  return (Array.isArray(items) ? items : []).reduce((n, it) => n + Math.max(1, parseInt(it.qty, 10) || 1), 0);
}

function isStandardItem(it) {
  const type = it.type || 'painting';
  const dims = [it.w, it.h, it.d].map(Number).filter(Boolean);
  const maxSide = dims.length ? Math.max(...dims) : 0;
  const p = config.pricing;
  if (type === 'sculpture' && Number(it.weight) > 700) return false;
  if (['painting', 'photograph', 'mirror', 'wallart'].includes(type) && maxSide >= p.largePainting.overInches) return false;
  if (type === 'other' && (Number(it.weight) > 150 || maxSide >= 72)) return false;
  if ((type === 'furniture' || type === 'decor') && (it.furnitureKind === 'Wall Decor' || it.furnitureKind === 'Wall Décor') && maxSide >= p.largeWallDecor.overInches) return false;
  return true;
}

// Simple OC Monday stops are allowed only for 1–2 standard items (not 3+).
function qualifiesSimpleStop(order, maxItems = (S.simpleOcMonday && S.simpleOcMonday.maxStandardItems) || 2) {
  const items = (order && order.items) || [];
  const count = pieceCount(items);
  if (count < 1 || count > maxItems) return false;
  return items.every(isStandardItem);
}

function simpleStopFor(info, zone, order) {
  if (!(S.simpleOcMonday && S.simpleOcMonday.autoOffer)) return null; // Samantha: Monday OC is never offered automatically (team review)
  const stops = info.simpleStops || [];
  const stop = stops.find((s) => s.zone === zone);
  if (!stop) return null;
  const max = stop.maxStandardItems || (S.simpleOcMonday && S.simpleOcMonday.maxStandardItems) || 2;
  if (!qualifiesSimpleStop(order, max)) return null;
  return stop;
}

function isRouteDay(date, zone, order) {
  if (!zone) return false;
  const info = dayInfo(date);
  if (info.overflow) return false; // SoCal Fri–Sun overflow is not a regular bookable day
  if (catalogServesZone(info, zone)) return true;
  return !!simpleStopFor(info, zone, order);
}

function catalogServesZone(info, zone) {
  if (!info || !zone) return false;
  if ((info.zones || []).includes(zone)) return true;
  if ((info.conditionalZones || []).includes(zone)) return true;
  return false;
}

/* ---------------------------------------------------------------------------------------------------------------------------
 * ONE eligibility check (Dot, CAD-ROUTE-REGIONS-001): date lists, pickup/delivery pairing and the checkout re-check (main flow and
 * Paloma's) all come through routeEligibility(). Dates come ONLY from the live CAD SCHEDULE (SCHEDULE 2026 column E via the Apps
 * Script `days` digest, plus the ROUTE CALENDAR tab when present). The weekly catalog and old exports never open a date.
 *  - Stale or missing live data            => no dates (fail closed).
 *  - Route texts on one date that disagree  => that date is hidden. A ROUTE CALENDAR can block a date or an area, never widen one.
 *  - "late", "if quick", "only if"         => never offered. San Jose as a start / end hub is offered only when the sheet already
 *                                             has San Jose stops that date.
 *  - "OR" branches (Sunday)                => hidden until the sheet records the chosen branch (a route row without OR that matches
 *                                             one branch).
 *  - "en route" (Thursday East Bay)         => Chad t2096u: East Bay cities on the drive up are offered, capped per date
 *                                             (config.scheduling.enRoute) and only in mid-morning to midday windows.
 * ------------------------------------------------------------------------------------------------------------------------ */
const ROUTE_ZONES = (p) => new Set([...(p.primaryZones || []), ...(p.conditionalZones || []), ...(p.hubZones || [])]);
const intersects = (a, b) => [...a].some((x) => b.has(x));
const townIs = (town, re) => re.test(String(town || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]+/g, ' ').trim());
const EN = () => S.enRoute || { zones: [], maxStopsPerDay: 0, windows: [] };

let lastStaleWarn = 0;
function liveFresh() {
  const age = require('./sheet-days').ageMs();
  const max = S.liveScheduleMaxAgeMs || 6 * 60 * 60 * 1000, warn = S.liveScheduleWarnAgeMs || 30 * 60 * 1000;
  if (age > warn && Date.now() - lastStaleWarn > 10 * 60 * 1000) {
    lastStaleWarn = Date.now();
    const mins = Number.isFinite(age) ? Math.round(age / 60000) + ' min' : 'never synced';
    console.warn(`[schedule] WARNING: live CAD SCHEDULE data is stale (${mins} old; warn after ${Math.round(warn / 60000)} min). ` +
      (age > max ? `Route dates are HIDDEN until the sheet syncs (limit ${Math.round(max / 60000)} min).` : `Dates still shown until ${Math.round(max / 60000)} min.`));
  }
  return age <= max;
}

// Central branch of an address: 'valley' (Fresno, Clovis, Visalia, Bakersfield) or 'coast' (SLO, Pismo, Santa Maria ...).
function centralSubOf(addr) {
  if (!addr) return null;
  const z = zip5(addr);
  if (z) { const p = parseInt(z.slice(0, 3), 10); if ([932, 933, 936, 937].includes(p)) return 'valley'; if (p === 934) return 'coast'; }
  const c = String(addr.city || '');
  if (routePatterns.CENTRAL_VALLEY_RE.test(c)) return 'valley';
  if (routePatterns.CENTRAL_COAST_RE.test(c)) return 'coast';
  return null;
}

// The day's route from the live sheet: merged parse of every route text on that date, or { ok:false, reason }.
function liveRoute(iso) {
  if (!liveFresh()) return { ok: false, reason: 'stale' };
  const d = require('./sheet-days').days()[iso];
  if (!d) return { ok: false, reason: 'not on the sheet' };
  if (d.off) return { ok: false, reason: 'off' };
  if (d.calendar && !d.open) return { ok: false, reason: 'calendar closed' };
  const parses = (d.routes || []).map(routePatterns.parseRouteText).filter((p) => p.ok && ROUTE_ZONES(p).size);
  if (!parses.length) return { ok: false, reason: 'no route on the sheet' };
  const orTexts = parses.filter((p) => p.orBranches);
  let use = parses.filter((p) => !p.orBranches);
  if (orTexts.length) {
    // The sheet records the chosen branch as a route row without OR that matches exactly one branch (e.g. "Fresno → Santa Barbara").
    if (!use.length) return { ok: false, reason: 'branch not chosen', branchPending: true };
    const prim = new Set(use.flatMap((p) => p.primaryZones));
    const subs = new Set(use.map((p) => p.centralSub).filter(Boolean));
    const sub = subs.size === 1 ? [...subs][0] : null;
    const fits = (b) => [...prim].every((z) => b.primaryZones.includes(z)) && (!prim.has('Central') || (sub && b.centralSub === sub));
    if (!orTexts.every((p) => p.branchParses.filter(fits).length === 1)) return { ok: false, reason: 'route rows disagree (branch)' };
  }
  // Two route rows that share no primary area describe different days: hide the date until the sheet is fixed.
  for (let i = 0; i < use.length; i++) for (let j = i + 1; j < use.length; j++) {
    const a = new Set(use[i].primaryZones), b = new Set(use[j].primaryZones);
    if (a.size && b.size && !intersects(a, b)) return { ok: false, reason: 'route rows disagree' };
  }
  const merged = { ok: true, primaryZones: [], conditionalZones: [], enRouteZones: [], hubZones: [], hubs: [], labels: [], texts: use.map((p) => p.text), centralSub: null };
  const add = (arr, xs) => xs.forEach((x) => { if (!arr.includes(x)) arr.push(x); });
  for (const p of use) {
    add(merged.primaryZones, p.primaryZones); add(merged.conditionalZones, p.conditionalZones); add(merged.enRouteZones, p.enRouteZones);
    add(merged.hubZones, p.hubZones); add(merged.hubs, p.hubs); if (p.label) add(merged.labels, [p.label]);
    if (p.centralSub) merged.centralSub = merged.centralSub && merged.centralSub !== p.centralSub ? 'mixed' : p.centralSub;
  }
  // A calendar may block, never widen: when it lists areas that share nothing with the route text, the sources disagree.
  if (d.calendar && Array.isArray(d.zones) && d.zones.length && !intersects(new Set(d.zones), ROUTE_ZONES(merged))) return { ok: false, reason: 'calendar and route text disagree' };
  merged.calendarZones = d.calendar && Array.isArray(d.zones) && d.zones.length ? d.zones.slice() : null;
  merged.label = merged.labels.length === 1 ? merged.labels[0] : merged.labels.join(' · ');
  merged.stops = Array.isArray(d.stops) ? d.stops : [];
  return merged;
}

// ---------- en-route stops (config.scheduling.enRoute.rules; Chad t2096u, t2098u) ----------
const EN_RULES = () => (EN().rules || []);
const ruleById = (id) => EN_RULES().find((r) => r.id === id) || null;
function ruleMatchesPlace(rule, addr) {
  if (!addr) return false;
  const c = normCity(addr.city).trim();
  if ((rule.offRouteCities || []).includes(c)) return false;
  const z = zip5(addr);
  if (rule.zips && z && rule.zips.includes(z)) return true;
  if (rule.cities && rule.cities.includes(c)) return true;
  const zone = zoneFor(addr);
  return !!(rule.zones && zone && rule.zones.includes(zone));
}
// Which en-route rule (if any) makes this address a stop on the way on that date. Never applies to an address that is a regular stop.
function enRouteRuleFor(addr, iso, route) {
  route = route || liveRoute(iso);
  if (!route.ok || !addr) return null;
  const zone = zoneFor(addr);
  const role = routePatterns.roleFor(route, zone, addr);
  if (role === 'primary') return null;
  const dow = utcDate(iso).getUTCDay();
  for (const rule of EN_RULES()) {
    if (!ruleMatchesPlace(rule, addr)) continue;
    if (rule.fromRouteText) { if (role === 'enroute') return rule; continue; }
    if (rule.dow != null && rule.dow !== dow) continue;
    if ((rule.routePrimary || []).some((z) => !route.primaryZones.includes(z))) continue;
    if (rule.zones && rule.zones.some((z) => route.primaryZones.includes(z))) continue; // already a regular stop area that day
    return rule;
  }
  return null;
}
// En-route stops already on a date for one rule: sheet stops in its area + online bookings since the last refresh + live holds.
function enRouteUsed(iso, exceptOrderId, rule) {
  const d = require('./sheet-days').days()[iso] || {};
  const onSheet = rule ? (Array.isArray(d.stops) ? d.stops : []).filter((st) => ruleMatchesPlace(rule, { city: st.town })).length : 0;
  return onSheet + Number(d.enRouteSinceRefresh || 0) + require('./holds').heldTag('enroute', iso, exceptOrderId);
}
function enRouteLeft(iso, exceptOrderId, rule) {
  if (!rule) { const r = liveRoute(iso); rule = EN_RULES().find((x) => r.ok && (x.fromRouteText ? (r.enRouteZones || []).length : (x.dow == null || x.dow === utcDate(iso).getUTCDay()))) || null; }
  return Math.max(0, Number(EN().maxStopsPerDay || 0) - enRouteUsed(iso, exceptOrderId, rule));
}
// A quick stop (Wednesday evening East Bay): 1-2 standard pieces, no install.
function isQuickStopOrder(order) {
  if (!order) return false;
  const svc = require('./pricing').SERVICES[order.service] || {};
  if (svc.install) return false;
  return qualifiesSimpleStop(order, 2);
}

/**
 * routeEligibility(addrOrZone, iso, order, opts) -> { ok, role, label, reason, route }
 * opts.routeOnly: skip capacity and time-window checks (used inside pairing, which runs those checks on the resulting lists).
 * opts.exceptOrderId: ignore this order's own hold when counting the en-route cap.
 */
function routeEligibility(addrOrZone, iso, order, opts = {}) {
  const addr = addrOrZone && typeof addrOrZone === 'object' ? addrOrZone : null;
  const zone = addr ? zoneFor(addr) : addrOrZone;
  if (!zone) return { ok: false, reason: 'no area' };
  if (isBlockedDate(iso)) return { ok: false, reason: 'holiday or blackout' };
  const route = liveRoute(iso);
  if (!route.ok) return { ok: false, reason: route.reason, branchPending: !!route.branchPending };
  if (route.calendarZones && !route.calendarZones.includes(zone)) return { ok: false, reason: 'calendar does not list this area', route };
  let role = routePatterns.roleFor(route, zone, addr);
  if (!role && order && S.simpleOcMonday && S.simpleOcMonday.autoOffer && route.primaryZones.includes('LA') && simpleStopFor(dayInfo(utcDate(iso)), zone, order)) role = 'primary';
  if (role === 'primary' && zone === 'Central' && route.centralSub && route.centralSub !== 'mixed') {
    const mine = centralSubOf(addr);
    if (!mine || mine !== route.centralSub) return { ok: false, reason: 'other Central branch', route };
  }
  // San Jose as a loop bookend only counts when the sheet already has customer stops in San Jose that date (Dot #4); otherwise it
  // can still be an en-route stop (e.g. South San Jose on the Saturday Carmel run) or nothing.
  let rule = null;
  if (role !== 'primary' && !(role === 'hub' && route.stops.some((st) => townIs(st.town, /^san jose$/)))) {
    rule = addr ? enRouteRuleFor(addr, iso, route) : null;
    if (rule) role = 'enroute';
    else if (role === 'enroute') return { ok: false, reason: 'not on the en-route corridor', route };
    else if (role === 'hub') return { ok: false, reason: 'hub only (no San Jose stops that day)', route };
  }
  if (role === 'enroute') {
    if (rule.quickStopOnly && order && !isQuickStopOrder(order)) return { ok: false, reason: 'quick stops only (1-2 standard pieces, no install)', route, role };
    if (!opts.routeOnly && enRouteLeft(iso, opts.exceptOrderId, rule) < 1) return { ok: false, reason: 'en-route stops full', route, role };
  }
  if (!['primary', 'hub', 'enroute'].includes(role)) return { ok: false, reason: role ? `${role} only` : 'not on this route', route, role };
  if (!opts.routeOnly) {
    if (isClosed(iso, zone)) return { ok: false, reason: require('./sheet-days').reason(iso, zone, 1) || 'closed', route, role };
    // Route-aware time windows (lib/route-windows.js): a date where no arrival window fits is not offered.
    if (addr && !require('./route-windows').dateFits(addr, iso, order)) return { ok: false, reason: 'no arrival window fits', route, role };
  }
  return { ok: true, role, label: (rule && rule.label) || route.label, route, rule, quickStop: !!(rule && rule.lastResort) };
}
// For lib/route-windows (time windows) and lib/sheet-days / holds (cap counting): the en-route rule for this address on that date.
function isEnRouteStop(addr, iso) { return enRouteRuleFor(addr, iso); }
// Route legs of an order as [iso, address] pairs (dedicated sides run on their own van and are left out).
function orderLegs(order) {
  if (!order || !order.schedule || !order.schedule.date) return [];
  const svc = require('./pricing').SERVICES[order.service] || {};
  if (svc.shipping) return [];
  const ded = require('./dedicated-fee').sides(order);
  const out = [];
  if (svc.needsPickup) { if (!ded.pickup) out.push([order.schedule.date, order.pickup]); if (svc.needsDropoff && !ded.delivery) out.push([order.schedule.deliveryDate || order.schedule.date, order.dropoff]); }
  else if (!ded.delivery) out.push([order.schedule.date, order.dropoff]);
  return out;
}

// quickStops: 'auto' (default) lists last-resort quick stops (Wednesday evening East Bay) only when the address has no other route
// date at all; 'all' lists them too (later-date browsing, and the checkout re-check so a shown quick stop can still be booked).
function availableDays(addrOrRegion, { from = new Date(), count = S.showDays, order, leadTime, quickStops = 'auto' } = {}) {
  if (calendarUnavailable() || !liveFresh()) return [];
  // Accept a zone name, a macro region, or an address object.
  let zone = null, macro = null, addr = null;
  if (typeof addrOrRegion === 'string') {
    if (addrOrRegion === 'SoCal' || addrOrRegion === 'NorCal') macro = addrOrRegion;
    else zone = addrOrRegion;
  } else if (addrOrRegion) {
    addr = addrOrRegion;
    zone = zoneFor(addrOrRegion);
    macro = regionFor(addrOrRegion);
  }
  const out = [];
  const lead = leadTime == null ? S.leadTimeDays : leadTime;
  const start = utcDate(ymd(new Date(utcDate(ptYmd(from)).getTime() + lead * DAY)));
  let d = new Date(start.getTime());
  const regular = () => out.filter((x) => !x.quickStop).length;
  for (let i = 0; i < 180 && regular() < count && (quickStops === 'all' ? out.length < count : true); i++, d = new Date(d.getTime() + DAY)) {
    const iso = ymd(d);
    if (isBlockedDate(iso)) continue;
    const info = dayInfo(d);
    let e;
    if (zone) e = routeEligibility(addr || zone, iso, order);
    else {
      // Macro listing (no address): dates whose live route has a regular stop in that half of the state.
      const route = liveRoute(iso);
      e = route.ok && route.primaryZones.some((z) => macroOfZone(z) === macro) ? { ok: true, role: 'primary', label: route.label, route } : { ok: false };
    }
    if (!e.ok) continue;
    const short = e.label || customerAreaName(zone, macro || info.weekType);
    out.push({
      date: iso,
      region: info.weekType,
      weekType: info.weekType,
      zone: zone || macro,
      routeLabel: `${short} route day`,
      shortLabel: short,
      opsLabel: (e.route && e.route.texts && e.route.texts[0]) || info.label,
      simpleStop: false,
      routeType: info.routeType || 'through',
      role: e.role,
      enRoute: e.role === 'enroute',
      quickStop: !!e.quickStop,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  if (quickStops !== 'all' && regular()) return out.filter((x) => !x.quickStop).slice(0, count);
  return out.slice(0, count);
}

function rushDays(addrOrRegion, from = new Date(), windowDays = 7, order) {
  let zone = null;
  if (typeof addrOrRegion === 'string') zone = (addrOrRegion === 'SoCal' || addrOrRegion === 'NorCal') ? null : addrOrRegion;
  else zone = zoneFor(addrOrRegion);
  const out = [];
  let d = new Date(utcDate(ptYmd(from)).getTime() + DAY);
  for (let i = 0; i < windowDays; i++, d = new Date(d.getTime() + DAY)) {
    const iso = ymd(d);
    if (isClosed(iso)) continue;
    const info = dayInfo(d);
    // Already a regular route day, or a qualifying simple OC Monday stop.
    if (zone && !info.overflow && ((info.zones && info.zones.includes(zone)) || simpleStopFor(info, zone, order))) continue;
    // Offer weekdays as rush-quote candidates (weekends can be requested as dedicated).
    if (![1, 2, 3, 4, 5].includes(d.getUTCDay())) continue;
    out.push({
      date: iso,
      region: info.weekType,
      weekType: info.weekType,
      rush: true,
      routeLabel: 'Rush request', shortLabel: 'Rush quote', opsLabel: 'Rush quote · off-route',
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

const sheetDate = (iso) => utcDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function weekMonday(iso) {
  const d = utcDate(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return ymd(new Date(d.getTime() - dow * DAY));
}
// Prefer the live sheet's zone list / route text for a date; fall back to the weekly catalog.
// GAP: in legacy mode with no calendar data, capacityLeft is Infinity (no live cap to honor). Route order
// then comes from the catalog zone list, not the day's actual column-E text.
function zonesOnDate(iso, order) {
  const d = require('./sheet-days').days()[iso];
  if (d && Array.isArray(d.zones) && d.zones.length) return { zones: d.zones.slice(), source: 'live' };
  if (d && d.routes && d.routes.length) {
    const set = require('./sheet-days').classify(d.routes);
    if (set.size) return { zones: [...set], source: 'live-text' };
  }
  const info = dayInfo(utcDate(iso));
  const zs = (info.zones || []).slice();
  
  return { zones: zs, source: 'catalog' };
}
// Served = the same eligibility check, minus capacity and time windows (those run on the resulting date lists and at checkout).
function isServedOnDate(iso, zoneOrAddr, order) {
  if (!zoneOrAddr || isBlockedDate(iso)) return false;
  return routeEligibility(zoneOrAddr, iso, order, { routeOnly: true }).ok;
}
// Pickup must come before delivery in the actual route order. Same-day is allowed only when the pickup
// zone is at or before the delivery zone on that day's ordered zone list.
function pickupBeforeDelivery(puIso, delIso, pickup, dropoff, order) {
  if (!puIso || !delIso || delIso < puIso) return false;
  const puZ = zoneFor(pickup), deZ = zoneFor(dropoff);
  if (!puZ || !deZ) return false;
  if (!isServedOnDate(puIso, pickup, order)) return false;
  if (vanAlreadyPassedDelivery(puIso, dropoff, order)) return false;
  if (delIso > puIso) return isServedOnDate(delIso, dropoff, order);
  if (!isServedOnDate(puIso, dropoff, order)) return false;
  // Two en-route stops on one date need two free en-route slots.
  const rp = isEnRouteStop(pickup, puIso), rd = isEnRouteStop(dropoff, puIso);
  if (rp && rd && rp === rd && enRouteLeft(puIso, order && order.id, rp) < 2) return false;
  // Same day = one booking: pickup first, with time to drive to the delivery, inside the day's planned route (lib/route-windows.js).
  if (!require('./route-windows').pairFits(pickup, dropoff, puIso, delIso, order)) return false;
  if (puZ === deZ) return true;
  // Stops on the way out (Thursday drive-up, Saturday south-bound) come before the regular stops; the Wednesday quick stop comes after.
  if (rp && !rd) return !rp.lastResort;
  if (rd && !rp) return !!rd.lastResort;
  const { zones } = zonesOnDate(puIso, order);
  const i = zones.indexOf(puZ), j = zones.indexOf(deZ);
  if (i >= 0 && j >= 0) return i <= j;
  return false;
}
// True when the van already served the delivery area earlier in this same week, and will not return to it again this week.
// Example: Saturday Carmel (after Friday East Bay) is not paired with an Emeryville delivery — that delivery waits until the next East Bay day, so we offer a Tuesday Carmel pickup instead.
function vanAlreadyPassedDelivery(puIso, dropoff, order) {
  if (!puIso || !dropoff) return false;
  const mon = weekMonday(puIso);
  let before = false, onOrAfter = false;
  for (let i = 0; i < 7; i++) {
    const iso = ymd(new Date(utcDate(mon).getTime() + i * DAY));
    if (isBlockedDate(iso)) continue;
    if (!isServedOnDate(iso, dropoff, order)) continue;
    if (iso < puIso) before = true;
    else onOrAfter = true;
  }
  return before && !onOrAfter;
}
function availableDeliveryDays(dropoff, pickup, puIso, order, count, opts = {}) {
  const days = availableDays(dropoff, { from: new Date(puIso + 'T12:00:00Z'), leadTime: 0, count: count || S.showDays, order, quickStops: opts.quickStops });
  return days.filter((d) => pickupBeforeDelivery(puIso, d.date, pickup, dropoff, order));
}
function canPairPickupDelivery(puIso, pickup, dropoff, order) {
  if (zones.routeConflict(pickup) || zones.routeConflict(dropoff)) return false;
  const puZ = zoneFor(pickup), deZ = zoneFor(dropoff);
  if (!puZ || !deZ) return false;
  if (isBlockedDate(puIso) || !isServedOnDate(puIso, pickup, order)) return false;
  if (vanAlreadyPassedDelivery(puIso, dropoff, order)) return false;
  return availableDeliveryDays(dropoff, pickup, puIso, order, 16).length > 0;
}
function availablePickupDays(pickup, dropoff, opts = {}) {
  const days = availableDays(pickup, opts);
  if (!dropoff) return days;
  return days.filter((d) => canPairPickupDelivery(d.date, pickup, dropoff, opts.order));
}

module.exports = { isClosed, isHolidayBlackout, isBlockedDate, customerAreaName, customerRouteLabel, cityZone, regionFor, regionForDate, zoneFor, dayInfo, isRouteDay, availableDays, availableDeliveryDays, availablePickupDays, canPairPickupDelivery, vanAlreadyPassedDelivery, pickupBeforeDelivery, isServedOnDate, zonesOnDate, calendarUnavailable, rushDays, sheetDate, utcDate, ptYmd, qualifiesSimpleStop, pieceCount, routeConflict: zones.routeConflict, parseRouteText: routePatterns.parseRouteText, roleFor: routePatterns.roleFor, isSanJose: routePatterns.isSanJose, routeEligibility, liveRoute, liveFresh, isEnRouteStop, enRouteRuleFor, enRouteLeft, enRouteUsed, isQuickStopOrder, orderLegs, centralSubOf };
