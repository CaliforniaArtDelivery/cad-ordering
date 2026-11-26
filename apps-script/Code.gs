/**
 * CAD online-ordering -> SCHEDULE sheet bridge (Google Apps Script, owned by the CAD Google account).
 * v2 "ONE TAB" (Chad, Nov 25 2026): every online order goes onto the ONE schedule tab (TARGET_TAB_NAME), exactly the way a
 * team member adds a job. No ONLINE ORDERS / TEST ORDERS / RAW LOG tabs, no other tabs, no logs.
 *
 * Deploy: open the "CAD online orders bridge" project > replace Code.gs with this file > Save > Run migrateToOneTab once
 * (moves any old ONLINE ORDERS / TEST ORDERS rows onto SCHEDULE 2026 and deletes the three old tabs) >
 * Deploy > Manage deployments > Edit > Version: New version > Deploy (same /exec URL).
 * Script properties: SECRET, TARGET_SPREADSHEET_ID, TARGET_TAB_NAME, ALERT_EMAIL, DAYS_SPREADSHEET_ID (optional), DAYS_TAB_NAME (optional).
 * TARGET_* is where orders are WRITTEN. DAYS_* is the read-only source for route days (defaults to the LIVE schedule
 * 1E4PDjudgBIXnuOtvHO-Ywc4Fp-Gxiy5qr6yGI_4fXhg / SCHEDULE 2026) so the site always mirrors live routes, even in test.
 * TARGET_TAB_NAME is "TEST SCHEDULE 2026" on the test sheet. The live switch is: set TARGET_SPREADSHEET_ID
 * to the live schedule id AND set TARGET_TAB_NAME to "SCHEDULE 2026". Do not switch until Chad says go live.
 * Do not run migrateToOneTab again. Do not change TARGET_* until Chad says go live.
 * If TARGET_TAB_NAME is unset, uses "TEST SCHEDULE 2026" when that tab exists, else "SCHEDULE 2026".
 *
 * Where rows go on SCHEDULE 2026 (the team's own conventions):
 *  - Paid / confirmed order: each leg goes on its date. It fills the first EMPTY pre-made slot row of that date (a row with only
 *    the date and the day's route), keeping the team's date and route text. If the date has no empty slot, a new row is inserted
 *    right under that date's last row (if the date has no rows yet, right after the closest earlier date). TBD dates go to the
 *    PENDING block at the top.
 *  - Quote / review request (not paid): goes in the PENDING block at the top of the tab (rows above the first divider row), marked
 *    the way the team marks tentative jobs: Job Assignments "PENDINGJOB", Update Status "CONTACT THEM!!!", Payment Status
 *    "Pending Job", and Update Notes "ONLINE ORDER <id> \u00B7 PENDING REVIEW ...". When it is approved and paid, those pending rows are
 *    removed and the confirmed rows go on their dates.
 *  - Test (mock-payment) orders: same places, with Update Notes starting "TEST ORDER (not a real job) \u00B7 ".
 *  - The order id lives at the start of Update Notes (column J): "ONLINE ORDER <id> \u00B7 ...". That is how retries, the checker and
 *    the reconcile find an order's rows. Nothing is written anywhere else (small per-order check data sits in Script Properties).
 *
 * Actions: order (write + read-back verify; event "payment" rewrites only the payment columns), days (read-only digest per date,
 * v5 adds each date's stops for route-aware time windows; v6 re-baselines the verifier after a payment update), reconcile, alert, verifyAll() (time trigger).
 */
var TAB_MAIN_DEFAULT = 'SCHEDULE 2026', TAB_TEST_DEFAULT = 'TEST SCHEDULE 2026', TAB_CAL = 'ROUTE CALENDAR';
function tabName_() {
  var n = String(props_().getProperty('TARGET_TAB_NAME') || '').trim();
  if (n) return n;
  try {
    var ss = ss_();
    if (ss.getSheetByName(TAB_TEST_DEFAULT)) return TAB_TEST_DEFAULT;
  } catch (e) {}
  return TAB_MAIN_DEFAULT;
}
function main_(ss) {
  ss = ss || ss_();
  var name = tabName_();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Target tab "' + name + '" is missing on the target spreadsheet.');
  return sh;
}
var LEGACY_TABS = ['ONLINE ORDERS', 'TEST ORDERS', 'ONLINE ORDERS RAW LOG'];
var NCOLS = 35; // A..AI (the SCHEDULE 2026 table)
var NUM_COLS = [31, 33]; // AE Amount Due, AG Amount Paid (1-based)
var COL_DATE = 2, COL_ROUTE = 5, COL_TYPE = 6, COL_ASSIGN = 7, COL_STATUS = 9, COL_NOTES = 10, COL_PAYSTATUS = 32;
var JOB_RE = /^(PU|DEL|INST|DE-INST|MOVING|On-site Move|SHIPPING|PENDING JOB)/i;
// TEST (and live) schedule cells in F (JOB TYPE) and AF (Payment Status) have STRICT one-of-list
// dropdowns. A value not on the list is rejected, and Sheets may leave the rest of that setValues
// range blank — that is what left SHIPPING / "Paid" rows empty from F or AF onward.
var JOB_TYPE_OK = { '...': 1, 'PU': 1, 'EXCHANGE': 1, 'DEL': 1, 'PENDING JOB': 1, 'PU + DEL': 1, 'DEL + INST': 1, 'PU + DEL + INST': 1, 'INST ONLY': 1, 'MOVING JOB': 1, 'Appt CHAD': 1, 'Appt JESUS': 1, 'SUPPLY RUN': 1, 'DRIVING': 1, 'MOVING QUOTE': 1, 'Scheduling note': 1, 'STORAGE ': 1, 'VAN Maintenance': 1, 'Donation Haul Away': 1, 'DUMP RUN': 1, 'Marketing': 1, 'FOR HIRE/Hour': 1, 'FOR HIRE/Day': 1, 'HOLIDAY': 1, 'HOTEL': 1, 'APPT JAMEE': 1, 'DE-INST / PU': 1, 'INST LVL 1': 1, 'INST LVL 2': 1, 'INST LVL 3': 1, 'Site Visit': 1, 'SALES/NETWORKING': 1, 'PU + INST': 1, 'DEL/SWAP': 1, 'On-site Move': 1, 'Appt Sam': 1, 'DE-INST': 1, 'DE-INST / RE-INST': 1 };
var PAY_STATUS_OK = { 'AMT DUE': 1, 'Payment Requested': 1, 'PAID': 1, 'CHECK RECEIVED': 1, 'Pending Job': 1, '...': 1, 'CASH RECEIVED': 1, 'Cancelled Job': 1, 'CASH/CHECK HANDOVER': 1 };
function coerceJobType_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || JOB_TYPE_OK[s]) return s;
  if (/^shipping$/i.test(s)) return 'PENDING JOB';
  var keys = Object.keys(JOB_TYPE_OK);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === s.toLowerCase()) return keys[i];
  return s;
}
function coercePayStatus_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || PAY_STATUS_OK[s]) return s;
  if (/^paid$/i.test(s)) return 'PAID';
  if (/paid,?\s*balance due/i.test(s)) return 'AMT DUE';
  if (/payment processing/i.test(s)) return 'Payment Requested';
  if (/^invoiced$/i.test(s)) return 'Payment Requested';
  if (/booked,?\s*payment pending/i.test(s)) return 'AMT DUE';
  var keys = Object.keys(PAY_STATUS_OK);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === s.toLowerCase()) return keys[i];
  return s;
}
var OFF_RE = /(\boff day\b|\bday off\b|\bdays off\b|christmas day off|out of office|\bvacation\b|\bholiday\b|\bclosed\b|no schedule|don'?t book)/i;
var NOISE_RE = /send second review/i;
var TEST_TAG = 'TEST ORDER (not a real job) \u00B7 ';
var PEND_TAG = 'PENDING REVIEW: not paid or confirmed yet, CAD to review and contact client \u00B7 ';
// Accept \u00B7 (U+00B7) and \u8DEF (U+8DEF, which the Apps Script editor has sometimes stored in place of \u00B7) plus common bullets.
var TAG_RE = /^(TEST ORDER \(not a real job\) [\u00B7\u8DEF\u2022\u2219] )?ONLINE ORDER (\S+) [\u00B7\u8DEF\u2022\u2219]\s?(PENDING REVIEW)?/;
var STATE_PREFIX = 'O:';

function props_() { return PropertiesService.getScriptProperties(); }
function ss_() { return SpreadsheetApp.openById(props_().getProperty('TARGET_SPREADSHEET_ID')); }
// Read-only source for the `days` digest (route text, off days, job counts for capacity). Writes never use this.
var LIVE_SCHEDULE_ID = '1E4PDjudgBIXnuOtvHO-Ywc4Fp-Gxiy5qr6yGI_4fXhg';
function daysSs_() {
  var id = String(props_().getProperty('DAYS_SPREADSHEET_ID') || LIVE_SCHEDULE_ID).trim() || LIVE_SCHEDULE_ID;
  return SpreadsheetApp.openById(id);
}
function daysSh_() {
  var ss = daysSs_();
  var name = String(props_().getProperty('DAYS_TAB_NAME') || TAB_MAIN_DEFAULT).trim() || TAB_MAIN_DEFAULT;
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Days tab "' + name + '" is missing on the days spreadsheet.');
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function authOk_(s) {
  var want = String(props_().getProperty('SECRET') || ''), got = String(s || '');
  if (!want || want.length < 16 || got.length !== want.length) return false;
  var d = 0; for (var i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
function alertMail_(subject, body, to) {
  try {
    var key = 'AL:' + String(subject || '').slice(0, 80);
    var last = Number(props_().getProperty(key) || 0);
    if (last && Date.now() - last < 60 * 60 * 1000) { console.error('alert mail rate-limited: ' + subject); return; }
    props_().setProperty(key, String(Date.now()));
    MailApp.sendEmail(to || props_().getProperty('ALERT_EMAIL') || 'chadsbotchild@mail.grokbot.com', subject, body);
  } catch (e) { console.error('alert mail failed: ' + e); }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!authOk_(p.secret)) return json_({ ok: false, error: 'unauthorized' });
    if (p.action === 'days') return json_(handleDays_());
    return json_({ ok: true, hello: 'CAD schedule bridge (one tab)', time: new Date().toISOString() });
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
    if (b.action === 'migrate') return json_(migrateToOneTab());
    if (b.action === 'alert') { alertMail_(String(b.subject || 'CAD sheet alert'), String(b.body || ''), b.to); return json_({ ok: true }); }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    alertMail_('ALERT: schedule bridge error' + (b.orderId ? ' for ' + b.orderId : ''), String(err) + '\n' + (err && err.stack || ''));
    return json_({ ok: false, error: String(err) });
  }
}

// ---------- helpers ----------
function norm_(h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase(); }
function blank_(v) { return v === '' || v == null; }
function isBool_(v) { return v === true || v === false; }
function normDots_(s) { return String(s == null ? '' : s).replace(/[\u8DEF\u2022\u2219]/g, '\u00B7'); }
function tagOf_(notes) {
  var m = normDots_(notes).match(TAG_RE);
  return m ? { id: m[2], test: !!m[1], pending: !!m[3] } : null;
}
// Site rows start Update Notes with "submitted ..."; the bridge prepends "ONLINE ORDER <id> \u00B7" plus TEST / PENDING marks.
function tagNotes_(notes, id, test, pending) {
  var s = normDots_(notes);
  if (s.indexOf(TEST_TAG) === 0) s = s.substr(TEST_TAG.length).replace(/^\s+/, '');
  var head = 'ONLINE ORDER ' + id + ' \u00B7';
  var rest = s.indexOf(head) === 0 ? s.substr(head.length).replace(/^\s+/, '') : s;
  if (rest.indexOf(PEND_TAG) === 0) rest = rest.substr(PEND_TAG.length).replace(/^\s+/, '');
  return (test ? TEST_TAG : '') + head + ' ' + (pending ? PEND_TAG : '') + rest;
}
function hash_(s) { // FNV-1a, 6 hex chars (enough to notice an edit; the sheet itself is the record)
  s = String(s); var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return ('00000' + (h >>> 0).toString(16)).slice(-6);
}
function sameCell_(exp, act, colIdx) {
  if (colIdx === 0) return act === false || act === 'FALSE';
  if (typeof exp === 'number') return Number(act) === exp;
  if (exp instanceof Date || act instanceof Date) return String(exp) === String(act);
  return String(act == null ? '' : act) === String(exp == null ? '' : exp);
}
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
// Per-row check data for the verifier: date (as yyyy-mm-dd), job type, town, items, PU/DE details, amount due.
var VERIFY_COLS = [2, 6, 8, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 31];
function rowSig_(vals, tz) {
  return VERIFY_COLS.map(function (c) { var v = vals[c - 1]; return hash_(c === COL_DATE ? (parseDate_(v, tz) || String(v)) : (typeof v === 'number' ? String(v) : String(v == null ? '' : v))); }).join('');
}
function getState_(id) { try { return JSON.parse(props_().getProperty(STATE_PREFIX + id) || 'null'); } catch (x) { return null; } }
function setState_(id, st) { props_().setProperty(STATE_PREFIX + id, JSON.stringify(st)); }

// ---------- the tab model ----------
// pendEnd = the first divider row under the PENDING block at the top (column A is no longer a checkbox).
function snapshot_(sh) {
  var last = Math.max(sh.getLastRow(), 2);
  var vals = last >= 3 ? sh.getRange(3, 1, last - 2, NCOLS).getValues() : [];
  var pendEnd = 3;
  while (pendEnd - 3 < vals.length && isBool_(vals[pendEnd - 3][0])) pendEnd++;
  return { vals: vals, pendEnd: pendEnd, tz: sh.getParent ? sh.getParent().getSpreadsheetTimeZone() : 'America/Los_Angeles' };
}
function rowAt_(snap, r) { return snap.vals[r - 3] || []; }
function lastRowOf_(snap) { return snap.vals.length + 2; }
// An empty pre-made slot: only the checkbox (unticked), the date and the route; route is not a divider/noise/off-day line.
function isFreeSlot_(v) {
  if (v[0] !== false) return false;
  if (!blank_(v[2]) || !blank_(v[3])) return false;
  for (var c = 5; c < NCOLS; c++) if (!blank_(v[c])) return false;
  var e = String(v[4] || '');
  return !NOISE_RE.test(e) && !OFF_RE.test(e);
}
function findOrderRows_(snap, id) {
  var out = [];
  for (var i = 0; i < snap.vals.length; i++) { var t = tagOf_(snap.vals[i][COL_NOTES - 1]); if (t && t.id === id) out.push({ row: i + 3, test: t.test, pending: t.pending }); }
  return out;
}
// Where one row goes. Returns { row, insertAfter (0 = fill row in place), route, date }.
function spotFor_(snap, row, pending) {
  var iso = pending ? null : parseDate_(row[COL_DATE - 1], snap.tz);
  if (!iso) return { insertAfter: Math.max(snap.pendEnd - 1, 2) }; // PENDING block (end of it)
  var free = 0, lastSame = 0, lastBefore = 0, sameRoute = '';
  for (var r = snap.pendEnd + 1; r <= lastRowOf_(snap); r++) {
    var v = rowAt_(snap, r), d = parseDate_(v[COL_DATE - 1], snap.tz);
    if (!d) continue;
    if (d === iso) {
      lastSame = r;
      var e = String(v[COL_ROUTE - 1] || '');
      if (e && !NOISE_RE.test(e) && !OFF_RE.test(e) && !tagOf_(v[COL_NOTES - 1])) sameRoute = sameRoute || e;
      if (!free && isFreeSlot_(v)) free = r;
    } else if (d < iso && !lastSame) lastBefore = r;
  }
  if (free) return { row: free, insertAfter: 0, route: String(rowAt_(snap, free)[COL_ROUTE - 1] || ''), date: rowAt_(snap, free)[COL_DATE - 1] };
  return { insertAfter: lastSame || lastBefore || Math.max(snap.pendEnd, 2), route: sameRoute };
}
function writeRow_(sh, snap, r, cells, keepDate) {
  // cells: 35 values. Text as plain text (no formulas), AE/AG numbers as currency, A = unticked checkbox.
  var from = keepDate ? 3 : 2, out = [];
  for (var c = from; c <= NCOLS; c++) { var v = cells[c - 1]; out.push((typeof v === 'number' || typeof v === 'boolean') ? '' : (v == null ? '' : String(v))); }
  var area = sh.getRange(r, from, 1, NCOLS - from + 1);
  area.setNumberFormat('@');
  area.setValues([out]);
  for (var q = 0; q < NUM_COLS.length; q++) { var cc = NUM_COLS[q], nv = cells[cc - 1]; if (typeof nv === 'number') sh.getRange(r, cc).setNumberFormat('$#,##0.00').setValue(nv); }
  var a = sh.getRange(r, 1); a.setNumberFormat('General');
  try { if (rowAt_(snap, r)[0] !== false) a.insertCheckboxes(); } catch (ck) { /* cosmetic */ }
  a.setValue(false);
  var mirror = cells.slice(0, NCOLS); mirror[0] = false;
  if (keepDate) mirror[1] = rowAt_(snap, r)[1];
  for (var k = 0; k < out.length; k++) { var col = from + k; if (NUM_COLS.indexOf(col) < 0 || typeof cells[col - 1] !== 'number') mirror[col - 1] = out[k]; }
  snap.vals[r - 3] = mirror;
}
// Place rows (one order) on SCHEDULE 2026. Returns { rowNums, expected }.
function placeRows_(sh, snap, rows, id, test, pending) {
  var expected = [], rowNums = [];
  for (var k = 0; k < rows.length; k++) {
    var cells = rows[k].slice(0, NCOLS);
    while (cells.length < NCOLS) cells.push('');
    cells[COL_TYPE - 1] = coerceJobType_(cells[COL_TYPE - 1]);
    cells[COL_PAYSTATUS - 1] = coercePayStatus_(cells[COL_PAYSTATUS - 1]);
    cells[COL_NOTES - 1] = tagNotes_(cells[COL_NOTES - 1], id, test, pending);
    if (pending) { cells[COL_ASSIGN - 1] = 'PENDINGJOB'; cells[COL_STATUS - 1] = 'CONTACT THEM!!!'; if (String(cells[COL_PAYSTATUS - 1]) !== '...') cells[COL_PAYSTATUS - 1] = 'Pending Job'; }
    var spot = spotFor_(snap, cells, pending), r, keepDate = false;
    if (spot.route) cells[COL_ROUTE - 1] = spot.route;
    if (spot.insertAfter) {
      sh.insertRowAfter(spot.insertAfter);
      r = spot.insertAfter + 1;
      snap.vals.splice(r - 3, 0, new Array(NCOLS).fill(''));
      if (r <= snap.pendEnd) snap.pendEnd++; // inserted inside / at the end of the PENDING block: the divider moved down
      // rows below r moved down by one
      for (var j = 0; j < rowNums.length; j++) if (rowNums[j] >= r) rowNums[j]++;
    } else { r = spot.row; keepDate = true; }
    writeRow_(sh, snap, r, cells, keepDate);
    rowNums.push(r);
    expected.push(snap.vals[r - 3].slice());
  }
  return { rowNums: rowNums, expected: expected };
}
function readBack_(sh, rowNums, expected) {
  var diffs = [];
  for (var r = 0; r < rowNums.length; r++) {
    var act = sh.getRange(rowNums[r], 1, 1, NCOLS).getValues()[0];
    for (var c = 0; c < NCOLS; c++) if (!sameCell_(expected[r][c], act[c], c)) diffs.push('row ' + rowNums[r] + ' col ' + (c + 1) + ': expected [' + String(expected[r][c]).slice(0, 80) + '] got [' + String(act[c]).slice(0, 80) + ']');
  }
  return diffs;
}
function deleteRows_(sh, nums) { nums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); }); }

// ---------- order ----------
function handleOrder_(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = ss_(), sh = main_(ss);
    migrateLegacy_(ss);
    var id = String(b.orderId || ''), isConfirmed = b.event === 'confirmed', test = !!b.test;
    if (!/^\S+$/.test(id)) throw new Error('bad order id');
    var rows = b.rows || [], n = rows.length, st = getState_(id);
    for (var i = 0; i < n; i++) if (rows[i].length !== NCOLS) throw new Error('row ' + i + ' has ' + rows[i].length + ' cells, expected ' + NCOLS);
    if (n) {
      var hdr = sh.getRange(2, 1, 1, NCOLS).getValues()[0];
      for (var h = 0; h < NCOLS; h++) if (norm_(hdr[h]) !== norm_(b.columns[h])) throw new Error('SCHEDULE 2026 header changed at column ' + (h + 1) + ': sheet "' + hdr[h] + '" vs site "' + b.columns[h] + '". Nothing written.');
    }
    if (isConfirmed && !n) throw new Error('confirmed order without rows');
    var snap = snapshot_(sh), present = findOrderRows_(snap, id);
    // v5 "payment" event: a payment changed after booking (Zelle verified by CAD, ACH cleared or failed). Rewrites ONLY the payment
    // columns AD..AI (Who's paying?, Amount Due, Payment Status, Amount Paid, Pymnt method, Payment Notes) of the order's existing
    // confirmed rows. Never adds or deletes rows; Payment Status is coerced to the strict dropdown list.
    if (b.event === 'payment') {
      var prow = present.filter(function (p) { return !p.pending; });
      if (prow.length !== n) throw new Error('payment update: order has ' + prow.length + ' confirmed rows on the sheet, site sent ' + n + '. Nothing written.');
      for (var pk = 0; pk < n; pk++) {
        var pc = rows[pk].slice(29, NCOLS); // AD..AI
        pc[2] = coercePayStatus_(pc[2]);
        var pr = sh.getRange(prow[pk].row, 30, 1, NCOLS - 29);
        pr.setNumberFormat('@');
        pr.setValues([pc.map(function (v) { return (typeof v === 'number' || typeof v === 'boolean') ? '' : (v == null ? '' : String(v)); })]);
        for (var nq = 0; nq < NUM_COLS.length; nq++) { var ncol = NUM_COLS[nq], nval = rows[pk][ncol - 1]; if (typeof nval === 'number') sh.getRange(prow[pk].row, ncol).setNumberFormat('$#,##0.00').setValue(nval); }
      }
      SpreadsheetApp.flush();
      // v6: re-baseline the verifier's booking signature for these rows, so a payment change made by the site itself (Amount Due
      // going to 0 when a Zelle/ACH payment is confirmed) is not reported by verifyAll as "Amount Due CHANGED after booking".
      var st2 = getState_(id);
      if (st2 && st2.e === 'confirmed') {
        var snap2 = snapshot_(sh), tz2 = ss.getSpreadsheetTimeZone();
        st2.s = prow.map(function (p) { return rowSig_(rowAt_(snap2, p.row), tz2); });
        st2.rows = prow.map(function (p) { return p.row; });
        st2.payAt = Date.now();
        setState_(id, st2);
      }
      return { ok: true, paymentUpdated: n, tab: tabName_(), rows: prow.map(function (p) { return p.row; }), test: test, rebaselined: !!(st2 && st2.e === 'confirmed') };
    }
    if (isConfirmed) {
      var conf = present.filter(function (p) { return !p.pending; });
      if (st && st.e === 'confirmed') return { ok: true, duplicate: true, rowCount: st.n, tab: tabName_(), firstRow: conf.length ? conf[0].row : 0, test: test };
      if (conf.length === n) { // rows are already there: rewrite in place so a previous half-write (e.g. rejected Payment Status) can be repaired, then verify
        var rowNums = conf.map(function (p) { return p.row; });
        var expected = [];
        for (var k = 0; k < n; k++) {
          var cells = rows[k].slice(0, NCOLS);
          while (cells.length < NCOLS) cells.push('');
          cells[COL_TYPE - 1] = coerceJobType_(cells[COL_TYPE - 1]);
          cells[COL_PAYSTATUS - 1] = coercePayStatus_(cells[COL_PAYSTATUS - 1]);
          cells[COL_NOTES - 1] = tagNotes_(cells[COL_NOTES - 1], id, test, false);
          writeRow_(sh, snap, rowNums[k], cells, true);
          expected.push(snap.vals[rowNums[k] - 3].slice());
        }
        SpreadsheetApp.flush();
        var diffs = readBack_(sh, rowNums, expected);
        setState_(id, { e: 'confirmed', n: n, t: test, at: Date.now(), c: (b.summary || {}).client || '', d: (b.summary || {}).pickupDate || '', s: expected.map(function (v) { return rowSig_(v, snap.tz); }), rows: rowNums });
        var first = Math.min.apply(null, rowNums);
        if (diffs.length) { alertMail_('ALERT: read-back mismatch for online order ' + id, diffs.slice(0, 30).join('\n')); return { ok: true, duplicate: true, rowsWritten: n, verified: false, verifyDetail: diffs.slice(0, 5).join(' | '), tab: tabName_(), firstRow: first, rows: rowNums, test: test }; }
        return { ok: true, duplicate: true, rowsWritten: n, verified: true, rowCount: n, tab: tabName_(), firstRow: first, rows: rowNums, test: test };
      }
      if (conf.length) throw new Error('PARTIAL ROWS for ' + id + ' on ' + tabName_() + ' (' + conf.length + ' of ' + n + '). Not writing more; fix by hand.');
      var pend = present.filter(function (p) { return p.pending; }).map(function (p) { return p.row; });
      if (pend.length) { deleteRows_(sh, pend); SpreadsheetApp.flush(); snap = snapshot_(sh); }
    } else {
      var pendRows = present.length === n ? present.map(function (p) { return p.row; }) : (st && st.rows && st.rows.length === n ? st.rows : null);
      if (pendRows) {
        var expectedP = [];
        for (var pk = 0; pk < n; pk++) {
          var pcells = rows[pk].slice(0, NCOLS);
          while (pcells.length < NCOLS) pcells.push('');
          pcells[COL_TYPE - 1] = coerceJobType_(pcells[COL_TYPE - 1]);
          pcells[COL_PAYSTATUS - 1] = coercePayStatus_(pcells[COL_PAYSTATUS - 1]);
          pcells[COL_NOTES - 1] = tagNotes_(pcells[COL_NOTES - 1], id, test, true);
          pcells[COL_ASSIGN - 1] = 'PENDINGJOB'; pcells[COL_STATUS - 1] = 'CONTACT THEM!!!';
          if (String(pcells[COL_PAYSTATUS - 1]) !== '...') pcells[COL_PAYSTATUS - 1] = 'Pending Job';
          writeRow_(sh, snap, pendRows[pk], pcells, false);
          expectedP.push(snap.vals[pendRows[pk] - 3].slice());
        }
        SpreadsheetApp.flush();
        var diffsP = readBack_(sh, pendRows, expectedP);
        setState_(id, { e: 'pending', n: n, t: test, at: Date.now(), rows: pendRows });
        var firstP = Math.min.apply(null, pendRows);
        if (diffsP.length) { alertMail_('ALERT: read-back mismatch for online order ' + id, diffsP.slice(0, 30).join('\n')); return { ok: true, duplicate: true, rowsWritten: n, verified: false, verifyDetail: diffsP.slice(0, 5).join(' | '), tab: tabName_(), firstRow: firstP, rows: pendRows, test: test }; }
        return { ok: true, duplicate: true, rowsWritten: n, verified: true, logged: true, rowCount: n, tab: tabName_(), firstRow: firstP, rows: pendRows, test: test, pending: true };
      }
      if (st || present.length) return { ok: true, duplicate: true, logged: true, rowCount: present.length, tab: tabName_(), firstRow: present.length ? present[0].row : 0, test: test };
      if (!n) { setState_(id, { e: 'pending', n: 0, t: test, at: Date.now() }); return { ok: true, logged: true, rowsWritten: 0 }; }
    }
    var placed = placeRows_(sh, snap, rows, id, test, !isConfirmed);
    SpreadsheetApp.flush();
    var diffs = readBack_(sh, placed.rowNums, placed.expected);
    var first = Math.min.apply(null, placed.rowNums);
    if (diffs.length) {
      setState_(id, { e: isConfirmed ? 'confirmed' : 'pending', n: n, t: test, at: Date.now(), c: (b.summary || {}).client || '', d: (b.summary || {}).pickupDate || '', s: placed.expected.map(function (v) { return rowSig_(v, snap.tz); }), rows: placed.rowNums, verified: false });
      alertMail_('ALERT: read-back mismatch for online order ' + id, diffs.slice(0, 30).join('\n'));
      return { ok: true, rowsWritten: n, verified: false, verifyDetail: diffs.slice(0, 5).join(' | '), tab: tabName_(), firstRow: first, rows: placed.rowNums, test: test };
    }
    setState_(id, { e: isConfirmed ? 'confirmed' : 'pending', n: n, t: test, at: Date.now(), c: (b.summary || {}).client || '', d: (b.summary || {}).pickupDate || '', s: placed.expected.map(function (v) { return rowSig_(v, snap.tz); }), rows: placed.rowNums });
    return { ok: true, rowsWritten: n, verified: true, tab: tabName_(), firstRow: first, rows: placed.rowNums, test: test, pending: !isConfirmed };
  } finally { lock.releaseLock(); }
}

// ---------- one-time move off the old tabs ----------
function migrateToOneTab() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { return migrateLegacy_(ss_()); } finally { lock.releaseLock(); }
}
function migrateLegacy_(ss) {
  var olds = LEGACY_TABS.map(function (n) { return ss.getSheetByName(n); });
  if (!olds[0] && !olds[1] && !olds[2]) return { ok: true, migrated: 0, deletedTabs: [] };
  var sh = main_(ss), snap = snapshot_(sh), moved = [], skipped = [];
  [0, 1].forEach(function (k) {
    var t = olds[k]; if (!t || t.getLastRow() < 3) return;
    var vals = t.getRange(3, 1, t.getLastRow() - 2, NCOLS).getValues(), groups = {}, order = [];
    vals.forEach(function (v) {
      if (v.every(function (x, i) { return i === 0 || blank_(x); })) return;
      var tg = tagOf_(v[COL_NOTES - 1]), id = tg ? tg.id : 'ROW-' + Math.random().toString(36).slice(2, 8);
      if (!groups[id]) { groups[id] = []; order.push(id); }
      groups[id].push(v);
    });
    order.forEach(function (id) {
      if (findOrderRows_(snap, id).length) { skipped.push(id); return; }
      var test = k === 1, placed = placeRows_(sh, snap, groups[id], id, test, false);
      setState_(id, { e: 'confirmed', n: placed.rowNums.length, t: test, at: Date.now(), c: String(groups[id][0][15] || ''), d: '', s: placed.expected.map(function (v) { return rowSig_(v, snap.tz); }) });
      moved.push(id + ' -> rows ' + placed.rowNums.join(','));
    });
  });
  SpreadsheetApp.flush();
  var deleted = [];
  olds.forEach(function (t) { if (t) { deleted.push(t.getName()); ss.deleteSheet(t); } });
  props_().deleteProperty('VERIFY_STATE');
  return { ok: true, migrated: moved.length, moved: moved, skipped: skipped, deletedTabs: deleted };
}

// ---------- days ----------
// Read-only digest of SCHEDULE 2026 per date. Online-order rows count as job rows ONCE (they are on this tab now), except
// TEST rows and PENDING REVIEW rows (the site holds those dates itself), and never add route text or off-day marks.
function handleDays_() {
  var ss = daysSs_(), tz = ss.getSpreadsheetTimeZone(), days = {};
  // v5 (route-aware time windows): every date also gets `stops` = its job rows in sheet order, each { town: TOWN REF (H),
  // type: JOB TYPE (F), win: Arrival Time Window (K), at: Arrival Time (L) }, for dates from yesterday on. Read-only, as before.
  function rec(iso) { return days[iso] || (days[iso] = { routes: [], jobRows: 0, off: false, offWhy: '', stops: [] }); }
  var main = daysSh_(), last = main.getLastRow();
  var fromIso = Utilities.formatDate(new Date(Date.now() - 864e5), tz, 'yyyy-MM-dd');
  function cellText(x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'h:mm a') : String(x == null ? '' : x).trim(); }
  if (last >= 3) {
    var v = main.getRange(3, 1, last - 2, 12).getValues(); // A..L
    for (var i = 0; i < v.length; i++) {
      var iso = parseDate_(v[i][1], tz); if (!iso) continue;
      var d = rec(iso), e = String(v[i][4] || '').trim(), f = String(v[i][5] || '').trim(), st = String(v[i][8] || ''), tg = tagOf_(v[i][9]);
      var stop = (iso >= fromIso && JOB_RE.test(f) && !/^PENDING JOB/i.test(f)) ? { town: String(v[i][7] || '').trim().slice(0, 60), type: f.slice(0, 30), win: cellText(v[i][10]).slice(0, 40), at: cellText(v[i][11]).slice(0, 20) } : null;
      if (tg) { if (!tg.test && !tg.pending && JOB_RE.test(f)) { d.jobRows++; d.onlineRows = (d.onlineRows || 0) + 1; if (stop) d.stops.push(stop); } continue; }
      if (stop && String(v[i][6] || '').trim().toUpperCase() !== 'PENDINGJOB') d.stops.push(stop);
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
  return { ok: true, days: days, digest: 6, sheetVersion: main.getLastRow(), generatedAt: new Date().toISOString() };
}

// ---------- ROUTE CALENDAR: one-tab rule, the bridge never creates it. If the team ever adds that tab, missing dates are seeded. ----------
function handleSeed_(b) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = ss_(), tz = ss.getSpreadsheetTimeZone(), sh = ss.getSheetByName(TAB_CAL);
    if (!sh) return { ok: true, seeded: 0, existing: 0, note: 'no ROUTE CALENDAR tab (one-tab rule: the bridge does not create tabs)' };
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

// ---------- two-way reconciliation (against SCHEDULE 2026, by the order id in Update Notes) ----------
// b.orderIds: every order the server has CONFIRMED (non-test). Reports paid orders with no rows, and paid online-order rows
// (not TEST, not PENDING) whose id the server does not know.
function handleReconcile_(b) {
  var ss = ss_(), sh = main_(ss), known = {}, missing = [], orphans = [], seen = {};
  (b.orderIds || []).forEach(function (id) { known[id] = true; });
  if (sh && sh.getLastRow() >= 3) {
    sh.getRange(3, COL_NOTES, sh.getLastRow() - 2, 1).getValues().forEach(function (r, i) {
      var t = tagOf_(r[0]);
      if (t && !t.test && !t.pending) { seen[t.id] = (seen[t.id] || 0) + 1; if (!known[t.id]) orphans.push({ orderId: t.id, row: i + 3 }); }
    });
  }
  Object.keys(known).forEach(function (id) { if (!seen[id]) missing.push(id); });
  var out = { ok: true, missing: missing, orphans: orphans, checked: Object.keys(known).length };
  if (missing.length || orphans.length) alertMail_('ALERT: schedule and orders do not match (' + missing.length + ' paid order(s) missing, ' + orphans.length + ' row(s) without an order)', 'Paid orders missing from SCHEDULE 2026: ' + missing.join(', ') + '\nSCHEDULE 2026 rows with no matching order: ' + orphans.map(function (o) { return o.orderId + ' (row ' + o.row + ')'; }).join(', '));
  return out;
}

// ---------- independent verifier (time trigger) ----------
function verifyAll() {
  var ss = ss_(), sh = main_(ss), all = props_().getProperties(), tz = ss.getSpreadsheetTimeZone();
  var days = handleDays_().days, snap = snapshot_(sh), cutoff = Date.now() - 60 * 864e5, problems = [], checked = 0;
  var state = {}; try { state = JSON.parse(all.VERIFY_STATE2 || '{}'); } catch (x) { state = {}; }
  var NAMES = { 2: 'Date', 6: 'JOB TYPE', 8: 'TOWN REF', 13: 'Items', 14: 'PU Address', 15: 'PU Business', 16: 'PU Contact', 17: 'PU Phone', 18: 'PU Notes', 21: 'DE Address', 22: 'DE Business', 23: 'DE Contact', 24: 'DE Phone', 25: 'DE Notes', 31: 'Amount Due' };
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(STATE_PREFIX) !== 0) return;
    var id = k.substr(STATE_PREFIX.length), r; try { r = JSON.parse(all[k]); } catch (x) { return; }
    if (!r || r.at < Date.now() - 120 * 864e5) { props_().deleteProperty(k); return; }
    if (r.e !== 'confirmed' || r.at < cutoff) return;
    checked++;
    var rows = findOrderRows_(snap, id).filter(function (p) { return !p.pending; }).map(function (p) { return p.row; }), msg = [];
    if (rows.length === 0) msg.push('MISSING from ' + tabName_());
    else if (rows.length !== r.n) msg.push('has ' + rows.length + ' rows, expected ' + r.n + (rows.length > r.n ? ' (DUPLICATE?)' : ' (a row is missing)'));
    else {
      for (var q = 0; q < rows.length; q++) {
        var act = rowAt_(snap, rows[q]), sig = rowSig_(act, tz), want = (r.s || [])[q] || '';
        for (var c = 0; c < VERIFY_COLS.length; c++) if (want && sig.substr(c * 6, 6) !== want.substr(c * 6, 6)) msg.push('row ' + rows[q] + ' ' + NAMES[VERIFY_COLS[c]] + ' CHANGED after booking (now [' + String(act[VERIFY_COLS[c] - 1]).slice(0, 60) + '])');
        var iso = parseDate_(act[1], tz), day = iso && days[iso];
        if (day && day.off) msg.push('row ' + rows[q] + ' is on ' + act[1] + ', which the sheet marks off ("' + day.offWhy + '")');
      }
    }
    if (msg.length) {
      var crit = msg.some(function (m) { return /MISSING|DUPLICATE|missing|marks off/.test(m) || /(Date|JOB TYPE|TOWN REF|PU Address|DE Address|Amount Due) CHANGED/.test(m); });
      var h = msg.join('|'), s = state[id] || {};
      if (s.h !== h || (crit && Date.now() - (s.at || 0) > 12 * 3600e3)) { state[id] = { h: h, at: Date.now() }; problems.push((crit ? 'CRITICAL ' : 'WARNING ') + (r.t ? '[TEST] ' : '') + id + ' (' + (r.c || '') + '): ' + msg.join('; ')); }
    } else if (state[id]) { delete state[id]; }
  });
  props_().setProperty('VERIFY_STATE2', JSON.stringify(state));
  if (problems.length) alertMail_('ALERT: online-order check found ' + problems.length + ' problem(s) on the schedule', problems.join('\n\n') + '\n\nCHANGED means a team member edited the row after booking. If a client date or address changed on purpose, make sure the client was told.');
  return { checked: checked, problems: problems.length };
}
// One-off maintenance, run by hand from the Apps Script editor (no redeploy needed; touches no sheet cells):
// re-baseline the verifier's saved booking signature for TEST orders whose rows were repaired by hand, so verifyAll stops
// re-reporting "Amount Due CHANGED after booking". Refuses non-TEST orders. Reads the target tab; writes only script properties.
function rebaselineTestOrders(ids) {
  ids = ids && ids.length ? ids : ['CAD-WRWJ6G', 'CAD-WRL9RD', 'CAD-WRL91G'];
  var ss = ss_(), sh = main_(ss), snap = snapshot_(sh), tz = ss.getSpreadsheetTimeZone(), out = [];
  var vstate = {}; try { vstate = JSON.parse(props_().getProperty('VERIFY_STATE2') || '{}'); } catch (x) { vstate = {}; }
  ids.forEach(function (id) {
    var st = getState_(id);
    if (!st) { out.push(id + ': no saved state'); return; }
    if (!st.t) { out.push(id + ': NOT a test order, skipped'); return; }
    var rows = findOrderRows_(snap, id).filter(function (p) { return !p.pending; }).map(function (p) { return p.row; });
    if (rows.length !== st.n) { out.push(id + ': has ' + rows.length + ' rows, expected ' + st.n + ', skipped'); return; }
    st.s = rows.map(function (r) { return rowSig_(rowAt_(snap, r), tz); }); st.rows = rows; st.rebaselinedAt = Date.now();
    setState_(id, st); delete vstate[id];
    out.push(id + ': re-baselined rows ' + rows.join(', '));
  });
  props_().setProperty('VERIFY_STATE2', JSON.stringify(vstate));
  Logger.log(out.join('\n'));
  return out;
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'verifyAll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verifyAll').timeBased().everyMinutes(30).create();
}
