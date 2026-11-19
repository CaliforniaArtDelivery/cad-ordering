/** Discount codes (Chad, Nov 19 2026). The table lives in config.discountCodes and is checked ONLY here, on the server.
 *  lookup() says whether a typed code works today; compute() says how many dollars it takes off a given price. Pure, writes nothing. */
const config = require('../config');

const norm = (c) => String(c == null ? '' : c).trim().toUpperCase();
const money = (n) => Math.round(n * 100) / 100;
const ptToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// Never reveals WHY a code failed to the customer (inactive and unknown read the same); `reason` is for tests and logs.
function lookup(code, today = ptToday()) {
  const key = norm(code);
  if (!key) return { ok: false, reason: 'empty' };
  const row = (config.discountCodes || []).find((r) => norm(r.code) === key);
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.active === false) return { ok: false, reason: 'inactive' };
  if (row.expires && String(today) > String(row.expires)) return { ok: false, reason: 'expired' };
  if (row.type === 'percent' && !(row.percent > 0 && row.percent <= 100)) return { ok: false, reason: 'misconfigured' };
  if (row.type === 'deliveryCredit' && !(row.amount > 0)) return { ok: false, reason: 'misconfigured' };
  if (row.type !== 'percent' && row.type !== 'deliveryCredit') return { ok: false, reason: 'misconfigured' };
  return { ok: true, code: norm(row.code), row };
}

// The dollars this code takes off. `base` = { total: price before the code, transport: standard pickup + delivery portion only }.
function compute(row, base) {
  const total = Math.max(0, Number(base.total) || 0), transport = Math.max(0, Number(base.transport) || 0);
  if (row.type === 'percent') return money(Math.min(total, total * row.percent / 100));
  return money(Math.min(row.amount, transport, total));
}

const describe = (row) => (row.type === 'percent' ? `${row.percent}% off your order total` : `Up to $${row.amount} off standard pickup and delivery`);
module.exports = { norm, lookup, compute, describe };
