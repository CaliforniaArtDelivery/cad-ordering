/** Item types (Chad, Nov 15 2026) and framing details, shared by validation, emails, admin and the CSV. */
const TYPES = {
  painting: 'Painting',
  photograph: 'Photograph',
  mirror: 'Mirror',
  wallart: 'Other wall art',           // mixed media, wall sculpture, etc. Hung on a wall, so installable.
  sculpture: 'Sculpture',              // freestanding: placed, never hung
  furniture: 'Furniture',
  decor: 'Décor',
  other: 'Other fragile or valuable item',
  custom: 'Other request',             // free text, always a custom quote
};
// Wall pieces priced from the painting size/quantity tables (ASSUMPTION for mirror, photograph and wallart).
const WALL_TYPES = ['painting', 'photograph', 'mirror', 'wallart'];
// Framing is asked only for these; mirrors have glass implied.
const FRAMING_TYPES = ['painting', 'photograph', 'wallart'];
// Glass? is asked only for photographs and other wall art, never for paintings, and only when Framed = Yes.
const GLASS_TYPES = ['photograph', 'wallart'];
const FRAME_TYPE_LABELS = { small: 'Small / lightweight', medium: 'Medium', large: 'Large / heavy / ornate' };
const FRAME_TYPE_ASK_OVER = 48;
const yn = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '');
const typeLabel = (it) => TYPES[it.type || 'painting'] || it.type;
// Top-level Mirror, or Décor → Mirror (same item and pricing; two entry points).
const isMirrorItem = (it) => {
  const t = (it && it.type) || 'painting';
  return t === 'mirror' || (t === 'decor' && it.furnitureKind === 'Mirror');
};
const routeDecorMirror = (it) => {
  if (!it || it.type === 'mirror' || !isMirrorItem(it)) return it;
  return { ...it, type: 'mirror', framed: '', glazing: '', frameType: '' };
};
const maxWH = (it) => Math.max(Number(it.w) || 0, Number(it.h) || 0);
const needsGlass = (it) => GLASS_TYPES.includes(it.type) && it.framed === 'yes';
const needsFrameType = (it) => FRAMING_TYPES.includes(it.type || 'painting') && it.framed === 'yes' && maxWH(it) > FRAME_TYPE_ASK_OVER;

function framingText(it) {
  const t = it.type || 'painting';
  if (t === 'mirror') return 'Glass (mirror)';
  if (!FRAMING_TYPES.includes(t)) return '';
  const bits = [];
  if (it.framed === 'yes') {
    bits.push('Framed: Yes');
    if (needsGlass(it)) bits.push(`Glass: ${yn(it.glazing) || '—'}`);
    if (it.frameType && FRAME_TYPE_LABELS[it.frameType]) bits.push(`Frame type: ${FRAME_TYPE_LABELS[it.frameType]}`);
  } else if (it.framed === 'no') {
    bits.push('Framed: No');
  } else {
    bits.push(it.framedGlass ? 'Framed with glass (legacy)' : 'Framed: —');
  }
  return bits.join(' · ');
}
const itemLine = (it) => [`${it.qty || 1}× ${it.description || 'Item'}`, typeLabel(it), framingText(it)].filter(Boolean).join(' · ');
const HANG_WHERE_LABELS = {
  mantel: 'Above a mantel or fireplace',
  high: 'Higher than eye level (ladder needed)',
  stairwell: 'In a stairwell',
  other: 'Other',
};
const isHungItem = (it) => {
  const t = (it && it.type) || 'painting';
  if (WALL_TYPES.includes(t)) return true;
  if (t === 'decor' && ['Wall Decor', 'Mirror', 'Chandelier'].includes(it.furnitureKind)) return true;
  return false;
};
function hangText(it) {
  if (!it || !isHungItem(it)) return '';
  if (it.hangHeight === 'higher') {
    const where = it.hangWhere === 'other' ? (String(it.hangWhereOther || '').trim() || 'Other') : (HANG_WHERE_LABELS[it.hangWhere] || 'Higher than eye level');
    const bits = [where];
    if (it.hangBottomFt) bits.push(`approx. ${it.hangBottomFt} ft to the bottom`);
    if (it.hangPhotos && it.hangPhotos.length) bits.push(`${it.hangPhotos.length} wall photo${it.hangPhotos.length === 1 ? '' : 's'}`);
    return bits.join(' · ');
  }
  if (it.hangHeight === 'standard' || it.centerHeight) return `Standard eye level (${it.centerHeight || 59}" center)`;
  return '';
}
function framingErrors(items = []) {
  return items.some((it) => {
    if (!FRAMING_TYPES.includes(it.type || 'painting')) return false;
    if (it.framed === 'no') return false;
    if (it.framed !== 'yes') return true;
    if (needsGlass(it) && !['yes', 'no'].includes(it.glazing)) return true;
    if (needsFrameType(it) && !FRAME_TYPE_LABELS[it.frameType]) return true;
    return false;
  });
}

module.exports = {
  TYPES, WALL_TYPES, FRAMING_TYPES, GLASS_TYPES, FRAME_TYPE_LABELS, FRAME_TYPE_ASK_OVER,
  typeLabel, maxWH, needsGlass, needsFrameType, framingText, itemLine, framingErrors,
  HANG_WHERE_LABELS, isHungItem, hangText, isMirrorItem, routeDecorMirror,
};
