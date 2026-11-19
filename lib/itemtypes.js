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
// ---- One entry = exactly ONE piece (Chad, Nov 18 2026) ----
// The order form has no quantity box. Older saved orders (and any API caller) may still send qty > 1: expandPieces turns
// that into separate pieces so every later step sees one piece with its own size, value, weight and photos.
const MAX_PIECES = 60;
const cloneJson = (x) => JSON.parse(JSON.stringify(x));
const qtyOf = (it) => Math.max(1, Math.min(MAX_PIECES + 1, parseInt(String((it && it.qty) ?? '').replace(/,/g, ''), 10) || 1));
// Permanent internal piece ids: the label ("Piece 3") renumbers when a piece is removed, the id never changes.
// Missing or repeated ids are repaired deterministically (same input -> same ids), so a double submit still looks identical.
const cleanId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '');
function ensureIds(list) {
  const seen = new Set();
  list.forEach((it, i) => {
    let id = cleanId(it.id) || `pc-${i + 1}`;
    if (seen.has(id)) { let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    seen.add(id); it.id = id;
  });
  return list;
}
function expandPieces(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const n = qtyOf(it);
    for (let k = 0; k < n; k++) { const c = cloneJson(it); delete c.qty; out.push(c); }
    if (out.length > MAX_PIECES * 2) break; // absurd input: validation reports "no more than 60 pieces"
  }
  return ensureIds(out);
}
// Audit record for old entries that carried a quantity: the ORIGINAL item (with its qty, byte for byte) and where it ended up.
// Stored on the order as legacyQty so nobody has to guess what the customer actually typed; the order is also flagged for manual review.
function legacyQtyRecord(items) {
  const out = []; let at = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const n = qtyOf(it);
    if (n > 1) out.push({ qty: n, firstPiece: at + 1, lastPiece: at + n, originalItem: cloneJson(it) });
    at += n;
  }
  return out;
}
const legacyNote = (rec) => (rec || []).map((r) => `entry for Pieces ${r.firstPiece}–${r.lastPiece} was entered as quantity ${r.qty} ("${String((r.originalItem && r.originalItem.description) || '').slice(0, 60)}")`).join('; ');
const hasMultiQty = (items) => (Array.isArray(items) ? items : []).some((it) => it && qtyOf(it) > 1);
// "Piece 2" / "Piece 2 — Canvas painting": the one way a piece is named in emails, admin, quotes and the schedule.
const pieceName = (i) => `Piece ${Number(i) + 1}`;
const pieceLabel = (it, i) => { const d = String((it && it.description) || '').trim().replace(/\s+/g, ' '); return d ? `${pieceName(i)} — ${d.length > 60 ? d.slice(0, 57) + '…' : d}` : pieceName(i); };
// Partner (Paloma's) catalog lines legitimately carry a quantity; everything else is one entry = one piece.
const piecesOf = (order) => ((order && (order.partnerOrder || order.skipVolumeDiscount)) ? ((order && order.items) || []) : expandPieces(order && order.items));
const itemLine = (it, i) => [typeof i === 'number' ? pieceLabel(it, i) : `${it.qty && it.qty > 1 ? it.qty + '× ' : ''}${it.description || 'Item'}`, typeLabel(it), framingText(it)].filter(Boolean).join(' · ');
// Full one-line detail for admin: label, type, framing, size, weight, value, handling, photos.
const pieceDetail = (it, i) => {
  const dims = [it.w, it.h, it.d].filter(Boolean).join(' × ');
  const val = Number(String(it.value ?? '').replace(/,/g, ''));
  return [itemLine(it, i), dims && `${dims} in`, it.weightUnsure ? 'weight not sure' : (it.weight && `${it.weight} lb`), val > 0 && `value $${val.toLocaleString('en-US')}`, it.fragile && 'special handling', it.photos && it.photos.length && `${it.photos.length} photo${it.photos.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
};
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
  MAX_PIECES, expandPieces, ensureIds, pieceDetail, hasMultiQty, legacyQtyRecord, legacyNote, pieceName, pieceLabel, piecesOf,
  HANG_WHERE_LABELS, isHungItem, hangText, isMirrorItem, routeDecorMirror,
};
