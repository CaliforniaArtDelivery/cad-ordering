/* CAD route zones: shared by the browser (window.CADZones) and the server (require).
 * Used to catch a city that does not belong to the typed ZIP before any dates are offered. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.CADZones = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const SOCAL_ZIP_MAX = 935;
  const SOCAL_ZONES = ['LA', 'OC', 'SD', 'Coachella', 'SB'];
  const macroOfZone = (z) => (z ? (SOCAL_ZONES.includes(z) ? 'SoCal' : 'NorCal') : null);
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

  const AREA_NAMES = {
  LA: 'Los Angeles', OC: 'Orange County', SD: 'San Diego', Coachella: 'Palm Springs & desert', SB: 'Santa Barbara & Ventura',
  Central: 'Central Coast & Valley', Carmel: 'Carmel & Monterey', BayWest: 'SF Bay Area', EastBay: 'East Bay',
  NapaWine: 'Napa & Sonoma', Sacramento: 'Sacramento', Tahoe: 'Lake Tahoe',
};

  const customerAreaName = (zone, macro) => AREA_NAMES[zone] || (macro === 'SoCal' ? 'Southern California' : macro === 'NorCal' ? 'Northern California' : 'Your area');

  function zip5(addr) {
    const m = String((addr && addr.zip) || '').match(/\b(\d{5})\b/);
    return m ? m[1] : null;
  }
  const normCity = (c) => ` ${String(c || '').toLowerCase().replace(/,\s*(ca|calif\.?|california)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const CITY_INDEX = Object.entries(ZONE_CITIES)
    .flatMap(([zone, names]) => names.map((n) => ({ zone, name: ` ${n} ` })))
    .sort((x, y) => y.name.length - x.name.length);
  function cityZone(city) {
    const c = normCity(city);
    if (!c.trim()) return null;
    const hit = CITY_INDEX.find(({ name }) => c.includes(name));
    return hit ? hit.zone : null;
  }
  // Zone implied by the ZIP alone (city is not used, except mixed 945/950/954 defaults).
  function zipZone(addr) {
    const zip = zip5(addr);
    if (!zip || !zip.startsWith('9')) return null;
    if (ZIP5_ZONES[zip]) return ZIP5_ZONES[zip];
    if (NAPA_945.test(zip)) return 'NapaWine';
    const p = parseInt(zip.slice(0, 3), 10);
    const macro = p <= SOCAL_ZIP_MAX ? 'SoCal' : 'NorCal';
    if (MIXED_PREFIXES[p]) return MIXED_PREFIXES[p];
    for (const [z, prefixes] of Object.entries(ZONE_ZIPS)) {
      if (prefixes.includes(p)) return z;
    }
    return macro === 'SoCal' ? 'LA' : 'BayWest';
  }
  function regionOfZone(z) { return macroOfZone(z); }
  function regionForZip(addr) {
    const zip = zip5(addr);
    if (zip && zip.startsWith('9')) return parseInt(zip.slice(0, 3), 10) <= SOCAL_ZIP_MAX ? 'SoCal' : 'NorCal';
    return macroOfZone(zipZone(addr));
  }

  // If both the city and the ZIP resolve to a zone and they disagree, the address cannot be routed.
  // Never offer dates from the ZIP alone in that case.
  function routeConflict(addr) {
    if (!addr) return null;
    const city = String(addr.city || '').trim();
    const zip = zip5(addr);
    const cz = cityZone(city);
    const zz = zipZone(addr);
    if (!city || !zip || !cz || !zz || cz === zz) return null;
    const cityArea = customerAreaName(cz, macroOfZone(cz));
    const zipArea = customerAreaName(zz, macroOfZone(zz));
    const msg = `This city and ZIP don’t match. ${city} is in the ${cityArea} area, but ZIP ${zip} is in the ${zipArea} area. Please fix the city or the ZIP so they belong together. Dates are not offered until the address is consistent.`;
    return { message: msg, city, zip, cityZone: cz, zipZone: zz, cityRegion: macroOfZone(cz), zipRegion: macroOfZone(zz) };
  }

  return {
    SOCAL_ZIP_MAX, SOCAL_ZONES, ZONE_CITIES, ZONE_ZIPS, MIXED_PREFIXES, NAPA_945, ZIP5_ZONES, AREA_NAMES,
    macroOfZone, customerAreaName, zip5, cityZone, zipZone, regionOfZone, regionForZip, routeConflict,
  };
});
