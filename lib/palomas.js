/**
 * Paloma's Home Furnishings partner ordering flow (Chad, Nov 16 2026).
 * Reuses the CAD pricing engine (member price code PALOMAS = the 25% published member rates) and layers the partner rules on top:
 *   1. Standard CAD price shown struck through, then Paloma's partnership pricing (25% off, CAD member rates).
 *   2. Partnership price of $1,000 or more: an additional 10% off the delivery price.
 *   3. "Manager's courtesy (−15%)" staff option: an additional 15% off what is left (Paloma's staff decide; no approval step).
 * Paloma's pays NO declared value protection (Chad, Nov 16 2026): the engine's protection line is dropped and declared value is optional (records only).
 * The 10% / 15% extras are spread across the line items so each piece has an all-in price; the cents always add up to the order total.
 */
const config = require('../config');
const { quote, paymentPlan, FURNITURE_KINDS, DECOR_KINDS } = require('./pricing');
const ACCESS = require('../public/access');

const PARTNER_NAME = "Paloma's Home Furnishings";
const PARTNER_CODE = 'PALOMAS';
const PARTNER_EMAIL = 'palomas@palomascarmel.com';
const PARTNER_PHONE = '(831) 624-6120';
const PLACED_BY = ['Arnie', 'Heather', 'Carl'];
const ELEVATOR_TYPES = { freight: { service: 'yes', text: 'freight/service elevator' }, passenger: { service: 'no', text: 'passenger elevator only' }, not_sure: { service: 'not_sure', text: 'type not sure' } };
const PICKUPS = {
  salinas: { key: 'salinas', label: 'Salinas warehouse', detail: '329 Rianda St, Salinas', street: '329 Rianda St', city: 'Salinas', state: 'CA', zip: '93901' },
  carmel: { key: 'carmel', label: 'Carmel-by-the-Sea showroom', detail: 'Ocean Ave at Mission St, Carmel-by-the-Sea', street: 'NW corner of Ocean Ave & Mission St (showroom)', city: 'Carmel-by-the-Sea', state: 'CA', zip: '93921' },
};
const RULES = { partnerPct: 25, volumeThreshold: 1000, volumePct: 10, courtesyPct: 15 };
const SIZE_STD = ['small', 'medium', 'large'];
const SIZE_ACC = ['xs', 'small', 'medium', 'large', 'xl'];
const ACCENTS = new Set(config.pricing.furniture.accents.kinds);
const ALL_KINDS = [...FURNITURE_KINDS, ...DECOR_KINDS];
const money = (n) => Math.round((Number(n) + 1e-9) * 100) / 100;
const num = (v) => { const n = Number(String(v ?? '').replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const sizesFor = (kind) => (ACCENTS.has(kind) ? SIZE_ACC : SIZE_STD);

const catalog = require('./palomas-catalog.json');

function pickupAddress(key) {
  const p = PICKUPS[key] || PICKUPS.salinas;
  return {
    street: p.street, city: p.city, state: p.state, zip: p.zip, country: 'United States', business: PARTNER_NAME,
    contactName: PARTNER_NAME, contactPhone: PARTNER_PHONE, contactRole: 'Business', sameAsMe: false, contactRoleFrom: 'partner',
    accessMode: 'ground', notes: `${p.label}. Pickup for ${PARTNER_NAME} (partner order).`,
  };
}

function engineItems(items) {
  return (Array.isArray(items) ? items : []).map((it) => {
    const kind = String(it.kind || '');
    // "Oversized or very heavy" (150+ lbs, marble, armoire): never below the large tier, and flagged so the crew is never surprised.
    const oversized = !!it.oversized;
    const tiers = sizesFor(kind);
    let size = String(it.size || '');
    if (oversized && tiers.includes(size) && tiers.indexOf(size) < tiers.indexOf('large')) size = 'large';
    const out = {
      oversized,
      qty: Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1)), type: kind === 'Mirror' ? 'mirror' : (DECOR_KINDS.includes(kind) ? 'decor' : 'furniture'),
      description: String(it.name || '').trim().slice(0, 160), furnitureKind: kind, sizeClass: size, value: num(it.value),
      catalogId: it.catalogId || '', custom: !!it.custom,
    };
    if (out.type === 'mirror') { out.w = num(it.w) || ''; out.h = num(it.h) || ''; out.d = ''; }
    return out;
  });
}

function buildDropoff(d = {}, access = {}) {
  const a = {
    street: [String(d.street || '').trim(), String(d.unit || '').trim()].filter(Boolean).join(', '), city: String(d.city || '').trim(), state: String(d.state || 'CA').trim() || 'CA',
    zip: String(d.zip || '').trim(), country: 'United States', contactName: String(d.name || '').trim(), contactPhone: String(d.phone || '').trim(),
    contactEmail: String(d.email || '').trim(), contactRole: 'Client', sameAsMe: false, contactRoleFrom: 'partner', notes: String(d.notes || '').trim().slice(0, 1000),
    accessMode: String(access.mode || ''), hours: String(access.hours || '').trim().slice(0, 200),
  };
  // Extra, optional access details that land in the order and the schedule notes (DE Notes) via the same fields the main site uses.
  const extra = [];
  if (a.accessMode === 'elevator') {
    const t = ELEVATOR_TYPES[access.elevatorType];
    if (t) { a.serviceElevator = t.service; extra.push(`Elevator: ${t.text}${access.elevatorReserve ? ', must be reserved in advance' : ''}`); }
    else if (access.elevatorReserve) extra.push('Elevator must be reserved in advance');
  }
  if (String(access.tight || '').trim()) extra.push(`Tight fit: ${String(access.tight).trim().slice(0, 300)}`);
  if (extra.length) a.notes = [a.notes, ...extra].filter(Boolean).join(' · ');
  if (a.accessMode === 'stairs') { a.stairFlights = String(access.flights || ''); a.stairDir = String(access.dir || 'up'); if (a.stairFlights === '4plus') a.stairs = parseInt(access.flightsCount, 10) || ''; }
  if (a.accessMode === 'elevator') a.floor = String(access.floor || '').trim();
  return ACCESS.normalize(a);
}

function engineOrder(b, { member }) {
  return {
    service: 'pickup_delivery', items: engineItems(b.items), pickup: pickupAddress(b.pickupLocation), dropoff: buildDropoff(b.delivery, b.access),
    memberCode: member ? PARTNER_CODE : '', skipVolumeDiscount: true, rush: false, dedicated: false,
  };
}

/** The 10% / 15% extras on a partnership-priced delivery subtotal. The $1,000 basis is the delivery subtotal AFTER the 25% partnership discount. */
function applyExtras(partner, courtesy) {
  const volumeOff = money(partner) >= RULES.volumeThreshold ? money(partner * RULES.volumePct / 100) : 0;
  const afterVolume = money(partner - volumeOff);
  const courtesyOff = courtesy ? money(afterVolume * RULES.courtesyPct / 100) : 0;
  return { volumeEligible: money(partner) >= RULES.volumeThreshold, volumeOff, afterVolume, courtesyOff, delivery: money(afterVolume - courtesyOff) };
}
const isProtection = (l) => /^Required declared value protection/.test(l.label);

/** Server-authoritative partner price. Returns { special } when CAD must quote it (out of state or anything the rate cards do not cover). */
function partnerQuote(b) {
  const normal = quote(engineOrder(b, { member: false }));
  const member = quote(engineOrder(b, { member: true }));
  if (member.paymentPlan === 'quote' || normal.paymentPlan === 'quote') {
    return { special: true, shipping: !!member.shipping, notes: member.notes || [], quoteNote: member.quoteNote || '' };
  }
  const nonProt = (q) => q.lines.filter((l) => !isProtection(l));
  const nLines = nonProt(normal), mLines = nonProt(member);
  const standard = money(nLines.reduce((s, l) => s + l.amount, 0));
  const partner = money(mLines.reduce((s, l) => s + l.amount, 0));
  const paired = nLines.length === mLines.length;
  const courtesy = !!b.courtesy;
  const { volumeOff, afterVolume, courtesyOff, delivery } = applyExtras(partner, courtesy);
  const total = delivery; // no declared value protection for Paloma's
  // Per-line all-in price: spread the extras proportionally, any rounding remainder goes on the last line so the lines add up exactly.
  const qtys = (b.items || []).map((i) => Math.max(1, parseInt(i.qty, 10) || 1));
  let run = 0;
  const lines = mLines.map((l, i) => {
    const last = i === mLines.length - 1;
    const after = last ? money(delivery - run) : money(partner ? l.amount * delivery / partner : 0);
    run = money(run + after);
    const qty = mLines.length === qtys.length ? qtys[i] : 1;
    return { label: l.label, amount: l.amount, standard: paired ? nLines[i].amount : null, after, qty, each: money(after / qty) };
  });
  return {
    special: false, lines, standard, partner, partnerSavings: money(standard - partner),
    volumeEligible: money(partner) >= RULES.volumeThreshold, volumeOff, afterVolume, courtesy, courtesyOff, delivery,
    protection: null, protectionAmount: 0, total, notes: member.notes || [], rules: RULES,
    payment: paymentPlan(total, 'pickup_delivery'),
    engine: member,
  };
}

function validate(b) {
  const errs = [];
  const by = b.placedBy || {};
  if (!['client', 'palomas'].includes(b.payer || 'client')) errs.push('who is paying');
  if (!['now', 'link'].includes(b.payMode || 'now')) errs.push('payment option');
  if (b.payMode === 'link' && b.payer === 'palomas') errs.push('payment link (the link goes to the client; choose client pays)');
  if (!PLACED_BY.includes(by.name) && by.name !== 'Other') errs.push('who is placing the order');
  if (by.name === 'Other' && !String(by.other || '').trim()) errs.push('the name of who is placing the order');
  if (!PICKUPS[b.pickupLocation]) errs.push('pickup location');
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) errs.push('at least one item');
  items.forEach((it, i) => {
    const n = `item ${i + 1}`;
    if (!String(it.name || '').trim()) errs.push(`${n} name`);
    if (!ALL_KINDS.includes(it.kind)) errs.push(`${n} type`);
    else if (!sizesFor(it.kind).includes(it.size)) errs.push(`${n} size`);
    if (String(it.value ?? '').trim() !== '' && !(num(it.value) >= 0)) errs.push(`${n} declared value`);
    if (!(parseInt(it.qty, 10) > 0)) errs.push(`${n} quantity`);
  });
  const d = b.delivery || {};
  if (!String(d.name || '').trim()) errs.push('client name');
  if (String(d.phone || '').replace(/\D/g, '').length < 7) errs.push('client phone');
  if (!/\S+@\S+\.\S+/.test(d.email || '')) errs.push('client email');
  if (!String(d.street || '').trim()) errs.push('delivery street address');
  if (!String(d.city || '').trim()) errs.push('delivery city');
  if (!/^\d{5}(-\d{4})?$/.test(String(d.zip || '').trim())) errs.push('delivery ZIP');
  const a = b.access || {};
  if (!['ground', 'steps', 'stairs', 'elevator', 'not_sure'].includes(a.mode)) errs.push('how we get in at delivery');
  if (a.mode === 'stairs' && !['half', '1', '2', '3', '4plus'].includes(String(a.flights))) errs.push('flights of stairs');
  if (a.mode === 'stairs' && String(a.flights) === '4plus' && !(parseInt(a.flightsCount, 10) >= 4)) errs.push('number of flights (4 or more)');
  if (a.mode === 'elevator' && !String(a.floor || '').trim()) errs.push('elevator floor');
  if (a.mode === 'elevator' && !ELEVATOR_TYPES[a.elevatorType]) errs.push('elevator type (freight or passenger)');
  return errs;
}

module.exports = { PARTNER_NAME, PARTNER_CODE, PARTNER_EMAIL, PARTNER_PHONE, PLACED_BY, PICKUPS, RULES, ALL_KINDS, sizesFor, catalog, engineOrder, engineItems, buildDropoff, pickupAddress, partnerQuote, applyExtras, validate, isProtection, money, num };
