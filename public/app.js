/* CAD online ordering — vanilla JS, no build step. 4 steps: What → Where → When → Review & pay. */
// Never let the browser restore an old scroll position on load/back; every step starts at the very top.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const STEPS = ['What', 'Where', 'When', 'Pay', 'Done'];
const STEP_TITLES = { What: 'What', Where: 'Where', When: 'When', Pay: 'Review & pay' };

const emptyAddr = () => ({
  street: '', city: '', state: 'CA', zip: '', country: 'United States', locationType: '', business: '',
  contactName: '', contactPhone: '', sameAsMe: false, hours: '',
  floor: '', loadingDock: false, elevator: false, stairs: 0, steps: false,
  fits: '', parkingRestricted: false, parkingNote: '', technicalCarry: false, sitePhotos: [],
  centerHeight: '', wallType: '', hardware: '', highInstall: false, wallPhotos: [],
  notes: '',
});
const migrateAddr = (a = {}) => {
  const extras = [
    a.loadingDockNotes, a.parkingNotes,
    a.parking && !['Street parking', 'Not sure', 'Loading dock', ''].includes(a.parking) ? a.parking : '',
    a.coiRequired && (a.coiDetails ? `COI: ${a.coiDetails}` : 'COI required'),
    a.notes,
  ].filter(Boolean);
  return {
    ...emptyAddr(),
    street: a.street || '', city: a.city || '', state: a.state || 'CA', zip: a.zip || '', country: a.country || 'United States', locationType: a.locationType || '', business: a.business || '',
    contactName: a.contactName || '', contactPhone: a.contactPhone || '', sameAsMe: !!a.sameAsMe, hours: a.hours || '',
    floor: a.floor || '', loadingDock: !!(a.loadingDock || a.parking === 'Loading dock'), elevator: !!a.elevator,
    stairs: Number(a.stairs) || 0, steps: !!a.steps,
    fits: a.fits || '', parkingRestricted: !!a.parkingRestricted, parkingNote: a.parkingNote || '',
    technicalCarry: !!a.technicalCarry, sitePhotos: a.sitePhotos || [],
    centerHeight: a.centerHeight || '', wallType: a.wallType || '', hardware: a.hardware || '', highInstall: !!a.highInstall, wallPhotos: a.wallPhotos || [],
    notes: extras.join(' · '),
  };
};
const emptyItem = () => ({ qty: 1, type: 'painting', furnitureKind: 'Sofa', sizeClass: 'medium', description: '', w: '', h: '', d: '', weight: '', framed: '', glazing: '', framedGlass: false, fragile: false, crateStatus: 'not_sure', value: '', photos: [] });

let CFG = null;
let step = 0;
const fresh = () => ({
  service: '', crating: false, rush: false, dedicated: false, member: false, declaredValueProtection: false,
  items: [emptyItem()], pickup: emptyAddr(), dropoff: emptyAddr(),
  contact: { name: '', email: '', phone: '', company: '', clientType: 'Collector' },
  referral: false, partner: { type: 'None', name: '', email: '' }, payer: 'me', payerOther: { name: '', email: '' },
  schedule: { date: '', window: '', deliveryLater: false, deliveryDate: '' }, notes: '',
  shipping: { serviceLevel: '', shipBy: '', arriveBy: '', flexible: false, customs: { name: '', phone: '', email: '' } },
});
const S = Object.assign(fresh(), JSON.parse(sessionStorage.getItem('cad-order') || 'null') || {});
S.items = (S.items && S.items.length ? S.items : [emptyItem()]).map((it) => ({ ...emptyItem(), ...it }));
S.pickup = migrateAddr(S.pickup);
S.dropoff = migrateAddr(S.dropoff);
S.contact = { ...fresh().contact, ...(S.contact || {}) };
S.partner = { ...fresh().partner, ...(S.partner || {}) };
S.payerOther = { ...fresh().payerOther, ...(S.payerOther || {}) };
S.schedule = { ...fresh().schedule, ...(S.schedule || {}) };
S.shipping = { ...fresh().shipping, ...(S.shipping || {}), customs: { ...fresh().shipping.customs, ...((S.shipping && S.shipping.customs) || {}) } };

let orderId = null, orderSig = null;   // order created at the moment of payment
let existing = null;                    // an order opened from a payment link (?order=…)
let quoteData = null, avail = null, confirmed = null, delAvail = null;
let payMethod = 'card';
let saveMethod = false;
let busy = false;

const persist = () => sessionStorage.setItem('cad-order', JSON.stringify(S));
// What actually gets priced / booked: drop fields that don't apply to the chosen service.
const payload = () => {
  const o = JSON.parse(JSON.stringify(S));
  const sv = (CFG && CFG.services[o.service]) || {};
  const clearInstall = (a) => { a.centerHeight = ''; a.wallType = ''; a.hardware = ''; a.highInstall = false; a.wallPhotos = []; };
  clearInstall(o.pickup);
  if (sv.install && o.items.some(isHung)) { if (!o.dropoff.centerHeight) o.dropoff.centerHeight = '57'; if (!o.dropoff.wallType) o.dropoff.wallType = 'Not sure'; if (!o.dropoff.hardware) o.dropoff.hardware = 'Not sure'; } else clearInstall(o.dropoff);
  if (!sv.needsPickup) { o.pickup = { street: '' }; o.schedule.deliveryLater = false; }
  if (crossRegion()) o.schedule.deliveryLater = false;
  if (!o.schedule.deliveryLater) o.schedule.deliveryDate = '';
  if (!o.dropoff.parkingRestricted) o.dropoff.parkingNote = '';
  if (!o.pickup.parkingRestricted) o.pickup.parkingNote = '';
  ['pickup', 'dropoff'].forEach((k) => { if (o[k] && !o[k].technicalCarry) o[k].sitePhotos = []; });
  if (intlDest(o.dropoff)) o.dropoff.state = '';
  if (isShipState()) { o.schedule = { date: '', window: '', deliveryLater: false, deliveryDate: '' }; o.rush = false; o.dedicated = false; o.crating = false; clearInstall(o.dropoff); if (!intlDest(o.dropoff)) o.shipping.customs = { name: '', phone: '', email: '' }; }
  else delete o.shipping;
  o.items.forEach((it) => { if (!FRAMING_TYPES.includes(it.type)) { it.framed = ''; it.glazing = ''; } else if (it.framed !== 'yes') it.glazing = ''; delete it.framedGlass; });
  if (!o.referral) { o.partner = { type: 'None', name: '', email: '' }; if (o.payer === 'partner') o.payer = 'me'; }
  return o;
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const svc = () => (CFG && CFG.services[S.service]) || {};
// Out-of-state rule (mirrors lib/geo.js): any pickup or delivery outside California is a Shipping custom quote.
const US_RX = /^(us|u\.s\.a?\.?|usa|united states( of america)?|america)$/i;
const intlDest = (a) => !!(a && a.country && String(a.country).trim() && !US_RX.test(String(a.country).trim()));
const outsideCA = (a) => {
  if (!a) return false;
  if (intlDest(a)) return true;
  const st = String(a.state || '').trim() || (String(a.city || '').match(/,\s*([A-Za-z]{2})\s*$/) || [])[1] || '';
  if (st && !/^(ca|calif\.?|california)$/i.test(st)) return true;
  const z = String(a.zip || '').match(/\b\d{5}\b/);
  if (z) { const n = parseInt(z[0].slice(0, 3), 10); if (n < 900 || n > 961) return true; }
  return false;
};
const shipService = () => !!svc().shipping;
const outOfState = () => !shipService() && !!S.service && ((svc().needsPickup && outsideCA(S.pickup)) || outsideCA(S.dropoff));
const isShipState = () => shipService() || outOfState();
const isShip = isShipState;
const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; persist(); };
const isQuote = (q) => !!(q && q.paymentPlan === 'quote');
const special = () => !!(isShip() || S.rush || S.dedicated || S.crating || isQuote(quoteData));
const hasInstall = () => !!svc().install;
// Only wall-hung pieces get hung. Sculpture, furniture and freestanding pieces are placed (never hung or installed).
const HUNG_DECOR = ['Wall Decor', 'Mirror', 'Chandelier'];
// Wall pieces: Painting, Mirror, Other wall art (incl. wall sculpture) hang on a wall, so they're installable.
const WALL_TYPES = ['painting', 'mirror', 'wallart'];
const FRAMING_TYPES = ['painting', 'wallart'];
const isHung = (it) => WALL_TYPES.includes(it.type || 'painting') || (it.type === 'decor' && HUNG_DECOR.includes(it.furnitureKind));
const framingOk = (it) => !FRAMING_TYPES.includes(it.type || 'painting') || it.framed === 'no' || (it.framed === 'yes' && ['yes', 'no'].includes(it.glazing));
const TYPE_LABEL = (t) => (ITEM_TYPES.find(([v]) => v === (t || 'painting')) || [, t])[1];
const framingText = (it) => (it.type === 'mirror' ? 'Glass (mirror)' : !FRAMING_TYPES.includes(it.type || 'painting') ? '' : it.framed === 'yes' ? `Framed · ${it.glazing === 'yes' ? 'glass/acrylic glazing' : 'no glazing'}` : it.framed === 'no' ? 'Unframed' : '');
const hasHanging = () => hasInstall() && S.items.some(isHung);
const isPlaced = (it) => !isHung(it);
const longDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '');
const shortDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const windowText = (w) => (w || '').replace('Flexible / all day', 'flexible, all day');
const api = async (url, body) => {
  try {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  } catch (e) {
    return { ok: false, net: true, j: { error: 'Connection hiccup. Please try again.' } };
  }
};

// Step-1 service icons (v2). 24px grid, 1.5px stroke, round caps/joins; drawn at 30px in the 44px tile.
// Composed parts are scaled with <g transform>; their stroke-width is divided by the scale so every line renders at the same 1.5px weight.
// The plane and truck paths are adapted from Lucide (lucide.dev, "plane" and "truck"), ISC License,
// Copyright (c) Lucide Contributors 2022; portions Copyright (c) 2013-2022 Cole Bemis (Feather, MIT). Van, painting and gloves are original.
const iconSvg = (label, body) => `<svg viewBox="0 0 24 24" role="img" aria-label="${label}" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><title>${label}</title>${body}</svg>`;
const ICONS = {
  // Sprinter-style high-roof van in profile: aero roof cap, sloped windshield, short hood, cab window.
  pickup_delivery: iconSvg("Mercedes Sprinter-style high-roof van", '<circle cx="6.5" cy="17.5" r="1.9"/><circle cx="17.5" cy="17.5" r="1.9"/><path d="M8.8 17.5h6.4"/><path d="M4.2 17.5H2.3a.8.8 0 0 1-.8-.8V7A2 2 0 0 1 3.5 5h10.7c1.2 0 2 .4 2.6 1.3l2.6 3.9c.3.5.8.8 1.3.9l.4.1c.9.2 1.9 1.1 1.9 2.1v3.4a.8.8 0 0 1-.8.8h-1.4"/><path d="M12.5 7.2h2.3c.4 0 .7.2.9.5l1.9 2.8h-5.1z"/>'),
  // The van plus the exact same framed painting used by Install only, separated diagonally so they never touch.
  delivery_install: iconSvg("Van and framed painting", '<g transform="translate(0.2 9.6) scale(0.66)" stroke-width="2.273"><circle cx="6.5" cy="17.5" r="1.9"/><circle cx="17.5" cy="17.5" r="1.9"/><path d="M8.8 17.5h6.4"/><path d="M4.2 17.5H2.3a.8.8 0 0 1-.8-.8V7A2 2 0 0 1 3.5 5h10.7c1.2 0 2 .4 2.6 1.3l2.6 3.9c.3.5.8.8 1.3.9l.4.1c.9.2 1.9 1.1 1.9 2.1v3.4a.8.8 0 0 1-.8.8h-1.4"/><path d="M12.5 7.2h2.3c.4 0 .7.2.9.5l1.9 2.8h-5.1z"/></g><g transform="translate(11.2 -1.2) scale(0.58)" stroke-width="2.586"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="m4 16.5 4.5-4.5 7 7"/><path d="m13 14.5 2.5-2.5 4.5 4.5"/><circle cx="15.5" cy="9.5" r="1.4"/></g>'),
  // Framed painting (single frame + landscape) with two white-glove mitts just outside its bottom corners, never overlapping it.
  install_only: iconSvg("Framed painting with two white-gloved hands", '<g transform="translate(3 -1.25) scale(0.75)" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="m4 16.5 4.5-4.5 7 7"/><path d="m13 14.5 2.5-2.5 4.5 4.5"/><circle cx="15.5" cy="9.5" r="1.4"/></g><g transform="translate(-0.36 14.8) scale(0.85)" stroke-width="1.765"><g transform="rotate(8 3.5 8)"><path d="M1.6 7.4V2.4a1.6 1.6 0 0 1 3.2 0v2.2l.9-.9a1 1 0 0 1 1.45 1.4L4.8 7.4z"/><path d="M1.4 9.2h3.6"/></g></g><g transform="translate(24.36 14.8) scale(0.85)" stroke-width="1.765"><g transform="scale(-1 1) rotate(8 3.5 8)"><path d="M1.6 7.4V2.4a1.6 1.6 0 0 1 3.2 0v2.2l.9-.9a1 1 0 0 1 1.45 1.4L4.8 7.4z"/><path d="M1.4 9.2h3.6"/></g></g>'),
  // Plane (top-left) and truck (bottom-right), both adapted from Lucide.
  crating_shipping: iconSvg("Airplane and truck, air or ground shipping", '<g transform="translate(0.4 0.4) scale(0.58)" stroke-width="2.586"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></g><g transform="translate(10.6 10.4) scale(0.55)" stroke-width="2.727"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></g>'),
};

const DESC = {
  pickup_delivery: 'White-glove pickup and delivery for fine art, sculpture, luxury furniture, décor and antiques, placed exactly where you want it.',
  delivery_install: 'Everything above, plus expert installation of paintings, mirrors and wall décor.',
  install_only: 'Already on site. We hang paintings, mirrors and wall décor.',
  crating_shipping: 'Out-of-state shipping by air or ground. Within California we always provide white-glove delivery.',
};
const ITEM_TYPES = [['painting', 'Painting'], ['mirror', 'Mirror'], ['wallart', 'Other wall art'], ['sculpture', 'Sculpture'], ['furniture', 'Furniture'], ['decor', 'Décor'], ['other', 'Other fragile or valuable item'], ['custom', 'Other request']];
const INSTALL_TYPES = ['painting', 'mirror', 'wallart', 'decor', 'custom'];
// Install only = hanging wall pieces already on site. Sculpture, furniture and other pieces are placed during a delivery, not hung.
const itemTypes = () => (S.service === 'install_only' ? ITEM_TYPES.filter(([v]) => INSTALL_TYPES.includes(v)) : ITEM_TYPES);
const decorKinds = () => (S.service === 'install_only' ? (CFG.pricing.decorKinds || []).filter((k) => HUNG_DECOR.includes(k)) : (CFG.pricing.decorKinds || []));

// ---------- field helpers ----------
const input = (path, label, opts = {}) => `<div class="field">${label ? `<label class="f" for="f-${path}">${label}${opts.req ? ' <span class="req">Required</span>' : ''}</label>` : ''}
  <input id="f-${path}" type="${opts.type || 'text'}" data-path="${path}" value="${esc(get(path))}" placeholder="${esc(opts.ph || '')}" ${opts.attrs || ''}></div>`;
const select = (path, label, options) => `<div class="field"><label class="f" for="f-${path}">${label}</label><select id="f-${path}" data-path="${path}">${options.map((o) => `<option ${get(path) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
const toggle = (path, label, hint = '', rerender = false, cls = '') => `<label class="toggle ${cls}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
  <span class="sw"><input type="checkbox" data-path="${path}" ${get(path) ? 'checked' : ''} ${rerender ? 'data-rerender' : ''}><i></i></span></label>`;
const seg = (path, options) => `<div class="seg" data-seg="${path}">${options.map(([v, l]) => `<button type="button" class="${String(get(path)) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;

const stairsText = (a) => {
  const n = Number(a.stairs) || 0;
  if (n > 0) return `${n >= 4 ? '4+' : n} flight${n === 1 ? '' : 's'} of stairs`;
  if (a.steps) return 'A few steps';
  return '';
};
const accessText = (a) => {
  const bits = [];
  if (a.floor) bits.push(`Floor ${esc(a.floor)}`);
  if (a.elevator) bits.push('Elevator');
  const st = stairsText(a);
  if (st) bits.push(a.elevator ? st : `${st}, no elevator`);
  if (!a.elevator && !st) bits.push('Ground level, no elevator');
  if (a.loadingDock) bits.push('Loading dock');
  if (a.fits === 'not_sure') bits.push('May not fit through doors');
  return bits.join(' · ');
};

// ---------- pricing blocks ----------
const payPlan = (q) => {
  if (isQuote(q)) {
    return `<div class="plan"><div class="plan-head">Quote request · no payment due yet</div>
      <div class="sum-row"><span>Regular rate</span><span>${fmt(q.regularTotal || q.total)}</span></div>
      ${q.tripPremium === false ? '' : `<div class="sum-row"><span>Quoted range (1.5×–2×)</span><span><b>${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}</b></span></div>`}
      ${q.crating ? '<div class="sum-row"><span>Custom crating</span><span>Quoted by CAD</span></div>' : ''}
      ${q.extraQuoted ? `<div class="sum-row"><span>${esc(q.extraQuoted)}</span><span>Quoted by CAD</span></div>` : ''}
      <p class="mini" style="margin:4px 0 10px">${esc(q.quoteNote || 'CAD sets a final price in this range. Nothing is charged until you approve it and pay.')}</p></div>`;
  }
  if (q.paymentPlan === 'deposit') {
    return `<div class="plan"><div class="plan-head">Orders of ${fmt(CFG.payment.depositThreshold)}+ are split 50/50</div>
      <div class="sum-row"><span>Due today</span><span><b>${fmt(q.dueNow)}</b></span></div>
      <div class="sum-row"><span>Balance due ${esc(q.balanceWhen)}</span><span><b>${fmt(q.balanceDue)}</b></span></div></div>`;
  }
  return `<div class="plan"><div class="sum-row"><span>Due today · paid in full at booking</span><span><b>${fmt(q.dueNow)}</b></span></div></div>`;
};
const priceCard = (q, withProtection) => `<div class="card">
  ${q ? q.lines.map((l) => `<div class="sum-row"><span>${esc(l.label)}</span><span>${l.included ? 'Included' : fmt(l.amount)}</span></div>`).join('') : '<div class="sum-row"><span>Calculating…</span><span></span></div>'}
  ${withProtection ? '<p class="mini" style="margin:6px 0 0">Declared value protection (1.5%) is included on every piece valued $50,000 or less. Pieces over $50,000 carry high-value handling instead.</p>' : ''}
  ${q ? `<div class="total"><span>${isQuote(q) ? 'Regular rate' : 'Total'}</span><span>${fmt(q.regularTotal || q.total)}</span></div>${payPlan(q)}` : ''}
</div>`;

// ---------- payment block (shared by new orders and payment links) ----------
const paymentBlock = (q) => {
  const saveToggle = CFG.payment.savePaymentMethod ? toggleRaw('saveMethod', saveMethod, 'Save for next time', 'Keep this card or bank account on file so your next booking is one tap.') : '';
  if (CFG.stripe) {
    return `<div class="card"><span class="badge">Stripe test mode</span>
      <p class="mini" style="margin:0 0 12px">You’ll pay on Stripe’s secure page: Apple Pay, Google Pay, card or bank (ACH).</p>${saveToggle}<div class="err" id="err"></div></div>`;
  }
  const fields = payMethod === 'ach'
    ? `<div class="row"><div class="field"><label class="f" for="routing">Routing number</label><input type="text" id="routing" value="110000000" inputmode="numeric" autocomplete="off"></div><div class="field"><label class="f" for="account">Account number</label><input type="text" id="account" value="000123456789" inputmode="numeric" autocomplete="off"></div></div>
       <p class="mini" style="margin:0 0 12px">Your job is confirmed the moment you submit. The bank transfer shows as “ACH processing” until it clears, usually a few business days.</p>`
    : `<div class="field"><label class="f" for="card">Card number</label><input type="text" id="card" class="cardnum" value="4242 4242 4242 4242" inputmode="numeric" autocomplete="cc-number"></div>
       <div class="row keep"><div class="field"><label class="f" for="exp">Expiry</label><input type="text" id="exp" value="12 / 30" inputmode="numeric"></div><div class="field"><label class="f" for="cvc">CVC</label><input type="text" id="cvc" value="123" inputmode="numeric"></div></div>`;
  return `<div class="card"><span class="badge">Test mode · nothing is charged</span>
    <div class="wallets">
      <button type="button" class="wallet apple" data-wallet="apple_pay" aria-label="Pay with Apple Pay"><span aria-hidden="true"></span> Pay</button>
      <button type="button" class="wallet gpay" data-wallet="google_pay" aria-label="Pay with Google Pay"><span class="g">G</span> Pay</button>
    </div>
    <div class="or">or pay with</div>
    <div class="field">${'<div class="seg" data-pay-method>'}
      <button type="button" class="${payMethod === 'card' ? 'on' : ''}" data-v="card">Card</button>
      <button type="button" class="${payMethod === 'ach' ? 'on' : ''}" data-v="ach">Bank (ACH)</button></div></div>
    ${fields}${saveToggle}<div class="err" id="err"></div></div>`;
};
const toggleRaw = (id, on, label, hint) => `<label class="toggle"><span>${label}<small>${hint}</small></span><span class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></span></label>`;

// ---------- schedule helpers ----------
const crossRegion = () => !!(quoteData && quoteData.regions && quoteData.regions.pickup && quoteData.regions.dropoff && quoteData.regions.pickup !== quoteData.regions.dropoff);
const laterOn = () => !!(svc().needsPickup && S.schedule.deliveryLater && !crossRegion());
const promiseCard = (sub, extraStyle = '') => {
  const sp = special();
  const later = laterOn() && S.schedule.deliveryDate;
  const title = later
    ? `Pickup ${esc(shortDate(S.schedule.date))} · Delivery ${esc(shortDate(S.schedule.deliveryDate))}`
    : `${esc(longDate(S.schedule.date))}, ${esc(windowText(S.schedule.window))}`;
  const line = sp ? (S.rush || S.dedicated ? 'Preferred date · confirmed with your quote' : 'Your date · price confirmed with your quote')
    : later ? `${esc(windowText(S.schedule.window))} arrival window` : esc(sub);
  return `<div class="promise ${sp ? 'quote' : ''}" style="${extraStyle}"><span class="pi">${sp ? '⏱' : '✓'}</span><span><b>${title}</b><span>${line}</span></span></div>`;
};
function laterBlock() {
  if (!svc().needsPickup) return '';
  if (crossRegion()) return `<p class="note">Pickup and delivery are in different regions, so delivery goes on the next ${esc(quoteData.regions.dropoff)} route day (usually 1–2 weeks). We’ll confirm the delivery date.</p>`;
  const card = (d) => { const [w, m, n] = d.label.replace(',', '').split(' '); return `<button type="button" class="day ${S.schedule.deliveryDate === d.date ? 'on' : ''}" data-deldate="${d.date}"><div class="dw">${w}</div><div class="dd">${m} ${n}</div><div class="rg">${esc(d.shortLabel || d.routeLabel || d.region)}</div></button>`; };
  return `<div class="card" style="margin-top:14px">${toggle('schedule.deliveryLater', 'Deliver on a later date', 'Pickup on the day above, delivery on a later route day (a separate stop).', true, 'first')}
    ${S.schedule.deliveryLater ? (!S.schedule.date ? '<p class="mini">Pick the pickup day first.</p>' : !delAvail ? '<p class="mini">Finding delivery days…</p>' : `<label class="f" style="margin-top:10px">Delivery day</label><div class="days">${delAvail.days.map(card).join('')}</div>`) : ''}</div>`;
}
async function loadDelivery() {
  delAvail = null;
  if (!laterOn() || !S.schedule.date) return;
  const { ok, j } = await api('/api/availability', { ...payload(), leg: 'dropoff' });
  if (!ok) return;
  delAvail = j;
  if (S.schedule.deliveryDate && !j.days.some((d) => d.date === S.schedule.deliveryDate)) { S.schedule.deliveryDate = ''; persist(); }
  if (STEPS[step] === 'When') render();
}

// ---------- photo rules (Chad): optional unless the job needs eyes on it first ----------
const HEAVY_LB = 300;
const itemPhotoReason = (it) => (Number(it.weight) >= HEAVY_LB ? `Photos required: pieces ${HEAVY_LB} lb or heavier.`
  : it.type === 'other' ? 'Photos required: out-of-the-ordinary items.'
  : it.fragile ? 'Photos required: uniquely fragile pieces.' : '');
const photosOk = (it) => !itemPhotoReason(it) || (it.photos || []).length > 0;
const sitePhotosOk = (a) => (!a.technicalCarry || (a.sitePhotos || []).length > 0);
const wallPhotosOk = (a) => (!a.highInstall || !hasHanging() || isShip() || (a.wallPhotos || []).length > 0);
const valueHint = (it) => (shipService() ? '' : Number(it.value) > 50000 ? 'Over $50,000: high-value handling applies and declared value protection isn’t offered. Please use your own fine art insurance.'
  : Number(it.value) > 0 ? 'Declared value protection (1.5%) is included.' : '');
function updateItemHints(i) {
  const it = S.items[i]; if (!it) return;
  const vh = app.querySelector(`[data-valhint="${i}"]`); if (vh) vh.textContent = valueHint(it);
  const r = itemPhotoReason(it);
  app.querySelectorAll(`[data-photoreq="${i}"]`).forEach((el) => { el.textContent = r; el.hidden = !r; });
  app.querySelectorAll(`[data-photolbl="${i}"]`).forEach((el) => { el.innerHTML = r ? req : ' (optional)'; });
}
const reqLine = (txt) => `<p class="mini req-line" data-photoreq>${esc(txt)}</p>`;

// ---------- shipping (Shipping service, or any job outside California) ----------
const req = ' <span class="req">Required</span>';
const framingBlock = (item, i) => {
  if (!FRAMING_TYPES.includes(item.type || 'painting')) return '';
  const p = `items.${i}`;
  return `<div class="field" style="margin-top:6px" data-framing="${i}"><label class="f">Framed?${req}</label>${seg(`${p}.framed`, [['yes', 'Yes'], ['no', 'No']])}</div>
    ${item.framed === 'yes' ? `<div class="field"><label class="f">Glass or acrylic glazing?${req}</label>${seg(`${p}.glazing`, [['yes', 'Yes'], ['no', 'No']])}</div>` : ''}`;
};
const shipExtras = (item, i) => {
  const p = `items.${i}`, type = item.type || 'painting';
  return `<label class="f">Size in inches (W × H × D)${req}</label>
    <div class="row3">${input(`${p}.w`, '', { type: 'number', ph: 'W', attrs: 'inputmode="decimal" aria-label="Width"' })}${input(`${p}.h`, '', { type: 'number', ph: 'H', attrs: 'inputmode="decimal" aria-label="Height"' })}${input(`${p}.d`, '', { type: 'number', ph: 'D', attrs: 'inputmode="decimal" aria-label="Depth"' })}</div>
    <div class="row keep">${input(`${p}.weight`, 'Weight (lb)' + req, { type: 'number', ph: 'e.g. 40', attrs: 'inputmode="decimal"' })}${input(`${p}.value`, 'Declared value ($)' + req, { type: 'number', ph: 'e.g. 12000', attrs: 'inputmode="numeric"' })}</div>
    ${framingBlock(item, i)}
    ${toggle(`${p}.fragile`, 'Uniquely fragile', 'Glass, ceramic, delicate surfaces or projecting parts.', true)}
    <div class="field" style="margin-top:10px"><label class="f">Crating</label>${seg(`${p}.crateStatus`, [['needs', 'Needs crating'], ['crated', 'Already crated'], ['not_sure', 'Not sure']])}</div>`;
};
const shipReady = () => S.items.every((it) => Number(it.weight) > 0 && Number(it.value) > 0 && (Number(it.w) > 0 || Number(it.h) > 0))
  && !!S.shipping.serviceLevel && !!(S.shipping.shipBy || S.shipping.flexible);
const LEVELS = [['curbside', 'Curbside', 'Delivered to the curb or loading dock.'], ['inside', 'Inside delivery', 'Carried in and placed in the room of your choice.'], ['unpack', 'Inside + unpack & install', 'We unpack, place or hang, and check every piece.'], ['unpack_debris', 'Unpack, install + debris removal', 'Full white-glove: crate and packing removed.']];
const levelText = (v) => (LEVELS.find((l) => l[0] === v) || [, '—'])[1];
const timingText = (s) => [s.shipBy && `Ship by ${shortDate(s.shipBy)}`, s.arriveBy && `Arrive by ${shortDate(s.arriveBy)}`, s.flexible ? 'Flexible' : ''].filter(Boolean).join(' · ') || 'Flexible';
const destText = (a) => [a.street, [a.city, intlDest(a) ? '' : a.state].filter(Boolean).join(', '), a.zip, intlDest(a) ? a.country : ''].filter(Boolean).map(esc).join(', ');
const OOS_NOTE = 'Pickups and deliveries outside California are custom quoted as Shipping. Within California we always provide white-glove delivery. Samantha prices your job and emails you a quote; nothing is charged until you approve it.';

// ---------- views ----------
const views = {
  What() {
    const base = (CFG.pricing && CFG.pricing.displayFrom) || {};
    const it = (item, i) => {
      const type = item.type || 'painting';
      const p = `items.${i}`;
      const dims = `<label class="f">Size in inches (W × H × D)</label>
        <div class="row3">${input(`${p}.w`, '', { type: 'number', ph: 'W', attrs: 'inputmode="decimal" aria-label="Width"' })}${input(`${p}.h`, '', { type: 'number', ph: 'H', attrs: 'inputmode="decimal" aria-label="Height"' })}${input(`${p}.d`, '', { type: 'number', ph: 'D', attrs: 'inputmode="decimal" aria-label="Depth"' })}</div>`;
      const value = input(`${p}.value`, 'Declared value per piece ($)', { type: 'number', ph: 'e.g. 12000', attrs: 'inputmode="numeric"', req: true })
        + `<p class="mini" style="margin:-4px 0 8px" data-valhint="${i}">${valueHint(item)}</p>`;
      const weight = input(`${p}.weight`, 'Weight (lb)', { type: 'number', ph: 'e.g. 200', attrs: 'inputmode="decimal"' });
      const ph = { painting: 'e.g. Oil on canvas by J. Smith', mirror: 'e.g. Venetian mirror, gilt', wallart: 'e.g. Signed photograph, mixed media', sculpture: 'e.g. Bronze on plinth', furniture: 'e.g. Walnut credenza', decor: 'e.g. Pair of table lamps', other: 'e.g. Antique clock, wine collection', custom: 'e.g. Pick up 3 crates from storage and hold them' }[type];
      const kinds = type === 'furniture' ? (CFG.pricing.furnitureKinds || []) : decorKinds();
      const kindRow = (type === 'furniture' || type === 'decor') ? `<div class="row keep">${select(`${p}.furnitureKind`, type === 'decor' ? 'Type of décor' : 'Item', kinds)}${select(`${p}.sizeClass`, 'Size', ['small', 'medium', 'large'])}</div>` : '';
      const needsWeight = type === 'sculpture' || type === 'other';
      const rateBlock = `
        ${type === 'custom' ? '' : type === 'furniture' ? value : dims}
        ${needsWeight ? `<div class="row keep">${weight.replace('Weight (lb)', 'Weight (lb) <span class="req">Required</span>')}${value}</div>` : ''}
        ${type === 'decor' ? value : ''}
        ${FRAMING_TYPES.includes(type) ? framingBlock(item, i) + value : ''}
        ${type === 'mirror' ? value + '<p class="mini" style="margin:0 0 6px">Glass is assumed for mirrors.</p>' : ''}
        ${type === 'custom' ? '<p class="mini" style="margin:0 0 6px">Tell us what you need in the description. CAD reviews it and sends a custom quote; nothing is charged until you approve it.</p>' : ''}
        ${type === 'other' ? '<p class="mini" style="margin:0 0 6px">Priced by weight from our sculpture rates. The price covers pickup, delivery and placement wherever you want it. CAD may adjust the final quote after seeing photos.</p>' : ''}
        ${type === 'sculpture' ? '<p class="mini" style="margin:0 0 6px">One weight-based price covers pickup, delivery and placement wherever you want it: a home, gallery, warehouse, hotel or sculpture garden. Same price either way.</p>' : ''}
        ${hasInstall() && type === 'decor' && item.furnitureKind === 'Chandelier' ? '<p class="mini" style="margin:0 0 6px">Chandelier hanging isn’t on our rate card, so this becomes a quick quote request.</p>' : ''}
        ${type === 'furniture' ? '<p class="mini" style="margin:0 0 6px">One price covers pickup, delivery and placement wherever you want it.</p>' : ''}
        ${toggle(`${p}.fragile`, 'Uniquely fragile', 'Glass, ceramic, delicate surfaces or projecting parts.', true)}
`;
      return `<div class="card"><div class="item-head"><b>Piece ${i + 1}</b><span class="item-actions">
          <button type="button" class="link" data-dup="${i}">Duplicate</button>
          ${S.items.length > 1 ? `<button type="button" class="link muted" data-remove="${i}">Remove</button>` : ''}</span></div>
        <div class="field"><div class="chips" data-itemtype="${i}">${itemTypes().map(([v, l]) => `<button type="button" class="chip ${type === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
        ${type === 'wallart' ? '<p class="mini" style="margin:-4px 0 10px">Photography, mixed media, wall sculpture, etc. Hung on a wall, so we can install it.</p>' : ''}
        ${kindRow}
        <div class="row qty">${input(`${p}.qty`, 'Qty', { type: 'number', attrs: 'min="1" inputmode="numeric"' })}${input(`${p}.description`, type === 'custom' ? 'Your request' : 'Description', { ph, req: true })}</div>
        ${shipService() ? shipExtras(item, i) : rateBlock}
        <p class="mini req-line" data-photoreq="${i}" ${itemPhotoReason(item) ? '' : 'hidden'}>${esc(itemPhotoReason(item))}</p>
        <div class="photos">${(item.photos || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}
          <label class="upload">＋ Photos<span data-photolbl="${i}">${itemPhotoReason(item) ? req : ' (optional)'}</span><input type="file" accept="image/*" multiple data-upload="${i}"></label></div>
      </div>`;
    };
    return `<h1>${S.service === 'install_only' ? 'What are we installing?' : 'What are we moving?'}</h1><p class="sub">Fine art, luxury furniture and décor are our specialty, and we handle anything fragile or valuable. Approximate sizes are fine.</p>
      <div class="choices">${Object.entries(CFG.services).map(([k, v]) => `<button type="button" class="choice ${S.service === k ? 'on' : ''}" data-service="${k}">
        <span class="ico">${ICONS[k]}</span><span class="txt"><b>${v.label}</b><span class="d">${DESC[k]}</span></span><span class="from">${base[k] == null ? 'Custom quote' : 'from ' + fmt(base[k])}</span></button>`).join('')}</div>
      ${S.service ? `<h2 id="pieces">The pieces</h2>${S.items.map(it).join('')}
        <button type="button" class="add" id="addItem">＋ Add another piece</button>
        ${shipService() ? '<p class="mini">Tell us whether each piece is already crated or needs custom crating. Samantha prices packing, shipping and destination service together. Pieces may be crated or soft-packed as needed.</p>' : S.service === 'install_only' ? '' : `<div class="card" style="margin-top:12px">${toggle('crating', 'Need custom crating?', 'Built by our trusted partner. This turns your booking into a quick quote request; nothing is charged until CAD sets the price.', true, 'first')}</div>`}
        <p class="mini">${shipService() ? 'Shipping is for out-of-state orders and is always custom quoted. Within California we always provide white-glove delivery. Nothing is charged until you approve Samantha’s quote.' : `${esc(CFG.notice || '')} Jobs with an address outside California are custom quoted as Shipping. Within California we always provide white-glove delivery.`}</p>` : ''}`;
  },

  Where() {
    const site = (key, title, optional = false) => {
      const a = get(key);
      return `<h2>${title}</h2><div class="card">
        ${key === 'dropoff' && shipService() ? input(`${key}.country`, 'Country', { ph: 'United States', attrs: 'autocomplete="country-name"', req: true }) : ''}
        ${key === 'dropoff' && shipService() && intlDest(a)
          ? `<div class="field"><label class="f" for="f-${key}.street">Full address${req}</label><textarea id="f-${key}.street" data-path="${key}.street" placeholder="Street, building, postal code, city, region">${esc(a.street)}</textarea></div>${input(`${key}.city`, 'City', { ph: 'e.g. London', req: true })}`
          : `${input(`${key}.street`, 'Street address', { ph: '8678 Melrose Ave', attrs: 'autocomplete="street-address"', req: !optional })}
        <div class="row keep addr3">${input(`${key}.city`, 'City', { ph: 'West Hollywood', req: !optional })}${input(`${key}.state`, 'State', { ph: 'CA', attrs: 'autocomplete="address-level1" maxlength="14"' })}${input(`${key}.zip`, 'ZIP', { ph: '90069', attrs: 'inputmode="numeric" maxlength="10"' })}</div>`}
        ${key === 'dropoff' && shipService() ? `<div class="field" style="margin-top:4px"><label class="f">Destination type</label>${seg(`${key}.locationType`, [['residential', 'Residential'], ['commercial', 'Commercial']])}</div>` : ''}
        ${input(`${key}.business`, 'Business or gallery (optional)', { ph: 'Gallery, showroom or residence' })}
        <div class="sub-head"><span>On-site contact</span><button type="button" class="pill-btn ${a.sameAsMe ? 'on' : ''}" data-same="${key}">${a.sameAsMe ? '✓ Same as me' : 'Same as me'}</button></div>
        <div class="row keep">${input(`${key}.contactName`, 'Name', { ph: 'Name', req: !optional })}${input(`${key}.contactPhone`, 'Phone', { type: 'tel', ph: '(310) 555-0100', req: !optional, attrs: 'autocomplete="tel"' })}</div>
        <div class="sub-head"><span>Access</span></div>
        <div class="row keep" style="grid-template-columns:96px 1fr">${input(`${key}.floor`, 'Floor', { ph: '1', attrs: 'inputmode="numeric"' })}${input(`${key}.hours`, 'Access hours', { ph: 'e.g. 9am–5pm' })}</div>
        ${toggle(`${key}.elevator`, 'Elevator', '', true)}
        ${toggle(`${key}.loadingDock`, 'Loading dock')}
        ${toggle(`${key}.technicalCarry`, 'Tight spaces, backyard or technical carry', 'Narrow halls or stairs, garden paths, hoisting.', true)}
        ${a.technicalCarry ? `${reqLine('Photos required: show the carry path (tight spaces, backyard or technical carry).')}<div class="photos" style="margin:0 0 12px">${(a.sitePhotos || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}<label class="upload">＋ Photos of the path${req}<input type="file" accept="image/*" multiple data-siteupload="${key}"></label></div>` : ''}
        ${toggle(`${key}.parkingRestricted`, 'Parking or loading restrictions', '', true)}
        ${a.parkingRestricted ? input(`${key}.parkingNote`, '', { ph: 'e.g. Loading zone only 9–11am, permit needed', attrs: 'aria-label="Parking or loading restrictions"' }) : ''}
        <div class="field" style="margin-top:10px"><label class="f">Will everything fit through the doors${a.elevator ? ' and elevator' : ''}?</label>${seg(`${key}.fits`, [['yes', 'Yes'], ['not_sure', 'Not sure']])}</div>
        <div class="field" style="margin-top:10px"><label class="f">Stairs or steps${a.elevator ? ' (even with the elevator)' : ''}</label>
          <div class="chips" data-stairs="${key}">${[['0', 'None'], ['steps', 'A few steps'], ['1', '1 flight'], ['2', '2 flights'], ['3', '3 flights'], ['4', '4+ flights']].map(([v, l]) => {
            const on = v === 'steps' ? (!Number(a.stairs) && a.steps) : v === '0' ? (!Number(a.stairs) && !a.steps) : Number(a.stairs) === Number(v);
            return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${v}">${l}</button>`; }).join('')}</div></div>
        ${key === 'dropoff' && intlDest(a) && shipService() ? `<div class="sub-head"><span>Customs / import contact</span></div>
        <p class="mini" style="margin:-4px 0 8px">The person or broker who clears the shipment at the destination. Leave blank if it’s the recipient above.</p>
        <div class="row keep">${input('shipping.customs.name', 'Name', { ph: 'Name or broker' })}${input('shipping.customs.phone', 'Phone', { type: 'tel', ph: '+44 20 0000 0000' })}</div>
        ${input('shipping.customs.email', 'Email', { type: 'email', attrs: 'autocapitalize="off"' })}` : ''}
        ${key === 'dropoff' && hasHanging() && !isShip() ? `<div class="sub-head"><span>Hanging</span></div>
        <div class="row keep" style="grid-template-columns:120px 1fr">${input(`${key}.centerHeight`, 'Center height (in)', { type: 'number', ph: '57', attrs: 'inputmode="decimal"' })}${select(`${key}.wallType`, 'Wall type', ['Not sure', 'Drywall', 'Plaster', 'Concrete / brick', 'Wood', 'Tile / stone', 'Glass'])}</div>
        <p class="mini" style="margin:-4px 0 10px">Museum standard is 57" to the center of the piece. Leave blank to use it.</p>
        <div class="field"><label class="f">Hanging hardware</label>${seg(`${key}.hardware`, [['CAD brings it', 'CAD brings it'], ['On site', 'On site'], ['Not sure', 'Not sure']])}</div>
        ${toggle(`${key}.highInstall`, 'High or above a stairwell', 'Above eye level, over stairs, or needing a tall ladder or lift.', true)}
        ${a.highInstall ? reqLine('Photos required: complex installs (high or above a stairwell).') : ''}
        <div class="photos" style="margin:0 0 12px">${(a.wallPhotos || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}<label class="upload">＋ Photo of the wall${a.highInstall ? req : ' (optional)'}<input type="file" accept="image/*" multiple data-wallupload="${key}"></label></div>` : ''}
        <div class="field" style="margin:0"><label class="f" for="f-${key}.notes">Special instructions</label><textarea id="f-${key}.notes" data-path="${key}.notes" placeholder="Gate codes, parking, hanging height, COI, anything else">${esc(a.notes)}</textarea></div>
      </div>`;
    };
    const dropTitle = shipService() ? 'Destination' : S.service === 'install_only' ? 'Installation address' : 'Delivery address';
    return `<h1>Where are we going?</h1><p class="sub">Add the on-site details now so nobody has to chase anything after you book.</p>
      ${outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : ''}
      <h2>Your details</h2><div class="card">
        ${input('contact.name', 'Full name', { attrs: 'autocomplete="name"', req: true })}
        <div class="row">${input('contact.email', 'Email', { type: 'email', attrs: 'autocomplete="email" autocapitalize="off"', req: true })}${input('contact.phone', 'Mobile', { type: 'tel', attrs: 'autocomplete="tel"', req: true })}</div>
        <div class="row keep">${input('contact.company', 'Company (optional)')}${select('contact.clientType', 'I am a…', ['Collector', 'Gallery', 'Furniture showroom', 'Interior designer', 'Auction house', 'Artist', 'Other'])}</div>
        ${toggle('member', 'I’m a CAD member', '25% off published rates.', true)}
        ${toggle('referral', 'Referred by a gallery, showroom or designer', '', true)}
        ${S.referral ? `<div class="row keep" style="margin-top:6px">${select('partner.type', 'Type', ['Gallery', 'Furniture showroom', 'Interior designer', 'Auction house'])}${input('partner.name', 'Name', { ph: 'e.g. Hamilton Selway' })}</div>${input('partner.email', 'Partner email (optional)', { type: 'email', attrs: 'autocapitalize="off"' })}` : ''}
      </div>
      ${svc().needsPickup ? site('pickup', 'Pickup address') : ''}
      ${site('dropoff', dropTitle)}`;
  },

  When() {
    if (isShip()) return views.ShipWhen();
    if (!avail) return `<h1>Choose your date</h1><p class="sub">Finding route days near you…</p>`;
    const region = avail.region || 'your area';
    const card = (d) => { const [w, m, n] = d.label.replace(',', '').split(' '); return `<button type="button" class="day ${S.schedule.date === d.date && !!S.rush === !!d.rush ? 'on' : ''} ${d.rush ? 'rush' : ''}" data-date="${d.date}" data-rush="${d.rush ? 1 : ''}"><div class="dw">${w}</div><div class="dd">${m} ${n}</div><div class="rg">${d.rush ? 'Rush quote' : esc(d.shortLabel || d.routeLabel || d.region)}</div></button>`; };
    const simpleOc = (avail.days || []).some((d) => d.simpleStop);
    const intro = simpleOc
      ? 'Because the van starts or ends Monday at our Irvine hub, a simple Orange County stop (1–2 standard items) can go on Monday. Larger OC jobs use the Thursday of a SoCal week.'
      : 'Monday is always an LA day, so LA customers can book either Monday.';
    const sel = [...avail.days, ...avail.rush].find((d) => d.date === S.schedule.date && !!S.rush === !!d.rush);
    return `<h1>Choose your date</h1><p class="sub">${svc().needsPickup ? 'We pick up and deliver on the same route day. Pick a day and an arrival window.' : 'Our van follows a weekly route. Pick a route day and an arrival window.'}</p>
      <div class="region">● ${esc(avail.zone ? avail.zone + ' · ' : '')}${esc(region)} route</div>
      <div class="days">${avail.days.map(card).join('')}</div>
      <p class="mini">${intro}</p>
      <h2>Arrival window</h2><div class="chips" data-chips="schedule.window">${CFG.timeWindows.map((w) => `<button type="button" class="chip ${S.schedule.window === w ? 'on' : ''}" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      ${sel && S.schedule.window ? promiseCard(sel.routeLabel || region + ' route') : ''}
      ${laterBlock()}
      ${avail.rush.length ? `<h2>Need it sooner?</h2><div class="days">${avail.rush.map(card).join('')}</div>` : ''}
      <div class="card" style="margin-top:14px">${toggle('dedicated', 'Dedicated trip', 'The van comes just for this job, without displacing booked jobs.', true, 'first')}</div>
      <p class="mini">Rush and dedicated trips are quoted at 1.5×–2× the regular rate. You request a quote; nothing is charged until CAD sets the price.</p>`;
  },

  ShipWhen() {
    const sh = S.shipping;
    const lvl = ([v, l, h]) => `<button type="button" class="choice ${sh.serviceLevel === v ? 'on' : ''}" data-level="${v}"><span class="txt"><b>${l}</b><span class="d">${h}</span></span></button>`;
    const today = new Date().toISOString().slice(0, 10);
    return `<h1>Shipping details</h1><p class="sub">Everything Samantha needs to price your shipment, with no back-and-forth.</p>
      ${outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : ''}
      ${outOfState() ? `<h2>The pieces</h2>${S.items.map((it, i) => `<div class="card"><div class="item-head"><b>${esc(it.qty)}× ${esc(it.description || 'Piece ' + (i + 1))}</b></div>${shipExtras(it, i)}</div>`).join('')}` : ''}
      ${outOfState() ? `<h2>Destination type</h2><div class="card">${seg('dropoff.locationType', [['residential', 'Residential'], ['commercial', 'Commercial']])}</div>` : ''}
      <h2>Service at the destination</h2><div class="choices">${LEVELS.map(lvl).join('')}</div>
      <h2>Timing</h2><div class="card">
        <div class="row keep">${input('shipping.shipBy', 'Ship by', { type: 'date', attrs: `min="${today}"` })}${input('shipping.arriveBy', 'Arrive by (optional)', { type: 'date', attrs: `min="${today}"` })}</div>
        ${toggle('shipping.flexible', 'My dates are flexible', 'Flexible dates usually mean a better shipping rate.', true)}
      </div>
      <p class="mini">Fully insured through our shipping partners.</p>`;
  },

  Pay() {
    if (existing) return views.PayLink();
    if (isShip()) return views.ShipPay();
    const q = quoteData;
    const addr = (a) => (a.street ? `${esc(a.street)}, ${esc(a.city)}` : '—');
    const sp = special();
    const date = avail && [...avail.days, ...avail.rush].find((d) => d.date === S.schedule.date);
    const siteRows = (label, a) => (a && a.street ? `<div class="sum-row"><span>${label}</span><span>${addr(a)}<br><span class="muted">${esc(a.contactName)} · ${esc(a.contactPhone)}</span></span></div>` : '');
    return `<h1>${sp ? 'Review your request' : 'Review & pay'}</h1><p class="sub">${sp ? 'CAD sets the final price before anything is charged.' : 'Your job is confirmed the moment you pay. No approval step.'}</p>
      ${promiseCard((date && date.routeLabel) || (avail && avail.region ? avail.region + ' route' : 'Route day'), 'margin-top:0')}
      <div class="card">
        <div class="sum-row"><span>Service</span><span>${esc(svc().label)}${S.crating ? ' + crating quote' : ''}${S.rush ? ' · rush' : ''}${S.dedicated ? ' · dedicated trip' : ''} <button type="button" class="edit" data-goto="0">Edit</button></span></div>
        <div class="sum-row"><span>Pieces</span><span>${S.items.map((i) => `${esc(i.qty)}× ${esc(i.description)}<br><span class="muted">${esc([TYPE_LABEL(i.type), framingText(i)].filter(Boolean).join(' · '))}</span>`).join('<br>')}</span></div>
        ${svc().needsPickup ? siteRows('Pickup', S.pickup) : ''}
        ${siteRows(S.service === 'install_only' ? 'Install at' : 'Delivery', S.dropoff)}
        <div class="sum-row"><span>Booked by</span><span>${esc(S.contact.name)}<br><span class="muted">${esc(S.contact.email)}</span> <button type="button" class="edit" data-goto="1">Edit</button></span></div>
      </div>
      ${svc().needsPickup ? siteReview('Pickup special instructions', S.pickup) : ''}
      ${siteReview(S.service === 'install_only' ? 'Installation special instructions' : 'Delivery special instructions', S.dropoff)}
      <h2>${sp ? 'Estimated range' : 'Price'}</h2>
      ${priceCard(q, true)}
      ${q && q.notes && q.notes.length ? `<p class="mini">${q.notes.map((n) => esc(n)).join(' ')}</p>` : ''}
      ${S.member ? '<p class="mini">Member rate (25% off) applied.</p>' : ''}
      <h2>Who’s paying?</h2><div class="card">${seg('payer', S.referral ? [['me', 'Me'], ['partner', 'Referring partner'], ['other', 'Someone else']] : [['me', 'Me'], ['other', 'Someone else']])}
        ${S.payer === 'other' ? `<div class="row" style="margin-top:12px">${input('payerOther.name', 'Payer name')}${input('payerOther.email', 'Payer email', { type: 'email', attrs: 'autocapitalize="off"' })}</div>` : ''}
        ${S.payer === 'partner' && !(S.referral && S.partner.name) ? `<p class="mini">Add the referring partner in <button type="button" class="edit" style="padding:0" data-goto="1">Where</button> so we know who to bill.</p>` : ''}</div>
      ${sp ? '<div class="err" id="err"></div>' : `<h2>Payment</h2>${paymentBlock(q)}`}
      <p class="mini">${sp ? 'Rush and dedicated-trip quotes go to Samantha, who sets the price and emails you a payment link.' : 'Need to change or cancel? Reply to your confirmation email and we’ll take care of it.'}</p>`;
  },

  ShipPay() {
    const sh = S.shipping, d = S.dropoff;
    const declared = S.items.reduce((s, it) => s + (Number(it.value) || 0) * (Number(it.qty) || 1), 0);
    const crate = { needs: 'needs crating', crated: 'already crated', not_sure: 'crating not sure' };
    return `<h1>Review your shipping request</h1><p class="sub">Samantha prices shipping and emails you a quote. Nothing is charged until you approve it.</p>
      ${outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : ''}
      <div class="promise quote" style="margin-top:0"><span class="pi">✈</span><span><b>${esc(timingText(sh))}</b><span>${esc(levelText(sh.serviceLevel))}</span></span></div>
      <div class="card">
        <div class="sum-row"><span>Service</span><span>Shipping <button type="button" class="edit" data-goto="0">Edit</button></span></div>
        <div class="sum-row"><span>Pieces</span><span>${S.items.map((i) => `${esc(i.qty)}× ${esc(i.description)}<br><span class="muted">${[i.w, i.h, i.d].filter(Boolean).map(esc).join(' × ')} in · ${esc(i.weight)} lb · ${esc(TYPE_LABEL(i.type))}${framingText(i) ? ' · ' + esc(framingText(i)) : ''}${i.fragile ? ' · fragile' : ''} · ${crate[i.crateStatus] || crate.not_sure}</span>`).join('<br>')}</span></div>
        <div class="sum-row"><span>Pickup</span><span>${destText(S.pickup)}<br><span class="muted">${esc(S.pickup.contactName)} · ${esc(S.pickup.contactPhone)}</span></span></div>
        <div class="sum-row"><span>Destination</span><span>${destText(d)}${d.locationType ? ` · ${esc(d.locationType)}` : ''}<br><span class="muted">${esc(d.contactName)} · ${esc(d.contactPhone)}</span> <button type="button" class="edit" data-goto="1">Edit</button></span></div>
        ${intlDest(d) && (sh.customs.name || sh.customs.phone) ? `<div class="sum-row"><span>Customs contact</span><span>${esc([sh.customs.name, sh.customs.phone, sh.customs.email].filter(Boolean).join(' · '))}</span></div>` : ''}
        <div class="sum-row"><span>At destination</span><span>${esc(levelText(sh.serviceLevel))} <button type="button" class="edit" data-goto="2">Edit</button></span></div>
        <div class="sum-row"><span>Booked by</span><span>${esc(S.contact.name)}<br><span class="muted">${esc(S.contact.email)}</span></span></div>
      </div>
      ${siteReview('Pickup special instructions', S.pickup)}
      ${siteReview('Destination special instructions', S.dropoff)}
      <h2>Price</h2><div class="card">
        <div class="sum-row"><span>Shipping</span><span>Custom quote</span></div>
        <div class="sum-row"><span>Insurance</span><span>Fully insured through our shipping partners</span></div>
        <p class="mini" style="margin:4px 0 0">Declared value: $${declared.toLocaleString()}.</p>
        <p class="mini" style="margin:6px 0 0">Samantha sets the price for packing, shipping and destination service before anything is charged. Pieces may be crated or soft-packed as needed.</p>
      </div>
      <h2>Who’s paying?</h2><div class="card">${seg('payer', S.referral ? [['me', 'Me'], ['partner', 'Referring partner'], ['other', 'Someone else']] : [['me', 'Me'], ['other', 'Someone else']])}
        ${S.payer === 'other' ? `<div class="row" style="margin-top:12px">${input('payerOther.name', 'Payer name')}${input('payerOther.email', 'Payer email', { type: 'email', attrs: 'autocapitalize="off"' })}</div>` : ''}</div>
      <div class="err" id="err"></div>`;
  },

  PayLink() {
    const o = existing, q = o.quote;
    return `<h1>Pay to confirm</h1><p class="sub">Your quote is approved. Your job is confirmed the moment you pay.</p>
      <div class="promise" style="margin-top:0"><span class="pi">✓</span><span><b>${o.service === 'crating_shipping' ? esc(timingText(o.shipping || {})) : `${esc(longDate(o.schedule.date))}, ${esc(windowText(o.schedule.window))}`}</b><span>Order ${esc(o.id)}</span></span></div>
      <div class="card"><div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}${o.rush ? ' · rush' : ''}${o.dedicated ? ' · dedicated trip' : ''}</span></div>
        <div class="sum-row"><span>Pieces</span><span>${(o.items || []).map((i) => `${esc(i.qty)}× ${esc(i.description)}`).join('<br>')}</span></div></div>
      ${priceCard(q, false)}
      <h2>Payment</h2>${paymentBlock(q)}`;
  },

  Done() {
    const o = confirmed;
    if (o.status === 'pending_approval' && o.service === 'crating_shipping') {
      return `<div class="done"><div class="check">✓</div><h1>Shipping quote request received</h1>
        <p class="sub">Request <b>${esc(o.id)}</b> is with Samantha. She’ll email ${esc(o.contact.email)} your shipping quote with a payment link. Nothing has been charged.</p></div>
        ${o.outOfState ? `<p class="note">${OOS_NOTE}</p>` : ''}
        <div class="card">
          <div class="sum-row"><span>Service</span><span>Shipping</span></div>
          <div class="sum-row"><span>Destination</span><span>${destText(o.dropoff)}</span></div>
          <div class="sum-row"><span>Timing</span><span>${esc(timingText(o.shipping || {}))}</span></div>
          <div class="sum-row"><span>At destination</span><span>${esc(levelText((o.shipping || {}).serviceLevel))}</span></div>
          <div class="sum-row"><span>Price</span><span>Custom quote from Samantha</span></div>
        </div>
        <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
    }
    if (o.status === 'pending_approval') {
      const q = o.quote || quoteData;
      return `<div class="done"><div class="check">✓</div><h1>Quote request received</h1>
        <p class="sub">Request <b>${esc(o.id)}</b> is with Samantha. We’ll email ${esc(o.contact.email)} a final price and a payment link. Nothing has been charged.</p></div>
        <div class="card">
          <div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}${o.rush ? ' · rush' : ''}${o.dedicated ? ' · dedicated trip' : ''}</span></div>
          <div class="sum-row"><span>Preferred date</span><span>${esc(longDate(o.schedule.date))}, ${esc(windowText(o.schedule.window))}</span></div>
          <div class="sum-row"><span>Regular rate</span><span>${fmt(q.regularTotal || q.total)}</span></div>
          ${q.tripPremium === false ? '' : `<div class="sum-row"><span>Quoted range (1.5×–2×)</span><span><b>${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}</b></span></div>`}
          ${o.crating ? '<div class="sum-row"><span>Custom crating</span><span>Quoted by CAD</span></div>' : ''}
        </div>
        ${o.dedicated ? '<p class="mini">Dedicated trips are scheduled around existing jobs, not instead of them.</p>' : ''}
        <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
    }
    const p = o.payment || {};
    const ach = p.status === 'ach_processing';
    const how = p.method && p.method.includes('apple') ? 'Apple Pay' : p.method && p.method.includes('google') ? 'Google Pay' : p.method && p.method.includes('ach') ? 'Bank (ACH)' : 'Card';
    const shipDone = o.service === 'crating_shipping';
    return `<div class="done"><div class="check">✓</div><h1>${shipDone ? 'Your shipment is confirmed.' : `You’re booked for ${esc(longDate(o.schedule.date))}, ${esc(windowText(o.schedule.window))}.`}</h1>${o.schedule.deliveryLater && o.schedule.deliveryDate ? `<p class="sub" style="margin:-4px 0 10px"><strong>Delivery: ${esc(longDate(o.schedule.deliveryDate))}</strong>, same arrival window.</p>` : ''}
      <p class="sub">Order <b>${esc(o.id)}</b> is confirmed. A confirmation is on its way to ${esc(o.contact.email)}. ${shipDone ? 'Samantha will confirm packing and pickup dates by email.' : 'We’ll send a reminder the day before and a live ETA when we’re close.'}</p></div>
      <div class="card"><div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}</span></div>
      ${shipDone ? `<div class="sum-row"><span>Timing</span><span>${esc(timingText(o.shipping || {}))}</span></div><div class="sum-row"><span>Destination</span><span>${destText(o.dropoff)}</span></div>` : `<div class="sum-row"><span>Route</span><span>${esc(o.schedule.region)}</span></div>`}
      <div class="sum-row"><span>Payment</span><span>${ach ? `<b>ACH processing</b> · ${fmt(p.amount)}` : `Paid ${fmt(p.amount)}`} · ${how}${p.method && p.method.startsWith('mock') ? ' (test)' : ''}${p.saved ? ' · saved' : ''}</span></div>
      ${o.quote.paymentPlan === 'deposit' ? `<div class="sum-row"><span>Balance due ${esc(o.quote.balanceWhen)}</span><span><b>${fmt(o.quote.balanceDue)}</b></span></div>` : ''}
      <div class="total"><span>Order total</span><span>${fmt(o.quote.total)}</span></div></div>
      ${ach ? '<p class="mini">Your job is confirmed. The bank transfer shows as processing until it clears.</p>' : ''}
      <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
  },
};

const siteReview = (title, a) => {
  if (!a || !a.street) return '';
  const rows = [
    a.business && ['Business', esc(a.business)],
    a.hours && ['Access hours', esc(a.hours)],
    ['Access', accessText(a)],
    a.parkingRestricted && ['Parking / loading', esc(a.parkingNote || 'Restrictions')],
    a === S.dropoff && hasHanging() && ['Hanging', `${esc(a.centerHeight || 57)}" center · ${esc(a.wallType || 'Wall type not sure')} · hardware: ${esc(a.hardware || 'not sure')}${a.wallPhotos && a.wallPhotos.length ? ` · ${a.wallPhotos.length} photo(s)` : ''}`],
    a.notes && ['Notes', esc(a.notes)],
  ].filter(Boolean);
  return `<h2>${esc(title)}</h2><div class="card">${rows.map(([k, v]) => `<div class="sum-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
};

// ---------- validation ----------
const filled = (a) => a && String(a.street || '').trim() && String(a.city || '').trim();
const hasContact = (a) => String(a.contactName || '').trim() && String(a.contactPhone || '').trim();
const siteReady = (a, required) => (required ? filled(a) && hasContact(a) : !filled(a) || hasContact(a));
const contactReady = () => S.contact.name.trim() && /\S+@\S+\.\S+/.test(S.contact.email) && String(S.contact.phone || '').replace(/\D/g, '').length >= 7;
function canContinue() {
  switch (STEPS[step]) {
    case 'What': return !!S.service && S.items.every((i) => String(i.description || '').trim() && Number(i.qty) > 0 && photosOk(i) && framingOk(i) && (shipService() ? Number(i.weight) > 0 && Number(i.value) > 0 && (Number(i.w) > 0 || Number(i.h) > 0) : (i.type === 'custom' || Number(i.value) > 0) && (!['sculpture', 'other'].includes(i.type) || Number(i.weight) > 0)));
    case 'Where': return contactReady() && (!svc().needsPickup || sitePhotosOk(S.pickup)) && sitePhotosOk(S.dropoff) && wallPhotosOk(S.dropoff) && (!svc().needsPickup || siteReady(S.pickup, true)) && (shipService() ? !!(String(S.dropoff.country || '').trim() && filled(S.dropoff) && hasContact(S.dropoff)) : siteReady(S.dropoff, true));
    case 'When': if (isShip()) return shipReady() && S.items.every(photosOk); return !!(S.schedule.date && S.schedule.window && (!laterOn() || (S.schedule.deliveryDate && S.schedule.deliveryDate > S.schedule.date)));
    case 'Pay': return existing ? true : (S.payer !== 'other' || !!String(S.payerOther.name || '').trim()) && (S.payer !== 'partner' || !!(S.referral && S.partner.name));
    default: return true;
  }
}

// ---------- estimate (dock) ----------
let qTimer, qSeq = 0;
function paintEstimate() {
  const el = $('#estTotal'), lbl = $('#estLabel');
  const q = existing ? existing.quote : quoteData;
  const name = STEPS[step];
  if (!S.service && !existing) { el.textContent = '—'; lbl.textContent = 'Estimate'; return; }
  if ((!existing && isShip()) || (q && q.shipping && !q.approvedPrice)) { el.textContent = 'Quote'; lbl.textContent = 'Shipping'; paintButton(); return; }
  if (!q) return;
  if (isQuote(q) && q.quoteRange) { el.textContent = q.quoteRange.low === q.quoteRange.high ? fmt(q.quoteRange.low) + '+' : `${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}`; lbl.textContent = q.quoteRange.low === q.quoteRange.high ? (q.crating ? 'Estimate + crating' : 'Estimate + quoted items') : 'Quote range'; }
  else if (name === 'Pay') { el.textContent = fmt(q.dueNow); lbl.textContent = q.paymentPlan === 'deposit' ? 'Due today (50%)' : 'Due today'; }
  else { el.textContent = fmt(q.total); lbl.textContent = 'Estimate'; }
  paintButton();
}
function refreshQuote() {
  if (existing) { paintEstimate(); return; }
  clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    if (!S.service) { paintEstimate(); return; }
    const seq = ++qSeq;
    const { ok, j } = await api('/api/quote', payload());
    if (seq !== qSeq || !ok) return;
    quoteData = j; paintEstimate();
    if (STEPS[step] === 'Pay' && !isShip()) { const pc = document.querySelector('[data-price]'); if (pc) pc.outerHTML = `<div data-price>${priceCard(quoteData, true)}</div>`; }
  }, 120);
}
function paintButton() {
  const name = STEPS[step], btn = $('#nextBtn');
  const q = existing ? existing.quote : quoteData;
  if (name === 'Pay') {
    if (existing || !special()) btn.textContent = CFG.stripe ? `Pay ${q ? fmt(q.dueNow) : ''} on Stripe` : `Pay ${q ? fmt(q.dueNow) : ''}`;
    else btn.textContent = isShip() ? (innerWidth < 360 ? 'Request quote' : 'Request a shipping quote') : S.rush ? 'Request a rush quote' : 'Request a quote';
  } else btn.textContent = 'Continue';
  btn.disabled = busy || !canContinue();
}

// ---------- render ----------
let lastStep = -1;
function render() {
  const name = STEPS[step];
  lastShipKey = shipKey(); lastPhotoKey = itemKey();
  const stepChanged = step !== lastStep;
  lastStep = step;
  // Keep the user's scroll position on in-step re-renders (toggles, chips). Only a new step starts at the top.
  const y = window.scrollY;
  const html = views[name]();
  const focusId = !stepChanged && document.activeElement && app.contains(document.activeElement) ? document.activeElement.id : '';
  app.innerHTML = `<div class="view${stepChanged ? ' enter' : ''}">${html}</div>`;
  if (focusId) { const f = document.getElementById(focusId); if (f) f.focus({ preventScroll: true }); }
  if (name === 'Pay' && !existing && !isShip()) wrapPriceCard();
  const idx = Math.min(step, 3);
  document.querySelectorAll('#progress i').forEach((el, i) => el.classList.toggle('on', name === 'Done' || i <= idx));
  $('#stepsLabel').textContent = name === 'Done' ? (confirmed && confirmed.status === 'pending_approval' ? 'Quote requested' : 'Confirmed') : `Step ${idx + 1} of 4`;
  $('#backBtn').classList.toggle('hide', step === 0 || name === 'Done' || !!existing);
  const noDock = name === 'Done';
  $('#dock').classList.toggle('hide', noDock);
  app.classList.toggle('no-dock', noDock);
  paintButton();
  refreshQuote();
  if (stepChanged) window.scrollTo(0, 0);
  else if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  measureDock();
}
function wrapPriceCard() {
  // Give the price card a stable hook so the live quote can repaint just that card (no full re-render, no scroll jump).
  const h2s = [...app.querySelectorAll('h2')].filter((h) => /^(Price|Estimated range)$/.test(h.textContent));
  if (!h2s.length) return;
  const card = h2s[0].nextElementSibling;
  if (card && card.classList.contains('card')) { const w = document.createElement('div'); w.setAttribute('data-price', ''); card.replaceWith(w); w.appendChild(card); }
}
const updateNext = () => { $('#nextBtn').disabled = busy || !canContinue(); };

// Measure the dock so page padding and scroll-padding exactly clear it on every device (incl. home-indicator inset).
function measureDock() {
  const d = $('#dock');
  const h = d.classList.contains('hide') ? 0 : Math.ceil(d.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--dock-h', h + 'px');
}
if (window.ResizeObserver) new ResizeObserver(measureDock).observe($('#dock'));
window.addEventListener('resize', measureDock);

// ---------- events ----------
const syncSameAsMe = () => {
  ['pickup', 'dropoff'].forEach((k) => {
    const a = S[k];
    if (!a.sameAsMe) return;
    a.contactName = S.contact.name; a.contactPhone = S.contact.phone;
    const n = document.getElementById(`f-${k}.contactName`), p = document.getElementById(`f-${k}.contactPhone`);
    if (n) n.value = a.contactName; if (p) p.value = a.contactPhone;
  });
};
app.addEventListener('input', (e) => {
  if (e.target.id === 'saveMethod') { saveMethod = e.target.checked; return; }
  const p = e.target.dataset.path; if (!p) return;
  set(p, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  if (p === 'contact.name' || p === 'contact.phone') syncSameAsMe();
  if (p === 'referral') { if (S.referral) { if (S.partner.type === 'None') S.partner.type = 'Gallery'; } else { S.partner = { type: 'None', name: '', email: '' }; if (S.payer === 'partner') S.payer = 'me'; } persist(); }
  const m = p.match(/^(pickup|dropoff)\.contact(Name|Phone)$/);
  if (m && S[m[1]].sameAsMe) { S[m[1]].sameAsMe = false; persist(); const b = app.querySelector(`[data-same="${m[1]}"]`); if (b) { b.classList.remove('on'); b.textContent = 'Same as me'; } }
  updateNext(); refreshQuote();
  if ('rerender' in e.target.dataset) render();
  if (p === 'schedule.deliveryLater') { if (S.schedule.deliveryLater) loadDelivery(); else { S.schedule.deliveryDate = ''; persist(); } }
});
app.addEventListener('change', (e) => {
  if (e.target.dataset.path && e.target.tagName === 'SELECT') { set(e.target.dataset.path, e.target.value); refreshQuote(); }
  if (e.target.dataset.upload != null) uploadPhotos(+e.target.dataset.upload, e.target.files);
  if (e.target.dataset.wallupload) uploadWallPhotos(e.target.dataset.wallupload, e.target.files);
  if (e.target.dataset.siteupload) uploadSitePhotos(e.target.dataset.siteupload, e.target.files);
  // Country / state / ZIP can flip a job to Shipping (outside California) or to an international address.
  // Value / weight hints update in place (no re-render), so a tap on the next control is never lost.
  const im = (e.target.dataset.path || '').match(/^items\.(\d+)\.(weight|value)$/);
  if (im) updateItemHints(+im[1]);
  // Country changes the address form (international = free-form), so re-render. State / ZIP / city only toggle the
  // out-of-state note in place, so nothing the customer is typing gets interrupted.
  if (e.target.dataset.path === 'dropoff.country') { const k = shipKey(); if (k !== lastShipKey) { lastShipKey = k; render(); } }
  else if (/^(pickup|dropoff)\.(state|zip|city)$/.test(e.target.dataset.path || '')) syncOosNote();
});
function syncOosNote() {
  const sub = app.querySelector('h1 + .sub'); if (!sub || STEPS[step] !== 'Where') return;
  const cur = app.querySelector('[data-oos]');
  if (outOfState() && !cur) sub.insertAdjacentHTML('afterend', `<p class="note" data-oos>${OOS_NOTE}</p>`);
  else if (!outOfState() && cur) cur.remove();
}
const itemKey = () => S.items.map((i) => itemPhotoReason(i) + (Number(i.value) > 50000 ? 2 : Number(i.value) > 0 ? 1 : 0)).join('|');
const shipKey = () => `${isShip()}|${intlDest(S.dropoff)}`;
let lastShipKey = '', lastPhotoKey = '';
app.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.service) {
    // No auto-scroll here: the page stays exactly where the user's thumb left it.
    S.service = t.dataset.service;
    if (S.service === 'crating_shipping') { S.crating = false; S.rush = false; S.dedicated = false; }
    if (S.service === 'install_only') { S.crating = false; S.schedule.deliveryLater = false; S.items.forEach((it) => { if (!INSTALL_TYPES.includes(it.type) || (it.type === 'decor' && !HUNG_DECOR.includes(it.furnitureKind))) { it.type = 'painting'; } }); }
    persist(); avail = null; render();
    return;
  }
  const itc = t.closest('[data-itemtype]');
  if (itc) {
    const it = S.items[+itc.dataset.itemtype]; const v = t.dataset.v;
    if (it.type !== v) { it.type = v; it.furnitureKind = v === 'decor' ? decorKinds()[0] : v === 'furniture' ? (CFG.pricing.furnitureKinds || [])[0] : it.furnitureKind; }
    persist(); render(); return;
  }
  if (t.id === 'addItem') { S.items.push(emptyItem()); persist(); render(); return; }
  if (t.dataset.dup != null) { const src = S.items[+t.dataset.dup]; S.items.splice(+t.dataset.dup + 1, 0, JSON.parse(JSON.stringify(src))); persist(); render(); return; }
  if (t.dataset.remove != null) { S.items.splice(+t.dataset.remove, 1); persist(); render(); return; }
  if (t.dataset.same) {
    const a = S[t.dataset.same];
    a.sameAsMe = !a.sameAsMe;
    if (a.sameAsMe) { a.contactName = S.contact.name; a.contactPhone = S.contact.phone; }
    persist(); render(); return;
  }
  if (t.dataset.goto != null) { step = +t.dataset.goto; render(); return; }
  if (t.dataset.wallet) return pay(CFG.stripe ? 'stripe' : t.dataset.wallet);
  const stairs = t.closest('[data-stairs]');
  if (stairs) { const a = S[stairs.dataset.stairs]; const v = t.dataset.v; a.steps = v === 'steps'; a.stairs = v === 'steps' ? 0 : Number(v); persist(); render(); return; }
  const sg = t.closest('[data-seg]'); if (sg) { const v = t.dataset.v; set(sg.dataset.seg, isNaN(v) ? v : Number(v)); render(); return; }
  const paySeg = t.closest('[data-pay-method]'); if (paySeg) { payMethod = t.dataset.v; render(); return; }
  const chips = t.closest('[data-chips]'); if (chips) { set(chips.dataset.chips, t.dataset.v); render(); return; }
  if (t.dataset.date) { S.schedule.date = t.dataset.date; S.rush = !!t.dataset.rush; persist(); render(); if (laterOn()) loadDelivery(); return; }
  if (t.dataset.level) { S.shipping.serviceLevel = t.dataset.level; persist(); render(); return; }
  if (t.dataset.deldate) { S.schedule.deliveryDate = t.dataset.deldate; persist(); render(); return; }
  if (t.id === 'newOrder') { sessionStorage.clear(); location.href = '/'; }
});

async function uploadWallPhotos(key, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  try { r = await (await fetch('/api/upload', { method: 'POST', body: fd })).json(); } catch (e) { return; }
  S[key].wallPhotos = [...(S[key].wallPhotos || []), ...r.files]; persist(); render();
}
async function uploadSitePhotos(key, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  try { r = await (await fetch('/api/upload', { method: 'POST', body: fd })).json(); } catch (e) { return; }
  S[key].sitePhotos = [...(S[key].sitePhotos || []), ...r.files]; persist(); render();
}
async function uploadPhotos(i, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  try { r = await (await fetch('/api/upload', { method: 'POST', body: fd })).json(); } catch (e) { return; }
  S.items[i].photos = [...(S.items[i].photos || []), ...r.files]; persist(); render();
}

const showErr = (msg) => { const el = $('#err'); if (el) el.textContent = msg; };
async function placeOrder() {
  const sig = JSON.stringify(payload());
  if (orderId && orderSig === sig) return { ok: true };
  const { ok, j } = await api('/api/orders', payload());
  if (!ok) return { ok: false, error: j.error || 'Something went wrong. Please try again.' };
  orderId = j.id; orderSig = sig; quoteData = j.quote;
  if (j.status === 'pending_approval') return { ok: true, pending: j.order };
  return { ok: true };
}
async function pay(method) {
  if (busy) return;
  if (!existing && !canContinue()) return;
  busy = true; updateNext();
  try {
    const err = $('#err'); if (err) err.textContent = '';
    if (!existing) {
      const r = await placeOrder();
      if (!r.ok) return showErr(r.error);
      if (r.pending) { confirmed = r.pending; step = STEPS.indexOf('Done'); render(); return; }
    }
    const id = existing ? existing.id : orderId;
    const body = { method, card: $('#card')?.value, routing: $('#routing')?.value, account: $('#account')?.value, save: !!($('#saveMethod') && $('#saveMethod').checked) };
    const { ok, j } = await api(`/api/orders/${id}/pay`, body);
    if (!ok) return showErr(j.error || 'Payment failed. Please try again.');
    if (j.redirect) { location.href = j.redirect; return; }
    confirmed = j.order; existing = null; step = STEPS.indexOf('Done'); render();
  } finally { busy = false; if (STEPS[step] !== 'Done') updateNext(); }
}

$('#backBtn').addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
$('#nextBtn').addEventListener('click', async () => {
  if (!canContinue() || busy) return;
  const name = STEPS[step];
  if (name === 'Pay') return pay(CFG.stripe ? 'stripe' : payMethod);
  if (name === 'Where' && isShip()) { step++; render(); return; }
  if (name === 'Where') {
    busy = true; updateNext();
    try {
      const { ok, j } = await api('/api/availability', payload());
      if (!ok) return;
      avail = j;
      if (S.schedule.date && ![...avail.days, ...avail.rush].some((d) => d.date === S.schedule.date)) { S.schedule.date = ''; S.rush = false; persist(); }
    } finally { busy = false; updateNext(); }
    if (!avail || !avail.days) return;
  }
  if (name === 'When' && !avail && !isShip()) return;
  step++; render();
});

// ---------- boot ----------
(async function boot() {
  CFG = (await api('/api/config')).j;
  if (S.service && !CFG.services[S.service]) { S.service = ''; persist(); } // retired services (delivery-only / pickup-only)
  const qs = new URLSearchParams(location.search);
  if (qs.get('order')) {
    const id = qs.get('order');
    const url = qs.get('session_id') ? `/api/orders/${id}/verify?session_id=${encodeURIComponent(qs.get('session_id'))}` : `/api/orders/${id}`;
    const o = (await api(url)).j.order;
    if (o && (o.status === 'confirmed' || o.status === 'pending_approval')) { confirmed = o; quoteData = o.quote; step = STEPS.indexOf('Done'); }
    else if (o && o.status === 'awaiting_payment') { existing = o; step = STEPS.indexOf('Pay'); }
    history.replaceState(null, '', '/');
  } else if (S.service && S.schedule.date) {
    // Returning mid-booking: re-fetch route days so the date step works.
    avail = (await api('/api/availability', payload())).j;
  }
  render();
})();
