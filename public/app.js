/* CAD online ordering — vanilla JS, no build step. 4 steps: What → Where → When → Review & pay. */
// Never let the browser restore an old scroll position on load/back; every step starts at the very top.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const STEPS = ['What', 'Where', 'When', 'Pay', 'Done'];
const STEP_TITLES = { What: 'What', Where: 'Where', When: 'When', Pay: 'Review & pay' };

const emptyAddr = () => ({
  street: '', city: '', state: 'CA', zip: '', country: 'United States', locationType: '', business: '',
  contactName: '', contactPhone: '', contactRole: '', contactRoleOther: '', sameAsMe: true, hours: '', noStreetNumber: false,
  accessMode: '', stairFlights: '', stairDir: '', stairTurns: '', stairPhotos: [],
  serviceElevator: '', dock: '', elevatorStairs: '', doorway: '', doorPhotos: [], narrowestIn: '', accessReview: false,
  floor: '', loadingDock: false, elevator: false, stairs: 0, steps: false, stairKind: '',
  fits: '', fitNote: '', pathType: '', elevatorType: '', elevatorFit: '', elevatorAck: false, parkingRestricted: false, parkingNote: '', technicalCarry: false, sitePhotos: [],
  centerHeight: '', wallType: '', hardware: '', highInstall: false, installLocation: '', wallPhotos: [],
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
    street: a.street || '', city: a.city || '', state: a.state == null ? 'CA' : String(a.state), zip: a.zip || '', country: a.country || 'United States', locationType: a.locationType || '', business: a.business || '',
    contactName: a.contactName || '', contactPhone: a.contactPhone || '', contactRole: a.contactRole || '', contactRoleOther: a.contactRoleOther || '', sameAsMe: a.sameAsMe === undefined ? true : !!a.sameAsMe, hours: a.hours || '', noStreetNumber: a.noStreetNumber === true,
    accessMode: a.accessMode || '', stairFlights: a.stairFlights ?? '', stairDir: a.stairDir || '', stairTurns: a.stairTurns || '', stairPhotos: a.stairPhotos || [],
    serviceElevator: a.serviceElevator || '', dock: a.dock || '', elevatorStairs: a.elevatorStairs || (a.elevatorSteps === 'steps' ? 'steps' : ''), doorway: a.doorway || '', doorPhotos: a.doorPhotos || [], narrowestIn: a.narrowestIn ?? '', accessReview: !!a.accessReview,
    floor: a.floor || '', loadingDock: !!(a.loadingDock || a.parking === 'Loading dock'), elevator: !!a.elevator,
    stairs: a.stairs === '' ? '' : (Number(a.stairs) || 0), steps: !!a.steps, stairKind: a.accessMode ? (a.stairKind || '') : '',
    fits: a.fits || '', parkingRestricted: !!a.parkingRestricted, parkingNote: a.parkingNote || '',
    technicalCarry: !!a.technicalCarry, sitePhotos: a.sitePhotos || [],
    fitNote: a.fitNote || '', pathType: a.pathType || '', elevatorType: a.elevatorType || '', elevatorFit: a.elevatorFit || '', elevatorAck: a.elevatorAck === true,
    centerHeight: a.centerHeight || '', wallType: a.wallType || '', hardware: a.hardware || '', highInstall: !!a.highInstall, installLocation: a.installLocation || (a.highInstall ? 'high' : ''), wallPhotos: a.wallPhotos || [],
    notes: extras.join(' · '),
  };
};
let pcSeq = 0;
const newPieceId = () => 'pc' + Date.now().toString(36) + (pcSeq++).toString(36) + Math.random().toString(36).slice(2, 6);
// One entry = one piece, with a permanent internal id (labels like "Piece 3" renumber after a removal; the id never does).
const emptyItem = () => ({ id: newPieceId(), checkValue: false, type: 'painting', furnitureKind: 'Sofa', sizeClass: 'medium', description: '', materialNotes: '', w: '', h: '', d: '', weight: '', framed: '', glazing: '', frameType: '', framedGlass: false, fragile: false, weightUnsure: false, fitsStairwell: false, hangHeight: 'standard', centerHeight: '', hangWhere: '', hangWhereOther: '', hangBottomFt: '', hangPhotos: [], hardware: '', crateStatus: 'not_sure', value: '', photos: [], sizeClassOnly: false });

let CFG = null;
let step = 0;
const emptyHeard = () => ({
  repeatAnswer: '', repeatClient: false, source: '', sourceOther: '', sourceDetail: '',
  referrerKind: '', referrerName: '', referrerPhone: '', referrerEmail: '', businessName: '',
});
const fresh = () => ({
  service: '', crating: false, rush: false, dedicated: false, dedicatedPickup: false, dedicatedDelivery: false, customDate: false, declaredValueProtection: false, protectionDeclined: false, discountCode: '',
  items: [emptyItem()], pickup: emptyAddr(), dropoff: emptyAddr(),
  contact: { name: '', email: '', phone: '', company: '', clientType: '' },
  heard: emptyHeard(), referral: false, partner: { type: 'None', name: '', email: '', phone: '' }, payer: 'pickup', payerOther: { name: '', email: '', phone: '' },
  schedule: { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' }, notes: '',
  shipping: { serviceLevel: '', shipBy: '', arriveBy: '', flexible: false, customs: { name: '', phone: '', email: '' } },
  quoteOnly: false,
});
// Saved progress (Chad, Nov 25 2026): the draft lives in this browser's localStorage, so a long multi-piece order survives closing
// the tab. It comes back quietly on return, expires after DRAFT_DAYS, is cleared after a successful booking, and never holds card
// or bank details (those fields are read straight from the payment screen and are never part of the draft).
const DRAFT_DAYS = 14;
const DRAFT_KEYS = ['cad-order', 'cad-step', 'cad-sub', 'cad-ui'];
const NEVER_SAVE = ['card', 'cardNumber', 'cvc', 'cvv', 'exp', 'expiry', 'routing', 'account', 'accountNumber'];
const draftStore = (() => {
  let ls = null;
  try { ls = window.localStorage; const k = '__cad_t'; ls.setItem(k, '1'); ls.removeItem(k); } catch (_) { ls = null; }
  const mem = {};
  const raw = { get: (k) => { try { return ls ? ls.getItem(k) : (mem[k] ?? null); } catch (_) { return mem[k] ?? null; } },
    set: (k, v) => { try { if (ls) ls.setItem(k, v); else mem[k] = v; } catch (_) { mem[k] = v; } },
    del: (k) => { try { if (ls) ls.removeItem(k); } catch (_) { /* ignore */ } delete mem[k]; } };
  // Move a draft from the old per-tab storage (a tab opened before this change holds the newest work, so it wins).
  try { DRAFT_KEYS.forEach((k) => { const v = sessionStorage.getItem(k); if (v != null) { raw.set(k, v); if (k === 'cad-order') raw.set('cad-saved-at', String(Date.now())); sessionStorage.removeItem(k); } }); } catch (_) { /* ignore */ }
  const at = Number(raw.get('cad-saved-at') || 0);
  if (raw.get('cad-order') != null && at && Date.now() - at > DRAFT_DAYS * 864e5) { DRAFT_KEYS.forEach(raw.del); raw.del('cad-saved-at'); }
  return {
    getItem: raw.get,
    setItem: (k, v) => {
      if (k === 'cad-order') {
        try { const o = JSON.parse(v); NEVER_SAVE.forEach((f) => { delete o[f]; }); v = JSON.stringify(o); } catch (_) { /* keep as is */ }
        raw.set('cad-saved-at', String(Date.now()));
      }
      raw.set(k, v);
    },
    removeItem: (k) => { raw.del(k); if (k === 'cad-order') raw.del('cad-saved-at'); },
    clear: () => { DRAFT_KEYS.forEach(raw.del); raw.del('cad-saved-at'); },
  };
})();
const S = Object.assign(fresh(), JSON.parse(draftStore.getItem('cad-order') || 'null') || {});
NEVER_SAVE.forEach((f) => { delete S[f]; });
// A draft saved before this change may carry a quantity: expand it into separate pieces (and repair missing / repeated ids), so a refresh never shows or books one piece as ten.
const MAX_PIECES = 60;
const normalizePieces = (list) => {
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const n = Math.max(1, Math.min(MAX_PIECES, parseInt(String(it.qty ?? '').replace(/,/g, ''), 10) || 1));
    for (let k = 0; k < n; k++) {
      const c = { ...emptyItem(), ...JSON.parse(JSON.stringify(it)) }; delete c.qty;
      if (k > 0 || !c.id || seen.has(c.id)) c.id = newPieceId() + out.length;
      if (k > 0) c.checkValue = true; // an old draft's quantity became separate copies: the customer confirms each copied value before paying
      seen.add(c.id); out.push(c);
    }
  });
  return out.length ? out.slice(0, MAX_PIECES) : [emptyItem()];
};
S.items = normalizePieces(S.items);
// Save the expanded pieces (with their new ids) right away, so a second refresh shows exactly the same pieces.
if (draftStore.getItem('cad-order')) { try { draftStore.setItem('cad-order', JSON.stringify(S)); } catch (_) { /* storage full or blocked: the in-memory copy still works */ } }
S.pickup = migrateAddr(S.pickup);
S.dropoff = migrateAddr(S.dropoff);
// Saved before the access rebuild: nothing was really chosen, so ask again rather than keep old defaults.
['pickup', 'dropoff'].forEach((k) => { if (!S[k].accessMode) { S[k].elevator = false; S[k].loadingDock = false; S[k].stairs = 0; S[k].steps = false; S[k].stairKind = ''; S[k].floor = ''; if (S[k].fits === 'yes') S[k].fits = ''; } CADAccess.normalize(S[k]); });
S.contact = { ...fresh().contact, ...(S.contact || {}) };
S.partner = { ...fresh().partner, ...(S.partner || {}) };
S.heard = { ...emptyHeard(), ...(S.heard || {}) };
if (!S.heard.repeatAnswer) {
  if (S.heard.repeatClient) S.heard.repeatAnswer = 'yes';
  else if (S.heard.source) S.heard.repeatAnswer = 'no';
}
S.heard.repeatClient = S.heard.repeatAnswer === 'yes';
if (!S.heard.source && S.referral) {
  S.heard.source = 'referral';
  const typeMap = { 'Gallery': 'gallery', 'Furniture showroom': 'showroom', 'Interior designer': 'designer', 'Auction house': 'auction' };
  if (!S.heard.referrerKind) S.heard.referrerKind = typeMap[S.partner.type] || (S.partner.type && S.partner.type !== 'None' ? 'other_business' : '');
  if (!S.heard.referrerName) S.heard.referrerName = S.partner.name || '';
  if (!S.heard.referrerEmail) S.heard.referrerEmail = S.partner.email || '';
  if (!S.heard.businessName && S.heard.referrerKind && S.heard.referrerKind !== 'friend') S.heard.businessName = S.partner.name || '';
}
['pickup', 'dropoff'].forEach((k) => { if (S[k] && !S[k].installLocation && S[k].highInstall) S[k].installLocation = 'high'; });
S.payerOther = { ...fresh().payerOther, ...(S.payerOther || {}) };
S.schedule = { ...fresh().schedule, ...(S.schedule || {}) };
S.shipping = { ...fresh().shipping, ...(S.shipping || {}), customs: { ...fresh().shipping.customs, ...((S.shipping && S.shipping.customs) || {}) } };

let orderId = null, orderSig = null;   // order created at the moment of payment
let existing = null;                    // an order opened from a payment link (?order=…)
let payCanceled = false;                // back from Stripe without paying (?canceled=1)
// First dates shown, then a Show more dates button (Dot, Nov 18).
const FIRST_DAYS = 3; const moreDays = { pu: false, del: false };
const dayWindow = (days, sel, key) => { const hide = !moreDays[key] && days.length > FIRST_DAYS && !days.slice(FIRST_DAYS).some((d) => d.date === sel); return { list: hide ? days.slice(0, FIRST_DAYS) : days, btn: hide ? `<button type="button" class="linkbtn show-more-dates" data-moredays="${key}">Show more dates (${days.length - FIRST_DAYS} more)</button>` : '' }; };
let quoteData = null, avail = null, confirmed = null, delAvail = null;
let payMethod = 'card';
let payPicked = false; // the customer tapped a payment method (otherwise larger orders start on Pay by bank)
const zelleOn = () => !!(CFG && CFG.payment && CFG.payment.zelle && CFG.payment.zelle.enabled);
const bankFirst = (q) => !!(q && CFG && CFG.payment && Number(q.dueNow || q.total) >= Number(CFG.payment.bankProminentFrom || Infinity));
// Same words as the confirmation email (lib/email.js zelleLines).
const zelleHtml = (amt, id, dueBy) => { const Z = CFG.payment.zelle; const due = dueBy ? new Date(dueBy).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT' : ''; return `<div class="zelle-box" data-zelle>
  <p><b>Pay by Zelle${amt != null ? ': ' + fmt(amt) : ''}</b> to <b>${esc(Z.payee)}</b> at <b>${esc(Z.email)}</b>.</p>
  <p>Put your order number${id ? ` <b>${esc(id)}</b>` : ''} in the Zelle memo.</p>
  <p>Payment is due within 24 hours${due ? ` (by ${esc(due)})` : ''}. Split transfers are OK as long as the full amount arrives on time.</p>
  <p class="mini">Your time slot is held for 24 hours. If payment isn’t received by then, the slot may be released.</p></div>`; };
let saveMethod = false;
let busy = false;

// Screen-skipping flags (Nov 25 2026) and "return to review" live with the saved progress, so a refresh mid-edit still goes back to review.
const UI = { showContact: [], showPayer: false, showList: false };
// The payer screen is skipped while the payer is the pre-selected contact; review shows it as a line with Edit.
const payerShown = () => UI.showPayer || !['pickup', 'dropoff'].includes(S.payer);
let returnToReview = false; // set by Edit on the review screen: the next Next goes straight back to review
const saveUi = () => { try { draftStore.setItem('cad-ui', JSON.stringify({ ...UI, rtr: !!returnToReview })); } catch (_) { /* ignore */ } };
const persist = () => { if (STEPS[step] === 'Done') return; (S.items || []).forEach(tidyItemWeight); tidyAccess('pickup'); tidyAccess('dropoff'); syncHeardFlag(S.heard); draftStore.setItem('cad-order', JSON.stringify(S)); draftStore.setItem('cad-step', String(step)); saveUi(); };
// What actually gets priced / booked: drop fields that don't apply to the chosen service.
const payload = () => {
  applySameAsMe('pickup'); applySameAsMe('dropoff'); applySamePickup(); tidyAccess('pickup'); tidyAccess('dropoff'); // default on-site contact = the booker
  const o = JSON.parse(JSON.stringify(S));
  const sv = (CFG && CFG.services[o.service]) || {};
  // Dedicated trip per side (Chad, Nov 25 2026). Install only has one stop: the delivery side.
  if (!sv.needsPickup) o.dedicatedPickup = false;
  o.dedicated = !!(o.dedicatedPickup || o.dedicatedDelivery);
  if (!o.dedicated) o.customDate = false;
  if (!o.customDate) delete o.schedule.customDateNote;
  else { o.schedule.date = ''; o.schedule.deliveryDate = ''; }
  // "Same as me": no role is sent; the server uses the booker's own "I am a…" (never a silent default).
  ['pickup', 'dropoff'].forEach((k) => { if (o[k] && o[k].sameAsMe) { o[k].contactRole = ''; o[k].contactRoleOther = ''; } });
  const clearInstall = (a) => { a.centerHeight = ''; a.wallType = ''; a.hardware = ''; a.highInstall = false; a.installLocation = ''; a.wallPhotos = []; };
  clearInstall(o.pickup);
  if (sv.install && o.items.some(isHung)) {
    if (!o.dropoff.wallType) o.dropoff.wallType = 'Not sure';
    // Hardware is asked per piece now (Chad, Nov 21 2026); the stop keeps a one-line summary for the schedule notes and emails.
    o.dropoff.hardware = o.items.map((it, i) => (isHung(it) && it.hardware ? `Piece ${i + 1}: ${hardwareText(it.hardware)}` : '')).filter(Boolean).join('; ') || 'Not sure';
  } else clearInstall(o.dropoff);
  o.items.forEach((it) => { if (!(sv.install && isHung(it))) delete it.hardware; });
  o.items.forEach((it) => {
    if (!(sv.install && isHung(it))) {
      it.hangHeight = 'standard'; it.centerHeight = ''; it.hangWhere = ''; it.hangWhereOther = ''; it.hangBottomFt = ''; it.hangPhotos = [];
    } else if (it.hangHeight !== 'higher') {
      it.hangHeight = 'standard';
      if (!String(it.centerHeight || '').trim()) it.centerHeight = '59';
      it.hangWhere = ''; it.hangWhereOther = ''; it.hangBottomFt = ''; it.hangPhotos = [];
    }
  });
  if (!sv.needsPickup) {
    o.pickup = { street: '' };
    o.schedule.deliveryLater = false;
    o.schedule.deliveryDate = '';
    o.schedule.deliveryTimePref = 'none';
    o.schedule.deliveryTimeNote = '';
  } else if (sv.needsDropoff && o.schedule.deliveryDate) {
    o.schedule.deliveryLater = o.schedule.deliveryDate > o.schedule.date;
  }
  ['pickup', 'dropoff'].forEach((k) => { if (o[k]) CADAccess.normalize(o[k]); });
  if (!o.dropoff.parkingRestricted) o.dropoff.parkingNote = '';
  if (!o.pickup.parkingRestricted) o.pickup.parkingNote = '';
  ['pickup', 'dropoff'].forEach((k) => { if (o[k] && !o[k].technicalCarry) o[k].sitePhotos = []; });
  ['pickup', 'dropoff'].forEach((k) => { if (o[k] && (o[k].noStreetNumber !== true || /\d/.test(String(o[k].street || '')))) o[k].noStreetNumber = false; });
  if (intlDest(o.dropoff)) o.dropoff.state = '';
  if (isShipState()) { o.schedule = { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' }; o.rush = false; o.dedicated = false; o.dedicatedPickup = false; o.dedicatedDelivery = false; o.crating = false; clearInstall(o.dropoff); if (!intlDest(o.dropoff)) o.shipping.customs = { name: '', phone: '', email: '' }; }
  else delete o.shipping;
  o.items.forEach((it) => { cleanFraming(it); delete it.framedGlass; tidyItemWeight(it); });
  syncHeardPayload(o);
  // No member rate (Chad, Nov 19 2026). Protection is included unless the customer explicitly removed it; the discount code is the applied one only.
  ['member', 'memberCode', 'memberVerified', 'memberCompany', 'memberError', 'discountInput', 'discountMsg'].forEach((k) => delete o[k]);
  delete o.protectionDeclined; // always included (Chad, Nov 23 2026)
  if (!String(o.discountCode || '').trim()) delete o.discountCode;
  return o;
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nearest5 = (n) => { const x = Number(n); if (!Number.isFinite(x) || x === 0) return 0; const sign = x < 0 ? -1 : 1; const cents = Math.round(Math.abs(x) * 100); const rem = cents % 500; return sign * ((rem >= 250 ? cents - rem + 500 : cents - rem) / 100); };
const fmt = (n) => { const x = Number(n || 0); const cents = Math.round(x * 100) % 100 !== 0; return '$' + x.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }); };
const uncomma = (s) => String(s ?? '').replace(/,/g, '');
const num = (s) => { const n = Number(uncomma(s)); return Number.isFinite(n) ? n : 0; };
const fmtNum = (s) => {
  if (s == null || s === '') return '';
  const raw = uncomma(s);
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(s);
  const neg = raw.trim().startsWith('-');
  const [i, d] = raw.replace(/^-/, '').split('.');
  const grouped = (i || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (d != null ? '.' + d : '');
};
const COMMA_PATH = /\.(value|weight)$/;
const DEC_PATH = /\.(weight|value)$/;
const formatGrouped = (raw, allowDecimal) => {
  const s = uncomma(raw);
  if (s === '') return '';
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  if (allowDecimal) {
    const m = body.match(/^(\d*)(\.(\d*)?)?$/);
    if (!m) return null;
    const int = m[1] || (m[2] ? '0' : '');
    return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[2] || '');
  }
  if (!/^\d*$/.test(body)) return null;
  return (neg ? '-' : '') + body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const commaDisplay = (path, val) => { const f = formatGrouped(val, DEC_PATH.test(path)); return f == null ? String(val ?? '') : f; };
const PHONE_PATH = /^(contact\.phone|heard\.referrerPhone|pickup\.contactPhone|dropoff\.contactPhone|payerOther\.phone)$/;
const unphone = (s) => {
  const raw = String(s ?? '').trim();
  if (raw.startsWith('+')) return raw;
  return raw.replace(/\D/g, '');
};
const formatPhone = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (!d) return '';
  if (d.length <= 3) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6, 10);
};
const restoreDigitCaret = (el, formatted, digitsBefore) => {
  let seen = 0, pos = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) { seen++; if (seen >= digitsBefore) { pos = i + 1; break; } }
  }
  try { el.setSelectionRange(pos, pos); } catch (err) {}
};
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
// A California address (US, state CA or a 9xx California ZIP). Used to stop CA-to-CA jobs from going through Shipping.
const inCA = (a) => {
  if (!a || outsideCA(a)) return false;
  const st = String(a.state || '').trim();
  const z = String(a.zip || '').match(/\b\d{5}\b/);
  return /^(ca|calif\.?|california)$/i.test(st) || !!(z && (() => { const n = parseInt(z[0].slice(0, 3), 10); return n >= 900 && n <= 961; })());
};
// The destination needs a 5-digit ZIP before the "stays in California" note can show, so it never fires on a half-typed form.
const shipInsideCA = () => shipService() && inCA(S.pickup) && inCA(S.dropoff) && /\b\d{5}\b/.test(String(S.dropoff.zip || ''));
const caNoteHtml = () => `<div class="note ca-ship" data-cashipnote><b>This trip stays in California.</b> Shipping is for destinations outside California. Within California we deliver white glove ourselves. <button type="button" class="btn primary ca-switch" data-switchpd>Switch to Pickup + Delivery</button><span class="mini">Everything you entered stays.</span></div>`;
const outOfState = () => !shipService() && !!S.service && ((svc().needsPickup && outsideCA(S.pickup)) || outsideCA(S.dropoff));
const isShipState = () => shipService() || outOfState();
const isShip = isShipState;
const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; persist(); };
const isQuote = (q) => !!(q && q.paymentPlan === 'quote');
const special = () => !!(isShip() || S.rush || S.crating || (S.customDate && dedAny()) || isQuote(quoteData));
const hasInstall = () => !!svc().install;
// Only wall-hung pieces get hung. Sculpture, furniture and freestanding pieces are placed (never hung or installed).
const DEFAULT_HUNG_DECOR = ['Wall Decor', 'Wall sculptures', 'Tapestries & textiles', 'Mirror', 'Chandelier', 'Sconces'];
const quoteHangList = () => ((CFG && CFG.pricing && CFG.pricing.quoteHang) || ['Chandelier', 'Sconces']);
const hungDecorList = () => {
  const fromCfg = (CFG && CFG.pricing && CFG.pricing.hungDecor) || DEFAULT_HUNG_DECOR;
  return [...new Set([...fromCfg, ...quoteHangList()])];
};
// Wall pieces: Painting, Mirror, Other wall art (incl. wall sculpture) hang on a wall, so they're installable.
const WALL_TYPES = ['painting', 'photograph', 'mirror', 'wallart'];
const FRAMING_TYPES = ['painting', 'photograph', 'wallart'];
// Glass? is its own question for paintings, photographs and other wall art, framed or not (Chad, Nov 21 2026). Mirrors are glass already.
const GLASS_TYPES = ['painting', 'photograph', 'wallart'];
const FRAME_TYPE_OPTS = [['small', 'Small / lightweight'], ['medium', 'Medium'], ['large', 'Large / heavy / ornate']];
const FRAME_TYPE_ASK_OVER = 48;
const isHung = (it) => WALL_TYPES.includes(it.type || 'painting') || (it.type === 'decor' && hungDecorList().includes(it.furnitureKind));
const maxWH = (it) => Math.max(Number(it.w) || 0, Number(it.h) || 0);
const needsGlass = (it) => GLASS_TYPES.includes(it.type || 'painting');
const needsFrameType = (it) => FRAMING_TYPES.includes(it.type || 'painting') && it.framed === 'yes' && maxWH(it) > FRAME_TYPE_ASK_OVER;
const cleanFraming = (it) => {
  if (!FRAMING_TYPES.includes(it.type)) { it.framed = ''; it.glazing = ''; it.frameType = ''; }
  else {
    if (it.framed !== 'yes') it.frameType = '';
    if (!needsGlass(it)) it.glazing = '';
    if (!needsFrameType(it)) it.frameType = '';
  }
};
// Décor → Mirror is a second entry point for the same Mirror item and pricing.
const routeDecorMirror = (it) => {
  if (!it || it.type !== 'decor' || it.furnitureKind !== 'Mirror') return false;
  it.type = 'mirror';
  cleanFraming(it);
  return true;
};
const framingOk = (it) => {
  if (!FRAMING_TYPES.includes(it.type || 'painting')) return true;
  if (it.framed !== 'yes' && it.framed !== 'no') return false;
  if (needsGlass(it) && !['yes', 'no'].includes(it.glazing)) return false;
  if (it.framed === 'no') return true;
  if (needsFrameType(it) && !FRAME_TYPE_OPTS.some(([v]) => v === it.frameType)) return false;
  return true;
};
const TYPE_LABEL = (t) => (ITEM_TYPES.find(([v]) => v === (t || 'painting')) || [, t])[1];
const framingText = (it) => {
  if (it.type === 'mirror') return 'Glass (mirror)';
  if (!FRAMING_TYPES.includes(it.type || 'painting')) return '';
  const glassBit = needsGlass(it) ? (it.glazing === 'yes' ? 'glass' : it.glazing === 'no' ? 'no glass' : '') : '';
  if (it.framed === 'yes') {
    const bits = ['Framed', glassBit];
    if (it.frameType) { const lab = (FRAME_TYPE_OPTS.find(([v]) => v === it.frameType) || [])[1]; if (lab) bits.push(lab); }
    return bits.filter(Boolean).join(' · ');
  }
  return it.framed === 'no' ? ['Unframed', glassBit].filter(Boolean).join(' · ') : '';
};
const hasHanging = () => hasInstall() && S.items.some(isHung);
const isPlaced = (it) => !isHung(it);
const longDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '');
const shortDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const TIME_PREF_OPTS = CADAccess.TIME_PREFS;
const timePrefSummary = (pref, note) => [CADAccess.timePrefText(pref), String(note || '').trim()].filter(Boolean).join(' — ');
const windowText = (w) => (w || '').replace('Flexible / all day', 'flexible, all day');
const api = async (url, body) => {
  try {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  } catch (e) {
    return { ok: false, net: true, j: { error: 'We couldn’t send that. Check your connection and tap again.' } };
  }
};

// Step-1 service icons (v3). 24px grid, 1.3px stroke, round caps/joins; drawn at 30px in the 44px tile.
// Composed parts are scaled with <g transform>; their stroke-width is divided by the scale so every line renders at the same 1.3px weight.
// Van, painting, hands, plane and truck are original drawings.
const iconSvg = (label, body) => `<svg viewBox="0 0 24 24" role="img" aria-label="${label}" width="30" height="30" fill="none" stroke="currentColor" stroke-width="0.87" style="overflow:visible" stroke-linecap="round" stroke-linejoin="round"><title>${label}</title>${body}</svg>`;
const ICONS = {
  // Long-wheelbase high-roof van (Sprinter-style) in profile: flat roof, sloped windshield, short hood, small wheels.
  pickup_delivery: iconSvg("Mercedes Sprinter-style high-roof van", '<circle cx="5.6" cy="17" r="1.75"/><circle cx="18.6" cy="17" r="1.75"/><path d="M7.35 17h9.5"/><path d="M3.85 17H2.2a1 1 0 0 1-1-1V7.6A1.6 1.6 0 0 1 2.8 6h12.6c.55 0 1.05.25 1.4.7l3.3 4.3 2 .65c.6.2 1 .75 1 1.4V16a1 1 0 0 1-1 1h-1.75"/><path d="M15 7.8h1.6l2.4 3.2h-4z"/>'),
  // The same van plus the same framed painting used by Install only, separated diagonally so they never touch.
  delivery_install: iconSvg("Van and framed painting", '<g transform="translate(0.3 9.6) scale(0.7)" stroke-width="1.243"><circle cx="5.6" cy="17" r="1.75"/><circle cx="18.6" cy="17" r="1.75"/><path d="M7.35 17h9.5"/><path d="M3.85 17H2.2a1 1 0 0 1-1-1V7.6A1.6 1.6 0 0 1 2.8 6h12.6c.55 0 1.05.25 1.4.7l3.3 4.3 2 .65c.6.2 1 .75 1 1.4V16a1 1 0 0 1-1 1h-1.75"/><path d="M15 7.8h1.6l2.4 3.2h-4z"/></g><g transform="translate(11.6 -1.6) scale(0.56)" stroke-width="1.554"><rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 17 8 12.5l4.5 4.5"/><path d="m11.5 16 3-3 5.9 5.9"/><circle cx="15.5" cy="9" r="1.5"/></g>'),
  // Two open cupped hands (thin 0.53 lines, about 50% larger) holding a smaller framed painting raised above them with clear space all around.
  install_only: iconSvg("Two open hands holding a framed painting", '<g transform="translate(12.5 12) scale(1.15) translate(-12 -12)"><g transform="translate(-7.382 -5.413) scale(0.03785)"><g transform="translate(0,-20) translate(512,492) scale(0.86) translate(-512,-492)" stroke-width="23.26"><rect x="312" y="202" width="400" height="290" rx="20"/><path d="M352,452 L487,312 L552,377 L597,342 L672,452"/><circle cx="622" cy="277" r="24"/></g><g transform="translate(-72,28) translate(414,492) scale(0.75) translate(-414,-492)"><g transform="translate(20,0) rotate(10 370 735)" stroke-width="18.67"><path d="M322,735 L322,662 C300,640 245,590 228,560 C215,535 216,470 222,430 C226,408 238,402 248,404 C262,407 268,420 266,440 C264,458 264,475 278,497 "/><path d="M318,598 L268,546 C255,532 258,512 272,508 C282,505 290,510 298,520 L330,551 C370,560 400,585 410,620 C416,645 417,690 417,735"/></g></g><g transform="translate(72,28) translate(610,492) scale(0.75) translate(-610,-492)"><g transform="translate(1004,0) scale(-1,1) rotate(10 370 735)" stroke-width="18.67"><path d="M322,735 L322,662 C300,640 245,590 228,560 C215,535 216,470 222,430 C226,408 238,402 248,404 C262,407 268,420 266,440 C264,458 264,475 278,497 "/><path d="M318,598 L268,546 C255,532 258,512 272,508 C282,505 290,510 298,520 L330,551 C370,560 400,585 410,620 C416,645 417,690 417,735"/></g></g></g></g>'),
  // Airliner (top-left, close to the classic plane glyph) and box truck (bottom-right) with clear space between them.
  crating_shipping: iconSvg("Airplane and truck, air or ground shipping", '<g transform="translate(-0.9 -1.2) scale(0.78)" stroke-width="1.115"><path d="M19.8 10.8c1.6 0 2.7.6 2.7 1.2s-1.1 1.2-2.7 1.2h-5.3l-4.6 7.3H8.2l2.6-7.3H5.2l-1.7 2.4H2.3l.9-3.6-.9-3.6h1.2l1.7 2.4h5.6L8.2 3.5h1.7l4.6 7.3z"/></g><g transform="translate(8.6 9.6) scale(0.7)" stroke-width="1.243"><circle cx="6" cy="17" r="1.75"/><circle cx="17.6" cy="17" r="1.75"/><path d="M7.75 17h8.1"/><path d="M4.25 17H2.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1H12a1 1 0 0 1 1 1V9h4.4c.35 0 .65.15.85.45l2.5 3.7c.12.17.18.37.18.57V16a1 1 0 0 1-1 1h-.6"/><path d="M13 9v8"/></g>'),
};

const DESC = {
  pickup_delivery: 'White glove pickup and delivery, placed exactly where you want it.',
  delivery_install: 'Everything above, plus expert installation of paintings, mirrors and wall decor.',
  install_only: 'Already on site. We hang paintings, mirrors and wall decor.',
  crating_shipping: 'Outside California, anywhere in the US or overseas.',
};
// CAD are fine art handlers, not movers: the items-step heading names what we are actually doing for the chosen service.
const SVC_VERB = { pickup_delivery: 'delivering', delivery_install: 'delivering and installing', install_only: 'installing', crating_shipping: 'shipping', delivery: 'delivering', pickup: 'picking up' };
const svcVerb = () => SVC_VERB[S.service] || 'delivering';
const svcVerbShort = () => ({ delivering: 'deliver', 'delivering and installing': 'deliver and install', installing: 'install', shipping: 'ship', 'picking up': 'pick up' }[svcVerb()] || 'deliver');
// Subtitle under each service title on step 1: says at a glance where the service applies.
const SUBTITLE = {
  pickup_delivery: 'Within California',
  delivery_install: 'Within California',
  install_only: 'Within California',
  crating_shipping: 'Domestic & International',
};
const ITEM_TYPES = [['painting', 'Painting'], ['photograph', 'Photograph'], ['mirror', 'Mirror'], ['wallart', 'Other wall art'], ['sculpture', 'Sculpture'], ['furniture', 'Furniture'], ['decor', 'Décor'], ['other', 'Other fragile or valuable item'], ['custom', 'Other request']];
const INSTALL_TYPES = ['painting', 'photograph', 'mirror', 'wallart', 'decor', 'custom'];
// Install only = hanging wall pieces already on site. Sculpture, furniture and other pieces are placed during a delivery, not hung.
const itemTypes = () => (S.service === 'install_only' ? ITEM_TYPES.filter(([v]) => INSTALL_TYPES.includes(v)) : ITEM_TYPES);
const decorKinds = () => (S.service === 'install_only' ? (CFG.pricing.decorKinds || []).filter((k) => hungDecorList().includes(k)) : (CFG.pricing.decorKinds || []));
const isAccentKind = (kind) => {
  const p = (CFG && CFG.pricing) || {};
  return (p.accentsKinds || []).includes(kind) || kind === p.accentsKind;
};
const sizeOptionsFor = (type, kind) => {
  const labels = ((CFG && CFG.pricing) || {}).sizeLabels || {};
  if (type === 'decor' && isAccentKind(kind)) {
    return labels.accents || [['xs', 'Extra small'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xl', 'Extra large']];
  }
  return labels.standard || [['small', 'Small / light'], ['medium', 'Medium / average'], ['large', 'Large / heavy']];
};
const decorKindOptions = () => {
  const allowed = new Set(decorKinds());
  const groups = ((CFG && CFG.pricing) || {}).decorKindGroups;
  if (groups && groups.length) {
    return groups
      .map((g) => ({ group: g.label, items: (g.items || []).filter((k) => allowed.has(k)) }))
      .filter((g) => g.items.length);
  }
  return decorKinds();
};

// ---------- field helpers ----------
// "Piece 2" (one piece) or "Piece 2 (Oil on canvas)" (several), so a long order always says which piece a question is about.
const pieceName = (i) => {
  const it = S.items[Number(i)]; const d = String((it && it.description) || '').trim();
  return `Piece ${Number(i) + 1}${S.items.length > 1 && d ? ` (${d.length > 24 ? d.slice(0, 22) + '…' : d})` : ''}`;
};
const pieceTitle0 = (it, i) => `Piece ${i + 1}${String(it.description || '').trim() ? ' — ' + String(it.description).trim() : ''}`;
const qualifyLabel = (path, label) => {
  if (!label) return label;
  const m = String(path).match(/^items\.(\d+)\.(value|weight)$/);
  if (!m) return label;
  const piece = pieceName(m[1]);
  if (m[2] === 'value') return /Declared value/.test(label) ? `Declared value — ${piece} ($)` : `${label} — ${piece}`;
  if (/Approx\. weight/.test(label) || /Approx/.test(label)) return `Approx. weight — ${piece} (lb)`;
  if (/Weight/.test(label)) return `Weight — ${piece} (lb)`;
  return `${label} — ${piece}`;
};
const HEARD_SOURCES = [['referral', 'Referred by someone'], ['google', 'Google / online search'], ['ai', 'AI assistant (ChatGPT, etc.)'], ['social', 'Instagram / social media'], ['van', 'Saw our van / event'], ['other', 'Other']];
const REFERRER_KINDS = [['friend', 'Friend or family'], ['gallery', 'Gallery'], ['showroom', 'Furniture showroom'], ['designer', 'Interior designer'], ['auction', 'Auction house'], ['other_business', 'Other business']];
const BUSINESS_REFERRERS = ['gallery', 'showroom', 'designer', 'auction', 'other_business'];
const CONTACT_ROLES = ['Homeowner', 'Interior designer', 'Home / estate manager', 'Gallery owner', 'Gallery staff', 'Assistant', 'Art advisor / collector rep', 'Building manager / concierge', 'Other'];
const HANG_HEIGHTS = [['standard', 'Standard eye level (gallery height)'], ['higher', 'Higher than eye level']];
const HANG_WHERES = [['mantel', 'Above a mantel or fireplace (stool or ladder needed)'], ['high', 'Higher than eye level (stool or ladder needed)'], ['stairwell', 'In a stairwell (ladder needed)'], ['other', 'Other']];
const HANG_PICKS = [['standard', 'Eye level / gallery standard (57–60" to center)'], ['high', 'Higher than eye level (stool or ladder needed)'], ['mantel', 'Above a mantel or fireplace (stool or ladder needed)'], ['stairwell', 'In a stairwell (ladder needed)']];
const hangWhereLabel = (v) => (HANG_WHERES.find(([k]) => k === v) || [v, v])[1];
// Follow-up for every answer (Chad, Nov 21 2026): optional, one line, so CAD knows which search, assistant, platform or event.
const HEARD_DETAIL = {
  google: ['Which search or site? (optional)', 'e.g. Google search for art delivery'],
  ai: ['Which AI assistant? (optional)', 'e.g. ChatGPT, Gemini, Grok'],
  social: ['Which platform or account? (optional)', 'e.g. Instagram, a designer’s post'],
  van: ['Where did you see us? (optional)', 'e.g. our van in Carmel, an art fair'],
};
const heardLabel = (v) => (HEARD_SOURCES.find(([k]) => k === v) || [v, v])[1];
const referrerKindLabel = (v) => (REFERRER_KINDS.find(([k]) => k === v) || [v, v])[1];
const isBizReferral = () => {
  const h = S.heard || {};
  return !h.repeatClient && h.source === 'referral' && BUSINESS_REFERRERS.includes(h.referrerKind);
};
const defaultContactRole = (clientType) => {
  switch (clientType) {
    case 'Collector': return { role: 'Homeowner', other: '' };
    case 'Gallery': return { role: 'Gallery owner', other: '' };
    case 'Interior designer': return { role: 'Interior designer', other: '' };
    case 'Furniture showroom': return { role: 'Other', other: 'Furniture showroom' };
    case 'Auction house': return { role: 'Other', other: 'Auction house' };
    case 'Artist': return { role: 'Other', other: 'Artist' };
    default: return { role: 'Homeowner', other: '' };
  }
};
const applySameAsMe = (k) => {
  const a = S[k];
  if (!a || !a.sameAsMe) return;
  a.contactName = S.contact.name;
  a.contactPhone = S.contact.phone;
};
// "Same as pickup contact" (Nov 25 2026): the delivery contact copies the pickup contact (name, mobile, role) when that is someone else.
const samePickupOn = () => !!(S.dropoff && S.dropoff.samePickup && S.pickup && !S.pickup.sameAsMe && svc().needsPickup);
const applySamePickup = () => {
  if (!samePickupOn()) { if (S.dropoff && S.dropoff.samePickup && (!S.pickup || S.pickup.sameAsMe)) S.dropoff.samePickup = false; return; }
  const a = S.dropoff, pu = S.pickup;
  a.sameAsMe = false; a.contactName = pu.contactName; a.contactPhone = pu.contactPhone; a.contactRole = pu.contactRole; a.contactRoleOther = pu.contactRoleOther;
};
// Fewer screens on a simple order (Nov 25–26 2026):
// - the contact screen is skipped while "I'm the contact" is on (a one-line "Pickup contact: you · Change"
//   or "Delivery contact: you · Change" sits on the access screen, or on the address screen if access is skipped);
// - path / stairs questions are asked only for heavy or big pieces; the doorway question only for truly giant ones.
//   "Doors and fit" opens only when the doorway question is asked and the answer is No. If access questions
//   are skipped, leftover path answers are cleared so pricing treats the stop as no stairs / standard.
const contactShown = (k) => !(S[k] && S[k].sameAsMe) || UI.showContact.includes(k);
const accessQuestionsNeeded = () => CADAccess.asksPathAccess(S.items) || CADAccess.asksDoorwayAccess(S.items);
const doorsShown = (k) => CADAccess.asksDoorwayAccess(S.items) && !!(S[k] && S[k].stdDoorway === 'no');
function tidyAccess(k) {
  const a = S[k]; if (!a) return;
  if (!CADAccess.asksPathAccess(S.items)) {
    a.accessMode = ''; a.pathPick = ''; a.stairFlights = ''; a.stairDir = ''; a.stairTurns = ''; a.stairPhotos = [];
    a.serviceElevator = ''; a.dock = ''; a.elevatorStairs = ''; a.elevatorType = ''; a.elevatorFit = ''; a.elevatorAck = false;
    a.floor = ''; a.elevator = false; a.stairs = 0; a.steps = false; a.stairKind = ''; a.accessReview = false; a.stairsPlus = false;
  }
  if (!CADAccess.asksDoorwayAccess(S.items)) {
    a.stdDoorway = '';
    if (a.fitsAuto) { a.fits = ''; a.fitsAuto = false; }
    if (!CADAccess.asksPathAccess(S.items)) { a.doorway = ''; if (a.fitsAuto || a.fits === 'yes') { a.fits = ''; a.fitsAuto = false; } }
  } else {
    if (!a.stdDoorway && (a.fits || a.doorway)) a.stdDoorway = a.fits === 'yes' && a.doorway !== 'not_sure' ? 'yes' : 'no';
    if (a.stdDoorway === 'yes') { if (a.fits !== 'yes') { a.fits = 'yes'; a.fitsAuto = true; } if (a.doorway === 'not_sure') a.doorway = ''; }
    else if (a.stdDoorway === 'no' && a.fitsAuto) { a.fits = ''; a.fitsAuto = false; }
  }
  CADAccess.normalize(a);
}
function syncDoorway(k) { tidyAccess(k); }
const syncHeardFlag = (h) => {
  if (!h) return h;
  if (h.repeatAnswer === 'yes') h.repeatClient = true;
  else if (h.repeatAnswer === 'no') h.repeatClient = false;
  else h.repeatClient = !!h.repeatClient;
  return h;
};
const syncHeardPayload = (o) => {
  const h = syncHeardFlag({ ...emptyHeard(), ...(o.heard || {}) });
  if (h.repeatClient || !HEARD_DETAIL[h.source]) h.sourceDetail = '';
  if (h.repeatClient || h.source !== 'referral') { h.referrerKind = ''; h.referrerName = ''; h.referrerPhone = ''; h.referrerEmail = ''; h.businessName = ''; }
  if (h.repeatClient || h.source !== 'other') h.sourceOther = '';
  if (h.repeatClient) {
    o.referral = false;
    o.partner = { type: 'None', name: '', email: '', phone: '' };
    if (o.payer === 'partner') o.payer = 'me';
  } else if (h.source === 'referral') {
    o.referral = true;
    o.partner = {
      type: referrerKindLabel(h.referrerKind) || 'Referral',
      name: String(h.businessName || h.referrerName || '').trim(),
      email: String(h.referrerEmail || '').trim(),
      phone: String(h.referrerPhone || '').trim(),
    };
    if (o.payer === 'partner' && !BUSINESS_REFERRERS.includes(h.referrerKind)) o.payer = 'me';
  } else {
    o.referral = false;
    o.partner = { type: 'None', name: '', email: '', phone: '' };
    if (o.payer === 'partner') o.payer = 'me';
  }
  o.heard = h;
};

const V = window.CADValidate; // shared address + size checks (public/validate.js)
// Size boxes start blank. No spinner arrows (tapping one on an empty box fills in 1), and a realistic minimum per side.
const dimAttrs = (k, label) => `inputmode="decimal" min="${V.MIN_DIM[k]}" step="any" class="dim" aria-label="${label}"`;
const input = (path, label, opts = {}) => {
  const comma = opts.comma || COMMA_PATH.test(path);
  const phone = opts.phone || PHONE_PATH.test(path);
  const typ = comma ? 'text' : (opts.type || 'text');
  const val = comma ? esc(commaDisplay(path, get(path))) : phone ? esc(formatPhone(get(path))) : esc(get(path));
  const lab = qualifyLabel(path, label);
  const mode = opts.mode || (comma ? (DEC_PATH.test(path) ? 'decimal' : 'numeric') : (phone ? 'tel' : ''));
  const idp = opts.idp || 'f-';
  return `<div class="field">${lab ? `<label class="f" for="${idp}${path}">${lab}${opts.req ? ' <span class="req">Required</span>' : ''}</label>` : ''}
  <input id="${idp}${path}" type="${typ}" data-path="${path}" inputmode="${mode}" value="${val}" placeholder="${esc(opts.ph || '')}" ${opts.attrs || ''} ${comma ? 'data-comma="1"' : ''} ${phone ? 'data-phone="1"' : ''}></div>`;
};
const select = (path, label, options, opts = {}) => {
  const lab = label ? `<label class="f" for="f-${path}">${label}${opts.req ? ' <span class="req">Required</span>' : ''}</label>` : '';
  const ph = opts.placeholder ? `<option value="">${esc(opts.placeholder)}</option>` : '';
  const renderOpts = (list) => (list || []).map((o) => {
    if (o && o.group) return `<optgroup label="${esc(o.group)}">${renderOpts(o.items)}</optgroup>`;
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(get(path) ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('');
  return `<div class="field">${lab}<select id="f-${path}" data-path="${path}"${opts.rerender ? ' data-rerender' : ''}>${ph}${renderOpts(options)}</select></div>`;
};
const toggle = (path, label, hint = '', rerender = false, cls = '') => `<label class="toggle ${cls}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
  <span class="sw"><input type="checkbox" data-path="${path}" ${get(path) ? 'checked' : ''} ${rerender ? 'data-rerender' : ''}><i></i></span></label>`;
const seg = (path, options, cls = '') => `<div class="seg${cls ? ' ' + cls : ''}" data-seg="${path}">${options.map(([v, l]) => `<button type="button" class="${String(get(path)) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;

const stairKindOf = (a) => a.stairKind || (a.steps && !(Number(a.stairs) > 0) ? 'steps' : (Number(a.stairs) === 0.5 ? 'half' : (Number(a.stairs) > 0 ? 'flights' : 'none')));
const stairsText = (a) => {
  const kind = stairKindOf(a);
  if (kind === 'steps') return '3 steps or fewer';
  if (kind === 'half') return 'Half flight of stairs';
  const n = Number(a.stairs) || 0;
  if (kind === 'flights' || n > 0) return `${n} flight${n === 1 ? '' : 's'} of stairs`;
  return '';
};
const stairsArePresent = (a) => stairKindOf(a) !== 'none';
const anyStairsPresent = () => (!!svc().needsPickup && stairsArePresent(S.pickup)) || stairsArePresent(S.dropoff);
// Stairwell fit (pieces over 80"): real stairs at a stop always ask; "A few steps (3 or fewer)" only asks when the
// piece is also heavy (over CADAccess.HEAVY_LB). Same rule as needsStairwellFit in lib/pricing.js.
const accessStops = () => [...(svc().needsPickup ? [S.pickup] : []), S.dropoff];
const pieceNeedsStairwellFit = (it) => {
  if (!(Math.max(num(it.w), num(it.h), num(it.d)) > 80)) return false;
  const kinds = accessStops().map(stairKindOf);
  if (kinds.some((k) => k !== 'none' && k !== 'steps')) return true;
  return kinds.includes('steps') && num(it.weight) > CADAccess.HEAVY_LB;
};
// Hanging hardware on the back of each piece and the height surcharges (Chad, Nov 21 2026). Amounts come from /api/config.
const HARDWARE_OPTS = ['wire', 'zbar', 'cleat', 'needs_wire', 'needs_zbar', 'not_sure'];
const hwCfg = () => ((CFG && CFG.pricing && CFG.pricing.hangHardware) || {});
const hardwareText = (v) => ((hwCfg()[v] || {}).label || v);
const feeTag = (fee) => (fee > 0 ? ` <span class="fee">+${fmt(fee)}</span>` : '');
const hangFeeFor = (it, v) => {
  const hi = (CFG && CFG.pricing && CFG.pricing.hangInstall) || {};
  if (v === 'mantel') return Math.max(num(it.w), num(it.h), num(it.d)) > 72 ? ((hi.mantel || {}).over72 || 0) : ((hi.mantel || {}).upTo72 || 0);
  return typeof hi[v] === 'number' ? hi[v] : 0;
};
const hardwareField = (it, i) => `<div class="field" data-hardware="${i}" style="margin-top:12px"><label class="f">Is hanging hardware already on the back of the piece? — ${esc(pieceTitle0(it, i))}${req}</label>
  ${seg(`items.${i}.hardware`, HARDWARE_OPTS.filter((v) => hwCfg()[v]).map((v) => [v, esc(hwCfg()[v].label) + (v === 'not_sure' ? ' <span class="fee">we’ll confirm on site</span>' : feeTag(hwCfg()[v].fee))]), 'stack')}</div>`;
const hangSummary = (it, i) => {
  const name = pieceName(i);
  if (it.hangHeight === 'higher') {
    const where = it.hangWhere === 'other' && it.hangWhereOther ? it.hangWhereOther : (it.hangWhere ? hangWhereLabel(it.hangWhere) : '');
    const bottom = it.hangBottomFt ? ` · ${it.hangBottomFt} ft to the bottom` : '';
    const photos = it.hangPhotos && it.hangPhotos.length ? ` · ${CADAccess.plural(it.hangPhotos.length, 'photo')}` : '';
    return `${name}: ${where || 'Higher than eye level'}${bottom}${photos}`;
  }
  return `${name}: Standard eye level (${it.centerHeight || 59}" center)`;
};
const hangPieceBlock = (it, i) => {
  if (!isHung(it)) return '';
  const p = 'items.' + i;
  const title = esc(pieceTitle0(it, i));
  const higher = it.hangHeight === 'higher';
  const photos = (it.hangPhotos || []).map((ph2) => '<img src="' + esc(ph2) + '" alt="">').join('');
  const stairwell = higher && it.hangWhere === 'stairwell';
  const helpful = higher && it.hangWhere && it.hangWhere !== 'stairwell';
  let html = '<div class="field" style="margin-top:14px" data-hangpiece="' + i + '">';
  html += '<label class="f">Hanging height — ' + title + '<span class="req">Required</span></label>';
  it.hangPick = higher ? (it.hangWhere || '') : 'standard';
  html += seg(p + '.hangPick', HANG_PICKS.map(([v, l]) => [v, l + feeTag(hangFeeFor(it, v))]), 'stack');
  if (!higher) {
    html += input(p + '.centerHeight', 'Center height (in), optional', { type: 'number', ph: '59', attrs: 'inputmode="decimal"' });
    html += '<p class="mini">We hang at 57–60" to center (gallery standard). Adjust only if you have a preference.</p>';
  } else {
    if (it.hangWhere === 'other') html += input(p + '.hangWhereOther', 'Where?', { req: true, ph: 'Tell us where' });
    if (it.hangWhere) html += input(p + '.hangBottomFt', 'Approx. height to the bottom of the piece (ft), optional', { type: 'number', ph: 'e.g. 8', attrs: 'inputmode="decimal"' });
    if (stairwell) html += '<p class="mini req-line">Photos of the stairwell — required.</p><div class="photos" style="margin:0 0 12px">' + photos + '<label class="upload">＋ Photos of the stairwell' + req + '<input type="file" accept="image/*" multiple data-hangupload="' + i + '"></label></div>';
    if (helpful) html += '<p class="mini">Photos of the wall are helpful if you have them — you can also send them later.</p><div class="photos" style="margin:0 0 12px">' + photos + '<label class="upload">＋ Photos of the wall<span> (helpful)</span><input type="file" accept="image/*" multiple data-hangupload="' + i + '"></label></div>';
  }
  html += '</div>';
  return html;
};
const accessText = (a) => esc(CADAccess.summary(a).map((x) => (x === 'Ground level, straight in (no stairs)' ? 'Same level the whole way (no stairs)' : x)).join(' · ')) || 'Not answered yet';
// Access, asked like a phone call (Chad): how do we get in, then only the follow-ups that apply, then the doorway.
const photoRow = (key, field, label, required) => {
  const a = S[key] || {};
  return `<div class="photos" style="margin:0 0 12px">${(a[field] || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}<label class="upload">＋ ${label}${required ? req : '<span> (helpful)</span>'}<input type="file" accept="image/*" multiple data-accessupload="${key}.${field}"></label></div>`;
};
// The whole path, not just the front door (Chad, Nov 21 2026). Saved on the same access fields pricing already uses:
// "One flight" = stairs, 1 flight; "Two or more flights" = stairs, then 2 / 3 / 4+ (each flight is priced, so 2+ always costs more).
// Chad, Nov 23 2026: six answers, no "Not sure" (older saved answers still read).
const PATH_PICKS = [['ground', 'Same level (no stairs)'], ['steps', 'A few steps (3 or fewer)'], ['half', 'About half a flight'], ['stairs1', 'One flight'], ['stairs2', 'Two or more flights'], ['elevator', 'Elevator']];
const pathPickOf = (a) => {
  if (!a || !a.accessMode) return '';
  if (a.accessMode !== 'stairs') return a.accessMode;
  if (String(a.stairFlights) === 'half') return 'half';
  if (a.pathPick === 'stairs2' && String(a.stairFlights) !== '1') return 'stairs2';
  if (String(a.stairFlights) === '1') return 'stairs1';
  return String(a.stairFlights) ? 'stairs2' : (a.pathPick === 'stairs1' ? 'stairs1' : 'stairs2');
};
const manyPieces = () => S.items.length > 1;
const pathQuestion = (key) => (key === 'pickup'
  ? `How do we reach the spot where the ${manyPieces() ? 'pieces are' : 'piece is'} picked up?`
  : `How do we reach the spot where the ${manyPieces() ? 'pieces go' : 'piece goes'}?`);
function setPathPick(key, v) {
  const a = S[key];
  if (v === 'half') { setAccessAnswer(key, `${key}.accessMode`, 'stairs'); a.pathPick = 'half'; setAccessAnswer(key, `${key}.stairFlights`, 'half'); }
  else if (v === 'stairs1') { setAccessAnswer(key, `${key}.accessMode`, 'stairs'); a.pathPick = 'stairs1'; setAccessAnswer(key, `${key}.stairFlights`, '1'); }
  else if (v === 'stairs2') {
    const keep = CADAccess.FLIGHT_COUNTS.some(([k]) => k === String(a.stairFlights)) && a.accessMode === 'stairs' ? String(a.stairFlights) : '';
    setAccessAnswer(key, `${key}.accessMode`, 'stairs'); a.pathPick = 'stairs2'; setAccessAnswer(key, `${key}.stairFlights`, keep);
  } else { a.pathPick = v; setAccessAnswer(key, `${key}.accessMode`, v); }
  persist();
}
const accessBlock = (key, a) => {
  const A = CADAccess;
  const big = A.asksDoorwayAccess(S.items);
  const mode = a.accessMode;
  const firmNote = '<p class="mini">We need this for large or heavy pieces.</p>';
  const opt = (label) => `${label} (optional)`;
  a.pathPick = pathPickOf(a);
  let h = `<div class="field" data-access="${key}"><label class="f">${key === 'pickup' ? 'The whole way, from where we park to the piece' : 'The whole way, from where we park to where it’s placed or hung'}${req}</label>${seg(`${key}.pathPick`, PATH_PICKS, 'stack')}</div>`;
  if (mode === 'not_sure') h += `<p class="mini" style="margin:0 0 8px">${A.REVIEW_NOTE}</p>`;
  if (mode === 'elevator') {
    h += `<div class="field"><label class="f">Regular or service elevator?${req}</label>${seg(`${key}.elevatorType`, A.ELEV_TYPES, 'wrap')}</div>`;
    h += `<div class="field"><label class="f">Are you sure it will fit in the elevator?${req}</label>${seg(`${key}.elevatorFit`, A.ELEV_FIT, 'wrap')}</div>`;
    if (a.elevatorFit === 'not_sure') h += `<div data-reqblock="${key}-elevatorAck"><label class="toggle"><span>${esc(A.ACK_TEXT)}</span><span class="sw"><input type="checkbox" data-path="${key}.elevatorAck" ${a.elevatorAck ? 'checked' : ''}><i></i></span></label></div>`;
  }
  if (A.usesStairs(a) && mode === 'stairs' && a.pathPick === 'stairs2') {
    h += select(`${key}.stairFlights`, 'How many flights?', A.FLIGHT_COUNTS, { req: true, placeholder: 'Choose', rerender: true });
  }
  let d = '';
  if (mode) {
    d += `<div class="field"><label class="f">${opt('Doors')}</label>${seg(`${key}.doorway`, A.DOORWAYS, 'wrap')}</div>`;
    d += `<div class="field"><label class="f">${big ? 'Will everything fit easily?' + req : opt('Will everything fit easily?')}</label>${seg(`${key}.fits`, A.FITS, 'wrap')}</div>`;
    if (a.fits === 'tight') d += input(`${key}.fitNote`, opt('What’s tight?'), { ph: 'e.g. Narrow hallway turn', attrs: 'maxlength="200"' });
    if (A.usesStairs(a) || a.fits === 'tight' || a.fits === 'not_sure') {
      const need = A.stairPhotosNeeded(a);
      d += photoRow(key, A.usesStairs(a) ? 'stairPhotos' : 'doorPhotos', A.usesStairs(a) ? 'Photos of the stairs and path' : 'Photos of the tight spot', need);
    }
  }
  const x = `<div class="field"><label class="f">${opt('Any outdoor or rough path?')}</label>${seg(`${key}.pathType`, A.PATH_TYPES, 'wrap')}</div>
        ${A.roughPath(a) ? `<div class="photos" style="margin:0 0 12px">${(a.sitePhotos || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}<label class="upload">＋ Photos of the path${A.sitePhotosNeeded(a, S.items) ? req : '<span> (helpful)</span>'}<input type="file" accept="image/*" multiple data-siteupload="${key}"></label></div>` : ''}
        ${toggle(`${key}.parkingRestricted`, 'Parking or loading restrictions', '', true)}
        ${a.parkingRestricted ? input(`${key}.parkingNote`, '', { ph: 'e.g. Loading zone only 9–11am, permit needed', attrs: 'aria-label="Parking or loading restrictions"' }) : ''}
        ${input(`${key}.hours`, 'Access hours', { ph: 'e.g. 9am–5pm' })}`;
  return { inn: h, doors: d, extra: x };
};


// ---------- pricing blocks ----------
const feeNoteHtml = (q) => (q && q.accessFeeNote ? `<p class="mini access-fee-note" data-access-fee-note>${esc(q.accessFeeNote)}</p>` : '');
const payPlan = (q) => {
  if (isQuote(q)) {
    return `<div class="plan">
      ${q.tripPremium ? `<div class="sum-row"><span>Regular rate</span><span class="amt">${fmt(q.regularTotal || q.total)}</span></div>
      <div class="sum-row"><span>Price range</span><span class="amt"><b>${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}</b></span></div>` : '<div class="sum-row"><span>Price</span><span>Priced by CAD</span></div>'}
      ${q.extraQuoted ? `<div class="sum-row"><span>${esc(q.extraQuoted)}</span><span>Quoted by CAD</span></div>` : ''}
      <p class="mini" style="margin:4px 0 10px">${esc(q.quoteNote || 'Our team will email your price within 1 business day. Nothing is charged until you authorize payment.')}</p></div>`;
  }
  if (q.paymentPlan === 'deposit') {
    return `<div class="plan"><div class="plan-head">Orders of ${fmt(CFG.payment.depositThreshold)}+ are split 50/50</div>
      <div class="sum-row"><span>${accessTbc(q) ? CADAccess.TBC_DUE : 'Due today'}</span><span class="amt"><b>${fmt(q.dueNow)}</b></span></div>
      <div class="sum-row"><span>Balance due ${esc(q.balanceWhen)}${accessTbc(q) ? ' (before access check)' : ''}</span><span class="amt"><b>${fmt(q.balanceDue)}</b></span></div>
      <p class="mini" style="margin:4px 0 10px">${esc(q.paymentSummary || ('Deposit ' + fmt(q.dueNow) + ' due at booking. Balance ' + fmt(q.balanceDue) + ' is collected ' + (q.balanceWhen || 'at pickup') + '.'))} You see the deposit, the balance, and when the balance is collected before you pay.</p>${feeNoteHtml(q)}${weightNoteHtml()}</div>`;
  }
  return `<div class="plan"><div class="sum-row"><span>${accessTbc(q) ? CADAccess.TBC_DUE : (q.accessFeeNote ? 'Due today' : (weightTbc() ? 'Due today (weight to be confirmed)' : 'Due today · paid in full at booking'))}</span><span class="amt"><b>${fmt(q.dueNow)}</b></span></div>${feeNoteHtml(q)}${weightNoteHtml()}</div>`;
};
// Access flagged Not sure (mode, fit or elevator stairs): the pricing API adds CADAccess.PRICE_NOTE; show it next to the price.
const accessTbc = (q) => !!(q && (q.notes || []).includes(CADAccess.PRICE_NOTE));
const weightTbc = (items = S.items) => !!(CADAccess.weightUnconfirmed && CADAccess.weightUnconfirmed(items));
const weightNoteHtml = () => (weightTbc() ? `<p class="mini access-tbc" data-weight-tbc><b>${esc(CADAccess.WEIGHT_NOTE)}</b></p>` : '');
// Money in a price row: a discount shows as a minus amount ("−$96.29"), never "$-96.29".
const fmtRow = (n) => (Number(n) < 0 ? '−' + fmt(-Number(n)) : fmt(n));
const isProtLine = (l) => /^Declared value protection/.test(l.label);
// Declared value protection controls (Chad, Nov 19 2026): small, visible text links, never a big toggle and never hidden.
const priceCard = (q, withProtection) => {
  return `<div class="card price-card">
  ${q ? q.lines.map((l, i) => `<div class="sum-row"><span>${esc(l.label)}</span><span class="amt">${l.included ? 'Included' : fmtRow(l.amount)}</span></div>`).join('') : '<div class="sum-row"><span>Calculating…</span><span class="amt"></span></div>'}
  ${withProtection && protectionNote(q) ? `<p class="mini" style="margin:6px 0 0" data-protection-note>${protectionNote(q)}</p>` : ''}
  ${q && q.discount && q.discount.applied && q.discount.note && q.discount.note !== 'invalid' ? `<p class="mini" style="margin:6px 0 0" data-discount-note>${esc(q.discount.note)}</p>` : ''}
  ${q ? `${accessTbc(q) ? `<p class="mini access-tbc" data-access-tbc><b>${esc(CADAccess.PRICE_NOTE)}</b></p>` : ''}${isQuote(q) && !q.tripPremium ? '' : `<div class="total"><span>${isQuote(q) ? 'Regular rate' : accessTbc(q) ? CADAccess.TBC_TOTAL : 'Total'}</span><span class="amt">${fmt(q.regularTotal || q.total)}</span></div>`}${payPlan(q)}` : ''}
</div>`;
};

// ---------- discount code (Review & pay) ----------
// The code is checked on the server only (POST /api/discount-code); the amount always comes back from the server quote.
let discountInput = '', discountMsg = null;
const discountBlock = () => {
  if (existing) return '';
  const applied = String(S.discountCode || '');
  return `<div class="card discount-card" data-discount>
    <label class="f" for="discountInput">Discount code</label>
    <div class="row keep discount-row"><div class="field"><input id="discountInput" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Enter code" value="${esc(applied || discountInput)}" ${applied ? 'readonly' : ''} aria-describedby="discountMsg"></div>
    ${applied ? '<button type="button" class="btn" data-discount-remove>Remove</button>' : '<button type="button" class="btn" data-discount-apply>Apply</button>'}</div>
    <p class="mini ${discountMsg ? (discountMsg.ok ? 'discount-ok' : 'discount-bad') : ''}" id="discountMsg" role="status" aria-live="polite" data-discount-msg>${discountMsg ? esc(discountMsg.text) : ''}</p>
  </div>`;
};
const paintDiscount = () => { const el = document.querySelector('[data-discount]'); if (el) el.outerHTML = discountBlock(); };
async function applyDiscount() {
  const code = String(discountInput || '').trim();
  if (!code) { discountMsg = { ok: false, text: 'Enter a discount code.' }; paintDiscount(); return; }
  const btn = document.querySelector('[data-discount-apply]'); if (btn) btn.disabled = true;
  const { ok, j } = await api('/api/discount-code', { code, order: payload() });
  if (ok && j && j.valid) {
    S.discountCode = j.code; discountInput = ''; persist();
    discountMsg = { ok: true, text: j.message || `Code ${j.code} applied.` };
    refreshQuote();
  } else {
    S.discountCode = ''; persist();
    discountMsg = { ok: false, text: (j && j.message) || 'That code isn’t valid. Please check it and try again.' };
  }
  paintDiscount();
}
// ---------- payment block (shared by new orders and payment links) ----------
const paymentBlock = (q) => {
  const saveToggle = CFG.payment.savePaymentMethod ? toggleRaw('saveMethod', saveMethod, 'Save this payment method', 'We keep it on file with CAD for future bookings.') : '';
  // Larger orders open on Pay by bank (no card surcharge on any method; bank is simply recommended for big totals).
  if (!payPicked && bankFirst(q) && payMethod === 'card') payMethod = CFG.stripe ? 'stripe' : 'ach';
  if (CFG.stripe && zelleOn()) {
    const on = payMethod === 'zelle' ? 'zelle' : 'stripe';
    const big = bankFirst(q);
    return `<div class="card"><span class="badge">${CFG.stripeTestMode && !CFG.livemode ? 'Stripe test mode' : 'Secure payment'}</span>
      <div class="field"><div class="seg" data-pay-method>
        <button type="button" class="${on === 'stripe' ? 'on' : ''}" data-v="stripe">${big ? 'Pay by bank or card' : 'Card or bank'}</button>
        <button type="button" class="${on === 'zelle' ? 'on' : ''}" data-v="zelle">Zelle</button></div></div>
      ${on === 'zelle' ? zelleHtml(q && q.dueNow, null, null) : `<p class="mini" style="margin:0 0 12px">${big ? '<b>Pay by bank (ACH) is recommended for larger orders.</b> ' : ''}You’ll pay on Stripe’s secure page: ${big ? 'bank (ACH), Apple Pay, Google Pay or card' : 'Apple Pay, Google Pay, card or bank (ACH)'}. A bank payment shows as processing until it clears.</p>${saveToggle}`}<div class="err" id="err"></div></div>`;
  }
  if (CFG.stripe) {
    // "Stripe test mode" only when the server really runs a Stripe test key; otherwise a neutral label (QA re-check N1).
    return `<div class="card"><span class="badge">${CFG.stripeTestMode && !CFG.livemode ? 'Stripe test mode' : 'Secure payment by Stripe'}</span>
      <p class="mini" style="margin:0 0 12px">You’ll pay on Stripe’s secure page: Apple Pay, Google Pay, card or bank (ACH).</p>${saveToggle}<div class="err" id="err"></div></div>`;
  }
  // Mock checkout (prefilled test numbers, mock Apple / Google Pay) only when the server runs with TEST_MODE=1.
  if (!CFG.testMode && zelleOn()) { payMethod = 'zelle'; return `<div class="card">${zelleHtml(q && q.dueNow, null, null)}<div class="err" id="err"></div></div>`; }
  if (!CFG.testMode) return `<div class="card"><p class="mini" style="margin:0">Online payment isn’t switched on yet. Please contact CAD to complete your booking.</p><div class="err" id="err"></div></div>`;
  if (payMethod === 'stripe') payMethod = 'ach';
  const big = bankFirst(q);
  const fields = payMethod === 'zelle' ? zelleHtml(q && q.dueNow, null, null) : payMethod === 'ach'
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
      ${big ? `<button type="button" class="${payMethod === 'ach' ? 'on' : ''}" data-v="ach">Pay by bank</button><button type="button" class="${payMethod === 'card' ? 'on' : ''}" data-v="card">Card</button>`
        : `<button type="button" class="${payMethod === 'card' ? 'on' : ''}" data-v="card">Card</button><button type="button" class="${payMethod === 'ach' ? 'on' : ''}" data-v="ach">Bank (ACH)</button>`}
      ${zelleOn() ? `<button type="button" class="${payMethod === 'zelle' ? 'on' : ''}" data-v="zelle">Zelle</button>` : ''}</div></div>
    ${big && payMethod === 'ach' ? '<p class="mini" style="margin:0 0 8px"><b>Recommended for larger orders.</b></p>' : ''}
    ${fields}${payMethod === 'zelle' ? '' : saveToggle}<div class="err" id="err"></div></div>`;
};
const toggleRaw = (id, on, label, hint) => `<label class="toggle"><span>${label}<small>${hint}</small></span><span class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></span></label>`;


// ---------- dedicated trips, per side (Chad, Nov 25 2026, t2069u) ----------
// A side the route days don't suit can be a dedicated trip: the customer picks any date that works (lead time, holidays and the
// booking window come from /api/config dedicated). The price is one exact total from the server; no fee breakdown is shown.
let dedBlocked = null; // per side: dates in the window the CAD SCHEDULE can't fit (from /api/availability)
const dedKey = (side) => (side === 'pickup' ? 'dedicatedPickup' : 'dedicatedDelivery');
const dedDatePath = (side) => (side === 'pickup' || !svc().needsPickup ? 'schedule.date' : 'schedule.deliveryDate');
const firstSide = () => (svc().needsPickup ? 'pickup' : 'delivery');
const dedOn = (side) => !!(side === 'pickup' ? svc().needsPickup && S.dedicatedPickup : S.dedicatedDelivery);
const dedAny = () => dedOn('pickup') || dedOn('delivery');
const dedLabel = (o) => {
  const x = o || S, sv = o ? ((CFG && CFG.services[o.service]) || {}) : svc();
  const pu = !!(sv.needsPickup && x.dedicatedPickup), de = !!x.dedicatedDelivery || (o && x.dedicated && x.dedicatedPickup == null);
  return pu && de ? ' · dedicated pickup and delivery' : pu ? ' · dedicated pickup' : de ? (sv.needsPickup ? ' · dedicated delivery' : ' · dedicated trip') : '';
};
const dedMin = (side) => {
  const R = (CFG && CFG.dedicated) || {};
  let min = R.min || '';
  if (side === 'delivery' && needsTwoDates() && S.schedule.date && S.schedule.date > min) min = S.schedule.date;
  return min;
};
function dedDateProblem(iso, side) {
  const R = (CFG && CFG.dedicated) || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return 'Please pick a date.';
  const min = dedMin(side);
  if (min && iso < min) return side === 'delivery' && needsTwoDates() && S.schedule.date && min === S.schedule.date ? 'Please pick a delivery date on or after your pickup date.' : `Please pick ${shortDate(min)} or later.`;
  if (R.max && iso > R.max) return `Please pick ${shortDate(R.max)} or earlier.`;
  if (!R.allowSundays && new Date(iso + 'T12:00:00Z').getUTCDay() === 0) return 'Please pick a day other than Sunday.';
  if ((R.blocked || []).includes(iso)) return 'We’re closed that day. Please pick another date.';
  const full = (dedBlocked && dedBlocked[side === 'pickup' ? 'pickup' : 'delivery']) || (avail && avail.dedicatedBlocked && avail.dedicatedBlocked[side === 'pickup' ? 'pickup' : 'delivery']) || [];
  if (full.includes(iso)) return 'That date is fully booked. Please pick another date, or request a custom date below.';
  return '';
}
const dedSideLabel = (side) => (side === 'pickup' ? 'Pickup' : svc().needsPickup ? 'Delivery' : (svc().install ? 'Install' : 'Delivery'));
const lastDedSide = () => (dedOn('delivery') ? 'delivery' : 'pickup');
// No dedicated date works (or the one they need is full): send it as a request; the team schedules it and nothing is charged yet.
const customDateBlock = () => `<div class="ded-custom" data-reqblock="customdate">
    <label class="chk"><input type="checkbox" data-path="customDate" data-rerender ${S.customDate ? 'checked' : ''}> Request a custom date</label>
    ${S.customDate ? `${input('schedule.customDateNote', 'Which dates would work?', { ph: 'For example: any weekday the week of Dec 14', req: true })}
      <p class="mini">We’ll schedule it and confirm the date with you before anything is charged.</p>` : ''}
  </div>`;
function dedBox(side, tagged) {
  const on = dedOn(side), path = dedDatePath(side), v = get(path), R = (CFG && CFG.dedicated) || {};
  const prob = on && v ? dedDateProblem(v, side) : '';
  const blk = path === 'schedule.date' ? 'date' : 'deldate';
  return `<div class="ded-box${on ? ' on' : ''}" data-ded="${side}">
    ${tagged ? `<p class="ded-tag">${dedSideLabel(side)}</p>` : ''}<p class="ded-q">None of these dates work for you?</p>
    ${toggle(dedKey(side), 'Select a dedicated trip', 'A van and crew just for your job, on a date that works for you.', true, 'first')}
    ${on && !S.customDate ? `<div class="ded-date" data-reqblock="${blk}">${input(path, `${dedSideLabel(side)} date`, { type: 'date', attrs: `min="${esc(dedMin(side))}" max="${esc(R.max || '')}" data-rerender data-deddate="${side}"`, req: true })}
      ${prob ? `<p class="mini ded-err" role="alert">${esc(prob)}</p>` : ''}</div>` : ''}
    ${on && (!tagged || side === lastDedSide()) ? customDateBlock() : ''}
  </div>`;
}

// ---------- schedule helpers ----------
const crossRegion = () => !!(quoteData && quoteData.regions && quoteData.regions.pickup && quoteData.regions.dropoff && quoteData.regions.pickup !== quoteData.regions.dropoff);
const REGION_NAME = { NorCal: 'Northern California', SoCal: 'Southern California' };
const regionName = (r) => REGION_NAME[r] || r || '';
// Cross-region jobs (e.g. SF pickup, LA delivery): name both regions instead of one route label.
const crossRegionLine = (rg, pu = S.pickup, dr = S.dropoff) => {
  if (!(rg && rg.pickup && rg.dropoff && rg.pickup !== rg.dropoff)) return '';
  const pc = String((pu && pu.city) || '').trim(), dc = String((dr && dr.city) || '').trim();
  return pc && dc ? `${pc} → ${dc}` : `${regionName(rg.pickup)} → ${regionName(rg.dropoff)}`;
};
// Pickup and delivery cities (e.g. "West Hollywood → Palm Springs"), never a single route name for a two-stop job.
const tripLine = () => (needsTwoDates() && String(S.pickup.city || '').trim() && String(S.dropoff.city || '').trim() ? `${String(S.pickup.city).trim()} → ${String(S.dropoff.city).trim()}` : crossRegionLine(quoteData && quoteData.regions));
const needsTwoDates = () => !!(svc().needsPickup && svc().needsDropoff && !isShip());
const routeHint = () => '';
const timeReassure = ""; // the Dedicated trip toggle right below says it (Nov 23 2026)
// Route-aware windows (Chad, Nov 25 2026): the server says which arrival windows fit that day's route; the others are grayed with a
// short reason in words (not color alone). With no route data every window stays open.
let tw = null, twKey = '', twSeq = 0;
const twFor = (prefPath) => { const leg = prefPath === 'schedule.deliveryTimePref' ? 'delivery' : 'pickup'; const r = tw && tw[leg]; const date = leg === 'delivery' ? S.schedule.deliveryDate : S.schedule.date; return r && r.date === date ? r : null; };
const twOff = (prefPath, v) => { const r = twFor(prefPath); const w = r && (r.windows || []).find((x) => x.v === v); return w && !w.ok ? (w.why || 'Doesn’t fit our route that day') : ''; };
// Morning shows only when the server lists it for that leg's date (day already busy enough). No answer yet = hidden (safe default).
const twHidden = (prefPath, v) => { if (v !== 'morning') return false; const r = twFor(prefPath); return !(r && (r.windows || []).some((x) => x.v === v)); };
function windowsKey() {
  if (STEPS[step] !== 'When' || !S.schedule.date && !S.schedule.deliveryDate) return '';
  const a = (x) => [x && x.zip, x && x.city].join('|');
  return JSON.stringify([S.service, S.rush, S.dedicatedPickup, S.dedicatedDelivery, S.schedule.date, S.schedule.deliveryDate, S.schedule.timePref, S.schedule.deliveryTimePref, a(S.pickup), a(S.dropoff)]);
}
async function loadWindows() {
  const key = windowsKey();
  if (!key || key === twKey) return;
  twKey = key; const seq = ++twSeq;
  const { ok, j } = await api('/api/time-windows', payload());
  if (seq !== twSeq) return;
  if (!ok || !j) { tw = null; if (STEPS[step] === 'When') renderWhenIdle(); return; } // no answer: every window stays open (Morning stays hidden)
  tw = j;
  // A chosen window that no longer fits is dropped (like a date that no longer works), so the order can't carry it.
  let changed = false;
  [['schedule.timePref', 'pickup'], ['schedule.deliveryTimePref', 'delivery']].forEach(([path]) => {
    const on = CADAccess.timePrefList(get(path)); const keep = on.filter((v) => !twOff(path, v) && !twHidden(path, v));
    if (keep.length !== on.length) { set(path, keep.length ? keep.join(',') : 'none'); changed = true; }
  });
  if (changed) { twKey = ''; loadWindows(); }
  if (STEPS[step] === 'When') renderWhenIdle();
}
const timePrefBlock = (prefPath, notePath, { showReassure = false, explain = true } = {}) => {
  const on = CADAccess.timePrefList(get(prefPath));
  const offs = TIME_PREF_OPTS.filter(([v]) => v !== 'none' && twOff(prefPath, v));
  const byWhy = {}; offs.forEach(([v, l]) => { const w = twOff(prefPath, v); (byWhy[w] = byWhy[w] || []).push(l); });
  const whyHtml = offs.length ? `<p class="mini tw-why" data-twwhy="${prefPath}">${Object.entries(byWhy).map(([w, ls]) => `<span>Grayed out: ${esc(ls.join(', '))}. ${esc(w)}.</span>`).join(' ')}</p>` : '';
  const chip = ([v, l]) => {
    const off = v !== 'none' && twOff(prefPath, v);
    const sel = (v === 'none' ? !on.length : on.includes(v));
    return `<button type="button" class="chip ${sel ? 'on' : ''} ${off ? 'off' : ''}" data-v="${esc(v)}" aria-pressed="${sel ? 'true' : 'false'}"${off ? ` aria-disabled="true" data-off="1" title="${esc(off)}"` : ''}>${esc(l)}</button>`;
  };
  return `<h2>Preferred times <span class="opt">(we’ll do our best to accommodate)</span></h2>
    <p class="mini" style="margin:-4px 0 8px">Select all that work.</p>
    <div class="chips" data-chips="${prefPath}" data-multi>${TIME_PREF_OPTS.filter(([v]) => !twHidden(prefPath, v)).map(chip).join('')}</div>
    ${whyHtml}
    ${input(notePath, 'Timing notes (optional)', { ph: 'Anything we should know about timing' })}
    ${explain ? `<p class="mini">We’ll do our best but can’t promise an exact time. As your date gets closer, and on the day, we’ll keep sending you narrower ETA windows. We serve clients all over the state, so a little flexibility helps us help everyone.</p>` : ''}
    ${showReassure ? timeReassure : ''}`;
};
const promiseCard = (sub, extraStyle = '', editTarget = '') => {
  const sp = special();
  const two = needsTwoDates() && S.schedule.date && S.schedule.deliveryDate;
  const title = S.customDate && dedAny() ? 'Custom date request'
    : two ? `Pickup ${esc(shortDate(S.schedule.date))} · Delivery ${esc(shortDate(S.schedule.deliveryDate))}`
    : `${esc(longDate(S.schedule.date))}`;
  const prefs = two
    ? [timePrefSummary(S.schedule.timePref, S.schedule.timeNote) && `Pickup: ${timePrefSummary(S.schedule.timePref, S.schedule.timeNote)}`,
       timePrefSummary(S.schedule.deliveryTimePref, S.schedule.deliveryTimeNote) && `Delivery: ${timePrefSummary(S.schedule.deliveryTimePref, S.schedule.deliveryTimeNote)}`].filter(Boolean).join(' · ')
    : timePrefSummary(S.schedule.timePref, S.schedule.timeNote);
  const dl = dedLabel(); // ' · dedicated pickup' etc.
  const line = sp ? (S.rush ? 'Preferred date' : (prefs || sub || ''))
    : ([dl && dl.replace(/^ · d/, 'D'), prefs || (dl ? '' : sub) || ''].filter(Boolean).join(' · '));
  return `<div class="promise ${sp ? 'quote' : ''}" style="${extraStyle}"><span class="pi">${sp ? '⏱' : '✓'}</span><span><b>${title}</b><span>${esc(line)}</span></span>${editTarget ? editBtn(editTarget) : ''}</div>`;
};
function deliveryBlock() {
  if (!needsTwoDates() || !S.schedule.date) return '';
  const card = (d) => { const [w, m, n] = d.label.replace(',', '').split(' '); return `<button type="button" class="day ${S.schedule.deliveryDate === d.date ? 'on' : ''}" data-deldate="${d.date}"><div class="dw">${w}</div><div class="dd">${m} ${n}</div><div class="rg">${esc(d.shortLabel || d.routeLabel || d.region)}</div></button>`; };
  const sel = delAvail && (delAvail.days || []).find((d) => d.date === S.schedule.deliveryDate);
  const days = !delAvail ? '<p class="mini">Finding delivery days…</p>'
    : `<div class="days" data-reqblock="deldate">${dayWindow(delAvail.days, S.schedule.deliveryDate, 'del').list.map(card).join('')}</div>${dayWindow(delAvail.days, S.schedule.deliveryDate, 'del').btn}
      ${routeHint(sel)}
      ${S.schedule.deliveryDate ? timePrefBlock('schedule.deliveryTimePref', 'schedule.deliveryTimeNote') : ''}`;
  const cross = '';
  const chip = `<div class="pickup-chip" data-pickup-chip><span><b>Pickup</b> ${esc(shortDate(S.schedule.date))}</span><button type="button" class="edit" data-change-pickup>Change</button></div>`;
  return `${chip}
    <h1 class="when-h1">Choose your delivery date</h1>
    <p class="sub">On or after your pickup date.</p>
    ${cross}
    <div class="region">● ${esc((delAvail && (delAvail.area || delAvail.region)) || 'Your area')} route</div>
    ${days}`;
}
// Pickup + delivery on one screen (Chad, Nov 21 2026). The server returns the pickup days, the delivery days and, for each
// pickup, the delivery days that work with it (leg=pairs: the same route rules leg=dropoff and the order check use).
let pairs = null, pickupAny = null, deliveryAny = null;
async function loadDelivery() {
  if (!needsTwoDates()) return;
  const { ok, j } = await api('/api/availability', { ...payload(), leg: 'pairs' });
  if (!ok || !j || !j.delivery) return;
  delAvail = j.delivery; pairs = j.pairs || {}; dedBlocked = j.dedicatedBlocked || null; pickupAny = j.pickupAny || null; deliveryAny = j.deliveryAny || null;
  if (j.days) avail = { ...(avail || {}), region: j.region, zone: j.zone, area: j.area, days: j.days, rush: j.rush || [] };
  const okPair = (p, d) => !!(pairs[p] && pairs[p].includes(d));
  const puList = dedOn('delivery') && pickupAny ? pickupAny : null, deList = dedOn('pickup') && deliveryAny ? deliveryAny : delAvail.days;
  if (S.schedule.date && !dedOn('pickup') && !(puList ? puList.some((d) => d.date === S.schedule.date) : pairs[S.schedule.date])) { S.schedule.date = ''; S.rush = false; persist(); }
  if (S.schedule.deliveryDate && !dedOn('delivery') && !deList.some((d) => d.date === S.schedule.deliveryDate)) { S.schedule.deliveryDate = ''; persist(); }
  if (S.schedule.date && S.schedule.deliveryDate && !dedAny() && !okPair(S.schedule.date, S.schedule.deliveryDate)) { S.schedule.deliveryDate = ''; persist(); }
  if (STEPS[step] === 'When') renderWhenIdle();
}
const pairOk = (p, d) => (dedAny() ? !p || !d || d >= p : !!(pairs && pairs[p] && pairs[p].includes(d)));
// What a card looks like: 'on' (chosen), 'dim' (another day in a column that already has a choice; tap to switch),
// 'off' (doesn't work with the day chosen in the other column; can't be picked until that choice is cleared).
const puState = (d) => {
  const sel = S.schedule.date, del = S.schedule.deliveryDate;
  if (sel === d.date && !!S.rush === !!d.rush) return 'on';
  if (del && dedOn('delivery')) { if (d.date > del) return 'off'; }
  else if (del && !pairOk(d.date, del)) return 'off';
  return sel ? 'dim' : '';
};
const delState = (d) => {
  const sel = S.schedule.deliveryDate, pu = S.schedule.date;
  if (sel === d.date) return 'on';
  if (dedOn('pickup')) return pu && d.date < pu ? 'off' : sel ? 'dim' : '';
  if (pu && !pairOk(pu, d.date)) return 'off';
  if (!pu && !dedOn('pickup') && pairs && !Object.values(pairs).some((l) => l.includes(d.date))) return 'off';
  return sel ? 'dim' : '';
};
// Each column shows its first few days, always including the chosen one and at least three that can still be picked.
const PAIR_FIRST = 6;
const pairWindow = (days, stateOf, key) => {
  if (moreDays[key] || days.length <= PAIR_FIRST) return { list: days, btn: '' };
  const usable = days.filter((d) => stateOf(d) !== 'off').length;
  let shown = 0, open = 0; const list = [];
  for (const d of days) {
    const st = stateOf(d);
    if (shown >= PAIR_FIRST && open >= Math.min(3, usable) && !days.slice(list.length).some((x) => stateOf(x) === 'on')) break;
    list.push(d); shown++; if (st !== 'off') open++;
  }
  const rest = days.length - list.length;
  return { list, btn: rest > 0 ? `<button type="button" class="linkbtn show-more-dates" data-moredays="${key}">More dates (${rest})</button>` : '' };
};
const pairCard = (d, kind) => {
  const st = kind === 'pu' ? puState(d) : delState(d);
  const [w, m, n] = d.label.replace(',', '').split(' ');
  const attr = kind === 'pu' ? `data-date="${d.date}" data-rush="${d.rush ? 1 : ''}"` : `data-deldate="${d.date}"`;
  const why = st === 'off' ? (kind === 'pu' ? 'Too late for the delivery day you picked' : 'Doesn’t work with the pickup day you picked') : '';
  return `<button type="button" class="day ${st} ${d.rush ? 'rush' : ''}" ${attr} ${st === 'off' ? `aria-disabled="true" data-off="1" title="${why}"` : ''} aria-pressed="${st === 'on'}"><div class="dw">${w}</div><div class="dd">${m} ${n}</div><div class="rg">${d.rush ? 'Rush quote' : esc(d.shortLabel || d.routeLabel || d.region)}</div></button>`;
};
function pairBlock() {
  const pu = (dedOn('delivery') && pickupAny) || (avail && avail.days) || [], rush = (avail && avail.rush) || [];
  const del = (dedOn('pickup') && deliveryAny) || (delAvail && delAvail.days) || [];
  const pw = pairWindow(pu, puState, 'pu'), dw = pairWindow(del, delState, 'del');
  const head = (label, iso, key) => `<div class="col-head"><span class="col-t">${label}</span>${iso ? `<span class="col-sel"><b>${esc(shortDate(iso))}</b><button type="button" class="linkbtn" data-clear="${key}" aria-label="Clear ${label.toLowerCase()} date">Clear</button></span>` : '<span class="col-sel mini">Not picked</span>'}</div>`;
  const hint = dedOn('pickup') && dedOn('delivery') ? 'Dedicated trip on both sides: pick the pickup and delivery dates that work for you.'
    : S.schedule.date && S.schedule.deliveryDate ? 'Both dates are set. Tap Clear on either one to change it.'
    : S.schedule.date ? 'Now pick a delivery day. Grayed-out days don’t work with that pickup.'
    : S.schedule.deliveryDate ? 'Now pick a pickup day. Grayed-out days are too late for that delivery.'
    : 'Start with either one. We’ll gray out the days that don’t work together.';
  const cross = '';
  return `<p class="pair-hint mini" data-pairhint>${hint}</p>${cross}
    <div class="date-pair">
      <div class="date-col" data-col="pu">${head('Pickup', S.schedule.date, 'pu')}
        ${dedOn('pickup') ? '<p class="mini ded-col">Dedicated trip. Pick your pickup date below.</p>' : `<div class="region">● ${esc((avail && avail.area) || 'Pickup')} route</div>
        <div class="days col-days" data-reqblock="date">${pw.list.map((d) => pairCard(d, 'pu')).join('')}</div>${pw.btn}
        ${rush.length ? `<p class="col-sub">Need a different pickup date?</p><div class="days col-days">${rush.map((d) => pairCard(d, 'pu')).join('')}</div>` : ''}`}
      </div>
      <div class="date-col" data-col="del">${head('Delivery', S.schedule.deliveryDate, 'del')}
        ${dedOn('delivery') ? '<p class="mini ded-col">Dedicated trip. Pick your delivery date below.</p>' : `<div class="region">● ${esc((delAvail && delAvail.area) || 'Delivery')} route</div>
        ${delAvail ? `<div class="days col-days" data-reqblock="deldate">${dw.list.map((d) => pairCard(d, 'del')).join('')}</div>${dw.btn}` : '<p class="mini" data-reqblock="deldate">Finding delivery days…</p>'}`}
      </div>
    </div>
    ${dedBox('pickup', true)}${dedBox('delivery', true)}
`;
}

// ---------- photo rules (Chad, Nov 19): required only when special handling is on. Weight "Not sure" never requires a photo. ----------
const itemPhotoReason = (it) => (it.fragile ? 'Photo required for special handling.' : '');
const photosOk = (it) => !itemPhotoReason(it) || (it.photos || []).length > 0;
const sitePhotosOk = () => true;
const hangPhotosOk = (it) => it.hangHeight !== 'higher' || it.hangWhere !== 'stairwell' || (it.hangPhotos || []).length > 0;
const valueHint = (it) => (shipService() ? 'The value of this one piece. Our shipping partner uses it for coverage.'
  : num(it.value) > 50000 ? 'The value of this one piece.'
  : num(it.value) > 0 ? `Declared value protection: 1.5% of this piece’s declared value (${fmt(nearest5(num(it.value) * 0.015))} per piece), included.`
  : PROTECTION_HINT);
// Declared value protection (Chad + Dot, Nov 16 2026; made optional Nov 19 2026): 1.5% of each ELIGIBLE piece's declared value
// (pieces valued $50,000 or less), ALWAYS included, no opt-out (Chad, Nov 23 2026). Never called insurance or full coverage.
// Over $50,000: no protection line, no note, no special hint (Chad, Nov 16 2026). The value is just for our records.
const PROTECTION_HINT = 'The value of this one piece. Pieces valued up to $50,000 include declared value protection: 1.5% of their declared value.';
const protectionNote = (q) => (q && q.protection && q.protection.amount > 0
  ? 'Covers each piece valued up to $50,000.'
  : '');
const PROTECTION_DOCK = 'Includes declared value protection';
const weightRequired = (it) => shipService() || it.type === 'sculpture' || it.type === 'other';
// Weight (Chad, Nov 25–26 2026): for paintings, photographs and other wall art, only ask when the largest side is over 72 in,
// or the piece is framed and the largest side is over 60 in. A 48×60 unframed painting with no glass is not asked.
// Sculptures, “other”, furniture, mirrors, and shipping still ask (those are priced or planned by weight). Hidden
// weights are sent blank (not asked) so they never affect pricing, validation, the sheet or emails.
const WEIGHT_ASK_OVER_IN = 72;
const WEIGHT_FRAMED_ASK_OVER_IN = 60;
const largestDim = (it) => Math.max(num(it && it.w), num(it && it.h), num(it && it.d));
const askWeight = (it) => {
  if (!it) return false;
  if (shipService() || weightRequired(it)) return true;
  const t = it.type || 'painting';
  if (t === 'furniture' || CADAccess.pieceType(it) === 'mirror') return true;
  const max = largestDim(it);
  if (max > WEIGHT_ASK_OVER_IN) return true;
  if (it.framed === 'yes' && max > WEIGHT_FRAMED_ASK_OVER_IN) return true;
  return false;
};
const tidyItemWeight = (it) => {
  if (!it) return;
  if (!askWeight(it)) { it.weight = ''; it.weightUnsure = false; }
  else if (it.weightUnsure) it.weight = '';
  else it.weightUnsure = false;
};
const weightOk = (it) => !weightRequired(it) || !!it.weightUnsure || num(it.weight) > 0;
function updateItemHints(i) {
  const it = S.items[i]; if (!it) return;
  const vh = app.querySelector(`[data-valhint="${i}"]`); if (vh) vh.textContent = valueHint(it);
  const hw = app.querySelector(`[data-heavywall="${i}"]`); if (hw) { const h = heavyWallNote(it, i); if (hw.innerHTML !== h) hw.innerHTML = h; }
  const r = itemPhotoReason(it);
  app.querySelectorAll(`[data-photoreq="${i}"]`).forEach((el) => { el.textContent = r; el.hidden = !r; });
  app.querySelectorAll(`[data-photolbl="${i}"]`).forEach((el) => { el.innerHTML = r ? req : ' (optional)'; });
  app.querySelectorAll(`[data-photonote="${i}"]`).forEach((el) => { el.hidden = !(it.fragile && !r); });
}
const reqLine = (txt) => `<p class="mini req-line" data-photoreq>${esc(txt)}</p>`;

// ---------- shipping (Shipping service, or any job outside California) ----------
const req = ' <span class="req">Required</span>';
const frameTypeField = (item, i) => `<div class="field" data-frametype="${i}"><label class="f">Frame type — ${pieceName(i)}${req}</label>${seg(`items.${i}.frameType`, FRAME_TYPE_OPTS, 'stack')}<p class="mini">This helps us plan the right crew and vehicle.</p></div>`;
const framingBlock = (item, i) => {
  if (!FRAMING_TYPES.includes(item.type || 'painting')) return '';
  const p = `items.${i}`;
  const glass = needsGlass(item) ? `<div class="field" data-glass="${i}"><label class="f">Glass? — ${pieceName(i)}${req}</label>${seg(`${p}.glazing`, [['yes', 'Yes'], ['no', 'No']])}<p class="mini">Any glass on the piece, framed or not.</p></div>` : '';
  return `<div class="field" style="margin-top:6px" data-framing="${i}"><label class="f">Framed? — ${pieceName(i)}${req}</label>${seg(`${p}.framed`, [['yes', 'Yes'], ['no', 'No']])}</div>
    ${glass}
    <div data-frametype-wrap="${i}">${needsFrameType(item) ? frameTypeField(item, i) : ''}</div>`;
};
const syncFrameType = (i) => {
  const it = S.items[i]; if (!it) return;
  if (!needsFrameType(it) && it.frameType) { it.frameType = ''; persist(); }
  const wrap = app.querySelector(`[data-frametype-wrap="${i}"]`);
  if (!wrap) return;
  const show = needsFrameType(it);
  const has = !!wrap.querySelector('[data-frametype]');
  if (show && !has) wrap.innerHTML = frameTypeField(it, i);
  else if (!show && has) wrap.innerHTML = '';
  updateNext();
};
const openHandling = new Set(); // Value and care: which pieces have Special handling expanded (UI only)
const HANDLING_HINT = 'Only for extremely fragile or awkward pieces, ones that can’t stand upright, or ones that may need custom crating.';
const handlingBlock = (item, i) => {
  const open = !!item.fragile || openHandling.has(item.id);
  return `<details class="handling" data-handling="${i}" ${open ? 'open' : ''}>
    <summary>Special handling needed</summary>
    <div class="handling-body">
      <p class="mini">${esc(HANDLING_HINT)}</p>
      ${toggle(`items.${i}.fragile`, 'Special handling needed', '', true, 'first')}
    </div>
  </details>`;
};
// Heavy wall pieces (Chad, Nov 21 2026): surcharge on pickup & delivery by weight; over the limit = custom quote, no booking.
const WALL_WEIGHT_TYPES = () => (((CFG && CFG.pricing && CFG.pricing.wallArtWeight) || {}).types || ['painting', 'photograph', 'mirror', 'wallart']);
const wallWeightCfg = () => ((CFG && CFG.pricing && CFG.pricing.wallArtWeight) || { tiers: [], maxLb: 400 });
const isWallWeightPiece = (it) => WALL_WEIGHT_TYPES().includes(it.type === 'decor' && it.furnitureKind === 'Mirror' ? 'mirror' : (it.type || 'painting'));
const wallTooHeavy = (it) => isWallWeightPiece(it) && !it.weightUnsure && num(it.weight) > (wallWeightCfg().maxLb || Infinity);
const wallWeightFee = (it) => {
  if (!isWallWeightPiece(it) || it.weightUnsure || wallTooHeavy(it)) return 0;
  const hit = (wallWeightCfg().tiers || []).slice().sort((a, b) => b.overLb - a.overLb).find((r) => num(it.weight) > r.overLb);
  return hit ? hit.fee : 0;
};
const QUOTE_EMAIL = () => ((CFG && CFG.company && CFG.company.email) || 'contact@californiaartdelivery.com');
const customQuoteHref = (it, i) => `mailto:${QUOTE_EMAIL()}?subject=${encodeURIComponent('Custom quote request: heavy wall piece')}&body=${encodeURIComponent(`Hi CAD,\n\nI’d like a custom quote for a heavy piece.\n\n${pieceTitle0(it, i)}\nType: ${TYPE_LABEL(it.type)}\nSize: ${[it.w, it.h, it.d].filter(Boolean).join(' x ') || '?'} in\nWeight: about ${fmtNum(it.weight)} lb\nPickup: ${[S.pickup.city, S.pickup.zip].filter(Boolean).join(' ') || '?'}\nDelivery: ${[S.dropoff.city, S.dropoff.zip].filter(Boolean).join(' ') || '?'}\n\nThanks!`)}`;
const heavyWallNote = (it, i) => {
  if (!isWallWeightPiece(it) || shipService()) return '';
  if (wallTooHeavy(it)) return `<div class="heavy-block" role="alert"><b>Pieces this heavy need a custom quote.</b><span>Wall pieces over ${wallWeightCfg().maxLb} lb can’t be booked online. Send us the details and we’ll price it for you.</span><a class="btn primary quote-btn" href="${esc(customQuoteHref(it, i))}" data-customquote="${i}">Request a custom quote</a><span class="mini">Opens an email to ${esc(QUOTE_EMAIL())}. Or <a href="https://californiaartdelivery.com/pages/contact" target="_blank" rel="noopener">use our contact form</a>.</span></div>`;
  const fee = wallWeightFee(it);
  return fee ? `<p class="mini heavy-fee">Heavy piece: +${fmt(fee)} on pickup &amp; delivery.</p>` : '';
};
const weightField = (item, i, { required = false, approx = false } = {}) => {
  const p = `items.${i}`;
  const label = approx ? `Approx. weight — ${pieceName(i)} (lb)` : `Weight — ${pieceName(i)} (lb)`;
  const reqMark = required && !item.weightUnsure ? req : '';
  return `<div class="field" data-weight="${i}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px">
      <label class="f" for="f-${p}.weight" style="margin:0">${label}${reqMark}</label>
      <button type="button" class="pill-btn ${item.weightUnsure ? 'on' : ''}" data-weightunsure="${i}">${item.weightUnsure ? '✓ Not sure' : 'Not sure'}</button>
    </div>
    ${CADAccess.needsWeightHint && CADAccess.needsWeightHint(item) ? `<p class="mini" style="margin:0 0 8px">${esc(CADAccess.WEIGHT_HINT)}</p>` : ''}
    ${item.weightUnsure ? '<p class="mini" style="margin:0 0 8px">No problem, you can skip this.</p>' + (CADAccess.weightFeeType && CADAccess.weightFeeType(item) ? `<p class="mini access-tbc" data-weight-tbc><b>${esc(CADAccess.WEIGHT_NOTE)}</b></p>` : '') : input(`${p}.weight`, '', { ph: approx ? 'e.g. 200' : 'e.g. 40', attrs: `inputmode="decimal" aria-label="${label}"` }) + `<p class="mini">${required ? 'Pick a weight or Not sure; it affects the price.' : 'Pounds. Approximate is fine.'}</p>`}
    <div data-heavywall="${i}">${heavyWallNote(item, i)}</div>
  </div>`;
};
const shipExtras = (item, i) => {
  const p = `items.${i}`;
  return `<label class="f">Size in inches (W × H × D)${req}</label>
    <div class="row3">${input(`${p}.w`, '', { type: 'number', ph: 'W', attrs: dimAttrs('w', 'Width') })}${input(`${p}.h`, '', { type: 'number', ph: 'H', attrs: dimAttrs('h', 'Height') })}${input(`${p}.d`, '', { type: 'number', ph: 'D', attrs: dimAttrs('d', 'Depth') })}</div>

    ${weightField(item, i, { required: true })}
    ${input(`${p}.value`, 'Declared value ($)', { ph: 'e.g. 12,000', attrs: 'inputmode="numeric"', req: true })}
    ${framingBlock(item, i)}
    ${handlingBlock(item, i)}`;
};
const shipReady = () => S.items.every((it) => weightOk(it) && num(it.value) > 0 && dimsOk(it))
  && !!S.shipping.serviceLevel && !!(S.shipping.shipBy || S.shipping.flexible);
const LEVELS = [['curbside', 'Curbside', 'Delivered to the curb or front entry.'], ['inside', 'Inside delivery', 'Carried in and placed in the room of your choice.'], ['unpack', 'Inside + unpack & install', 'We unpack, place or hang, and check every piece.'], ['unpack_debris', 'Unpack, install + debris removal', 'Full white glove: all packing removed.']];
const levelText = (v) => (LEVELS.find((l) => l[0] === v) || [, '—'])[1];
const timingText = (s) => [s.shipBy && `Ship by ${shortDate(s.shipBy)}`, s.arriveBy && `Arrive by ${shortDate(s.arriveBy)}`, s.flexible ? 'Flexible' : ''].filter(Boolean).join(' · ') || 'Flexible';
const destText = (a) => [a.street, [a.city, intlDest(a) ? '' : a.state].filter(Boolean).join(', '), a.zip, intlDest(a) ? a.country : ''].filter(Boolean).map(esc).join(', ');
const OOS_NOTE = 'Pickups and deliveries outside California are custom quoted as Shipping. Within California we always provide white glove delivery. Our shipping team prices your job and emails you a quote; nothing is charged until you authorize payment.';

// ---------- small steps ----------
// Each booking step (What, Where, When, Pay) is shown as a few short screens ("panels"), a handful of questions at a time.
// Every panel of the step is rendered (so all the existing field logic, validation and re-renders keep working) and only the
// current one is visible. `sub` is the id of the visible panel; '' = first, '__last' = last, '__missing' = first one with a gap.
const panel = (id, inner) => `<section class="panel" data-panel="${id}">${inner}</section>`;
let sub = '';
const panelEls = () => [...app.querySelectorAll('[data-panel]')];
const panelIds = () => panelEls().map((p) => p.dataset.panel);
const isLastPanel = () => { const ids = panelIds(); return ids.length < 2 || ids.indexOf(sub) >= ids.length - 1; };
const isFirstPanel = () => { const ids = panelIds(); return ids.length < 2 || ids.indexOf(sub) <= 0; };
// Pieces: up to three short screens each (what it is, how big, value and handling).
const dimsBlock = (i) => {
  const it = S.items[i], p = `items.${i}`;
  const warn = V.belowMinWarning && V.belowMinWarning(it);
  return `<label class="f">Size in inches (W × H × D)${req}</label>
        <div class="row3">${input(`${p}.w`, '', { type: 'number', ph: 'W', attrs: dimAttrs('w', 'Width') })}${input(`${p}.h`, '', { type: 'number', ph: 'H', attrs: dimAttrs('h', 'Height') })}${input(`${p}.d`, '', { type: 'number', ph: 'D', attrs: dimAttrs('d', 'Depth') })}</div>
        ${warn ? `<p class="mini warn-line" data-sizewarn="${i}">${esc(warn.message)} You can still request a quote so we can review this size.</p>${toggle('sizeCheckQuote', 'Request a quote for this size (manual review)', 'We won’t book a date until the team checks the size.', true)}` : ''}`;
};
const pieceHasSize = (it, ship) => ship || needsDims(it);
const pieceSize = (it, i, ship) => (pieceHasSize(it, ship) ? dimsBlock(i) + (FRAMING_TYPES.includes(it.type || 'painting') ? framingBlock(it, i) : '') : '');
// A copied piece keeps its value but asks the customer to look at it again.
const checkValueNote = (it) => (it.checkValue ? `<p class="mini warn-line" data-checkvalnote="${esc(it.id)}">This piece was copied. Please check its value. <button type="button" class="link" data-valok="${esc(it.id)}">Value is right</button></p>` : '');
const pieceCare = (item, i, ship) => {
  const type = item.type || 'painting';
  const p = `items.${i}`;
  const needsWeight = type === 'sculpture' || type === 'other';
  let h;
  if (ship) {
    h = `${weightField(item, i, { required: true })}
    ${input(`${p}.value`, 'Declared value ($)', { ph: 'e.g. 12,000', attrs: 'inputmode="numeric"', req: true })}${checkValueNote(item)}
    ${handlingBlock(item, i)}`;
  } else {
    const value = input(`${p}.value`, 'Declared value per piece ($)', { ph: 'e.g. 12,000', attrs: 'inputmode="numeric"', req: true })
      + `<p class="mini info-note" style="margin:-4px 0 8px" data-valhint="${i}">${valueHint(item)}</p>` + checkValueNote(item);
    h = `${needsWeight ? weightField(item, i, { required: true }) : ''}
        ${type === 'custom' ? '' : value}
        ${type === 'other' ? '<p class="mini" style="margin:0 0 6px">Priced by weight from our sculpture rates. The price covers pickup, delivery and placement wherever you want it. CAD may adjust the price after seeing photos.</p>' : ''}
        ${type === 'sculpture' ? '<p class="mini" style="margin:0 0 6px">One weight-based price covers pickup, delivery and placement wherever you want it.</p>' : ''}
        ${hasInstall() && type === 'decor' && quoteHangList().includes(item.furnitureKind) ? `<p class="mini" style="margin:0 0 6px">${esc(item.furnitureKind)} hanging isn’t on our rate card, so this becomes a quick quote request.</p>` : ''}
        ${type === 'furniture' ? '<p class="mini" style="margin:0 0 6px">One price covers pickup, delivery and placement wherever you want it.</p>' : ''}
        ${!needsWeight && askWeight(item) ? weightField(item, i, { approx: true }) : ''}
        ${handlingBlock(item, i)}`;
  }
  return `${h}
        ${input(`${p}.materialNotes`, 'Material or notes (optional)', { ph: 'e.g. ceramic vase, glass top' })}
        <p class="mini req-line" data-photoreq="${i}" ${itemPhotoReason(item) ? '' : 'hidden'}>${esc(itemPhotoReason(item))}</p>
        <div class="photos">${(item.photos || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}
          <label class="upload">＋ Photos<span data-photolbl="${i}">${itemPhotoReason(item) ? req : ' (optional)'}</span><input type="file" accept="image/*" multiple data-upload="${i}"></label></div>`;
};
const pieceTag = (it, i) => (S.items.length > 1 ? `<p class="piece-tag">${esc(pieceTitle0(it, i))}</p>` : '');
// What, Where, When, Pay: edit links jump straight to a screen ("1:pickup-addr" = Where, Pickup address).
const editBtn = (target, label = 'Edit') => `<button type="button" class="edit" data-goto="${target}">${label}</button>`;

// ---------- piece list: Edit · Duplicate · Remove, Quick edit pieces ----------
// UI-only state (never saved): which piece is asking to be removed / duplicated, and which Quick edit rows are open.
let removeAskId = '', dupAsk = null, dupCount = 1, quickOpen = false;
const openExtras = new Set(); // address screens whose optional access details are expanded (UI only)
const openQuick = new Set();
const pieceFacts = (it) => {
  const dims = [it.w, it.h, it.d].filter(Boolean).join(' × ');
  return [TYPE_LABEL(it.type), dims && dims + ' in', it.weightUnsure ? 'weight not sure' : (it.weight ? fmtNum(it.weight) + ' lb' : ''), num(it.value) > 0 ? fmt(num(it.value)) : '', it.fragile ? 'special handling' : ''].filter(Boolean).join(' · ');
};
// The panel that holds a missing answer, so "fix it" lands on the right screen.
const gapPanelFor = (i, g) => {
  const lab = (g && g.label) || '';
  if (/^Description/.test(lab)) return `p${i}a`;
  if (/^(Size|Framed|Glass|Frame type)/.test(lab)) return pieceHasSize(S.items[i], shipService()) ? `p${i}b` : `p${i}c`;
  return `p${i}c`;
};
// Long orders: finished pieces collapse to one short row (title + value), so the list stays easy to scan. Pieces that need something stay open.
const COMPACT_AT = 8;
const openRows = new Set();
const longList = () => S.items.length > COMPACT_AT;
const listSummary = () => {
  if (!longList()) return '';
  const bad = S.items.filter((it, i) => itemGapList(it, i, 'What').length).length, chk = S.items.filter((it) => it.checkValue).length;
  const total = S.items.reduce((a, it) => a + (num(it.value) > 0 ? num(it.value) : 0), 0);
  return `<p class="mini pc-summary" data-pcsummary><b>${S.items.length} pieces</b> · ${S.items.length - bad} complete${bad ? ` · <b>${bad} need${bad === 1 ? 's' : ''} details</b>` : ''}${chk ? ` · <b>${chk} to check</b>` : ''} · ${fmt(total)} total declared value. Tap Details on a piece to see its full line.</p>`;
};
const pieceListRow = (it, i) => {
  const id = esc(it.id);
  const gaps = itemGapList(it, i, 'What');
  const confirm = removeAskId === it.id && S.items.length > 1
    ? `<div class="pc-confirm" role="alert"><span>Remove ${esc(pieceTitle0(it, i))}?</span><span class="pc-confirm-btns"><button type="button" class="btn primary danger" data-removeyes="${id}">Yes, remove</button><button type="button" class="btn ghost" data-removeno>Keep it</button></span></div>` : '';
  const dup = dupAsk === it.id ? dupDialog(it) : '';
  const compact = longList() && !gaps.length && !it.checkValue && !confirm && !dup && !openRows.has(it.id);
  const toggle = longList() && !gaps.length && !it.checkValue ? `<span class="dot">·</span><button type="button" class="link" data-pcopen="${id}" aria-expanded="${compact ? 'false' : 'true'}">${compact ? 'Details' : 'Hide details'}</button>` : '';
  return `<div class="pc ${gaps.length ? 'incomplete' : ''} ${compact ? 'compact' : ''}" data-piece-id="${id}" data-piece-row="${i}">
    <div class="pc-main"><b class="pc-title">${esc(pieceTitle0(it, i))}</b>
      ${compact ? `<span class="muted pc-val">${num(it.value) > 0 ? fmt(num(it.value)) : ''}</span>` : ''}
      <span class="muted pc-facts">${esc(pieceFacts(it))}</span>
      ${it.checkValue ? '<span class="tag warn" data-checkvalue>Check value</span>' : ''}
      ${gaps.length ? `<span class="tag bad">Needs details</span> <button type="button" class="link" data-fixpiece="${i}" data-fixpanel="${gapPanelFor(i, gaps[0])}">${esc(gaps[0].msg)}</button>` : ''}</div>
    <div class="pc-actions">${editBtn(`0:p${i}a`)}<span class="dot">·</span><button type="button" class="link" data-dupopen="${id}">Duplicate</button>${S.items.length > 1 ? `<span class="dot">·</span><button type="button" class="link muted" data-removeask="${id}">Remove</button>` : ''}${toggle}</div>
    ${confirm}${dup}</div>`;
};
const dupMax = () => Math.max(0, MAX_PIECES - S.items.length);
const dupLabel = (n) => `Create ${n} piece${n === 1 ? '' : 's'}`;
const dupDialog = (it) => {
  const max = dupMax();
  if (max < 1) return `<div class="pc-dup"><p class="mini">An order can have up to ${MAX_PIECES} pieces.</p><button type="button" class="btn ghost" data-dupcancel>Close</button></div>`;
  const n = Math.min(Math.max(1, dupCount), max);
  const hasPhotos = (it.photos || []).length > 0;
  return `<div class="pc-dup" data-dupdialog>
    <label class="f" for="dup-n">How many additional pieces would you like to create?</label>
    <input id="dup-n" type="number" min="1" max="${max}" inputmode="numeric" value="${n}" data-dupn>
    <p class="mini">We’ll copy the details from this piece. You can edit each copy before you book.</p>
    ${hasPhotos ? `<label class="toggle"><span>Use this piece’s photos on the copies<small>Leave off to add each piece’s own photos.</small></span><span class="sw"><input type="checkbox" id="dup-photos" data-dupphotos><i></i></span></label>` : '<p class="mini">Photos aren’t copied. Each piece gets its own photos when they’re needed.</p>'}
    <div class="pc-dup-btns"><button type="button" class="btn primary" id="dupGo" data-dupgo="${esc(it.id)}">${dupLabel(n)}</button><button type="button" class="btn ghost" data-dupcancel>Cancel</button></div>
  </div>`;
};
// Quick edit pieces: every piece as a collapsed row; open one to change its basics without stepping through the screens.
const quickEditBlock = () => {
  if (S.items.length < 2) return '';
  const row = (it, i) => {
    const p = `items.${i}`; const ip = { idp: 'q-' };
    const dimsOn = needsDims(it) || shipService();
    return `<details class="qrow" data-qpiece="${esc(it.id)}" ${openQuick.has(it.id) ? 'open' : ''}>
      <summary><b>${esc(pieceTitle0(it, i))}</b><span class="muted">${esc(pieceFacts(it))}</span>${it.checkValue ? '<span class="tag warn">Check value</span>' : ''}</summary>
      <div class="qbody">
        ${input(`${p}.description`, 'Description', { ...ip })}
        ${dimsOn ? `<label class="f">Size in inches (W × H × D)</label><div class="row3">${['w', 'h', 'd'].map((k, n2) => input(`${p}.${k}`, '', { ...ip, type: 'number', ph: 'WHD'[n2], attrs: dimAttrs(k, ['Width', 'Height', 'Depth'][n2]) })).join('')}</div>` : ''}
        ${FRAMING_TYPES.includes(it.type || 'painting') ? `<div class="field"><label class="f">Framed?</label>${seg(`${p}.framed`, [['yes', 'Yes'], ['no', 'No']])}</div>` : ''}
        ${it.type !== 'custom' ? input(`${p}.value`, 'Declared value ($)', { ...ip, ph: 'e.g. 12,000', attrs: 'inputmode="numeric"' }) : ''}
        ${it.checkValue ? `<button type="button" class="pill-btn" data-valok="${esc(it.id)}">Value is right</button>` : ''}
        ${askWeight(it) ? `<div class="field"><div class="qweight"><label class="f" for="q-${p}.weight">Weight (lb)</label><button type="button" class="pill-btn ${it.weightUnsure ? 'on' : ''}" data-weightunsure="${i}">${it.weightUnsure ? '✓ Not sure' : 'Not sure'}</button></div>
          ${it.weightUnsure ? '<p class="mini">No problem, you can skip this.</p>' : input(`${p}.weight`, '', { ...ip, ph: 'e.g. 40', attrs: 'inputmode="decimal" aria-label="Weight in pounds"' })}</div>` : ''}
        ${toggle(`${p}.fragile`, 'Special handling needed', '', true)}
        ${input(`${p}.materialNotes`, 'Material or notes (optional)', { ...ip, ph: 'e.g. ceramic vase, glass top' })}
        ${editBtn(`0:p${i}a`, 'Open all details')}
      </div></details>`;
  };
  return `<details class="quick" data-quick ${quickOpen ? 'open' : ''}><summary>Quick edit pieces</summary><div class="qlist">${S.items.map(row).join('')}</div></details>`;
};

// Final review: every piece on its own row (never a single "10×" line), with the check-everything reminder.
// Copied pieces keep their declared value but must be confirmed (or edited) before payment (Dot). Everything else can be filled in meanwhile.
const flaggedPieces = () => S.items.map((it, i) => [it, i]).filter(([it]) => it.checkValue);
const valueConfirmCard = (where) => {
  const f = flaggedPieces(); if (!f.length) return '';
  const bulk = f.length > 1 ? `<button type="button" class="btn primary vc-all" data-valall>Confirm all ${f.length} values</button><p class="mini vc-fine">Confirm all says: the declared value shown for each of these pieces is correct.</p>` : '';
  const rows = `<div class="vc-list">${f.map(([it, i]) => `<div class="vc-row" data-vc="${esc(it.id)}"><span class="vc-what"><b>${esc(pieceTitle0(it, i))}</b><br><span class="muted">${num(it.value) > 0 ? fmt(num(it.value)) : 'No value yet'}</span></span><span class="vc-btns"><button type="button" class="pill-btn" data-valok="${esc(it.id)}">Value is right</button>${editBtn(`0:p${i}c`, 'Edit value')}</span></div>`).join('')}</div>`;
  return `<div class="card val-confirm" data-checkvalues="${where}"><h2>Confirm declared values (${f.length})</h2>
    <p class="mini">${f.length === 1 ? 'This piece was copied' : `These ${f.length} pieces were copied`}. Please check ${f.length === 1 ? 'its declared value' : 'each declared value'}, then confirm ${f.length === 1 ? 'it' : 'them'}. If a value is wrong, edit it instead.${where === 'review' ? ' Payment is on hold until this is done.' : ' You can keep filling in the other steps; payment is on hold until this is done.'}</p>
    ${bulk}
    ${where === 'review' ? rows + (f.length === 1 ? '<p class="mini vc-fine">Confirming says: the declared value shown for this piece is correct.</p>' : '') : '<p class="mini">Or confirm one at a time in the list below.</p>'}</div>`;
};
const reviewPieces = () => `<div class="sum-row piece-review-note"><span class="mini" data-piece-note>Please check each piece’s details.</span></div>`
  + S.items.map((it, i) => `<div class="sum-row" data-review-piece="${i}"><span><b>${esc(pieceTitle0(it, i))}</b><br><span class="muted">${esc([pieceFacts(it), framingText(it), (it.photos || []).length ? `${it.photos.length} photo${it.photos.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</span>${it.checkValue ? '<br><span class="tag warn">Check value</span>' : ''}</span><span>${editBtn(`0:p${i}a`)}</span></div>`).join('');
// Confirmation page: every piece, by number (collapsed until opened).
const yourPieces = (o) => {
  const list = (o.items || []);
  if (!list.length) return '';
  return `<details class="your-pieces card" data-yourpieces><summary>Your pieces (${list.length})</summary><div class="yp-list">${list.map((it, i) => {
    const dims = [it.w, it.h, it.d].filter(Boolean).join(' × ');
    return `<div class="sum-row" data-yp="${i}"><span><b>Piece ${i + 1}</b>${String(it.description || '').trim() ? ' — ' + esc(String(it.description).trim()) : ''}<br><span class="muted">${esc([TYPE_LABEL(it.type), dims && dims + ' in'].filter(Boolean).join(' · '))}</span></span><span class="amt">${num(it.value) > 0 ? fmt(num(it.value)) : '—'}${num(it.value) > 0 ? '<br><span class="muted">declared value</span>' : ''}</span></div>`;
  }).join('')}</div></details>`;
};
// Description helper (Chad, Nov 21 2026): examples of what helps, not "just the medium".
const descHint = (type) => (['furniture', 'decor'].includes(type) ? 'For example: material or style, maker or designer, etc.'
  : ['sculpture', 'other'].includes(type) ? 'For example: material (bronze, marble, glass?), artist or maker, etc.'
  : 'For example: medium (oil, acrylic?), relief or heavy texture?, artist name, etc.');
// ---------- views ----------
const contactSideWord = (key) => (key === 'pickup' ? 'Pickup' : S.service === 'install_only' ? 'Install' : shipService() ? 'Destination' : 'Delivery');
const contactLabel = (key) => contactSideWord(key) + ' contact';
const roleLabel = (key) => contactLabel(key) + ' role';
function payerOptions() {
  if (S.payer === 'me') S.payer = (S.dropoff && S.dropoff.sameAsMe && !(S.pickup && S.pickup.sameAsMe)) ? 'dropoff' : 'pickup';
  const puName = (S.pickup && S.pickup.contactName) || 'Pickup contact';
  const deWord = S.service === 'install_only' ? 'Install' : 'Delivery';
  const deName = (S.dropoff && S.dropoff.contactName) || (deWord + ' contact');
  const opts = [];
  if (svc().needsPickup) opts.push(['pickup', 'Pickup contact (' + puName + ')']);
  if (S.dropoff) opts.push(['dropoff', deWord + ' contact (' + deName + ')']);
  if (isBizReferral()) opts.push(['partner', 'Referring partner']);
  opts.push(['other', 'Someone else']);
  if (S.payer === 'pickup' && !svc().needsPickup) S.payer = 'dropoff';
  return opts;
}
function payerCardHtml() {
  return `<div class="card">${seg('payer', payerOptions())}
        ${S.payer === 'other' ? `<div class="row" style="margin-top:12px">${input('payerOther.name', 'Payer name', { req: true })}${input('payerOther.email', 'Payer email', { type: 'email', req: true, attrs: 'autocapitalize="off" autocomplete="email"' })}</div>
        ${input('payerOther.phone', 'Payer phone', { type: 'tel', req: true, ph: '(415) 555-0123', attrs: 'autocomplete="tel"' })}` : ''}
        ${S.payer === 'partner' && !(isBizReferral() && (S.heard.businessName || S.heard.referrerName || S.partner.name)) ? `<p class="mini">Add the referring partner in <button type="button" class="edit" style="padding:0" data-goto="1:about">Where</button> so we know who to bill.</p>` : ''}</div>`;
}
function payerNameLabel() {
  if (S.payer === 'other') return S.payerOther.name || 'Someone else';
  if (S.payer === 'partner') return 'Referring partner';
  if (S.payer === 'dropoff') return (S.service === 'install_only' ? 'Install contact' : 'Delivery contact') + ((S.dropoff && S.dropoff.contactName) ? ' (' + S.dropoff.contactName + ')' : '');
  return 'Pickup contact' + ((S.pickup && S.pickup.contactName) ? ' (' + S.pickup.contactName + ')' : '');
}


// Front-loaded progress (Chad, Nov 25 2026): early Next clicks cover more of the bar, later ones taper,
// and 100% is reserved for the review / submit screen. The curve is computed over the actual booking
// path (every short screen, including ones that appear after a service is chosen) so the bar never
// shrinks when moving forward — only when the client taps Back.
function frontLoadedPct(index, total, atEnd) {
  if (atEnd || total <= 1) return 100;
  const i = Math.max(0, Math.min(index, total - 1));
  if (i >= total - 1) return 100;
  const ratio = (total - 1) / total;
  const k = Math.log(0.75) / Math.log(ratio || 0.5); // first screen is about 25%
  const t = (i + 1) / total;
  return Math.max(1, Math.min(99, Math.round(100 * (1 - Math.pow(1 - t, k)))));
}
function bookingPathKeys() {
  const saved = S.service;
  const planned = !saved;
  if (planned) S.service = 'pickup_delivery';
  const keys = [];
  try {
    ['What', 'Where', 'When', 'Pay'].forEach((name) => {
      const html = views[name]();
      const ids = [...String(html).matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
      const si = STEPS.indexOf(name);
      ids.forEach((id) => keys.push(si + ':' + id));
    });
  } finally {
    if (planned) S.service = saved;
  }
  return keys;
}
let progressHigh = 0, lastPathIndex = -1;
function setProgressBar(pct) {
  const bar = $('#progress i'); if (bar) bar.style.width = pct + '%';
  const pg = $('#progress'); if (pg) pg.setAttribute('aria-valuenow', String(pct));
}
function paintProgress(name) {
  if (name === 'Done') { progressHigh = 100; lastPathIndex = 1e9; setProgressBar(100); return; }
  const keys = bookingPathKeys();
  const key = step + ':' + sub;
  let i = keys.indexOf(key);
  if (i < 0 && sub) i = keys.findIndex((k) => k.endsWith(':' + sub));
  if (i < 0) i = Math.max(0, lastPathIndex);
  const atEnd = !!(keys.length && keys[keys.length - 1] === (step + ':' + sub));
  let pct = frontLoadedPct(i, Math.max(1, keys.length), atEnd);
  const goingBack = lastPathIndex >= 0 && i < lastPathIndex;
  if (goingBack) progressHigh = pct;
  else { pct = Math.max(pct, progressHigh); progressHigh = pct; }
  lastPathIndex = i;
  setProgressBar(pct);
}

const views = {
  What() {
    const base = (CFG.pricing && CFG.pricing.displayFrom) || {};
    const ship = shipService();
    const itemA = (item, i) => {
      const type = item.type || 'painting';
      const p = `items.${i}`;
      const ph = { painting: 'e.g. Oil on canvas', photograph: 'e.g. Signed gelatin silver print', mirror: 'e.g. Venetian mirror, gilt', wallart: 'e.g. Mixed media, wall sculpture', sculpture: 'e.g. Bronze on plinth', furniture: 'e.g. Walnut credenza', decor: item.furnitureKind === 'Other (describe)' ? 'e.g. Ceramic garden stool, pair of candlesticks' : 'e.g. Pair of table lamps', other: 'e.g. Antique clock, Murano glass chandelier', custom: 'e.g. Collect two pieces from a framer and deliver them with the rest' }[type];
      const kinds = type === 'furniture' ? (CFG.pricing.furnitureKinds || []) : decorKindOptions();
      const kindRow = (type === 'furniture' || type === 'decor') ? `<div class="field">${select(`${p}.furnitureKind`, type === 'decor' ? 'Type of décor' : 'Item', kinds, { rerender: true })}</div>` : '';
      return `<div class="card"><div class="item-head"><b>Piece ${i + 1}</b><span class="item-actions">
          ${S.items.length > 1 ? `<button type="button" class="link muted" data-removeask="${esc(item.id)}">Remove this piece</button>` : ''}</span></div>
        <div class="field"><div class="chips" data-itemtype="${i}">${itemTypes().map(([v, l]) => `<button type="button" class="chip ${type === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
        ${type === 'photograph' ? `<p class="mini" style="margin:-4px 0 10px">Prints and photographs${hasInstall() ? '. Hung on a wall, so we can install it.' : ', framed or unframed.'}</p>` : ''}
        ${type === 'wallart' ? `<p class="mini" style="margin:-4px 0 10px">Mixed media, wall sculpture, etc.${hasInstall() ? ' Hung on a wall, so we can install it.' : ''}</p>` : ''}
        ${kindRow}
        ${input(`${p}.description`, type === 'custom' ? 'Your request' : 'Description of this piece', { ph, req: true })}
        ${type === 'custom' ? '<p class="mini" style="margin:0 0 6px">Tell us what you need in the description. CAD reviews it and sends a custom quote; nothing is charged until you authorize payment.</p>'
          : `<p class="mini desc-hint" data-deschint style="margin:-4px 0 10px">${descHint(type)}</p>`}
      </div>`;
    };
    const pieceTitle = (i) => (S.items.length > 1 ? `Piece ${i + 1}: what is it?` : `What are we ${svcVerb()}?`);
    const panels = [];
    panels.push(panel('service', `<h1>${S.service === 'install_only' ? 'What are we installing?' : 'How can we help?'}</h1><p class="sub">Art, furniture, decor, and antiques are our specialty, plus other fragile or valuable pieces.</p>
      <div class="choices">${Object.entries(CFG.services).map(([k, v]) => `<button type="button" class="choice ${S.service === k ? 'on' : ''}" data-service="${k}">
        <span class="ico">${ICONS[k]}</span><span class="txt"><b>${v.label}</b>${SUBTITLE[k] ? `<span class="svc-sub">${esc(SUBTITLE[k])}</span>` : ''}<span class="d">${DESC[k]}</span></span><span class="from">${base[k] == null ? 'Custom quote' : 'from ' + fmt(base[k])}</span></button>`).join('')}</div>
      <p class="mini" data-from-note>Starting prices don’t include declared value protection.</p>`));
    if (S.service) {
      S.items.forEach((item, i) => {
        panels.push(panel(`p${i}a`, `<h1>${pieceTitle(i)}</h1>${itemA(item, i)}`));
        if (pieceHasSize(item, ship)) panels.push(panel(`p${i}b`, `<h1>How big is it?</h1>${pieceTag(item, i)}<div class="card">${pieceSize(item, i, ship)}</div>`));
        panels.push(panel(`p${i}c`, `<h1>${ship ? 'Weight, value and care' : 'Value and care'}</h1>${pieceTag(item, i)}<div class="card">${pieceCare(item, i, ship)}</div>${S.items.length === 1 ? `<button type="button" class="add" id="addItem">＋ Add another piece</button><p class="mini" style="text-align:center;margin-top:8px">Several similar pieces? <button type="button" class="link" data-duplist="${esc(item.id)}">Duplicate this piece</button></p>` : ''}`));
      });
      // One piece: no list screen (Add another piece is on the value screen). Two or more: the list screen to check, copy or remove.
      if (S.items.length > 1 || UI.showList) panels.push(panel('pieces-more', `<h1>Anything else to ${svcVerbShort()}?</h1>
        ${flaggedPieces().length > 1 ? valueConfirmCard('list') : ''}
        ${listSummary()}
        <div class="card pc-list" data-pclist>${S.items.map((it, i) => pieceListRow(it, i)).join('')}</div>
        <button type="button" class="add" id="addItem">＋ Add another piece</button>
        ${quickEditBlock()}
        ${ship ? '<p class="mini">Shipping is custom quoted. We’ll email your price before anything is charged.</p>' : ''}`));
      if (S.items.length === 1 && ship) panels[panels.length - 1] = panels[panels.length - 1].replace('</section>', '<p class="mini">Shipping is custom quoted. We’ll email your price before anything is charged.</p></section>');
    }
    return panels.join('');
  },

  Where() {
    // "Same as me" is the default on-site contact, so keep its name and mobile in step with the booker's before the panels draw.
    applySameAsMe('pickup'); applySameAsMe('dropoff'); applySamePickup(); tidyAccess('pickup'); tidyAccess('dropoff');
    const oos = () => (outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : '');
    const addrPanel = (key, optional = false) => {
      const a = get(key);
      const title = key === 'pickup' ? 'Where are we picking up?' : shipService() ? 'Where is it going?' : S.service === 'install_only' ? 'Where are we installing?' : 'Where are we delivering?';
      // Shipping destination: out-of-state example text, never California examples (QA re-check N4).
      const shipDest = key === 'dropoff' && shipService();
      const caNote = key === 'dropoff' && shipInsideCA() ? caNoteHtml() : '';
      return panel(`${key}-addr`, `<h1>${title}</h1>${oos()}${caNote}<div class="card">
        ${key === 'dropoff' && shipService() ? input(`${key}.country`, 'Country', { ph: 'United States', attrs: 'autocomplete="country-name"', req: true }) : ''}
        ${key === 'dropoff' && shipService() && intlDest(a)
          ? `<div class="field"><label class="f" for="f-${key}.street">Full address${req}</label><textarea id="f-${key}.street" data-path="${key}.street" placeholder="Street, building, postal code, city, region">${esc(a.street)}</textarea></div>${input(`${key}.city`, 'City', { ph: 'e.g. London', req: true })}`
          : `${input(`${key}.street`, 'Street address', { ph: key === 'pickup' ? '2 Henry Adams St' : shipDest ? '350 5th Ave' : '8678 Melrose Ave', attrs: 'autocomplete="street-address"', req: !optional })}
        <label class="chk" data-nostreet><input type="checkbox" data-path="${key}.noStreetNumber" data-rerender ${a.noStreetNumber ? 'checked' : ''}> My address has no street number</label>
        ${a.noStreetNumber ? '<p class="mini" style="margin:-2px 0 8px">Describe it above (for example “Star Route” or the estate name). Our team will confirm the exact location with you before anything is charged.</p>' : ''}
        <div class="row keep addr3">${input(`${key}.city`, 'City', { ph: key === 'pickup' ? 'San Francisco' : shipDest ? 'New York' : 'West Hollywood', req: !optional })}${input(`${key}.state`, 'State', { ph: shipDest ? 'NY' : 'CA', attrs: 'autocomplete="address-level1" maxlength="14"' })}${input(`${key}.zip`, 'ZIP', { ph: key === 'pickup' ? '94103' : shipDest ? '10118' : '90069', req: !optional, attrs: 'inputmode="numeric" autocomplete="postal-code" maxlength="10"' })}</div>
        <p class="mini zip-check" data-zipcheck="${key}" hidden></p>`}
        ${key === 'dropoff' && shipService() ? `<div class="field" style="margin-top:4px"><label class="f">Destination type</label>${seg(`${key}.locationType`, [['residential', 'Residential'], ['commercial', 'Commercial']])}</div>` : ''}
        ${input(`${key}.business`, 'Business or gallery (optional)', { ph: 'e.g. gallery, showroom, hotel' })}
      </div>${!accessQuestionsNeeded() ? contactLineHtml(key) : ''}${accessExtras(key, a)}`);
    };
    // Tight spaces, parking, access hours and special instructions (Chad, Nov 21 2026): one collapsed, optional section on the
    // address screen instead of its own screen, so a regular customer flies through. Opens by itself when anything is filled in.
    const accessExtras = (key, a) => {
      const any = !!(a.technicalCarry || CADAccess.roughPath(a) || a.parkingRestricted || String(a.hours || '').trim() || String(a.notes || '').trim());
      const open = any || openExtras.has(key);
      return `<details class="card access-extras" data-extras="${key}" ${open ? 'open' : ''}><summary>Add access details <span class="opt">(optional)</span><span class="mini">Tight spaces, parking, access hours, special instructions</span></summary>
        <div class="extras-body">${accessBlock(key, a).extra}
        <div class="field" style="margin:0"><label class="f" for="f-${key}.notes">Special instructions</label><textarea id="f-${key}.notes" data-path="${key}.notes" placeholder="Gate codes, who to ask for, anything else">${esc(a.notes)}</textarea></div></div></details>`;
    };
    const whereWord = (key) => (key === 'pickup' ? 'pickup' : S.service === 'install_only' ? 'install' : shipService() ? 'destination' : 'delivery');
    const contactLineHtml = (key) => {
      const a = get(key);
      if (contactShown(key)) return '';
      return `<p class="mini contact-line" data-contactline="${key}">${esc(contactLabel(key))}: you${a.contactName ? ` (${esc(a.contactName)})` : ''} <button type="button" class="link" data-showcontact="${key}">Change</button></p>`;
    };
    const contactPanel = (key, optional = false) => {
      const a = get(key);
      // Chad, Nov 21 2026: "Pickup contact" / "Delivery contact". Nobody has to be on site, so no "let us in" line.
      return panel(`${key}-contact`, `<h1>Who’s the ${whereWord(key)} contact?</h1><div class="card">
        <div class="sub-head first"><span><b>${whereWord(key)[0].toUpperCase() + whereWord(key).slice(1)}</b> contact</span></div>
        <div class="contact-picks"><label class="chk" data-samewrap="${key}"><input type="checkbox" data-same="${key}" ${a.sameAsMe ? 'checked' : ''}> I’m the ${whereWord(key)} contact</label>
        ${key === 'dropoff' && svc().needsPickup && !S.pickup.sameAsMe ? `<label class="chk" data-samepuwrap><input type="checkbox" data-samepu ${a.samePickup ? 'checked' : ''}> Same as pickup contact${S.pickup.contactName ? ` (${esc(S.pickup.contactName)})` : ''}</label>` : ''}</div>
        <div class="row keep">${input(`${key}.contactName`, 'Name', { ph: 'Name', req: !optional })}${input(`${key}.contactPhone`, 'Mobile', { type: 'tel', ph: '(310) 555-0100', req: !optional, attrs: 'autocomplete="tel"' })}</div>
        <div data-rolewrap="${key}" ${a.sameAsMe || (key === 'dropoff' && samePickupOn()) ? 'hidden' : ''}>${select(`${key}.contactRole`, roleLabel(key), CONTACT_ROLES, { req: !optional, placeholder: 'Please choose one', rerender: true })}
        ${a.contactRole === 'Other' ? input(`${key}.contactRoleOther`, 'Describe their role', { req: true, ph: 'e.g. House sitter' }) : ''}</div>
      </div>`);
    };
    const accessPanels = (key) => {
      if (!accessQuestionsNeeded()) return [];
      const a = get(key);
      const ab = accessBlock(key, a);
      const at = `<p class="sub">${key === 'pickup' ? 'Pickup' : S.service === 'install_only' ? 'Install' : shipService() ? 'Destination' : 'Delivery'}${a.street ? ' · ' + esc(a.street) : ''}</p>`;
      const me = contactLineHtml(key);
      const path = CADAccess.asksPathAccess(S.items) ? ab.inn : '';
      const std = CADAccess.asksDoorwayAccess(S.items) ? `<div class="field" data-reqblock="${key}-stdDoorway" style="margin:14px 0 0"><label class="f">Standard doorway and hallway?${req}</label>${seg(`${key}.stdDoorway`, [['yes', 'Yes'], ['no', 'No']])}<p class="mini" style="margin:6px 0 0">No tight doorways, narrow halls or sharp turns on the way in.</p></div>` : '';
      const title = CADAccess.asksPathAccess(S.items) ? pathQuestion(key) : 'Standard doorway and hallway?';
      return [
        panel(`${key}-access`, `<h1>${title}</h1>${at}${me}<div class="card">${path}${std}</div>`),
        doorsShown(key) ? panel(`${key}-doors`, `<h1>Doors and fit</h1>${at}<div class="card">${ab.doors || '<p class="mini" style="margin:0">Tell us how we reach the spot first.</p>'}</div>`) : '',
      ];
    };
    const out = [];
    out.push(panel('you', `<h1>Let’s start with you</h1><div class="card">
        ${input('contact.name', 'Full name', { attrs: 'autocomplete="name"', req: true })}
        <div class="row">${input('contact.email', 'Email', { type: 'email', attrs: 'autocomplete="email" autocapitalize="off"', req: true })}${input('contact.phone', 'Mobile', { type: 'tel', ph: '(415) 555-0123', attrs: 'autocomplete="tel"', req: true })}</div>
      </div>`));
    out.push(panel('about', `<h1>A little about you</h1><div class="card">
        <div class="row">${input('contact.company', 'Company (optional)')}${select('contact.clientType', 'I am a…', ['Collector', 'Gallery', 'Furniture showroom', 'Interior designer', 'Auction house', 'Artist', 'Other'], { req: true, placeholder: 'Please choose one' })}</div>
      </div><h2>How did you find us?</h2><div class="card">
        <div class="field" data-reqblock="repeatAnswer" style="margin:0 0 12px"><label class="f">I’ve ordered with CAD before?${req}</label>${seg('heard.repeatAnswer', [['yes', 'Yes'], ['no', 'No']])}
        ${S.heard.repeatAnswer === 'yes' ? '<p class="mini" style="margin:6px 0 0">Welcome back.</p>' : ''}</div>
        ${S.heard.repeatAnswer === 'no' ? `${select('heard.source', 'How did you hear about us?', HEARD_SOURCES, { req: true, placeholder: 'Please choose one', rerender: true })}
        ${S.heard.source === 'referral' ? `${select('heard.referrerKind', 'Who referred you?', REFERRER_KINDS, { req: true, placeholder: 'Please choose one', rerender: true })}
        ${input('heard.referrerName', 'Referrer name (optional)', { ph: 'Name' })}
        <div class="row keep">${input('heard.referrerPhone', 'Referrer mobile (optional)', { type: 'tel', ph: '(415) 555-0123', attrs: 'autocomplete="off"' })}${input('heard.referrerEmail', 'Referrer email (optional)', { type: 'email', attrs: 'autocapitalize="off" autocomplete="off"' })}</div>
        ${BUSINESS_REFERRERS.includes(S.heard.referrerKind) ? input('heard.businessName', 'Business name (optional)', { ph: 'Gallery or showroom name' }) : ''}
        <p class="mini member-pitch">If someone referred you, we’d love to thank them.</p>` : ''}
        ${HEARD_DETAIL[S.heard.source] ? input('heard.sourceDetail', HEARD_DETAIL[S.heard.source][0], { ph: HEARD_DETAIL[S.heard.source][1] }) : ''}
        ${S.heard.source === 'other' ? input('heard.sourceOther', 'Tell us where', { req: true, ph: 'Where did you hear about us?' }) : ''}` : ''}
      </div>`));
    if (svc().needsPickup) { out.push(addrPanel('pickup'), contactShown('pickup') ? contactPanel('pickup') : '', ...accessPanels('pickup')); }
    out.push(addrPanel('dropoff'), contactShown('dropoff') ? contactPanel('dropoff') : '', ...accessPanels('dropoff'));
    const da = get('dropoff');
    if (intlDest(da) && shipService()) {
      out.push(panel('customs', `<h1>Customs / import contact</h1><p class="sub">The person or broker who clears the shipment at the destination. Leave blank if it’s the recipient.</p><div class="card">
        <div class="row keep">${input('shipping.customs.name', 'Name', { ph: 'Name or broker' })}${input('shipping.customs.phone', 'Phone', { type: 'tel', ph: '+44 20 0000 0000' })}</div>
        ${input('shipping.customs.email', 'Email', { type: 'email', attrs: 'autocapitalize="off"' })}</div>`));
    }
    if (hasHanging() && !isShip()) {
      out.push(panel('hang', `<h1>About the walls</h1><p class="sub">For hanging.</p><div class="card">
        ${select('dropoff.wallType', 'Wall type (optional)', ['Not sure', 'Drywall', 'Plaster', 'Concrete / brick', 'Wood', 'Tile / stone', 'Glass'], { placeholder: 'Please choose one' })}
        ${S.items.map((it, i) => (isHung(it) ? hardwareField(it, i) : '')).join('')}</div>`));
      S.items.forEach((it, i) => { if (isHung(it)) out.push(panel(`hang-p${i}`, `<h1>How high should we hang it?</h1><div class="card">${hangPieceBlock(it, i)}</div>`)); });
    }
    if (S.items.some(pieceNeedsStairwellFit)) {
      out.push(panel('stairfit', `<h1>Stairwell fit</h1><div class="card">${S.items.map((it, i) => pieceNeedsStairwellFit(it) ? `<div data-reqblock="stairwellFit-${i}"><label class="toggle"><span>Piece ${i + 1}${it.description ? ` (${esc(it.description)})` : ''}: ${esc(CADAccess.ACK_TEXT)}</span>
        <span class="sw"><input type="checkbox" data-path="items.${i}.fitsStairwell" ${it.fitsStairwell ? 'checked' : ''}><i></i></span></label></div>` : '').join('')}</div>`));
    }
    return out.join('');
  },

  When() {
    if (isShip()) return views.ShipWhen();
    if (!avail) return panel('date', `<h1>Choose your date</h1><p class="sub">Finding route days near you…</p>`);
    if (avail.requestQuote || avail.quote || avail.unverified || avail.calendarUnavailable || ((!(avail.days || []).length) && avail.prompt === 'Request a quote')) {
      const by = (avail.quoteBy && avail.quoteBy.text) || 'within 1 business day';
      return panel('date', `<h1>Request a quote</h1><p class="sub">${esc(avail.error || 'We couldn’t offer dates for this address yet.')}</p>
        <p class="mini">Send this as a quote request and we’ll reply ${esc(by)}. Nothing is charged until you authorize payment.</p>
        <div class="card" style="margin-top:14px">${toggle('quoteOnly', 'Request a quote (we’ll confirm details by hand)', 'Your request goes to the team. No dates are booked and nothing is charged until you authorize payment.', true, 'first')}</div>`);
    }
    const region = avail.region || 'your area';
    const card = (d) => { const [w, m, n] = d.label.replace(',', '').split(' '); return `<button type="button" class="day ${S.schedule.date === d.date && !!S.rush === !!d.rush ? 'on' : ''} ${d.rush ? 'rush' : ''}" data-date="${d.date}" data-rush="${d.rush ? 1 : ''}"><div class="dw">${w}</div><div class="dd">${m} ${n}</div><div class="rg">${d.rush ? 'Rush quote' : esc(d.shortLabel || d.routeLabel || d.region)}</div></button>`; };
    const simpleOc = (avail.days || []).some((d) => d.simpleStop);
    const intro = simpleOc
      ? 'A small Orange County job (1–2 standard pieces) can go on a Monday. Larger Orange County jobs go on the Thursday of a Southern California week.'
      : avail.zone === 'LA' ? 'Los Angeles is served every Monday.' : '';
    const sel = [...avail.days, ...avail.rush].find((d) => d.date === S.schedule.date && !!S.rush === !!d.rush);
    const two = needsTwoDates();
    const title = two ? 'Choose your pickup date' : 'Choose your date';
    const subTxt = two
      ? 'Our van follows a weekly route. Pick a route day that serves the pickup address.'
      : 'Our van follows a weekly route. Pick a route day.'
    const dedOk = (side) => !dedOn(side) || !dedDateProblem(get(dedDatePath(side)), side);
    const ready = (two ? !!(S.schedule.date && S.schedule.deliveryDate) : !!S.schedule.date) && dedOk('pickup') && dedOk('delivery');
    if (S.schedule.date && !(S.schedule.timePref || '').trim()) S.schedule.timePref = 'none';
    if (S.schedule.deliveryDate && !(S.schedule.deliveryTimePref || '').trim()) S.schedule.deliveryTimePref = 'none';
    const fd = dedOn(firstSide());
    const pickupHtml = `<h1 class="when-h1">${title}</h1>${fd ? '' : `<p class="sub">${subTxt}</p>
      <div class="region">● ${esc(avail.area || region)} route</div>
      <div class="days" data-reqblock="date">${dayWindow(avail.days, S.schedule.date, 'pu').list.map(card).join('')}</div>${dayWindow(avail.days, S.schedule.date, 'pu').btn}
      ${intro ? `<p class="mini">${intro}</p>` : ''}
      ${avail.rush.length ? `<h2>Need a different date?</h2><div class="days">${avail.rush.map(card).join('')}</div>` : ''}`}
      ${dedBox(firstSide())}
      ${sel ? routeHint(sel) : ''}
      ${S.schedule.date ? timePrefBlock('schedule.timePref', 'schedule.timeNote', { showReassure: true }) : ''}`;
    const tail = `${ready ? promiseCard(tripLine() || (sel && sel.routeLabel) || (region + ' route')) : ''}
`;
    if (two) {
      const dsel = delAvail && (delAvail.days || []).find((d) => d.date === S.schedule.deliveryDate);
      const pairHtml = `<h1 class="when-h1">Choose your dates</h1>
        ${pairBlock()}
        ${intro ? `<p class="mini">${intro}</p>` : ''}
        ${sel ? routeHint(sel) : dsel ? routeHint(dsel) : ''}
        ${S.schedule.date ? `<div class="pair-pref"><p class="col-sub">Pickup · ${esc(shortDate(S.schedule.date))}</p>${timePrefBlock('schedule.timePref', 'schedule.timeNote', { explain: !S.schedule.deliveryDate })}</div>` : ''}
        ${S.schedule.deliveryDate ? `<div class="pair-pref"><p class="col-sub">Delivery · ${esc(shortDate(S.schedule.deliveryDate))}</p>${timePrefBlock('schedule.deliveryTimePref', 'schedule.deliveryTimeNote')}</div>` : ''}
        ${S.schedule.date || S.schedule.deliveryDate ? timeReassure : ''}`;
      return panel('date', pairHtml + tail);
    }
    return panel('date', pickupHtml + tail);
  },

  ShipWhen() {
    const sh = S.shipping;
    const lvl = ([v, l, h]) => `<button type="button" class="choice ${sh.serviceLevel === v ? 'on' : ''}" data-level="${v}"><span class="txt"><b>${l}</b><span class="d">${h}</span></span></button>`;
    const today = new Date().toISOString().slice(0, 10);
    const oos = outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : '';
    const out = [];
    if (outOfState()) {
      S.items.forEach((it, i) => {
        const nm = esc(pieceTitle0(it, i));
        out.push(panel(`ship-p${i}b`, `<h1>Shipping details</h1>${oos}<p class="piece-tag">${nm}</p><div class="card">${dimsBlock(i)}${FRAMING_TYPES.includes(it.type || 'painting') ? framingBlock(it, i) : ''}</div>`));
        out.push(panel(`ship-p${i}c`, `<h1>Weight, value and care</h1><p class="piece-tag">${nm}</p><div class="card">${pieceCare(it, i, true)}</div>`));
      });
    }
    out.push(panel('ship-level', `<h1>${out.length ? 'Service at the destination' : 'Shipping details'}</h1>${out.length ? '' : `<p class="sub">Everything our shipping team needs to price your shipment.</p>${oos}`}
      ${outOfState() ? `<h2>Destination type</h2><div class="card">${seg('dropoff.locationType', [['residential', 'Residential'], ['commercial', 'Commercial']])}</div>` : ''}
      <h2>Service at the destination</h2><div class="choices" data-reqblock="serviceLevel">${LEVELS.map(lvl).join('')}</div>`));
    out.push(panel('ship-timing', `<h1>When should it ship?</h1><div class="card">
        <div class="row keep">${input('shipping.shipBy', 'Ship by', { type: 'date', attrs: `min="${today}"` })}${input('shipping.arriveBy', 'Arrive by (optional)', { type: 'date', attrs: `min="${today}"` })}</div>
        ${toggle('shipping.flexible', 'My dates are flexible', 'Flexible dates usually mean a better shipping rate.', true)}
      </div>`));
    return out.join('');
  },

  Pay() {
    if (existing) return views.PayLink();
    if (isShip()) return views.ShipPay();
    const q = quoteData;
    // Full address with state and ZIP, so the customer can confirm the ZIP that sets their route (QA re-check N5).
    const addr = (a) => (a.street ? [a.street, a.city, [a.state, a.zip].map((x) => String(x || '').trim()).filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).map(esc).join(', ') : '—');
    const sp = special();
    const date = avail && [...avail.days, ...avail.rush].find((d) => d.date === S.schedule.date);
    const siteRows = (label, a, goto, ckey) => (a && a.street ? `<div class="sum-row"><span>${label}</span><span>${addr(a)}<br><span class="muted">${esc(contactLabel(ckey))}: ${esc(a.contactName)} · ${esc(formatPhone(a.contactPhone))}${a.sameAsMe ? (S.contact.clientType ? ` · ${esc(S.contact.clientType)}` : '') : a.contactRole ? ` · ${esc(a.contactRole === 'Other' ? (a.contactRoleOther || 'Other') : a.contactRole)}` : ''}</span> ${editBtn(goto)}</span></div>` : '');
    const payerCard = payerCardHtml();
    const payerName = payerNameLabel();
    return (payerShown() ? panel('payer', `<h1>Who’s paying?</h1>${payerCard}`) : '')
      + panel('review', `<h1>${sp ? 'Review your order' : 'Review & pay'}</h1><p class="sub">${sp ? 'Check the details, then send it to our team for pricing.' : 'Your job is booked as soon as payment goes through.'}</p>${valueConfirmCard('review')}
      ${promiseCard(tripLine() || (date && date.routeLabel) || (avail && avail.region ? avail.region + ' route' : 'Route day'), 'margin-top:0', '2:date')}
      <div class="card">
        <div class="sum-row"><span>Service</span><span>${esc(svc().label)}${S.rush ? ' · rush' : ''}${esc(dedLabel())} ${editBtn('0:service')}</span></div>
        ${reviewPieces()}
        ${svc().needsPickup ? siteRows('Pickup', S.pickup, '1:pickup-addr', 'pickup') : ''}
        ${siteRows(S.service === 'install_only' ? 'Install at' : 'Delivery', S.dropoff, '1:dropoff-addr', 'dropoff')}
        <div class="sum-row"><span>Booked by</span><span>${esc(S.contact.name)}<br><span class="muted">${esc(S.contact.email)}</span> ${editBtn('1:you')}</span></div>
        <div class="sum-row"><span>Paying</span><span>${esc(payerName)} ${editBtn('3:payer')}</span></div>
      </div>
      ${svc().needsPickup ? siteReview('Pickup details', S.pickup, '1:pickup-access') : ''}
      ${siteReview(S.service === 'install_only' ? 'Installation details' : 'Delivery details', S.dropoff, '1:dropoff-access')}
      <h2>Price</h2>
      ${priceCard(q, true)}
      ${q && q.notes && q.notes.filter((n) => n !== CADAccess.PRICE_NOTE && n !== CADAccess.WEIGHT_NOTE).length ? `<p class="mini">${q.notes.filter((n) => n !== CADAccess.PRICE_NOTE && n !== CADAccess.WEIGHT_NOTE).map((n) => esc(n)).join(' ')}</p>` : ''}
      ${discountBlock()}
      ${sp ? '<div class="err" id="err"></div>' : `<h2>Payment</h2>${paymentBlock(q)}`}
      <p class="mini">${sp ? esc(q && q.quoteNote || 'We’ll email your price with a payment link within 1 business day. Nothing is charged until you authorize payment.') : 'Need to change or cancel? Reply to your confirmation email.'}</p>`);
  },

  ShipPay() {
    const sh = S.shipping, d = S.dropoff;
    const declared = S.items.reduce((s, it) => s + num(it.value), 0);
    const payerName = payerNameLabel();
    const payerCard = payerCardHtml();
    return (payerShown() ? panel('payer', `<h1>Who’s paying?</h1>${payerCard}`) : '')
      + panel('review', `<h1>Review your shipping request</h1><p class="sub">Our shipping team prices your shipment and emails you a quote. Nothing is charged until you authorize payment.</p>${valueConfirmCard('review')}
      ${outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : ''}
      <div class="promise quote" style="margin-top:0"><span class="pi">✈</span><span><b>${esc(timingText(sh))}</b><span>${esc(levelText(sh.serviceLevel))}</span></span>${editBtn('2:ship-timing')}</div>
      <div class="card">
        <div class="sum-row"><span>Service</span><span>Shipping ${editBtn('0:service')}</span></div>
        ${reviewPieces()}
        <div class="sum-row"><span>Pickup</span><span>${destText(S.pickup)}<br><span class="muted">${esc(contactLabel('pickup'))}: ${esc([S.pickup.contactName, formatPhone(S.pickup.contactPhone)].filter(Boolean).join(' · '))}</span> ${editBtn('1:pickup-addr')}</span></div>
        <div class="sum-row"><span>Destination</span><span>${destText(d)}${d.locationType ? ` · ${esc(d.locationType)}` : ''}<br><span class="muted">${esc(contactLabel('dropoff'))}: ${esc([d.contactName, formatPhone(d.contactPhone)].filter(Boolean).join(' · '))}</span> ${editBtn('1:dropoff-addr')}</span></div>
        ${intlDest(d) && (sh.customs.name || sh.customs.phone) ? `<div class="sum-row"><span>Customs contact</span><span>${esc([sh.customs.name, sh.customs.phone, sh.customs.email].filter(Boolean).join(' · '))}</span></div>` : ''}
        <div class="sum-row"><span>At destination</span><span>${esc(levelText(sh.serviceLevel))} ${editBtn('2:ship-level')}</span></div>
        <div class="sum-row"><span>Booked by</span><span>${esc(S.contact.name)}<br><span class="muted">${esc(S.contact.email)}</span> ${editBtn('1:you')}</span></div>
        <div class="sum-row"><span>Paying</span><span>${esc(payerName)} ${editBtn('3:payer')}</span></div>
      </div>
      ${siteReview('Pickup details', S.pickup, '1:pickup-access')}
      ${siteReview('Destination details', S.dropoff, '1:dropoff-access')}
      <h2>Price</h2><div class="card">
        <div class="sum-row"><span>Shipping</span><span>Custom quote</span></div>
        <div class="sum-row"><span>Declared value</span><span class="amt">${fmt(declared)}</span></div>
        <p class="mini" style="margin:6px 0 0">Our shipping team sets the price for packing, shipping and destination service before anything is charged. Our shipping partner chooses the right packing for each piece.</p>
      </div>
      <div class="err" id="err"></div>`);
  },

  PayLink() {
    const o = existing, q = o.quote;
    return panel('review', `<h1>Pay to confirm</h1><p class="sub">${payCanceled ? 'Payment wasn’t completed. Your booking is saved; pay below to confirm it.' : o.approvedAt ? 'Your quote is approved. Your job is booked as soon as payment goes through.' : 'Pay below to confirm your booking.'}</p>
      <div class="promise" style="margin-top:0"><span class="pi">✓</span><span><b>${o.service === 'crating_shipping' ? esc(timingText(o.shipping || {})) : `${esc(longDate(o.schedule.date))}${o.schedule.deliveryDate ? ' · Delivery ' + esc(shortDate(o.schedule.deliveryDate)) : ''}`}</b><span>Order ${esc(o.id)}</span></span></div>
      <div class="card"><div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}${o.rush ? ' · rush' : ''}${esc(dedLabel(o))}</span></div>
        ${(o.items || []).map((i, n) => `<div class="sum-row"><span><b>${esc(pieceTitle0(i, n))}</b><br><span class="muted">${esc(TYPE_LABEL(i.type))}</span></span><span></span></div>`).join('')}</div>
      ${priceCard(q, false)}
      <h2>Payment</h2>${paymentBlock(q)}`);
  },

  Done() {
    const o = confirmed;
    if (o.status === 'pending_approval' && o.service === 'crating_shipping') {
      return `<div class="done"><div class="check">✓</div><h1>Shipping quote request received</h1>
        <p class="sub">Request <b>${esc(o.id)}</b> is with our shipping team. We’ll email ${esc(o.contact.email)} your shipping quote with a payment link. Nothing has been charged.</p></div>
        ${o.outOfState ? `<p class="note">${OOS_NOTE}</p>` : ''}
        <div class="card">
          <div class="sum-row"><span>Service</span><span>Shipping</span></div>
          <div class="sum-row"><span>Destination</span><span>${destText(o.dropoff)}</span></div>
          <div class="sum-row"><span>Timing</span><span>${esc(timingText(o.shipping || {}))}</span></div>
          <div class="sum-row"><span>At destination</span><span>${esc(levelText((o.shipping || {}).serviceLevel))}</span></div>
          <div class="sum-row"><span>Price</span><span>Custom quote from our shipping team</span></div>
        </div>
        ${yourPieces(o)}
        <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
    }
    if (o.status === 'pending_approval') {
      const q = o.quote || quoteData;
      return `<div class="done"><div class="check">✓</div><h1>Order received</h1>
        <p class="sub">Order <b>${esc(o.id)}</b>. We’ll email ${esc(o.contact.email)} ${esc((o.quote && o.quote.quoteNote) || 'your price with a payment link within 1 business day. Nothing is charged until you authorize payment.')}</p></div>
        <div class="card">
          <div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}${o.rush ? ' · rush' : ''}${esc(dedLabel(o))}</span></div>
          <div class="sum-row"><span>Date</span><span>${esc(longDate(o.schedule.date))}${o.schedule.deliveryDate ? '<br>Delivery ' + esc(longDate(o.schedule.deliveryDate)) : ''}${timePrefSummary(o.schedule.timePref, o.schedule.timeNote) ? '<br><span class="muted">' + esc(timePrefSummary(o.schedule.timePref, o.schedule.timeNote)) + '</span>' : ''}</span></div>
          ${q && q.tripPremium && q.quoteRange ? `<div class="sum-row"><span>Price range</span><span class="amt"><b>${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}</b></span></div>` : '<div class="sum-row"><span>Price</span><span>Set by our team</span></div>'}
        </div>
        ${yourPieces(o)}
        <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
    }
    const p = o.payment || {};
    const ach = p.status === 'ach_processing';
    const zel = p.method === 'zelle' && p.status === 'zelle_requested';
    const how = p.method === 'zelle' ? 'Zelle' : p.method && p.method.includes('apple') ? 'Apple Pay' : p.method && p.method.includes('google') ? 'Google Pay' : p.method && p.method.includes('ach') ? 'Bank (ACH)' : 'Card';
    const shipDone = o.service === 'crating_shipping';
    const delLine = o.schedule.deliveryDate ? `<p class="sub" style="margin:-4px 0 4px"><strong>Pickup: ${esc(longDate(o.schedule.date))}</strong>${timePrefSummary(o.schedule.timePref, o.schedule.timeNote) ? ' · ' + esc(timePrefSummary(o.schedule.timePref, o.schedule.timeNote)) : ''}</p><p class="sub" style="margin:0 0 10px"><strong>Delivery: ${esc(longDate(o.schedule.deliveryDate))}</strong>${timePrefSummary(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote) ? ' · ' + esc(timePrefSummary(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote)) : ''}</p>` : '';
    return `<div class="done"><div class="check">✓</div><h1>${shipDone ? 'Your shipment is confirmed.' : o.schedule.deliveryDate ? 'You’re booked.' : `You’re booked for ${esc(longDate(o.schedule.date))}.`}</h1>${delLine}
      <p class="sub">Order <b>${esc(o.id)}</b> is confirmed. A confirmation was sent to ${esc(o.contact.email)}. ${shipDone ? 'Our shipping team will confirm packing and pickup dates by email.' : 'We’ll be in touch before your date with your arrival window.'}</p></div>
      <div class="card"><div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}</span></div>
      ${shipDone ? `<div class="sum-row"><span>Timing</span><span>${esc(timingText(o.shipping || {}))}</span></div><div class="sum-row"><span>Destination</span><span>${destText(o.dropoff)}</span></div>` : `<div class="sum-row"><span>${o.pickup && o.pickup.city && o.dropoff && o.dropoff.city && o.schedule.deliveryDate ? 'Trip' : 'Route'}</span><span>${esc(o.pickup && o.pickup.city && o.dropoff && o.dropoff.city && o.schedule.deliveryDate ? `${String(o.pickup.city).trim()} → ${String(o.dropoff.city).trim()}` : (crossRegionLine((o.quote || {}).regions, o.pickup, o.dropoff) || (regionName(((o.quote || {}).regions || {}).pickup || o.schedule.region) + ' route')))}</span></div>`}
      <div class="sum-row"><span>Payment</span><span>${zel ? `<b>Zelle payment due within 24 hours</b> · ${fmt(p.amount)}` : ach ? `<b>ACH processing</b> · ${fmt(p.amount)}` : `Paid ${fmt(p.amount)}`} · ${how}${p.method && p.method.startsWith('mock') ? ' (test)' : ''}${p.saved ? ' · saved' : ''}</span></div>
      ${o.quote.paymentPlan === 'deposit' ? `<div class="sum-row"><span>Balance due ${esc(o.quote.balanceWhen)}</span><span class="amt"><b>${fmt(o.quote.balanceDue)}</b></span></div>` : ''}
      <div class="total"><span>${accessTbc(o.quote) ? CADAccess.TBC_TOTAL : 'Order total'}</span><span class="amt">${fmt(o.quote.total)}</span></div>
      ${accessTbc(o.quote) ? `<p class="mini access-tbc" data-access-tbc><b>${esc(CADAccess.PRICE_NOTE)}</b></p>` : ''}${weightNoteHtml(o.items)}${feeNoteHtml(o.quote)}</div>
      ${ach ? '<p class="mini">Your job is confirmed. The bank transfer shows as processing until it clears.</p>' : ''}
      ${zel ? `<div class="card">${zelleHtml(p.amount, o.id, p.dueBy)}</div>` : ''}
      ${yourPieces(o)}
      <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
  },
};

const siteReview = (title, a, goto) => {
  if (!a || !a.street) return '';
  const accessBits = CADAccess.summary(a);
  const showAccess = accessBits.length || accessQuestionsNeeded();
  const rows = [
    a.business && ['Business', esc(a.business)],
    a.hours && ['Access hours', esc(a.hours)],
    showAccess && ['Access', accessBits.length ? accessText(a) : 'Not answered yet'],
    a.parkingRestricted && ['Parking / loading', esc(a.parkingNote || 'Restrictions')],
    a === S.dropoff && hasHanging() && ['Hanging', `${esc(a.wallType || 'Wall type not sure')}${S.items.map((it, i) => isHung(it) ? '<br>' + esc(hangSummary(it, i)) + (it.hardware ? ' · ' + esc(hardwareText(it.hardware)) : '') : '').join('')}`],
    a.notes && ['Notes', esc(a.notes)],
  ].filter(Boolean);
  if (!rows.length) return '';
  const editTo = accessQuestionsNeeded() ? goto : (a === S.pickup ? '1:pickup-addr' : '1:dropoff-addr');
  return `<h2>${esc(title)}${editTo ? ' ' + editBtn(editTo) : ''}</h2><div class="card">${rows.map(([k, v]) => `<div class="sum-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
};

// ---------- validation + required-field guidance ----------
const filled = (a) => a && String(a.street || '').trim() && String(a.city || '').trim();
const hasContact = (a) => String(a.contactName || '').trim() && String(a.contactPhone || '').trim();
const siteReady = (a, required) => (required ? filled(a) && hasContact(a) : !filled(a) || hasContact(a));
const contactReady = () => S.contact.name.trim() && !V.emailProblem(S.contact.email) && String(S.contact.phone || '').replace(/\D/g, '').length >= 7;

const needsDims = (it) => (it.type || 'painting') !== 'custom' || shipService();
const dimsOk = (it) => !V.dimProblem(it);
// What one piece still needs (each piece on its own: nothing is borrowed from the others).
function itemGapList(it, i, name) {
    const out = [];
    const add = (sel, label, msg) => { if (sel && label) out.push({ sel, label, msg }); };
    const p = pieceName(i);
    if (!String(it.description || '').trim()) add(`#f-items.${i}.description`, `Description — ${p}`, 'Please add a short description of this piece.');
    if (shipService() || (name === 'When' && isShip())) {
      // Out-of-state pieces show weight as required and the server refuses an order without it, so ask for it here too (was only enforced for the Shipping service).
      if (!(weightOk(it) && (shipService() || it.weightUnsure || num(it.weight) > 0))) add(`[data-weight="${i}"]`, `Weight — ${p}`, 'Please enter the weight, or tap Not sure.');
      if (!(num(it.value) > 0)) add(`#f-items.${i}.value`, `Declared value — ${p}`, 'Please enter the value of this piece.');
    } else {
      if (it.type !== 'custom' && !(num(it.value) > 0)) add(`#f-items.${i}.value`, `Declared value — ${p}`, 'Please enter the value of this piece.');
      if (!weightOk(it)) add(`[data-weight="${i}"]`, `Weight — ${p}`, 'Please enter the weight, or tap Not sure.');
    }
    if (!shipService() && wallTooHeavy(it)) add(`[data-heavywall="${i}"]`, `Weight — ${p}`, `Pieces this heavy need a custom quote. Wall pieces over ${wallWeightCfg().maxLb} lb can’t be booked online.`);
    if (needsDims(it)) { const dp = V.dimProblem(it); if (dp) add(`#f-items.${i}.${dp.key}`, `Size — ${p}`, dp.message); }
    else { const op = V.optionalDimProblem && V.optionalDimProblem(it); if (op) add(`#f-items.${i}.${op.key}`, `Size — ${p}`, op.message); }

    if (FRAMING_TYPES.includes(it.type || 'painting')) {
      if (it.framed !== 'yes' && it.framed !== 'no') add(`[data-framing="${i}"]`, `Framed? — ${p}`, 'Please tell us if this piece is framed.');
      if (needsGlass(it) && !['yes', 'no'].includes(it.glazing)) add(`[data-glass="${i}"]`, `Glass — ${p}`, 'Please tell us if this piece has glass.');
      if (needsFrameType(it) && !FRAME_TYPE_OPTS.some(([v]) => v === it.frameType)) add(`[data-frametype="${i}"]`, `Frame type — ${p}`, 'Please choose a frame type.');
    }
    if (!photosOk(it)) add(`[data-photolbl="${i}"]`, `Photos — ${p}`, 'Please add a photo of this piece.');
    return out;
}
function missingFields(name = STEPS[step]) {
  const out = [];
  const add = (sel, label, msg) => { if (sel && label) out.push({ sel, label, msg }); };
  const itemGaps = (it, i) => itemGapList(it, i, name).forEach((g) => out.push(g));
  if (name === 'What') {
    if (!S.service) { add('.choices', 'Service type', 'Please choose a service.'); return out; }
    S.items.forEach(itemGaps);
    return out;
  }
  if (name === 'Where') {
    if (!String(S.contact.name || '').trim()) add('#f-contact.name', 'Full name', 'Please enter your full name.');
    { const em = V.emailProblem(S.contact.email); if (em) add('#f-contact.email', 'Email', em); }
    if (String(S.contact.phone || '').replace(/\D/g, '').length < 7) add('#f-contact.phone', 'Mobile', 'Please enter a mobile number.');
    if (!String(S.contact.clientType || '').trim()) add('#f-contact.clientType', 'I am a…', 'Please choose one.');
    if (!S.heard || !['yes', 'no'].includes(S.heard.repeatAnswer)) add('[data-seg="heard.repeatAnswer"]', 'I’ve ordered with CAD before?', 'Please tell us if you’ve ordered with CAD before.');
    else if (S.heard.repeatAnswer !== 'yes') {
      if (!S.heard.source) add('#f-heard.source', 'How did you hear about us?', 'Please tell us how you heard about CAD.');
      else if (S.heard.source === 'other' && !String(S.heard.sourceOther || '').trim()) add('#f-heard.sourceOther', 'Tell us where', 'Please tell us where you heard about us.');
      else if (S.heard.source === 'referral' && !S.heard.referrerKind) add('#f-heard.referrerKind', 'Who referred you?', 'Please tell us who referred you.');
    }
    const siteMiss = (key, title, required) => {
      const a = S[key] || {};
      if (!required && !filled(a)) return;
      if (key === 'dropoff' && shipService() && !String(a.country || '').trim()) add('#f-dropoff.country', 'Country', 'Please enter the country.');
      { const zm = zipMismatch[key]; if (zm && zm.zip === (String(a.zip || '').match(/^\d{5}/) || [])[0] && zm.city === String(a.city || '').trim()) add(`#f-${key}.zip`, `City and ZIP don’t match — ${title}`, zm.conflict ? (zm.message || `The city and ZIP don’t belong to the same delivery area. Please fix the city or the ZIP.`) : `ZIP ${zm.zip} is in ${zm.place}. Tap Use ${zm.place}, or fix the ZIP.`); }
      if (key === 'dropoff' && shipInsideCA()) add('#f-dropoff.state', 'Destination is in California', 'Shipping is for destinations outside California. Tap Switch to Pickup + Delivery.');
      // Street (with a number), a plausible city and a 5-digit ZIP (or ZIP+4): the same checks the server runs (public/validate.js).
      V.addressProblems(a, title).forEach((pr) => add(`#f-${key}.${pr.field}`, `${{ street: 'Street address', city: 'City', state: 'State', zip: 'ZIP' }[pr.field]} — ${title}`, pr.message));
      if (!String(a.contactName || '').trim()) add(`#f-${key}.contactName`, `${contactLabel(key)} name`, `Please enter the ${contactLabel(key).toLowerCase()}’s name.`);
      if (!String(a.contactPhone || '').trim()) add(`#f-${key}.contactPhone`, `${contactLabel(key)} mobile`, `Please enter the ${contactLabel(key).toLowerCase()}’s mobile number.`);
      if (a.sameAsMe) { /* role = the booker's own "I am a…" (required above); no role field */ }
      else if (!String(a.contactRole || '').trim()) add(`#f-${key}.contactRole`, roleLabel(key), `Please choose the ${contactLabel(key).toLowerCase()}’s role.`);
      else if (a.contactRole === 'Other' && !String(a.contactRoleOther || '').trim()) add(`#f-${key}.contactRoleOther`, 'Describe their role', `Please describe the ${contactLabel(key).toLowerCase()}’s role.`);
    };
    if (svc().needsPickup) siteMiss('pickup', 'Pickup', true);
    const dropTitle = shipService() ? 'Destination' : S.service === 'install_only' ? 'Installation' : 'Delivery';
    siteMiss('dropoff', dropTitle, true);
    if (svc().install && hasHanging() && !isShip()) {
      S.items.forEach((it, i) => {
        if (!isHung(it)) return;
        const p = pieceName(i);
        if (it.hangHeight === 'higher' && !it.hangWhere) add(`#f-items.${i}.hangWhere`, `Where? — ${p}`, 'Please tell us where this piece will hang.');
        else if (it.hangHeight === 'higher' && it.hangWhere === 'other' && !String(it.hangWhereOther || '').trim()) add(`#f-items.${i}.hangWhereOther`, `Where? — ${p}`, 'Please tell us where this piece will hang.');
        if (!HARDWARE_OPTS.includes(it.hardware)) add(`[data-hardware="${i}"]`, `Hanging hardware — ${p}`, 'Please tell us what hanging hardware is on the back of this piece.');
        if (!hangPhotosOk(it)) add(`[data-hangupload="${i}"]`, `Photos of the stairwell — ${p}`, 'Please add a photo of the stairwell.');
      });
    }
    ['pickup', 'dropoff'].forEach((key) => {
      const a = S[key] || {};
      if (key === 'pickup' && !svc().needsPickup) return;
      const where = key === 'pickup' ? 'Pickup' : shipService() ? 'Destination' : S.service === 'install_only' ? 'Installation' : 'Delivery';
      const ACCESS_GAP = {
        accessMode: [`[data-seg="${key}.pathPick"]`, 'How do we reach the spot?', 'Please tell us how we reach the spot, the whole way.'],
        stairFlights: [`#f-${key}.stairFlights`, 'How many flights?', 'Please choose how many flights of stairs.'],
        stairs: [`#f-${key}.stairs`, 'Total number of flights', 'Enter the total number of flights (4 or more).'],
        elevatorType: [`[data-seg="${key}.elevatorType"]`, 'Regular or service elevator?', 'Please choose regular or service elevator.'],
        elevatorFit: [`[data-seg="${key}.elevatorFit"]`, 'Will it fit in the elevator?', 'Please tell us if it will fit in the elevator.'],
        elevatorAck: [`[data-reqblock="${key}-elevatorAck"]`, 'Elevator acknowledgment', 'Please check the box to continue.'],
        sitePhotos: [`[data-siteupload="${key}"]`, 'Photos of the path', 'Please add a photo of the path.'],
        stairPhotos: [`[data-accessupload="${key}.stairPhotos"]`, 'Photos of the stairs and path', 'Please add a photo of the stairs and path.'],
        floor: [`#f-${key}.floor`, 'Floor', 'Please enter the floor.'],
        fits: [`[data-seg="${key}.fits"]`, 'Will everything fit easily?', 'Please tell us if everything will fit easily.'],
        doorPhotos: [`[data-accessupload="${key}.doorPhotos"]`, 'Photos of the tight spot', 'Please add a photo of the tight spot and the way in.'],
      };
      if (CADAccess.asksPathAccess(S.items) || CADAccess.asksDoorwayAccess(S.items)) {
        CADAccess.gaps(a, S.items).forEach((g) => { const [sel, label, msg] = ACCESS_GAP[g]; add(sel, `${label} — ${where}`, msg); });
      }
      if (!isShip() && CADAccess.asksDoorwayAccess(S.items) && !['yes', 'no'].includes(a.stdDoorway)) add(`[data-seg="${key}.stdDoorway"]`, `Standard doorway and hallway? — ${where}`, 'Please tap Yes or No.');
    });
    S.items.forEach((it, i) => {
      if (pieceNeedsStairwellFit(it) && !it.fitsStairwell) add(`[data-reqblock="stairwellFit-${i}"]`, `Stairwell fit — ${pieceName(i)}`, 'Please check the box to continue.');
    });
    return out;
  }
  if (name === 'When') {
    if (isShip()) {
      if (outOfState()) S.items.forEach(itemGaps);
      if (!S.shipping.serviceLevel) add('[data-reqblock="serviceLevel"]', 'Service at the destination', 'Please choose how the piece should be handled at the destination.');
      if (!S.shipping.shipBy && !S.shipping.flexible) add('#f-shipping.shipBy', 'Ship by', 'Please pick a ship-by date, or tap that your dates are flexible.');
      return out;
    }
    if (S.quoteOnly || (avail && (avail.requestQuote || avail.unverified || avail.calendarUnavailable))) {
      if (!S.quoteOnly) add('[data-reqblock="date"]', 'Request a quote', 'Turn on Request a quote so we can confirm the details by hand.');
    } else {
      const fs = firstSide();
      if (S.customDate && dedAny()) { if (!String(S.schedule.customDateNote || '').trim()) add('[data-reqblock="customdate"]', 'Dates that would work', 'Tell us which dates would work for you.'); return out; }
      if (!S.schedule.date) add('[data-reqblock="date"]', needsTwoDates() ? 'Pickup date' : 'Date', needsTwoDates() ? 'Please pick a pickup date.' : 'Please pick a date.');
      else if (dedOn(fs) && dedDateProblem(S.schedule.date, fs)) add('[data-reqblock="date"]', needsTwoDates() ? 'Pickup date' : 'Date', dedDateProblem(S.schedule.date, fs));
      if (needsTwoDates() && (S.schedule.date || dedOn('delivery'))) {
        if (!S.schedule.deliveryDate || (S.schedule.date && S.schedule.deliveryDate < S.schedule.date)) add('[data-reqblock="deldate"]', 'Delivery date', 'Please pick a delivery date.');
        else if (dedOn('delivery') && dedDateProblem(S.schedule.deliveryDate, 'delivery')) add('[data-reqblock="deldate"]', 'Delivery date', dedDateProblem(S.schedule.deliveryDate, 'delivery'));
      }
    }
    return out;
  }
  if (name === 'Pay') {
    if (existing) return out;
    { const nf = S.items.filter((it) => it.checkValue).length; if (nf) add('[data-checkvalues="review"]', 'Declared values', nf === 1 ? 'Please confirm the declared value of the copied piece above (or edit it).' : `Please confirm the declared values of the ${nf} copied pieces above (or edit them).`); }
    if (S.payer === 'other') {
      if (!String(S.payerOther.name || '').trim()) add('#f-payerOther.name', 'Payer name', 'Please enter the payer’s name.');
      if (!/\S+@\S+\.\S+/.test(S.payerOther.email || '')) add('#f-payerOther.email', 'Payer email', 'Please enter the payer’s email.');
      if (String(S.payerOther.phone || '').replace(/\D/g, '').length < 7) add('#f-payerOther.phone', 'Payer phone', 'Please enter the payer’s phone number.');
    }
    if (S.payer === 'partner' && !(isBizReferral() && (S.heard.businessName || S.heard.referrerName || S.partner.name))) add('[data-goto="1:about"]', 'Referring partner', 'Please add the referring partner in Where so we know who to bill.');
    return out;
  }
  return out;
}
const canContinue = () => missingFields().length === 0;
// Small steps: a screen only asks for its own fields. The last screen of a step also checks the whole step, so nothing is skipped.
const panelOfMissing = (m) => { const el = reqEl(m.sel); const p = el && el.closest ? el.closest('[data-panel]') : null; return p ? p.dataset.panel : null; };
function missingNow() {
  const all = missingFields();
  if (isLastPanel()) return all;
  return all.filter((m) => panelOfMissing(m) === sub);
}

function reqEl(sel) {
  if (!sel) return null;
  if (sel.startsWith('#') && /[.]/.test(sel)) return document.getElementById(sel.slice(1));
  try { return (app && app.querySelector(sel)) || document.querySelector(sel); } catch (e) { return null; }
}
function reqWrap(el) {
  if (!el) return null;
  return el.closest('.field') || el.closest('.photos') || el.closest('[data-reqblock]') || el.closest('.choices') || el.closest('.days') || el.closest('.chips') || el.closest('.upload') || el;
}
function setReqMsg(wrap, text) {
  if (!wrap) return;
  let m = wrap.querySelector(':scope > .req-msg');
  if (!text) { if (m) m.remove(); return; }
  if (!m) { m = document.createElement('p'); m.className = 'req-msg'; wrap.appendChild(m); }
  m.textContent = text;
}
let lastMissingSels = new Set();
const okUntil = new Map();
let okTimer;
// Required fields stay neutral until the person touches them (or tries to continue): no red before interaction (Dot, Nov 18).
const touchedSels = new Set(); let attemptedStep = false;
const touchFrom = (t) => {
  if (!t || !t.closest || !app.contains(t)) return;
  missingFields().forEach((m) => { const el = reqEl(m.sel); const w = reqWrap(el); if ((el && (el === t || el.contains(t))) || (w && w.contains(t))) touchedSels.add(m.sel); });
};
['focusout', 'change', 'click'].forEach((ev) => app.addEventListener(ev, (e) => { if (ev === 'click' && e.target.closest && !e.target.closest('.seg,.chip,.day,.choice,.choices,.upload,[data-v]')) return; touchFrom(e.target); if (STEPS[step] !== 'Done') setTimeout(paintRequired, 0); }));
function paintRequired() {
  const miss = missingFields();
  const missSels = new Set(miss.map((m) => m.sel));
  const now = Date.now();
  lastMissingSels.forEach((sel) => { if (!missSels.has(sel)) okUntil.set(sel, now + 1200); });
  missSels.forEach((sel) => okUntil.delete(sel));
  lastMissingSels = missSels;
  const wrapFor = (m) => reqWrap(reqEl(m.sel));
  document.querySelectorAll('.need, .need-ok').forEach((el) => {
    el.classList.remove('need', 'need-ok');
  });
  miss.forEach((m) => {
    if (!attemptedStep && !touchedSels.has(m.sel)) return;
    const w = wrapFor(m);
    if (!w) return;
    w.classList.add('need');
    w.classList.remove('need-ok');
    setReqMsg(w, m.msg || '');
  });
  okUntil.forEach((exp, sel) => {
    if (exp <= now) { okUntil.delete(sel); return; }
    const w = reqWrap(reqEl(sel));
    if (!w) return;
    w.classList.remove('need');
    w.classList.add('need-ok');
    setReqMsg(w, '');
  });
  clearTimeout(okTimer);
  if (okUntil.size) {
    const nextExp = Math.min(...okUntil.values());
    okTimer = setTimeout(paintRequired, Math.max(40, nextExp - Date.now()));
  }
  const line = $('#needLine');
  if (line) {
    const here = STEPS[step] === 'Done' ? [] : missingNow();
    if (!here.length || STEPS[step] === 'Done') { line.hidden = true; line.textContent = ''; }
    else {
      const names = here.map((m) => m.label);
      const n = names.length;
      const listed = names.slice(0, 3).join(', ') + (n > 3 ? '…' : '');
      line.hidden = false;
      line.textContent = n === 1 ? `1 field left: ${names[0]}` : `${n} fields left: ${listed}`;
    }
  }
  measureDock();
}
function revealFirstMissing() {
  attemptedStep = true; paintRequired();
  const miss = missingNow();
  if (!miss.length) return;
  // A gap on an earlier screen of this step (only checked on the last screen): take them back to it.
  const inHere = miss.find((m) => panelOfMissing(m) === sub);
  if (!inHere) { const pid = panelOfMissing(miss[0]); if (pid && pid !== sub) { sub = pid; keepAttempt = true; render(); return; } }
  const el = reqEl((inHere || miss[0]).sel);
  const wrap = reqWrap(el) || el;
  if (!wrap) return;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  wrap.classList.add('pulse-need');
  const focusable = (el && el.matches && el.matches('input,select,textarea,button')) ? el : (wrap.querySelector && wrap.querySelector('input,select,textarea,button'));
  setTimeout(() => { if (focusable && focusable.focus) focusable.focus({ preventScroll: true }); }, 280);
  setTimeout(() => wrap.classList.remove('pulse-need'), 900);
}
let keepAttempt = false;

// ---------- estimate (dock) ----------
let qTimer, qSeq = 0, quotePending = false;
function paintEstimate() {
  const el = $('#estTotal'), lbl = $('#estLabel');
  const q = existing ? existing.quote : quoteData;
  const name = STEPS[step];
  { const pn = $('#estNote'); if (pn) pn.hidden = true; }
  if (!S.service && !existing) { el.textContent = '—'; lbl.textContent = 'Total'; return; }
  if ((!existing && isShip()) || (q && q.shipping && !q.approvedPrice)) { el.textContent = 'Quote'; lbl.textContent = 'Shipping'; paintButton(); return; }
  if (!q) return;
  if (isQuote(q) && !q.tripPremium) { el.textContent = 'Quote'; lbl.textContent = 'Priced by CAD'; }
  else if (isQuote(q) && q.quoteRange) { el.textContent = `${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}`; lbl.textContent = 'Price range'; }
  else if (name === 'Pay') { el.textContent = fmt(q.dueNow); lbl.textContent = accessTbc(q) ? 'Due today (base)' : q.paymentPlan === 'deposit' ? 'Due today (50%)' : 'Total due'; }
  else { el.textContent = fmt(q.total); lbl.textContent = name === 'What' ? 'Total so far' : accessTbc(q) ? 'Total (base)' : 'Total'; }
  el.classList.toggle('long', el.textContent.length > 9 && el.textContent.length <= 13); el.classList.toggle('xlong', el.textContent.length > 13);
  // The bar's price includes the protection charge (unless declined): say so under it.
  const pn = $('#estNote'); if (pn) { const on = !!(q.protection && q.protection.amount > 0 && !isQuote(q)); pn.hidden = !on; pn.textContent = on ? PROTECTION_DOCK : ''; }
  // Refresh the value hints on the pieces step once the live quote is in.
  if (name === 'What') S.items.forEach((_, i) => updateItemHints(i));
  paintButton();
}
function refreshQuote() {
  if (existing) { paintEstimate(); return; }
  clearTimeout(qTimer);
  if (S.service) { quotePending = true; const lb = $('#estLabel'); if (lb && STEPS[step] !== 'Done') lb.textContent = 'Updating…'; updateNext(); }
  qTimer = setTimeout(async () => {
    if (!S.service) { quotePending = false; paintEstimate(); return; }
    const seq = ++qSeq;
    const { ok, j } = await api('/api/quote', payload());
    if (seq !== qSeq) return;
    quotePending = false;
    if (!ok) { paintEstimate(); updateNext(); return; }
    quoteData = j; paintEstimate(); updateNext();
    if (S.discountCode && j.discount && !j.discount.applied && j.discount.note === 'invalid') { S.discountCode = ''; persist(); discountMsg = { ok: false, text: 'That code is no longer valid.' }; paintDiscount(); }
    if (STEPS[step] === 'Pay' && !isShip()) { const pc = document.querySelector('[data-price]'); if (pc) pc.outerHTML = `<div data-price>${priceCard(quoteData, true)}</div>`; }
  }, 120);
}
// Description step only: the Next label names the following screen so people don't type size into the description.
// One piece per p{i}a panel today; if that panel ever listed several pieces, use the generic "sizes" / "values" wording.
function nextLabelsForStep() {
  if (returnToReview && STEPS[step] !== 'Pay' && !existing) return ['Back to review'];
  if (STEPS[step] !== 'What') return ['Next'];
  const m = /^p(\d+)a$/.exec(String(sub || ''));
  if (!m) return ['Next'];
  const i = Number(m[1]);
  const ids = panelIds();
  const nextId = ids[ids.indexOf(sub) + 1] || '';
  const one = true;
  if (nextId === `p${i}b`) {
    return one ? [`Next: size of piece ${i + 1}`, 'Next: size'] : ['Next: sizes', 'Next: size'];
  }
  if (nextId === `p${i}c`) {
    // Furniture (non-ship) and custom skip "How big is it?"; next is value and care.
    return one ? [`Next: value of piece ${i + 1}`, 'Next: value'] : ['Next: values', 'Next: value'];
  }
  return ['Next'];
}
function dockOverflowAmount() {
  const row = $('.dock-row');
  if (!row) return 0;
  let amt = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const rr = row.getBoundingClientRect();
  const est = row.querySelector('.estimate');
  const actions = row.querySelector('.dock-actions');
  if (est && actions) amt = Math.max(amt, est.getBoundingClientRect().right - (actions.getBoundingClientRect().left - 4));
  if (est) amt = Math.max(amt, est.scrollWidth - est.clientWidth);
  [...row.querySelectorAll('button, .est-total, .est-label')].forEach((el) => {
    const r = el.getBoundingClientRect();
    amt = Math.max(amt, r.right - rr.right, rr.left - r.left, el.scrollWidth - el.clientWidth);
  });
  return amt;
}
function applyNextLabel(btn) {
  const labels = nextLabelsForStep();
  const apply = (text, desc) => { btn.textContent = text; btn.classList.toggle('next-desc', !!desc && text !== 'Next'); };
  // Measure against the default "Next" so a footer that's already tight at 320px doesn't
  // force us off a same-width "Next: size" label.
  apply('Next', false);
  const base = dockOverflowAmount();
  let chosen = 'Next', desc = false;
  for (const text of labels) {
    if (text === 'Next') continue;
    apply(text, true);
    if (dockOverflowAmount() <= base + 0.5) { chosen = text; desc = true; break; }
  }
  apply(chosen, desc);
}
function paintButton() {
  const name = STEPS[step], btn = $('#nextBtn');
  const q = existing ? existing.quote : quoteData;
  if (name === 'Pay' && isLastPanel()) {
    // Access "Not sure": the customer pays the base price now (Dot round 4).
    const payWhat = q && accessTbc(q) ? (q.paymentPlan === 'deposit' ? '50% of base price ' : 'base price ') : '';
    btn.classList.remove('next-desc');
    if (existing || !special()) {
      // Longest label that fits the bar without pushing or covering anything (320–430px phones).
      const amt = q ? fmt(q.dueNow) : '';
      const opts = payMethod === 'zelle' ? ['Book and pay by Zelle', 'Book, pay by Zelle', 'Book'] : payWhat ? [`Pay ${payWhat}${amt} and book`, `Pay ${amt} and book`, `Pay ${amt}`] : [`Pay ${amt} and book`, `Pay ${amt}`];
      btn.textContent = opts[opts.length - 1];
      const base = dockOverflowAmount();
      btn.textContent = opts.find((t) => { btn.textContent = t; return dockOverflowAmount() <= base + 0.5; }) || opts[opts.length - 1];
    } else btn.textContent = isShip() ? 'Request quote' : S.rush ? 'Request a rush quote' : 'Submit order';
  } else applyNextLabel(btn);
  const wait = missingNow().length > 0;
  const hold = busy || (quotePending && name === 'Pay' && isLastPanel());
  btn.classList.toggle('is-busy', !!hold);
  if (hold) { btn.disabled = true; btn.classList.remove('is-wait'); btn.removeAttribute('aria-disabled'); }
  else { btn.disabled = false; btn.classList.toggle('is-wait', wait); if (wait) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled'); }
  paintRequired();
}

// ---------- render ----------
let lastStep = -1, lastSub = null, poppingStep = false;
const applyPanel = () => panelEls().forEach((p) => { p.hidden = p.dataset.panel !== sub; });
function render() {
  normShipState();
  if ((S.items || []).some(routeDecorMirror)) persist();
  const name = STEPS[step];
  // Done: forget the draft so a refresh or Continue can't book (or charge) the same job twice; a refresh shows this order again.
  if (name === 'Done' && confirmed) { draftStore.clear(); try { DRAFT_KEYS.forEach((k) => sessionStorage.removeItem(k)); } catch (_) { /* ignore */ } }
  else if (name !== 'Done') draftStore.setItem('cad-step', String(step));
  lastShipKey = shipKey(); lastPhotoKey = itemKey();
  // Y position and focus belong to the screen being left, so read them before the view is rebuilt.
  const y = window.scrollY;
  const html = views[name]();
  // Which screen (panel) of this step is showing: '' = first, '__last' = last, '__missing' = the first with a gap.
  const ids = [...html.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
  const wantMissing = sub === '__missing';
  if (ids.length) {
    if (sub === '__last') sub = ids[ids.length - 1];
    else if (!sub || sub === '__missing' || !ids.includes(sub)) sub = ids[0];
  } else sub = '';
  const stepChanged = step !== lastStep || sub !== lastSub || wantMissing;
  if (stepChanged) { touchedSels.clear(); attemptedStep = keepAttempt || wantMissing; keepAttempt = false; }
  const ae = document.activeElement;
  const focusId = !stepChanged && ae && app.contains(ae) ? ae.id : '';
  // Keep the caret / selection and textarea scroll, so typing after a re-render continues where it was (Dot, Nov 16).
  let sel = null;
  if (focusId) { try { sel = { s: ae.selectionStart, e: ae.selectionEnd, d: ae.selectionDirection, top: ae.scrollTop }; } catch (_) { sel = null; } }
  app.innerHTML = `<div class="view${stepChanged ? ' enter' : ''}">${html}</div>`;
  if (stepChanged) { const de = $('#dockErr'); if (de) { de.hidden = true; de.textContent = ''; } }
  if (wantMissing && ids.length) { const m = missingFields()[0]; const pid = m && panelOfMissing(m); if (pid) sub = pid; }
  applyPanel();
  if (stepChanged) {
    // Browser Back / Forward walks the booking screens instead of leaving the page (Nov 18 audit).
    try {
      if (lastStep === -1 || poppingStep || name === 'Done') history.replaceState({ cadStep: step, cadSub: sub }, '');
      else history.pushState({ cadStep: step, cadSub: sub }, '');
    } catch (_) { /* history unavailable: ignore */ }
  }
  lastStep = step; lastSub = sub;
  if (name !== 'Done') draftStore.setItem('cad-sub', sub);
  if (name === 'When' && windowsKey() !== twKey) setTimeout(loadWindows, 0);
  if (focusId) {
    const f = document.getElementById(focusId);
    if (f) {
      f.focus({ preventScroll: true });
      if (sel && sel.s != null) { try { f.setSelectionRange(Math.min(sel.s, f.value.length), Math.min(sel.e, f.value.length), sel.d || 'none'); f.scrollTop = sel.top; } catch (_) { sel = null; } }
      // Number and email inputs have no caret API: put the caret at the end (where typing was) instead of the start.
      if ((!sel || sel.s == null) && 'value' in f && f.tagName === 'INPUT' && !/^(checkbox|radio|file)$/.test(f.type)) { const v = f.value; f.value = ''; f.value = v; }
    }
  }
  if (name === 'Pay' && !existing && !isShip()) wrapPriceCard();
  if (name === 'Pay') returnToReview = false;
  paintProgress(name);
  $('#backBtn').classList.toggle('hide', (step === 0 && isFirstPanel()) || name === 'Done' || !!existing);
  const noDock = name === 'Done';
  $('#dock').classList.toggle('hide', noDock);
  app.classList.toggle('no-dock', noDock);
  paintButton();
  refreshQuote();
  if (name === 'Where') { checkZipCity('pickup'); checkZipCity('dropoff'); }
  if (stepChanged) window.scrollTo(0, 0);
  else if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  measureDock();
}
// Changing an access answer hides some typed fields (Floor, Total number of flights, Narrowest opening) and the shared
// access rules clear them. Remember what was typed so switching back brings it back instead of losing it.
const keptAccess = { pickup: {}, dropoff: {} };
function setAccessAnswer(key, path, v) {
  const a = S[key], kept = keptAccess[key];
  if (String(a.floor || '').trim()) kept.floor = a.floor;
  if (String(a.narrowestIn ?? '').trim()) kept.narrowestIn = a.narrowestIn;
  if (String(a.stairFlights) === '4plus' && String(a.stairs ?? '').trim() && Number(a.stairs) !== 0) kept.stairs = a.stairs;
  set(path, v);
  CADAccess.normalize(a);
  if (a.accessMode === 'elevator' && !String(a.floor || '').trim() && kept.floor) a.floor = kept.floor;
  if (CADAccess.fitUnsure(a) && !String(a.narrowestIn ?? '').trim() && kept.narrowestIn) a.narrowestIn = kept.narrowestIn;
  if (String(a.stairFlights) === '4plus' && CADAccess.usesStairs(a) && !(Number(a.stairs) >= 4) && kept.stairs != null) a.stairs = kept.stairs;
  CADAccess.normalize(a);
  persist();
}
// Background work (photo uploads, delivery dates) must not rebuild the form under a field the customer is typing in:
// that closes the phone keyboard and can drop keystrokes. Wait until they leave the field.
const typingIn = () => { const a = document.activeElement; return !!(a && app.contains(a) && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')); };
let renderPending = false;
function renderWhenIdle() {
  if (!typingIn()) { render(); return; }
  if (renderPending) return;
  renderPending = true;
  app.addEventListener('focusout', function later() {
    setTimeout(() => {
      if (typingIn()) return; // moved straight into another text field: keep waiting
      app.removeEventListener('focusout', later); renderPending = false; render();
    }, 0);
  });
}
function wrapPriceCard() {
  // Give the price card a stable hook so the live quote can repaint just that card (no full re-render, no scroll jump).
  const h2s = [...app.querySelectorAll('h2')].filter((h) => /^Price$/.test(h.textContent));
  if (!h2s.length) return;
  const card = h2s[0].nextElementSibling;
  if (card && card.classList.contains('card')) { const w = document.createElement('div'); w.setAttribute('data-price', ''); card.replaceWith(w); w.appendChild(card); }
}
const updateNext = () => { paintButton(); };

// Measure the dock so page padding and scroll-padding exactly clear it on every device (incl. home-indicator inset).
function measureDock() {
  const d = $('#dock');
  const h = d.classList.contains('hide') ? 0 : Math.ceil(d.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--dock-h', h + 'px');
}
if (window.ResizeObserver) new ResizeObserver(measureDock).observe($('#dock'));
window.addEventListener('resize', () => { measureDock(); if (STEPS[step] !== 'Done') paintButton(); });

// Keep the focused field above the fixed estimate bar (and above the on-screen keyboard on phones).
function keepAboveDock(el) {
  if (!el || !el.getBoundingClientRect || el === document.body) return;
  const d = $('#dock');
  if (!d || d.classList.contains('hide')) return;
  const vv = window.visualViewport;
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const limit = Math.min(d.getBoundingClientRect().top, viewBottom) - 12;
  const box = el.type === 'checkbox' || el.type === 'radio' ? (el.closest('label') || el) : (el.closest('.field') || el);
  const r = box.getBoundingClientRect();
  const top = (vv ? vv.offsetTop : 0) + 12;
  if (r.bottom > limit) window.scrollBy({ top: Math.min(r.bottom - limit, Math.max(0, r.top - top)), behavior: 'auto' });
  else if (r.top < top) window.scrollBy({ top: r.top - top, behavior: 'auto' });
}
document.addEventListener('focusin', (e) => { if (!e.target.matches || !e.target.matches('input:not([type=file]), select, textarea') || e.target.closest('#dock')) return; keepAboveDock(e.target); requestAnimationFrame(() => keepAboveDock(document.activeElement)); });
// The phone keyboard shrinks the visual viewport: keep the field being typed in above the keyboard and the dock.
function onViewportResize() {
  const vv = window.visualViewport;
  // Room for the keyboard, so a field near the end of the page can still scroll above it.
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  document.documentElement.style.setProperty('--kb-h', kb + 'px');
  measureDock(); keepAboveDock(document.activeElement);
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', onViewportResize); window.visualViewport.addEventListener('scroll', onViewportResize); }

// ---------- events ----------
const syncSameAsMe = () => {
  ['pickup', 'dropoff'].forEach((k) => {
    const a = S[k];
    if (!a.sameAsMe) return;
    a.contactName = S.contact.name; a.contactPhone = S.contact.phone;
    const n = document.getElementById(`f-${k}.contactName`), ph = document.getElementById(`f-${k}.contactPhone`);
    if (n) n.value = a.contactName; if (ph) ph.value = formatPhone(a.contactPhone);
  });
};
app.addEventListener('input', (e) => {
  if (e.target.id === 'discountInput') { discountInput = e.target.value; return; }
  if (e.target.id === 'saveMethod') { saveMethod = e.target.checked; return; }
  if (e.target.dataset.dupn != null) {
    const n = parseInt(e.target.value, 10);
    dupCount = Number.isFinite(n) ? Math.min(Math.max(1, n), Math.max(1, dupMax())) : 1;
    const b = $('#dupGo'); if (b) b.textContent = dupLabel(dupCount);
    return;
  }
  const p = e.target.dataset.path; if (!p) return;
  if (e.target.dataset.comma || COMMA_PATH.test(p)) {
    const allowDec = DEC_PATH.test(p);
    e.target.value = e.target.value.replace(/[$\s\u00a0]/g, ''); // pasted “$12,000” or “12 000” still works
    const caret = e.target.selectionStart;
    const digitsBefore = e.target.value.slice(0, caret).replace(/[^\d.]/g, '').length;
    const formatted = formatGrouped(e.target.value, allowDec);
    if (formatted == null) { e.target.value = commaDisplay(p, get(p)); return; }
    set(p, uncomma(formatted));
    e.target.value = formatted;
    restoreDigitCaret(e.target, formatted, digitsBefore);
  } else if (e.target.dataset.phone || PHONE_PATH.test(p)) {
    const raw = e.target.value;
    if (raw.trim().startsWith('+')) {
      set(p, raw.trim());
    } else {
      const caret = e.target.selectionStart;
      const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
      const stored = unphone(raw);
      set(p, stored);
      const formatted = formatPhone(stored);
      e.target.value = formatted;
      restoreDigitCaret(e.target, formatted, digitsBefore);
    }
  } else {
    set(p, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  }
  if (p === 'customDate') { S.schedule.date = ''; S.schedule.deliveryDate = ''; S.rush = false; persist(); }
  if ((p === 'dedicatedPickup' || p === 'dedicatedDelivery') && !dedOn('pickup') && !dedOn('delivery')) { S.customDate = false; persist(); }
  if (p === 'dedicatedPickup' || p === 'dedicatedDelivery') {
    const side = p === 'dedicatedPickup' ? 'pickup' : 'delivery', dp = dedDatePath(side);
    set(dp, '');
    if (dp === 'schedule.date') { S.rush = false; S.schedule.timePref = 'none'; S.schedule.timeNote = ''; } else { S.schedule.deliveryTimePref = 'none'; S.schedule.deliveryTimeNote = ''; }
    S.dedicated = !!(dedOn('pickup') || dedOn('delivery')); persist();
    if (needsTwoDates()) loadDelivery();
  }
  if (p === 'dropoff.state') shipStateTyped = true;
  if (p === 'contact.name' || p === 'contact.phone') syncSameAsMe();
  const m = p.match(/^(pickup|dropoff)\.contact(Name|Phone)$/);
  if (m && S[m[1]].sameAsMe) { S[m[1]].sameAsMe = false; persist(); const b = app.querySelector(`[data-same="${m[1]}"]`); if (b) b.checked = false; const rw = app.querySelector(`[data-rolewrap="${m[1]}"]`); if (rw) rw.hidden = false; paintButton(); }
  const hint = p.match(/^items\.(\d+)\.(weight|value)$/);
  if (hint && hint[2] === 'value' && S.items[+hint[1]] && S.items[+hint[1]].checkValue) { S.items[+hint[1]].checkValue = false; persist(); { const pid = S.items[+hint[1]].id; app.querySelectorAll(`[data-checkvalnote="${pid}"], [data-piece-id="${pid}"] [data-checkvalue]`).forEach((el) => el.remove()); } }
  if (hint) updateItemHints(+hint[1]);
  const dimSet = p.match(/^items\.(\d+)\.(w|h|d)$/);
  if (dimSet) {
    const it = S.items[+dimSet[1]];
    if (it && (it.type === 'furniture' || it.type === 'decor') && V.sizeClassFromDims) {
      it.sizeClass = V.sizeClassFromDims(it, isAccentKind(it.furnitureKind) ? 'accent' : it.furnitureKind);
    }
  }
  // Editing a piece in Quick edit: keep the list above it (titles, facts, "Needs details") in step. The quick-edit fields themselves are not re-rendered, so typing keeps its focus.
  if (/^items\.\d+\./.test(p) && e.target.closest('[data-quick]')) { const L = app.querySelector('[data-pclist]'); if (L) L.innerHTML = S.items.map((it, i) => pieceListRow(it, i)).join(''); const sm = app.querySelector('[data-pcsummary]'); if (sm) sm.outerHTML = listSummary(); }
  updateNext(); refreshQuote();
  const dim = p.match(/^items\.(\d+)\.(w|h)$/);
  if (dim) syncFrameType(+dim[1]);
  if ('rerender' in e.target.dataset) render();
});
app.addEventListener('toggle', (e) => {
  const d = e.target; if (!d || !d.matches) return;
  if (d.matches('details[data-quick]')) quickOpen = d.open;
  else if (d.matches('details[data-qpiece]')) { if (d.open) openQuick.add(d.dataset.qpiece); else openQuick.delete(d.dataset.qpiece); }
}, true);
app.addEventListener('change', (e) => {
  if (e.target.dataset.path && e.target.tagName === 'SELECT') {
    set(e.target.dataset.path, e.target.value);
    const sf = (e.target.dataset.path || '').match(/^(pickup|dropoff)\.stairFlights$/);
    if (sf) { CADAccess.normalize(S[sf[1]]); persist(); }
    const mk = (e.target.dataset.path || '').match(/^items\.(\d+)\.furnitureKind$/);
    if (mk && routeDecorMirror(S.items[+mk[1]])) persist();
    refreshQuote();
    if ('rerender' in e.target.dataset || mk) render();
  }
  if (e.target.dataset.dupphotos != null) { dupPhotos = e.target.checked; return; }
  if (e.target.dataset.upload != null) uploadPhotos(+e.target.dataset.upload, e.target.files);
  if (e.target.dataset.wallupload) uploadWallPhotos(e.target.dataset.wallupload, e.target.files);
  if (e.target.dataset.hangupload != null) uploadHangPhotos(+e.target.dataset.hangupload, e.target.files);
  if (e.target.dataset.siteupload) uploadSitePhotos(e.target.dataset.siteupload, e.target.files);
  if (e.target.dataset.accessupload) uploadAccessPhotos(e.target.dataset.accessupload, e.target.files);
  // Country / state / ZIP can flip a job to Shipping (outside California) or to an international address.
  // Value / weight hints update in place (no re-render), so a tap on the next control is never lost.
  const im = (e.target.dataset.path || '').match(/^items\.(\d+)\.(weight|value)$/);
  if (im) updateItemHints(+im[1]);
  // Country changes the address form (international = free-form), so re-render. State / ZIP / city only toggle the
  // out-of-state note in place, so nothing the customer is typing gets interrupted.
  if (e.target.dataset.path === 'dropoff.country') { const k = shipKey(); if (k !== lastShipKey) { lastShipKey = k; render(); } }
  else if (/^(pickup|dropoff)\.(state|zip|city|street)$/.test(e.target.dataset.path || '')) { syncOosNote(); checkZipCity(e.target.dataset.path.split('.')[0]); }
  else if ((e.target.dataset.path || '') === 'contact.email') { suggestEmailTypo(e.target); }
  else if (/^(pickup|dropoff)\.street$/.test(e.target.dataset.path || '')) splitStreet(e.target.dataset.path.split('.')[0]);
});
// A full address pasted into Street ("1 Ferry Building, San Francisco, CA 94111") is split into Street / City / State / ZIP,
// so the review never shows the city twice (QA audit Nov 22, #6).
function splitStreet(key) {
  const a = S[key]; if (!a || intlDest(a)) return;
  const m = String(a.street || '').trim().match(/^(.+?),\s*([A-Za-z .'-]+?),?\s+(CA|Calif\.?|California)\.?\s*(\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:USA|US|United States))?$/i);
  if (!m) return;
  a.street = m[1].trim();
  if (!String(a.city || '').trim() || a.city.trim().toLowerCase() === m[2].trim().toLowerCase()) a.city = m[2].trim();
  a.state = 'CA';
  if (m[4] && !String(a.zip || '').trim()) a.zip = m[4];
  persist(); render(); checkZipCity(key);
}
// ZIP vs city cross-check: a hard block when the city and ZIP belong to different CAD route areas (never route on the ZIP alone).
// Zippopotam is used as a secondary typo hint; a CADZones conflict still blocks even if that lookup is down.
const zipCache = {}, cityCache = {};
// A confirmed city/ZIP mismatch blocks Next until the customer fixes the city or the ZIP.
const zipMismatch = { pickup: null, dropoff: null };
// Shipping destination: State starts blank (no "stays in California" note on an empty form). Typed "CA" is kept.
let shipStateTyped = false;
function normShipState() {
  const d = S.dropoff; if (!d) return;
  const untouched = !String(d.street || '').trim() && !String(d.city || '').trim() && !String(d.zip || '').trim();
  if (shipService() && d.state === 'CA' && untouched && !shipStateTyped) { d.state = ''; persist(); }
  else if (!shipService() && !String(d.state || '').trim() && !intlDest(d)) { d.state = 'CA'; persist(); }
}
const geoGet = async (url) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (_) { return null; } };
const milesApart = (a, b) => { const R = 3959, rad = (d) => (d * Math.PI) / 180; const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function suggestEmailTypo(el) {
  const tip = V.typoEmail && V.typoEmail((S.contact && S.contact.email) || '');
  let box = app.querySelector('[data-emailtypo]');
  if (!tip) { if (box) box.remove(); return; }
  const html = `<p class="mini" data-emailtypo style="margin:6px 0 0">Did you mean <button type="button" class="link" data-emailfix="${esc(tip)}">${esc(tip)}</button>? We won’t change it unless you tap that.</p>`;
  if (box) { box.outerHTML = html; return; }
  const field = (el && el.closest && el.closest('.field')) || (app.querySelector('#f-contact\\.email') && app.querySelector('#f-contact\\.email').closest('.field'));
  if (field) field.insertAdjacentHTML('beforeend', html);
}
async function checkZipCity(key) {
  const a = S[key]; if (!a || intlDest(a)) return;
  const zip = (String(a.zip || '').match(/^\d{5}/) || [])[0], city = String(a.city || '').trim();
  const show = (html, mm = null) => {
    const prev = zipMismatch[key]; zipMismatch[key] = mm;
    const el = app.querySelector(`[data-zipcheck="${key}"]`); if (el) { el.innerHTML = html; el.hidden = !html; }
    if (!!prev !== !!mm && STEPS[step] === 'Where') { updateNext(); paintRequired(); }
  };
  if (!zip || city.length < 2) return show('');
  if (window.CADZones) {
    const addr = { street: a.street, city, state: a.state || 'CA', zip };
    const conflict = CADZones.routeConflict(addr);
    if (conflict) return show(`<b>City and ZIP don’t match the same delivery area.</b> ${esc(conflict.message)}`, { zip, city, place: conflict.zipArea || conflict.zipZone, conflict: true, message: conflict.message });
    if (CADZones.cityFitsZip && CADZones.cityFitsZip(addr)) return show('');
  }
  if (!(zip in zipCache)) { const j = await geoGet(`https://api.zippopotam.us/us/${zip}`); zipCache[zip] = j && j.places ? j.places.map((pl) => ({ name: pl['place name'], st: String(pl['state abbreviation'] || '').toLowerCase(), at: [+pl.latitude, +pl.longitude] })) : []; }
  const zp = zipCache[zip];
  if (!zp.length || !/^[a-z]{2}$/.test(zp[0].st)) return show('');
  // Look the typed city up in the ZIP's own state, so a correct out-of-state address never gets a false hint.
  const ck = zp[0].st + '/' + city.toLowerCase();
  if (!(ck in cityCache)) { const j = await geoGet(`https://api.zippopotam.us/us/${zp[0].st}/${encodeURIComponent(city.toLowerCase())}`); cityCache[ck] = j && j.places ? j.places.map((pl) => [+pl.latitude, +pl.longitude]) : []; }
  const cur = S[key]; if ((String(cur.zip || '').match(/^\d{5}/) || [])[0] !== zip || String(cur.city || '').trim() !== city) return;
  const cp = cityCache[ck];
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z]/g, '');
  if (zp.some((pl) => norm(pl.name) === norm(city))) return show('');
  // Only flag a clear mismatch: the ZIP is more than 15 miles from every ZIP of the typed city (neighborhood names never trip it).
  if (cp.length && cp.some((c) => milesApart(c, zp[0].at) <= 15)) return show('');
  const nm = esc(zp[0].name);
  const fixes = `<span class="zip-actions"><button type="button" class="link" data-zipfix="${key}" data-city="${nm}">Use ${nm}</button><button type="button" class="link muted" data-zipedit="${key}">Fix the ZIP</button></span>`;
  // Unknown city name (often a typo like "Menlo Prk"): a one-tap suggestion, never a block. The ZIP sets the route either way.
  if (!cp.length) return show(`That ZIP is in ${nm}. Use ${nm}? ${fixes}`);
  show(`<b>City and ZIP don’t match.</b> ZIP ${esc(zip)} is in ${nm}, not ${esc(city)}. Use ${nm}? ${fixes}`, { zip, city, place: zp[0].name });
}
function syncOosNote() {
  if (STEPS[step] !== 'Where') return;
  // Shipping with both ends in California: show (or remove) the Switch to Pickup + Delivery note in place.
  const dp = app.querySelector('[data-panel="dropoff-addr"]');
  // Updated in place (no re-render), so the field being typed in keeps its focus and value.
  if (dp && shipService()) {
    const cur = dp.querySelector('[data-cashipnote]'), want = shipInsideCA();
    if (want && !cur) { const anchor = dp.querySelector('[data-oos]') || dp.querySelector('h1'); anchor.insertAdjacentHTML('afterend', caNoteHtml()); }
    else if (!want && cur) cur.remove();
    if (!!cur !== want) updateNext();
  }
  app.querySelectorAll('[data-panel$="-addr"]').forEach((pn) => {
    const cur = pn.querySelector('[data-oos]');
    if (outOfState() && !cur) pn.querySelector('h1').insertAdjacentHTML('afterend', `<p class="note" data-oos>${OOS_NOTE}</p>`);
    else if (!outOfState() && cur) cur.remove();
  });
}
let dupPhotos = false;
// Duplicate: N separate new pieces, each prefilled with this piece's details (value kept but flagged "check value"; photos are not copied unless asked).
function createCopies(srcId) {
  const idx = S.items.findIndex((x) => x.id === srcId);
  const n = Math.min(Math.max(1, dupCount), dupMax());
  if (idx < 0 || n < 1) { dupAsk = null; render(); return; }
  const src = S.items[idx];
  const copies = Array.from({ length: n }, () => {
    const c = JSON.parse(JSON.stringify(src));
    c.id = newPieceId(); c.checkValue = num(c.value) > 0;
    if (!dupPhotos) { c.photos = []; c.hangPhotos = []; }
    return c;
  });
  S.items.splice(idx + 1, 0, ...copies);
  dupAsk = null; dupCount = 1; dupPhotos = false; removeAskId = '';
  persist(); sub = 'pieces-more'; render();
  const first = app.querySelector(`[data-piece-id="${copies[0].id}"]`); if (first) first.scrollIntoView({ block: 'center' });
  uploadToast(`${n} piece${n === 1 ? '' : 's'} added. Check each copy’s size and value.`);
}
const itemKey = () => S.items.map((i) => itemPhotoReason(i) + (num(i.value) > 50000 ? 2 : num(i.value) > 0 ? 1 : 0)).join('|');
const shipKey = () => `${isShip()}|${intlDest(S.dropoff)}`;
let lastShipKey = '', lastPhotoKey = '';
app.addEventListener('click', async (e) => {
  const t = e.target.closest('button,input[data-same],input[data-samepu]'); if (!t) return;
  if (t.dataset.duplist) { UI.showList = true; saveUi(); dupAsk = t.dataset.duplist; dupCount = 1; removeAskId = ''; sub = 'pieces-more'; render(); const n = $('#dup-n'); if (n) { n.focus(); n.select(); } return; }
  if (t.dataset.showcontact) { const k = t.dataset.showcontact; if (!UI.showContact.includes(k)) UI.showContact.push(k); saveUi(); sub = `${k}-contact`; render(); return; }
  if (t.hasAttribute('data-discount-apply')) { applyDiscount(); return; }
  if (t.hasAttribute('data-discount-remove')) { S.discountCode = ''; discountMsg = null; persist(); refreshQuote(); paintDiscount(); return; }
  if (t.dataset.zipedit) { const z = document.getElementById(`f-${t.dataset.zipedit}.zip`); if (z) { z.focus(); z.select && z.select(); } return; }
  if (t.dataset.emailfix) { S.contact.email = t.dataset.emailfix; persist(); render(); return; }
  if (t.dataset.zipfix) { const k = t.dataset.zipfix; S[k].city = t.dataset.city; persist(); render(); return; }
  if (t.dataset.switchpd != null) {
    // CA-to-CA job started as Shipping: keep every answer, switch the service, and land on the delivery address to continue.
    S.service = 'pickup_delivery'; S.dropoff.country = ''; if (!String(S.dropoff.state || '').trim()) S.dropoff.state = 'CA'; persist(); avail = null; quoteData = null;
    step = STEPS.indexOf('Where'); sub = 'dropoff-addr'; render(); return;
  }
  if (t.dataset.service) {
    // No auto-scroll here: the page stays exactly where the user's thumb left it.
    if (t.dataset.service === 'install_only') {
      // Never turn a sofa or sculpture into a "Painting" behind the customer's back (audit P1-2): ask them to choose.
      const i = S.items.findIndex((it) => !INSTALL_TYPES.includes(it.type) || (it.type === 'decor' && !hungDecorList().includes(it.furnitureKind)));
      if (i >= 0) {
        const both = (CFG.services.delivery_install || {}).label || 'Pickup, Delivery + Install';
        uploadToast(`Install only covers wall pieces. Remove ${S.items[i].description ? `“${S.items[i].description}”` : pieceName(i)} or choose ${both}.`);
        return;
      }
    }
    S.service = t.dataset.service;
    normShipState();
    if (S.service === 'crating_shipping') { S.crating = false; S.rush = false; S.dedicated = false; S.dedicatedPickup = false; S.dedicatedDelivery = false; }
    if (S.service === 'install_only') { S.crating = false; S.schedule.deliveryLater = false; }
    if (!(svc().install)) S.items.forEach((it) => { delete it.hardware; });
    persist(); avail = null; render();
    return;
  }
  const itc = t.closest('[data-itemtype]');
  if (itc) {
    const it = S.items[+itc.dataset.itemtype]; const v = t.dataset.v;
    if (it.type !== v) { it.type = v; it.furnitureKind = v === 'decor' ? decorKinds()[0] : v === 'furniture' ? (CFG.pricing.furnitureKinds || [])[0] : it.furnitureKind; cleanFraming(it); }
    persist(); render(); return;
  }
  if (t.dataset.weightunsure != null) {
    const it = S.items[+t.dataset.weightunsure];
    it.weightUnsure = !it.weightUnsure;
    if (it.weightUnsure) it.weight = '';
    persist(); render(); return;
  }
  if (t.id === 'addItem') { returnToList = false; S.items.push(emptyItem()); persist(); sub = `p${S.items.length - 1}a`; render(); return; }
  // Remove asks first; the quote recalculates right away. Labels renumber, the internal id never changes.
  if (t.dataset.removeask != null) { if (S.items.length > 1) { removeAskId = t.dataset.removeask; dupAsk = null; sub = 'pieces-more'; render(); const row = app.querySelector(`[data-piece-id="${removeAskId}"]`); if (row) row.scrollIntoView({ block: 'center' }); } return; }
  if (t.dataset.removeno != null) { removeAskId = ''; render(); return; }
  if (t.dataset.removeyes != null) {
    const ix = S.items.findIndex((x) => x.id === t.dataset.removeyes);
    removeAskId = '';
    if (ix >= 0 && S.items.length > 1) { const gone = pieceTitle0(S.items[ix], ix); S.items.splice(ix, 1); persist(); sub = S.items.length > 1 ? 'pieces-more' : 'p0c'; render(); uploadToast(`${gone} removed. The price is updated.`); } else render();
    return;
  }
  if (t.dataset.dupopen != null) { dupAsk = t.dataset.dupopen; dupCount = 1; dupPhotos = false; removeAskId = ''; render(); const n = $('#dup-n'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); n.select(); } return; }
  if (t.dataset.dupcancel != null) { dupAsk = null; render(); return; }
  if (t.dataset.dupgo != null) { createCopies(t.dataset.dupgo); return; }
  if (t.dataset.pcopen != null) { const k = t.dataset.pcopen; if (openRows.has(k)) openRows.delete(k); else openRows.add(k); render(); return; }
  if (t.dataset.valall != null) { S.items.forEach((it) => { it.checkValue = false; }); persist(); render(); return; }
  if (t.dataset.valok != null) { const it = S.items.find((x) => x.id === t.dataset.valok); if (it) { it.checkValue = false; persist(); render(); } return; }
  if (t.dataset.fixpiece != null) { returnToList = true; step = 0; sub = t.dataset.fixpanel || `p${t.dataset.fixpiece}a`; keepAttempt = true; render(); return; }
  if (t.dataset.same) {
    const a = S[t.dataset.same];
    a.sameAsMe = !a.sameAsMe;
    if (a.sameAsMe) { applySameAsMe(t.dataset.same); if (t.dataset.same === 'dropoff') a.samePickup = false; }
    else { a.contactName = ''; a.contactPhone = ''; }
    persist(); render(); return;
  }
  if (t.dataset.samepu != null) {
    const a = S.dropoff;
    a.samePickup = !a.samePickup;
    if (a.samePickup) applySamePickup(); else { a.contactName = ''; a.contactPhone = ''; a.contactRole = ''; a.contactRoleOther = ''; }
    persist(); render(); return;
  }
  if (t.dataset.goto != null) {
    // "1:pickup-addr" = Where, Pickup address. From the review screen, the next Next brings them straight back to it.
    const [gs, gp] = String(t.dataset.goto).split(':');
    if (STEPS[step] === 'Pay' && !existing) returnToReview = true;
    { const cm = /^(pickup|dropoff)-contact$/.exec(gp || ''); if (cm && !UI.showContact.includes(cm[1])) UI.showContact.push(cm[1]); }
    if (gp === 'payer') UI.showPayer = true;
    saveUi();
    returnToList = +gs === 0 && STEPS[step] === 'What' && sub === 'pieces-more' && /^p\d+a$/.test(gp || '');
    step = +gs; sub = gp || ''; render(); return;
  }
  if (t.dataset.wallet) return pay(CFG.stripe ? 'stripe' : t.dataset.wallet);
  const sg = t.closest('[data-seg]'); const hp = sg && sg.dataset.seg.match(/^items\.(\d+)\.hangPick$/);
  if (hp) { const it = S.items[+hp[1]]; const v = t.dataset.v; if (v === 'standard') { it.hangHeight = 'standard'; it.hangWhere = ''; } else { it.hangHeight = 'higher'; it.hangWhere = v; } set(sg.dataset.seg, v); render(); return; }
  const pth = sg && sg.dataset.seg.match(/^(pickup|dropoff)\.pathPick$/);
  if (pth) { setPathPick(pth[1], t.dataset.v); render(); return; }
  const sdw = sg && sg.dataset.seg.match(/^(pickup|dropoff)\.stdDoorway$/);
  if (sdw) { S[sdw[1]].stdDoorway = t.dataset.v; syncDoorway(sdw[1]); persist(); render(); return; }
  if (sg && /^(pickup|dropoff)\.fits$/.test(sg.dataset.seg)) S[sg.dataset.seg.split('.')[0]].fitsAuto = false;
  const acc = sg && sg.dataset.seg.match(/^(pickup|dropoff)\.(accessMode|stairFlights|stairDir|stairTurns|serviceElevator|elevatorType|elevatorFit|pathType|elevatorStairs|doorway|fits)$/);
  if (acc) { setAccessAnswer(acc[1], sg.dataset.seg, t.dataset.v); render(); return; }
  if (sg) { const v = t.dataset.v; set(sg.dataset.seg, isNaN(v) ? v : Number(v)); render(); return; }
  const paySeg = t.closest('[data-pay-method]'); if (paySeg) { payMethod = t.dataset.v; payPicked = true; render(); return; }
  const chips = t.closest('[data-chips]');
  if (chips && 'multi' in chips.dataset) {
    if (t.dataset.off) return; // grayed: doesn't fit the route that day (the reason is written under the chips)
    const v = t.dataset.v; let on = CADAccess.timePrefList(get(chips.dataset.chips));
    if (v === 'none') on = []; else on = on.includes(v) ? on.filter((x) => x !== v) : [...on, v];
    set(chips.dataset.chips, on.length ? CADAccess.TIME_PREFS.map(([k]) => k).filter((k) => on.includes(k)).join(',') : 'none'); render(); return;
  }
  if (chips) { set(chips.dataset.chips, t.dataset.v); render(); return; }
  if (t.dataset.moredays) { moreDays[t.dataset.moredays] = true; render(); return; }
  if (t.dataset.clear) {
    if (t.dataset.clear === 'pu') { S.schedule.date = ''; S.rush = false; S.schedule.timePref = 'none'; S.schedule.timeNote = ''; }
    else { S.schedule.deliveryDate = ''; S.schedule.deliveryTimePref = 'none'; S.schedule.deliveryTimeNote = ''; }
    persist(); render(); return;
  }
  if (t.dataset.off) { uploadToast(t.dataset.date ? 'That pickup day is too late for the delivery day you picked. Clear the delivery day to see every pickup day.' : 'That delivery day doesn’t work with the pickup day you picked. Clear the pickup day to see every delivery day.'); return; }
  if (t.dataset.date) {
    S.schedule.date = t.dataset.date; S.rush = !!t.dataset.rush;
    if (needsTwoDates() && S.schedule.deliveryDate && !dedOn('delivery') && !pairOk(S.schedule.date, S.schedule.deliveryDate)) S.schedule.deliveryDate = '';
    persist(); render();
    if (needsTwoDates() && !pairs) loadDelivery();
    return;
  }
  if (t.dataset.changePickup != null) {
    sub = 'date'; render();
    return;
  }
  if (t.dataset.level) { S.shipping.serviceLevel = t.dataset.level; persist(); render(); return; }
  if (t.dataset.deldate) { S.schedule.deliveryDate = t.dataset.deldate; if (S.schedule.date && !dedOn('pickup') && !pairOk(S.schedule.date, S.schedule.deliveryDate)) { S.schedule.date = ''; S.rush = false; } persist(); render(); return; }
  if (t.id === 'newOrder') { sessionStorage.clear(); draftStore.clear(); location.href = '/'; }
});

app.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d || !d.dataset) return;
  if (d.dataset.extras) { if (d.open) openExtras.add(d.dataset.extras); else openExtras.delete(d.dataset.extras); }
  if (d.dataset.handling != null) {
    const it = S.items[+d.dataset.handling];
    if (!it) return;
    if (d.open) openHandling.add(it.id);
    else if (it.fragile) d.open = true;
    else openHandling.delete(it.id);
  }
}, true);
// Photo uploads: never fail silently (a dropped HEIC or a network error used to just do nothing).
const uploadToast = (msg) => {
  let t = document.getElementById('uploadToast');
  if (!t) { t = document.createElement('div'); t.id = 'uploadToast'; t.className = 'upload-toast'; t.setAttribute('role', 'alert'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 6000);
};
async function uploadFiles(fd) {
  let r = null;
  try { const res = await fetch('/api/upload', { method: 'POST', body: fd }); r = res.ok ? await res.json() : null; } catch (e) { r = null; }
  if (!r || !(r.files || []).length) { uploadToast('That photo didn’t upload. Please try again with a JPG or PNG.'); return null; }
  return r;
}
async function uploadHangPhotos(i, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  r = await uploadFiles(fd); if (!r) return;
  if (!S.items[i]) return;
  S.items[i].hangPhotos = [...(S.items[i].hangPhotos || []), ...(r.files || [])]; persist(); renderWhenIdle();
}
async function uploadWallPhotos(key, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  r = await uploadFiles(fd); if (!r) return;
  S[key].wallPhotos = [...(S[key].wallPhotos || []), ...r.files]; persist(); renderWhenIdle();
}
async function uploadSitePhotos(key, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  r = await uploadFiles(fd); if (!r) return;
  S[key].sitePhotos = [...(S[key].sitePhotos || []), ...r.files]; persist(); renderWhenIdle();
}
async function uploadAccessPhotos(target, files) {
  const [key, field] = target.split('.');
  if (!['pickup', 'dropoff'].includes(key) || !['stairPhotos', 'doorPhotos'].includes(field)) return;
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  r = await uploadFiles(fd); if (!r) return;
  S[key][field] = [...(S[key][field] || []), ...(r.files || [])]; persist(); renderWhenIdle();
}
async function uploadPhotos(i, files) {
  const fd = new FormData(); [...files].forEach((f) => fd.append('photos', f));
  let r;
  r = await uploadFiles(fd); if (!r) return;
  S.items[i].photos = [...(S.items[i].photos || []), ...r.files]; persist(); updateNext(); renderWhenIdle(); // Next frees up right away, even if the screen redraw waits for a text box to lose focus
}

const showErr = (msg) => {
  const el = $('#err'); if (el) el.textContent = msg;
  const d = $('#dockErr'); if (d) { d.textContent = msg || ''; d.hidden = !msg; measureDock(); }
};
async function placeOrder() {
  const sig = JSON.stringify(payload());
  if (orderId && orderSig === sig) return { ok: true };
  const { ok, j } = await api('/api/orders', payload());
  if (!ok) return { ok: false, error: j.error || 'Something went wrong. Please try again.', timeConflict: !!j.timeConflict };
  orderId = j.id; orderSig = sig; quoteData = j.quote;
  if (j.status === 'pending_approval') return { ok: true, pending: j.order };
  return { ok: true };
}
// The chosen time no longer fits the route (re-checked by the server before any charge): nothing was charged, everything typed is
// kept, and the customer lands on the dates and times screen with the refreshed windows.
function backToTimes(msg) {
  twKey = ''; tw = null;
  step = STEPS.indexOf('When'); sub = ''; render();
  if (needsTwoDates()) loadDelivery();
  setTimeout(() => showErr(msg || 'The time you picked no longer fits our route that day. Please pick another time.'), 0);
}
async function pay(method) {
  if (busy) return;
  if (!existing && !canContinue()) return;
  busy = true; updateNext();
  try {
    showErr('');
    if (!existing) {
      const r = await placeOrder();
      if (!r.ok && r.timeConflict) return backToTimes(r.error);
      if (!r.ok) return showErr(r.error);
      if (r.pending) { confirmed = r.pending; sessionStorage.setItem('cad-done', confirmed.id); step = STEPS.indexOf('Done'); render(); return; }
    }
    const id = existing ? existing.id : orderId;
    const body = { method, card: $('#card')?.value, routing: $('#routing')?.value, account: $('#account')?.value, save: !!($('#saveMethod') && $('#saveMethod').checked) };
    const { ok, j } = await api(`/api/orders/${id}/pay`, body);
    if (!ok && j && j.timeConflict && !existing) { orderId = null; orderSig = null; return backToTimes(j.error); }
    if (!ok) return showErr(j.error || 'Payment failed. Please try again.');
    if (j.redirect) { location.href = j.redirect; return; }
    confirmed = j.order; existing = null; sessionStorage.setItem('cad-done', confirmed.id); step = STEPS.indexOf('Done'); render();
  } finally { busy = false; if (STEPS[step] !== 'Done') updateNext(); }
}

window.addEventListener('popstate', (e) => {
  const st = e.state && e.state.cadStep;
  if (st == null || busy || STEPS[step] === 'Done' || confirmed) return;
  const maxStep = orderId || existing ? STEPS.indexOf('Pay') : STEPS.indexOf('Pay') - 1; // never jump forward into payment without an order
  poppingStep = true;
  const ns = Math.max(0, Math.min(st, maxStep));
  sub = ns === st ? (e.state.cadSub || '') : '__last';
  step = ns; render(); poppingStep = false;
});
// Back: one screen at a time, then the last screen of the step before. Everything typed stays (it is all kept in the page state).
$('#backBtn').addEventListener('click', () => {
  const ids = panelIds(); const i = ids.indexOf(sub);
  if (i > 0) { sub = ids[i - 1]; render(); return; }
  if (step === 0) return;
  step -= 1; sub = '__last'; render();
});
const needLine = $('#needLine');
if (needLine) needLine.addEventListener('click', () => revealFirstMissing());

// Edit or "fix" on one piece from the list: after that piece's last screen, Next goes back to the list, not on to the next piece.
let returnToList = false;
// After Edit on the review screen: check the booking is still complete and go straight back to the review.
async function backToReview() {
  busy = true; updateNext();
  try {
    if (!isShip() && S.service) {
      const r = await api('/api/availability', payload());
      if (r.ok && r.j && r.j.days) {
        avail = r.j;
        if (S.schedule.date && ![...avail.days, ...avail.rush].some((d) => d.date === S.schedule.date)) { S.schedule.date = ''; S.rush = false; S.schedule.deliveryDate = ''; persist(); }
        if (needsTwoDates()) await loadDelivery();
      }
    }
  } finally { busy = false; }
  for (const n of ['What', 'Where', 'When']) {
    if (n === 'When' && !isShip() && !avail) continue;
    if (missingFields(n).length) { step = STEPS.indexOf(n); sub = '__missing'; render(); return; }
  }
  returnToReview = false; saveUi();
  step = STEPS.indexOf('Pay'); sub = '__last'; render();
}
async function goNext() {
  if (busy) return;
  const name = STEPS[step];
  const ids = panelIds(); const idx = ids.indexOf(sub); const last = ids.length < 2 || idx >= ids.length - 1;
  if (name === 'Pay' && last && quotePending) return;
  if (missingNow().length) { revealFirstMissing(); return; }
  if (returnToReview && name !== 'Pay') return backToReview();
  if (returnToList && step === 0 && /^p\d+c$/.test(sub)) { returnToList = false; sub = 'pieces-more'; render(); return; }
  if (!last) { sub = ids[idx + 1]; render(); return; }
  if (name === 'Pay') return pay(payMethod === 'zelle' ? 'zelle' : CFG.stripe ? 'stripe' : payMethod);
  if (name === 'Where' && isShip()) { step++; sub = ''; render(); return; }
  if (name === 'Where') {
    busy = true; updateNext();
    try {
      const { ok, j } = await api('/api/availability', payload());
      if (!ok) { const nl = $('#needLine'); if (nl && j && j.error) { nl.textContent = j.error; nl.hidden = false; } return; }
      avail = j; pairs = null; delAvail = null;
      if (S.schedule.date && ![...avail.days, ...avail.rush].some((d) => d.date === S.schedule.date)) { S.schedule.date = ''; S.rush = false; persist(); }
    } finally { busy = false; updateNext(); }
    if (!avail || !avail.days) return;
  }
  if (name === 'When' && !avail && !isShip()) return;
  step++; sub = ''; render();
  if (STEPS[step] === 'When' && needsTwoDates()) loadDelivery();
}
$('#nextBtn').addEventListener('click', goNext);
// Enter = Next (never on the payment screen, so a stray Enter can't charge anyone; never inside a text box that needs line breaks).
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
  const t = e.target;
  if (t && t.id === 'discountInput') { e.preventDefault(); applyDiscount(); return; }
  if (!t || !t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]), select')) return;
  if (STEPS[step] === 'Pay' && isLastPanel()) return;
  e.preventDefault();
  goNext();
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
    if (o && (o.status === 'confirmed' || o.status === 'pending_approval')) { confirmed = o; quoteData = o.quote; step = STEPS.indexOf('Done'); if (o.status === 'confirmed') sessionStorage.setItem('cad-done', o.id); }
    else if (o && o.status === 'awaiting_payment') { existing = o; payCanceled = qs.get('canceled') === '1'; step = STEPS.indexOf('Pay'); }
    history.replaceState(null, '', '/');
  } else if (sessionStorage.getItem('cad-done')) {
    // Refresh after booking: show the same confirmation, never a prefilled form that could book it again.
    const o = (await api(`/api/orders/${encodeURIComponent(sessionStorage.getItem('cad-done'))}`)).j.order;
    if (o && (o.status === 'confirmed' || o.status === 'pending_approval')) { confirmed = o; quoteData = o.quote; step = STEPS.indexOf('Done'); }
    else if (o && o.status === 'awaiting_payment') { existing = o; step = STEPS.indexOf('Pay'); }
    else sessionStorage.removeItem('cad-done');
  } else if (S.service) {
    // Returning mid-booking: land on the step they were on (never past one that still needs answers).
    try { const u = JSON.parse(draftStore.getItem('cad-ui') || 'null'); if (u) { UI.showContact = Array.isArray(u.showContact) ? u.showContact.filter((k) => k === 'pickup' || k === 'dropoff') : []; UI.showPayer = !!u.showPayer; UI.showList = !!u.showList; returnToReview = !!u.rtr; } } catch (_) { /* ignore */ }
    const saved = Math.min(Math.max(0, parseInt(draftStore.getItem('cad-step'), 10) || 0), STEPS.indexOf('Pay'));
    if (saved >= STEPS.indexOf('When') && !isShip()) {
      const r = await api('/api/availability', payload());
      avail = r.ok ? r.j : null;
      if (avail && needsTwoDates()) await loadDelivery();
    }
    step = saved;
    if (step >= STEPS.indexOf('When') && !isShip() && !(avail && avail.days)) step = STEPS.indexOf('Where');
    if (step === STEPS.indexOf('Pay') && !isShip() && !S.schedule.date) step = STEPS.indexOf('When');
    // Same screen they were on, unless the step had to move.
    sub = step === saved ? (draftStore.getItem('cad-sub') || '') : '__last';
  }
  render();
  // A saved draft from before Nov 19 may carry member fields: drop them so they can never reach the quote.
  ['member', 'memberCode', 'memberVerified', 'memberCompany', 'memberError'].forEach((k) => { delete S[k]; });
})();
