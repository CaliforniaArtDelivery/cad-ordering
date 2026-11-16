const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { quote, isOutOfState, applyApprovedPrice, SERVICES, OFFERED_SERVICES, displayFrom, FURNITURE_KINDS, DECOR_KINDS } = require('./lib/pricing');
const sched = require('./lib/scheduling');
const schedule = require('./lib/schedule');
const email = require('./lib/email');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'cad-admin';   // prototype only
const storage = require('./lib/storage');
const { TYPES, framingErrors, itemLine, isHungItem, routeDecorMirror } = require('./lib/itemtypes');
const { lookupMember, resolveMember } = require('./lib/members');
const ACCESS = require('./public/access');
const ORDERS = path.join(storage.dir('data'), 'orders.json');
const CUSTOMERS = path.join(storage.dir('data'), 'customers.json');

// Stripe: TEST MODE ONLY. Live keys are refused in this prototype.
let stripe = null;
const key = process.env.STRIPE_SECRET_KEY || '';
if (key.startsWith('sk_test_')) stripe = require('stripe')(key);
else if (key) console.warn('STRIPE_SECRET_KEY is not a test key (sk_test_…). Refusing; using mock payments.');
console.log(stripe ? 'Payments: Stripe Checkout (TEST mode) — card + ACH' : 'Payments: MOCK (no STRIPE_SECRET_KEY) — card + ACH');

const load = () => (fs.existsSync(ORDERS) ? JSON.parse(fs.readFileSync(ORDERS, 'utf8')) : []);
const save = (orders) => fs.writeFileSync(ORDERS, JSON.stringify(orders, null, 2));
const findOrder = (id) => load().find((o) => o.id === id);
const update = (id, fn) => { const all = load(); const o = all.find((x) => x.id === id); if (!o) return null; fn(o); save(all); return o; };

const loadCustomers = () => (fs.existsSync(CUSTOMERS) ? JSON.parse(fs.readFileSync(CUSTOMERS, 'utf8')) : {});
const saveCustomers = (c) => fs.writeFileSync(CUSTOMERS, JSON.stringify(c, null, 2));

const app = express();
app.use(express.json({ limit: '2mb' }));
// Access answers (ground / steps / stairs / elevator) are mapped onto the legacy stair fields before pricing or booking.
app.use((req, _res, next) => {
  const b = req.body;
  if (b && typeof b === 'object') ['pickup', 'dropoff'].forEach((k) => { if (b[k] && typeof b[k] === 'object') ACCESS.normalize(b[k]); });
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
  company: config.company, services: OFFERED_SERVICES, timePrefs: config.scheduling.timePrefs,
  payment: config.payment,
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
    membershipMonthly: config.pricing.membership.monthly,
  },
  stripe: !!stripe, notice: config.pricing.exampleRatesNotice,
}));
app.post('/api/upload', upload.array('photos', 10), (req, res) => res.json({ files: (req.files || []).map((f) => `/uploads/${f.filename}`) }));
app.post('/api/quote', (req, res) => res.json(quote(req.body)));
app.post('/api/member-code', (req, res) => {
  const hit = lookupMember(req.body && req.body.code);
  if (!hit) return res.json({ valid: false });
  res.json({ valid: true, company: hit.company, code: hit.code });
});
app.post('/api/availability', (req, res) => {
  const o = req.body;
  const svc = SERVICES[o.service] || SERVICES.pickup_delivery;
  // leg=dropoff: delivery dates for the delivery address, on or after the pickup date (same day allowed).
  if (o.leg === 'dropoff' && o.dropoff && o.schedule && o.schedule.date) {
    const from = new Date(o.schedule.date + 'T12:00:00Z');
    return res.json({ region: sched.regionFor(o.dropoff), zone: sched.zoneFor(o.dropoff), days: sched.availableDays(o.dropoff, { from, count: config.scheduling.showDays, order: o, leadTime: 0 }), rush: [] });
  }
  const first = svc.needsPickup ? o.pickup : o.dropoff;
  const addr = first && (first.zip || first.city) ? first : o.dropoff;
  const region = sched.regionFor(addr);
  const zone = sched.zoneFor(addr);
  res.json({
    region, zone,
    days: sched.availableDays(addr, { order: o }),
    rush: config.scheduling.rushEnabled ? sched.rushDays(addr, new Date(), 7, o) : [],
  });
});

function validate(o) {
  const errs = [];
  if (!SERVICES[o.service] || SERVICES[o.service].legacy) errs.push('service');
  if (!o.items || !o.items.length || o.items.some((it) => !String(it.description || '').trim())) errs.push('items');
  if ((o.items || []).some((it) => !TYPES[it.type || 'painting'])) errs.push('item type');
  if (framingErrors(o.items || [])) errs.push('Framed? (and Glass? / Frame type when they apply) for paintings, photographs and other wall art');
  const siteContact = (a) => a && String(a.contactName || '').trim() && String(a.contactPhone || '').trim();
  if (SERVICES[o.service]?.needsPickup) {
    if (!o.pickup?.street) errs.push('pickup');
    if (!siteContact(o.pickup)) errs.push('pickup contact');
  }
  if (SERVICES[o.service]?.needsDropoff) {
    if (!o.dropoff?.street) errs.push('dropoff');
    if (!siteContact(o.dropoff)) errs.push('dropoff contact');
  }
  // Access (Chad): "How do we get in?" is required at every stop, plus the follow-ups and photos it triggers.
  const ACCESS_ERR = {
    accessMode: 'access (how do we get in?)', stairFlights: 'number of flights', stairs: 'number of flights (4 or more)', stairDir: 'stairs up or down',
    stairTurns: 'tight turns on the stairs', stairPhotos: 'photos of the stairs and path', floor: 'elevator floor',
    fits: 'will everything fit easily', doorPhotos: 'photos of the doorway',
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
  // Photo rules: required for items over 500 lb and 'other' items and special-handling pieces. Technical carries and high installs are below.
  const numVal = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const needsPhoto = (it) => numVal(it.weight) > 500 || it.type === 'other' || !!it.fragile;
  if ((o.items || []).some((it) => needsPhoto(it) && !(it.photos || []).length)) errs.push('photos (items over 500 lb or unusual pieces or special handling)');
  if (SERVICES[o.service]?.install) {
    (o.items || []).forEach((it) => {
      if (isHungItem(it) && it.hangHeight === 'higher' && it.hangWhere === 'stairwell' && !((it.hangPhotos || []).length)) errs.push('photos of the stairwell');
    });
  }
  const ship = SERVICES[o.service]?.shipping || isOutOfState(o);
  if (ship) {
    // Samantha prices shipping without follow-up, so collect what she needs.
    if (!String(o.dropoff?.country || 'United States').trim()) errs.push('destination country');
    if ((o.items || []).some((it) => (!(it.weightUnsure || numVal(it.weight) > 0) || !(['custom', 'furniture'].includes(it.type) || ['w', 'h', 'd'].every((k) => Number(it[k]) > 0))))) errs.push('piece dimensions and weight');
    if ((o.items || []).some((it) => !(numVal(it.value) > 0))) errs.push('declared value for every piece (for the shipping insurance)');
    if (!o.shipping?.serviceLevel) errs.push('destination service level');
    if (!o.shipping?.shipBy && !o.shipping?.flexible) errs.push('ship date or flexibility');
  } else {
    if (!o.schedule?.date) errs.push('schedule');
    // In-California white-glove jobs: every piece needs a declared value (protection / high-value handling depend on it).
    if ((o.items || []).some((it) => it.type !== 'custom' && !(numVal(it.value) > 0))) errs.push('declared value for every piece');
    const twoDates = SERVICES[o.service]?.needsPickup && SERVICES[o.service]?.needsDropoff;
    if (twoDates && (!o.schedule?.deliveryDate || o.schedule.deliveryDate < o.schedule.date)) errs.push('delivery date');
  }
  return errs;
}

app.post('/api/orders', (req, res) => {
  const b = req.body;
  const errs = validate(b);
  if (errs.length) return res.status(400).json({ error: 'Missing: ' + errs.join(', ') });
  const special = quote(b).paymentPlan === 'quote'; // rush, dedicated, crating, shipping, or anything the rate cards don't cover
  const outOfState = !SERVICES[b.service].shipping && isOutOfState(b);
  const shipping = !!SERVICES[b.service].shipping || outOfState;
  const svcKey = shipping ? 'crating_shipping' : b.service;
  const order = {
    id: 'CAD-' + Date.now().toString(36).toUpperCase().slice(-6),
    createdAt: new Date().toISOString(),
    status: special ? 'pending_approval' : 'awaiting_payment',
    service: svcKey, serviceLabel: SERVICES[svcKey].label,
    ...(outOfState ? { requestedService: b.service, outOfState: true } : {}),
    ...(shipping ? { shipping: b.shipping || {} } : {}),
    crating: !!b.crating, rush: !!b.rush, dedicated: !!b.dedicated,
    member: !!resolveMember(b),
    memberCode: (resolveMember(b) || {}).code || '',
    memberCompany: (resolveMember(b) || {}).company || '',
    heard: b.heard || {},
    referral: !!b.referral,
    // In-CA: mandatory on pieces valued $50K or less (none offered above). Shipping quotes: the customer's choice.
    declaredValueProtection: shipping ? false : (b.items || []).some((it) => Number(it.value) > 0 && Number(it.value) <= 50000),
    items: (b.items || []).map(routeDecorMirror), pickup: b.pickup || {}, dropoff: b.dropoff || {},
    contact: b.contact, partner: b.partner || {}, payer: b.payer || 'me', payerOther: b.payerOther || {},
    schedule: shipping
      ? { date: '', region: 'Shipping', deliveryLater: false, deliveryDate: '', timePref: 'none', timeNote: '', deliveryTimePref: 'none', deliveryTimeNote: '' }
      : { ...b.schedule, region: sched.regionForDate(new Date(b.schedule.date + 'T12:00:00Z')) },
    notes: b.notes || '',
    emails: [],
  };
  order.quote = quote(order);  // server-side price is authoritative
  const all = load(); all.unshift(order); save(all);
  if (special) {
    const sent = email.send('quote_received', order);
    update(order.id, (x) => x.emails.push(sent));
  }
  res.json({ id: order.id, quote: order.quote, status: order.status, order: findOrder(order.id) });
});

app.get('/api/orders/:id', (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json({ order: o });
});

function finalize(id, payment) {
  const o = update(id, (ord) => { if (ord.status === 'confirmed') return; ord.status = 'confirmed'; ord.payment = payment; });
  if (!o) return null;
  if (!o.emails.find((e) => e.kind === 'confirmation')) {
    const sent = email.send('confirmation', o);
    update(id, (x) => x.emails.push(sent));
    schedule.appendOrder(findOrder(id));
  }
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
  if (o.status === 'confirmed') return res.json({ order: o });
  if (o.quote.paymentPlan === 'quote' || !o.quote.dueNow) return res.status(400).json({ error: 'No amount is due until CAD approves a price.' });

  const method = req.body.method;
  if (method === 'invoice') return res.status(400).json({ error: 'There are no trade accounts. Payment is due up front by card or bank transfer.' });

  const saveMethod = !!(req.body.save && config.payment.savePaymentMethod);

  if (stripe) {
    const { customerId } = await stripeCustomerFor(o, saveMethod);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(customerId
        ? { customer: customerId, customer_update: { name: 'auto', address: 'auto' } }
        : { customer_email: o.contact.email }),
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: {
        us_bank_account: { financial_connections: { permissions: ['payment_method'] } },
      },
      ...(saveMethod ? { payment_intent_data: { setup_future_usage: 'off_session' } } : {}),
      line_items: [{ quantity: 1, price_data: { currency: config.pricing.currency, unit_amount: Math.round(o.quote.dueNow * 100), product_data: { name: `${config.company.name}: ${o.serviceLabel}`, description: `Order ${o.id}` } } }],
      metadata: { orderId: o.id, saveMethod: saveMethod ? '1' : '0' },
      success_url: `${BASE_URL}/?order=${o.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?order=${o.id}&canceled=1`,
    });
    update(o.id, (x) => { x.savePaymentMethod = saveMethod; if (customerId) x.stripeCustomerId = customerId; });
    return res.json({ redirect: session.url });
  }

  // MOCK payment (no Stripe key): card or ACH test details.
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

// Return from Stripe Checkout
app.get('/api/orders/:id/verify', async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.status === 'confirmed') return res.json({ order: o });
  if (stripe && req.query.session_id) {
    const s = await stripe.checkout.sessions.retrieve(req.query.session_id);
    // Confirm the job on submission, including ACH that is still processing / has not cleared (Chad, Nov 14 2026).
    if ((s.payment_status === 'paid' || s.payment_status === 'processing') && s.metadata.orderId === o.id) {
      const pm = s.payment_method_types && s.payment_method_types[0];
      const method = s.payment_status === 'processing' || pm === 'us_bank_account' ? 'stripe_ach' : 'stripe_card';
      const payment = {
        method,
        // job is confirmed now; ACH money is labeled as processing until the bank clears it
        status: (s.payment_status === 'processing' || pm === 'us_bank_account') ? 'ach_processing' : 'paid',
        achPending: s.payment_status === 'processing' || pm === 'us_bank_account',
        amount: (s.amount_total || 0) / 100, ref: s.id,
        saved: s.metadata.saveMethod === '1',
      };
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

// ---------- Admin (prototype: simple shared key) ----------
const admin = (req, res, next) => ((req.query.key || req.get('x-admin-key')) === ADMIN_KEY ? next() : res.status(401).json({ error: 'admin key required' }));
app.get('/api/admin/orders', admin, (_, res) => res.json({ orders: load().map((o) => ({ ...o, itemLines: (o.items || []).map(itemLine), ...(o.service === 'crating_shipping' ? { shippingLines: require('./lib/shiptext').lines(o) } : {}) })), columns: schedule.COLUMNS, letters: schedule.LETTERS }));
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
  const price = Number(req.body.price);
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Enter a final price greater than 0.' });
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
  res.json({ order: findOrder(o.id), paymentUrl: email.payUrl(updated), email: sent });
});

app.use('/outbox', (req, res, next) => (req.query.key === ADMIN_KEY ? next() : res.status(401).end()), express.static(storage.dir('outbox')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });
app.listen(PORT, () => console.log(`CAD ordering prototype → ${BASE_URL}  (admin: ${BASE_URL}/admin?key=${ADMIN_KEY})`));
