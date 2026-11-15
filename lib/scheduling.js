const config = require('../config');
const S = config.scheduling;
const DAY = 86400000;

const ymd = (d) => d.toISOString().slice(0, 10);
const utcDate = (s) => new Date(s + 'T12:00:00Z');
// Calendar math is in America/Los_Angeles so Saturday evening doesn't roll “today” into Sunday.
const ptYmd = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// Macro region: CA ZIPs 900xx–935xx => SoCal, 936xx–961xx => NorCal (used for cross-region legs).
function regionFor(addr) {
  if (!addr) return null;
  const zip = String(addr.zip || '').match(/\d{5}/) || String(addr.street || '').match(/\b9\d{4}\b/);
  if (zip) return parseInt(zip[0].slice(0, 3), 10) <= S.socalZipMax ? 'SoCal' : 'NorCal';
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

const ZONE_CITIES = {
  LA: /los angeles|\bla\b|hollywood|west hollywood|beverly|santa monica|malibu|pasadena|culver|venice|torrance|long beach|glendale|burbank|studio city|sherman oaks|encino|calabasas|pacific palisades|manhattan beach|compton|downey|inglewood|el segundo|redondo|hermosa|marina del rey|westwood|brentwood|toluca|monrovia|arcadia|alhambra|pasadena|whittier|norwalk|lakewood|san pedro|wilmington|hawthorne|gardena|carson|pomona|westlake village|thousand oaks|agoura|calabasas|woodland hills|northridge|van nuys|san fernando|la canada|flintridge|el monte|diamond bar|industry/i,
  OC: /irvine|newport|laguna|anaheim|orange|santa ana|costa mesa|huntington|fountain valley|tustin|mission viejo|lake forest|yorba|garden grove|fullerton|brea|san clemente|dana point|coto de caza|seal beach|westminster|cypress|los alamitos|aliso viejo|rancho santa margarita/i,
  SD: /san diego|la jolla|oceanside|carlsbad|del mar|encinitas|solana|coronado|chula vista|escondido|oceanside|rancho santa fe|poway|la mesa|el cajon|national city|imperial beach|cardiff|leucadia/i,
  Coachella: /palm springs|palm desert|la quinta|rancho mirage|cathedral city|indio|indian wells|desert hot springs|coachella|bermuda dunes|thousand palms/i,
  SB: /santa barbara|montecito|goleta|carpinteria|summerland|ventura|oxnard|ojai|camarillo|santa paula/i,
  Central: /san luis obispo|\bslo\b|pismo|arroyo grande|nipomo|atascadero|morro bay|paso robles|fresno|clovis|visalia|bakersfield|santa maria|lompoc|santa ynez|solvang/i,
  Carmel: /carmel|monterey|salinas|seaside|pacific grove|marina|castroville|watsonville|pebble beach|carmel valley|big sur|prunedale|gilroy/i,
  BayWest: /san francisco|\bsf\b|san jose|sunnyvale|cupertino|palo alto|mountain view|menlo park|atherton|los altos|saratoga|los gatos|santa clara|milpitas|campbell|sunnyvale|burlingame|san mateo|redwood city|foster city|belmont|san carlos|millbrae|south san francisco|daly city|pacifica|half moon|hillsborough|marin|sausalito|mill valley|san rafael|larkspur|corte madera|tiburon|belvedere|novato|ross|healdsburg|scotts valley|santa cruz/i,
  EastBay: /oakland|berkeley|alameda|emeryville|piedmont|orinda|lafayette|walnut creek|concord|pleasant hill|martinez|richmond|el cerrito|albany|hayward|fremont|union city|newark|san leandro|san lorenzo|castro valley|dublin|pleasanton|livermore|danville|alamo|san ramon|moraga/i,
  NapaWine: /napa|sonoma|st\.?\s*helena|calistoga|yountville|oakville|rutherford|petaluma|santa rosa|sebastopol|kenwood|glen ellen|sonoma|deer park|st helena/i,
  Sacramento: /sacramento|roseville|folsom|elk grove|citrus heights|rancho cordova|fair oaks|orangevale|lincoln|rocklin|el dorado|placerville|davis|woodland|west sacramento|auburn|grass valley/i,
  Tahoe: /tahoe|south lake|truckee|stateline|kings beach|tahoe city|incline/i,
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
// 945 is mixed: East Bay cities and Napa/Wine Country. Resolve by city first, then ZIP+4 lists.
const NAPA_945 = /945(08|15|58|59|62|73|74|76|81|99)/; // St Helena, Napa, Calistoga, Yountville, Deer Park, etc.
const CENTRAL_938 = [938]; // unused holder

function zip3(addr) {
  const m = String((addr && (addr.zip || addr.street)) || '').match(/\b(9\d{4})\b/);
  return m ? m[1] : null;
}

function zoneFor(addr) {
  if (!addr) return null;
  const txt = `${addr.city || ''} ${addr.street || ''}`;
  // City names first — they disambiguate mixed ZIP prefixes (945, 950, 930).
  const cityOrder = ['NapaWine', 'Tahoe', 'Carmel', 'Coachella', 'SB', 'Central', 'SD', 'OC', 'LA', 'EastBay', 'Sacramento', 'BayWest'];
  for (const z of cityOrder) {
    if (txt.trim() && ZONE_CITIES[z].test(txt)) return z;
  }
  const zip = zip3(addr);
  if (zip) {
    if (NAPA_945.test(zip)) return 'NapaWine';
    const p = parseInt(zip.slice(0, 3), 10);
    if (p === 945) return 'EastBay'; // default 945 to East Bay when the city didn't match wine country
    for (const [z, prefixes] of Object.entries(ZONE_ZIPS)) {
      if (prefixes.includes(p)) return z;
    }
  }
  // Fallback: SoCal ZIP without a zone match → LA corridor; NorCal without a match → BayWest.
  if (zip) return parseInt(zip.slice(0, 3), 10) <= S.socalZipMax ? 'LA' : 'BayWest';
  return null;
}

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
  if ((info.zones || []).includes(zone)) return true;
  return !!simpleStopFor(info, zone, order);
}

function availableDays(addrOrRegion, { from = new Date(), count = S.showDays, order, leadTime } = {}) {
  // Accept a zone name, a macro region, or an address object.
  let zone = null, macro = null;
  if (typeof addrOrRegion === 'string') {
    if (addrOrRegion === 'SoCal' || addrOrRegion === 'NorCal') macro = addrOrRegion;
    else zone = addrOrRegion;
  } else {
    zone = zoneFor(addrOrRegion);
    macro = regionFor(addrOrRegion);
  }
  const out = [];
  const lead = leadTime == null ? S.leadTimeDays : leadTime;
  let d = new Date(utcDate(ptYmd(from)).getTime() + lead * DAY);
  for (let i = 0; i < 180 && out.length < count; i++, d = new Date(d.getTime() + DAY)) {
    const iso = ymd(d);
    if (S.blackoutDates.includes(iso)) continue;
    const info = dayInfo(d);
    if (info.overflow || !(info.zones || []).length) continue;
    const stop = zone ? simpleStopFor(info, zone, order) : null;
    const zoneMatch = zone && info.zones.includes(zone);
    // Macro-only fallback (no address): that week's regular days. SoCal macro also
    // includes NorCal-week Mondays, because Monday is LA day both weeks.
    const macroMatch = !zone && macro && (
      info.weekType === macro
      || (macro === 'SoCal' && info.dow === 1 && info.zones.includes('LA'))
    );
    if (!(zoneMatch || macroMatch || stop)) continue;
    out.push({
      date: iso,
      region: info.weekType,
      weekType: info.weekType,
      zone: zone || macro,
      routeLabel: stop ? stop.label : info.label,
      shortLabel: stop ? (stop.shortLabel || stop.label) : (info.shortLabel || info.label),
      simpleStop: !!stop,
      routeType: (stop && stop.routeType) || info.routeType || 'through',
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

function rushDays(addrOrRegion, from = new Date(), windowDays = 7, order) {
  let zone = null;
  if (typeof addrOrRegion === 'string') zone = (addrOrRegion === 'SoCal' || addrOrRegion === 'NorCal') ? null : addrOrRegion;
  else zone = zoneFor(addrOrRegion);
  const out = [];
  let d = new Date(utcDate(ptYmd(from)).getTime() + DAY);
  for (let i = 0; i < windowDays; i++, d = new Date(d.getTime() + DAY)) {
    const iso = ymd(d);
    if (S.blackoutDates.includes(iso)) continue;
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
      routeLabel: 'Rush quote · off-route', shortLabel: 'Rush quote',
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

const sheetDate = (iso) => utcDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

module.exports = { regionFor, regionForDate, zoneFor, dayInfo, isRouteDay, availableDays, rushDays, sheetDate, utcDate, ptYmd, qualifiesSimpleStop, pieceCount };
