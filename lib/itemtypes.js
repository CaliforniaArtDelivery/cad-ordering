/** Item types (Chad, Nov 15 2026) and framing details, shared by validation, emails, admin and the CSV. */
const TYPES = {
  painting: 'Painting',
  mirror: 'Mirror',
  wallart: 'Other wall art',           // photography, mixed media, wall sculpture, etc. Hung on a wall, so installable.
  sculpture: 'Sculpture',              // freestanding: placed, never hung
  furniture: 'Furniture',
  decor: 'Décor',
  other: 'Other fragile or valuable item',
  custom: 'Other request',             // free text, always a custom quote
};
// Wall pieces priced from the painting size/quantity tables (delivery + installation). ASSUMPTION for mirror and wallart.
const WALL_TYPES = ['painting', 'mirror', 'wallart'];
// Framing is asked only for these; mirrors have glass implied.
const FRAMING_TYPES = ['painting', 'wallart'];
const yn = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '');
const typeLabel = (it) => TYPES[it.type || 'painting'] || it.type;
function framingText(it) {
  const t = it.type || 'painting';
  if (t === 'mirror') return 'Glass (mirror)';
  if (!FRAMING_TYPES.includes(t)) return '';
  if (it.framed === 'yes') return `Framed: Yes · Glazing: ${yn(it.glazing) || '—'}`;
  if (it.framed === 'no') return 'Framed: No';
  return it.framedGlass ? 'Framed with glass (legacy)' : 'Framed: —';
}
const itemLine = (it) => [`${it.qty || 1}× ${it.description || 'Item'}`, typeLabel(it), framingText(it)].filter(Boolean).join(' · ');
function framingErrors(items = []) {
  return items.some((it) => FRAMING_TYPES.includes(it.type || 'painting') && !(it.framed === 'no' || (it.framed === 'yes' && ['yes', 'no'].includes(it.glazing))));
}
module.exports = { TYPES, WALL_TYPES, FRAMING_TYPES, typeLabel, framingText, itemLine, framingErrors };
