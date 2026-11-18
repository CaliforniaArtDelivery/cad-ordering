/**
 * Date Guard review rules (Samantha, Nov 18 2026). Pure function of the order JSON; writes nothing.
 * An order that trips a rule is NEVER auto-confirmed: it is saved as a pending request (status pending_approval), the date(s)
 * are held while the team decides, nothing is charged, and the team is alerted.
 *
 *   pencil_in  : first stop (pickup, else delivery) or delivery stop is in a remote area (Sacramento/Tahoe, San Diego, Palm Springs
 *                & desert). The team confirms within 1 business day (preferred partners are accepted but may be scheduled further out).
 *   monday_oc  : an Orange County stop on a Monday. Never offered automatically; if it arrives anyway it goes to review.
 *   helper     : NEED HELPER. Any piece over 150 lb, any sofa / heavy furniture regardless of weight, and installs that need a
 *                ladder, stairwell or custom/chandelier hanging (the site's stand-in for install Level 2/3). Date on hold until a helper is booked.
 *   quote      : rush and dedicated trips (priced and dated by the team; handled by the existing quote path).
 */
const config = require('../config');
const S = config.scheduling;
const sched = () => require('./scheduling');
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const isMonday = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && new Date(iso + 'T12:00:00Z').getUTCDay() === 1;

function helperReasons(order) {
  const R = S.helperRules, out = [];
  const svc = require('./pricing').SERVICES[order.service] || {};
  (order.items || []).forEach((it) => {
    const name = String(it.description || it.furnitureKind || 'a piece').slice(0, 50);
    if (num(it.weight) > R.overLb) out.push(`${name}: over ${R.overLb} lb`);
    else if (it.oversized) out.push(`${name}: oversized / very heavy`);
    if ((it.type || '') === 'furniture') {
      if (R.heavyFurnitureKinds.includes(it.furnitureKind)) out.push(`${name}: ${it.furnitureKind} (sofa / heavy furniture needs a helper at any weight)`);
      else if (it.sizeClass === 'large' || it.sizeClass === 'xl') out.push(`${name}: large / heavy furniture`);
    }
    if (svc.install && (R.installProxy.hangWhere.includes(it.hangWhere) && it.hangHeight === 'higher' || (it.type === 'decor' || it.type === 'furniture') && R.installProxy.quoteHangKinds.includes(it.furnitureKind))) {
      out.push(`${name}: install needing a ladder, stairwell or custom hang (Level 2/3 stand-in)`);
    }
  });
  return [...new Set(out)];
}

// HELPER_HOLD_ORDERS=0 turns the helper HOLD off (NEED HELPER is then only labelled on the sheet); config.scheduling.helperRules.holdOrders is the default.
const holdHelper = () => (process.env.HELPER_HOLD_ORDERS != null && process.env.HELPER_HOLD_ORDERS !== '' ? process.env.HELPER_HOLD_ORDERS !== '0' : S.helperRules.holdOrders !== false);
function review(order) {
  const none = { needed: false, kinds: [], reasons: [], pencilIn: false, helper: false, mondayOc: false, quote: false, partner: false };
  if (!order) return none;
  const { SERVICES, isOutOfState } = require('./pricing');
  const svc = SERVICES[order.service] || {};
  const ship = svc.shipping || order.service === 'crating_shipping' || order.shipping;
  if (ship || (isOutOfState && isOutOfState(order))) return none; // already a team quote
  const z = sched();
  const reasons = [], kinds = [];
  const add = (kind, text) => { if (!kinds.includes(kind)) kinds.push(kind); reasons.push({ kind, text }); };
  const puZone = svc.needsPickup ? z.zoneFor(order.pickup) : null, deZone = svc.needsDropoff ? z.zoneFor(order.dropoff) : null;
  const remote = [puZone, deZone].filter((x) => x && S.remoteZones.includes(x));
  const partner = !!(order.partnerOrder || order.memberCompany && S.preferredPartners.some((p) => String(order.memberCompany).toLowerCase().includes(p)));
  if (remote.length) add('pencil_in', `Remote area (${[...new Set(remote)].map((r) => z.customerAreaName(r)).join(', ')}): pencilled in, the team confirms within 1 business day${partner ? ' (preferred partner: accepted, may be scheduled further out)' : ''}`);
  const sc = order.schedule || {};
  if ((puZone === 'OC' && isMonday(sc.date)) || (deZone === 'OC' && isMonday(sc.deliveryDate || sc.date))) add('monday_oc', 'Orange County stop on a Monday: team review');
  const help = helperReasons(order);
  if (help.length) add('helper', 'NEED HELPER: ' + help.join('; ') + '. The date is on hold until a helper is booked');
  const quote = !!(order.rush || order.dedicated);
  if (quote) add('quote', `${order.dedicated ? 'Dedicated trip' : 'Rush request'}: the team quotes the price and picks the date`);
  const needed = kinds.some((k) => k !== 'quote' && (k !== 'helper' || holdHelper()));
  return { needed, kinds, reasons, pencilIn: kinds.includes('pencil_in'), helper: kinds.includes('helper'), mondayOc: kinds.includes('monday_oc'), quote, partner };
}

// Customer-facing wording (no internal terms).
function customerNote(rv) {
  const bits = [];
  if (rv.pencilIn) bits.push('Your area is on a route we fill as stops come together, so your date is penciled in and our team confirms it within 1 business day.');
  if (rv.mondayOc) bits.push('Our team confirms Monday Orange County stops by hand.');
  if (rv.helper) bits.push('Your pieces need an extra crew member, so your date is held while we book one.');
  return bits.join(' ') + ' Nothing is charged until we confirm.';
}
module.exports = { review, helperReasons, customerNote, isMonday };
