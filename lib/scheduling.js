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
  BayWest: ['aptos', 'atherton', 'belmont', 'belvedere', 'bolinas', 'brisbane', 'burlingame', 'campbell', 'capitola', 'corte madera', 'cupertino', 'daly city', 'east palo alto', 'fairfax', 'foster city', 'greenbrae', 'half moon bay', 'healdsburg', 'hillsborough', 'kentfield', 'larkspur', 'los altos', 'los altos hills', 'los gatos', 'marin', 'menlo park', 'mill valley', 'millbrae', 'milpitas', 'mountain view', 'novato', 'pacifica', 'palo alto', 'portola valley', 'redwood city', 'ross', 'san anselmo', 'san bruno', 'san carlos', 'san francisco', 'san jose', 'san mateo', 'san rafael', 'santa clara', 'santa cruz', 'saratoga', 'sausalito', 'scotts valley', 'sf', 'soquel', 'south san francisco', 'stinson beach', 'sunnyvale', 'tiburon', 'woodside'],
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
const ZIP5_ZONES = { 95020: 'Carmel', 95021: 'Carmel', 95076: 'Carmel', 95077: 'Carmel', 95448: 'BayWest' }; // Gilroy, Watsonville, Healdsburg
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
  NapaWine: 'Napa & Sonoma', Sacramento: 'Sacramento', Tahoe: 'Lake Tahoe',
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
      // Customers see the area they booked for; the ops route description stays in opsLabel (schedule sheet, admin).
      routeLabel: customerRouteLabel(zone, macro || info.weekType),
      shortLabel: customerAreaName(zone, macro || info.weekType),
      opsLabel: stop ? stop.label : info.label,
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
      routeLabel: 'Rush request', shortLabel: 'Rush quote', opsLabel: 'Rush quote · off-route',
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
}

const sheetDate = (iso) => utcDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

module.exports = { customerAreaName, customerRouteLabel, cityZone, regionFor, regionForDate, zoneFor, dayInfo, isRouteDay, availableDays, rushDays, sheetDate, utcDate, ptYmd, qualifiesSimpleStop, pieceCount };
