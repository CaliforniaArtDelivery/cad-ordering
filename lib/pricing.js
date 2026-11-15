const config = require('../config');
const { regionFor } = require('./scheduling');
const { outsideCA } = require('./geo');
const { WALL_TYPES, isMirrorItem } = require('./itemtypes');
const { resolveMember } = require('./members');

// CAD has no delivery-only or pickup-only service: everything picked up gets delivered.
// `delivery` / `pickup` stay only so older saved orders still render; they are never offered (legacy: true).
const SERVICES = {
  pickup_delivery: { label: 'Pickup + Delivery', needsPickup: true, needsDropoff: true, install: false },
  delivery_install: { label: 'Pickup, Delivery + Install', needsPickup: true, needsDropoff: true, install: true },
  install_only: { label: 'Install only', needsPickup: false, needsDropoff: true, install: true },
  // Always a custom quote priced by Samantha (no rate card, no instant payment). Destination may be international.
  crating_shipping: { label: 'Shipping', needsPickup: true, needsDropoff: true, install: false, shipping: true },
  delivery: { label: 'Pickup + Delivery', needsPickup: true, needsDropoff: true, install: false, legacy: true },
  pickup: { label: 'Pickup + Delivery', needsPickup: true, needsDropoff: true, install: false, legacy: true },
};
const OFFERED_SERVICES = Object.fromEntries(Object.entries(SERVICES).filter(([, v]) => !v.legacy));

const DECOR_KINDS = config.pricing.furniture.decorKinds;
const FURNITURE_KINDS = Object.keys(config.pricing.furniture.items).filter((k) => !DECOR_KINDS.includes(k));
// Pieces that get hung/mounted/placed by the installer (furniture placement is part of delivery; lamps just get placed).
// Wall-hung décor: hung like paintings. Everything else (accents, lamps) is placed.
const HUNG_DECOR = config.pricing.furniture.hungDecor || ['Wall Decor', 'Mirror'];
const WALL_DECOR_KINDS = config.pricing.furniture.wallDecorKinds || ['Wall Decor'];
const QUOTE_HANG = config.pricing.furniture.quoteHang || ['Chandelier'];
const pricedKind = (kind) => (config.pricing.furniture.priceAs && config.pricing.furniture.priceAs[kind]) || kind;
const ACCENT_KINDS = new Set([
  ...((config.pricing.furniture.accents && config.pricing.furniture.accents.kinds) || []),
  config.pricing.furniture.accents.label,
  'accent',
]);
const SIZE_INDEX = { small: 0, light: 0, medium: 1, average: 1, large: 2, heavy: 2 };
// Five printed sizes on the vases/accents row. Not named on the card; form labels are Extra small → Extra large.
const ACCENT_SIZE_INDEX = {
  xs: 0, xsmall: 0, extrasmall: 0, 'extra-small': 0, 'extra small': 0,
  small: 1, medium: 2, large: 3,
  xl: 4, xlarge: 4, extralarge: 4, 'extra-large': 4, 'extra large': 4,
};
const isAccentKind = (kind) => ACCENT_KINDS.has(kind);
const money = (n) => Math.round(n * 100) / 100;
const numVal = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
// Round up to the next $5 (exact multiples of $5 stay). Cents first so 100.0000001 does not jump to $105.
const roundUpTo = (n, step = 5) => {
  const cents = Math.round(Number(n) * 100) / 100;
  if (!(cents > 0)) return 0;
  return Math.ceil(cents / step - 1e-9) * step;
};

// Face size only (width and height). Depth does not trigger a large-mirror install or transport tier.
const DEFAULT_MIRROR_INSTALL_TIERS = [
  { overInches: 70, multiplier: 3 },
  { overInches: 60, multiplier: 2.5 },
  { overInches: 48, multiplier: 1.5 },
];
const DEFAULT_MIRROR_TRANSPORT_TIERS = [
  { overInches: 70, multiplier: 2 },
  { minInches: 60, multiplier: 1.5 },
];
function mirrorFaceInches(it) {
  return Math.max(numVal(it && it.w), numVal(it && it.h));
}
function mirrorTierThreshold(tier) {
  return tier.overInches != null ? tier.overInches : (tier.minInches || 0);
}
function pickMirrorTier(it, tiers) {
  const size = mirrorFaceInches(it);
  const list = [...(tiers || [])].sort((a, b) => mirrorTierThreshold(b) - mirrorTierThreshold(a));
  return list.find((tier) => (tier.overInches != null ? size > tier.overInches : size >= (tier.minInches || 0)))
    || { overInches: 0, multiplier: 1 };
}
function mirrorInstallTier(it) {
  const cfg = config.pricing.mirrorInstall || {};
  return pickMirrorTier(it, cfg.tiers || DEFAULT_MIRROR_INSTALL_TIERS);
}
function mirrorTransportTier(it) {
  const cfg = config.pricing.mirrorTransport || {};
  return pickMirrorTier(it, cfg.tiers || DEFAULT_MIRROR_TRANSPORT_TIERS);
}
function paintingOversize(it, feeKey) {
  const lp = config.pricing.largePainting || {};
  const maxSide = Math.max(numVal(it && it.w), numVal(it && it.h), numVal(it && it.d));
  return maxSide >= (lp.overInches || 72) ? (lp[feeKey] || 0) : 0;
}
function paintingInstallUnit(it, hangShare, includeInstall) {
  if (!includeInstall) return 0;
  return hangShare + paintingOversize(it, 'installFee');
}
function paintingTransportUnit(it, paintShare, includeTransport) {
  if (!includeTransport) return 0;
  return paintShare + paintingOversize(it, 'deliveryFee');
}
function applyMirrorMultiplier(base, mult, roundTo) {
  if (!(mult > 1)) return base;
  return roundUpTo(base * mult, roundTo || 5);
}
function mirrorInstallUnit(it, hangShare, includeInstall) {
  const base = paintingInstallUnit(it, hangShare, includeInstall);
  if (!includeInstall || !isMirrorItem(it)) return base;
  return applyMirrorMultiplier(base, mirrorInstallTier(it).multiplier || 1, (config.pricing.mirrorInstall || {}).roundTo);
}
function mirrorInstallExtra(it, hangShare, includeInstall) {
  if (!includeInstall || !isMirrorItem(it) || (mirrorInstallTier(it).multiplier || 1) === 1) return 0;
  return money(mirrorInstallUnit(it, hangShare, includeInstall) - paintingInstallUnit(it, hangShare, includeInstall));
}
function mirrorTransportUnit(it, paintShare, includeTransport) {
  const base = paintingTransportUnit(it, paintShare, includeTransport);
  if (!includeTransport || !isMirrorItem(it)) return base;
  return applyMirrorMultiplier(base, mirrorTransportTier(it).multiplier || 1, (config.pricing.mirrorTransport || {}).roundTo);
}
function mirrorTransportExtra(it, paintShare, includeTransport) {
  if (!includeTransport || !isMirrorItem(it) || (mirrorTransportTier(it).multiplier || 1) === 1) return 0;
  return money(mirrorTransportUnit(it, paintShare, includeTransport) - paintingTransportUnit(it, paintShare, includeTransport));
}
function mirrorTierLabel(tier) {
  if (tier && tier.overInches) return `over ${tier.overInches}"`;
  if (tier && tier.minInches) return `${tier.minInches}"+`;
  return '';
}
function addMirrorMultiplierLines(items, include, extraFn, share, kind, member, add) {
  if (!include) return;
  const buckets = new Map();
  for (const it of items) {
    if (!isMirrorItem(it)) continue;
    const tier = kind === 'install' ? mirrorInstallTier(it) : mirrorTransportTier(it);
    if (!(tier.multiplier > 1)) continue;
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const extra = extraFn(it, share, include);
    if (!extra) continue;
    const key = mirrorTierLabel(tier);
    const cur = buckets.get(key) || { extra: 0, count: 0 };
    cur.extra += extra * q;
    cur.count += q;
    buckets.set(key, cur);
  }
  const title = kind === 'install' ? 'Large mirror install' : 'Large mirror pickup & delivery';
  [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).forEach(([label, b]) => {
    add(`${title} (${label}) × ${b.count}${member ? ' (member)' : ''}`, b.extra);
  });
}

function largestDim(it) {
  return Math.max(0, numVal(it && it.w), numVal(it && it.h), numVal(it && it.d));
}
function pieceWeight(it) {
  if (!it || it.weightUnsure) return null;
  const n = numVal(it.weight);
  return n > 0 ? n : null;
}
function accessWeightRate(it, fees) {
  const rows = (fees || (config.pricing.accessFees || {})).weight || [];
  const w = pieceWeight(it);
  if (w == null) return 0;
  const hit = rows.find((row) => (row.exclusive ? w > row.minLb : w >= row.minLb));
  return hit ? hit.fee : 0;
}
function accessSizeRate(it, fees) {
  const rows = (fees || (config.pricing.accessFees || {})).size || [];
  const d = largestDim(it);
  const hit = rows.find((row) => (row.exclusive ? d > row.minIn : d >= row.minIn));
  return hit ? hit.fee : 0;
}
function accessPieceRate(it, fees) {
  const f = fees || config.pricing.accessFees || {};
  const weightRate = accessWeightRate(it, f);
  const sizeRate = accessSizeRate(it, f);
  return Math.max(weightRate, sizeRate);
}
// How many flight-units to charge at a stop. None / ≤3 steps = 0; half flight = 0.5; else the flight count.
function flightUnits(addr) {
  if (!addr) return 0;
  const kind = addr.stairKind || (addr.steps && !(Number(addr.stairs) > 0) ? 'steps' : (Number(addr.stairs) > 0 ? (Number(addr.stairs) === 0.5 ? 'half' : 'flights') : 'none'));
  if (kind === 'none' || kind === 'steps') return 0;
  if (kind === 'half') return 0.5;
  const n = Number(addr.stairs);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function stairsPresent(addr) {
  if (!addr) return false;
  const kind = addr.stairKind || (addr.steps && !(Number(addr.stairs) > 0) ? 'steps' : (Number(addr.stairs) > 0 ? 'flights' : 'none'));
  return kind !== 'none' && kind !== '';
}
function stairsLabel(addr) {
  if (!addr) return '';
  const kind = addr.stairKind || (addr.steps && !(Number(addr.stairs) > 0) ? 'steps' : (Number(addr.stairs) === 0.5 ? 'half' : (Number(addr.stairs) > 0 ? 'flights' : 'none')));
  if (kind === 'steps') return '3 steps or fewer';
  if (kind === 'half') return 'Half flight of stairs';
  const n = Number(addr.stairs) || 0;
  if (kind === 'flights' || n > 0) return `${n} flight${n === 1 ? '' : 's'} of stairs`;
  return '';
}
function flightsPhrase(units) {
  if (units === 0.5) return '½ flight';
  if (units === 1) return '1 flight';
  return `${units} flights`;
}
function stopAccessName(key, service) {
  if (key === 'pickup') return 'pickup';
  if (service === 'install_only') return 'install';
  if (service === 'crating_shipping') return 'destination';
  return 'delivery';
}
function needsStairwellFit(it, order) {
  if (largestDim(it) <= 80) return false;
  const sv = SERVICES[order.service || 'pickup_delivery'] || {};
  const stops = [];
  if (sv.needsPickup) stops.push(order.pickup);
  stops.push(order.dropoff);
  return stops.some(stairsPresent);
}

const FRAME_TYPE_SHORT = { small: 'small/light', medium: 'medium', large: 'large/heavy' };

function frameInstallFee(it) {
  const hf = (config.pricing.heavyFrame || {});
  if (!it || it.framed !== 'yes' || !it.frameType || !hf.install) return 0;
  const dim = largestDim(it);
  const ask = hf.askOverInches || 48;
  const mid = hf.midInches || 72;
  if (!(dim > ask)) return 0;
  const table = dim > mid ? hf.install.over72 : hf.install.upTo72;
  return (table && table[it.frameType]) || 0;
}
function hangInstallSurcharge(it) {
  const hi = config.pricing.hangInstall || {};
  if (!it || it.hangHeight !== 'higher') return { fee: 0, kind: 'standard', review: false };
  const where = it.hangWhere;
  if (where === 'mantel') {
    const over = largestDim(it) > (config.pricing.heavyFrame && config.pricing.heavyFrame.midInches || 72);
    return { fee: over ? (hi.mantel && hi.mantel.over72) || 0 : (hi.mantel && hi.mantel.upTo72) || 0, kind: 'mantel', review: false };
  }
  if (where === 'high') return { fee: hi.high || 0, kind: 'high', review: false };
  if (where === 'stairwell') return { fee: hi.stairwell || 0, kind: 'stairwell', review: false };
  if (where === 'other') return { fee: hi.other || 0, kind: 'other', review: true };
  return { fee: 0, kind: where || 'higher', review: false };
}
function hangInstallLabel(kind) {
  return { mantel: 'Install above a mantel', high: 'High-wall install', stairwell: 'Stairwell install', other: 'Custom hanging location' }[kind] || 'Install surcharge';
}

function addInstallSurchargeLines(order, add, notes) {
  const service = order.service || 'pickup_delivery';
  const includeInstall = !!(SERVICES[service] && SERVICES[service].install);
  if (!includeInstall) return;
  const items = Array.isArray(order.items) ? order.items : [];
  const mid = (config.pricing.heavyFrame || {}).midInches || 72;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const piece = 'Piece ' + (i + 1);
    const inst = frameInstallFee(it);
    if (inst) {
      const dim = largestDim(it);
      const typ = FRAME_TYPE_SHORT[it.frameType] || it.frameType;
      const sizeBit = dim > mid ? 'over 72"' : 'over 48"';
      const qtyBit = q > 1 ? ' × ' + q : '';
      add('Frame handling — ' + piece + ' (' + typ + ', ' + sizeBit + ')' + qtyBit, inst * q);
    }
    const hang = hangInstallSurcharge(it);
    if (hang.review) notes.push(piece + ' has a custom hanging location — CAD will confirm.');
    if (hang.fee) {
      const qtyBit = q > 1 ? ' × ' + q : '';
      add(hangInstallLabel(hang.kind) + ' — ' + piece + qtyBit, hang.fee * q);
    }
  }
}

function addAccessFeeLines(order, add, notes) {
  const fees = config.pricing.accessFees || {};
  const service = order.service || 'pickup_delivery';
  const sv = SERVICES[service] || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const stops = [];
  if (sv.needsPickup) stops.push(['pickup', order.pickup]);
  stops.push(['dropoff', order.dropoff]);
  let flagged = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const rate = accessPieceRate(it, fees);
    const piece = `Piece ${i + 1}`;
    const unknown = pieceWeight(it) == null && !!it.weightUnsure;
    for (const [key, addr] of stops) {
      if (!addr) continue;
      const units = flightUnits(addr);
      const carry = !!addr.technicalCarry;
      if (!units && !carry) continue;
      if (unknown) flagged = true;
      const stop = stopAccessName(key, service);
      if (units && rate) {
        const amount = money(units * rate * q);
        const qtyBit = q > 1 ? ` × ${q}` : '';
        add(`Stairs — ${piece}, ${stop} (${flightsPhrase(units)} × $${rate}${qtyBit})`, amount);
      }
      if (carry && rate) {
        const amount = money(rate * q);
        const qtyBit = q > 1 ? ` × ${q}` : '';
        add(`Technical carry — ${piece}, ${stop} ($${rate}${qtyBit})`, amount);
      }
    }
  }
  if (flagged) notes.push('A piece is marked weight not sure — CAD will confirm any stairs or technical-carry fee.');
}


function paymentPlan(total, service) {
  const c = config.payment;
  const when = service === 'install_only' ? 'at installation' : c.balanceDueLabel;
  if (total >= c.depositThreshold) {
    const dueNow = money(total * c.depositPercent / 100);
    return {
      paymentPlan: 'deposit', dueNow, balanceDue: money(total - dueNow), balanceWhen: when,
      paymentSummary: `${c.depositPercent}% due at booking, balance due ${when}`,
    };
  }
  return { paymentPlan: 'full', dueNow: total, balanceDue: 0, balanceWhen: null, paymentSummary: 'Paid in full at booking' };
}

function tablePrice(table, count, member) {
  if (count <= 0) return 0;
  const list = member ? table.member : table.nonMember;
  if (count <= list.length) return list[count - 1];
  return list[list.length - 1] + (count - list.length) * table.extra;
}

function sculpturePrice(weight, member) {
  const p = config.pricing;
  const w = Number(weight) || 0;
  for (const row of p.sculptureByWeight) {
    if (w <= row.maxLbs) return member ? row.member : row.nonMember;
  }
  return member ? p.sculptureOver700.member : p.sculptureOver700.nonMember;
}

function furniturePrice(kind, sizeClass, member) {
  const key = pricedKind(kind);
  const list = config.pricing.furniture.items[key];
  if (!list) return 0;
  const idx = SIZE_INDEX[String(sizeClass || 'medium').toLowerCase()] ?? 1;
  const printed = config.pricing.furniture.itemMembers && config.pricing.furniture.itemMembers[key];
  if (member && printed && printed[idx] != null) return printed[idx];
  const raw = list[idx];
  return member ? money(raw * (1 - config.pricing.membership.discount)) : raw;
}

function accentPrice(sizeClass, member, kind) {
  const row = config.pricing.furniture.accents;
  const list = member ? row.member : row.nonMember;
  const raw = String(sizeClass || 'medium').toLowerCase();
  // Older orders used the lumped label with only Small/Medium/Large, mapped to the first three prices.
  const idx = (kind === row.label || kind === 'accent')
    ? (SIZE_INDEX[raw] ?? 1)
    : (ACCENT_SIZE_INDEX[raw] ?? 2);
  return list[Math.min(list.length - 1, Math.max(0, idx))];
}

function quote(order) {
  const p = config.pricing;
  const lines = [];
  const notes = [];
  const service = order.service || 'pickup_delivery';
  const sv = SERVICES[service];
  if (sv && sv.shipping) return shippingQuote(order, !!order.outOfState);
  if (isOutOfState(order)) return shippingQuote(order, true);
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{ qty: 1, type: 'painting' }];
  const membership = resolveMember(order);
  const member = !!membership;
  const includeTransport = service !== 'install_only';
  const includeInstall = !!(SERVICES[service] && SERVICES[service].install);
  const add = (label, amount) => { if (amount) lines.push({ label, amount: money(amount) }); };

  let wallOtherCount = 0, customRequest = false;
  let paintingCount = 0, largePaintings = 0, declared = 0, otherItems = false;
  let heavyFrameDel = 0;
  let weightReview = false;
  let wallDecorCount = 0, largeWallDecor = 0;
  let stairs = false, over700 = false, needsSpecial = false;

  // Placement vs hanging (Chad, Nov 15 2026): sculpture, furniture and freestanding pieces are PLACED, never hung or
  // installed. Placement is part of the delivery price on the rate cards (no separate placement rate exists).
  // Only wall-hung pieces (paintings, wall décor, mirrors) are hung and priced from the painting installation table.
  let hungDecorCount = 0, placedCount = 0, quoteHangKinds = [];
  const info = []; // per-item normal price, for the high-value markup (items over $50K)
  for (const it of items) {
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const type = isMirrorItem(it) ? 'mirror' : (it.type || 'painting');
    declared += (Number(it.value) || 0) * q;
    const dims = [it.w, it.h, it.d].map(Number).filter(Boolean);
    const maxSide = dims.length ? Math.max(...dims) : 0;

    if (type === 'sculpture') {
      // Sculpture Delivery Pricing card, by weight. One price covers pickup, delivery and placement (wherever the client wants it;
      // a gallery or warehouse drop is the same price).
      if (it.weightUnsure || !(Number(String(it.weight || '').replace(/,/g, '')) > 0)) {
        weightReview = true;
        info.push({ it, q, unit: 0 });
        placedCount += q;
      } else {
      if (includeTransport) {
        const unit = sculpturePrice(it.weight, member);
        add(`Sculpture: pickup, delivery & placement (${it.weight || '?'} lb)${q > 1 ? ' × ' + q : ''}${it.description ? ' · ' + it.description : ''}`, unit * q);
      }
      info.push({ it, q, unit: includeTransport ? sculpturePrice(it.weight, member) : 0 });
      placedCount += q;
      if (Number(it.weight) > 700) over700 = true;
      if (maxSide >= 72) needsSpecial = true;
      }
    } else if (type === 'other') {
      // Not on any card: priced by weight from the sculpture card (closest published rate), placement included.
      otherItems = true;
      if (it.weightUnsure || !(Number(String(it.weight || '').replace(/,/g, '')) > 0)) {
        weightReview = true;
        info.push({ it, q, unit: 0 });
        placedCount += q;
      } else {
      if (includeTransport) {
        const unit = sculpturePrice(it.weight, member);
        add(`Fragile / valuable item: pickup, delivery & placement (${it.weight || '?'} lb)${q > 1 ? ' × ' + q : ''}${it.description ? ' · ' + it.description : ''}`, unit * q);
      }
      info.push({ it, q, unit: includeTransport ? sculpturePrice(it.weight, member) : 0 });
      placedCount += q;
      if (Number(it.weight) > 700) over700 = true;
      if (maxSide >= 72) needsSpecial = true;
      }
    } else if (type === 'furniture' || type === 'decor') {
      // Furniture & Décor card, by size (Small/Light, Medium/Average, Large/Heavy).
      const kind = it.furnitureKind || (type === 'decor' ? 'Wall Decor' : 'Sofa');
      if (isAccentKind(kind)) {
        const unit = accentPrice(it.sizeClass, member, kind);
        if (includeTransport) add(`${kind} (${it.sizeClass || 'medium'})${q > 1 ? ' × ' + q : ''}`, unit * q);
        info.push({ it, q, unit: includeTransport ? unit : 0 });
        placedCount += q;
      } else {
        const unit = furniturePrice(kind, it.sizeClass, member);
        const isFurniture = type === 'furniture' && !DECOR_KINDS.includes(kind);
        if (includeTransport) add(isFurniture ? `${kind}: pickup, delivery & placement (${it.sizeClass || 'medium'})${q > 1 ? ' × ' + q : ''}` : `${kind} (${it.sizeClass || 'medium'})${q > 1 ? ' × ' + q : ''}`, unit * q);
        const bigWall = WALL_DECOR_KINDS.includes(kind) && maxSide >= p.largeWallDecor.overInches;
        if (WALL_DECOR_KINDS.includes(kind)) {
          wallDecorCount += q;
          if (bigWall) largeWallDecor += q;
        }
        info.push({ it, q, hung: includeInstall && HUNG_DECOR.includes(kind), unit: (includeTransport ? unit : 0)
          + (bigWall ? (includeTransport ? p.largeWallDecor.deliveryFee : 0) + (includeInstall ? p.largeWallDecor.installFee : 0) : 0) });
        if (HUNG_DECOR.includes(kind)) { if (includeInstall) hungDecorCount += q; }
        else if (QUOTE_HANG.includes(kind)) { if (includeInstall && !quoteHangKinds.includes(kind)) quoteHangKinds.push(kind); if (!includeInstall) placedCount += q; }
        else placedCount += q;
      }
    } else if (type === 'custom') {
      // "Other request": free text, nothing on the rate cards -> custom quote.
      customRequest = true;
    } else {
      // Painting, Photograph, Mirror, Other wall art: painting size/quantity tables (ASSUMPTION for photograph, mirror + other wall art).
      paintingCount += q;
      if (type !== 'painting' && WALL_TYPES.includes(type)) wallOtherCount += q;
      const big = maxSide >= p.largePainting.overInches;
      if (big) largePaintings += q;
      const hf = p.heavyFrame || {};
      const heavy = it.framed === 'yes' && it.frameType === 'large' && largestDim(it) > (hf.askOverInches || 48);
      if (heavy && includeTransport) heavyFrameDel = (heavyFrameDel || 0) + q;
      info.push({ it, q, painting: true, hung: includeInstall, unit: (big ? (includeTransport ? p.largePainting.deliveryFee : 0) + (includeInstall ? p.largePainting.installFee : 0) : 0) });
    }
  }

  const paintShare = paintingCount && includeTransport ? tablePrice(p.paintingDelivery, paintingCount, member) / paintingCount : 0;
  if (paintingCount && includeTransport) {
    add(`${wallOtherCount ? 'Wall art delivery (paintings, mirrors & other wall art)' : 'Painting delivery'} × ${paintingCount}${member ? ' (member)' : ''}`, tablePrice(p.paintingDelivery, paintingCount, member));
  }
  // Hanging: paintings plus wall-hung décor (wall décor, mirrors) from the Painting Installation table.
  const hangCount = includeInstall ? paintingCount + hungDecorCount : 0;
  const hangShare = hangCount ? tablePrice(p.paintingInstall, hangCount, member) / hangCount : 0;
  if (hangCount) {
    add(`${hungDecorCount || wallOtherCount ? 'Hanging (paintings, mirrors, wall art & wall décor)' : 'Painting installation'} × ${hangCount}${member ? ' (member)' : ''}`, tablePrice(p.paintingInstall, hangCount, member));
  }
  if (includeTransport && largePaintings) add(`Oversize painting (72"+) delivery × ${largePaintings}`, largePaintings * p.largePainting.deliveryFee);
  if (includeInstall && largePaintings) add(`Oversize painting (72"+) install × ${largePaintings}`, largePaintings * p.largePainting.installFee);
  const hf = p.heavyFrame || {};
  if (includeTransport && heavyFrameDel) add(`Large / heavy / ornate frame — pickup & delivery × ${heavyFrameDel}`, heavyFrameDel * (hf.deliveryFee || 25));
  addInstallSurchargeLines(order, add, notes);
  if (includeTransport && largeWallDecor) add(`Oversize wall décor (48"+) delivery × ${largeWallDecor}`, largeWallDecor * p.largeWallDecor.deliveryFee);
  if (includeInstall && largeWallDecor) add(`Oversize wall décor (48"+) install × ${largeWallDecor}`, largeWallDecor * p.largeWallDecor.installFee);
  // Mirror transport: under 60" 1×; 60"+ (inclusive) 1.5×; over 70" 2×. Rounded up to the next $5.
  addMirrorMultiplierLines(items, includeTransport, mirrorTransportExtra, paintShare, 'transport', member, add);
  // Mirror install: up to 48" 1×; over 48" 1.5×; over 60" 2.5×; over 70" 3×. Rounded up to the next $5.
  addMirrorMultiplierLines(items, includeInstall && hangCount, mirrorInstallExtra, hangShare, 'install', member, add);
  quoteHangKinds.forEach((k) => notes.push(`${k} hanging is not on our rate card, so CAD quotes it.`));

  if (over700) notes.push(p.sculptureOver700.note);
  if (otherItems) notes.push(p.otherItemNote);
  if (weightReview) notes.push('A piece is marked weight not sure and is flagged for CAD review.');
  if (needsSpecial) notes.push('For pieces that are especially long, wide or heavy, an additional delivery fee may apply. CAD confirms it.');

  addAccessFeeLines(order, add, notes);

  const rPU = order.pickup && SERVICES[service]?.needsPickup ? regionFor(order.pickup) : null;
  const rDO = order.dropoff ? regionFor(order.dropoff) : null;
  if (rPU && rDO && rPU !== rDO) {
    notes.push('Pickup and drop-off are in different regions. North/South exchanges usually take 1–2 weeks and are split across the next opposite-region route days.');
  }

  // Furniture/décor card footnote: applies when every piece is furniture or décor (both are on that card).
  const furnitureOnly = items.length > 0 && items.every((it) => ['furniture', 'decor'].includes(it.type || 'painting'));
  let subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  // Additional 10% off is a furniture-card footnote and applies only to furniture-only jobs at/over the threshold.
  if (
    p.volumeDiscount
    && subtotal >= p.volumeDiscount.threshold
    && (!p.volumeDiscount.furnitureOnly || furnitureOnly)
  ) {
    const off = money(subtotal * p.volumeDiscount.rate);
    add(`Furniture & décor orders of $${p.volumeDiscount.threshold.toLocaleString()}+ (additional ${Math.round(p.volumeDiscount.rate * 100)}% off)`, -off);
    subtotal = money(subtotal - off);
  }

  // Declared value rules (Chad, Nov 15 2026; in-California white-glove jobs only):
  //  - every piece needs a declared value;
  //  - pieces valued $50,000 or less: declared value protection at 1.5% of value is mandatory;
  //  - pieces over $50,000: no protection offered; high-value handling markup on that piece's normal price instead.
  let protectedValue = 0, highValue = false;
  for (const x of info) {
    const v = Number(x.it.value) || 0;
    if (v <= 0) continue;
    const pct = highValuePct(v);
    if (!pct) { protectedValue += v * x.q; continue; }
    highValue = true;
    const normal = x.unit + (x.painting ? paintShare : 0) + (x.hung ? hangShare : 0)
      + mirrorInstallExtra(x.it, hangShare, includeInstall)
      + mirrorTransportExtra(x.it, paintShare, includeTransport);
    add(`High-value handling +${pct}% · ${x.it.description || (x.it.type || 'piece')} ($${v.toLocaleString()})${x.q > 1 ? ' × ' + x.q : ''}`, money(normal * (pct / 100) * x.q));
  }
  if (protectedValue > 0) add(`${p.valuation.label} on $${protectedValue.toLocaleString()}`, money(protectedValue * p.valuation.rate));
  if (highValue) notes.push(HIGH_VALUE_NOTE);

  const regularTotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const chandelierHang = quoteHangKinds.length > 0;
  const unpriced = chandelierHang || customRequest || weightReview || regularTotal <= 0; // nothing on the cards covers it -> CAD quotes it
  const special = !!(order.rush || order.dedicated || order.crating || unpriced);
  const hangLabel = quoteHangKinds.map((k) => `${k} hanging`).join(' + ').toLowerCase() || 'chandelier hanging';
  const kind = [order.rush && 'rush', order.dedicated && 'dedicated trip', order.crating && 'custom crating', chandelierHang && hangLabel, customRequest && 'custom request', !chandelierHang && !customRequest && regularTotal <= 0 && 'custom'].filter(Boolean).join(' + ');
  const tripPremium = !!(order.rush || order.dedicated);

  const base = {
    lines, total: regularTotal, regularTotal, notice: p.exampleRatesNotice,
    notes, member, memberCompany: membership ? membership.company : '', regions: { pickup: rPU, dropoff: rDO },
  };

  if (special) {
    // Rush / dedicated: 1.5×–2×. Crating alone: transport at the regular rate, crating priced by CAD's partner.
    const low = money(regularTotal * (tripPremium ? p.quoteMultiplierMin : 1));
    const high = money(regularTotal * (tripPremium ? p.quoteMultiplierMax : 1));
    return {
      ...base,
      paymentPlan: 'quote', dueNow: 0, balanceDue: 0, balanceWhen: null,
      paymentSummary: 'Quote requested — no payment until CAD approves a price',
      quoteRange: { low, high, minMultiplier: tripPremium ? p.quoteMultiplierMin : 1, maxMultiplier: tripPremium ? p.quoteMultiplierMax : 1 },
      quoteKind: kind, tripPremium, crating: !!order.crating, extraQuoted: [chandelierHang && quoteHangKinds.map((k) => `${k} hanging`).join(' + '), customRequest && 'Other request'].filter(Boolean).join(' + ') || null,
      quoteNote: [
        tripPremium && `Rush and dedicated trips are quoted at ${p.quoteMultiplierMin}× to ${p.quoteMultiplierMax}× the regular rate, depending on how far out of the way the trip is and how large the job is.`,
        order.crating && 'Custom crating is built by our trusted partner and added to your quote.',
        chandelierHang && quoteHangKinds.map((k) => `${k} hanging is quoted by CAD.`).join(' '),
        customRequest && 'Your “Other request” is reviewed and quoted by CAD.',
        weightReview && 'A piece is marked weight not sure — CAD will confirm.',
        'Samantha sets the final price before any payment is due.',
      ].filter(Boolean).join(' '),
    };
  }

  return { ...base, ...paymentPlan(regularTotal, service) };
}

// High-value handling markup on a piece's normal price (Chad): >$50K +100%, >$100K +200%, >$300K +300%, >$500K +400%,
// >$750K +500%, >$1M +600%. Pieces at $50,000 or less get mandatory 1.5% declared value protection instead.
const HIGH_VALUE_TIERS = [[1000000, 600], [750000, 500], [500000, 400], [300000, 300], [100000, 200], [50000, 100]];
const highValuePct = (v) => { for (const [over, pct] of HIGH_VALUE_TIERS) if (v > over) return pct; return 0; };
const HIGH_VALUE_NOTE = 'CAD doesn’t offer declared value protection on pieces valued over $50,000, so those pieces carry a high-value handling charge instead. Please cover them with your own fine art insurance.';

// Any pickup or delivery address outside California -> Shipping custom quote (Chad, Nov 15 2026).
function isOutOfState(order) {
  const sv = SERVICES[order.service || 'pickup_delivery'] || {};
  return !!((sv.needsPickup && outsideCA(order.pickup)) || outsideCA(order.dropoff));
}
// Shipping, chosen directly or forced because an address is outside California.
function shippingQuote(order, outOfState) {
  const items = order.items || [];
  const declared = items.reduce((s, it) => s + (Number(it.value) || 0) * (Number(it.qty) || 1), 0);
  const notes = [];
  if (outOfState) notes.push(OUT_OF_STATE_NOTE);
  // Shipping quotes: no declared value protection and no high-value markup; covered by the shipping partners' insurance.
  notes.push(SHIPPING_INSURED_NOTE + (declared > 0 ? ` Declared value: $${declared.toLocaleString()}.` : ''));
  return {
    lines: [{ label: 'Shipping', amount: 0, quoted: true }],
    total: 0, regularTotal: 0, notice: config.pricing.exampleRatesNotice, notes, member: !!resolveMember(order), memberCompany: (resolveMember(order) || {}).company || '',
    regions: { pickup: null, dropoff: null },
    paymentPlan: 'quote', dueNow: 0, balanceDue: 0, balanceWhen: null,
    paymentSummary: 'Shipping quote requested — no payment until you approve CAD’s price',
    quoteRange: null, quoteKind: 'shipping', tripPremium: false, crating: true, shipping: true, outOfState: !!outOfState,
    quoteNote: 'Samantha prices shipping for your pieces and destination, then emails you a quote. Pieces may be crated or soft-packed as needed. Nothing is charged until you approve it.',
  };
}
const SHIPPING_INSURED_NOTE = 'Fully insured through our shipping partners.';
const OUT_OF_STATE_NOTE = 'Pickups and deliveries outside California are custom quoted as Shipping. Within California we always provide white-glove delivery. Samantha prices them and emails you a quote; nothing is charged until you approve it.';

function applyApprovedPrice(quoteObj, price, service) {
  const total = money(Number(price));
  return { ...quoteObj, total, approvedPrice: total, ...paymentPlan(total, service) };
}

const displayFrom = {
  pickup_delivery: 200,
  install_only: 75,
  delivery_install: 275,
  crating_shipping: null, // always a custom quote
};

module.exports = { SHIPPING_INSURED_NOTE, HIGH_VALUE_TIERS, highValuePct, HIGH_VALUE_NOTE, OUT_OF_STATE_NOTE, isOutOfState, quote, paymentPlan, applyApprovedPrice, SERVICES, OFFERED_SERVICES, FURNITURE_KINDS, DECOR_KINDS, displayFrom, numVal, largestDim, pieceWeight, accessWeightRate, accessSizeRate, accessPieceRate, flightUnits, stairsPresent, stairsLabel, needsStairwellFit, addAccessFeeLines, frameInstallFee, hangInstallSurcharge, addInstallSurchargeLines, roundUpTo, mirrorFaceInches, mirrorInstallTier, mirrorTransportTier, mirrorInstallUnit, mirrorInstallExtra, mirrorTransportUnit, mirrorTransportExtra };
