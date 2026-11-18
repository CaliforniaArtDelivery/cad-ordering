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
    // Crew and vehicle (Samantha, Nov 18): Alex on Northern days, Max on Southern days, each in a Sprinter; Alex + Max overlap in Carmel/Salinas on Tue and Sat.
    // Level 2 install = Alex + Max, Level 3 = Chad + Max + Alex, trailer per job. Informational: the site does not assign crews or trailers.
    const carmelOverlap = zones.includes('Carmel') && [2, 6].includes(d.getUTCDay());
    const southern = zones.length > 0 && zones.every((z) => ['LA', 'SB', 'OC', 'SD', 'Coachella'].includes(z));
    const northern = zones.length > 0 && zones.every((z) => ['BayWest', 'EastBay', 'Sacramento', 'Tahoe', 'NapaWine'].includes(z));
    const crew = carmelOverlap ? 'Alex + Max' : southern ? 'Max' : northern ? 'Alex' : ''; // blank when unsure (Sunday Central Coast etc.): Samantha fills it in
    out.push([iso, DOW[d.getUTCDay()], status, zones.join(','), String(config.scheduling.dailyJobCap || 8), crew, crew ? (carmelOverlap ? 'Sprinter + Sprinter' : 'Sprinter') : '', note]);
  }
  return out;
}
module.exports = { rows };
