/**
 * Durable, idempotent hand-off of every confirmed online order to the CAD schedule Google Sheet.
 *
 * Transport: a Google Apps Script web app owned by the CAD account (apps-script/Code.gs). The server sends the order, the
 * exact schedule rows, and the raw order JSON; the script writes the rows to the ONLINE ORDERS tab (mock-payment orders go to
 * the TEST ORDERS tab), logs the full raw order in ONLINE ORDERS RAW LOG, reads back what it wrote, and answers with the row
 * numbers. Idempotent by order ID, so any retry is safe.
 *
 * Env: SHEETS_WEBHOOK_URL, SHEETS_WEBHOOK_SECRET (both required; without them nothing is sent, the queue keeps every order
 * and /api/sync-status reports "not configured"). SHEETS_ALERT_EMAIL (default chadsbotchild@mail.grokbot.com).
 *
 * Queue file: <storage>/data/sheet-sync-queue.json. Retries with backoff forever (until the order is in the sheet);
 * an alert email goes out through the script after the 3rd failed attempt and then every 6 h while still failing.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schedule = require('./schedule');

const URL_ = () => process.env.SHEETS_WEBHOOK_URL || '';
const SECRET = () => process.env.SHEETS_WEBHOOK_SECRET || '';
const ALERT_TO = () => process.env.SHEETS_ALERT_EMAIL || 'contact@californiaartdelivery.com, chadsbotchild@mail.grokbot.com';
const QFILE = path.join(require('./storage').dir('data'), 'sheet-sync-queue.json');
const SCALE = Number(process.env.SHEETS_BACKOFF_SCALE || 1); // tests only
const BACKOFF = [0, 5e3, 15e3, 45e3, 120e3, 300e3, 900e3].map((x) => x * SCALE);
const TIMEOUT_MS = 45e3;

let queue = {}; // orderId -> { orderId, event, attempts, nextAt, lastError, doneAt, result, alertedAt }
try { queue = JSON.parse(fs.readFileSync(QFILE, 'utf8')); } catch { queue = {}; }
const persist = () => { try { fs.writeFileSync(QFILE, JSON.stringify(queue)); } catch (e) { console.error('sheet-sync: cannot persist queue', e.message); } };

let getOrder = () => null, listOrders = () => [], onSaved = () => {}, onException = () => {};
let timer = null, running = false;
const stats = { lastSuccessAt: null, lastError: null, lastErrorAt: null };

function payloadFor(o, event) {
  const confirmed = event === 'confirmed';
  const legs = confirmed ? schedule.legsForOrder(o) : [];
  const rows = legs.map(({ row }) => schedule.COLUMNS.map((c) => (row[c] === undefined ? '' : row[c])));
  return {
    action: 'order', orderId: o.id, event, status: o.status, test: schedule.isTestOrder(o),
    columns: schedule.COLUMNS, legs: legs.map((l) => l.leg), rows,
    summary: { client: o.contact && o.contact.name, service: o.service, pickupDate: o.schedule && o.schedule.date, deliveryDate: (o.schedule && o.schedule.deliveryDate) || '', total: o.quote && o.quote.total, createdAt: o.createdAt },
    raw: JSON.stringify(o),
  };
}

async function post(body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL_(), { method: 'POST', body: JSON.stringify({ ...body, secret: SECRET() }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw new Error(`non-JSON answer (HTTP ${r.status}): ${text.slice(0, 160)}`); }
    return j;
  } finally { clearTimeout(t); }
}

// Every confirmed order must come back with exactly the number of rows we sent; anything else is a failure and is retried.
function checkResult(p, j) {
  if (!j || j.ok !== true) throw new Error('sheet script said: ' + ((j && j.error) || 'not ok'));
  if (p.event === 'confirmed' && !(j.rowsWritten === p.rows.length || (j.duplicate && j.rowCount === p.rows.length))) throw new Error(`row count mismatch: sent ${p.rows.length}, sheet reports ${j.rowsWritten}/${j.rowCount}`);
  if (p.event === 'confirmed' && j.verified !== true && !j.duplicate) throw new Error('read-back verification failed: ' + (j.verifyDetail || 'unknown'));
  return j;
}

async function alert(subject, body) {
  try { if (URL_() && SECRET()) await post({ action: 'alert', to: ALERT_TO(), subject, body }); } catch (e) { console.error('sheet-sync: alert failed too:', e.message); }
}

async function attempt(entry) {
  const o = getOrder(entry.orderId);
  if (!o) { entry.doneAt = new Date().toISOString(); entry.result = { skipped: 'order no longer exists' }; return; }
  const p = payloadFor(o, entry.event);
  entry.attempts += 1;
  try {
    log({ orderId: entry.orderId, event: entry.event, attempt: entry.attempts, phase: 'send', rows: p.rows.length });
    const j = checkResult(p, await post(p));
    log({ orderId: entry.orderId, attempt: entry.attempts, phase: 'ok', tab: j.tab, firstRow: j.firstRow, duplicate: !!j.duplicate });
    entry.doneAt = new Date().toISOString(); entry.result = { tab: j.tab, firstRow: j.firstRow, rows: j.rowsWritten ?? j.rowCount, duplicate: !!j.duplicate }; entry.lastError = null;
    stats.lastSuccessAt = entry.doneAt;
    try { if (entry.event === 'confirmed') { require('./holds').release(entry.orderId); onSaved(entry.orderId, entry.result); } /* a quote_request log entry must NOT free the date the team is holding */ } catch (e) { console.error('sheet-sync onSaved', e.message); }
  } catch (e) {
    log({ orderId: entry.orderId, attempt: entry.attempts, phase: 'fail', error: e.message });
    entry.lastError = e.message; stats.lastError = e.message; stats.lastErrorAt = new Date().toISOString();
    entry.nextAt = Date.now() + (BACKOFF[Math.min(entry.attempts, BACKOFF.length - 1)] || 900e3);
    console.error(`sheet-sync: ${entry.orderId} attempt ${entry.attempts} failed: ${e.message}`);
    if (entry.attempts >= 3 && (!entry.alertedAt || Date.now() - Date.parse(entry.alertedAt) > 6 * 3600e3 * (SCALE || 1))) {
      entry.alertedAt = new Date().toISOString();
      try { onException(entry.orderId, entry); } catch {}
      alert(`ALERT: online order ${entry.orderId} is NOT on the schedule sheet yet`, `Order ${entry.orderId} (${entry.event}) failed ${entry.attempts} times to reach the CAD schedule sheet.\nLast error: ${e.message}\nThe server keeps retrying. If this is still failing, add the order to the schedule by hand (full order details: the admin page, or the ONLINE ORDERS RAW LOG tab if it got that far).`);
    }
  }
}

async function pump() {
  if (running) return; running = true;
  try {
    if (!URL_() || !SECRET()) return;
    for (const entry of Object.values(queue)) {
      if (entry.doneAt || (entry.nextAt && entry.nextAt > Date.now())) continue;
      await attempt(entry); persist();
    }
  } finally { running = false; }
}

function enqueue(orderId, event = 'confirmed') {
  const k = event === 'confirmed' ? orderId : `${orderId}:${event}`;
  if (!queue[k]) { queue[k] = { orderId, event, attempts: 0, nextAt: 0, createdAt: new Date().toISOString() }; persist(); }
  setImmediate(() => pump().catch((e) => console.error('sheet-sync pump', e.message)));
  return queue[k];
}

function start({ orders, find, saved, exception }) {
  listOrders = orders; getOrder = find; if (saved) onSaved = saved; if (exception) onException = exception;
  // Reconcile after a restart: every confirmed order must have a queue entry; every unfinished entry gets retried now.
  const recent = Date.now() - 7 * 864e5; // old test data in a fresh checkout is not replayed
  for (const o of listOrders()) if (o.status === 'confirmed' && !queue[o.id] && Date.parse(o.createdAt) >= recent) enqueue(o.id, 'confirmed');
  for (const e of Object.values(queue)) if (!e.doneAt) e.nextAt = 0;
  persist();
  if (!timer) { timer = setInterval(() => pump().catch(() => {}), Number(process.env.SHEETS_PUMP_MS || 20e3)); timer.unref(); }
  pump().catch(() => {});
}

function status() {
  const all = Object.values(queue);
  const pending = all.filter((e) => !e.doneAt);
  return {
    configured: !!(URL_() && SECRET()), total: all.length, synced: all.length - pending.length, pending: pending.length,
    pendingOrders: pending.map((e) => ({ orderId: e.orderId, event: e.event, attempts: e.attempts, lastError: e.lastError })),
    lastSuccessAt: stats.lastSuccessAt, lastError: stats.lastError, lastErrorAt: stats.lastErrorAt,
  };
}

// Pull-style helpers used by sheet-days and the verifier.
async function call(body) { if (!URL_() || !SECRET()) throw new Error('sheet webhook not configured'); return post(body); }
async function pumpNow() { return pump(); }
const configured = () => !!(URL_() && SECRET());
const log = (rec) => { try { fs.appendFileSync(path.join(path.dirname(QFILE), 'sheet-sync-attempts.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n'); } catch {} };
const _resetForTests = (q = {}) => { queue = q; };

module.exports = { configured, alert, enqueue, start, status, call, pumpNow, payloadFor, checkResult, _resetForTests, QFILE };
