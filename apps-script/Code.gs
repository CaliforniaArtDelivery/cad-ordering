/**
 * CAD online-ordering -> SCHEDULE sheet bridge (Google Apps Script, owned by the CAD Google account).
 *
 * Deploy: Extensions > Apps Script (opened from the sheet the orders should land in) > paste this file > Project Settings >
 * Script properties: SECRET (long random string, same value as the Render env SHEETS_WEBHOOK_SECRET),
 * TARGET_SPREADSHEET_ID (the sheet id; point it at the TEST COPY first, then at the live SCHEDULE sheet),
 * ALERT_EMAIL (chadsbotchild@mail.grokbot.com). Run installTriggers() once. Deploy > New deployment > Web app,
 * Execute as: Me, Who has access: Anyone (the SECRET is the key). Copy the /exec URL into Render as SHEETS_WEBHOOK_URL.
 *
 * What it does (and never does):
 *  - order      : writes the order's schedule rows to the "ONLINE ORDERS" tab (mock-payment orders: "TEST ORDERS"), logs the
 *                 raw order in "ONLINE ORDERS RAW LOG", reads back every cell it wrote and reports verified true/false.
 *                 Idempotent by order id (never writes the same order twice, even if a retry arrives mid-way).
 *  - days       : read-only digest of SCHEDULE 2026 per date (route text, job rows, off-day flags) for the booking site.
 *  - alert      : sends an alert email.
 *  - verifyAll(): independent checker (time trigger every 30 min) that re-reads every logged order and the sheet, and emails
 *                 on any missing/duplicate/changed row or a date the sheet now marks off.
 *  It NEVER edits or moves rows on SCHEDULE 2026 or any other existing tab. It only creates and appends to its own tabs.
 */
var TAB_CAL = 'ROUTE CALENDAR';
var TAB_MAIN = 'SCHEDULE 2026', TAB_ORDERS = 'ONLINE ORDERS', TAB_TEST = 'TEST ORDERS', TAB_RAW = 'ONLINE ORDERS RAW LOG';
var NCOLS = 35; // A..AI (the SCHEDULE 2026 table; the grid has one more empty column)
var NUM_COLS = [31, 33]; // AE Amount Due, AG Amount Paid (1-based)
var CHUNK = 40000;
var JOB_RE = /^(PU|DEL|INST|DE-INST|MOVING|On-site Move|SHIPPING)/i;
var OFF_RE = /(\boff day\b|\bday off\b|\bdays off\b|christmas day off|out of office|\bvacation\b|\bholiday\b|\bclosed\b|no schedule|don'?t book)/i;
var NOISE_RE = /send second review/i;

function props_() { return PropertiesService.getScriptProperties(); }
function ss_() { return SpreadsheetApp.openById(props_().getProperty('TARGET_SPREADSHEET_ID')); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function authOk_(s) {
  var want = String(props_().getProperty('SECRET') || ''), got = String(s || '');
  if (!want || want.length < 16 || got.length !== want.length) return false;
  var d = 0; for (var i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
function alertMail_(subject, body, to) {
  try { MailApp.sendEmail(to || props_().getProperty('ALERT_EMAIL') || 'chadsbotchild@mail.grokbot.com', subject, body); } catch (e) { console.error('alert mail failed: ' + e); }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!authOk_(p.secret)) return json_({ ok: false, error: 'unauthorized' });
    if (p.action === 'days') return json_(handleDays_());
    return json_({ ok: true, hello: 'CAD schedule bridge', time: new Date().toISOString() });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var b = {};
  try {
    b = JSON.parse(e.postData.contents);
    if (!authOk_(b.secret)) return json_({ ok: false, error: 'unauthorized' });
    if (b.action === 'order') return json_(handleOrder_(b));
    if (b.action === 'days') return json_(handleDays_());
    if (b.action === 'seedCalendar') return json_(handleSeed_(b));
    if (b.action === 'reconcile') return json_(handleReconcile_(b));
    if (b.action === 'alert') { alertMail_(String(b.subject || 'CAD sheet alert'), String(b.body || ''), b.to); return json_({ ok: true }); }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    alertMail_('ALERT: schedule bridge error' + (b.orderId ? ' for ' + b.orderId : ''), String(err) + '\n' + (err && err.stack || ''));
    return json_({ ok: false, error: String(err) });
  }
}

// ---------- helpers ----------
function chunks_(s) { var out = []; s = String(s || ''); for (var i = 0; i < s.length; i += CHUNK) out.push(s.substr(i, CHUNK)); return out.length ? out : ['']; }
function norm_(h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase(); }

function ensureTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var main = ss.getSheetByName(TAB_MAIN);
  sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < NCOLS) sh.insertColumnsAfter(sh.getMaxColumns(), NCOLS - sh.getMaxColumns());
  main.getRange(1, 1, 2, NCOLS).copyTo(sh.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  for (var c = 1; c <= NCOLS; c++) sh.setColumnWidth(c, main.getColumnWidth(c));
  sh.getRange(1, 2).setValue(name === TAB_TEST ? 'TEST ORDERS (mock payments only; never real jobs)' : 'ONLINE ORDERS: written by the ordering site. Existing SCHEDULE 2026 rows are never touched.');
  sh.setFrozenRows(2);
  sh.setTabColor(name === TAB_TEST ? '#999999' : '#0b8043');
  return sh;
}
function ensureRaw_(ss) {
  var sh = ss.getSheetByName(TAB_RAW);
  if (sh) return sh;
  sh = ss.insertSheet(TAB_RAW);
  sh.getRange(1, 1, 1, 12).setValues([['Key (order|event)', 'Logged at', 'Event', 'Order status', 'Test?', 'Schedule rows', 'Tab', 'First row', 'Pickup date', 'Delivery date', 'Client', 'Total']]);
  sh.getRange(1, 13, 1, 2).setValues([['RAW ORDER JSON (chunk 1..n, 40k chars each, continues to the right)', '']]);
  sh.setFrozenRows(1);
  sh.setTabColor('#674ea7');
  return sh;
}
// Layout of a raw-log row: A..L as above, M = number of raw chunks, N = number of expected-row chunks, then raw chunks, then expected chunks.
function readRawRow_(vals) {
  var nr = Number(vals[12]) || 0, ne = Number(vals[13]) || 0;
  var raw = vals.slice(14, 14 + nr).join(''), exp = vals.slice(14 + nr, 14 + nr + ne).join('');
  return { key: vals[0], loggedAt: vals[1], event: vals[2], status: vals[3], test: vals[4] === true || vals[4] === 'TRUE', nrows: Number(vals[5]) || 0, tab: vals[6], firstRow: Number(vals[7]) || 0, puDate: vals[8], delDate: vals[9], client: vals[10], total: vals[11], raw: raw, expected: exp ? JSON.parse(exp) : [] };
}
function findKey_(raw, key) {
  var last = raw.getLastRow(); if (last < 2) return 0;
  var col = raw.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (col[i][0] === key) return i + 2;
  return 0;
}
// Rows of an order inside a tab: column J starts with "ONLINE ORDER <id> ·".
function findOrderRows_(sh, id) {
  var last = sh.getLastRow(); if (last < 3) return [];
  var col = sh.getRange(3, 10, last - 2, 1).getValues(), out = [], tag = 'ONLINE ORDER ' + id + ' ';
  for (var i = 0; i < col.length; i++) if (String(col[i][0]).indexOf(tag) === 0) out.push(i + 3);
  return out;
}
function sameCell_(exp, act, colIdx) {
  if (colIdx === 0) return act === false || act === 'FALSE' || act === false;
  if (typeof exp === 'number') return Number(act) === exp;
  return String(act == null ? '' : act) === String(exp == null ? '' : exp);
}
function diffRows_(sh, rowNums, expected) {
  var diffs = [];
  for (var r = 0; r < expected.length; r++) {
    var act = sh.getRange(rowNums[r], 1, 1, NCOLS).getValues()[0];
    for (var c = 0; c < NCOLS; c++) if (!sameCell_(expected[r][c], act[c], c)) diffs.push('row ' + rowNums[r] + ' col ' + (c + 1) + ': expected [' + String(expected[r][c]).slice(0, 80) + '] got [' + String(act[c]).slice(0, 80) + ']');
  }
  return diffs;
}

// ---------- order ----------
function handleOrder_(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = ss_(), raw = ensureRaw_(ss);
    var key = b.orderId + '|' + b.event, isConfirmed = b.event === 'confirmed';
    var existingKey = findKey_(raw, key);
    if (existingKey) {
      var rr = readRawRow_(raw.getRange(existingKey, 1, 1, raw.getLastColumn()).getValues()[0]);
      return { ok: true, duplicate: true, rowCount: rr.nrows, tab: rr.tab, firstRow: rr.firstRow };
    }
    var n = isConfirmed ? (b.rows || []).length : 0;
    if (isConfirmed) {
      if (!n) throw new Error('confirmed order without rows');
      for (var i = 0; i < n; i++) if (b.rows[i].length !== NCOLS) throw new Error('row ' + i + ' has ' + b.rows[i].length + ' cells, expected ' + NCOLS);
      var main = ss.getSheetByName(TAB_MAIN), hdr = main.getRange(2, 1, 1, NCOLS).getValues()[0];
      for (var h = 0; h < NCOLS; h++) if (norm_(hdr[h]) !== norm_(b.columns[h])) throw new Error('SCHEDULE 2026 header changed at column ' + (h + 1) + ': sheet "' + hdr[h] + '" vs site "' + b.columns[h] + '". Nothing written.');
    }
    if (!isConfirmed) {
      appendRaw_(raw, b, key, 0, '', 0);
      return { ok: true, logged: true, rowsWritten: 0 };
    }
    var sh = ensureTab_(ss, b.test ? TAB_TEST : TAB_ORDERS);
    var present = findOrderRows_(sh, b.orderId), start, written = 0;
    if (present.length === n) {
      start = present[0]; // already there (a retry after a half-finished attempt): verify, don't write again
    } else if (present.length > 0) {
      throw new Error('PARTIAL ROWS for ' + b.orderId + ' in ' + sh.getName() + ' (' + present.length + ' of ' + n + '). Not writing more; fix by hand.');
    } else {
      start = Math.max(sh.getLastRow() + 1, 3);
      if (start + n > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), n + 200);
      var area = sh.getRange(start, 1, n, NCOLS);
      area.setNumberFormat('@');
      var vals = b.rows.map(function (row) { return row.map(function (v, c) { return (typeof v === 'number' || typeof v === 'boolean') ? '' : (v == null ? '' : String(v)); }); });
      area.setValues(vals);
      for (var r = 0; r < n; r++) {
        sh.getRange(start + r, 1).setNumberFormat('General');
        for (var q = 0; q < NUM_COLS.length; q++) {
          var cc = NUM_COLS[q], v = b.rows[r][cc - 1];
          if (typeof v === 'number') sh.getRange(start + r, cc).setNumberFormat('$#,##0.00').setValue(v);
        }
      }
      try { var ck = sh.getRange(start, 1, n, 1); if (ck.insertCheckboxes) ck.insertCheckboxes(); } catch (ckErr) { /* cosmetic only */ }
      sh.getRange(start, 1, n, 1).insertCheckboxes();
      sh.getRange(start, 1, n, 1).setValue(false);
      written = n;
      SpreadsheetApp.flush();
    }
    var rowNums = []; for (var k = 0; k < n; k++) rowNums.push(start + k);
    var diffs = diffRows_(sh, rowNums, b.rows);
    if (diffs.length) { alertMail_('ALERT: read-back mismatch for online order ' + b.orderId, diffs.slice(0, 30).join('\n')); return { ok: true, rowsWritten: written, verified: false, verifyDetail: diffs.slice(0, 5).join(' | '), tab: sh.getName(), firstRow: start }; }
    appendRaw_(raw, b, key, n, sh.getName(), start);
    return { ok: true, rowsWritten: written || n, verified: true, tab: sh.getName(), firstRow: start };
  } finally { lock.releaseLock(); }
}
function appendRaw_(raw, b, key, n, tab, first) {
  var s = b.summary || {};
  var rc = chunks_(b.raw), ec = chunks_(JSON.stringify(b.rows || []));
  var row = [key, new Date().toISOString(), b.event, b.status, !!b.test, n, tab, first, s.pickupDate || '', s.deliveryDate || '', s.client || '', s.total || '', rc.length, ec.length].concat(rc, ec);
  if (raw.getMaxColumns() < row.length) raw.insertColumnsAfter(raw.getMaxColumns(), row.length - raw.getMaxColumns());
  raw.getRange(raw.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row.map(function (v) { return typeof v === 'boolean' ? String(v).toUpperCase() : v; })]);
}

// ---------- days ----------
function parseDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var iso = String(v == null ? '' : v).match(/^\s*(\d{4})-(\d{2})-(\d{2})\s*$/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var m = String(v == null ? '' : v).match(/^\s*([A-Za-z]{3,5})\.?,?\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/);
  if (!m) return null;
  var mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].substr(0, 3).toLowerCase());
  if (mon < 0) return null;
  var day = Number(m[3]), wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].substr(0, 3).toLowerCase());
  var years = m[4] ? [Number(m[4])] : [2026, 2027, 2025, 2028];
  for (var i = 0; i < years.length; i++) {
    var d = new Date(Date.UTC(years[i], mon, day, 12));
    if (d.getUTCMonth() === mon && d.getUTCDate() === day && (wd < 0 || d.getUTCDay() === wd)) return years[i] + '-' + ('0' + (mon + 1)).slice(-2) + '-' + ('0' + day).slice(-2);
  }
  return null;
}
function handleDays_() {
  var ss = ss_(), tz = ss.getSpreadsheetTimeZone(), days = {};
  function rec(iso) { return days[iso] || (days[iso] = { routes: [], jobRows: 0, off: false, offWhy: '' }); }
  var main = ss.getSheetByName(TAB_MAIN), last = main.getLastRow();
  if (last >= 3) {
    var v = main.getRange(3, 1, last - 2, 9).getValues(); // A..I
    for (var i = 0; i < v.length; i++) {
      var iso = parseDate_(v[i][1], tz); if (!iso) continue;
      var d = rec(iso), e = String(v[i][4] || '').trim(), f = String(v[i][5] || '').trim(), st = String(v[i][8] || '');
      if (e && !NOISE_RE.test(e) && d.routes.indexOf(e) < 0) d.routes.push(e);
      if (JOB_RE.test(f)) d.jobRows++;
      if ((e && !NOISE_RE.test(e) && OFF_RE.test(e)) || /don'?t book/i.test(st)) { d.off = true; d.offWhy = e || st; }
    }
  }
  var cal = ss.getSheetByName(TAB_CAL);
  if (cal && cal.getLastRow() >= 2) {
    var cv = cal.getRange(2, 1, cal.getLastRow() - 1, 8).getValues();
    for (var q = 0; q < cv.length; q++) {
      var ciso = parseDate_(cv[q][0], tz); if (!ciso) continue;
      var cd = rec(ciso);
      cd.calendar = true;
      cd.open = String(cv[q][2]).trim().toUpperCase() === 'OPEN';
      cd.zones = String(cv[q][3] || '').split(/[,;\s]+/).filter(function (z) { return z; });
      cd.capacity = Number(cv[q][4]) || 0;
      cd.crew = String(cv[q][5] || ''); cd.vehicle = String(cv[q][6] || ''); cd.calNote = String(cv[q][7] || '');
    }
  }
  var on = ss.getSheetByName(TAB_ORDERS);
  if (on && on.getLastRow() >= 3) {
    var o = on.getRange(3, 2, on.getLastRow() - 2, 5).getValues(); // B..F
    for (var j = 0; j < o.length; j++) { var iso2 = parseDate_(o[j][0], tz); if (iso2 && JOB_RE.test(String(o[j][4] || ''))) rec(iso2).jobRows++; }
  }
  return { ok: true, days: days, sheetVersion: main.getLastRow(), generatedAt: new Date().toISOString() };
}

// ---------- ROUTE CALENDAR (the one authoritative calendar; Samantha owns it) ----------
// Seeds missing dates only; never overwrites or reorders a row she has touched.
function handleSeed_(b) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = ss_(), tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName(TAB_CAL);
    if (!sh) {
      sh = ss.insertSheet(TAB_CAL);
      sh.getRange(1, 1, 1, 8).setValues([['Date (yyyy-mm-dd)', 'Day', 'Status (OPEN/CLOSED)', 'Areas served (ids)', 'Capacity (job rows)', 'Crew', 'Vehicle', 'Notes']]);
      sh.setFrozenRows(1); sh.setTabColor('#e69138');
    }
    var have = {}, last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { var d = parseDate_(r[0], tz); if (d) have[d] = true; });
    var add = (b.days || []).filter(function (d) { return !have[d[0]]; });
    if (add.length) {
      var rng = sh.getRange(last + 1, 1, add.length, 8);
      rng.setNumberFormat('@'); rng.setValues(add.map(function (d) { return [d[0], d[1], d[2], d[3], String(d[4]), d[5] || '', d[6] || '', d[7] || '']; }));
    }
    return { ok: true, seeded: add.length, existing: Object.keys(have).length };
  } finally { lock.releaseLock(); }
}

// ---------- two-way reconciliation ----------
// b.orderIds: every order the server has CONFIRMED (non-test). Reports (1) paid orders missing from ONLINE ORDERS and
// (2) rows in ONLINE ORDERS whose order id the server does not know (a schedule row without an order).
function handleReconcile_(b) {
  var ss = ss_(), sh = ss.getSheetByName(TAB_ORDERS), known = {}, missing = [], orphans = [], seen = {};
  (b.orderIds || []).forEach(function (id) { known[id] = true; });
  if (sh && sh.getLastRow() >= 3) {
    sh.getRange(3, 10, sh.getLastRow() - 2, 1).getValues().forEach(function (r, i) {
      var m = String(r[0]).match(/^ONLINE ORDER (\S+) /);
      if (m) { seen[m[1]] = (seen[m[1]] || 0) + 1; if (!known[m[1]]) orphans.push({ orderId: m[1], row: i + 3 }); }
    });
  }
  Object.keys(known).forEach(function (id) { if (!seen[id]) missing.push(id); });
  var out = { ok: true, missing: missing, orphans: orphans, checked: Object.keys(known).length };
  if (missing.length || orphans.length) alertMail_('ALERT: schedule and orders do not match (' + missing.length + ' paid order(s) missing, ' + orphans.length + ' row(s) without an order)', 'Paid orders missing from ONLINE ORDERS: ' + missing.join(', ') + '\nRows in ONLINE ORDERS with no matching order: ' + orphans.map(function (o) { return o.orderId + ' (row ' + o.row + ')'; }).join(', '));
  return out;
}

// ---------- independent verifier (time trigger) ----------
var VERIFY_COLS = [2, 6, 8, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 31]; // Date, JOB TYPE, TOWN REF, Items, PU a-d + notes, DE a-d + notes, Amount Due
function verifyAll() {
  var ss = ss_(), raw = ss.getSheetByName(TAB_RAW); if (!raw || raw.getLastRow() < 2) return { checked: 0 };
  var days = handleDays_().days, tz = ss.getSpreadsheetTimeZone();
  var cutoff = Date.now() - 60 * 864e5, last = raw.getLastRow(), problems = [], checked = 0;
  var state = {}; try { state = JSON.parse(props_().getProperty('VERIFY_STATE') || '{}'); } catch (x) { state = {}; }
  var all = raw.getRange(2, 1, last - 1, raw.getLastColumn()).getValues();
  for (var i = 0; i < all.length; i++) {
    var r = readRawRow_(all[i]);
    if (r.event !== 'confirmed' || Date.parse(r.loggedAt) < cutoff) continue;
    checked++;
    var id = String(r.key).split('|')[0], sh = ss.getSheetByName(r.tab), msg = [];
    if (!sh) { msg.push('tab "' + r.tab + '" is missing'); }
    else {
      var rows = findOrderRows_(sh, id);
      if (rows.length === 0) msg.push('MISSING from ' + r.tab + ' (was logged as written at row ' + r.firstRow + ')');
      else if (rows.length !== r.expected.length) msg.push('has ' + rows.length + ' rows, expected ' + r.expected.length + (rows.length > r.expected.length ? ' (DUPLICATE?)' : ' (a row is missing)'));
      else {
        for (var k = 0; k < rows.length; k++) {
          var act = sh.getRange(rows[k], 1, 1, NCOLS).getValues()[0];
          VERIFY_COLS.forEach(function (c) { var e = r.expected[k][c - 1]; if (!sameCell_(e, act[c - 1], c - 1)) msg.push('row ' + rows[k] + ' col ' + c + ' CHANGED: ordered [' + String(e).slice(0, 60) + '] now [' + String(act[c - 1]).slice(0, 60) + ']'); });
          var iso = parseDate_(act[1], tz), day = iso && days[iso];
          if (day && day.off) msg.push('row ' + rows[k] + ' is on ' + act[1] + ', which the sheet marks off ("' + day.offWhy + '")');
        }
      }
    }
    if (msg.length) {
      var crit = msg.some(function (m) { return /MISSING|DUPLICATE|missing|marks off|tab /.test(m) || /col (2|8|14|21|31) CHANGED/.test(m); });
      var h = msg.join('|'), st = state[id] || {};
      // CRITICAL: alert at once and again every 12 h until fixed. WARNING: alert once per change.
      if (st.h !== h || (crit && Date.now() - (st.at || 0) > 12 * 3600e3)) { state[id] = { h: h, at: Date.now() }; problems.push((crit ? 'CRITICAL ' : 'WARNING ') + id + ' (' + r.client + ', ' + r.puDate + '): ' + msg.join('; ')); }
    } else if (state[id]) { delete state[id]; }
  }
  props_().setProperty('VERIFY_STATE', JSON.stringify(state));
  if (problems.length) alertMail_('ALERT: online-order check found ' + problems.length + ' problem(s) on the schedule', problems.join('\n\n') + '\n\nCHANGED means a team member edited the row after booking. If a client date or address changed on purpose, make sure the client was told.');
  return { checked: checked, problems: problems.length };
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'verifyAll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verifyAll').timeBased().everyMinutes(30).create();
}
