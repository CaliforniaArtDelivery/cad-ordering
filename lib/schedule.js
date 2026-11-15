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
const { typeLabel, framingText } = require('./itemtypes');

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

const JOB_TYPE = { delivery: 'DEL', pickup: 'PU', pickup_delivery: 'PU + DEL', install_only: 'INST ONLY', delivery_install: 'DEL + INST', crating_shipping: 'SHIPPING' };

const addrLine = (a) => (a && a.street ? [a.street, a.city, [a.state || 'CA', a.zip].filter(Boolean).join(' '), a.country && !/^(us|usa|united states)/i.test(a.country) ? a.country : ''].filter(Boolean).join(', ') : '');
const formatAccessNotes = (a) => {
  if (!a || !a.street) return '';
  const bits = [];
  if (a.hours) bits.push(`Hours: ${a.hours}`);
  if (a.loadingDock) bits.push('Loading dock: yes');
  if (a.fits === 'not_sure') bits.push('Not sure it fits through doors/elevator');
  if (a.parkingRestricted) bits.push(`Parking/loading restrictions${a.parkingNote ? ': ' + a.parkingNote : ''}`);
  if (a.technicalCarry) bits.push(`TECHNICAL CARRY (tight spaces/backyard)${(a.sitePhotos || []).length ? `, ${a.sitePhotos.length} path photo(s)` : ''}`);
  if (a.highInstall) bits.push('HIGH / ABOVE-STAIRWELL INSTALL');
  if (a.floor) bits.push(`Floor ${a.floor}`);
  const flights = parseInt(a.stairs, 10) > 0 ? `${parseInt(a.stairs, 10) >= 4 ? '4+' : parseInt(a.stairs, 10)} flight(s) of stairs` : (a.steps ? 'a few steps' : '');
  if (a.elevator) bits.push('Elevator: yes' + (flights ? ` · also ${flights}` : ''));
  else if (flights) bits.push(`${flights}, no elevator`);
  else bits.push('Ground level, no elevator');
  if (a.centerHeight || a.wallType || a.hardware) bits.push(`Hang at ${a.centerHeight || 57}" center${a.wallType && a.wallType !== 'Not sure' ? ', ' + a.wallType + ' wall' : ', wall type unknown'}${a.hardware ? ', hardware: ' + a.hardware : ''}${a.wallPhotos && a.wallPhotos.length ? `, ${a.wallPhotos.length} wall photo(s)` : ''}`);
  if (a.notes) bits.push(a.notes);
  return bits.join(' · ');
};
const accessNotes = formatAccessNotes;
const itemsText = (items = []) => items.map((it) => {
  const dims = [it.w, it.h, it.d].filter(Boolean).join(' x ');
  const fmtN = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n.toLocaleString('en-US') : String(s ?? ''); };
  return [`${fmtN(it.qty || 1)}x ${it.description || 'Item'}`, `type: ${typeLabel(it)}`, framingText(it), dims && `${dims} in`, it.weightUnsure ? 'weight not sure (CAD review)' : (it.weight && `~${fmtN(it.weight)} lb`), it.fragile && 'SPECIAL HANDLING', it.value && `value $${Number(String(it.value).replace(/,/g, '')).toLocaleString()}`,
    it.photos && it.photos.length && `${it.photos.length} photo(s)`].filter(Boolean).join(', ');
}).join('\n') + (config.crating ? '' : '');

function rowsForOrder(o) {
  const svc = SERVICES[o.service];
  const heavy = (o.items || []).some((it) => Number(it.weight) > 150);
  const payer = o.payer === 'me' ? `${o.contact.name}${o.contact.company ? ' / ' + o.contact.company : ''}`
    : o.payer === 'partner' ? `${o.partner.name || 'Referral partner'} (referral partner)` : `${o.payerOther.name || ''} ${o.payerOther.email || ''}`.trim();
  const paid = o.payment && (o.payment.status === 'paid' || o.payment.status === 'ach_processing');
  const achNote = o.payment && o.payment.status === 'ach_processing' ? 'ACH processing: ' : '';
  const base = {
    'Job Completion': 'FALSE',
    Date: o.schedule.date ? sheetDate(o.schedule.date) : '',
    'Route': o.schedule.date ? ((dayInfo(new Date(o.schedule.date + 'T12:00:00Z')).label) || o.schedule.region) : 'Shipping',
    'JOB TYPE': JOB_TYPE[o.service],
    'Job Assignments': 'PENDINGJOB',
    'TOWN REF': (svc.needsPickup && o.service === 'pickup' ? o.pickup.city : o.dropoff.city) || o.pickup.city || '',
    'Update Status': 'NEW ONLINE ORDER',
    'Update Notes': `Online order ${o.id} · est. $${Number(o.quote.total).toLocaleString('en-US')} · submitted ${new Date(o.createdAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}${o.rush ? ' · RUSH' : ''}${o.dedicated ? ' · DEDICATED TRIP (do not displace existing jobs)' : ''}${o.service === 'crating_shipping' ? ' · SHIPPING: ' + require('./shiptext').lines(o).map(([k, v]) => k + ': ' + v).join(' | ') : o.crating ? ' · CRATING REQUESTED (outsourced)' : ''}${o.contact.clientType ? ' · client type: ' + o.contact.clientType : ''}${o.partner && o.partner.name ? ' · referred by ' + o.partner.name : ''}`,
    'Arrival Time Window': o.schedule.window || '',
    'Item(s) and dimensions, weight, value, etc-': itemsText(o.items),
    'PU Address & City': svc.needsPickup ? addrLine(o.pickup) : '',
    'PU Business Name': svc.needsPickup ? o.pickup.business || '' : '',
    'PU Contact Name': svc.needsPickup ? o.pickup.contactName || '' : '',
    'PU Contact Phone #': svc.needsPickup ? o.pickup.contactPhone || '' : '',
    'PU Notes': svc.needsPickup ? accessNotes(o.pickup) : '',
    'Pickup Helper Status': svc.needsPickup && heavy ? 'Need Helper' : '',
    'DE Address & City': addrLine(o.dropoff),
    'DE Business Name': o.dropoff.business || '',
    'DE Contact Name': o.dropoff.contactName || '',
    'DE Contact Phone #': o.dropoff.contactPhone || '',
    'DE Notes (stairs etc.)': accessNotes(o.dropoff),
    'Delivery Helper Status': o.dropoff.street && heavy ? 'Need Helper' : '',
    "Who's paying?": payer,
    'Amount Due': `$${Number(o.quote.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    'Payment Status': paid ? achNote + (o.quote.paymentPlan === 'deposit' ? `${config.payment.depositPercent}% paid at booking, balance due ${o.quote.balanceWhen}` : 'Paid in full at booking')
      : 'Pending Job',
    'Amount Paid': paid ? `$${Number(o.payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
    'Pymnt method': o.payment ? ({
      stripe: 'Stripe (TEST)', stripe_ach: 'Stripe ACH (TEST)', stripe_card: 'Stripe card (TEST)',
      mock: 'Card (MOCK)', mock_card: 'Card (MOCK)', mock_ach: 'ACH (MOCK)',
      mock_apple_pay: 'Apple Pay (MOCK)', mock_google_pay: 'Google Pay (MOCK)',
    }[o.payment.method] || o.payment.method || '') : '',
    'Payment Notes': [
      paid && o.quote.paymentPlan === 'deposit' && `${config.payment.depositPercent}% ($${Number(o.payment.amount).toFixed(2)}) paid at booking; BALANCE $${o.quote.balanceDue.toFixed(2)} DUE ${o.quote.balanceWhen.toUpperCase()}`,
      paid && o.quote.paymentPlan === 'full' && 'Paid in full at booking',
      o.payment && o.payment.saved && 'payment method saved for future orders',
      o.payment && o.payment.last4 && `${o.payment.bank ? 'bank' : 'card'} ending ${o.payment.last4}`,
      o.payment && o.payment.ref && `ref ${o.payment.ref}`,
    ].filter(Boolean).join(' · '),
  };
  const rows = [base];
  // Cross-region pickup + delivery: one van alternates weeks, so the delivery leg goes on the next opposite-region week (same as CAD's PU row + DEL row practice).
  const rPU = svc.needsPickup ? regionFor(o.pickup) : null, rDO = o.dropoff.street ? regionFor(o.dropoff) : null;
  const later = !!(o.schedule.deliveryLater && o.schedule.deliveryDate && svc.needsPickup);
  if (o.service !== 'crating_shipping' && ((rPU && rDO && rPU !== rDO) || later)) {
    // Customer-chosen later delivery date wins; otherwise cross-region delivery goes on the next opposite-region route day.
    const delDay = later ? { date: o.schedule.deliveryDate } : availableDays(o.dropoff, { from: new Date(o.schedule.date + 'T12:00:00Z'), count: 1, order: o })[0];
    const pu = { ...base, 'JOB TYPE': 'PU', 'TOWN REF': o.pickup.city || '', 'DE Address & City': '', 'DE Business Name': '', 'DE Contact Name': '', 'DE Contact Phone #': '', 'DE Notes (stairs etc.)': '', 'Delivery Helper Status': '' };
    const de = { ...base, 'JOB TYPE': JOB_TYPE[o.service].replace('PU + ', ''), Date: delDay ? sheetDate(delDay.date) : 'TBD', Route: delDay ? (delDay.routeLabel || dayInfo(new Date(delDay.date + 'T12:00:00Z')).label) : (rDO || ''), 'Arrival Time Window': '', 'Update Notes': base['Update Notes'] + (later ? ' · delivery leg (customer chose a later delivery date)' : ' · delivery leg (cross-region)') };
    if (de['JOB TYPE'] === 'PU + DEL') de['JOB TYPE'] = 'DEL';
    rows.splice(0, 1, pu, de);
  }
  return rows.map((r) => COLUMNS.map((c) => r[c] ?? ''));
}

const csvCell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

const FILE = path.join(require('./storage').dir('data'), 'schedule-2026.csv');
function appendOrder(o) {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, toCsv([COLUMNS]));
  fs.appendFileSync(FILE, toCsv(rowsForOrder(o)));
}
function rebuild(orders) { fs.writeFileSync(FILE, toCsv([COLUMNS, ...orders.flatMap(rowsForOrder)])); return FILE; }

module.exports = { COLUMNS, LETTERS, rowsForOrder, appendOrder, rebuild, toCsv, FILE, formatAccessNotes };
