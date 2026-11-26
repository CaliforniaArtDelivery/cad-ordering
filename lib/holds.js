/**
 * Atomic slot holds. A hold reserves job rows on a date while the client pays; it expires (default 30 min; payment-link orders
 * get HOLD_LINK_MS) or is released when the order is confirmed (the sheet row then counts), cancelled or superseded.
 * Node runs one request handler at a time, so reserve() is atomic: two checkouts for the last slot can't both win.
 * Persisted to data/holds.json so a restart doesn't forget a hold.
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(require('./storage').dir('data'), 'holds.json');
const HOLD_MS = () => Number(process.env.HOLD_MS || 30 * 60 * 1000);
const LINK_MS = () => Number(process.env.HOLD_LINK_MS || 72 * 3600 * 1000);
let holds = {}; // orderId -> { dates: { iso: rows }, expiresAt }
try { holds = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { holds = {}; }
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(holds)); } catch (e) { console.error('holds: cannot persist', e.message); } };

function sweep(now = Date.now()) { let n = 0; for (const [id, h] of Object.entries(holds)) if (h.expiresAt <= now) { delete holds[id]; n++; } if (n) save(); return n; }
function held(iso, exceptOrderId) {
  sweep();
  return Object.entries(holds).reduce((s, [id, h]) => s + (id === exceptOrderId ? 0 : (h.dates[iso] || 0)), 0);
}
// Held count for a tagged limit (e.g. 'enroute': en-route East Bay stops on a Thursday), excluding one order.
function heldTag(tag, iso, exceptOrderId) {
  sweep();
  return Object.entries(holds).reduce((s, [id, h]) => s + (id === exceptOrderId ? 0 : ((h.tags && h.tags[tag] && h.tags[tag][iso]) || 0)), 0);
}
// need: { 'YYYY-MM-DD': rowsNeeded }; remainingFor(iso, held) -> rows still free on that date (excluding this order's hold).
// tags: { tag: { need: { iso: n }, remainingFor(iso) -> n still free (excluding this order) } }. All dates and all tags are checked
// before anything is written, so both legs are reserved or neither is.
function reserve(orderId, need, remainingFor, { link = false, now = Date.now(), tags = null } = {}) {
  sweep(now);
  const short = Object.entries(need).filter(([iso, rows]) => remainingFor(iso, held(iso, orderId)) < rows);
  for (const t of Object.values(tags || {})) for (const [iso, n] of Object.entries(t.need || {})) if (t.remainingFor(iso) < n && !short.some(([x]) => x === iso)) short.push([iso, n]);
  if (short.length) return { ok: false, full: short.map(([iso]) => iso) };
  const tagNeed = {}; for (const [k, t] of Object.entries(tags || {})) if (Object.keys(t.need || {}).length) tagNeed[k] = { ...t.need };
  holds[orderId] = { dates: { ...need }, ...(Object.keys(tagNeed).length ? { tags: tagNeed } : {}), expiresAt: now + (link ? LINK_MS() : HOLD_MS()), createdAt: new Date(now).toISOString() };
  save();
  return { ok: true, expiresAt: holds[orderId].expiresAt };
}
const extend = (orderId, ms) => { if (holds[orderId]) { holds[orderId].expiresAt = Math.max(holds[orderId].expiresAt, Date.now() + ms); save(); } };
const release = (orderId) => { if (holds[orderId]) { delete holds[orderId]; save(); return true; } return false; };
const snapshot = () => { sweep(); return Object.entries(holds).map(([id, h]) => ({ orderId: id, dates: h.dates, expiresAt: new Date(h.expiresAt).toISOString() })); };
const _reset = () => { holds = {}; };
module.exports = { heldTag, reserve, extend, release, held, sweep, snapshot, _reset };
