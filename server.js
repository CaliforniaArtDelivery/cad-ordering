const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { quote, isOutOfState, applyApprovedPrice, protectionLabel, SERVICES, OFFERED_SERVICES, displayFrom, FURNITURE_KINDS, DECOR_KINDS, needsStairwellFit, numVal, installUpsell } = require('./lib/pricing');
const { installVisitFit } = require('./lib/install-visit-fit');
const sched = require('./lib/scheduling');
const GEO = require('./lib/geo');
// A US address in California (state CA or a California ZIP). Unknown or blank addresses are never treated as California.
const inCaliforniaUS = (a) => {
  if (!a || typeof a !== 'object' || GEO.outsideCA(a)) return false;
  const zip = String(a.zip || '').match(/\b\d{5}\b/);
  return /^(ca|calif\.?|california)$/i.test(String(a.state || '').trim()) || !!(zip && GEO.isCaZip(zip[0]));
};

const schedule = require('./lib/schedule');
const sheetSync = require('./lib/sheets-sync');
const email = require('./lib/email');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// Admin access needs a strong ADMIN_KEY from the environment. No default: unset, short, or the old public
// 'cad-admin' value turns admin off entirely (orders, CSV, approvals, outbox).
const ADMIN_KEY = String(process.env.ADMIN_KEY || '');
const ADMIN_ON = ADMIN_KEY.length >= 16 && ADMIN_KEY !== 'cad-admin';
if (!ADMIN_ON) console.warn('Admin is OFF: set ADMIN_KEY to a long random value (16+ characters) to turn it on.');
// TEST_MODE=1 allows the mock card / ACH / Apple Pay / Google Pay path (no real money). Without it, and without
// Stripe, payments are refused instead of silently confirming jobs.
const TEST_MODE = /^(1|true|yes)$/i.test(String(process.env.TEST_MODE || ''));
const storage = require('./lib/storage');
const { TYPES, framingErrors, itemLine, isHungItem, routeDecorMirror, expandPieces, hasMultiQty, legacyQtyRecord, legacyNote, piecesOf, pieceLabel, MAX_PIECES } = require('./lib/itemtypes');
const DISCOUNTS = require('./lib/discounts');
const ACCESS = require('./public/access');
const VALID = require('./public/validate');
const ORDERS = path.join(storage.dir('data'), 'orders.json');
const CUSTOMERS = path.join(storage.dir('data'), 'customers.json');

// Stripe: TEST MODE ONLY. Live keys are refused in this prototype.
let stripe = null;
const key = process.env.STRIPE_SECRET_KEY || '';
if (key.startsWith('sk_test_')) stripe = require('stripe')(key);
else if (key) console.warn('STRIPE_SECRET_KEY is not a test key (sk_test_…). Refusing; using mock payments.');
console.log(stripe ? 'Payments: Stripe Checkout (TEST mode) — card + ACH' : TEST_MODE ? 'Payments: MOCK (TEST_MODE=1) — card + ACH' : 'Payments: OFF (no Stripe key and TEST_MODE is not set)');

// Older saved orders may carry a quantity on a piece. Reading them expands that into separate pieces (one entry = one piece), so nothing downstream ever sees qty > 1.
// A stored order is never silently converted: the original entry (with its quantity) is kept in order.legacyQty and the order is flagged
// "needs manual review" for the team. Its saved quote and payment are untouched.
const migratePieces = (o) => {
  if (o && !o.partnerOrder && hasMultiQty(o.items)) {
    if (!o.legacyQty) o.legacyQty = legacyQtyRecord(o.items);
    o.needsManualReview = true;
    o.manualReviewReason = o.manualReviewReason || 'Legacy quantity: ' + legacyNote(o.legacyQty) + '. Original entry kept in legacyQty. Please confirm each piece\u2019s details and value with the customer.';
    o.items = expandPieces(o.items);
  }
  return o;
};
const load = () => (fs.existsSync(ORDERS) ? JSON.parse(fs.readFileSync(ORDERS, 'utf8')).map(migratePieces) : []);
const save = (orders) => fs.writeFileSync(ORDERS, JSON.stringify(orders, null, 2));
const findOrder = (id) => load().find((o) => o.id === id);
const update = (id, fn) => { const all = load(); const o = all.find((x) => x.id === id); if (!o) return null; fn(o); save(all); return o; };

const loadCustomers = () => (fs.existsSync(CUSTOMERS) ? JSON.parse(fs.readFileSync(CUSTOMERS, 'utf8')) : {});
const saveCustomers = (c) => fs.writeFileSync(CUSTOMERS, JSON.stringify(c, null, 2));

const app = express();
app.set('trust proxy', 1); // behind Render's proxy: req.ip is the real visitor IP (per-visitor staff-code rate limit)
// Stripe webhook (raw body for the signature check). Marks the order paid and confirmed even if the customer never returns to the site.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!stripe || !secret) return res.status(503).json({ error: 'webhook not configured' });
  let evt;
  try { evt = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), secret); } catch (e) { return res.status(400).json({ error: 'bad signature' }); }
  const hit = STRIPE_CO.orderFromEvent(evt);
  const cur = hit && findOrder(hit.orderId);
  if (cur && hit.failed) {
    // Bank payment failed after processing: never shown as paid; the team follows up.
    if (cur.payment && cur.payment.status === 'ach_processing') { update(cur.id, (x) => { x.payment = { ...x.payment, status: 'failed', failedAt: new Date().toISOString() }; x.statusNote = 'Bank payment failed after processing.'; }); sheetSync.enqueue(cur.id, 'payment'); }
    teamAlert(`BANK PAYMENT FAILED: ${cur.id}`, `Stripe reports the bank (ACH) payment for order ${cur.id} failed. The booking is not paid. Please contact the client.`);
  } else if (cur && cur.status === 'confirmed' && cur.payment && cur.payment.status === 'ach_processing' && hit.payment.status === 'paid') {
    // ACH cleared: only now does it become PAID (schedule row updated too).
    update(cur.id, (x) => { x.payment = { ...x.payment, status: 'paid', achPending: false, settledAt: new Date().toISOString() }; delete x.statusNote; });
    sheetSync.enqueue(cur.id, 'payment');
  } else if (cur) finalize(hit.orderId, hit.payment);
  res.json({ received: true });
});
app.use(express.json({ limit: '2mb' }));
// Defensive input hygiene (audit Nov 18): clamp any one text value to 5,000 characters and refuse a body that is not a JSON object,
// so a pasted novel or a stray null can never reach the pricing code or the stored order.
const clampText = (v, depth = 0) => {
  if (typeof v === 'string') { const t = v.trim(); return t.length > 5000 ? t.slice(0, 5000) : t; }
  if (depth > 8 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => clampText(x, depth + 1));
  const o = {}; Object.keys(v).forEach((k) => { if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') o[k] = clampText(v[k], depth + 1); }); return o;
};
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  if (req.is('application/json') && req.body !== undefined) {
    if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    else req.body = clampText(req.body);
  }
  next();
});
// Access answers (ground / steps / stairs / elevator) are mapped onto the legacy stair fields before pricing or booking.
app.use((req, _res, next) => {
  const b = req.body;
  if (b && typeof b === 'object') ['pickup', 'dropoff'].forEach((k) => { if (b[k] && typeof b[k] === 'object') ACCESS.normalize(b[k]); });
  // "Same as me" contact: the role is the booker's own "I am a…" answer. Any role the client sent is ignored, and with
  // no "I am a…" answer the role stays empty so validation refuses it (no silent default).
  if (b && typeof b === 'object') ['pickup', 'dropoff'].forEach((k) => {
    const a = b[k];
    if (!a || typeof a !== 'object' || !a.sameAsMe) return;
    a.contactRole = String((b.contact && b.contact.clientType) || '').trim().slice(0, 60);
    a.contactRoleOther = '';
    a.contactRoleFrom = 'booker';
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(storage.dir('uploads')));

const upload = multer({
  storage: multer.diskStorage({
    destination: storage.dir('uploads'),
    filename: (_, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 10 },
  fileFilter: (_, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});

app.get('/api/config', (_, res) => res.json({
  // phone, phoneNorth, and phoneSouth stay in config.js for internal use only and are not sent to the browser.
  company: (({ phone, phoneNorth, phoneSouth, ...pub }) => pub)(config.company), services: OFFERED_SERVICES, timePrefs: config.scheduling.timePrefs,
  payment: config.payment,
  dedicated: DEDICATED.publicRules(), // dates only; the fee rules stay on the server
  pricing: {
    quoteMultiplierMin: config.pricing.quoteMultiplierMin,
    quoteMultiplierMax: config.pricing.quoteMultiplierMax,
    displayFrom, furnitureKinds: FURNITURE_KINDS, decorKinds: DECOR_KINDS,
    decorKindGroups: config.pricing.furniture.decorKindGroups,
    accentsKind: config.pricing.furniture.accents.label,
    accentsKinds: config.pricing.furniture.accents.kinds,
    hungDecor: config.pricing.furniture.hungDecor,
    quoteHang: config.pricing.furniture.quoteHang,
    wallDecorKinds: config.pricing.furniture.wallDecorKinds,
    sizeLabels: config.pricing.furniture.sizeLabels,
    valuationRate: config.pricing.valuation.rate,
    wallArtWeight: config.pricing.wallArtWeight, hangHardware: config.pricing.hangHardware, hangInstall: config.pricing.hangInstall,
  },
  stripe: !!stripe, livemode: false, stripeTestMode: !!stripe && key.startsWith('sk_test_'), testMode: !stripe && TEST_MODE, notice: config.pricing.exampleRatesNotice,
}));
app.post('/api/upload', upload.array('photos', 10), (req, res) => res.json({ files: (req.files || []).map((f) => `/uploads/${f.filename}`) }));
app.post('/api/quote', (req, res) => {
  const q = quote(req.body);
  const u = installUpsell(req.body);
  if (u && u.show) q.installUpsell = { amount: u.amount, asLittle: !!u.asLittle };
  res.json(q);
});
const eventLog = [];
app.post('/api/events', (req, res) => {
  const name = String((req.body && req.body.name) || '').slice(0, 80);
  if (!name) return res.status(400).json({ ok: false });
  const ev = { name, at: new Date().toISOString() };
  if (TEST_MODE) ev.meta = (req.body && req.body.meta) || {};
  eventLog.push(ev);
  if (eventLog.length > 500) eventLog.shift();
  res.json({ ok: true });
});
app.get('/api/events', (req, res) => {
  if (!TEST_MODE) return res.status(404).end();
  res.json({ events: eventLog });
});
app.post('/api/install-visit-fit', (req, res) => {
  try { res.json(installVisitFit(req.body || {})); }
  catch (e) { res.json({ ok: true }); } // never block the booking on a checker failure
});
// The public site has no member rate any more (Chad, Nov 19 2026), so there is no member-code endpoint, and any member flag or code
// sent with an order is ignored by the pricing engine. Discount codes are checked here, on the server only.
const discountTries = new Map(); // ip -> recent misses (guessing guard: 12 wrong codes per 10 minutes)
app.post('/api/discount-code', (req, res) => {
  const b = req.body || {};
  const ip = req.ip || 'x', now = Date.now();
  const hits = (discountTries.get(ip) || []).filter((t) => now - t < 600000);
  if (hits.length >= 12) return res.status(429).json({ valid: false, message: 'Too many tries. Please wait a few minutes, or reach us through our Contact Us page at californiaartdelivery.com/pages/contact.' });
  const code = DISCOUNTS.norm(b.code);
  if (!code) return res.status(400).json({ valid: false, message: 'Enter a discount code.' });
  const hit = DISCOUNTS.lookup(code);
  if (!hit.ok) { hits.push(now); discountTries.set(ip, hits); return res.json({ valid: false, code, message: 'That code isn’t valid. Please check it and try again.' }); }
  // Price the order with the code, so the customer sees exactly what it does (the amount itself always comes from the server).
  const order = (b.order && typeof b.order === 'object') ? { ...b.order, discountCode: hit.code } : null;
  const q = order ? quote(order) : null;
  const d = q && q.discount;
  res.json({
    valid: true, code: hit.code, type: hit.row.type, description: DISCOUNTS.describe(hit.row),
    amount: d ? d.amount : 0, note: d ? (d.note === 'invalid' ? '' : d.note) : '',
    message: d && d.amount > 0 ? `Code ${hit.code} applied: −$${d.amount.toFixed(2)}.` : `Code ${hit.code} accepted. ${d && d.note && d.note !== 'invalid' ? d.note : DISCOUNTS.describe(hit.row) + '.'}`,
  });
});
app.post('/api/verify-address', async (req, res) => {
  const b = req.body || {};
  const out = await require('./lib/address-verify').verifyAddress(b.address || b, { skipGeocode: process.env.SKIP_GEOCODE === '1' });
  res.json(out);
});
app.post('/api/availability', async (req, res) => {
  const o = req.body;
  const svc = SERVICES[o.service] || SERVICES.pickup_delivery;
  const badAddr = badAddresses(o, svc);
  if (badAddr.length) return res.status(400).json({ error: 'Please check the ' + badAddr.join(' and ') + ' address: a street number, a city and a 5-digit ZIP code are required. No route was assigned.', invalid: badAddr, days: [], rush: [] });
  const conflicts = [];
  if (svc.needsPickup && sched.routeConflict(o.pickup)) conflicts.push({ where: 'pickup', ...sched.routeConflict(o.pickup, 'pickup') });
  if (svc.needsDropoff && sched.routeConflict(o.dropoff)) conflicts.push({ where: 'dropoff', ...sched.routeConflict(o.dropoff, svc.needsPickup ? 'delivery' : null) });
  if (conflicts.length) return res.status(400).json({ error: conflicts[0].message, invalid: conflicts.map((c) => c.where), conflict: true, days: [], rush: [], requestQuote: true, prompt: 'Request a quote' });
  const verify = await require('./lib/address-verify').verifyLegs(o.pickup, o.dropoff, !!svc.needsPickup, { skipGeocode: process.env.SKIP_GEOCODE === '1' });
  const quoteBy = require('./lib/business-days').quoteReplyBy();
  if (!verify.offerDates) {
    return res.json({ days: [], rush: [], quote: true, requestQuote: true, prompt: 'Request a quote', unverified: true, legs: verify.legs, quoteBy, error: verify.message || 'We couldn’t verify this address. Request a quote and we’ll confirm it by hand.' });
  }
  if (sched.calendarUnavailable()) {
    return res.json({ days: [], rush: [], quote: true, requestQuote: true, prompt: 'Request a quote', calendarUnavailable: true, quoteBy, error: 'Live schedule data isn’t available right now. Request a quote and we’ll confirm dates by hand.' });
  }
  // leg=dropoff: delivery dates for the delivery address, on or after the pickup date (same-day only when both zones are served that day).
  if (o.leg === 'dropoff' && o.dropoff && o.schedule && o.schedule.date) {
    const pu = o.pickup || {};
    const days = sched.availableDeliveryDays(o.dropoff, pu, o.schedule.date, o, config.scheduling.showDays);
    return res.json({ region: sched.regionFor(o.dropoff), zone: sched.zoneFor(o.dropoff), area: sched.customerAreaName(sched.zoneFor(o.dropoff), sched.regionFor(o.dropoff)), days, rush: [] });
  }
  const first = svc.needsPickup ? o.pickup : o.dropoff;
  const addr = first && (first.zip || first.city) ? first : o.dropoff;
  const region = sched.regionFor(addr);
  const zone = sched.zoneFor(addr);
  // leg=pairs (Chad, Nov 21 2026): pickup AND delivery days on one screen. Nothing new is decided here: pickup days are the normal
  // list above, and the delivery days valid for a pickup P are exactly what leg=dropoff returns for P (and what scheduleErrors
  // accepts): route days for the delivery address on or after P. `pairs` lists them per pickup, so either date can be picked first.
  if (o.leg === 'pairs' && svc.needsPickup && svc.needsDropoff && o.dropoff) {
    const puDays = sched.availablePickupDays(addr, o.dropoff, { order: o });
    const rush = (config.scheduling.rushEnabled ? sched.rushDays(addr, new Date(), 7, o) : []).filter((d) => sched.canPairPickupDelivery(d.date, addr, o.dropoff, o));
    const all = [...puDays, ...rush].map((d) => d.date).sort();
    const dRegion = sched.regionFor(o.dropoff), dZone = sched.zoneFor(o.dropoff);
    const out = { region, zone, area: sched.customerAreaName(zone, region), days: puDays, rush, delivery: { region: dRegion, zone: dZone, area: sched.customerAreaName(dZone, dRegion), days: [] }, pairs: {} };
    // Dedicated on one side (Chad, Nov 25 2026): the other side picks from its plain route days (scheduleErrors checks the same lists).
    out.pickupAny = sched.availableDays(addr, { order: o, count: 40 });
    out.deliveryAny = sched.availableDays(o.dropoff, { order: o, count: 40 });
    out.dedicatedBlocked = { pickup: DEDICATED.blockedFor(addr), delivery: DEDICATED.blockedFor(o.dropoff) };
    if (!all.length) { out.delivery.days = out.deliveryAny.slice(0, config.scheduling.showDays); return res.json(out); }
    const delFrom = (iso) => sched.availableDeliveryDays(o.dropoff, addr, iso, o, 400);
    const fromFirst = delFrom(all[0]);
    // The column runs from the first pickup to showDays delivery days after the last pickup (each pickup keeps the same
    // choices leg=dropoff would show it).
    const last = all[all.length - 1];
    const startLast = fromFirst.findIndex((d) => d.date >= last);
    const end = startLast < 0 ? fromFirst.length : Math.min(fromFirst.length, startLast + config.scheduling.showDays);
    out.delivery.days = fromFirst.slice(0, end);
    const col = new Set(out.delivery.days.map((d) => d.date));
    all.forEach((p) => { out.pairs[p] = delFrom(p).map((d) => d.date).filter((d) => col.has(d)); });
    return res.json(out);
  }
  const pairWith = svc.needsPickup && svc.needsDropoff ? o.dropoff : null;
  res.json({
    region, zone, area: sched.customerAreaName(zone, region),
    days: pairWith ? sched.availablePickupDays(addr, pairWith, { order: o }) : sched.availableDays(addr, { order: o }),
    rush: (config.scheduling.rushEnabled ? sched.rushDays(addr, new Date(), 7, o) : []).filter((d) => !pairWith || sched.canPairPickupDelivery(d.date, addr, pairWith, o)),
    dedicatedBlocked: svc.needsPickup ? { pickup: DEDICATED.blockedFor(addr), delivery: o.dropoff ? DEDICATED.blockedFor(o.dropoff) : [] } : { pickup: [], delivery: DEDICATED.blockedFor(addr) },
  });
});

// Route-aware time windows for the chosen date(s) (lib/route-windows.js). Read-only; the browser grays the windows that don't fit.
app.post('/api/time-windows', (req, res) => {
  const o = req.body || {};
  const svc = SERVICES[o.service] || SERVICES.pickup_delivery;
  const RW = require('./lib/route-windows');
  const sc = o.schedule || {};
  const iso = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '');
  const pu = iso(sc.date), de = iso(sc.deliveryDate);
  const opts = { order: o, puPref: RW.prefList(sc.timePref), delPref: RW.prefList(sc.deliveryTimePref) };
  if (svc.needsPickup && svc.needsDropoff) {
    if (pu && de) { const r = RW.pair(o.pickup, o.dropoff, pu, de, opts); return res.json({ pickup: { date: pu, ...RW.publicView(r.pickup) }, delivery: { date: de, ...RW.publicView(r.delivery) }, sameDay: r.sameDay }); }
    return res.json({ pickup: pu ? { date: pu, ...RW.publicView(RW.evaluate(o.pickup, pu, opts)) } : null, delivery: de ? { date: de, ...RW.publicView(RW.evaluate(o.dropoff, de, opts)) } : null, sameDay: false });
  }
  const addr = svc.needsPickup ? o.pickup : o.dropoff;
  res.json({ pickup: pu ? { date: pu, ...RW.publicView(RW.evaluate(addr, pu, opts)) } : null, delivery: null, sameDay: false });
});
// Atomic slot hold (lib/holds.js): the date(s) are reserved while the client pays; an uncertain/full date refuses cleanly.
function holdSlots(order, link) {
  const svc = SERVICES[order.service] || {};
  const need = {};
  const add = (iso) => { if (iso) need[iso] = (need[iso] || 0) + 1; };
  if (svc.shipping || !order.schedule || !order.schedule.date) return { ok: true };
  // Dedicated sides run on their own van, so they don't take a route slot.
  const ds = DEDICATED.sides(order);
  if (!(svc.needsPickup ? ds.pickup : ds.delivery)) add(order.schedule.date);
  if (svc.needsPickup && svc.needsDropoff && !ds.delivery) add(order.schedule.deliveryDate || order.schedule.date);
  if (!Object.keys(need).length) return { ok: true };
  // En-route East Bay stops (Chad t2096u) also take one of that date's en-route slots; checked in the same atomic reserve.
  const enNeed = {}, enRule = {};
  for (const [iso, addr] of sched.orderLegs(order)) { const r = sched.isEnRouteStop(addr, iso); if (r) { enNeed[iso] = (enNeed[iso] || 0) + 1; enRule[iso] = r; } }
  const tags = Object.keys(enNeed).length ? { enroute: { need: enNeed, remainingFor: (iso) => sched.enRouteLeft(iso, order.id, enRule[iso]) } } : null;
  return require('./lib/holds').reserve(order.id, need, (iso, heldOthers) => require('./lib/sheet-days').capacityLeft(iso, heldOthers), { link, tags });
}

const RULES = require('./lib/date-guard-rules');
const DEDICATED = require('./lib/dedicated-fee');
// Instant heads-up to the CAD inbox (through the schedule bridge). Never blocks or fails an order.
const teamAlert = (subject, body) => { try { sheetSync.alert((TEST_MODE ? '[TEST SITE] ' : '') + subject, body).catch(() => {}); } catch {} };
const reviewAlert = (o) => teamAlert(`REVIEW NEEDED: online request ${o.id} (${((o.review || {}).kinds || []).join(', ') || 'quote'})`,
  `Order ${o.id} is a pending request, not a confirmed job. Nothing has been charged.\n`
  + `Client: ${(o.contact || {}).name || ''} ${(o.contact || {}).phone || ''} ${(o.contact || {}).email || ''}\n`
  + `Date(s) held: ${(o.schedule || {}).date || 'none'}${(o.schedule || {}).deliveryDate ? ' / delivery ' + o.schedule.deliveryDate : ''}\n`
  + `Why: ${((o.review || {}).reasons || []).map((r) => r.text).join(' | ') || (o.rush ? 'rush' : o.dedicated ? 'dedicated trip' : 'team quote')}\n`
  + `Pieces:\n${piecesOf(o).map((it, i) => '  ' + require('./lib/itemtypes').pieceDetail(it, i)).join('\n')}\n`
  + (o.needsManualReview ? `NEEDS MANUAL REVIEW: ${o.manualReviewReason}\n` : '')
  + (o.discountCode ? `Discount code: ${o.discountCode}${(o.quote && o.quote.discount && o.quote.discount.amount) ? ' (−$' + o.quote.discount.amount.toFixed(2) + ' at the regular price)' : ''}\n` : '')
  + (o.protectionDeclined ? 'Customer DECLINED declared value protection.\n' : '')
  + `Confirm within 1 business day, then approve it in the admin page so the client gets the payment link.`);

// Short "Missing: ..." phrases for an address that fails the shared checks (public/validate.js). The street-required case is
// already reported as 'pickup' / 'dropoff', so only the other problems are named here.
function addressErrors(a, where) {
  const word = { street: 'a street number in the street address', city: 'a valid city', zip: 'a valid 5-digit ZIP code', state: 'a state that matches the ZIP code' };
  const say = (p) => (p.field === 'zip' && /California/.test(p.message) ? 'a ZIP code that matches the state' : word[p.field]);
  const out = VALID.addressProblems(a).filter((p) => !(p.field === 'street' && !String((a || {}).street || '').trim())).map((p) => `${where} ${say(p)}`);
  const conflict = sched.routeConflict(a, /pickup/i.test(where) ? 'pickup' : /deliver|drop/i.test(where) ? 'delivery' : null);
  if (conflict) out.push(conflict.message);
  return out;
}
// An address that fails the checks never gets a route or dates (Samantha, Nov 19: 123456 as a ZIP still returned a route).
const badAddresses = (o, svc) => {
  const bad = [];
  if (svc.needsPickup && VALID.addressProblems(o.pickup).length) bad.push('pickup');
  if (svc.needsDropoff && VALID.addressProblems(o.dropoff).length) bad.push('dropoff');
  return bad;
};
const addressConflicts = (o, svc) => {
  const bad = [];
  if (svc.needsPickup && sched.routeConflict(o.pickup)) bad.push('pickup');
  if (svc.needsDropoff && sched.routeConflict(o.dropoff)) bad.push('dropoff');
  return bad;
};

function validate(o) {
  const errs = [];
  if (!Array.isArray(o.items)) o.items = [];
  // One authoritative piece model: every entry is exactly ONE piece with its own id. A legacy quantity (qty > 1) is expanded into
  // separate pieces here, before anything is validated, priced, stored, emailed or written to the schedule.
  const rawItems = o.items.filter((it) => it && typeof it === 'object');
  if (!o.partnerOrder && hasMultiQty(rawItems)) o._legacyQty = legacyQtyRecord(rawItems); // an old page or API caller sent a quantity: keep the original, flag for review
  o.items = expandPieces(rawItems);
  // Copied values must be confirmed before payment (Dot): an order is never accepted while a piece still says "check value".
  const unconfirmed = o.items.map((it, i) => (it.checkValue ? pieceLabel(it, i) : null)).filter(Boolean);
  if (unconfirmed.length) errs.push(`please confirm the declared value for ${unconfirmed.slice(0, 4).join('; ')}${unconfirmed.length > 4 ? ` and ${unconfirmed.length - 4} more` : ''}`);
  if (o.items.length > MAX_PIECES) errs.push(`no more than ${MAX_PIECES} pieces per order`);
  // Name the piece in each error ("Piece 3 — Canvas"), so a long order says exactly which piece is incomplete.
  const forPieces = (what, pred) => { const bad = o.items.map((it, i) => (pred(it, i) ? pieceLabel(it, i) : null)).filter(Boolean); if (bad.length) errs.push(`${what} for ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? ` and ${bad.length - 4} more` : ''}`); };
  if (o.contact && typeof o.contact !== 'object') o.contact = null;
  if (!SERVICES[o.service] || SERVICES[o.service].legacy) errs.push('service');
  if (!o.items || !o.items.length) errs.push('items');
  else forPieces('a description', (it) => !String(it.description || '').trim());
  forPieces('a valid item type', (it) => !TYPES[it.type || 'painting']);
  forPieces('Framed? (and Glass? / Frame type when they apply)', (it) => framingErrors([it]));
  // Wall pieces over 400 lb (Chad, Nov 21 2026) can't be booked online: the form sends the customer to Request a custom quote.
  if (o.service !== 'crating_shipping') forPieces('a custom quote: wall pieces over 400 lb can’t be booked online. Please request a custom quote at contact@californiaartdelivery.com', (it) => require('./lib/pricing').wallArtTooHeavy(it));
  const siteContact = (a) => a && String(a.contactName || '').trim() && String(a.contactPhone || '').trim();
  // Address checks (Samantha, Nov 19): street (with a number), a plausible city and a 5-digit ZIP (or ZIP+4) at every stop.
  if (SERVICES[o.service]?.needsPickup) {
    if (!o.pickup?.street) errs.push('pickup');
    errs.push(...addressErrors(o.pickup, 'pickup'));
    if (!siteContact(o.pickup)) errs.push('pickup contact');
  }
  if (SERVICES[o.service]?.needsDropoff) {
    if (!o.dropoff?.street) errs.push('dropoff');
    errs.push(...addressErrors(o.dropoff, 'dropoff'));
    if (!siteContact(o.dropoff)) errs.push(o.service === 'install_only' ? 'install contact' : o.service === 'crating_shipping' ? 'destination contact' : 'delivery contact');
  }
  // Access (Chad): path / stairs questions are required only for heavy or big pieces; doorway only for truly giant ones.
  const ACCESS_ERR = {
    accessMode: 'access (how do we get in?)', stairFlights: 'number of flights', stairs: 'number of flights (4 or more)', stairDir: 'stairs up or down',
    stairTurns: 'tight turns on the stairs', stairPhotos: 'photos of the stairs and path', floor: 'elevator floor', elevatorStairs: 'stairs on the way to the elevator',
    fits: 'will everything fit easily', doorPhotos: 'photos of the tight spot and the way in',
    elevatorType: 'regular or service elevator', elevatorFit: 'will it fit in the elevator', elevatorAck: 'elevator acknowledgment', sitePhotos: 'photos of the outdoor path',
  };
  const accessStops = [];
  if (SERVICES[o.service]?.needsPickup) accessStops.push(['pickup', o.pickup]);
  if (SERVICES[o.service]?.needsDropoff) accessStops.push([SERVICES[o.service]?.install && !SERVICES[o.service]?.needsPickup ? 'install' : 'delivery', o.dropoff]);
  accessStops.forEach(([name, a]) => { if (a && a.street) ACCESS.gaps(a, o.items).forEach((g) => errs.push(`${name} ${ACCESS_ERR[g] || g}`)); });
  if (!o.contact?.name || !o.contact?.email) errs.push('contact');
  if (o.payer === 'other') {
    if (!String(o.payerOther?.name || '').trim()) errs.push('payer name');
    if (!/\S+@\S+\.\S+/.test(o.payerOther?.email || '')) errs.push('payer email');
    if (String(o.payerOther?.phone || '').replace(/\D/g, '').length < 7) errs.push('payer phone');
  }
  // Photo rules (Chad, Nov 19): required only when special handling is on. Weight "Not sure" never requires a photo.
  const numVal = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const needsPhoto = (it) => !!it.fragile;
  forPieces('photos (special handling)', (it) => needsPhoto(it) && !(it.photos || []).length);
  if (SERVICES[o.service]?.install) {
    (o.items || []).forEach((it) => {
      if (isHungItem(it) && it.hangHeight === 'higher' && it.hangWhere === 'stairwell' && !((it.hangPhotos || []).length)) errs.push('photos of the stairwell');
    });
  }
  const ship = SERVICES[o.service]?.shipping || isOutOfState(o);
  if (ship) {
    // Samantha prices shipping without follow-up, so collect what she needs.
    if (!String(o.dropoff?.country || 'United States').trim()) errs.push('destination country');
    forPieces('dimensions and weight (all three dimensions, plus a weight or Not sure)', (it) => {
      const missingWeight = !(it.weightUnsure || numVal(it.weight) > 0);
      const partner = !!(o.partnerOrder || o.skipVolumeDiscount);
      const skipDims = (it.type === 'custom') || (partner && (it.type === 'furniture' || it.type === 'decor'));
      return missingWeight || (!skipDims && !!VALID.dimProblem(it));
    });
    forPieces('a declared value (for the shipping insurance)', (it) => !(numVal(it.value) > 0));
    if (!o.shipping?.serviceLevel) errs.push('destination service level');
    if (!o.shipping?.shipBy && !o.shipping?.flexible) errs.push('ship date or flexibility');
  } else {
    const skipDates = !!(o.quoteOnly || o.customDate || o.unverifiedAddress || (o.sizeCheckQuote && !(o.schedule && o.schedule.date)));
    if (!skipDates && !o.schedule?.date) errs.push('schedule');
    if (o.customDate && !String((o.schedule && o.schedule.customDateNote) || '').trim()) errs.push('the dates that would work (custom date request)');
    // In-California white glove jobs: every piece needs a declared value (protection / high-value handling depend on it).
    // $0 (or blank) is never accepted as a declared value; only a custom request, which CAD always quotes itself, has none.
    forPieces('a declared value above $0', (it) => it.type !== 'custom' && !(numVal(it.value) > 0));
    if (!skipDates) {
      const twoDates = SERVICES[o.service]?.needsPickup && SERVICES[o.service]?.needsDropoff;
      if (twoDates && (!o.schedule?.deliveryDate || o.schedule.deliveryDate < o.schedule.date)) errs.push('delivery date');
      else errs.push(...scheduleErrors(o));
    }
    // Same item rules as the order form (public/app.js missingFields).
    const items = o.items || [];
    // Paloma's / partner catalog pieces are priced from a catalog size tier and may not have a full W×H×D.
    // CAD online orders now always collect inches (except a free-text custom request).
    const partner = !!(o.partnerOrder || o.skipVolumeDiscount);
    const needsDims = (it) => (it.type || 'painting') !== 'custom' && !(partner && (it.type === 'furniture' || it.type === 'decor'));
    forPieces('all three dimensions (width, height and depth)', (it) => needsDims(it) && !!VALID.dimProblem(it));
    forPieces('a complete size (width, height and depth, if any size is entered)', (it) => !needsDims(it) && !!VALID.optionalDimProblem(it));
    forPieces('a weight (or “Not sure”)', (it) => ['sculpture', 'other'].includes(it.type) && !(it.weightUnsure || numVal(it.weight) > 0));
    forPieces('a stairwell fit confirmation (pieces over 80 inches)', (it) => needsStairwellFit(it, o) && !it.fitsStairwell);
  }
  // On-site contact role at every stop, worded for the person on site (it may or may not be the booker).
  const stops = [];
  if (SERVICES[o.service]?.needsPickup) stops.push(['pickup', o.pickup]);
  if (SERVICES[o.service]?.needsDropoff) stops.push([SERVICES[o.service]?.install && !SERVICES[o.service]?.needsPickup ? 'install' : (SERVICES[o.service]?.shipping ? 'destination' : 'delivery'), o.dropoff]);
  stops.forEach(([name, a]) => {
    if (!a || !a.street) return;
    if (a.sameAsMe && !String(a.contactRole || '').trim()) errs.push(`your “I am a…” answer (used as the ${name} contact role)`);
    else if (!String(a.contactRole || '').trim()) errs.push(`${name} contact role`);
    else if (!a.sameAsMe && a.contactRole === 'Other' && !String(a.contactRoleOther || '').trim()) errs.push(`${name} contact role (describe it)`);
  });
  if (o.contact) {
    const em = VALID.emailProblem(o.contact.email);
    if (em) errs.push(em);
  }
  if (o.contact && String(o.contact.phone || '').replace(/\D/g, '').length < 7) errs.push('your mobile number');
  return errs;
}

// The date must be one the booking form could offer: a route day for that address (or a rush weekday when rush is
// chosen), not a holiday, not in the past, not inside the lead time. Delivery must be a route day for the delivery
// address on or after pickup. The browser enforces this too; the server is the one that counts.
function scheduleErrors(o) {
  const errs = [];
  const svc = SERVICES[o.service] || {};
  const d = String((o.schedule && o.schedule.date) || '');
  if (!d) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ['a date'];
  const blackout = { includes: (x) => sched.isClosed(x) };
  if (d < sched.ptYmd()) return ['a date in the future (that date has passed)'];
  if (blackout.includes(d)) {
    const why = require('./lib/sheet-days').reason(d, null, 1) || '';
    return [/^full/.test(why) ? 'FULL: that date just filled up' : 'another date (we don’t run routes on that holiday)'];
  }
  const first = svc.needsPickup ? o.pickup : o.dropoff;
  const addr = first && (first.zip || first.city) ? first : o.dropoff;
  // Dedicated sides (Chad, Nov 25 2026): any date that works for the customer (config.dedicatedTrip rules), not a route day.
  const DS = DEDICATED.sides(o);
  const firstDed = svc.needsPickup ? DS.pickup : DS.delivery;
  const dd0 = String((o.schedule && o.schedule.deliveryDate) || '');
  if (firstDed || (svc.needsPickup && svc.needsDropoff && DS.delivery)) {
    if (firstDed) { const p = DEDICATED.dateProblem(d, new Date(), addr); if (p) errs.push(`${svc.needsPickup ? 'pickup' : 'install'} date: ${p}`); }
    else if (!sched.availableDays(addr, { order: o, count: 400, quickStops: 'all' }).some((x) => x.date === d)) errs.push('an available route day for that address (please go back and pick a date from the list)');
    if (svc.needsPickup && svc.needsDropoff && dd0) {
      if (dd0 < d) errs.push('a delivery date on or after the pickup date');
      else if (DS.delivery) { const p = DEDICATED.dateProblem(dd0, new Date(), o.dropoff); if (p) errs.push(`delivery date: ${p}`); }
      else if (!sched.availableDays(o.dropoff, { from: new Date(d + 'T12:00:00Z'), leadTime: 0, order: o, count: 400, quickStops: 'all' }).some((x) => x.date === dd0))
        errs.push('an available delivery route day on or after the pickup date');
    }
    if (!errs.length) errs.push(...require('./lib/route-windows').selectionErrors(o, SERVICES));
    return errs;
  }
  const ok = o.rush
    ? sched.rushDays(addr, new Date(), 7, o).some((x) => x.date === d) || sched.availableDays(addr, { order: o, count: 400, quickStops: 'all' }).some((x) => x.date === d)
    : sched.availableDays(addr, { order: o, count: 400, quickStops: 'all' }).some((x) => x.date === d);
  if (!ok) {
    const why = require('./lib/sheet-days').reason(d, sched.zoneFor(addr), 1) || '';
    errs.push(/^full/.test(why) ? 'FULL: that date just filled up' : 'an available route day for that address (please go back and pick a date from the list)');
  }
  const dd = String((o.schedule && o.schedule.deliveryDate) || '');
  if (ok && svc.needsPickup && svc.needsDropoff && dd) {
    if (blackout.includes(dd)) errs.push('another delivery date (we don’t run routes on that holiday)');
    else if (!sched.canPairPickupDelivery(d, o.pickup, o.dropoff, o) || !sched.availableDeliveryDays(o.dropoff, o.pickup, d, o, 400, { quickStops: 'all' }).some((x) => x.date === dd))
      errs.push('a delivery day that matches the pickup route (the van can’t pick up after it has already served the delivery area that week)');
  }
  // Route-aware time windows: the chosen windows must still fit the day's planned route (re-checked at submit and again at pay).
  if (!errs.length) errs.push(...require('./lib/route-windows').selectionErrors(o, SERVICES));
  if (!errs.length && svc.install && !o.rush && !o.dedicated && !o.customDate) {
    const fit = installVisitFit(o);
    if (!fit.ok) errs.push('INSTALL_FIT: ' + (fit.message || 'Installation doesn’t fit this delivery day. Your pickup and delivery stay as they are.'));
  }
  return errs;
}

// Idempotency: the same order body twice within a day (double tap, retry, refresh after paying) returns the
// order that already exists instead of creating a second job or a second payment.
const DEDUPE_MS = 24 * 3600 * 1000;
const fingerprint = (b) => crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
const newOrderId = (all) => {
  let id;
  do { id = 'CAD-' + Date.now().toString(36).toUpperCase().slice(-6) + (id ? crypto.randomBytes(1).toString('hex').toUpperCase() : ''); } while (all.some((o) => o.id === id));
  return id;
};
const payerCopy = (o) => (o.payer === 'other' && o.payerOther && /\S+@\S+\.\S+/.test(o.payerOther.email || '')
  && String(o.payerOther.email).trim().toLowerCase() !== String((o.contact && o.contact.email) || '').trim().toLowerCase()
  ? { to: String(o.payerOther.email).trim(), name: o.payerOther.name || '' } : null);

app.post('/api/orders', (req, res) => {
  const b = req.body;
  // Shipping is for destinations outside California (QA audit Nov 22): a CA-to-CA job booked as Shipping is refused with a clear way forward.
  if (b && SERVICES[b.service] && SERVICES[b.service].shipping && !b.partnerOrder && inCaliforniaUS(b.pickup) && inCaliforniaUS(b.dropoff))
    return res.status(400).json({ error: 'Shipping is for destinations outside California. For a delivery within California, choose Pickup + Delivery.', caToCa: true });
  const errs = validate(b);
  if (errs.some((e) => /^FULL:/.test(e))) return res.status(409).json({ error: 'That date just filled up. Please go back and pick another date.', full: [String((b.schedule || {}).date || '')] });
  { const t = errs.find((e) => /^TIME:/.test(e)); if (t) return res.status(409).json({ error: t.replace(/^TIME:\s*/, ''), timeConflict: true }); }
  { const f = errs.find((e) => /^INSTALL_FIT:/.test(e)); if (f) return res.status(409).json({ error: f.replace(/^INSTALL_FIT:\s*/, ''), installFit: true }); }
  if (errs.length) return res.status(400).json({ error: 'Missing: ' + errs.join(', ') });
  const fp = fingerprint(b);
  const dup = load().find((x) => x.fingerprint === fp && Date.now() - Date.parse(x.createdAt) < DEDUPE_MS);
  if (dup) return res.json({ id: dup.id, quote: dup.quote, status: dup.status, order: dup, duplicate: true });
  const sizeWarn = (b.items || []).map((it) => VALID.belowMinWarning(it)).filter(Boolean);
  const special = quote(b).paymentPlan === 'quote' || !!b.quoteOnly || !!b.customDate || !!b.unverifiedAddress || !!b.sizeCheckQuote || sizeWarn.length; // rush, dedicated, shipping, quote-only, or below-minimum size review
  const outOfState = !SERVICES[b.service].shipping && isOutOfState(b);
  const shipping = !!SERVICES[b.service].shipping || outOfState;
  const svcKey = shipping ? 'crating_shipping' : b.service;
  const rv = shipping ? { needed: false, kinds: [], reasons: [] } : RULES.review(b);
  const order = {
    id: newOrderId(load()),
    createdAt: new Date().toISOString(),
    fingerprint: fp,
    status: special ? 'pending_approval' : 'awaiting_payment',
    service: svcKey, serviceLabel: SERVICES[svcKey].label,
    ...(outOfState ? { requestedService: b.service, outOfState: true } : {}),
    ...(shipping ? { shipping: b.shipping || {} } : {}),
    crating: false, rush: !!b.rush,
    ...(b.customDate ? { customDate: { note: String((b.schedule && b.schedule.customDateNote) || '').trim().slice(0, 500) } } : {}),
    ...(() => { const ds = DEDICATED.sides(b); return { dedicated: ds.pickup || ds.delivery, dedicatedPickup: ds.pickup, dedicatedDelivery: ds.delivery }; })(),
    // Access “Not sure” at any stop: CAD confirms access with the customer before the job (not priced as ground level silently).
    accessReview: ['pickup', 'dropoff'].some((k) => b[k] && b[k].street && ACCESS.needsReview(b[k])),
    // No member rate on the public site (Chad, Nov 19 2026): never stored from the request.
    member: false, memberCode: '', memberCompany: '',
    // Declared value protection is included unless the customer explicitly declined it; the choice is kept for CAD's records.
    // Declared value protection is always included on eligible pieces (Chad, Nov 23 2026): there is no opt-out to record.
    // Only the code text is kept; the server re-prices with it (quote.discount holds the amount actually taken off).
    ...(b.discountCode && DISCOUNTS.lookup(b.discountCode).ok ? { discountCode: DISCOUNTS.norm(b.discountCode) } : {}),
    heard: b.heard || {},
    referral: !!b.referral,
    // In-CA: mandatory on pieces valued $50K or less (none offered above). Shipping quotes: the customer's choice.
    declaredValueProtection: shipping ? false : ((b.items || []).some((it) => numVal(it.value) > 0 && numVal(it.value) <= 50000)),
    ...(b._legacyQty ? { legacyQty: b._legacyQty, needsManualReview: true, manualReviewReason: 'Legacy quantity: ' + legacyNote(b._legacyQty) + '. Original entry kept in legacyQty. Please confirm each piece\u2019s details and value with the customer.' } : {}),
    items: (b.items || []).map(routeDecorMirror), pickup: b.pickup || {}, dropoff: b.dropoff || {},
    contact: b.contact, partner: b.partner || {}, payer: b.payer || 'me', payerOther: b.payerOther || {},
    schedule: shipping
      ? { date: '', region: 'Shipping', deliveryLater: false, deliveryDate: '', timePref: 'none', timeNote: '', deliveryTimePref: 'none', deliveryTimeNote: '' }
      : (b.schedule && b.schedule.date)
      ? { ...b.schedule, timePref: ACCESS.timePrefList(b.schedule.timePref).join(',') || 'none', deliveryTimePref: ACCESS.timePrefList(b.schedule.deliveryTimePref).join(',') || 'none', region: sched.regionForDate(new Date(b.schedule.date + 'T12:00:00Z')) }
      : { date: '', region: 'Quote', deliveryLater: false, deliveryDate: '', timePref: 'none', timeNote: '', deliveryTimePref: 'none', deliveryTimeNote: '' },
    notes: b.notes || '',
    ...((rv.kinds.length || sizeWarn.length) ? { review: sizeWarn.length ? { needed: true, kinds: [...(rv.kinds || []), 'size_check'], reasons: [...(rv.reasons || []), { kind: 'size_check', text: sizeWarn[0].message }] } : rv } : {}),
    emails: [],
  };
  order.quote = quote(order);  // server-side price is authoritative
  // The opt-out is only recorded when there was protection to decline (an eligible piece up to $50,000, in-California white glove job).
  if (order.needsManualReview) teamAlert(`NEEDS MANUAL REVIEW: order ${order.id} was submitted with an old quantity entry`, `Order ${order.id}: ${order.manualReviewReason}\nPieces:\n${piecesOf(order).map((it, i) => '  ' + require('./lib/itemtypes').pieceDetail(it, i)).join('\n')}`);
  // Normal orders hold their date while the client pays. Review orders (pencil-in, helper, Monday OC) hold it while the team decides.
  if (!special || (rv.needed && !order.rush)) { const held = holdSlots(order, special); if (!held.ok) return res.status(409).json({ error: 'That date just filled up. Please go back and pick another date.', full: held.full }); }
  const all = load(); all.unshift(order); save(all);
  if (special) {
    reviewAlert(order);
    sheetSync.enqueue(order.id, 'quote_request'); // PENDING rows on SCHEDULE 2026 (PENDINGJOB / Pending Job) until approved and paid
    const sent = email.send('quote_received', order);
    update(order.id, (x) => x.emails.push(sent));
    const pc = payerCopy(order);
    if (pc) { const s2 = email.send('payer_quote', order, pc); update(order.id, (x) => x.emails.push(s2)); }
    // Every order gets an itemized email (Chad, Nov 25 2026): requests our team prices get the plain-text "request received" one.
    const deliverReq = async (to, forPayer) => {
      const { subject, body } = email.requestText(findOrder(order.id), forPayer);
      const r = await sheetSync.mail(to, subject, body);
      update(order.id, (x) => { x.emailDelivery = [...(x.emailDelivery || []), { to, kind: 'request_received', ok: !!r.ok, error: r.ok ? undefined : r.error, at: new Date().toISOString() }]; });
      if (!r.ok && sheetSync.configured()) teamAlert(`REQUEST EMAIL FAILED for ${order.id}`, `The request-received email to ${to} did not send: ${r.error}. Please send it by hand.`);
    };
    if (/\S+@\S+\.\S+/.test((order.contact && order.contact.email) || '')) deliverReq(String(order.contact.email).trim(), false).catch(() => {});
    if (pc) deliverReq(pc.to, true).catch(() => {});
  }
  res.json({ id: order.id, quote: order.quote, status: order.status, order: findOrder(order.id) });
});

app.get('/api/orders/:id', (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json({ order: o });
});

function sendConfirmationEmails(id) {
  const o = findOrder(id);
  if (!o || o.emails.find((e) => e.kind === 'confirmation')) return;
  const sent = email.send('confirmation', o);
  update(id, (x) => x.emails.push(sent));
  const pc = payerCopy(o);
  if (pc) { const s2 = email.send('payer_receipt', findOrder(id), pc); update(id, (x) => x.emails.push(s2)); }
  // Real delivery (Nov 23 2026): plain-text confirmation sent by the CAD Google account through the schedule bridge.
  const deliver = async (to, forPayer) => {
    const { subject, body } = email.confirmationText(findOrder(id), forPayer);
    const r = await sheetSync.mail(to, subject, body);
    update(id, (x) => { x.emailDelivery = [...(x.emailDelivery || []), { to, ok: !!r.ok, error: r.ok ? undefined : r.error, at: new Date().toISOString() }]; });
    if (!r.ok) teamAlert(`CONFIRMATION EMAIL FAILED for ${id}`, `The booking confirmation to ${to} did not send: ${r.error}. Please send it by hand.`);
  };
  if (/\S+@\S+\.\S+/.test((o.contact && o.contact.email) || '')) deliver(String(o.contact.email).trim(), false).catch(() => {});
  if (pc) deliver(pc.to, true).catch(() => {});
}
// Payment is confirmed server-side (webhook or pay call). The booking is only CONFIRMED to the customer once the schedule row is
// durably saved: until then the order shows scheduleStatus "pending" (exception queue + alert to Samantha if it keeps failing).
function finalize(id, payment) {
  const before = findOrder(id);
  const firstConfirm = !!(before && before.status !== 'confirmed');
  const o = update(id, (ord) => { if (ord.status === 'confirmed') return; ord.status = 'confirmed'; ord.payment = payment; delete ord.statusNote; ord.scheduleStatus = sheetSync.configured() ? 'pending' : 'not_configured'; });
  if (!o) return null;
  const cur = findOrder(id);
  // Paid bookings that trip a Date Guard rule (remote area, Monday OC, NEED HELPER, oversized, no street number): the team checks them.
  if (firstConfirm && cur.review && (cur.review.reasons || []).length && !cur.rush) teamAlert(`CHECK PAID BOOKING ${cur.id} (${(cur.review.kinds || []).join(', ')})`,
    `Order ${cur.id} is PAID and booked online. Call the client to confirm the date and arrival window.\n`
    + `Client: ${(cur.contact || {}).name || ''} ${(cur.contact || {}).phone || ''} ${(cur.contact || {}).email || ''}\n`
    + `Date(s): ${(cur.schedule || {}).date || 'none'}${(cur.schedule || {}).deliveryDate ? ' / delivery ' + cur.schedule.deliveryDate : ''}\n`
    + `Check: ${(cur.review.reasons || []).map((r) => r.text).join(' | ')}`);
  if (!cur.emails.find((e) => e.kind === 'confirmation' || e.kind === 'payment_received')) {
    if (sheetSync.configured()) {
      const sent = email.send('payment_received', cur);
      update(id, (x) => x.emails.push(sent));
    } else sendConfirmationEmails(id);
    schedule.appendOrder(findOrder(id));
  }
  require('./lib/holds').extend(id, 24 * 3600 * 1000); // keep the slots reserved until the sheet row exists
  if (findOrder(id).status === 'confirmed') sheetSync.enqueue(id, 'confirmed'); // idempotent by order id; retried until saved
  if (!sheetSync.configured()) require('./lib/holds').release(id);
  return findOrder(id);
}

async function stripeCustomerFor(order, saveMethod) {
  const emailKey = (order.contact.email || '').toLowerCase();
  const book = loadCustomers();
  let entry = book[emailKey];
  if (entry && entry.stripeCustomerId && stripe) {
    try {
      const c = await stripe.customers.retrieve(entry.stripeCustomerId);
      if (!c.deleted) return { customerId: c.id, entry };
    } catch (_) { /* stale id, make a new one */ }
  }
  if (!saveMethod && !entry) return { customerId: null, entry: null };
  const customer = await stripe.customers.create({
    email: order.contact.email,
    name: order.contact.name,
    metadata: { orderId: order.id },
  });
  entry = { email: emailKey, name: order.contact.name, stripeCustomerId: customer.id, savedMethods: (entry && entry.savedMethods) || [] };
  book[emailKey] = entry;
  saveCustomers(book);
  return { customerId: customer.id, entry };
}

app.post('/api/orders/:id/pay', async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.status === 'pending_approval') return res.status(400).json({ error: 'This order is awaiting a CAD quote. Payment opens after approval.' });
  const PS = require('./lib/payment-status');
  const st = PS.payStatus(o);
  if (o.status === 'confirmed' && st === 'paid' && PS.unpaidBalance(o) <= 0) return res.json({ order: o });
  if (o.status === 'confirmed' && st === 'ach_processing') return res.json({ order: o, paymentStatus: 'Payment processing' });
  if (o.status === 'confirmed' && st === 'zelle_requested') return res.json({ order: o, paymentStatus: 'Zelle payment requested' });
  if (o.quote.paymentPlan === 'quote' || !o.quote.dueNow) return res.status(400).json({ error: 'No amount is due until CAD approves a price.' });
  const pairErrs = scheduleErrors(o);
  { const t = pairErrs.find((e) => /^TIME:/.test(e)); if (t) return res.status(409).json({ error: t.replace(/^TIME:\s*/, ''), timeConflict: true }); }
  { const f = pairErrs.find((e) => /^INSTALL_FIT:/.test(e)); if (f) return res.status(409).json({ error: f.replace(/^INSTALL_FIT:\s*/, ''), installFit: true }); }
  if (pairErrs.length) return res.status(400).json({ error: 'Please go back and pick dates that work together on the route: ' + pairErrs[0] });
  { const held = holdSlots(o, false); if (!held.ok) return res.status(409).json({ error: 'That date just filled up. Please go back and pick another date.', full: held.full }); }

  const method = req.body.method;
  // Pay by Zelle: books now (AF "Payment Requested"), slot held 24 h, CAD verifies by hand. Never marked paid here.
  if (method === 'zelle') {
    const Z = config.payment.zelle || {};
    if (!Z.enabled) return res.status(400).json({ error: 'Zelle isn’t available right now. Please pay by bank or card.' });
    const now = Date.now();
    const payment = { method: 'zelle', status: 'zelle_requested', amount: o.quote.dueNow, requestedAt: new Date(now).toISOString(), dueBy: new Date(now + (Z.holdHours || 24) * 3600 * 1000).toISOString(), payee: Z.payee, zelleTo: Z.email, memo: o.id };
    const done = finalize(o.id, payment);
    require('./lib/holds').extend(o.id, (Z.holdHours || 24) * 3600 * 1000);
    teamAlert(`ZELLE REQUESTED: ${o.id} $${Number(payment.amount).toFixed(2)} due by ${ptTime(payment.dueBy)} PT`, `Order ${o.id} is booked with Pay by Zelle (Payment Status: Payment Requested).
Expected: $${Number(payment.amount).toFixed(2)} to ${Z.email}, memo ${o.id} (split transfers are OK if the total arrives on time).
Due by: ${ptTime(payment.dueBy)} PT.
When it arrives, mark it received in the admin page (Zelle list) or set PAID on the schedule by hand. The site never marks Zelle paid on its own.
If it is not verified by then, the order is flagged for the team to release the slot. Nothing is deleted automatically.`);
    return res.json({ order: done || findOrder(o.id) });
  }
  if (method === 'invoice') return res.status(400).json({ error: 'There are no trade accounts. Payment is due up front by card or bank transfer.' });

  const saveMethod = !!(req.body.save && config.payment.savePaymentMethod);

  if (stripe) {
    const { customerId } = await stripeCustomerFor(o, saveMethod);
    const session = await stripe.checkout.sessions.create(STRIPE_CO.sessionParams(o, { baseUrl: BASE_URL, currency: config.pricing.currency, companyName: config.company.name, customerId, saveMethod }));
    update(o.id, (x) => { x.savePaymentMethod = saveMethod; if (customerId) x.stripeCustomerId = customerId; });
    return res.json({ redirect: session.url });
  }

  // MOCK payment (no Stripe key): card or ACH test details. Only with TEST_MODE=1.
  if (!TEST_MODE) return res.status(503).json({ error: 'Online payment isn’t available right now. Please reach us through our Contact Us page at californiaartdelivery.com/pages/contact.' });
  const payMethod = method === 'ach' || method === 'us_bank_account' || method === 'mock_ach' ? 'ach' : 'card';
  if (payMethod === 'ach') {
    const routing = String(req.body.routing || '').replace(/\D/g, '');
    const account = String(req.body.account || '').replace(/\D/g, '');
    if (!/^\d{9}$/.test(routing) || !/^\d{4,17}$/.test(account))
      return res.status(400).json({ error: 'Enter a 9-digit routing number and an account number (test: 110000000 / 000123456789).' });
    const payment = {
      // Job confirms on submission (Chad's rule); the money itself is labeled as still processing.
      method: 'mock_ach', status: 'ach_processing', amount: o.quote.dueNow,
      ref: 'mock_ach_' + crypto.randomBytes(4).toString('hex'),
      last4: account.slice(-4), bank: true, saved: saveMethod,
    };
    if (saveMethod) rememberMockMethod(o, payment);
    return res.json({ order: finalize(o.id, payment) });
  }
  if (method === 'apple_pay' || method === 'google_pay') {
    const payment = {
      method: 'mock_' + method, status: 'paid', amount: o.quote.dueNow,
      ref: 'mock_' + method + '_' + crypto.randomBytes(4).toString('hex'), wallet: true, saved: false,
    };
    return res.json({ order: finalize(o.id, payment) });
  }
  const card = String(req.body.card || '').replace(/\s/g, '');
  if (!/^\d{15,16}$/.test(card)) return res.status(400).json({ error: 'Enter a test card number (e.g. 4242 4242 4242 4242).' });
  const payment = {
    method: 'mock_card', status: 'paid', amount: o.quote.dueNow,
    ref: 'mock_' + crypto.randomBytes(4).toString('hex'),
    last4: card.slice(-4), saved: saveMethod,
  };
  if (saveMethod) rememberMockMethod(o, payment);
  res.json({ order: finalize(o.id, payment) });
});

function rememberMockMethod(order, payment) {
  const emailKey = (order.contact.email || '').toLowerCase();
  const book = loadCustomers();
  const entry = book[emailKey] || { email: emailKey, name: order.contact.name, savedMethods: [] };
  entry.savedMethods = entry.savedMethods || [];
  entry.savedMethods.push({
    type: payment.method, last4: payment.last4, bank: !!payment.bank,
    savedAt: new Date().toISOString(), orderId: order.id,
  });
  book[emailKey] = entry;
  saveCustomers(book);
}

// ---------- Zelle: 24-hour verification window (flag, never auto-delete) ----------
const ptTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const zelleOrders = () => load().filter((o) => o.payment && o.payment.method === 'zelle');
function zelleSweep(now = Date.now()) {
  const flagged = [];
  zelleOrders().filter((o) => o.payment.status === 'zelle_requested' && Date.parse(o.payment.dueBy) <= now && !o.payment.overdueFlaggedAt).forEach((o) => {
    update(o.id, (x) => { x.payment.overdueFlaggedAt = new Date(now).toISOString(); x.zelleOverdue = true; });
    teamAlert(`ZELLE NOT VERIFIED IN 24 H: ${o.id} — release the slot?`, `Order ${o.id} (${(o.contact || {}).name || ''}, ${(o.schedule || {}).date || ''}${(o.schedule || {}).deliveryDate ? ' / ' + o.schedule.deliveryDate : ''}) chose Pay by Zelle and $${Number(o.payment.amount).toFixed(2)} has not been marked received by ${ptTime(o.payment.dueBy)} PT.
Check the CAD Zelle account for memo ${o.id}. If it arrived, mark it received. If not, contact the client and, if you release the slot, clear its schedule rows by hand. The site has not deleted anything.`);
    flagged.push(o.id);
  });
  return flagged;
}
setInterval(() => { try { zelleSweep(); } catch (e) { console.error('zelle sweep', e.message); } }, Number(process.env.ZELLE_SWEEP_MS) || 15 * 60 * 1000).unref();
setTimeout(() => { try { zelleSweep(); } catch {} }, 5000).unref();
const zelleAdminOk = (req) => typeof adminKeyOk === 'function' && adminKeyOk(req.query.key || req.get('x-admin-key'));
// Flagged list for the team: every Zelle order still waiting, and the ones past 24 h.
app.get('/api/admin/zelle', (req, res) => {
  if (!zelleAdminOk(req)) return res.status(401).json({ error: 'admin key required' });
  zelleSweep();
  const rows = zelleOrders().map((o) => ({ id: o.id, client: (o.contact || {}).name, email: (o.contact || {}).email, dates: [(o.schedule || {}).date, (o.schedule || {}).deliveryDate].filter(Boolean), amount: o.payment.amount, status: o.payment.status, requestedAt: o.payment.requestedAt, dueBy: o.payment.dueBy, overdue: o.payment.status === 'zelle_requested' && Date.parse(o.payment.dueBy) <= Date.now(), flaggedAt: o.payment.overdueFlaggedAt || null }));
  res.json({ waiting: rows.filter((r) => r.status === 'zelle_requested' && !r.overdue), overdue: rows.filter((r) => r.overdue), verified: rows.filter((r) => r.status === 'paid') });
});
// A person on the CAD team confirms the money arrived (the only way a Zelle order becomes PAID).
app.post('/api/admin/orders/:id/zelle-received', (req, res) => {
  if (!zelleAdminOk(req)) return res.status(401).json({ error: 'admin key required' });
  const o = findOrder(req.params.id);
  if (!o || !o.payment || o.payment.method !== 'zelle') return res.status(404).json({ error: 'not a Zelle order' });
  const by = String((req.body && req.body.by) || 'CAD team').slice(0, 60);
  update(o.id, (x) => { x.payment = { ...x.payment, status: 'paid', verifiedAt: new Date().toISOString(), verifiedBy: by, received: Number((req.body && req.body.amount) || x.payment.amount) }; delete x.zelleOverdue; });
  sheetSync.enqueue(o.id, 'payment');
  res.json({ order: findOrder(o.id) });
});

// Return from Stripe Checkout
app.get('/api/orders/:id/verify', async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.status === 'confirmed') return res.json({ order: o });
  if (stripe && req.query.session_id) {
    const s = await stripe.checkout.sessions.retrieve(req.query.session_id);
    // Confirm the job on submission, including ACH that is still processing / has not cleared (Chad, Nov 14 2026).
    const payment = STRIPE_CO.paymentFromSession(s, o.id);
    if (payment) {
      const method = payment.method;
      if (payment.saved && s.customer) {
        const book = loadCustomers();
        const emailKey = (o.contact.email || '').toLowerCase();
        const entry = book[emailKey] || { email: emailKey, name: o.contact.name, savedMethods: [] };
        entry.stripeCustomerId = typeof s.customer === 'string' ? s.customer : s.customer.id;
        entry.savedMethods = entry.savedMethods || [];
        entry.savedMethods.push({ type: method, savedAt: new Date().toISOString(), orderId: o.id, ref: s.id });
        book[emailKey] = entry;
        saveCustomers(book);
      }
      return res.json({ order: finalize(o.id, payment) });
    }
  }
  res.json({ order: o });
});


// TEST_MODE only: mock a later ACH settlement or a failed-after-processing path, then the customer can retry without a second amount due.
app.post('/api/orders/:id/mock-payment-update', (req, res) => {
  if (process.env.TEST_MODE !== '1') return res.status(404).json({ error: 'not found' });
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  const result = String((req.body && req.body.result) || '');
  if (result === 'fail' || result === 'failed') {
    const updated = update(o.id, (ord) => {
      ord.payment = { ...(ord.payment || {}), status: 'failed', failedAt: new Date().toISOString(), failReason: (req.body && req.body.reason) || 'mock_fail_after_processing' };
      ord.status = 'awaiting_payment';
      ord.statusNote = 'Payment failed after processing. The customer can retry. One amount is due; nothing was duplicated.';
    });
    return res.json({ order: findOrder(o.id), paymentStatus: require('./lib/payment-status').paymentStatusLabel(findOrder(o.id)) });
  }
  if (result === 'paid' || result === 'settle') {
    const pay = { ...(o.payment || {}), status: 'paid', settledAt: new Date().toISOString() };
    const cur = findOrder(o.id);
    if (cur.status !== 'confirmed') return res.json({ order: finalize(o.id, pay) });
    update(o.id, (ord) => { ord.payment = pay; delete ord.statusNote; });
    sheetSync.enqueue(o.id, 'payment');
    return res.json({ order: findOrder(o.id), paymentStatus: 'Paid' });
  }
  return res.status(400).json({ error: 'result must be fail or paid' });
});

// ---------- Paloma's Home Furnishings partner flow (/palomas) ----------
// A dedicated, streamlined order page for the showroom. Prices come from the same engine (member code PALOMAS = the 25% member
// rates), then the partner rules in lib/palomas.js. Orders go into the same store, emails, admin and schedule CSV as every other order.
const PAL = require('./lib/palomas');
const STRIPE_CO = require('./lib/stripe-checkout');
const ACCESS_PAL = require('./public/access');
app.get('/palomas', (_, res) => res.sendFile(path.join(__dirname, 'public', 'palomas', 'index.html')));
app.get('/api/palomas/config', (_, res) => res.json({
  partner: PAL.PARTNER_NAME, placedBy: PAL.PLACED_BY, pickups: Object.values(PAL.PICKUPS).map(({ key, label, detail }) => ({ key, label, detail })),
  rules: PAL.RULES, catalog: PAL.catalog, pay: { stripe: !!stripe, testMode: !stripe && TEST_MODE, partnerEmail: PAL.PARTNER_EMAIL },
  kinds: {
    furniture: FURNITURE_KINDS, groups: config.pricing.furniture.decorKindGroups,
    accents: config.pricing.furniture.accents.kinds,
  },
  access: ACCESS.MODES, flights: ACCESS.FLIGHTS,
  dedicated: DEDICATED.publicRules(), // dates only; the fee rules stay on the server
  hangHardware: (config.pricing && config.pricing.hangHardware) || {},
}));
function palomasPublicQuote(q) {
  if (q.special) return { special: true, shipping: q.shipping, review: q.review || '', quoteNote: q.quoteNote, notes: q.notes };
  const { engine, ...rest } = q;
  return rest;
}
// Staff code for the two hidden controls. Neutral wording on purpose: nothing here says what the controls do.
const unlockHits = new Map();
// Every way of guessing the code (unlock, quote with courtesy, order with courtesy / Paloma's Pay) shares one per-visitor limit
// on WRONG guesses, so the quote and order endpoints can't be used to brute-force it (audit Nov 18).
const codeTries = (req) => { const now = Date.now(); const ip = req.ip || 'x'; return { ip, now, hits: (unlockHits.get(ip) || []).filter((t) => now - t < 60000) }; };
const CODE_TRIES = Math.max(3, parseInt(process.env.CODE_TRIES_PER_MIN, 10) || 10); // tests raise it; production keeps 10 wrong guesses a minute
const codeBlocked = (req) => codeTries(req).hits.length >= CODE_TRIES;
const codeMiss = (req) => { const { ip, now, hits } = codeTries(req); hits.push(now); unlockHits.set(ip, hits); };
app.post('/api/palomas/unlock', (req, res) => {
  if (codeBlocked(req)) return res.status(429).json({ ok: false });
  const ok = PAL.staffCodeOk(String((req.body || {}).code || ''));
  if (!ok) codeMiss(req);
  res.json({ ok });
});
app.post('/api/palomas/quote', (req, res) => {
  const b = req.body || {};
  if (b.courtesy) {
    if (codeBlocked(req)) b.courtesy = false;
    else if (!PAL.staffCodeOk(b.pin)) { b.courtesy = false; codeMiss(req); } // never applied without the staff code
  }
  b.items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && typeof x === 'object').slice(0, 60);
  if (!b.items.length) return res.json({ empty: true });
  try { res.json(palomasPublicQuote(PAL.partnerQuote(b))); } catch (e) { res.status(400).json({ error: 'Could not price that yet.' }); }
});
app.post('/api/palomas/availability', (req, res) => {
  const b = req.body || {};
  if (!b.delivery || typeof b.delivery !== 'object') b.delivery = {};
  b.items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && typeof x === 'object').slice(0, 60);
  const o = PAL.engineOrder(b, { member: true });
  const zip = String(o.dropoff.zip || '');
  if (!/^\d{5}/.test(zip)) return res.json({ days: [] });
  const conflict = sched.routeConflict(o.dropoff, 'delivery') || sched.routeConflict(o.pickup, 'pickup');
  if (conflict) return res.status(400).json({ error: conflict.message, conflict: true, days: [] });
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(String(b.pickupDate || ''));
  const COUNT = 14; // next 14 available days; "Later date" asks for days from a chosen date (same scheduling rules)
  const laterOk = /^\d{4}-\d{2}-\d{2}$/.test(String(b.from || '')) && b.from >= sched.ptYmd();
  const dedicatedBlocked = { pickup: DEDICATED.blockedFor(o.pickup), delivery: DEDICATED.blockedFor(o.dropoff) };
  if (b.leg === 'dropoff' && dateOk) {
    const start = laterOk && b.from > b.pickupDate ? b.from : b.pickupDate;
    return res.json({ days: sched.availableDeliveryDays(o.dropoff, o.pickup, start, o, COUNT, laterOk ? { quickStops: 'all' } : {}), dedicatedBlocked });
  }
  const earliest = sched.availablePickupDays(o.pickup, o.dropoff, { order: o, count: COUNT });
  if (laterOk && earliest.length && b.from > earliest[0].date) return res.json({ days: sched.availablePickupDays(o.pickup, o.dropoff, { from: new Date(b.from + 'T12:00:00Z'), count: COUNT, order: o, leadTime: 0, quickStops: 'all' }), earliest: earliest[0].date, dedicatedBlocked });
  res.json({ days: earliest, earliest: (earliest[0] || {}).date, dedicatedBlocked });
});
app.post('/api/palomas/orders', (req, res) => {
  const b = req.body || {};
  if (!b.delivery || typeof b.delivery !== 'object') b.delivery = {};
  b.items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && typeof x === 'object');
  if ((b.courtesy || b.payer === 'palomas') && (codeBlocked(req) || !PAL.staffCodeOk(b.pin))) { codeMiss(req); return res.status(403).json({ error: 'That option isn’t available.' }); }
  const errs = PAL.validate(b);
  const eo = PAL.engineOrder(b, { member: true });
  const q = errs.length ? null : PAL.partnerQuote(b);
  const sc = b.schedule || {};
  const customDate = !!b.customDate;
  if (!errs.length && customDate && !String(sc.customDateNote || '').trim()) errs.push('which dates would work (custom date request)');
  if (!errs.length && !q.special && !customDate) {
    const ordForDates = { ...eo, schedule: { date: sc.date, deliveryDate: sc.deliveryDate, customDateNote: sc.customDateNote || '' } };
    if (!sc.date || !sc.deliveryDate || sc.deliveryDate < sc.date) errs.push('pickup and delivery days');
    else errs.push(...scheduleErrors(ordForDates));
  }
  if (errs.length) {
    const f = errs.find((e) => /^INSTALL_FIT:/.test(e));
    if (f) return res.status(409).json({ error: f.replace(/^INSTALL_FIT:\s*/, ''), installFit: true });
    const t = errs.find((e) => /^TIME:/.test(e));
    if (t) return res.status(409).json({ error: t.replace(/^TIME:\s*/, ''), timeConflict: true });
    return res.status(400).json({ error: 'Missing: ' + errs.join(', ') });
  }
  const fp = fingerprint(b);
  const dup = load().find((x) => x.fingerprint === fp && Date.now() - Date.parse(x.createdAt) < DEDUPE_MS);
  if (dup) return res.json({ id: dup.id, status: dup.status, order: dup, duplicate: true });
  const placedName = b.placedBy.name === 'Other' ? String(b.placedBy.other).trim() : b.placedBy.name;
  const pickup = PAL.pickupAddress(b.pickupLocation);
  const dropoff = eo.dropoff;
  const items = eo.items.map(routeDecorMirror);
  const outOfState = isOutOfState({ service: 'pickup_delivery', pickup, dropoff });
  const palomasPays = b.payer === 'palomas';
  const partnerInfo = {
    payer: palomasPays ? 'palomas' : 'client', payMode: b.payMode === 'link' ? 'link' : 'now',
    placedBy: placedName, pickupLocation: PAL.PICKUPS[b.pickupLocation].label, courtesy: !!b.courtesy,
    standard: q.standard, partnerPrice: q.partner, volumeOff: q.volumeOff, courtesyOff: q.courtesyOff,
  };
  const base = {
    id: newOrderId(load()), createdAt: new Date().toISOString(), fingerprint: fp,
    crating: false, rush: false,
    dedicated: !customDate && !!(b.dedicatedPickup || b.dedicatedDelivery),
    dedicatedPickup: !customDate && !!b.dedicatedPickup,
    dedicatedDelivery: !customDate && !!b.dedicatedDelivery,
    customDate: customDate ? { note: String(sc.customDateNote || '').trim().slice(0, 500) } : false,
    // "Not sure": CAD confirms access with the client before the job. Stairs are priced up front (per flight, large pieces).
    accessReview: dropoff.accessMode === 'not_sure' || ACCESS_PAL.needsReview(dropoff) || PAL.accessUnsure(b.access),
    member: true, memberCode: PAL.PARTNER_CODE, memberCompany: PAL.PARTNER_NAME, heard: { repeatClient: true }, referral: false,
    declaredValueProtection: (items || []).some((it) => { const v = Number(it.value) || 0; return v > 0 && v <= 50000; }),
    items, pickup, dropoff,
    // The client is the booker (confirmation and payment link go to them). The payer is the client, or Paloma's when they choose to pay.
    contact: { name: b.delivery.name.trim(), email: b.delivery.email.trim(), phone: b.delivery.phone.trim(), company: '', clientType: `Partner: ${PAL.PARTNER_NAME}` },
    partner: { type: 'Partner', name: PAL.PARTNER_NAME, email: PAL.PARTNER_EMAIL, phone: PAL.PARTNER_PHONE },
    contact2: (b.delivery.client2 && String(b.delivery.client2.name || '').trim()) ? { name: String(b.delivery.client2.name).trim(), phone: String(b.delivery.client2.phone || '').trim(), email: String(b.delivery.client2.email || '').trim() } : null,
    partnerOrder: true, partnerInfo, payer: palomasPays ? 'other' : 'me', payerOther: palomasPays ? { name: PAL.PARTNER_NAME, email: PAL.PARTNER_EMAIL, phone: PAL.PARTNER_PHONE } : {},
    notes: [`Partner order placed by ${placedName} (${PAL.PARTNER_NAME}); pickup: ${partnerInfo.pickupLocation}.`, (dropoff.accessMode === 'not_sure' || PAL.accessUnsure(b.access)) ? 'TEAM REVIEW: access is NOT CONFIRMED (customer was not sure). Confirm access with the client before the job; any extra fee needs their approval first.' : '', String(b.delivery.notes || '').trim()].filter(Boolean).join(' '),
    emails: [],
  };
  if (q.special || outOfState) {
    const order = {
      ...base, status: 'pending_approval', service: 'crating_shipping', serviceLabel: q.review === 'heavy' ? 'Heavy-item review (pickup + delivery)' : SERVICES.crating_shipping.label, requestedService: 'pickup_delivery', outOfState: q.review !== 'heavy',
      ...(q.review === 'heavy' ? { reviewReason: 'heavy', notes: `TEAM REVIEW: a piece over ${PAL.HEAVY_REVIEW_LB} lb (weight given or stated in the item name). Confirm weight, dimensions, crew and price before quoting. ` + base.notes } : {}),
      shipping: { flexible: true, notes: 'Partner order from the Paloma’s flow; confirm destination service level and dates.' },
      schedule: { date: '', region: 'Shipping', deliveryLater: false, deliveryDate: '', timePref: 'none', timeNote: '', deliveryTimePref: 'none', deliveryTimeNote: '' },
    };
    order.quote = quote({ ...order, memberCode: PAL.PARTNER_CODE });
    const all = load(); all.unshift(order); save(all);
    sheetSync.enqueue(order.id, 'quote_request');
    const sent = email.send('quote_received', order);
    update(order.id, (x) => x.emails.push(sent));
    return res.json({ id: order.id, status: order.status, quote: { special: true }, order: findOrder(order.id) });
  }
  if (customDate) {
    const note = String((sc.customDateNote || '')).trim().slice(0, 500);
    const order = {
      ...base, status: 'pending_approval', service: 'pickup_delivery', serviceLabel: SERVICES.pickup_delivery.label,
      schedule: { date: sc.date || '', deliveryDate: sc.deliveryDate || '', deliveryLater: !!(sc.deliveryDate && sc.date && sc.deliveryDate > sc.date), region: sc.date ? (sched.regionForDate(new Date(sc.date + 'T12:00:00Z')) || '') : '', timePref: 'none', timeNote: '', deliveryTimePref: 'none', deliveryTimeNote: '', customDateNote: note },
      notes: `CUSTOM DATE REQUEST: ${note}. Nothing is charged until we confirm the date. ` + base.notes,
    };
    const lines = [
      ...q.lines.map(({ label, amount }) => ({ label, amount })),
      ...(q.volumeOff ? [{ label: `Partnership volume discount: additional ${PAL.RULES.volumePct}% off (delivery orders of $${PAL.RULES.volumeThreshold.toLocaleString('en-US')}+ after partnership pricing)`, amount: -q.volumeOff }] : []),
      ...(q.courtesyOff ? [{ label: "Manager's courtesy", amount: -q.courtesyOff }] : []),
    ];
    order.quote = {
      ...q.engine, notes: (q.engine.notes || []).filter((n) => n !== ACCESS_PAL.PRICE_NOTE), accessFeeNote: q.accessFeeNote, accessReview: !!q.accessReview, totalLabel: q.totalLabel, lines, total: q.total, regularTotal: q.total, protection: q.protection, protectionAmount: q.protectionAmount || 0, member: true, memberCompany: PAL.PARTNER_NAME,
      ...q.payment,
      partnerPricing: { standard: q.standard, partnerPrice: q.partner, partnerSavings: q.partnerSavings, volumeOff: q.volumeOff, courtesyOff: q.courtesyOff, delivery: q.delivery, items: q.lines.map(({ label, standard, amount, after, qty }) => ({ label, standard, partner: amount, allIn: after, qty })) },
      reviewOnly: true, quoteNote: 'We’ll schedule it and confirm the date with you before anything is charged.',
    };
    const allC = load(); allC.unshift(order); save(allC);
    sheetSync.enqueue(order.id, 'quote_request');
    const sentC = email.send('quote_received', order);
    update(order.id, (x) => x.emails.push(sentC));
    return res.json({ id: order.id, status: order.status, quote: { total: q.total, dueNow: 0, review: true, customDate: true }, order: findOrder(order.id) });
  }
  const palSvc = (b.service === 'delivery_install') ? 'delivery_install' : 'pickup_delivery';
  const order = {
    ...base, status: 'awaiting_payment', service: palSvc, serviceLabel: SERVICES[palSvc].label,
    schedule: { date: sc.date, deliveryDate: sc.deliveryDate, deliveryLater: sc.deliveryDate > sc.date, region: sched.regionForDate(new Date(sc.date + 'T12:00:00Z')), timePref: 'none', timeNote: '', deliveryTimePref: 'none', deliveryTimeNote: '' },
  };
  const lines = [
    ...q.lines.map(({ label, amount }) => ({ label, amount })),
    ...(q.volumeOff ? [{ label: `Partnership volume discount: additional ${PAL.RULES.volumePct}% off (delivery orders of $${PAL.RULES.volumeThreshold.toLocaleString('en-US')}+ after partnership pricing)`, amount: -q.volumeOff }] : []),
    ...(q.courtesyOff ? [{ label: "Manager's courtesy", amount: -q.courtesyOff }] : []),
  ];
  order.quote = {
    ...q.engine, notes: (q.engine.notes || []).filter((n) => n !== ACCESS_PAL.PRICE_NOTE), accessFeeNote: q.accessFeeNote, accessReview: !!q.accessReview, totalLabel: q.totalLabel, lines, total: q.total, regularTotal: q.total, protection: q.protection, protectionAmount: q.protectionAmount || 0, member: true, memberCompany: PAL.PARTNER_NAME,
    ...q.payment, // same payment plan as the main site (paid in full; 50% at booking from $3,000)
    partnerPricing: { standard: q.standard, partnerPrice: q.partner, partnerSavings: q.partnerSavings, volumeOff: q.volumeOff, courtesyOff: q.courtesyOff, delivery: q.delivery, items: q.lines.map(({ label, standard, amount, after, qty }) => ({ label, standard, partner: amount, allIn: after, qty })) },
  };
  // Pay-by-link: the client can't pay at the showroom. Nothing is scheduled (no CSV row) until the link is paid.
  if (b.payMode === 'link') {
    order.statusNote = 'Awaiting payment — not scheduled until paid';
    order.paymentLink = { sentAt: new Date().toISOString(), lastEmailAt: new Date().toISOString(), reminders: 0 };
  }
  // Date Guard review rules (remote-area pencil-in, NEED HELPER such as any sofa, Monday OC): a pending request, never auto-confirmed.
  const rvp = RULES.review(order);
  if (rvp.needed) {
    order.status = 'pending_approval'; order.review = rvp; delete order.paymentLink; delete order.statusNote;
    order.quote = { ...order.quote, reviewOnly: true, reviewKinds: rvp.kinds, reviewReasons: rvp.reasons.map((r) => r.text), quoteNote: RULES.customerNote(rvp) };
    const heldR = holdSlots(order, true);
    if (!heldR.ok) return res.status(409).json({ error: 'That date just filled up. Please go back and pick another date.', full: heldR.full });
    const allR = load(); allR.unshift(order); save(allR);
    reviewAlert(order);
    sheetSync.enqueue(order.id, 'quote_request');
    const sentR = email.send('quote_received', order);
    update(order.id, (x) => x.emails.push(sentR));
    return res.json({ id: order.id, status: order.status, quote: { total: q.total, dueNow: 0, review: true }, order: findOrder(order.id) });
  }
  { const held = holdSlots(order, b.payMode === 'link'); if (!held.ok) return res.status(409).json({ error: 'That date just filled up. Please go back and pick another date.', full: held.full }); }
  const all = load(); all.unshift(order); save(all);
  if (b.payMode === 'link') {
    const sent = email.send('payment_link', order);
    update(order.id, (x) => x.emails.push(sent));
  }
  res.json({ id: order.id, status: order.status, quote: { total: q.total, dueNow: q.payment.dueNow }, order: findOrder(order.id) });
});

// One payment reminder per day until a payment-link order is paid (simple in-process timer; Render restarts clear test data anyway).
const REMINDER_MS = 24 * 3600 * 1000, REMINDER_MAX = 30;
function runPaymentReminders(now = Date.now()) {
  const sent = [];
  load().filter((o) => o.status === 'awaiting_payment' && o.paymentLink && (o.paymentLink.reminders || 0) < REMINDER_MAX).forEach((o) => {
    if (now - Date.parse(o.paymentLink.lastEmailAt) < REMINDER_MS) return;
    const e = email.send('payment_reminder', o);
    update(o.id, (x) => { x.emails.push(e); x.paymentLink.reminders = (x.paymentLink.reminders || 0) + 1; x.paymentLink.lastEmailAt = new Date(now).toISOString(); });
    sent.push(o.id);
  });
  return sent;
}
setInterval(() => { try { runPaymentReminders(); } catch (e) { console.error('reminder run failed', e.message); } }, 15 * 60 * 1000).unref();
app.post('/api/admin/payment-reminders/run', (req, res, next) => (ADMIN_ON && adminKeyOk(req.query.key || req.get('x-admin-key')) ? next() : res.status(401).json({ error: 'admin key required' })),
  (req, res) => { const t = Date.parse((req.body || {}).asOf); res.json({ sent: runPaymentReminders(Number.isFinite(t) ? t : Date.now()) }); });

// ---------- Admin (prototype: simple shared key) ----------
const adminKeyOk = (k) => ADMIN_ON && typeof k === 'string' && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
const admin = (req, res, next) => {
  if (!ADMIN_ON) return res.status(503).json({ error: 'Admin is turned off on this server (ADMIN_KEY is not set).' });
  return adminKeyOk(req.query.key || req.get('x-admin-key')) ? next() : res.status(401).json({ error: 'admin key required' });
};
app.get('/api/admin/orders', admin, (_, res) => res.json({ orders: load().map((o) => ({ ...o, itemLines: piecesOf(o).map((it, i) => (o.partnerOrder ? itemLine(it) : require('./lib/itemtypes').pieceDetail(it, i))), ...(o.service === 'crating_shipping' ? { shippingLines: require('./lib/shiptext').lines(o) } : {}) })), columns: schedule.COLUMNS, letters: schedule.LETTERS }));
app.get('/api/admin/schedule.csv', admin, (_, res) => {
  const rows = [schedule.COLUMNS, ...load().filter((o) => o.status === 'confirmed').flatMap(schedule.rowsForOrder)];
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="cad-schedule-2026-online-orders.csv"').send(schedule.toCsv(rows));
});
app.get('/api/admin/orders/:id/rows', admin, (req, res) => { const o = findOrder(req.params.id); res.json({ rows: o && o.status === 'confirmed' ? schedule.rowsForOrder(o) : [] }); });
app.post('/api/admin/orders/:id/email/:kind', admin, (req, res) => {
  const o = findOrder(req.params.id);
  if (!o || !email.TEMPLATES[req.params.kind]) return res.status(404).json({ error: 'not found' });
  const sent = email.send(req.params.kind, o, req.body || {});
  update(o.id, (x) => x.emails.push(sent));
  res.json(sent);
});

// Approve a rush / dedicated quote, set the final price, and write a payment-link email to outbox (not sent).
app.post('/api/admin/orders/:id/approve', admin, (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.status !== 'pending_approval') return res.status(400).json({ error: 'Only pending quote requests can be approved.' });
  // A date-review request (pencil-in, helper, Monday OC) is regular-rate priced: approving without a price confirms the shown total.
  const reviewOnly = !!(o.quote && o.quote.reviewOnly);
  const price = Number(req.body.price != null && req.body.price !== '' ? req.body.price : (reviewOnly ? o.quote.total : NaN));
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Enter an approved price greater than 0.' });
  // Re-check the held date(s) before the client gets a payment link: the hold may have expired while the team decided.
  if (o.review && o.review.needed && o.schedule && o.schedule.date && !o.rush && !o.dedicated) {
    const held = holdSlots(o, true);
    if (!held.ok) return res.status(409).json({ error: 'That date is no longer free (full or held). Pick another date with the client before approving.', full: held.full });
  }
  const low = o.quote.quoteRange && o.quote.quoteRange.low;
  const high = o.quote.quoteRange && o.quote.quoteRange.high;
  const updated = update(o.id, (ord) => {
    ord.quote = applyApprovedPrice(ord.quote, price, ord.service);
    ord.status = 'awaiting_payment';
    ord.approvedAt = new Date().toISOString();
    ord.approvedNote = req.body.note || '';
    if (low && high && (price < low || price > high)) {
      ord.approvedNote = [ord.approvedNote, `Price $${price} is outside the estimated range $${low}–$${high}.`].filter(Boolean).join(' ');
    }
  });
  const sent = email.send('quote_approved', findOrder(o.id));
  update(o.id, (x) => x.emails.push(sent));
  const pc = payerCopy(findOrder(o.id));
  if (pc) { const s2 = email.send('quote_approved', findOrder(o.id), pc); update(o.id, (x) => x.emails.push(s2)); }
  res.json({ order: findOrder(o.id), paymentUrl: email.payUrl(updated), email: sent });
});

app.get('/api/admin/date-guard', admin, (_, res) => res.json({ guard: require('./lib/sheet-days').snapshot(), holds: require('./lib/holds').snapshot(), sync: sheetSync.status() }));
app.post('/api/admin/date-guard/refresh', admin, async (_, res) => res.json(await require('./lib/sheet-days').refresh()));
app.use('/outbox', (req, res, next) => (adminKeyOk(req.query.key) ? next() : res.status(401).end()), express.static(storage.dir('outbox')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  // Bad JSON, too-large bodies and other client mistakes are a 4xx with a plain message, never a 500.
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) return res.status(400).json({ error: 'That request couldn’t be read. Please refresh the page and try again.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large. Please shorten the notes or remove photos and try again.' });
  console.error(err); res.status(500).json({ error: 'Something went wrong on our side. Please try again, or reach us through our Contact Us page at californiaartdelivery.com/pages/contact.' });
});
// Schedule-sheet hand-off: status (no personal data) and the start-up reconcile.
app.get('/api/sync-status', (_, res) => res.json({ ...sheetSync.status(), dayCheck: (({ fetchedAt, stale, error }) => ({ fetchedAt, stale, error }))(require('./lib/sheet-days').snapshot()) }));
sheetSync.start({
  orders: () => load(), find: (id) => findOrder(id),
  saved: (id, result) => { try { require('./lib/sheet-days').bump(findOrder(id)); } catch {} update(id, (x) => { x.scheduleStatus = 'saved'; x.scheduleSavedAt = new Date().toISOString(); x.scheduleRef = result; }); if (sheetSync.configured()) sendConfirmationEmails(id);
    try { const o = findOrder(id); if (o && !schedule.isTestOrder(o) && !(result && result.test)) teamAlert(`NEW ONLINE ORDER on the schedule: ${id}`, `Order ${id} was paid and its rows are saved on the ${(result && result.tab) || 'SCHEDULE 2026'} tab (first row ${(result && result.firstRow) || '?'}).\nClient: ${(o.contact || {}).name || ''} ${(o.contact || {}).phone || ''}\nDate(s): ${(o.schedule || {}).date || ''}${(o.schedule || {}).deliveryDate ? ' / delivery ' + o.schedule.deliveryDate : ''}\nService: ${o.serviceLabel || o.service}\nThe independent checker re-reads the rows every 30 minutes and alerts on any mismatch.`); } catch {}
  },
  exception: (id) => update(id, (x) => { x.scheduleStatus = 'exception'; }),
});
// Two-way reconciliation every 30 min: paid orders missing from the schedule tab, and schedule rows without an order.
setInterval(async () => { try { if (sheetSync.configured()) { const ids = load().filter((o) => o.status === 'confirmed' && !(o.payment && /^mock/.test(String(o.payment.method || '')))).map((o) => o.id); await sheetSync.call({ action: 'reconcile', orderIds: ids }); } } catch (e) { console.error('reconcile failed', e.message); } }, 30 * 60 * 1000).unref();
require('./lib/sheet-days').start();
app.listen(PORT, () => console.log(`CAD ordering prototype → ${BASE_URL}  (admin: ${ADMIN_ON ? BASE_URL + '/admin?key=<ADMIN_KEY>' : 'off'})`));
