/**
 * Seeds the ROUTE CALENDAR tab (missing dates only) from the weekly Blue/Red pattern in config.js, as a STARTING POINT for
 * Samantha to correct. Everything the sheet shows as off, and everything in config.scheduling.blackoutDates, is seeded CLOSED.
 * Fridays and weekend overflow days are seeded CLOSED (Samantha's decision pending, see the Knowledge Base, question 3).
 * Row = [date, weekday, OPEN|CLOSED, areas, capacity, crew, vehicle, notes]
 */
const config = require('../config');
const { dayInfo } = require('./scheduling');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function rows(fromIso, days = 200, { openFridays = false } = {}) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(new Date(fromIso + 'T12:00:00Z').getTime() + i * 864e5);
    const iso = d.toISOString().slice(0, 10), info = dayInfo(d);
    const zones = (info.zones || []).slice();
    let status = zones.length && !info.overflow ? 'OPEN' : 'CLOSED', note = `${info.weekType} week: ${info.label}`;
    if (config.scheduling.blackoutDates.includes(iso)) { status = 'CLOSED'; note = 'holiday / off day (seeded closed; confirm)'; }
    if (d.getUTCDay() === 5 && !openFridays && zones.length) { status = 'CLOSED'; note += ' | Friday: closed until Samantha opens it'; }
    out.push([iso, DOW[d.getUTCDay()], status, zones.join(','), String(config.scheduling.dailyJobCap || 10), '', '', note]);
  }
  return out;
}
module.exports = { rows };
