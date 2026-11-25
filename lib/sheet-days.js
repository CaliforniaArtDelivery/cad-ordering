/**
 * Date Guard: the one calendar that decides which dates the site may offer.
 *
 * Source of truth = the ROUTE CALENDAR tab (Samantha owns it) merged with read-only facts from SCHEDULE 2026 (route text per
 * date, job rows already written incl. paid online orders, off-day marks), delivered by the Apps Script `days` action.
 *
 * DATE_GUARD=strict : a date is offered for an area ONLY if the calendar has it, it is OPEN, the area is listed, the sheet does not
 *                     mark it off, the day's route text is not for a different area, and capacity remains after holds.
 *                     No calendar answer (never fetched, or older than 2 h) => nothing is offered (fail closed) + alert.
 * DATE_GUARD=legacy : (default until Samantha approves the Knowledge Base) static calendar, minus dates the sheet marks off or full.
 * Nothing here writes to the sheet.
 */
const sync = () => require('./sheets-sync');
const holds = require('./holds');
const MODE = () => (process.env.DATE_GUARD || 'legacy').toLowerCase();
const CAP_DEFAULT = () => Number(process.env.DAILY_JOB_CAP || require('../config').scheduling.dailyJobCap || 8);
const FLAG_AT = () => Number(process.env.FLAG_AT_ROWS || require('../config').scheduling.flagAtRows || 6);
const FRESH_MS = 30 * 60 * 1000, DEAD_MS = 2 * 3600 * 1000;
let snap = { fetchedAt: 0, days: {}, error: null };
let timer = null, lastAlertKey = '';

// Route text -> area ids (Samantha's words in column E). Used only to catch a calendar that disagrees with the day's own rows.
const ROUTE_WORDS = [
  ['Carmel', /carmel|salinas|monterey/i], ['BayWest', /silicon valley|\bsf\b|san francisco|marin|healdsburg|san jose|cupertino|palo alto/i],
  ['Sacramento', /sacramento|\bsac\b/i], ['Tahoe', /tahoe/i], ['EastBay', /east bay|oakland|walnut creek/i], ['NapaWine', /napa|wine country|sonoma/i],
  ['LA', /los angeles|\bla\b|hollywood|santa monica|beverly hills|long beach/i], ['SB', /santa barbara|\bsb\b|goleta/i],
  ['Coachella', /coachella|palm springs|palm desert|desert|rancho mirage/i], ['SD', /san diego|la jolla|oceanside/i],
  ['OC', /orange county|\boc\b|irvine|newport|laguna|huntington/i], ['Central', /central california|slo\b|pismo|fresno|nipomo|central valley/i],
];
const classify = (texts) => { const out = new Set(); for (const t of texts || []) for (const [z, re] of ROUTE_WORDS) if (re.test(String(t))) out.add(z); return out; };

const rowsNeeded = (order) => 1;
function remaining(iso, heldRows) {
  const d = snap.days[iso]; if (!d) return 0;
  // The daily cap (8 job rows, Samantha) is a ceiling; the ROUTE CALENDAR capacity column can only lower it for a day.
  const cap = d.capacity > 0 ? Math.min(d.capacity, CAP_DEFAULT()) : CAP_DEFAULT();
  return cap - Number(d.jobRows || 0) - (heldRows == null ? holds.held(iso) : heldRows);
}
function reason(iso, zone, rows = 1) {
  const d = snap.days[iso];
  const strict = MODE() === 'strict';
  if (strict) {
    if (!snap.fetchedAt || Date.now() - snap.fetchedAt > DEAD_MS) return 'no fresh calendar (fail closed)';
    if (!d || !d.calendar) return 'date not in ROUTE CALENDAR';
    if (!d.open) return 'calendar says CLOSED';
    if (zone && !(d.zones || []).includes(zone) && !(zone === 'Tahoe' && (d.zones || []).includes('Sacramento'))) return 'area not served that day';
  }
  if (!d) return null;
  if (d.off) return `sheet marks it off (${d.offWhy || 'off'})`;
  if (strict && d.routes && d.routes.length) {
    const txt = classify(d.routes);
    if (txt.size && (d.zones || []).length && ![...txt].some((z) => d.zones.includes(z))) return `route text on the sheet ("${d.routes[0].slice(0, 40)}") is for a different area than the calendar`;
  }
  if (remaining(iso) < rows) return 'full (capacity or held slots)';
  return null;
}
// Rows still free on a date for a NEW hold. With no calendar data in legacy mode there is no limit to enforce.
function capacityLeft(iso, heldOthers) {
  if (!snap.days[iso]) return MODE() === 'strict' ? 0 : Infinity;
  return remaining(iso, heldOthers);
}
const isClosed = (iso, zone, rows = 1) => reason(iso, zone, rows) !== null;

async function refresh() {
  try {
    const j = await sync().call({ action: 'days' });
    if (!j || j.ok !== true || !j.days) throw new Error((j && j.error) || 'bad days answer');
    snap = { fetchedAt: Date.now(), days: j.days, error: null };
  } catch (e) { snap.error = e.message; snap.errorAt = Date.now(); }
  if (MODE() === 'strict' && (!snap.fetchedAt || Date.now() - snap.fetchedAt > DEAD_MS) && lastAlertKey !== 'dead') {
    lastAlertKey = 'dead';
    sync().call({ action: 'alert', subject: 'ALERT: Date Guard has no fresh schedule calendar, the site is offering no dates', body: `Last error: ${snap.error}. The booking site fails closed (no dates) until the schedule sheet can be read again.` }).catch(() => {});
  } else if (snap.fetchedAt && Date.now() - snap.fetchedAt < FRESH_MS) lastAlertKey = '';
  return snapshot();
}
function start() {
  if (timer || !process.env.SHEETS_WEBHOOK_URL) return;
  refresh();
  timer = setInterval(refresh, 5 * 60 * 1000); timer.unref();
}
const snapshot = () => ({
  mode: MODE(), fetchedAt: snap.fetchedAt ? new Date(snap.fetchedAt).toISOString() : null, stale: !snap.fetchedAt || Date.now() - snap.fetchedAt > FRESH_MS, error: snap.error,
  closed: Object.keys(snap.days).filter((iso) => reason(iso, null) !== null).slice(0, 400),
});
const days = () => snap.days;
// After a row is saved, count it at once (the next refresh replaces this with the sheet's own count).
function bump(order) {
  if (!order || !order.schedule) return;
  const svc = require('./pricing').SERVICES[order.service] || {};
  const add = (iso) => { if (iso && snap.days[iso]) snap.days[iso].jobRows = Number(snap.days[iso].jobRows || 0) + 1; };
  add(order.schedule.date); if (svc.needsPickup && svc.needsDropoff) add(order.schedule.deliveryDate || order.schedule.date);
  flagBusy([order.schedule.date, svc.needsPickup && svc.needsDropoff ? (order.schedule.deliveryDate || order.schedule.date) : null]);
  refresh();
}
// Heads-up to the team when a date reaches the flag level (6 rows) and again when it is full (cap). Once per date and level per process.
const flagged = new Set();
function flagBusy(dates) {
  [...new Set(dates.filter(Boolean))].forEach((iso) => {
    const d = snap.days[iso]; if (!d) return;
    const rows = Number(d.jobRows || 0), cap = d.capacity > 0 ? Math.min(d.capacity, CAP_DEFAULT()) : CAP_DEFAULT();
    const level = rows >= cap ? 'FULL' : rows >= FLAG_AT() ? 'BUSY' : null;
    if (!level || flagged.has(iso + level)) return;
    flagged.add(iso + level);
    sync().alert(`${level === 'FULL' ? 'FULL' : 'Getting busy'}: ${iso} has ${rows} of ${cap} job rows`, `${iso} now has ${rows} job rows (daily cap ${cap}, flag at ${FLAG_AT()}). ${level === 'FULL' ? 'The site has stopped offering this date.' : 'The site still offers it until the cap.'}\nRows count SCHEDULE 2026 plus online orders. Change the ROUTE CALENDAR capacity column to lower a single day.`);
  });
}
const _setForTests = (d) => { snap = { fetchedAt: Date.now(), days: d, error: null }; };
module.exports = { flagBusy, FLAG_AT, bump, capacityLeft, isClosed, reason, remaining, classify, refresh, start, snapshot, days, rowsNeeded, _setForTests };
