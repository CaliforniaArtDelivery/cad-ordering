/**
 * INDEPENDENT checker: re-derives what the schedule rows must say straight from the raw order JSON (it does NOT import
 * lib/schedule.js) and compares it with the rows that are actually in the sheet. Deterministic, no AI. It flags; it never edits.
 * verifyOrder(order, rows) -> [{ severity: 'CRITICAL'|'WARNING', msg }]
 * Column letters follow SCHEDULE 2026: B date, F type, H town, J update notes, M items, N-R pickup, U-Y delivery, AD-AI payment.
 */
const L = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}${d.getUTCFullYear() === 2026 ? '' : ', ' + d.getUTCFullYear()}`; };
const has = (cell, needle) => !needle || String(cell || '').includes(String(needle));
const num = (s) => Number(String(s ?? '').replace(/,/g, ''));

function expectedLegs(o) {
  const s = o.service;
  if (s === 'crating_shipping') return [{ type: 'PENDING JOB', date: 'TBD' }];
  if (s === 'install_only') return [{ type: 'INST ONLY', date: dateText(o.schedule.date) }];
  return [{ type: 'PU', date: dateText(o.schedule.date) }, { type: s === 'delivery_install' ? 'DEL + INST' : 'DEL', date: o.schedule.deliveryDate ? dateText(o.schedule.deliveryDate) : null }];
}

function verifyOrder(o, rows) {
  const out = []; const bad = (severity, msg) => out.push({ severity, msg });
  const legs = expectedLegs(o);
  if (rows.length !== legs.length) { bad('CRITICAL', `expected ${legs.length} row(s), found ${rows.length}`); return out; }
  legs.forEach((leg, i) => {
    const r = rows[i], tag = `${leg.type} row`;
    if (String(r[L('F')]) !== leg.type) bad('CRITICAL', `${tag}: JOB TYPE "${r[L('F')]}" should be "${leg.type}"`);
    if (leg.date && String(r[L('B')]) !== leg.date) bad('CRITICAL', `${tag}: Date "${r[L('B')]}" should be "${leg.date}"`);
    if (!leg.date && String(r[L('B')]) === '') bad('CRITICAL', `${tag}: date empty`);
    if (!has(r[L('J')], 'ONLINE ORDER ' + o.id)) bad('CRITICAL', `${tag}: order id missing from Update Notes`);
    const pickupSide = o.service === 'install_only' ? o.dropoff : o.pickup, deliverySide = o.service === 'install_only' ? null : o.dropoff;
    const chk = (sideName, side, cols) => {
      if (!side || !side.street) return;
      const [addr, biz, nm, ph, notes] = cols.map(L);
      [side.street, side.city, side.zip].forEach((x) => { if (x && !has(r[addr], x)) bad('CRITICAL', `${tag}: ${sideName} address lacks "${x}"`); });
      if (side.business && !has(r[biz], side.business)) bad('CRITICAL', `${tag}: ${sideName} business`);
      if (side.contactName && String(r[nm]) !== side.contactName) bad('CRITICAL', `${tag}: ${sideName} contact name "${r[nm]}"`);
      if (side.contactPhone && String(r[ph]) !== side.contactPhone) bad('CRITICAL', `${tag}: ${sideName} phone "${r[ph]}"`);
      if (side.notes && !has(r[notes], side.notes)) bad('CRITICAL', `${tag}: ${sideName} notes lost ("${String(side.notes).slice(0, 30)}...")`);
      if (side.hours && !has(r[notes], side.hours)) bad('WARNING', `${tag}: ${sideName} hours missing from notes`);
      if (side.accessMode === 'stairs' && side.stairFlights && !has(r[notes], String(side.stairFlights))) bad('WARNING', `${tag}: ${sideName} stairs flights not in notes`);
      if (side.accessMode === 'not_sure' && !/ACCESS REVIEW|not sure/i.test(r[notes])) bad('CRITICAL', `${tag}: ${sideName} "Not sure" access is not flagged for review`);
    };
    chk('pickup', pickupSide, ['N', 'O', 'P', 'Q', 'R']);
    chk('delivery', deliverySide, ['U', 'V', 'W', 'X', 'Y']);
    (o.items || []).forEach((it) => {
      if (!has(r[L('M')], it.description)) bad('CRITICAL', `${tag}: item "${it.description}" missing`);
      if (it.weight && !has(r[L('M')], Number(it.weight).toLocaleString('en-US'))) bad('CRITICAL', `${tag}: weight ${it.weight} missing for "${it.description}"`);
      [it.w, it.h, it.d].filter(Boolean).forEach((d) => { if (!has(r[L('M')], d)) bad('CRITICAL', `${tag}: dimension ${d} missing for "${it.description}"`); });
      if (it.value && !has(r[L('M')], Number(String(it.value).replace(/,/g, '')).toLocaleString('en-US'))) bad('WARNING', `${tag}: value missing for "${it.description}"`);
    });
    const J = String(r[L('J')]);
    if (o.contact && o.contact.name && !has(J, o.contact.name)) bad('CRITICAL', `${tag}: client name missing from notes`);
    if (o.contact && o.contact.email && !has(J, o.contact.email)) bad('CRITICAL', `${tag}: client email missing from notes`);
    if (o.contact && o.contact.phone && !has(J, o.contact.phone)) bad('CRITICAL', `${tag}: client phone missing from notes`);
    if (o.notes && String(o.notes).trim() && !has(J, String(o.notes).trim())) bad('CRITICAL', `${tag}: client notes lost`);
    if (o.rush && !/RUSH/.test(J)) bad('WARNING', `${tag}: rush flag missing`);
    if ((o.items || []).some((it) => num(it.weight) > 150) && !/NEED HELPER/.test(r[L('G')])) bad('CRITICAL', `${tag}: heavy piece but Job Assignments is not NEED HELPER`);
    if (i === 0) { // price and payment on the first row only
      if (num(r[L('AE')]) !== Number(o.quote.total)) bad('CRITICAL', `${tag}: Amount Due ${r[L('AE')]} should be ${o.quote.total}`);
      if (o.payment && ['paid'].includes(o.payment.status) && num(r[L('AG')]) !== Number(o.payment.amount)) bad('CRITICAL', `${tag}: Amount Paid ${r[L('AG')]} should be ${o.payment.amount}`);
      if (o.payment && o.payment.ref && !has(r[L('AI')], o.payment.ref)) bad('WARNING', `${tag}: payment reference missing`);
    } else if (String(r[L('AE')]) !== 'X') bad('WARNING', `${tag}: second row should show X for Amount Due`);
  });
  return out;
}
module.exports = { verifyOrder, expectedLegs, dateText };
