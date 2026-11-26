/**
 * Recheck whether a delivery day can actually take an installation (Chad t2095u reviews).
 * Hanging needs more time than a late / if-quick add-on, so a conditional-only stop is not a fit.
 * If it doesn’t fit, the original pickup + delivery stays as it is. No phone prompts, no staff names.
 */
const sched = require('./scheduling');
const windows = require('./route-windows');
const sheetDays = require('./sheet-days');

const MSG = 'Installation doesn’t fit this delivery day. Your pickup and delivery stay as they are.';

const COND_CUE = /\b(late|if quick|if time|if possible)\b/i;
const AREA_TERMS = {
  BayWest: [/\bsan francisco\b/i, /\bsf\b/i, /\bsilicon valley\b/i, /\bmarin\b/i, /\bpeninsula\b/i, /\bhealdsburg\b/i],
  EastBay: [/\beast bay\b/i, /\boakland\b/i, /\bberkeley\b/i, /\bwalnut creek\b/i],
  NapaWine: [/\bnapa\b/i, /\bwine country\b/i, /\bsonoma\b/i],
  Sacramento: [/\bsacramento\b/i],
  Tahoe: [/\btahoe\b/i],
  Carmel: [/\bcarmel\b/i, /\bmonterey\b/i, /\bsalinas\b/i],
  Central: [/\bcentral (coast|california|valley)\b/i, /\bslo\b/i],
  LA: [/\blos angeles\b/i, /\b\bla\b/i],
  SB: [/\bsanta barbara\b/i, /\b\bsb\b/i],
  OC: [/\borange county\b/i, /\b\boc\b/i],
  SD: [/\bsan diego\b/i],
  Coachella: [/\bcoachella\b/i, /\bpalm springs\b/i],
};

function routeTexts(iso, explicit) {
  if (explicit && explicit.length) return explicit.map(String);
  const d = sheetDays.days()[iso];
  const fromSheet = (d && Array.isArray(d.routes) ? d.routes : []).map(String).filter(Boolean);
  if (fromSheet.length) return fromSheet;
  // When the live sheet has no route line yet, the weekly catalog label is the published plan for that weekday
  // (e.g. Friday “SF & Silicon Valley if quick”). An install is not a late / if-quick stop.
  try {
    const info = sched.dayInfo(new Date(iso + 'T12:00:00Z'));
    return [info.label, info.shortLabel].filter(Boolean);
  } catch (_) { return []; }
}

function termsFor(addr) {
  const zone = sched.zoneFor(addr);
  const city = String((addr && addr.city) || '').trim();
  const out = [];
  if (city) out.push(new RegExp('\\b' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'));
  (AREA_TERMS[zone] || []).forEach((re) => out.push(re));
  return out;
}

function segmentHits(seg, terms) {
  return terms.some((re) => re.test(seg));
}

/** True when the address is mentioned on the day’s route only as a late / if-quick (conditional) stop. */
function isConditionalOnlyStop(routeText, addr) {
  const texts = [].concat(routeText || []).filter(Boolean);
  if (!texts.length || !addr) return false;
  const terms = termsFor(addr);
  if (!terms.length) return false;
  let hit = false, primary = false;
  texts.forEach((raw) => {
    String(raw).split(/\s*(?:→|—|–|;)\s*/).forEach((seg) => {
      if (!segmentHits(seg, terms)) return;
      hit = true;
      if (!COND_CUE.test(seg)) primary = true;
    });
  });
  return hit && !primary;
}

function deliveryIso(order) {
  const sc = (order && order.schedule) || {};
  return sc.deliveryDate || sc.date || '';
}

/**
 * @param {object} order  a CAD order (service may still be pickup_delivery)
 * @param {object} [opts]
 * @param {string[]} [opts.routeTexts]  override the sheet’s route text (tests)
 * @returns {{ ok: boolean, message?: string, reason?: string }}
 */
function installVisitFit(order, opts = {}) {
  const drop = order && order.dropoff;
  const iso = deliveryIso(order);
  if (!order || !drop || !iso) return { ok: true };
  const texts = routeTexts(iso, opts.routeTexts);
  if (isConditionalOnlyStop(texts, drop)) return { ok: false, reason: 'conditional', message: MSG };

  const zone = sched.zoneFor(drop);
  if (zone && !sched.isRouteDay(new Date(iso + 'T12:00:00Z'), zone, { ...order, service: 'delivery_install' })) {
    // Still allow it when the sheet has no opinion (legacy empty calendar) and the weekly catalog lists the zone.
    // isRouteDay already consults the weekly catalog; if it says no, the day is not a regular stop for this address.
    return { ok: false, reason: 'off_route', message: MSG };
  }
  if (sheetDays.capacityLeft && sheetDays.capacityLeft(iso) <= 0) {
    return { ok: false, reason: 'capacity', message: MSG };
  }
  const pu = (order.schedule && order.schedule.date) || iso;
  if (order.pickup && pu && !windows.pairFits(order.pickup, drop, pu, iso, order)) {
    return { ok: false, reason: 'windows', message: MSG };
  }
  return { ok: true };
}

module.exports = { installVisitFit, isConditionalOnlyStop, routeTexts, MSG };
