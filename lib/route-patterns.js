/**
 * CAD SCHEDULE route text → primary vs conditional areas, and a short customer-facing day label.
 *
 * The SCHEDULE 2026 “Route” column (and the catalog label that mirrors it) is the source of truth.
 * Parenthetical / “if quick” / “late” / “only if” / “en route” segments are conditional fallbacks,
 * not regular stops. “OR” marks alternative branches of the same day.
 *
 * Day labels are derived from the primary segments of that day's route, so two different
 * routes never share a generic name like “SF Bay Area”.
 */
const COND_CUE = /if quick|only if|if needed|if clients can.?t|if it fits|very late|\blate\b|en route|overflow|farther out|then toward|then on to|or on to/i;

// Longer phrases first. `hub` = named start/end (San Jose) stays primary even when the rest of the zone is conditional.
const PHRASES = [
  { re: /silicon valley/i, zones: ['BayWest'], name: 'Peninsula', id: 'sv' },
  { re: /peninsula/i, zones: ['BayWest'], name: 'Peninsula', id: 'sv' },
  { re: /cupertino|palo alto/i, zones: ['BayWest'], name: 'Peninsula', id: 'sv' },
  { re: /\bsf\b|san francisco/i, zones: ['BayWest'], name: 'SF', id: 'sf' },
  { re: /marin county|\bmarin\b/i, zones: ['BayWest'], name: 'Marin', id: 'marin' },
  { re: /healdsburg/i, zones: ['BayWest'], name: 'Marin', id: 'healdsburg' }, // same northbound run as Marin; folded in the short label
  { re: /san jose/i, zones: ['BayWest'], name: 'San Jose', id: 'sanjose', hub: true },
  { re: /east bay|e\\.?\\s*bay|oakland|walnut creek|berkeley|emeryville/i, zones: ['EastBay'], name: 'East Bay', id: 'eastbay' },
  { re: /wine country/i, zones: ['NapaWine'], name: 'Napa', id: 'napa' },
  { re: /\bnapa\b/i, zones: ['NapaWine'], name: 'Napa', id: 'napa' },
  { re: /sonoma|santa rosa/i, zones: ['NapaWine'], name: 'Sonoma', id: 'sonoma' },
  { re: /sacramento|\bsac\b/i, zones: ['Sacramento'], name: 'Sacramento', id: 'sac' },
  { re: /surrounding areas/i, zones: ['Sacramento', 'Tahoe'], name: 'Sacramento', id: 'sac-area' },
  { re: /\btahoe\b/i, zones: ['Tahoe'], name: 'Tahoe', id: 'tahoe' },
  { re: /monterey bay/i, zones: ['Carmel'], name: 'Monterey Bay', id: 'monterey-bay' },
  { re: /\bcarmel\b/i, zones: ['Carmel'], name: 'Monterey Bay', id: 'carmel' },
  { re: /\bsalinas\b/i, zones: ['Carmel'], name: 'Salinas', id: 'salinas' },
  { re: /\bmonterey\b/i, zones: ['Carmel'], name: 'Monterey Bay', id: 'monterey' },
  { re: /watsonville|gilroy/i, zones: ['Carmel'], name: 'Monterey Bay', id: 'carmel-south' },
  { re: /central california|central coast|central valley/i, zones: ['Central'], name: 'Central Coast', id: 'central' },
  { re: /\bslo\b|pismo|san luis|paso robles|fresno/i, zones: ['Central'], name: 'Central Coast', id: 'central' },
  { re: /santa barbara|\bsb\b|goleta|montecito/i, zones: ['SB'], name: 'Santa Barbara', id: 'sb' },
  { re: /los angeles|\bla\b(?![a-z])|hollywood|santa monica|beverly hills|long beach/i, zones: ['LA'], name: 'Los Angeles', id: 'la' },
  { re: /orange county|\boc\b(?![a-z])|newport beach|newport|laguna|huntington/i, zones: ['OC'], name: 'Orange County', id: 'oc' },
  { re: /coachella valley/i, zones: ['Coachella'], name: 'Coachella Valley', id: 'desert' },
  { re: /palm springs|palm desert|rancho mirage|coachella|\bdesert\b/i, zones: ['Coachella'], name: 'Coachella Valley', id: 'desert-alias' },
  { re: /san diego|la jolla|oceanside/i, zones: ['SD'], name: 'San Diego', id: 'sd' },
];

const ADMIN_RE = /^(wed:\s*send second review.*|chad:.*sales|max:\s*day off|max - |alex |off day|no stops|no jobs|dedicated trip|zoom |phone |meeting |team zoom|business meeting|doctor|vacation|vacay|week total)/i;

const FALLBACK_WINDOW_DAYS = 14;

const SAN_JOSE_CITIES = new Set(['san jose', 'san josé']);
const SAN_JOSE_ZIP = /^951\d{2}$/;

function isSanJose(addr) {
  if (!addr) return false;
  const city = String(addr.city || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (SAN_JOSE_CITIES.has(city)) return true;
  const z = String((addr.zip || '')).match(/\b(\d{5})\b/);
  return !!(z && SAN_JOSE_ZIP.test(z[1]));
}

function stripAdmin(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  // "Wed: Send Second Review Requests 10AM-12PM || Silicon Valley → …"
  t = t.replace(/^[^|]*Send Second Review Requests[^|]*/i, '').replace(/^\s*\|\|\s*/, '').trim();
  t = t.replace(/^\s*(Max(?:\s*&\s*Alex)?|Alex|JT|Max -)\s+/i, '');
  return t;
}

function isAdminOnly(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (ADMIN_RE.test(t) && !/(silicon valley|east bay|carmel|los angeles|sacramento|san jose|napa|coachella|san diego|orange county|central california)/i.test(t)) return true;
  return false;
}

function splitSegments(text) {
  // Keep parentheticals attached to the preceding clause.
  const parts = [];
  let buf = '';
  let depth = 0;
  const chars = String(text || '');
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next3 = chars.slice(i, i + 3);
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (next3 === ' → ' || next3 === '→')) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      i += (next3 === ' → ' ? 2 : 0);
      continue;
    }
    if (depth === 0 && / — | —| – /.test(chars.slice(i, i + 3))) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      i += 2;
      continue;
    }
    // semicolons also separate clauses ("East Bay, Napa; SF & Silicon Valley if quick")
    if (depth === 0 && c === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function phrasesIn(seg) {
  const hits = [];
  for (const p of PHRASES) {
    if (p.re.test(seg)) hits.push(p);
  }
  // de-dupe by id, keep first (longer phrases are listed first)
  const seen = new Set();
  return hits.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function parseRouteText(raw) {
  const original = String(raw || '').trim();
  const text = stripAdmin(original);
  if (!text || isAdminOnly(text)) {
    return { ok: false, text: original, primaryZones: [], conditionalZones: [], primaryNames: [], conditionalNames: [], hubs: [], branches: [], label: '', orBranches: false };
  }
  const orParts = text.split(/\s+OR\s+/); // uppercase OR is a route branch; lowercase "or" is ordinary English
  const orBranches = orParts.length > 1;
  const primaryZones = new Set();
  const conditionalZones = new Set();
  const primaryNames = [];
  const conditionalNames = [];
  const hubs = new Set();
  const addName = (arr, name) => { if (name && !arr.includes(name)) arr.push(name); };
  const OVERNIGHT = /stay(?:s)? the night|stay night|night in |night at |night bet\b/i;

  const applyHits = (seg, cond) => {
    if (OVERNIGHT.test(seg)) return;
    const hits = phrasesIn(seg);
    for (const h of hits) {
      if (h.hub && !cond) {
        hubs.add(h.id);
        h.zones.forEach((z) => primaryZones.add(z));
        addName(primaryNames, h.name);
        continue;
      }
      if (cond && !h.hub) {
        h.zones.forEach((z) => conditionalZones.add(z));
        addName(conditionalNames, h.name);
      } else if (!cond) {
        h.zones.forEach((z) => primaryZones.add(z));
        addName(primaryNames, h.name);
      }
    }
  };

  const CONTINUATION = /^(then\b|or on to|or to\b|or toward|and then)/i;
  const OVERNIGHT_TAIL = /(?:stay(?:s)? the night|stay night|night in |night at |night bet\\b).*$/i;

  const eatOne = (seg, forceCond) => {
    if (!seg) return;
    const clipped = String(seg).replace(OVERNIGHT_TAIL, ' ').trim();
    if (!clipped) return;
    const extras = [];
    const base = clipped.replace(/\(([^)]*)\)/g, (_, inner) => { extras.push(inner); return ' '; }).replace(/\s+/g, ' ').trim();
    const conditionOnly = extras.some((ex) => COND_CUE.test(ex) && phrasesIn(ex).length === 0);
    const condBase = forceCond || COND_CUE.test(base) || conditionOnly;
    if (base) applyHits(base, condBase);
    for (const ex of extras) {
      if (OVERNIGHT.test(ex)) continue;
      if (phrasesIn(ex).length) applyHits(ex, forceCond || COND_CUE.test(ex) || CONTINUATION.test(ex.trim()));
    }
  };

  const eat = (seg, forceCond) => {
    // Split "LA (all day)/SB (late…)" on a slash that follows a closed parenthetical.
    // Do not split compounds like "SF/Silicon Valley".
    const parts = String(seg || '').split(/\)\s*\/\s*/);
    if (parts.length === 1) { eatOne(seg, forceCond); return; }
    parts.forEach((part, i) => eatOne(i < parts.length - 1 ? part + ')' : part, forceCond));
  };

  for (const branch of orParts) {
    for (const seg of splitSegments(branch)) eat(seg, false);
  }

  // If a zone is both primary (e.g. San Jose hub) and conditional (SF/Silicon Valley if quick), keep both flags.
  // Names used in the customer label are primary only, minus a lone bookend hub when other primaries exist.
  const labelNames = primaryNames.filter((n) => !(n === 'San Jose' && primaryNames.some((x) => x !== 'San Jose')));
  const label = labelFromNames(labelNames.length ? labelNames : primaryNames);

  return {
    ok: true,
    text: original,
    primaryZones: [...primaryZones],
    conditionalZones: [...conditionalZones],
    primaryNames,
    conditionalNames,
    hubs: [...hubs],
    branches: orParts.map((s) => s.trim()),
    label,
    orBranches,
  };
}

function labelFromNames(names) {
  const uniq = [];
  for (const n of names) if (n && !uniq.includes(n)) uniq.push(n);
  if (!uniq.length) return '';
  if (uniq.length === 1) return uniq[0];
  if (uniq.length === 2) return uniq[0] + ' & ' + uniq[1];
  return uniq.slice(0, -1).join(', ') + ' & ' + uniq[uniq.length - 1];
}

/**
 * Role of an address (or a zone, if no address) on a parsed route.
 *   'primary' | 'conditional' | null
 */
function roleFor(parsed, zone, addr) {
  if (!parsed || !parsed.ok) return null;
  const hub = isSanJose(addr);
  if (hub && parsed.hubs.includes('sanjose')) return 'primary';
  const prim = (parsed.primaryZones || []).includes(zone);
  const cond = (parsed.conditionalZones || []).includes(zone);
  if (prim && cond) {
    // Zone appears both as a hub bookend and as a late/if-quick add-on (BayWest on the Friday loop).
    return hub ? 'primary' : 'conditional';
  }
  if (prim) return 'primary';
  if (cond) return 'conditional';
  return null;
}

function parseFromDayInfo(info, liveRoute) {
  const text = (liveRoute && String(liveRoute).trim()) || (info && (info.label || info.shortLabel)) || '';
  const parsed = parseRouteText(text);
  if (parsed.ok) {
    // Honor an explicit catalog split when present, filling any gaps from the parser.
    if (info && Array.isArray(info.conditionalZones) && info.conditionalZones.length && !parsed.conditionalZones.length) {
      parsed.conditionalZones = info.conditionalZones.slice();
      parsed.primaryZones = (info.zones || []).filter((z) => !info.conditionalZones.includes(z));
    }
    return parsed;
  }
  // Fallback: catalog zone lists with no parseable text.
  if (info) {
    const primary = (info.zones || []).filter((z) => !(info.conditionalZones || []).includes(z));
    const cond = info.conditionalZones || [];
    return {
      ok: true,
      text: text || (info.label || ''),
      primaryZones: primary,
      conditionalZones: cond.slice(),
      primaryNames: [],
      conditionalNames: [],
      hubs: [],
      branches: [],
      label: info.shortLabel || '',
      orBranches: false,
    };
  }
  return parsed;
}

module.exports = {
  FALLBACK_WINDOW_DAYS, COND_CUE, PHRASES,
  parseRouteText, parseFromDayInfo, roleFor, isSanJose, labelFromNames, stripAdmin, isAdminOnly,
};
