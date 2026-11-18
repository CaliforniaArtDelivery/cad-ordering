// Seeds the ROUTE CALENDAR tab (adds missing dates only, never overwrites). Usage:
//   SHEETS_WEBHOOK_URL=... SHEETS_WEBHOOK_SECRET=... node scripts/seed-calendar.js [days=240]
const seed = require('../lib/seed-calendar');
(async () => {
  const days = Number(process.argv[2]) || 240;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const rows = seed.rows(today, days);
  const r = await fetch(process.env.SHEETS_WEBHOOK_URL, { method: 'POST', body: JSON.stringify({ action: 'seedCalendar', secret: process.env.SHEETS_WEBHOOK_SECRET, days: rows }) });
  const j = await r.json();
  console.log(j.ok ? `Seeded ${j.seeded} new date(s) of ${rows.length}.` : 'FAILED: ' + (j.error || r.status));
  process.exit(j.ok ? 0 : 1);
})();
