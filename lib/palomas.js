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
// Client-facing copy for the access-fee rule (Dot/Chad, Nov 16 2026). Shown under "Due today", on the payment page, receipt and emails.
const ACCESS_FEE_NOTE = 'Today’s price covers the delivery as quoted.';
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
const crypto = require('crypto');

// Item size comes from the catalog item itself (never asked in the form). Sofas, loveseats, sectionals, armoires and large sculptures are large.
const FORCE_LARGE = new Set(['Sofa', 'Loveseat', '2-Piece Sectional', '3-Piece Sectional', '4-Piece Sectional', 'Armoire']);
const SCULPTURE_KINDS = new Set(['Sculptural Décor', 'Statues & busts', 'Wall sculptures', 'Urns']);
const catalogById = new Map(catalog.map((c) => [String(c.id || c.name), c]));
function defaultSize(kind) { return FORCE_LARGE.has(kind) || SCULPTURE_KINDS.has(kind) ? 'large' : 'medium'; }
// Stairs fee basis (main site rule: per flight, per piece, by the piece's largest dimension: >80" $100, 72-80" $50). Use the catalog dimensions
// when the product lists them; a large-tier piece with no listed dimensions is priced at the 72" rate.
const LARGE_DEFAULT_IN = 72;
function largestDimIn(dims) { const n = String(dims || '').match(/\d+(?:\.\d+)?/g); return n ? Math.max(...n.map(Number).filter((x) => x > 0 && x < 400), 0) : 0; }
function resolveItem(it) {
  const cat = it.catalogId && !it.custom ? catalogById.get(String(it.catalogId)) : null;
  const kind = String((cat && cat.kind) || it.kind || '');
  const tiers = sizesFor(kind);
  let size = String((cat && cat.size) || it.size || '');
  if (!tiers.includes(size)) size = defaultSize(kind);
  if (FORCE_LARGE.has(kind) && tiers.indexOf(size) < tiers.indexOf('large')) size = 'large';
  const dim = (cat && largestDimIn(cat.dims)) || (size === 'large' || size === 'xl' ? LARGE_DEFAULT_IN : 0);
  return { kind, size, dim, name: String((cat && cat.name) || it.name || '').trim() };
}

// Staff code for the two hidden controls (Manager's courtesy, Paloma's Pay). Only a SHA-256 of the lower-cased code lives in the repo; the word is
// "Palomas" (how Paloma's own site and logo spell the name). PALOMAS_STAFF_CODE_SHA256 overrides it. Compared case-insensitively, constant time.
const STAFF_CODE_SHA256 = (process.env.PALOMAS_STAFF_CODE_SHA256 || 'eb8120240a53451d5647e60815bdadf3424d7d6761ea38d1c83efc0e1e26222f').toLowerCase();
const sha = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
function staffCodeOk(code) {
  if (typeof code !== 'string' || !code || code.length > 64) return false;
  const a = Buffer.from(sha(code)), b = Buffer.from(STAFF_CODE_SHA256);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
    const r = resolveItem(it);
    // No declared value is collected for Paloma's, so the engine always sees 0 (no protection, no high-value handling).
    const out = {
      qty: Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1)), type: r.kind === 'Mirror' ? 'mirror' : (DECOR_KINDS.includes(r.kind) ? 'decor' : 'furniture'),
      description: r.name.slice(0, 160), furnitureKind: r.kind, sizeClass: r.size, value: 0,
      catalogId: it.catalogId || '', custom: !!it.custom,
    };
    if (out.type === 'mirror') { out.w = num(it.w) || ''; out.h = num(it.h) || ''; out.d = ''; }
    else if (r.dim) out.d = r.dim; // drives the main site's stairs fee (per flight, by largest dimension)
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
    // Steps before or after the elevator: Yes (with a count) / No / Not sure. Up to 3 steps uses the main site's "a few steps" answer;
    // more than 3, or Not sure, is flagged for CAD to confirm and the real number goes in the notes.
    const es = String(access.elevSteps || ''); const n = parseInt(access.elevStepsN, 10);
    if (es === 'no') { a.elevatorStairs = 'no'; extra.push('Steps before/after the elevator: none'); }
    else if (es === 'yes') { a.elevatorStairs = n >= 1 && n <= 3 ? 'steps' : 'not_sure'; extra.push(`Steps before/after the elevator: yes, ${n >= 1 ? n : 'number not given'} step${n === 1 ? '' : 's'}${n > 3 ? ' (CAD to confirm access)' : ''}`); }
    else if (es === 'not_sure') { a.elevatorStairs = 'not_sure'; extra.push('Steps before/after the elevator: not sure (CAD to confirm access)'); }
  }
  const c2 = d.client2;
  if (c2 && String(c2.name || '').trim()) extra.push(`Second client: ${String(c2.name).trim()}${c2.phone ? ' ' + String(c2.phone).trim() : ''}${c2.email ? ' ' + String(c2.email).trim() : ''}`);
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
  // Quantity per line comes from the engine's own label ("… × 3" on item lines, "(2 flights × $50 × 3)" on stairs lines).
  const lineQty = (label) => { const m = String(label).match(/ × (\d+)\)?$/); return m ? Math.max(1, parseInt(m[1], 10)) : 1; };
  let run = 0;
  const lines = mLines.map((l, i) => {
    const last = i === mLines.length - 1;
    const after = last ? money(delivery - run) : money(partner ? l.amount * delivery / partner : 0);
    run = money(run + after);
    const qty = lineQty(l.label);
    // the engine numbers stairs lines by item position ("Piece 3"); show the item's own name instead
    const label = String(l.label).replace(/^Stairs — Piece (\d+),/, (m, n) => { const it = (b.items || [])[Number(n) - 1]; const nm = it && (resolveItem(it).name || it.name); return nm ? `Stairs — ${nm},` : m; });
    return { label, amount: l.amount, standard: paired ? nLines[i].amount : null, after, qty, each: money(after / qty) };
  });
  return {
    special: false, lines, standard, partner, partnerSavings: money(standard - partner),
    volumeEligible: money(partner) >= RULES.volumeThreshold, volumeOff, afterVolume, courtesy, courtesyOff, delivery,
    protection: null, protectionAmount: 0, total, notes: member.notes || [], rules: RULES,
    payment: (() => { const pp = paymentPlan(total, 'pickup_delivery'); return pp.paymentPlan === 'full' ? { ...pp, paymentSummary: 'Covers the delivery as quoted' } : pp; })(),
    accessFeeNote: ACCESS_FEE_NOTE,
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
    else if (it.size && !sizesFor(it.kind).includes(it.size)) errs.push(`${n} size`);
    if (!(parseInt(it.qty, 10) > 0)) errs.push(`${n} quantity`);
  });
  const d = b.delivery || {};
  if (!String(d.name || '').trim()) errs.push('client name');
  if (String(d.phone || '').replace(/\D/g, '').length < 7) errs.push('client phone');
  if (!/\S+@\S+\.\S+/.test(d.email || '')) errs.push('client email');
  if (d.client2) { // optional second client: name plus a phone or an email
    const c2 = d.client2;
    if (!String(c2.name || '').trim()) errs.push('second client name');
    const ph = String(c2.phone || '').replace(/\D/g, ''), em = String(c2.email || '').trim();
    if (!ph && !em) errs.push('second client phone or email');
    if (ph && ph.length < 7) errs.push('second client phone');
    if (em && !/\S+@\S+\.\S+/.test(em)) errs.push('second client email');
  }
  if (!String(d.street || '').trim()) errs.push('delivery street address');
  if (!String(d.city || '').trim()) errs.push('delivery city');
  if (!/^\d{5}(-\d{4})?$/.test(String(d.zip || '').trim())) errs.push('delivery ZIP');
  const a = b.access || {};
  if (!['ground', 'steps', 'stairs', 'elevator', 'not_sure'].includes(a.mode)) errs.push('how we get in at delivery');
  if (a.mode === 'stairs' && !['half', '1', '2', '3', '4plus'].includes(String(a.flights))) errs.push('flights of stairs');
  if (a.mode === 'stairs' && String(a.flights) === '4plus' && !(parseInt(a.flightsCount, 10) >= 4)) errs.push('number of flights (4 or more)');
  if (a.mode === 'elevator' && !String(a.floor || '').trim()) errs.push('elevator floor');
  if (a.mode === 'elevator' && !ELEVATOR_TYPES[a.elevatorType]) errs.push('elevator type (freight or passenger)');
  if (a.mode === 'elevator' && !['yes', 'no', 'not_sure'].includes(a.elevSteps)) errs.push('steps before or after the elevator (yes, no or not sure)');
  if (a.mode === 'elevator' && a.elevSteps === 'yes' && !(parseInt(a.elevStepsN, 10) >= 1)) errs.push('how many steps before or after the elevator');
  return errs;
}

module.exports = { staffCodeOk, resolveItem, defaultSize, FORCE_LARGE, ACCESS_FEE_NOTE, PARTNER_NAME, PARTNER_CODE, PARTNER_EMAIL, PARTNER_PHONE, PLACED_BY, PICKUPS, RULES, ALL_KINDS, sizesFor, catalog, engineOrder, engineItems, buildDropoff, pickupAddress, partnerQuote, applyExtras, validate, isProtection, money, num };
