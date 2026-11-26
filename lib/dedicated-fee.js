/**
 * Dedicated trips, per side (Chad, Nov 25 2026, t2069u / t2070u / t2073u). A side (pickup or delivery) can be a dedicated trip:
 * a van and crew just for that stop, on any date that works for the customer (not a route day). Each dedicated side adds one
 * fee to the regular price. The rules live in config.dedicatedTrip. INTERNAL ONLY: the customer sees one total price; the rate,
 * hours, hub and formula are never sent to the browser or written in a customer email.
 */
const config = require('../config');
const SVC = () => require('./pricing').SERVICES;
const D = () => config.dedicatedTrip;

/** Which sides are dedicated. Two-stop services: pickup -> schedule.date, delivery -> schedule.deliveryDate.
 *  One-stop services (install only): the one stop is the delivery side, on schedule.date. Old orders with only `dedicated: true`
 *  are read as every side dedicated. */
function sides(o) {
  const sv = (SVC()[(o && o.service) || 'pickup_delivery']) || {};
  if (!o || sv.shipping) return { pickup: false, delivery: false };
  const legacy = !!o.dedicated && o.dedicatedPickup == null && o.dedicatedDelivery == null;
  const pu = !!sv.needsPickup && !!(o.dedicatedPickup || legacy);
  const de = !!sv.needsDropoff && !!(o.dedicatedDelivery || legacy);
  return { pickup: pu, delivery: de };
}
const any = (o) => { const s = sides(o); return s.pickup || s.delivery; };
/** The date field each side uses. */
const dateOf = (o, side) => {
  const sv = SVC()[(o && o.service) || 'pickup_delivery'] || {};
  const sc = (o && o.schedule) || {};
  if (side === 'pickup') return sc.date || '';
  return sv.needsPickup ? (sc.deliveryDate || '') : (sc.date || '');
};

const shiftIso = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const sheetDay = (iso) => { try { return require('./sheet-days').days()[iso] || null; } catch (_) { return null; } };
/** No jobs booked on that date yet (live sheet), or no sheet data and no route planned that day. */
function morningFree(iso) {
  const d = sheetDay(iso);
  if (d) return !d.off && !(Number(d.jobRows || 0) > 0);
  return !((require('./scheduling').zonesOnDate(iso).zones || []).length);
}
/** '' when the CAD SCHEDULE has room on that date for a dedicated side of `hours` round trip; else a reason (internal words). */
function capacityProblem(iso, hours) {
  const cfg = D(), SD = require('./sheet-days');
  const d = sheetDay(iso);
  if (d && d.off) return 'full';
  const left = SD.capacityLeft(iso);
  if (!Number.isFinite(left)) return ''; // no live calendar for that date (legacy mode): nothing to enforce
  let need = Math.max(1, Math.ceil(((Number(hours) || 0) + cfg.onSiteHours) / cfg.hoursPerRow));
  const prevLeft = SD.capacityLeft(shiftIso(iso, -1));
  if (Number.isFinite(prevLeft) && prevLeft <= 0 && d && Number(d.jobRows || 0) > 0) need += 1;
  return left < need ? 'full' : '';
}
const roundTo = (n, to) => Math.round(n / to) * to;
/** Round-trip hours from the closest start that day (hub or a route region served on that date). Internal only. */
function sideHours(addr, iso) {
  const cfg = D();
  const RW = require('./route-windows');
  const me = RW.placeAddress(addr || {});
  if (!me) return { hours: cfg.unknownHours, from: null, unknown: true };
  const starts = cfg.hubs.map((h) => ({ name: h.name, ll: h.ll }));
  if (cfg.useRouteDayStart && /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) {
    try {
      const S = require('./scheduling');
      if (!S.isBlockedDate(iso)) (S.zonesOnDate(iso).zones || []).forEach((z) => { if (RW.ZONE_CENTER[z]) starts.push({ name: `${z} route day`, ll: RW.ZONE_CENTER[z] }); });
      // Overnight leg: the morning is free (no jobs booked that date), so the van can start from where yesterday's route ended.
      if (cfg.useOvernightStart && morningFree(iso)) {
        const prev = shiftIso(iso, -1);
        if (!S.isBlockedDate(prev)) (S.zonesOnDate(prev).zones || []).forEach((z) => { if (RW.ZONE_CENTER[z]) starts.push({ name: `overnight after ${z} route day`, ll: RW.ZONE_CENTER[z] }); });
      }
    } catch (_) { /* no route data: hubs only */ }
  }
  let best = null;
  for (const st of starts) { const h = (RW.km(st.ll, me.ll) * cfg.roadFactor) / cfg.avgKmh; if (!best || h < best.oneWay) best = { from: st.name, oneWay: h }; }
  const hours = roundTo(best.oneWay * (cfg.roundTrip ? 2 : 1), cfg.roundHoursTo || 0.5);
  return { hours, from: best.from, place: me.name, rough: !!me.rough };
}
const feeForHours = (h) => { const c = D(); const t = Math.min(h, c.tierHours) * c.ratePerHour + Math.max(0, h - c.tierHours) * c.ratePerHourAfter; return Math.max(c.minFee, t); };
const isWeekend = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && [0, 6].includes(new Date(iso + 'T12:00:00Z').getUTCDay());
/** The whole dedicated charge for an order (internal detail): { fee, hours, weekend, sides: [{ side, date, hours, from }] }. */
function fees(o) {
  const s = sides(o), out = [];
  const sv = SVC()[(o && o.service) || 'pickup_delivery'] || {};
  if (s.pickup) out.push({ side: 'pickup', date: dateOf(o, 'pickup'), ...sideHours(o.pickup, dateOf(o, 'pickup')) });
  if (s.delivery) out.push({ side: sv.needsPickup ? 'delivery' : (sv.install ? 'install' : 'delivery'), date: dateOf(o, 'delivery'), ...sideHours(o.dropoff, dateOf(o, 'delivery')) });
  if (!out.length) return { fee: 0, hours: 0, weekend: false, sides: [] };
  const hours = out.reduce((t, x) => t + x.hours, 0);
  const weekend = out.some((x) => isWeekend(x.date));
  const fee = roundTo(feeForHours(hours) + (weekend ? D().weekendFee : 0), D().roundTo || 5);
  return { fee, hours, weekend, sides: out };
}

const ymd = (d) => d.toISOString().slice(0, 10);
/** The first and last dates a dedicated side can be booked for (PT calendar). */
function window(from = new Date()) {
  const S = require('./scheduling');
  const today = S.utcDate(S.ptYmd(from));
  return { min: ymd(new Date(today.getTime() + D().leadTimeDays * 864e5)), max: ymd(new Date(today.getTime() + D().maxDaysOut * 864e5)) };
}
/** '' when the date works for a dedicated trip, otherwise a short reason. */
function dateProblem(iso, from = new Date(), addr = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return 'a date';
  const w = window(from);
  if (iso < w.min) return `a date at least ${D().leadTimeDays} days out`;
  if (iso > w.max) return 'a date within the next few months';
  if (!D().allowSundays && new Date(iso + 'T12:00:00Z').getUTCDay() === 0) return 'a date other than a Sunday';
  if (require('./scheduling').isBlockedDate(iso)) return 'another date (that date is a holiday)';
  if (addr && capacityProblem(iso, sideHours(addr, iso).hours)) return 'another date (that date is full)';
  return '';
}
/** Dates in the booking window a dedicated side at `addr` can't use (holidays, Sundays when off, and full days). For the browser. */
function blockedFor(addr, from = new Date()) {
  const w = window(from), out = [];
  for (let t = Date.parse(w.min + 'T12:00:00Z'); t <= Date.parse(w.max + 'T12:00:00Z'); t += 864e5) { const iso = new Date(t).toISOString().slice(0, 10); if (dateProblem(iso, from, addr)) out.push(iso); }
  return out;
}
/** Rules the browser needs (no prices, no formula). */
function publicRules() {
  const w = window(), S = require('./scheduling'), blocked = [];
  for (let t = Date.parse(w.min + 'T12:00:00Z'); t <= Date.parse(w.max + 'T12:00:00Z'); t += 864e5) { const iso = ymd(new Date(t)); if (S.isBlockedDate(iso)) blocked.push(iso); }
  return { ...w, allowSundays: !!D().allowSundays, blocked };
}

/** Customer wording: ' · dedicated pickup' etc. Never a price breakdown. */
function label(o) {
  const s = sides(o), sv = SVC()[(o && o.service) || 'pickup_delivery'] || {};
  if (s.pickup && s.delivery) return ' · dedicated pickup and delivery';
  if (s.pickup) return ' · dedicated pickup';
  if (s.delivery) return sv.needsPickup ? ' · dedicated delivery' : ' · dedicated trip';
  return '';
}
module.exports = { capacityProblem, morningFree, blockedFor, label, sides, any, dateOf, sideHours, feeForHours, isWeekend, fees, window, dateProblem, publicRules };
