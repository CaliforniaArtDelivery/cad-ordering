/**
 * Writes orders to a LOCAL schedule file using the exact columns of
 * CAD's Google Sheet tab "SCHEDULE 2026" (header row 2, columns A–AJ).
 * Nothing here touches the real Google Sheet.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { sheetDate, regionFor, zoneFor, dayInfo, availableDays } = require('./scheduling');
const { SERVICES } = require('./pricing');
const ACCESS = require('../public/access');
const { typeLabel, framingText, hangText, piecesOf, expandPieces, pieceLabel } = require('./itemtypes');

const COLUMNS = [
  'Job Completion', 'Date', 'Time Load: ) = 15 min driving, | = 15 min stop time, 10 hr max pr day', 'Driver', 'Route',
  'JOB TYPE', 'Job Assignments', 'TOWN REF', 'Update Status', 'Update Notes', 'Arrival Time Window', 'Arrival Time',
  'Item(s) and dimensions, weight, value, etc-', 'PU Address & City', 'PU Business Name', 'PU Contact Name', 'PU Contact Phone #',
  'PU Notes', 'Pickup Helper Status', 'PU Hired Help Notes', 'DE Address & City', 'DE Business Name', 'DE Contact Name',
  'DE Contact Phone #', 'DE Notes (stairs etc.)', 'Delivery Helper Status', 'DEL Hired Help Notes',
  'Delivery Confirmation Update (For Palomas, Caldwell Snyder, & Aerena)', 'Delivery Confirmation Notes',
  "Who's paying?", 'Amount Due', 'Payment Status', 'Amount Paid', 'Pymnt method', 'Payment Notes',
];
const LETTERS = COLUMNS.map((_, i) => (i < 26 ? '' : 'A') + String.fromCharCode(65 + (i % 26)));


const addrLine = (a) => (a && a.street ? [a.street, a.city, [a.state || 'CA', a.zip].filter(Boolean).join(' '), a.country && !/^(us|usa|united states)/i.test(a.country) ? a.country : ''].filter(Boolean).join(', ') : '');
const formatAccessNotes = (a) => {
  if (!a || !a.street) return '';
  const bits = [];
  if (a.hours) bits.push(`Hours: ${a.hours}`);
  if (ACCESS.needsReview(a)) bits.push('ACCESS REVIEW: customer not sure, CAD to confirm access before the job');
  bits.push(...ACCESS.summary(a).filter((x) => !/^Access not sure/.test(x)));
  if (a.parkingRestricted) bits.push(`Parking/loading restrictions${a.parkingNote ? ': ' + a.parkingNote : ''}`);
  if (a.technicalCarry && !ACCESS.roughPath(a)) bits.push(`TECHNICAL CARRY (tight spaces/backyard)${(a.sitePhotos || []).length ? `, ${ACCESS.plural(a.sitePhotos.length, 'path photo')}` : ''}`);
  if (a.wallType || a.hardware) bits.push(`${a.wallType && a.wallType !== 'Not sure' ? a.wallType + ' wall' : 'wall type unknown'}${a.hardware ? ', hardware: ' + a.hardware : ''}${a.wallPhotos && a.wallPhotos.length ? `, ${ACCESS.plural(a.wallPhotos.length, 'wall photo')}` : ''}`);
  if (a.notes) bits.push(a.notes);
  return bits.join(' · ');
};
const accessNotes = formatAccessNotes;
// Neutralize a fragment that will sit in a sheet cell: collapse line breaks, and prefix a leading
// formula character (= + - @ or tab) with a single quote so Sheets will not execute it. Commas stay
// as-is (they are inside one cell, not a CSV split). Empty / missing values become ''.
function safeSheetText(s) {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!t) return '';
  if (/^[=+\-@\t]/.test(t)) return "'" + t;
  return t;
}
// One line per piece, each starting "Piece N — description" (one entry = one piece). Legacy quantities are expanded first.
const itemsText = (items = [], order = null) => {
  const fmtN = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n.toLocaleString('en-US') : String(s ?? ''); };
  const list = order ? piecesOf(order) : expandPieces(items);
  return list.map((it, i) => {
    const dims = [it.w, it.h, it.d].filter(Boolean).join(' x ');
    const lead = (order && order.partnerOrder) ? `${fmtN(it.qty || 1)}x ${it.description || 'Item'}` : pieceLabel(it, i);
    const material = safeSheetText(it.materialNotes);
    return [lead, `type: ${typeLabel(it)}`, it.oversized && 'OVERSIZED / VERY HEAVY (150+ lb, marble or armoire class): bring extra help', framingText(it), dims && `${dims} in`, it.weightUnsure ? 'weight not sure' : (it.weight && `~${fmtN(it.weight)} lb`), material && material, it.fragile && 'SPECIAL HANDLING', it.value && `value $${fmtN(it.value)}`,
      hangText(it), it.photos && it.photos.length && ACCESS.plural(it.photos.length, 'photo')].filter(Boolean).join(', ');
  }).join('\n');
};

// ---------------------------------------------------------------------------------------------------------------
// Team format (learned from SCHEDULE 2026 history, Nov 18 2026):
//  * Every PU/DEL job is TWO rows: a PU row on the pickup day and a DEL (or DEL + INST) row on the delivery day.
//    BOTH rows carry the full pickup AND delivery address / business / contact / phone / item text.
//  * Price + payment go on the paying / requesting party's leg (paymentLeg): often PU, but DEL when the
//    delivery recipient or "someone else" is paying, and INST for install-only. The other row gets "X" / "...".
//  * Install-only is ONE row, "INST ONLY", with the install address in the PU columns.
//  * Dates are text like "Mon, Nov 16" ("Thur" for Thursday); Route = the day's route text; TOWN REF = that leg's city.
//  * Update Status "Client confirmed day" / "CONTACT THEM!!!"; Job Assignments "NEED HELPER" / "SEE NOTES!".
// ---------------------------------------------------------------------------------------------------------------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Mon, Nov 16" (the 2026 tab); other years get the year so a 2027 date can't be mistaken for 2026.
function teamDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return 'TBD';
  const d = new Date(iso + 'T12:00:00Z');
  return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}${d.getUTCFullYear() === 2026 ? '' : ', ' + d.getUTCFullYear()}`;
}
// The team's own route wording per week type + weekday (used when the live sheet can't be consulted; the Apps Script
// replaces it with the exact text already written on that date's rows).
const TEAM_ROUTE = {
  NorCal: {
    0: 'Central California: SLO/Pismo Beach → Santa Barbara OR Fresno → Santa Barbara',
    1: 'LA (all day)/SB (late afternoon/evening) stay night bet Central & Carmel',
    2: 'Carmel',
    3: 'Silicon Valley → SF → Marin → Healdsburg → San Jose',
    4: 'Sacramento & surrounding areas (priority) — East Bay only if quick / en route',
    5: 'San Jose → East Bay → Napa → SF/Silicon Valley (late & if quick) → San Jose',
    6: 'Carmel → stay the night in Central California or Santa Barbara → Central California',
  },
  SoCal: { 1: 'Los Angeles', 2: 'Coachella Valley', 3: 'San Diego County', 4: 'Orange County' },
};
function teamRoute(iso, o) {
  if (!iso) return 'Shipping';
  const d = new Date(iso + 'T12:00:00Z');
  if (o && (o.rush || o.dedicated)) return `${o.dedicated ? 'Dedicated trip' : 'Rush request'} (off the regular route)`;
  const wk = require('./scheduling').regionForDate(d);
  return (TEAM_ROUTE[wk] || {})[d.getUTCDay()] || dayInfo(d).label || wk;
}

const money = (n) => Number(n);
const PS = require('./payment-status');
const HEAVY_LB = 150;
// NEED HELPER (Samantha, Nov 18 2026): over 150 lb, any sofa / heavy furniture at any weight, ladder/stairwell/custom installs (lib/date-guard-rules.js).
const isHeavy = (o) => (o.items || []).some((it) => Number(String(it.weight ?? '').replace(/,/g, '')) > HEAVY_LB || it.oversized) || require('./date-guard-rules').helperReasons(o).length > 0;
// TEST_MODE=1 (the test site) and mock payments are never real jobs: marked "TEST ORDER (not a real job)" on the schedule and never count as booked capacity. At go-live, TEST_MODE must be off so real quotes are not tagged as test.
const isTestOrder = (o) => !process.env.TEST_ONLY_MOCK_AS_LIVE && !!(process.env.TEST_MODE === '1' || (o.payment && (/^mock/.test(String(o.payment.method || '')) || /^mock_/.test(String(o.payment.ref || '')))));

function ptStamp(iso) { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT'; }
const prefText = (pref, note) => [ACCESS.timePrefText(pref), note && String(note).trim()].filter(Boolean).join(' — ');
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// Payment fields go on the leg of whoever is requesting or paying (Alyssa / live SCHEDULE 2026, Nov 25 2026).
function paymentLeg(o) {
  const svc = SERVICES[o.service] || {};
  if (o.service === 'crating_shipping') return 'SHIP';
  if (svc.install && !svc.needsPickup) return 'INST';
  const info = o.partnerInfo || {};
  if (o.partnerOrder && info.payer === 'palomas') return 'PU'; // invoiced to Paloma's at the origin
  if (o.partnerOrder && info.payer === 'client') return 'DEL'; // the delivery client is paying
  if (o.payer === 'pickup' || o.payer === 'pu') return 'PU';
  if (o.payer === 'dropoff' || o.payer === 'del' || o.payer === 'delivery' || o.payer === 'recipient') return 'DEL';
  if (o.payer === 'other') return 'DEL';
  const c = o.contact || {}, de = o.dropoff || {}, pu = o.pickup || {};
  const matches = (a) => a && (a.sameAsMe || (normName(c.name) && normName(c.name) === normName(a.contactName)));
  if (o.payer === 'me' && matches(de) && !matches(pu)) return 'DEL';
  if (o.payer === 'me' && de.sameAsMe) return 'DEL';
  return 'PU';
}

// Referral (Chad, Nov 21 2026): who referred them, plus the referrer's mobile or email when given, so CAD can thank them.
function referralNote(o) {
  if (!(o.partner && o.partner.name && o.partner.type !== 'Partner') && !(o.heard && o.heard.source === 'referral' && !o.heard.repeatClient)) return '';
  const h = o.heard || {};
  const name = (o.partner && o.partner.name) || String(h.referrerName || '').trim();
  const person = String(h.referrerName || '').trim();
  const reach = [person && person !== name ? person : '', String(h.referrerPhone || (o.partner && o.partner.phone) || '').trim(), String(h.referrerEmail || (o.partner && o.partner.email) || '').trim()].filter(Boolean).join(', ');
  if (!name && !reach) return 'referred (no name given)';
  return `referred by ${name || 'someone'}${reach ? ' (' + reach.replace(/[\r\n]+/g, ' ') + ')' : ''}`;
}
// Structured legs for one order: [{ leg:'PU'|'DEL'|'INST', row:{column:value}, ... }]. Pure function of the order JSON.
function legsForOrder(o) {
  const svc = SERVICES[o.service] || SERVICES.pickup_delivery;
  const c = o.contact || {};
  const heavy = isHeavy(o);
  const reviewNeeded = !!o.accessReview || ['pickup', 'dropoff'].some((k) => o[k] && o[k].street && ACCESS.needsReview(o[k]));
  const paid = PS.payStatus(o) === 'paid'; // money actually received
  // ACH still processing is NOT paid on the sheet (Chad, Nov 25 2026): the amount stays in Amount Due, Amount Paid stays empty,
  // Payment Status "Payment Requested", until Stripe confirms. Then a "payment" update moves it to PAID.
  const achPending = PS.payStatus(o) === 'ach_processing';
  const full = o.quote.paymentPlan !== 'deposit';
  const methodLabel = PS.methodLabel(o);
  const payer = PS.payerDisplay(o);
  const payerLine = (o.payer === 'me' || o.payer === 'pickup' || o.payer === 'dropoff') ? `${c.name || ''}${c.company ? ' / ' + c.company : ''}` : '';
  const pu = svc.needsPickup ? o.pickup : (svc.install && !svc.needsPickup ? o.dropoff : null); // install-only: install address lives in the PU columns
  const de = svc.needsPickup ? o.dropoff : null;
  const orderedBy = [`Ordered by: ${c.name || ''}`, c.company, c.phone, c.email, c.clientType && `(${c.clientType})`].filter(Boolean).join(' · ');
  const contact2 = o.contact2 && o.contact2.name ? `Second client: ${[o.contact2.name, o.contact2.phone, o.contact2.email].filter(Boolean).join(' · ')}` : '';
  const flags = [
    o.needsManualReview && 'NEEDS MANUAL REVIEW: old quantity entry (see admin)', o.review && o.review.pencilIn && 'REMOTE AREA: paid online, confirm route day with client', o.review && o.review.mondayOc && 'MONDAY OC STOP: paid online, confirm with client', o.rush && 'RUSH', o.dedicated && 'DEDICATED TRIP (do not displace existing jobs)', o.crating && 'CRATING REQUESTED (outsourced)',
    c.clientType && `client type: ${c.clientType}`, o.member && `CAD member${o.memberCompany ? ': ' + o.memberCompany : ''}`, // partner (showroom) orders only
    o.protectionDeclined && 'DECLINED declared value protection (customer opted out; CAD liability is limited)',
    o.discountCode && `discount code ${o.discountCode}${o.quote && o.quote.discount && o.quote.discount.amount ? ' (−$' + Number(o.quote.discount.amount).toFixed(2) + ')' : ''}`,
    o.review && o.review.kinds && o.review.kinds.includes('oversized') && 'OVERSIZED PIECE: team confirms handling', o.review && o.review.kinds && o.review.kinds.includes('no_street_number') && 'NO STREET NUMBER: team confirms the location',
    o.heard && o.heard.repeatClient ? 'repeat client' : (o.heard && o.heard.source === 'other' && o.heard.sourceOther ? `heard: ${o.heard.sourceOther}` : (o.heard && o.heard.source && o.heard.source !== 'referral' ? `heard: ${o.heard.source}${String(o.heard.sourceDetail || '').trim() ? ' (' + String(o.heard.sourceDetail).trim().replace(/[\r\n]+/g, ' ') + ')' : ''}` : '')),
    referralNote(o),
    ACCESS.weightUnconfirmed(o.items) && (ACCESS.WEIGHT_DISPATCH_FLAG + ': one or more pieces was listed as Not sure (any item type, including furniture); price may be adjusted once the actual weight is confirmed (get approval before any additional fees)'),
  ].filter(Boolean);
  const clientNotes = o.notes && String(o.notes).trim() ? `Client notes: ${String(o.notes).trim()}` : '';
  const shipLines = o.service === 'crating_shipping' ? 'SHIPPING: ' + require('./shiptext').lines(o).map(([k, v]) => k + ': ' + v).join(' | ') : '';
  // Do not start notes with "ONLINE ORDER <id>" — the schedule bridge prepends that tag (and TEST / PENDING marks).
  const baseNotes = (extra) => [`submitted ${ptStamp(o.createdAt)}`, ...flags, extra].filter(Boolean).join(' · ')
    + '\n' + [orderedBy, contact2, clientNotes, shipLines].filter(Boolean).join('\n');

  const puDate = o.schedule.date || '';
  const dels = [];
  let delDay = null;
  if (svc.needsPickup && svc.needsDropoff && o.service !== 'crating_shipping') {
    delDay = o.schedule.deliveryDate ? { date: o.schedule.deliveryDate } : (availableDays(o.dropoff, { from: new Date(puDate + 'T12:00:00Z'), count: 1, order: o, leadTime: 0 })[0] || null);
  }
  const status = (needs) => (needs ? 'CONTACT THEM!!!' : 'Client confirmed day');
  const assign = (notes, needs) => (needs === 'info' ? 'NEED INFO' : heavy ? 'NEED HELPER' : notes ? 'SEE NOTES!' : '');
  const common = {
    'Job Completion': false,
    'Item(s) and dimensions, weight, value, etc-': itemsText(o.items, o),
    'PU Address & City': pu ? addrLine(pu) : '', 'PU Business Name': pu ? pu.business || '' : '', 'PU Contact Name': pu ? pu.contactName || '' : '', 'PU Contact Phone #': pu ? pu.contactPhone || '' : '',
    'PU Notes': pu ? [accessNotes(pu), clientNotes && clientNotes.replace('Client notes:', 'CLIENT NOTE:')].filter(Boolean).join(' · ') : '',
    'Pickup Helper Status': pu && heavy ? 'Need Helper' : '',
    'DE Address & City': de ? addrLine(de) : '', 'DE Business Name': de ? de.business || '' : '', 'DE Contact Name': de ? de.contactName || '' : '', 'DE Contact Phone #': de ? de.contactPhone || '' : '',
    'DE Notes (stairs etc.)': de ? [accessNotes(de), clientNotes && clientNotes.replace('Client notes:', 'CLIENT NOTE:')].filter(Boolean).join(' · ') : '',
    'Delivery Helper Status': de && heavy ? 'Need Helper' : '',
  };
  const notesPresent = !!(common['PU Notes'] || common['DE Notes (stairs etc.)'] || clientNotes);
  const payment = {
    "Who's paying?": payer + (payerLine ? '' : ''),
    'Amount Due': achPending ? money(Number(PS.unpaidBalance(o) || 0) + Number((o.payment && o.payment.amount) || 0)) : PS.unpaidBalance(o),
    'Payment Status': PS.sheetPaymentStatus(o),
    'Amount Paid': paid ? money(o.payment.amount) : '',
    'Pymnt method': methodLabel,
    'Payment Notes': [
      payerLine && `Client: ${payerLine}`,
      o.partnerOrder && `Partner order (${o.memberCompany}), placed by ${(o.partnerInfo || {}).placedBy || c.name}, pickup ${(o.partnerInfo || {}).pickupLocation || ''}; payer: ${(o.partnerInfo || {}).payer === 'palomas' ? o.memberCompany : 'client'}` + ((o.partnerInfo || {}).courtesy ? " · Manager's courtesy applied (extra 15% off)" : ''),
      achPending && `ACH processing (not yet cleared): $${Number(o.payment.amount || 0).toFixed(2)} pending; not paid until the bank transfer clears`,
      o.payment && o.payment.method === 'zelle' && o.payment.status === 'zelle_requested' && `ZELLE REQUESTED: $${Number(o.payment.amount || 0).toFixed(2)} due by ${new Date(o.payment.dueBy).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} PT, memo ${o.id}; verify by hand before marking PAID (split transfers OK)`,
      o.payment && o.payment.method === 'zelle' && o.payment.status === 'paid' && `Zelle verified by CAD${o.payment.verifiedAt ? ' ' + new Date(o.payment.verifiedAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) : ''}`,
      paid && !full && `${config.payment.depositPercent}% ($${Number(o.payment.amount).toFixed(2)}) paid at booking; BALANCE $${Number(o.quote.balanceDue).toFixed(2)} DUE ${String(o.quote.balanceWhen || '').toUpperCase()}`,
      paid && full && (ACCESS.weightUnconfirmed(o.items) ? 'Paid at booking (online); weight unconfirmed — price may be adjusted once the actual weight is confirmed (approval required before any additional fees)' : 'Paid in full at booking (online)'),
      ACCESS.weightUnconfirmed(o.items) && !paid && 'Weight unconfirmed on one or more pieces; price may be adjusted once the actual weight is confirmed (approval required before any additional fees)',
      o.payment && o.payment.saved && 'payment method saved for future orders',
      o.payment && o.payment.last4 && `${o.payment.bank ? 'bank' : 'card'} ending ${o.payment.last4}`,
      o.payment && o.payment.ref && `ref ${o.payment.ref}`,
    ].filter(Boolean).join(' · '),
  };
  const noPay = { "Who's paying?": '', 'Amount Due': 'X', 'Payment Status': '...', 'Amount Paid': '', 'Pymnt method': '', 'Payment Notes': '' };

  const payOn = paymentLeg(o);
  if (o.service === 'crating_shipping') {
    dels.push({ leg: 'SHIP', row: { ...common, Date: 'TBD', Route: 'Shipping', 'JOB TYPE': 'PENDING JOB', 'Job Assignments': 'PENDINGJOB', 'TOWN REF': (o.pickup && o.pickup.city) || '', 'Update Status': 'CONTACT THEM!!!', 'Update Notes': baseNotes('SHIPPING quote: Samantha sets dates'), ...payment } });
  } else if (svc.install && !svc.needsPickup) {
    dels.push({ leg: 'INST', row: { ...common, Date: teamDate(puDate), Route: teamRoute(puDate, o), 'JOB TYPE': 'INST ONLY', 'Job Assignments': assign(notesPresent), 'TOWN REF': (o.dropoff && o.dropoff.city) || '', 'Update Status': status(reviewNeeded), 'Update Notes': baseNotes(prefText(o.schedule.timePref, o.schedule.timeNote) && `Client time preference: ${prefText(o.schedule.timePref, o.schedule.timeNote)}`), ...payment } });
  } else {
    const puFields = payOn === 'PU' ? payment : noPay;
    const delFields = payOn === 'DEL' ? payment : noPay;
    const puRow = { ...common, Date: teamDate(puDate), Route: teamRoute(puDate, o), 'JOB TYPE': 'PU', 'Job Assignments': assign(notesPresent), 'TOWN REF': (o.pickup && o.pickup.city) || '', 'Update Status': status(reviewNeeded), 'Update Notes': baseNotes(prefText(o.schedule.timePref, o.schedule.timeNote) && `Client PICKUP time preference: ${prefText(o.schedule.timePref, o.schedule.timeNote)}`), ...puFields };
    const delDate = delDay ? delDay.date : '';
    const delRow = { ...common, Date: delDate ? teamDate(delDate) : 'TBD', Route: delDate ? teamRoute(delDate, o) : (regionFor(o.dropoff) || ''), 'JOB TYPE': svc.install ? 'DEL + INST' : 'DEL', 'Job Assignments': delDate ? assign(notesPresent) : 'NEED INFO', 'TOWN REF': (o.dropoff && o.dropoff.city) || '',
      'Update Status': delDate ? status(reviewNeeded) : 'CONTACT THEM!!!',
      'Update Notes': baseNotes([delDate ? 'DELIVERY leg of the job picked up ' + teamDate(puDate) : 'DELIVERY DATE NEEDED: none could be computed, CONTACT CLIENT', prefText(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote) && `Client DELIVERY time preference: ${prefText(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote)}`].filter(Boolean).join(' · ')), ...delFields };
    dels.push({ leg: 'PU', row: puRow }, { leg: 'DEL', row: delRow });
  }
  return dels;
}

function rowsForOrder(o) {
  return legsForOrder(o).map(({ row }) => COLUMNS.map((c) => row[c] ?? ''));
}

const csvCell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

const FILE = path.join(require('./storage').dir('data'), 'schedule-2026.csv');
function appendOrder(o) {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, toCsv([COLUMNS]));
  fs.appendFileSync(FILE, toCsv(rowsForOrder(o)));
}
function rebuild(orders) { fs.writeFileSync(FILE, toCsv([COLUMNS, ...orders.flatMap(rowsForOrder)])); return FILE; }

module.exports = { COLUMNS, LETTERS, legsForOrder, paymentLeg, teamDate, teamRoute, isTestOrder, rowsForOrder, appendOrder, rebuild, toCsv, FILE, formatAccessNotes, safeSheetText, itemsText };
