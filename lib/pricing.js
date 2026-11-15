const config = require('../config');
const { regionFor } = require('./scheduling');
const { outsideCA } = require('./geo');
const { WALL_TYPES } = require('./itemtypes');

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
const HUNG_DECOR = ['Wall Decor', 'Mirror'];
const SIZE_INDEX = { small: 0, light: 0, medium: 1, average: 1, large: 2, heavy: 2 };
const money = (n) => Math.round(n * 100) / 100;

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
  const list = config.pricing.furniture.items[kind];
  if (!list) return 0;
  const idx = SIZE_INDEX[String(sizeClass || 'medium').toLowerCase()] ?? 1;
  const raw = list[idx];
  return member ? money(raw * (1 - config.pricing.membership.discount)) : raw;
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
  const member = !!order.member;
  const includeTransport = service !== 'install_only';
  const includeInstall = !!(SERVICES[service] && SERVICES[service].install);
  const add = (label, amount) => { if (amount) lines.push({ label, amount: money(amount) }); };

  let wallOtherCount = 0, customRequest = false;
  let paintingCount = 0, largePaintings = 0, declared = 0, otherItems = false;
  let wallDecorCount = 0, largeWallDecor = 0;
  let stairs = false, over700 = false, needsSpecial = false;

  // Placement vs hanging (Chad, Nov 15 2026): sculpture, furniture and freestanding pieces are PLACED, never hung or
  // installed. Placement is part of the delivery price on the rate cards (no separate placement rate exists).
  // Only wall-hung pieces (paintings, wall décor, mirrors) are hung and priced from the painting installation table.
  let hungDecorCount = 0, placedCount = 0, chandelierHang = false;
  const info = []; // per-item normal price, for the high-value markup (items over $50K)
  for (const it of items) {
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const type = it.type || 'painting';
    declared += (Number(it.value) || 0) * q;
    const dims = [it.w, it.h, it.d].map(Number).filter(Boolean);
    const maxSide = dims.length ? Math.max(...dims) : 0;

    if (type === 'sculpture') {
      // Sculpture Delivery Pricing card, by weight. One price covers pickup, delivery and placement (wherever the client wants it;
      // a gallery or warehouse drop is the same price).
      if (includeTransport) {
        const unit = sculpturePrice(it.weight, member);
        add(`Sculpture: pickup, delivery & placement (${it.weight || '?'} lb)${q > 1 ? ' × ' + q : ''}${it.description ? ' · ' + it.description : ''}`, unit * q);
      }
      info.push({ it, q, unit: includeTransport ? sculpturePrice(it.weight, member) : 0 });
      placedCount += q;
      if (Number(it.weight) > 700) over700 = true;
      if (maxSide >= 72) needsSpecial = true;
    } else if (type === 'other') {
      // Not on any card: priced by weight from the sculpture card (closest published rate), placement included.
      otherItems = true;
      if (includeTransport) {
        const unit = sculpturePrice(it.weight, member);
        add(`Fragile / valuable item: pickup, delivery & placement (${it.weight || '?'} lb)${q > 1 ? ' × ' + q : ''}${it.description ? ' · ' + it.description : ''}`, unit * q);
      }
      info.push({ it, q, unit: includeTransport ? sculpturePrice(it.weight, member) : 0 });
      placedCount += q;
      if (Number(it.weight) > 700) over700 = true;
      if (maxSide >= 72) needsSpecial = true;
    } else if (type === 'furniture' || type === 'decor') {
      // Furniture & Décor card, by size (Small/Light, Medium/Average, Large/Heavy).
      const kind = it.furnitureKind || (type === 'decor' ? 'Wall Decor' : 'Sofa');
      if (kind === config.pricing.furniture.accents.label || kind === 'accent') {
        const list = member ? p.furniture.accents.member : p.furniture.accents.nonMember;
        const idx = Math.min(list.length - 1, Math.max(0, (SIZE_INDEX[String(it.sizeClass || 'medium').toLowerCase()] ?? 1)));
        if (includeTransport) add(`Décor / accents (${it.sizeClass || 'medium'})${q > 1 ? ' × ' + q : ''}`, list[idx] * q);
        info.push({ it, q, unit: includeTransport ? list[idx] : 0 });
        placedCount += q;
      } else {
        const unit = furniturePrice(kind, it.sizeClass, member);
        const isFurniture = type === 'furniture' && !DECOR_KINDS.includes(kind);
        if (includeTransport) add(isFurniture ? `${kind}: pickup, delivery & placement (${it.sizeClass || 'medium'})${q > 1 ? ' × ' + q : ''}` : `${kind} (${it.sizeClass || 'medium'})${q > 1 ? ' × ' + q : ''}`, unit * q);
        const bigWall = kind === 'Wall Decor' && maxSide >= p.largeWallDecor.overInches;
        if (kind === 'Wall Decor') {
          wallDecorCount += q;
          if (bigWall) largeWallDecor += q;
        }
        info.push({ it, q, hung: includeInstall && HUNG_DECOR.includes(kind), unit: (includeTransport ? unit : 0)
          + (bigWall ? (includeTransport ? p.largeWallDecor.deliveryFee : 0) + (includeInstall ? p.largeWallDecor.installFee : 0) : 0) });
        if (HUNG_DECOR.includes(kind)) { if (includeInstall) hungDecorCount += q; }
        else if (kind === 'Chandelier') { if (includeInstall) chandelierHang = true; else placedCount += q; }
        else placedCount += q;
      }
    } else if (type === 'custom') {
      // "Other request": free text, nothing on the rate cards -> custom quote.
      customRequest = true;
    } else {
      // Painting, Mirror, Other wall art: painting size/quantity tables (ASSUMPTION for mirror + other wall art, Chad Nov 15).
      paintingCount += q;
      if (type !== 'painting' && WALL_TYPES.includes(type)) wallOtherCount += q;
      const big = maxSide >= p.largePainting.overInches;
      if (big) largePaintings += q;
      info.push({ it, q, painting: true, hung: includeInstall, unit: big ? (includeTransport ? p.largePainting.deliveryFee : 0) + (includeInstall ? p.largePainting.installFee : 0) : 0 });
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
  if (includeTransport && largeWallDecor) add(`Oversize wall décor (48"+) delivery × ${largeWallDecor}`, largeWallDecor * p.largeWallDecor.deliveryFee);
  if (includeInstall && largeWallDecor) add(`Oversize wall décor (48"+) install × ${largeWallDecor}`, largeWallDecor * p.largeWallDecor.installFee);
  if (chandelierHang) notes.push('Chandelier hanging is not on our rate card, so CAD quotes it.');

  if (over700) notes.push(p.sculptureOver700.note);
  if (otherItems) notes.push(p.otherItemNote);
  if (needsSpecial) notes.push('For pieces that are especially long, wide or heavy, an additional delivery fee may apply. CAD confirms it.');

  for (const key of ['pickup', 'dropoff']) {
    const a = order[key];
    if (!a || (key === 'pickup' && SERVICES[service] && !SERVICES[service].needsPickup)) continue;
    const flights = parseInt(a.stairs, 10) || 0;
    if (flights > 0) stairs = true;
  }
  if (stairs) notes.push(p.stairsNote);

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
    const normal = x.unit + (x.painting ? paintShare : 0) + (x.hung ? hangShare : 0);
    add(`High-value handling +${pct}% · ${x.it.description || (x.it.type || 'piece')} ($${v.toLocaleString()})${x.q > 1 ? ' × ' + x.q : ''}`, money(normal * (pct / 100) * x.q));
  }
  if (protectedValue > 0) add(`${p.valuation.label} on $${protectedValue.toLocaleString()}`, money(protectedValue * p.valuation.rate));
  if (highValue) notes.push(HIGH_VALUE_NOTE);

  const regularTotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const unpriced = chandelierHang || customRequest || regularTotal <= 0; // nothing on the cards covers it -> CAD quotes it
  const special = !!(order.rush || order.dedicated || order.crating || unpriced);
  const kind = [order.rush && 'rush', order.dedicated && 'dedicated trip', order.crating && 'custom crating', chandelierHang && 'chandelier hanging', customRequest && 'custom request', !chandelierHang && !customRequest && regularTotal <= 0 && 'custom'].filter(Boolean).join(' + ');
  const tripPremium = !!(order.rush || order.dedicated);

  const base = {
    lines, total: regularTotal, regularTotal, notice: p.exampleRatesNotice,
    notes, member, regions: { pickup: rPU, dropoff: rDO },
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
      quoteKind: kind, tripPremium, crating: !!order.crating, extraQuoted: [chandelierHang && 'Chandelier hanging', customRequest && 'Other request'].filter(Boolean).join(' + ') || null,
      quoteNote: [
        tripPremium && `Rush and dedicated trips are quoted at ${p.quoteMultiplierMin}× to ${p.quoteMultiplierMax}× the regular rate, depending on how far out of the way the trip is and how large the job is.`,
        order.crating && 'Custom crating is built by our trusted partner and added to your quote.',
        chandelierHang && 'Chandelier hanging is quoted by CAD.',
        customRequest && 'Your “Other request” is reviewed and quoted by CAD.',
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
    total: 0, regularTotal: 0, notice: config.pricing.exampleRatesNotice, notes, member: !!order.member,
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

module.exports = { SHIPPING_INSURED_NOTE, HIGH_VALUE_TIERS, highValuePct, HIGH_VALUE_NOTE, OUT_OF_STATE_NOTE, isOutOfState, quote, paymentPlan, applyApprovedPrice, SERVICES, OFFERED_SERVICES, FURNITURE_KINDS, DECOR_KINDS, displayFrom };
