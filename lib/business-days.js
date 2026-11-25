/**
 * Business-day helpers in America/Los_Angeles.
 * The Dec 20–Jan 1 holiday is a dated 2026–27 closure only, not a repeating annual rule.
 */
const CLOSURE_START = '2026-12-20';
const CLOSURE_END = '2027-01-01';

function ymd(d, tz) {
  return d.toLocaleDateString('en-CA', { timeZone: tz || 'America/Los_Angeles' });
}
function utcNoon(iso) { return new Date(String(iso) + 'T12:00:00Z'); }
function addUtcDays(iso, n) {
  const d = utcNoon(iso);
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}

function isHolidayClosure(iso) {
  const s = String(iso || '');
  return s >= CLOSURE_START && s <= CLOSURE_END;
}

function isWeekend(iso) {
  const dow = utcNoon(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

function isBusinessDay(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && !isWeekend(iso) && !isHolidayClosure(iso);
}

/** First business day on or after iso (skips weekends and the 2026-12-20..2027-01-01 closure). */
function nextBusinessDay(fromIso) {
  let iso = String(fromIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso = ymd(new Date());
  for (let i = 0; i < 20; i++, iso = addUtcDays(iso, 1)) {
    if (isBusinessDay(iso)) return iso;
  }
  return iso;
}

/** If submitted after that calendar day's business hours, count from the next morning. We use the calendar date in PT. */
function quoteReplyBy(from = new Date()) {
  const submitted = ymd(from);
  // A request landed today is answered by the next business day (today if it is a business day and we still
  // treat "within 1 business day" as the following business day after the request date).
  // "within 1 business day" from a Wednesday → Thursday; from Friday → Monday; from Dec 19 2026 → Jan 2 2027.
  const start = addUtcDays(submitted, 1);
  const by = nextBusinessDay(start);
  const label = utcNoon(by).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return { iso: by, label, text: `within 1 business day (by ${label})` };
}

function authorizePaymentNote() {
  return 'Nothing is charged until you authorize payment.';
}

function quoteEtaSentence(from) {
  const { text } = quoteReplyBy(from);
  return `We’ll email your price with a payment link ${text}. ${authorizePaymentNote()}`;
}

module.exports = {
  CLOSURE_START, CLOSURE_END, isHolidayClosure, isWeekend, isBusinessDay, nextBusinessDay,
  quoteReplyBy, quoteEtaSentence, authorizePaymentNote, addUtcDays, ymd,
};
