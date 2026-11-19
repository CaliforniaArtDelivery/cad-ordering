/* CAD online ordering — vanilla JS, no build step. 4 steps: What → Where → When → Review & pay. */
// Never let the browser restore an old scroll position on load/back; every step starts at the very top.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const STEPS = ['What', 'Where', 'When', 'Pay', 'Done'];
const STEP_TITLES = { What: 'What', Where: 'Where', When: 'When', Pay: 'Review & pay' };

const emptyAddr = () => ({
  street: '', city: '', state: 'CA', zip: '', country: 'United States', locationType: '', business: '',
  contactName: '', contactPhone: '', contactRole: '', contactRoleOther: '', sameAsMe: false, hours: '',
  accessMode: '', stairFlights: '', stairDir: '', stairTurns: '', stairPhotos: [],
  serviceElevator: '', dock: '', elevatorStairs: '', doorway: '', doorPhotos: [], narrowestIn: '', accessReview: false,
  floor: '', loadingDock: false, elevator: false, stairs: 0, steps: false, stairKind: '',
  fits: '', parkingRestricted: false, parkingNote: '', technicalCarry: false, sitePhotos: [],
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
    street: a.street || '', city: a.city || '', state: a.state || 'CA', zip: a.zip || '', country: a.country || 'United States', locationType: a.locationType || '', business: a.business || '',
    contactName: a.contactName || '', contactPhone: a.contactPhone || '', contactRole: a.contactRole || '', contactRoleOther: a.contactRoleOther || '', sameAsMe: !!a.sameAsMe, hours: a.hours || '',
    accessMode: a.accessMode || '', stairFlights: a.stairFlights ?? '', stairDir: a.stairDir || '', stairTurns: a.stairTurns || '', stairPhotos: a.stairPhotos || [],
    serviceElevator: a.serviceElevator || '', dock: a.dock || '', elevatorStairs: a.elevatorStairs || (a.elevatorSteps === 'steps' ? 'steps' : ''), doorway: a.doorway || '', doorPhotos: a.doorPhotos || [], narrowestIn: a.narrowestIn ?? '', accessReview: !!a.accessReview,
    floor: a.floor || '', loadingDock: !!(a.loadingDock || a.parking === 'Loading dock'), elevator: !!a.elevator,
    stairs: a.stairs === '' ? '' : (Number(a.stairs) || 0), steps: !!a.steps, stairKind: a.accessMode ? (a.stairKind || '') : '',
    fits: a.fits || '', parkingRestricted: !!a.parkingRestricted, parkingNote: a.parkingNote || '',
    technicalCarry: !!a.technicalCarry, sitePhotos: a.sitePhotos || [],
    centerHeight: a.centerHeight || '', wallType: a.wallType || '', hardware: a.hardware || '', highInstall: !!a.highInstall, installLocation: a.installLocation || (a.highInstall ? 'high' : ''), wallPhotos: a.wallPhotos || [],
    notes: extras.join(' · '),
  };
};
let pcSeq = 0;
const newPieceId = () => 'pc' + Date.now().toString(36) + (pcSeq++).toString(36) + Math.random().toString(36).slice(2, 6);
// One entry = one piece, with a permanent internal id (labels like "Piece 3" renumber after a removal; the id never does).
const emptyItem = () => ({ id: newPieceId(), checkValue: false, type: 'painting', furnitureKind: 'Sofa', sizeClass: 'medium', description: '', materialNotes: '', w: '', h: '', d: '', weight: '', framed: '', glazing: '', frameType: '', framedGlass: false, fragile: false, weightUnsure: false, fitsStairwell: false, hangHeight: 'standard', centerHeight: '', hangWhere: '', hangWhereOther: '', hangBottomFt: '', hangPhotos: [], crateStatus: 'not_sure', value: '', photos: [] });

let CFG = null;
let step = 0;
const emptyHeard = () => ({
  repeatClient: false, source: '', sourceOther: '',
  referrerKind: '', referrerName: '', referrerPhone: '', referrerEmail: '', businessName: '',
});
const fresh = () => ({
  service: '', crating: false, rush: false, dedicated: false, member: false, memberCode: '', memberVerified: false, memberCompany: '', memberError: '', declaredValueProtection: false,
  items: [emptyItem()], pickup: emptyAddr(), dropoff: emptyAddr(),
  contact: { name: '', email: '', phone: '', company: '', clientType: '' },
  heard: emptyHeard(), referral: false, partner: { type: 'None', name: '', email: '', phone: '' }, payer: 'me', payerOther: { name: '', email: '', phone: '' },
  schedule: { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' }, notes: '',
  shipping: { serviceLevel: '', shipBy: '', arriveBy: '', flexible: false, customs: { name: '', phone: '', email: '' } },
});
const S = Object.assign(fresh(), JSON.parse(sessionStorage.getItem('cad-order') || 'null') || {});
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
if (sessionStorage.getItem('cad-order')) { try { sessionStorage.setItem('cad-order', JSON.stringify(S)); } catch (_) { /* storage full or blocked: the in-memory copy still works */ } }
S.pickup = migrateAddr(S.pickup);
S.dropoff = migrateAddr(S.dropoff);
// Saved before the access rebuild: nothing was really chosen, so ask again rather than keep old defaults.
['pickup', 'dropoff'].forEach((k) => { if (!S[k].accessMode) { S[k].elevator = false; S[k].loadingDock = false; S[k].stairs = 0; S[k].steps = false; S[k].stairKind = ''; S[k].floor = ''; if (S[k].fits === 'yes') S[k].fits = ''; } CADAccess.normalize(S[k]); });
S.contact = { ...fresh().contact, ...(S.contact || {}) };
S.partner = { ...fresh().partner, ...(S.partner || {}) };
S.heard = { ...emptyHeard(), ...(S.heard || {}) };
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
let saveMethod = false;
let busy = false;

const persist = () => { if (STEPS[step] === 'Done') return; sessionStorage.setItem('cad-order', JSON.stringify(S)); sessionStorage.setItem('cad-step', String(step)); };
// What actually gets priced / booked: drop fields that don't apply to the chosen service.
const payload = () => {
  const o = JSON.parse(JSON.stringify(S));
  const sv = (CFG && CFG.services[o.service]) || {};
  // "Same as me": no role is sent; the server uses the booker's own "I am a…" (never a silent default).
  ['pickup', 'dropoff'].forEach((k) => { if (o[k] && o[k].sameAsMe) { o[k].contactRole = ''; o[k].contactRoleOther = ''; } });
  const clearInstall = (a) => { a.centerHeight = ''; a.wallType = ''; a.hardware = ''; a.highInstall = false; a.installLocation = ''; a.wallPhotos = []; };
  clearInstall(o.pickup);
  if (sv.install && o.items.some(isHung)) { if (!o.dropoff.wallType) o.dropoff.wallType = 'Not sure'; if (!o.dropoff.hardware) o.dropoff.hardware = 'Not sure'; }
  else clearInstall(o.dropoff);
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
  if (intlDest(o.dropoff)) o.dropoff.state = '';
  if (isShipState()) { o.schedule = { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' }; o.rush = false; o.dedicated = false; o.crating = false; clearInstall(o.dropoff); if (!intlDest(o.dropoff)) o.shipping.customs = { name: '', phone: '', email: '' }; }
  else delete o.shipping;
  o.items.forEach((it) => { cleanFraming(it); delete it.framedGlass; if (it.weightUnsure) it.weight = ''; else it.weightUnsure = false; });
  syncHeardPayload(o);
  o.member = !!(o.member && o.memberVerified);
  delete o.memberVerified;
  delete o.memberError;
  return o;
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
const outOfState = () => !shipService() && !!S.service && ((svc().needsPickup && outsideCA(S.pickup)) || outsideCA(S.dropoff));
const isShipState = () => shipService() || outOfState();
const isShip = isShipState;
const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; persist(); };
const isQuote = (q) => !!(q && q.paymentPlan === 'quote');
const special = () => !!(isShip() || S.rush || S.dedicated || S.crating || isQuote(quoteData));
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
const GLASS_TYPES = ['photograph', 'wallart'];
const FRAME_TYPE_OPTS = [['small', 'Small / lightweight'], ['medium', 'Medium'], ['large', 'Large / heavy / ornate']];
const FRAME_TYPE_ASK_OVER = 48;
const isHung = (it) => WALL_TYPES.includes(it.type || 'painting') || (it.type === 'decor' && hungDecorList().includes(it.furnitureKind));
const maxWH = (it) => Math.max(Number(it.w) || 0, Number(it.h) || 0);
const needsGlass = (it) => GLASS_TYPES.includes(it.type) && it.framed === 'yes';
const needsFrameType = (it) => FRAMING_TYPES.includes(it.type || 'painting') && it.framed === 'yes' && maxWH(it) > FRAME_TYPE_ASK_OVER;
const cleanFraming = (it) => {
  if (!FRAMING_TYPES.includes(it.type)) { it.framed = ''; it.glazing = ''; it.frameType = ''; }
  else {
    if (it.framed !== 'yes') { it.glazing = ''; it.frameType = ''; }
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
  if (it.framed === 'no') return true;
  if (it.framed !== 'yes') return false;
  if (needsGlass(it) && !['yes', 'no'].includes(it.glazing)) return false;
  if (needsFrameType(it) && !FRAME_TYPE_OPTS.some(([v]) => v === it.frameType)) return false;
  return true;
};
const TYPE_LABEL = (t) => (ITEM_TYPES.find(([v]) => v === (t || 'painting')) || [, t])[1];
const framingText = (it) => {
  if (it.type === 'mirror') return 'Glass (mirror)';
  if (!FRAMING_TYPES.includes(it.type || 'painting')) return '';
  if (it.framed === 'yes') {
    const bits = ['Framed'];
    if (needsGlass(it)) bits.push(it.glazing === 'yes' ? 'glass' : it.glazing === 'no' ? 'no glass' : '');
    if (it.frameType) { const lab = (FRAME_TYPE_OPTS.find(([v]) => v === it.frameType) || [])[1]; if (lab) bits.push(lab); }
    return bits.filter(Boolean).join(' · ');
  }
  return it.framed === 'no' ? 'Unframed' : '';
};
const hasHanging = () => hasInstall() && S.items.some(isHung);
const isPlaced = (it) => !isHung(it);
const longDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '');
const shortDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const TIME_PREF_OPTS = [['none', 'No preference'], ['midday', 'Midday'], ['afternoon', 'Afternoon / later in the day']];
const timePrefLabel = (v) => (TIME_PREF_OPTS.find((x) => x[0] === v) || ['', ''])[1];
const timePrefSummary = (pref, note) => [pref && pref !== 'none' ? timePrefLabel(pref) : '', String(note || '').trim()].filter(Boolean).join(' — ');
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
  pickup_delivery: 'White-glove pickup and delivery of fine art, sculpture, luxury furniture, décor, antiques and other valuable or fragile pieces, placed exactly where you want them.',
  delivery_install: 'Everything above, plus expert installation of paintings, mirrors and wall décor.',
  install_only: 'Already on site. We hang paintings, mirrors and wall décor.',
  crating_shipping: 'For anything going outside California, anywhere in the US or overseas, by air or ground. Delivering within California? Choose Pickup + Delivery above.',
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
const HANG_WHERES = [['mantel', 'Above a mantel or fireplace'], ['high', 'Higher than eye level (ladder needed)'], ['stairwell', 'In a stairwell'], ['other', 'Other']];
const HANG_PICKS = [['standard', 'Eye level / gallery standard (57–60" to center)'], ['high', 'Higher than eye level (ladder needed)'], ['mantel', 'Above a mantel or fireplace'], ['stairwell', 'In a stairwell']];
const hangWhereLabel = (v) => (HANG_WHERES.find(([k]) => k === v) || [v, v])[1];
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
const syncHeardPayload = (o) => {
  const h = { ...emptyHeard(), ...(o.heard || {}) };
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
  html += seg(p + '.hangPick', HANG_PICKS, 'stack');
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
const accessText = (a) => esc(CADAccess.summary(a).join(' · ')) || 'Not answered yet';
// Access, asked like a phone call (Chad): how do we get in, then only the follow-ups that apply, then the doorway.
const photoRow = (key, field, label, required) => {
  const a = S[key] || {};
  return `<div class="photos" style="margin:0 0 12px">${(a[field] || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}<label class="upload">＋ ${label}${required ? req : '<span> (helpful)</span>'}<input type="file" accept="image/*" multiple data-accessupload="${key}.${field}"></label></div>`;
};
const accessBlock = (key, a) => {
  const A = CADAccess;
  const big = A.firm(S.items);
  const mode = a.accessMode;
  const firmNote = '<p class="mini">We need this for large or heavy pieces.</p>';
  const opt = (label) => `${label} (optional)`;
  let h = `<div class="field" data-access="${key}"><label class="f">How do we get in?${req}</label>${seg(`${key}.accessMode`, A.MODES, 'stack')}</div>`;
  if (mode === 'not_sure') h += `<p class="mini" style="margin:0 0 8px">${A.REVIEW_NOTE}</p>`;
  if (mode === 'elevator') {
    h += input(`${key}.floor`, 'Floor', { ph: 'e.g. 3, Basement', attrs: 'autocapitalize="words" maxlength="30"', req: true });
    h += `<div class="field"><label class="f">${opt('Service elevator available?')}</label>${seg(`${key}.serviceElevator`, A.YNS, 'wrap')}</div>`;
    h += `<div class="field"><label class="f">Any stairs on the way?${req}</label>${seg(`${key}.elevatorStairs`, A.ELEV_STAIRS, 'wrap')}<p class="mini">Count steps before or after the elevator.</p></div>`;
  }
  if (A.usesStairs(a)) {
    h += `<div class="field"><label class="f">How many flights?${req}</label>${seg(`${key}.stairFlights`, A.FLIGHTS, 'wrap')}
      ${String(a.stairFlights) === '4plus' ? input(`${key}.stairs`, 'Total number of flights', { type: 'number', ph: 'e.g. 4', attrs: 'inputmode="numeric" min="4" step="1"', req: true }) : ''}</div>`;
    h += `<div class="field"><label class="f">Up or down?${req}</label>${seg(`${key}.stairDir`, A.DIRS, 'wrap')}</div>`;
    h += `<div class="field"><label class="f">${big ? 'Any tight turns or narrow spots?' + req : opt('Any tight turns or narrow spots?')}</label>${seg(`${key}.stairTurns`, A.YNS, 'wrap')}${big ? firmNote : ''}</div>`;
    if (A.stairPhotosNeeded(a)) h += `<p class="mini req-line">Photos of the stairs and path — required, so we can plan the carry.</p>${photoRow(key, 'stairPhotos', 'Photos of the stairs and path', true)}`;
  }
  let d = '';
  if (mode) {
    d += `<div class="field"><label class="f">${opt('Loading dock available?')}</label>${seg(`${key}.dock`, A.YNS, 'wrap')}</div>`;
    d += `<div class="field"><label class="f">${opt('Doors')}</label>${seg(`${key}.doorway`, A.DOORWAYS, 'wrap')}</div>`;
    d += `<div class="field"><label class="f">${big ? 'Will everything fit easily?' + req : opt('Will everything fit easily?')}</label>${seg(`${key}.fits`, A.FITS, 'wrap')}<p class="mini">Think doors, halls, turns, stairs and the elevator.</p>${big ? firmNote : ''}</div>`;
    if (A.doorPhotosNeeded(a)) d += `<p class="mini req-line">Please add a photo of the tight spot and the way in.</p>${photoRow(key, 'doorPhotos', 'Photos', true)}`;
    else if (a.fits === 'not_sure') d += `<p class="mini" style="margin:0 0 8px">Photos help if you have them.</p>${photoRow(key, 'doorPhotos', 'Photos', false)}`;
    if (A.fitUnsure(a)) d += input(`${key}.narrowestIn`, opt('Narrowest opening (inches)'), { type: 'number', ph: 'e.g. 30', attrs: 'inputmode="numeric" min="1" step="1"' });
  }
  const x = `${toggle(`${key}.technicalCarry`, 'Tight spaces, backyard or technical carry', 'Garden paths, gravel or flagstone, narrow side gates, or around the house.', true)}
        ${a.technicalCarry ? `<p class="mini" style="margin:0 0 8px">Photos of the route are helpful if you have them — you can also send them later.</p><div class="photos" style="margin:0 0 12px">${(a.sitePhotos || []).map((ph2) => `<img src="${esc(ph2)}" alt="">`).join('')}<label class="upload">＋ Photos of the route (stairs, stairwell, narrow halls or path)<span> (helpful)</span><input type="file" accept="image/*" multiple data-siteupload="${key}"></label></div>` : ''}
        ${toggle(`${key}.parkingRestricted`, 'Parking or loading restrictions', '', true)}
        ${a.parkingRestricted ? input(`${key}.parkingNote`, '', { ph: 'e.g. Loading zone only 9–11am, permit needed', attrs: 'aria-label="Parking or loading restrictions"' }) : ''}
        ${input(`${key}.hours`, 'Access hours', { ph: 'e.g. 9am–5pm' })}`;
  return { inn: h, doors: d, extra: x };
};

// ---------- pricing blocks ----------
const feeNoteHtml = (q) => (q && q.accessFeeNote ? `<p class="mini access-fee-note" data-access-fee-note>${esc(q.accessFeeNote)}</p>` : '');
const payPlan = (q) => {
  if (isQuote(q)) {
    return `<div class="plan"><div class="plan-head">Quote request · no payment due yet</div>
      ${q.reviewOnly ? `<div class="sum-row"><span>Estimated price</span><span class="amt"><b>${fmt(q.total)}</b></span></div>` : q.tripPremium ? `<div class="sum-row"><span>Regular rate</span><span class="amt">${fmt(q.regularTotal || q.total)}</span></div>
      <div class="sum-row"><span>Estimated range</span><span class="amt"><b>${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}</b></span></div>` : '<div class="sum-row"><span>Price</span><span>Priced by CAD</span></div>'}
      ${q.extraQuoted ? `<div class="sum-row"><span>${esc(q.extraQuoted)}</span><span>Quoted by CAD</span></div>` : ''}
      <p class="mini" style="margin:4px 0 10px">${esc(q.quoteNote || 'CAD sets a final price in this range. Nothing is charged until you approve it and pay.')}</p></div>`;
  }
  if (q.paymentPlan === 'deposit') {
    return `<div class="plan"><div class="plan-head">Orders of ${fmt(CFG.payment.depositThreshold)}+ are split 50/50</div>
      <div class="sum-row"><span>${accessTbc(q) ? CADAccess.TBC_DUE : 'Due today'}</span><span class="amt"><b>${fmt(q.dueNow)}</b></span></div>
      <div class="sum-row"><span>Balance due ${esc(q.balanceWhen)}${accessTbc(q) ? ' (before access check)' : ''}</span><span class="amt"><b>${fmt(q.balanceDue)}</b></span></div>${feeNoteHtml(q)}</div>`;
  }
  return `<div class="plan"><div class="sum-row"><span>${accessTbc(q) ? CADAccess.TBC_DUE : (q.accessFeeNote ? 'Due today' : 'Due today · paid in full at booking')}</span><span class="amt"><b>${fmt(q.dueNow)}</b></span></div>${feeNoteHtml(q)}</div>`;
};
// Access flagged Not sure (mode, fit or elevator stairs): the pricing API adds CADAccess.PRICE_NOTE; show it next to the price.
const accessTbc = (q) => !!(q && (q.notes || []).includes(CADAccess.PRICE_NOTE));
const priceCard = (q, withProtection) => `<div class="card price-card">
  ${q ? q.lines.map((l) => `<div class="sum-row"><span>${esc(l.label)}</span><span class="amt">${l.included ? 'Included' : fmt(l.amount)}</span></div>`).join('') : '<div class="sum-row"><span>Calculating…</span><span class="amt"></span></div>'}
  ${withProtection && protectionNote(q) ? `<p class="mini" style="margin:6px 0 0" data-protection-note>${protectionNote(q)}</p>` : ''}
  ${q ? `${accessTbc(q) ? `<p class="mini access-tbc" data-access-tbc><b>${esc(CADAccess.PRICE_NOTE)}</b></p>` : ''}${isQuote(q) && !q.tripPremium && !q.reviewOnly ? '' : `<div class="total"><span>${q.reviewOnly ? 'Estimated price' : isQuote(q) ? 'Regular rate' : accessTbc(q) ? CADAccess.TBC_TOTAL : 'Total'}</span><span class="amt">${fmt(q.regularTotal || q.total)}</span></div>`}${payPlan(q)}` : ''}
</div>`;

// ---------- payment block (shared by new orders and payment links) ----------
const paymentBlock = (q) => {
  const saveToggle = CFG.payment.savePaymentMethod ? toggleRaw('saveMethod', saveMethod, 'Save this payment method', 'We keep it on file with CAD for future bookings.') : '';
  if (CFG.stripe) {
    return `<div class="card"><span class="badge">Stripe test mode</span>
      <p class="mini" style="margin:0 0 12px">You’ll pay on Stripe’s secure page: Apple Pay, Google Pay, card or bank (ACH).</p>${saveToggle}<div class="err" id="err"></div></div>`;
  }
  // Mock checkout (prefilled test numbers, mock Apple / Google Pay) only when the server runs with TEST_MODE=1.
  if (!CFG.testMode) return `<div class="card"><p class="mini" style="margin:0">Online payment isn’t switched on yet. Please contact CAD to complete your booking.</p><div class="err" id="err"></div></div>`;
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
const REGION_NAME = { NorCal: 'Northern California', SoCal: 'Southern California' };
const regionName = (r) => REGION_NAME[r] || r || '';
// Cross-region jobs (e.g. SF pickup, LA delivery): name both regions instead of one route label.
const crossRegionLine = (rg) => (rg && rg.pickup && rg.dropoff && rg.pickup !== rg.dropoff ? `Pickup: ${regionName(rg.pickup)} · Delivery: ${regionName(rg.dropoff)}` : '');
const needsTwoDates = () => !!(svc().needsPickup && svc().needsDropoff && !isShip());
const routeHint = (day) => (day && day.routeType === 'downAndBack')
  ? `<p class="mini route-hint">This is a down-and-back route, so we have more flexibility to come early or on our way back.</p>`
  : '';
const timeReassure = `<div class="time-reassure"><p>We build each route day to serve everyone efficiently, so we can’t promise an exact time at booking. We’ll be in touch before your date to confirm the arrival window. Need a guaranteed time? Ask about a dedicated trip.</p></div>`;
const timePrefBlock = (prefPath, notePath, { showReassure = false } = {}) => {
  const pref = get(prefPath) || 'none';
  return `<h2>Time preference or constraints <span class="opt">(not guaranteed)</span></h2>
    <div class="chips" data-chips="${prefPath}">${TIME_PREF_OPTS.map(([v, l]) => `<button type="button" class="chip ${(pref || 'none') === v ? 'on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>
    ${input(notePath, 'Time note (optional)', { ph: 'e.g. Must be done by noon' })}
    <p class="mini">Tell us any time limits in the note; we’ll do our best but can’t promise.</p>
    ${showReassure ? timeReassure : ''}`;
};
const promiseCard = (sub, extraStyle = '', editTarget = '') => {
  const sp = special();
  const two = needsTwoDates() && S.schedule.date && S.schedule.deliveryDate;
  const title = two
    ? `Pickup ${esc(shortDate(S.schedule.date))} · Delivery ${esc(shortDate(S.schedule.deliveryDate))}`
    : `${esc(longDate(S.schedule.date))}`;
  const prefs = two
    ? [timePrefSummary(S.schedule.timePref, S.schedule.timeNote) && `Pickup: ${timePrefSummary(S.schedule.timePref, S.schedule.timeNote)}`,
       timePrefSummary(S.schedule.deliveryTimePref, S.schedule.deliveryTimeNote) && `Delivery: ${timePrefSummary(S.schedule.deliveryTimePref, S.schedule.deliveryTimeNote)}`].filter(Boolean).join(' · ')
    : timePrefSummary(S.schedule.timePref, S.schedule.timeNote);
  const line = sp ? (S.rush || S.dedicated ? 'Preferred date · confirmed with your quote' : 'Price confirmed with your quote')
    : (prefs || sub || '');
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
  const cross = crossRegion() ? `<p class="note">Pickup and delivery follow separate regional routes. Your selected dates are shown above.</p>` : '';
  const chip = `<div class="pickup-chip" data-pickup-chip><span><b>Pickup</b> ${esc(shortDate(S.schedule.date))}</span><button type="button" class="edit" data-change-pickup>Change</button></div>`;
  return `${chip}
    <h1 class="when-h1">Choose your delivery date</h1>
    <p class="sub">Pick a route day that serves the delivery address, on or after your pickup date. Same-day delivery is available when that route serves both areas. Same-day isn’t available between Northern and Southern California.</p>
    ${cross}
    <div class="region">● ${esc((delAvail && (delAvail.area || delAvail.region)) || 'Your area')} route</div>
    ${days}`;
}
async function loadDelivery() {
  if (!needsTwoDates() || !S.schedule.date) return;
  const { ok, j } = await api('/api/availability', { ...payload(), leg: 'dropoff' });
  if (!ok) return;
  delAvail = j;
  if (S.schedule.deliveryDate && !j.days.some((d) => d.date === S.schedule.deliveryDate)) { S.schedule.deliveryDate = ''; persist(); }
  if (STEPS[step] === 'When') renderWhenIdle();
}

// ---------- photo rules (Chad, Nov 19): required only when special handling is on. Weight "Not sure" never requires a photo. ----------
const itemPhotoReason = (it) => (it.fragile ? 'Photo required for special handling.' : '');
const photosOk = (it) => !itemPhotoReason(it) || (it.photos || []).length > 0;
const sitePhotosOk = () => true;
const hangPhotosOk = (it) => it.hangHeight !== 'higher' || it.hangWhere !== 'stairwell' || (it.hangPhotos || []).length > 0;
const valueHint = (it) => (shipService() ? 'The value of this one piece. Our shipping partner uses it for coverage.'
  : num(it.value) > 50000 ? 'The value of this one piece.'
  : num(it.value) > 0 ? `Required declared value protection: 1.5% of this piece’s declared value (${fmt(Math.round(num(it.value) * 1.5) / 100)} per piece).`
  : PROTECTION_HINT);
// Declared value protection (Chad + Dot, Nov 16 2026): required, 1.5% of each ELIGIBLE piece's declared value
// (pieces valued $50,000 or less). Never optional, never called insurance or full coverage.
// Over $50,000: no protection line, no note, no special hint (Chad, Nov 16 2026). The value is just for our records.
const PROTECTION_HINT = 'The value of this one piece. Pieces valued up to $50,000 carry required declared value protection: 1.5% of their declared value.';
const protectionNote = (q) => (q && q.protection && q.protection.amount > 0
  ? 'Required declared value protection is 1.5% of the declared value of each eligible piece (valued up to $50,000), included in the price above.'
  : '');
const PROTECTION_DOCK = 'Includes required declared value protection';
const PROTECTION_TERMS = 'Declared value protection applies to pieces valued up to $50,000.';
const weightRequired = (it) => shipService() || it.type === 'sculpture' || it.type === 'other';
const weightOk = (it) => !weightRequired(it) || !!it.weightUnsure || num(it.weight) > 0;
function updateItemHints(i) {
  const it = S.items[i]; if (!it) return;
  const vh = app.querySelector(`[data-valhint="${i}"]`); if (vh) vh.textContent = valueHint(it);
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
  const glass = needsGlass(item) ? `<div class="field" data-glass="${i}"><label class="f">Glass? — ${pieceName(i)}${req}</label>${seg(`${p}.glazing`, [['yes', 'Yes'], ['no', 'No']])}<p class="mini">Does this piece have a glass front?</p></div>` : '';
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
const handlingBlock = (item, i) => `${toggle(`items.${i}.fragile`, 'Special handling needed', '', true)}
    <p class="mini" style="margin:-6px 0 10px">Only for pieces outside normal handling: extremely fragile, large protrusions or awkward shapes, can’t be stood upright, or needs custom crating. Paintings, framed art, mirrors, ceramics and solid sculpture don’t need this.</p>`;
const weightField = (item, i, { required = false, approx = false } = {}) => {
  const p = `items.${i}`;
  const label = approx ? `Approx. weight — ${pieceName(i)} (lb)` : `Weight — ${pieceName(i)} (lb)`;
  const reqMark = required && !item.weightUnsure ? req : '';
  return `<div class="field" data-weight="${i}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px">
      <label class="f" for="f-${p}.weight" style="margin:0">${label}${reqMark}</label>
      <button type="button" class="pill-btn ${item.weightUnsure ? 'on' : ''}" data-weightunsure="${i}">${item.weightUnsure ? '✓ Not sure' : 'Not sure'}</button>
    </div>
    ${item.weightUnsure ? '<p class="mini" style="margin:0 0 8px">No problem, you can skip this.</p>' : input(`${p}.weight`, '', { ph: approx ? 'e.g. 200' : 'e.g. 40', attrs: `inputmode="decimal" aria-label="${label}"` }) + '<p class="mini">Pounds. Approximate is fine.</p>'}
  </div>`;
};
const shipExtras = (item, i) => {
  const p = `items.${i}`;
  return `<label class="f">Size in inches (W × H × D)${req}</label>
    <div class="row3">${input(`${p}.w`, '', { type: 'number', ph: 'W', attrs: 'inputmode="decimal" aria-label="Width"' })}${input(`${p}.h`, '', { type: 'number', ph: 'H', attrs: 'inputmode="decimal" aria-label="Height"' })}${input(`${p}.d`, '', { type: 'number', ph: 'D', attrs: 'inputmode="decimal" aria-label="Depth"' })}</div>
    <p class="mini" style="margin:-4px 0 10px">Approximate inches are fine.</p>
    ${weightField(item, i, { required: true })}
    ${input(`${p}.value`, 'Declared value ($)', { ph: 'e.g. 12,000', attrs: 'inputmode="numeric"', req: true })}
    ${framingBlock(item, i)}
    ${handlingBlock(item, i)}`;
};
const shipReady = () => S.items.every((it) => weightOk(it) && num(it.value) > 0 && dimsOk(it))
  && !!S.shipping.serviceLevel && !!(S.shipping.shipBy || S.shipping.flexible);
const LEVELS = [['curbside', 'Curbside', 'Delivered to the curb or loading dock.'], ['inside', 'Inside delivery', 'Carried in and placed in the room of your choice.'], ['unpack', 'Inside + unpack & install', 'We unpack, place or hang, and check every piece.'], ['unpack_debris', 'Unpack, install + debris removal', 'Full white-glove: all packing removed.']];
const levelText = (v) => (LEVELS.find((l) => l[0] === v) || [, '—'])[1];
const timingText = (s) => [s.shipBy && `Ship by ${shortDate(s.shipBy)}`, s.arriveBy && `Arrive by ${shortDate(s.arriveBy)}`, s.flexible ? 'Flexible' : ''].filter(Boolean).join(' · ') || 'Flexible';
const destText = (a) => [a.street, [a.city, intlDest(a) ? '' : a.state].filter(Boolean).join(', '), a.zip, intlDest(a) ? a.country : ''].filter(Boolean).map(esc).join(', ');
const OOS_NOTE = 'Pickups and deliveries outside California are custom quoted as Shipping. Within California we always provide white-glove delivery. Samantha prices your job and emails you a quote; nothing is charged until you approve it.';

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
const dimsBlock = (i) => { const p = `items.${i}`; return `<label class="f">Size in inches (W × H × D)${req}</label>
        <div class="row3">${input(`${p}.w`, '', { type: 'number', ph: 'W', attrs: 'inputmode="decimal" aria-label="Width"' })}${input(`${p}.h`, '', { type: 'number', ph: 'H', attrs: 'inputmode="decimal" aria-label="Height"' })}${input(`${p}.d`, '', { type: 'number', ph: 'D', attrs: 'inputmode="decimal" aria-label="Depth"' })}</div>
        <p class="mini" style="margin:-4px 0 10px">Approximate inches are fine.</p>`; };
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
      + `<p class="mini" style="margin:-4px 0 8px" data-valhint="${i}">${valueHint(item)}</p>` + checkValueNote(item);
    h = `${needsWeight ? weightField(item, i, { required: true }) : ''}
        ${type === 'custom' ? '' : value}
        ${type === 'other' ? '<p class="mini" style="margin:0 0 6px">Priced by weight from our sculpture rates. The price covers pickup, delivery and placement wherever you want it. CAD may adjust the final quote after seeing photos.</p>' : ''}
        ${type === 'sculpture' ? '<p class="mini" style="margin:0 0 6px">One weight-based price covers pickup, delivery and placement wherever you want it.</p>' : ''}
        ${hasInstall() && type === 'decor' && quoteHangList().includes(item.furnitureKind) ? `<p class="mini" style="margin:0 0 6px">${esc(item.furnitureKind)} hanging isn’t on our rate card, so this becomes a quick quote request.</p>` : ''}
        ${type === 'furniture' ? '<p class="mini" style="margin:0 0 6px">One price covers pickup, delivery and placement wherever you want it.</p>' : ''}
        ${!needsWeight ? weightField(item, i, { approx: true }) : ''}
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
    <p class="mini">We’ll copy the details from this piece. You can edit each copy before submitting your request.</p>
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
        ${dimsOn ? `<label class="f">Size in inches (W × H × D)</label><div class="row3">${['w', 'h', 'd'].map((k, n2) => input(`${p}.${k}`, '', { ...ip, type: 'number', ph: 'WHD'[n2], attrs: 'inputmode="decimal" aria-label="' + ['Width', 'Height', 'Depth'][n2] + '"' })).join('')}</div>` : ''}
        ${FRAMING_TYPES.includes(it.type || 'painting') ? `<div class="field"><label class="f">Framed?</label>${seg(`${p}.framed`, [['yes', 'Yes'], ['no', 'No']])}</div>` : ''}
        ${it.type !== 'custom' ? input(`${p}.value`, 'Declared value ($)', { ...ip, ph: 'e.g. 12,000', attrs: 'inputmode="numeric"' }) : ''}
        ${it.checkValue ? `<button type="button" class="pill-btn" data-valok="${esc(it.id)}">Value is right</button>` : ''}
        <div class="field"><div class="qweight"><label class="f" for="q-${p}.weight">Weight (lb)</label><button type="button" class="pill-btn ${it.weightUnsure ? 'on' : ''}" data-weightunsure="${i}">${it.weightUnsure ? '✓ Not sure' : 'Not sure'}</button></div>
          ${it.weightUnsure ? '<p class="mini">No problem, you can skip this.</p>' : input(`${p}.weight`, '', { ...ip, ph: 'e.g. 40', attrs: 'inputmode="decimal" aria-label="Weight in pounds"' })}</div>
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
const reviewPieces = () => `<div class="sum-row piece-review-note"><span class="mini" data-piece-note>Each piece is listed and priced separately. Please check the dimensions, declared value, handling requirements, and photos for every piece.</span></div>`
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
// ---------- views ----------
const roleLabel = (key) => (key === 'pickup' ? 'Pickup contact role' : S.service === 'install_only' ? 'Install contact role' : 'Delivery contact role');
const views = {
  What() {
    const base = (CFG.pricing && CFG.pricing.displayFrom) || {};
    const ship = shipService();
    const itemA = (item, i) => {
      const type = item.type || 'painting';
      const p = `items.${i}`;
      const ph = { painting: 'e.g. Oil on canvas', photograph: 'e.g. Signed gelatin silver print', mirror: 'e.g. Venetian mirror, gilt', wallart: 'e.g. Mixed media, wall sculpture', sculpture: 'e.g. Bronze on plinth', furniture: 'e.g. Walnut credenza', decor: item.furnitureKind === 'Other (describe)' ? 'e.g. Ceramic garden stool, pair of candlesticks' : 'e.g. Pair of table lamps', other: 'e.g. Antique clock, Murano glass chandelier', custom: 'e.g. Collect two pieces from a framer and deliver them with the rest' }[type];
      const kinds = type === 'furniture' ? (CFG.pricing.furnitureKinds || []) : decorKindOptions();
      const sizeOpts = sizeOptionsFor(type, item.furnitureKind);
      const allowedSizes = sizeOpts.map((o) => Array.isArray(o) ? o[0] : o);
      if ((type === 'furniture' || type === 'decor') && !allowedSizes.includes(item.sizeClass)) item.sizeClass = 'medium';
      const kindRow = (type === 'furniture' || type === 'decor') ? `<div class="row keep kind-row">${select(`${p}.furnitureKind`, type === 'decor' ? 'Type of décor' : 'Item', kinds, { rerender: true })}${select(`${p}.sizeClass`, 'Size', sizeOpts)}</div>${type === 'decor' && isAccentKind(item.furnitureKind) ? '<p class="mini" style="margin:-4px 0 10px">Extra small is a small figurine or bud vase. Extra large is a statement piece.</p>' : ''}` : '';
      return `<div class="card"><div class="item-head"><b>Piece ${i + 1}</b><span class="item-actions">
          ${S.items.length > 1 ? `<button type="button" class="link muted" data-removeask="${esc(item.id)}">Remove this piece</button>` : ''}</span></div>
        <div class="field"><div class="chips" data-itemtype="${i}">${itemTypes().map(([v, l]) => `<button type="button" class="chip ${type === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
        ${type === 'photograph' ? `<p class="mini" style="margin:-4px 0 10px">Prints and photographs${hasInstall() ? '. Hung on a wall, so we can install it.' : ', framed or unframed.'}</p>` : ''}
        ${type === 'wallart' ? `<p class="mini" style="margin:-4px 0 10px">Mixed media, wall sculpture, etc.${hasInstall() ? ' Hung on a wall, so we can install it.' : ''}</p>` : ''}
        ${kindRow}
        ${input(`${p}.description`, type === 'custom' ? 'Your request' : 'Description of this piece', { ph, req: true })}
        ${type === 'custom' ? '<p class="mini" style="margin:0 0 6px">Tell us what you need in the description. CAD reviews it and sends a custom quote; nothing is charged until you approve it.</p>'
          : pieceHasSize(item, ship) ? '<p class="mini desc-hint" data-deschint style="margin:-4px 0 10px">Just the medium or type, like oil on canvas. You’ll add size next.</p>'
          : '<p class="mini desc-hint" data-deschint style="margin:-4px 0 10px">Just the medium or type, like oil on canvas.</p>'}
      </div>`;
    };
    const pieceTitle = (i) => (S.items.length > 1 ? `Piece ${i + 1}: what is it?` : `What are we ${svcVerb()}?`);
    const panels = [];
    panels.push(panel('service', `<h1>${S.service === 'install_only' ? 'What are we installing?' : 'How can we help?'}</h1><p class="sub">Fine art, luxury furniture and décor are our specialty, and we handle other fragile or valuable pieces. Approximate sizes are fine.</p>
      <div class="choices">${Object.entries(CFG.services).map(([k, v]) => `<button type="button" class="choice ${S.service === k ? 'on' : ''}" data-service="${k}">
        <span class="ico">${ICONS[k]}</span><span class="txt"><b>${v.label}</b>${SUBTITLE[k] ? `<span class="svc-sub">${esc(SUBTITLE[k])}</span>` : ''}<span class="d">${DESC[k]}</span></span><span class="from">${base[k] == null ? 'Custom quote' : 'from ' + fmt(base[k])}</span></button>`).join('')}</div>
      <p class="mini" data-from-note>Starting prices don’t include declared value protection.</p>`));
    if (S.service) {
      S.items.forEach((item, i) => {
        panels.push(panel(`p${i}a`, `<h1>${pieceTitle(i)}</h1>${itemA(item, i)}`));
        if (pieceHasSize(item, ship)) panels.push(panel(`p${i}b`, `<h1>How big is it?</h1>${pieceTag(item, i)}<div class="card">${pieceSize(item, i, ship)}</div>`));
        panels.push(panel(`p${i}c`, `<h1>${ship ? 'Weight, value and care' : 'Value and care'}</h1>${pieceTag(item, i)}<div class="card">${pieceCare(item, i, ship)}</div>`));
      });
      panels.push(panel('pieces-more', `<h1>Anything else to ${svcVerbShort()}?</h1><p class="sub">${S.items.length === 1 ? 'You’ve added one piece.' : `You’ve added ${S.items.length} pieces.`} Each piece is listed and priced separately. Add more, copy a piece, or tap Next to continue.</p>
        ${flaggedPieces().length > 1 ? valueConfirmCard('list') : ''}
        ${listSummary()}
        <div class="card pc-list" data-pclist>${S.items.map((it, i) => pieceListRow(it, i)).join('')}</div>
        <button type="button" class="add" id="addItem">＋ Add another piece</button>
        ${quickEditBlock()}
        <p class="mini">${ship ? 'Shipping is for anything going outside California, in the US or overseas, and is always custom quoted. Within California we always provide white-glove delivery. Nothing is charged until you approve Samantha’s quote.' : `${esc(CFG.notice || '')} Jobs with an address outside California are custom quoted as Shipping. Within California we always provide white-glove delivery.`}</p>`));
    }
    return panels.join('');
  },

  Where() {
    const oos = () => (outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : '');
    const addrPanel = (key, optional = false) => {
      const a = get(key);
      const title = key === 'pickup' ? 'Where are we picking up?' : shipService() ? 'Where is it going?' : S.service === 'install_only' ? 'Where are we installing?' : 'Where are we delivering?';
      return panel(`${key}-addr`, `<h1>${title}</h1>${oos()}<div class="card">
        ${key === 'dropoff' && shipService() ? input(`${key}.country`, 'Country', { ph: 'United States', attrs: 'autocomplete="country-name"', req: true }) : ''}
        ${key === 'dropoff' && shipService() && intlDest(a)
          ? `<div class="field"><label class="f" for="f-${key}.street">Full address${req}</label><textarea id="f-${key}.street" data-path="${key}.street" placeholder="Street, building, postal code, city, region">${esc(a.street)}</textarea></div>${input(`${key}.city`, 'City', { ph: 'e.g. London', req: true })}`
          : `${input(`${key}.street`, 'Street address', { ph: key === 'pickup' ? '2 Henry Adams St' : '8678 Melrose Ave', attrs: 'autocomplete="street-address"', req: !optional })}
        <div class="row keep addr3">${input(`${key}.city`, 'City', { ph: key === 'pickup' ? 'San Francisco' : 'West Hollywood', req: !optional })}${input(`${key}.state`, 'State', { ph: 'CA', attrs: 'autocomplete="address-level1" maxlength="14"' })}${input(`${key}.zip`, 'ZIP', { ph: key === 'pickup' ? '94103' : '90069', attrs: 'inputmode="numeric" maxlength="10"' })}</div>`}
        ${key === 'dropoff' && shipService() ? `<div class="field" style="margin-top:4px"><label class="f">Destination type</label>${seg(`${key}.locationType`, [['residential', 'Residential'], ['commercial', 'Commercial']])}</div>` : ''}
        ${input(`${key}.business`, 'Business or gallery (optional)', { ph: 'e.g. gallery, showroom, hotel' })}
      </div>`);
    };
    const whereWord = (key) => (key === 'pickup' ? 'pickup' : S.service === 'install_only' ? 'install' : shipService() ? 'destination' : 'delivery');
    const contactPanel = (key, optional = false) => {
      const a = get(key);
      return panel(`${key}-contact`, `<h1>Who will meet us at ${key === 'pickup' ? 'pickup' : S.service === 'install_only' ? 'the install' : shipService() ? 'the destination' : 'delivery'}?</h1><p class="sub">The person on site who can let us in.</p><div class="card">
        <div class="sub-head first"><span>On-site <b>${whereWord(key)}</b> contact</span><button type="button" class="pill-btn ${a.sameAsMe ? 'on' : ''}" data-same="${key}">${a.sameAsMe ? '✓ Same as me' : 'Same as me'}</button></div>
        <div class="row keep">${input(`${key}.contactName`, 'Name', { ph: 'Name', req: !optional })}${input(`${key}.contactPhone`, 'Mobile', { type: 'tel', ph: '(310) 555-0100', req: !optional, attrs: 'autocomplete="tel"' })}</div>
        <div data-rolewrap="${key}" ${a.sameAsMe ? 'hidden' : ''}>${select(`${key}.contactRole`, roleLabel(key), CONTACT_ROLES, { req: !optional, placeholder: 'Please choose one', rerender: true })}
        ${a.contactRole === 'Other' ? input(`${key}.contactRoleOther`, 'Describe their role', { req: true, ph: 'e.g. House sitter' }) : ''}</div>
      </div>`);
    };
    const accessPanels = (key) => {
      const a = get(key);
      const ab = accessBlock(key, a);
      const at = `<p class="sub">${key === 'pickup' ? 'Pickup' : S.service === 'install_only' ? 'Install' : shipService() ? 'Destination' : 'Delivery'}${a.street ? ' · ' + esc(a.street) : ''}</p>`;
      return [
        panel(`${key}-access`, `<h1>How do we get in?</h1>${at}<div class="card">${ab.inn}</div>`),
        panel(`${key}-doors`, `<h1>Doors, docks and fit</h1>${at}<div class="card">${ab.doors || '<p class="mini" style="margin:0">Tell us how we get in first.</p>'}</div>`),
        panel(`${key}-extra`, `<h1>Anything else about this address?</h1>${at}<div class="card">${ab.extra}
        <div class="field" style="margin:0"><label class="f" for="f-${key}.notes">Special instructions</label><textarea id="f-${key}.notes" data-path="${key}.notes" placeholder="Gate codes, who to ask for, anything else">${esc(a.notes)}</textarea></div></div>`),
      ];
    };
    const out = [];
    out.push(panel('you', `<h1>Let’s start with you</h1><p class="sub">Who we’re working with.</p><div class="card">
        ${input('contact.name', 'Full name', { attrs: 'autocomplete="name"', req: true })}
        <div class="row">${input('contact.email', 'Email', { type: 'email', attrs: 'autocomplete="email" autocapitalize="off"', req: true })}${input('contact.phone', 'Mobile', { type: 'tel', ph: '(415) 555-0123', attrs: 'autocomplete="tel"', req: true })}</div>
      </div>`));
    out.push(panel('about', `<h1>A little about you</h1><div class="card">
        <div class="row">${input('contact.company', 'Company (optional)')}${select('contact.clientType', 'I am a…', ['Collector', 'Gallery', 'Furniture showroom', 'Interior designer', 'Auction house', 'Artist', 'Other'], { req: true, placeholder: 'Please choose one' })}</div>
        ${toggle('member', 'I’m a CAD member', '25% off published rates.', true)}
        ${S.member ? `${input('memberCode', 'Member code', { req: true, ph: 'Enter your member code', attrs: 'autocapitalize="characters" autocomplete="off" spellcheck="false"' })}
        ${S.memberVerified && S.memberCompany ? `<p class="mini member-ok">Member rate applied for ${esc(S.memberCompany)}.</p>` : ''}` : `<p class="mini member-pitch">Not a member? CAD Membership is $200/month and gives 25% off every order — ideal if you book $1,000+ a month. Ask us about it on your order or at checkout.</p>`}
      </div>`));
    out.push(panel('heard', `<h1>How did you find us?</h1><div class="card">
        ${toggle('heard.repeatClient', 'I’ve ordered with CAD before', 'Welcome back.', true)}
        ${!S.heard.repeatClient ? `${select('heard.source', 'How did you hear about us?', HEARD_SOURCES, { req: true, placeholder: 'Please choose one', rerender: true })}
        ${S.heard.source === 'referral' ? `${select('heard.referrerKind', 'Who referred you?', REFERRER_KINDS, { req: true, placeholder: 'Please choose one', rerender: true })}
        ${S.heard.referrerKind ? `${input('heard.referrerName', 'Referrer name (optional)', { ph: 'Name' })}
        <div class="row keep">${input('heard.referrerPhone', 'Referrer phone (optional)', { type: 'tel', ph: '(415) 555-0123', attrs: 'autocomplete="tel"' })}${input('heard.referrerEmail', 'Referrer email (optional)', { type: 'email', attrs: 'autocapitalize="off" autocomplete="email"' })}</div>
        ${BUSINESS_REFERRERS.includes(S.heard.referrerKind) ? input('heard.businessName', 'Business name (optional)', { ph: 'Gallery or showroom name' }) : ''}
        <p class="mini member-pitch">If someone referred you, we’d love to thank them.</p>` : ''}` : ''}
        ${S.heard.source === 'other' ? input('heard.sourceOther', 'Tell us where', { req: true, ph: 'Where did you hear about us?' }) : ''}` : ''}
      </div>`));
    if (svc().needsPickup) { out.push(addrPanel('pickup'), contactPanel('pickup'), ...accessPanels('pickup')); }
    out.push(addrPanel('dropoff'), contactPanel('dropoff'), ...accessPanels('dropoff'));
    const da = get('dropoff');
    if (intlDest(da) && shipService()) {
      out.push(panel('customs', `<h1>Customs / import contact</h1><p class="sub">The person or broker who clears the shipment at the destination. Leave blank if it’s the recipient.</p><div class="card">
        <div class="row keep">${input('shipping.customs.name', 'Name', { ph: 'Name or broker' })}${input('shipping.customs.phone', 'Phone', { type: 'tel', ph: '+44 20 0000 0000' })}</div>
        ${input('shipping.customs.email', 'Email', { type: 'email', attrs: 'autocapitalize="off"' })}</div>`));
    }
    if (hasHanging() && !isShip()) {
      out.push(panel('hang', `<h1>About the walls</h1><p class="sub">For hanging.</p><div class="card">
        ${select('dropoff.wallType', 'Wall type', ['Not sure', 'Drywall', 'Plaster', 'Concrete / brick', 'Wood', 'Tile / stone', 'Glass'])}
        <div class="field" style="margin:0"><label class="f">Hanging hardware</label>${seg('dropoff.hardware', [['CAD brings it', 'CAD brings it'], ['On site', 'On site'], ['Not sure', 'Not sure']])}</div></div>`));
      S.items.forEach((it, i) => { if (isHung(it)) out.push(panel(`hang-p${i}`, `<h1>How high should we hang it?</h1><div class="card">${hangPieceBlock(it, i)}</div>`)); });
    }
    if (S.items.some(pieceNeedsStairwellFit)) {
      out.push(panel('stairfit', `<h1>Stairwell fit</h1><div class="card">${S.items.map((it, i) => pieceNeedsStairwellFit(it) ? `<label class="toggle" data-reqblock="stairwellFit-${i}"><span>Piece ${i + 1}${it.description ? ` (${esc(it.description)})` : ''}: I confirm this piece will fit through the stairwell. If it doesn’t fit, CAD will leave it at the bottom of the stairs and the full price still applies.</span>
        <span class="sw"><input type="checkbox" data-path="items.${i}.fitsStairwell" ${it.fitsStairwell ? 'checked' : ''}><i></i></span></label>` : '').join('')}</div>`));
    }
    return out.join('');
  },

  When() {
    if (isShip()) return views.ShipWhen();
    if (!avail) return panel('date', `<h1>Choose your date</h1><p class="sub">Finding route days near you…</p>`);
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
    const ready = two ? !!(S.schedule.date && S.schedule.deliveryDate) : !!S.schedule.date;
    if (S.schedule.date && !(S.schedule.timePref || '').trim()) S.schedule.timePref = 'none';
    if (S.schedule.deliveryDate && !(S.schedule.deliveryTimePref || '').trim()) S.schedule.deliveryTimePref = 'none';
    const pickupHtml = `<h1 class="when-h1">${title}</h1><p class="sub">${subTxt}</p>
      <div class="region">● ${esc(avail.area || region)} route</div>
      <div class="days" data-reqblock="date">${dayWindow(avail.days, S.schedule.date, 'pu').list.map(card).join('')}</div>${dayWindow(avail.days, S.schedule.date, 'pu').btn}
      ${intro ? `<p class="mini">${intro}</p>` : ''}
      ${avail.rush.length ? `<h2>Need a different date?</h2><div class="days">${avail.rush.map(card).join('')}</div>` : ''}
      ${sel ? routeHint(sel) : ''}
      ${S.schedule.date ? timePrefBlock('schedule.timePref', 'schedule.timeNote', { showReassure: true }) : ''}`;
    const tail = `${ready ? promiseCard(crossRegionLine(quoteData && quoteData.regions) || (sel && sel.routeLabel) || (region + ' route')) : ''}
      <div class="card" style="margin-top:14px">${toggle('dedicated', 'Dedicated trip', 'A van and crew just for your job, at a time that works for you.', true, 'first')}</div>
      <p class="mini">Rush and dedicated trips are priced individually; you’ll see the price before paying.</p>`;
    const split = two && !!S.schedule.date;
    return panel('date', pickupHtml + (split ? '' : tail)) + (split ? panel('deldate', deliveryBlock() + tail) : '');
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
    out.push(panel('ship-level', `<h1>${out.length ? 'Service at the destination' : 'Shipping details'}</h1>${out.length ? '' : `<p class="sub">Everything Samantha needs to price your shipment.</p>${oos}`}
      ${outOfState() ? `<h2>Destination type</h2><div class="card">${seg('dropoff.locationType', [['residential', 'Residential'], ['commercial', 'Commercial']])}</div>` : ''}
      <h2>Service at the destination</h2><div class="choices" data-reqblock="serviceLevel">${LEVELS.map(lvl).join('')}</div>`));
    out.push(panel('ship-timing', `<h1>When should it ship?</h1><div class="card">
        <div class="row keep">${input('shipping.shipBy', 'Ship by', { type: 'date', attrs: `min="${today}"` })}${input('shipping.arriveBy', 'Arrive by (optional)', { type: 'date', attrs: `min="${today}"` })}</div>
        ${toggle('shipping.flexible', 'My dates are flexible', 'Flexible dates usually mean a better shipping rate.', true)}
      </div>
      <p class="mini">Fully insured through our shipping partners.</p>`));
    return out.join('');
  },

  Pay() {
    if (existing) return views.PayLink();
    if (isShip()) return views.ShipPay();
    const q = quoteData;
    const addr = (a) => (a.street ? `${esc(a.street)}, ${esc(a.city)}` : '—');
    const sp = special();
    const date = avail && [...avail.days, ...avail.rush].find((d) => d.date === S.schedule.date);
    const siteRows = (label, a, goto) => (a && a.street ? `<div class="sum-row"><span>${label}</span><span>${addr(a)}<br><span class="muted">${esc(a.contactName)} · ${esc(formatPhone(a.contactPhone))}${a.sameAsMe ? (S.contact.clientType ? ` · ${esc(S.contact.clientType)}` : '') : a.contactRole ? ` · ${esc(a.contactRole === 'Other' ? (a.contactRoleOther || 'Other') : a.contactRole)}` : ''}</span> ${editBtn(goto)}</span></div>` : '');
    const payerCard = `<div class="card">${seg('payer', isBizReferral() ? [['me', 'Me'], ['partner', 'Referring partner'], ['other', 'Someone else']] : [['me', 'Me'], ['other', 'Someone else']])}
        ${S.payer === 'other' ? `<div class="row" style="margin-top:12px">${input('payerOther.name', 'Payer name', { req: true })}${input('payerOther.email', 'Payer email', { type: 'email', req: true, attrs: 'autocapitalize="off" autocomplete="email"' })}</div>
        ${input('payerOther.phone', 'Payer phone', { type: 'tel', req: true, ph: '(415) 555-0123', attrs: 'autocomplete="tel"' })}` : ''}
        ${S.payer === 'partner' && !(isBizReferral() && (S.heard.businessName || S.heard.referrerName || S.partner.name)) ? `<p class="mini">Add the referring partner in <button type="button" class="edit" style="padding:0" data-goto="1:heard">Where</button> so we know who to bill.</p>` : ''}</div>`;
    const payerName = S.payer === 'other' ? (S.payerOther.name || 'Someone else') : S.payer === 'partner' ? 'Referring partner' : 'Me';
    return panel('payer', `<h1>Who’s paying?</h1><p class="sub">Last question before your review.</p>${payerCard}`)
      + panel('review', `<h1>${sp ? 'Review your request' : 'Review & pay'}</h1><p class="sub">${sp ? 'CAD sets the final price before anything is charged.' : 'Your job is booked as soon as payment goes through. We’ll email your confirmation right away.'}</p>${valueConfirmCard('review')}
      ${promiseCard(crossRegionLine(quoteData && quoteData.regions) || (date && date.routeLabel) || (avail && avail.region ? avail.region + ' route' : 'Route day'), 'margin-top:0', '2:date')}
      <div class="card">
        <div class="sum-row"><span>Service</span><span>${esc(svc().label)}${S.rush ? ' · rush' : ''}${S.dedicated ? ' · dedicated trip' : ''} ${editBtn('0:service')}</span></div>
        ${reviewPieces()}
        ${svc().needsPickup ? siteRows('Pickup', S.pickup, '1:pickup-addr') : ''}
        ${siteRows(S.service === 'install_only' ? 'Install at' : 'Delivery', S.dropoff, '1:dropoff-addr')}
        <div class="sum-row"><span>Booked by</span><span>${esc(S.contact.name)}<br><span class="muted">${esc(S.contact.email)}</span> ${editBtn('1:you')}</span></div>
        <div class="sum-row"><span>Paying</span><span>${esc(payerName)} ${editBtn('3:payer')}</span></div>
      </div>
      ${svc().needsPickup ? siteReview('Pickup details', S.pickup, '1:pickup-access') : ''}
      ${siteReview(S.service === 'install_only' ? 'Installation details' : 'Delivery details', S.dropoff, '1:dropoff-access')}
      <h2>${sp ? 'Estimated range' : 'Price'}</h2>
      ${priceCard(q, true)}
      ${q && q.notes && q.notes.filter((n) => n !== CADAccess.PRICE_NOTE).length ? `<p class="mini">${q.notes.filter((n) => n !== CADAccess.PRICE_NOTE).map((n) => esc(n)).join(' ')}</p>` : ''}
      ${S.member && S.memberVerified ? `<p class="mini">Member rate (25% off) applied${S.memberCompany ? ` for ${esc(S.memberCompany)}` : ''}.</p>` : ''}
      ${sp ? '<div class="err" id="err"></div>' : `<h2>Payment</h2>${paymentBlock(q)}`}
      <p class="mini" data-protection-terms>${PROTECTION_TERMS}</p>
      <p class="mini">${sp ? 'Samantha reviews your request and emails your price with a payment link. Nothing is charged until you approve it.' : 'Need to change or cancel? Reply to your confirmation email.'}</p>`);
  },

  ShipPay() {
    const sh = S.shipping, d = S.dropoff;
    const declared = S.items.reduce((s, it) => s + num(it.value), 0);
    const payerName = S.payer === 'other' ? (S.payerOther.name || 'Someone else') : S.payer === 'partner' ? 'Referring partner' : 'Me';
    const payerCard = `<div class="card">${seg('payer', isBizReferral() ? [['me', 'Me'], ['partner', 'Referring partner'], ['other', 'Someone else']] : [['me', 'Me'], ['other', 'Someone else']])}
        ${S.payer === 'other' ? `<div class="row" style="margin-top:12px">${input('payerOther.name', 'Payer name', { req: true })}${input('payerOther.email', 'Payer email', { type: 'email', req: true, attrs: 'autocapitalize="off" autocomplete="email"' })}</div>
        ${input('payerOther.phone', 'Payer phone', { type: 'tel', req: true, ph: '(415) 555-0123', attrs: 'autocomplete="tel"' })}` : ''}
        ${S.payer === 'partner' && !(isBizReferral() && (S.heard.businessName || S.heard.referrerName || S.partner.name)) ? `<p class="mini">Add the referring partner in <button type="button" class="edit" style="padding:0" data-goto="1:heard">Where</button> so we know who to bill.</p>` : ''}</div>`;
    return panel('payer', `<h1>Who’s paying?</h1><p class="sub">Last question before your review.</p>${payerCard}`)
      + panel('review', `<h1>Review your shipping request</h1><p class="sub">Samantha prices shipping and emails you a quote. Nothing is charged until you approve it.</p>${valueConfirmCard('review')}
      ${outOfState() ? `<p class="note" data-oos>${OOS_NOTE}</p>` : ''}
      <div class="promise quote" style="margin-top:0"><span class="pi">✈</span><span><b>${esc(timingText(sh))}</b><span>${esc(levelText(sh.serviceLevel))}</span></span>${editBtn('2:ship-timing')}</div>
      <div class="card">
        <div class="sum-row"><span>Service</span><span>Shipping ${editBtn('0:service')}</span></div>
        ${reviewPieces()}
        <div class="sum-row"><span>Pickup</span><span>${destText(S.pickup)}<br><span class="muted">${esc([S.pickup.contactName, formatPhone(S.pickup.contactPhone)].filter(Boolean).join(' · '))}</span> ${editBtn('1:pickup-addr')}</span></div>
        <div class="sum-row"><span>Destination</span><span>${destText(d)}${d.locationType ? ` · ${esc(d.locationType)}` : ''}<br><span class="muted">${esc([d.contactName, formatPhone(d.contactPhone)].filter(Boolean).join(' · '))}</span> ${editBtn('1:dropoff-addr')}</span></div>
        ${intlDest(d) && (sh.customs.name || sh.customs.phone) ? `<div class="sum-row"><span>Customs contact</span><span>${esc([sh.customs.name, sh.customs.phone, sh.customs.email].filter(Boolean).join(' · '))}</span></div>` : ''}
        <div class="sum-row"><span>At destination</span><span>${esc(levelText(sh.serviceLevel))} ${editBtn('2:ship-level')}</span></div>
        <div class="sum-row"><span>Booked by</span><span>${esc(S.contact.name)}<br><span class="muted">${esc(S.contact.email)}</span> ${editBtn('1:you')}</span></div>
        <div class="sum-row"><span>Paying</span><span>${esc(payerName)} ${editBtn('3:payer')}</span></div>
      </div>
      ${siteReview('Pickup details', S.pickup, '1:pickup-access')}
      ${siteReview('Destination details', S.dropoff, '1:dropoff-access')}
      <h2>Price</h2><div class="card">
        <div class="sum-row"><span>Shipping</span><span>Custom quote</span></div>
        <div class="sum-row"><span>Insurance</span><span>Fully insured through our shipping partners</span></div>
        <p class="mini" style="margin:4px 0 0">Declared value: ${fmt(declared)}.</p>
        <p class="mini" style="margin:6px 0 0">Samantha sets the price for packing, shipping and destination service before anything is charged. Our shipping partner chooses the right packing for each piece.</p>
      </div>
      <div class="err" id="err"></div>`);
  },

  PayLink() {
    const o = existing, q = o.quote;
    return panel('review', `<h1>Pay to confirm</h1><p class="sub">${payCanceled ? 'Payment wasn’t completed. Your booking is saved; pay below to confirm it.' : o.approvedAt ? 'Your quote is approved. Your job is booked as soon as payment goes through.' : 'Pay below to confirm your booking.'}</p>
      <div class="promise" style="margin-top:0"><span class="pi">✓</span><span><b>${o.service === 'crating_shipping' ? esc(timingText(o.shipping || {})) : `${esc(longDate(o.schedule.date))}${o.schedule.deliveryDate ? ' · Delivery ' + esc(shortDate(o.schedule.deliveryDate)) : ''}`}</b><span>Order ${esc(o.id)}</span></span></div>
      <div class="card"><div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}${o.rush ? ' · rush' : ''}${o.dedicated ? ' · dedicated trip' : ''}</span></div>
        ${(o.items || []).map((i, n) => `<div class="sum-row"><span><b>${esc(pieceTitle0(i, n))}</b><br><span class="muted">${esc(TYPE_LABEL(i.type))}</span></span><span></span></div>`).join('')}</div>
      ${priceCard(q, false)}
      <h2>Payment</h2>${paymentBlock(q)}
      ${o.service === 'crating_shipping' ? '' : `<p class="mini" data-protection-terms>${PROTECTION_TERMS}</p>`}`);
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
        ${yourPieces(o)}
        <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
    }
    if (o.status === 'pending_approval') {
      const q = o.quote || quoteData;
      const rvw = !!(q && q.reviewOnly);
      return `<div class="done"><div class="check">✓</div><h1>${rvw ? 'Date request received' : 'Quote request received'}</h1>
        <p class="sub">Request <b>${esc(o.id)}</b> is with Samantha. ${rvw ? `${esc(q.quoteNote || '')} We’ll email ${esc(o.contact.email)} within 1 business day to confirm your date and send a payment link.` : `We’ll email ${esc(o.contact.email)} a final price and a payment link. Nothing has been charged.`}</p></div>
        <div class="card">
          <div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}${o.rush ? ' · rush' : ''}${o.dedicated ? ' · dedicated trip' : ''}</span></div>
          <div class="sum-row"><span>Preferred date</span><span>${esc(longDate(o.schedule.date))}${o.schedule.deliveryDate ? '<br>Delivery ' + esc(longDate(o.schedule.deliveryDate)) : ''}${timePrefSummary(o.schedule.timePref, o.schedule.timeNote) ? '<br><span class="muted">' + esc(timePrefSummary(o.schedule.timePref, o.schedule.timeNote)) + '</span>' : ''}</span></div>
          ${q.reviewOnly ? `<div class="sum-row"><span>Estimated price</span><span class="amt"><b>${fmt(q.total)}</b></span></div>` : q.tripPremium ? `<div class="sum-row"><span>Regular rate</span><span class="amt">${fmt(q.regularTotal || q.total)}</span></div>
          <div class="sum-row"><span>Estimated range</span><span class="amt"><b>${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}</b></span></div>` : '<div class="sum-row"><span>Price</span><span>Priced by CAD</span></div>'}
        </div>
        ${yourPieces(o)}
        <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
    }
    const p = o.payment || {};
    const ach = p.status === 'ach_processing';
    const how = p.method && p.method.includes('apple') ? 'Apple Pay' : p.method && p.method.includes('google') ? 'Google Pay' : p.method && p.method.includes('ach') ? 'Bank (ACH)' : 'Card';
    const shipDone = o.service === 'crating_shipping';
    const delLine = o.schedule.deliveryDate ? `<p class="sub" style="margin:-4px 0 10px"><strong>Delivery: ${esc(longDate(o.schedule.deliveryDate))}</strong>${timePrefSummary(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote) ? ' · ' + esc(timePrefSummary(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote)) : ''}</p>` : '';
    return `<div class="done"><div class="check">✓</div><h1>${shipDone ? 'Your shipment is confirmed.' : `You’re booked for ${esc(longDate(o.schedule.date))}.`}</h1>${delLine}
      <p class="sub">Order <b>${esc(o.id)}</b> is confirmed. A confirmation is on its way to ${esc(o.contact.email)}. ${shipDone ? 'Samantha will confirm packing and pickup dates by email.' : 'We’ll be in touch before your date to confirm the arrival window.'}</p></div>
      <div class="card"><div class="sum-row"><span>Service</span><span>${esc(o.serviceLabel)}</span></div>
      ${shipDone ? `<div class="sum-row"><span>Timing</span><span>${esc(timingText(o.shipping || {}))}</span></div><div class="sum-row"><span>Destination</span><span>${destText(o.dropoff)}</span></div>` : `<div class="sum-row"><span>Route</span><span>${esc(crossRegionLine((o.quote || {}).regions) || (regionName(((o.quote || {}).regions || {}).pickup || o.schedule.region) + ' route'))}</span></div>`}
      <div class="sum-row"><span>Payment</span><span>${ach ? `<b>ACH processing</b> · ${fmt(p.amount)}` : `Paid ${fmt(p.amount)}`} · ${how}${p.method && p.method.startsWith('mock') ? ' (test)' : ''}${p.saved ? ' · saved' : ''}</span></div>
      ${o.quote.paymentPlan === 'deposit' ? `<div class="sum-row"><span>Balance due ${esc(o.quote.balanceWhen)}</span><span class="amt"><b>${fmt(o.quote.balanceDue)}</b></span></div>` : ''}
      <div class="total"><span>${accessTbc(o.quote) ? CADAccess.TBC_TOTAL : 'Order total'}</span><span class="amt">${fmt(o.quote.total)}</span></div>
      ${accessTbc(o.quote) ? `<p class="mini access-tbc" data-access-tbc><b>${esc(CADAccess.PRICE_NOTE)}</b></p>` : ''}${feeNoteHtml(o.quote)}</div>
      ${ach ? '<p class="mini">Your job is confirmed. The bank transfer shows as processing until it clears.</p>' : ''}
      ${yourPieces(o)}
      <button type="button" class="btn ghost full" id="newOrder">Start a new booking</button>`;
  },
};

const siteReview = (title, a, goto) => {
  if (!a || !a.street) return '';
  const rows = [
    a.business && ['Business', esc(a.business)],
    a.hours && ['Access hours', esc(a.hours)],
    ['Access', accessText(a)],
    a.parkingRestricted && ['Parking / loading', esc(a.parkingNote || 'Restrictions')],
    a === S.dropoff && hasHanging() && ['Hanging', `${esc(a.wallType || 'Wall type not sure')} · hardware: ${esc(a.hardware || 'not sure')}${S.items.map((it, i) => isHung(it) ? '<br>' + esc(hangSummary(it, i)) : '').join('')}`],
    a.notes && ['Notes', esc(a.notes)],
  ].filter(Boolean);
  return `<h2>${esc(title)}${goto ? ' ' + editBtn(goto) : ''}</h2><div class="card">${rows.map(([k, v]) => `<div class="sum-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
};

// ---------- validation + required-field guidance ----------
const filled = (a) => a && String(a.street || '').trim() && String(a.city || '').trim();
const hasContact = (a) => String(a.contactName || '').trim() && String(a.contactPhone || '').trim();
const siteReady = (a, required) => (required ? filled(a) && hasContact(a) : !filled(a) || hasContact(a));
const contactReady = () => S.contact.name.trim() && /\S+@\S+\.\S+/.test(S.contact.email) && String(S.contact.phone || '').replace(/\D/g, '').length >= 7;

const needsDims = (it) => !['custom', 'furniture'].includes(it.type || 'painting') || shipService();
const dimsOk = (it) => ['w', 'h', 'd'].every((k) => Number(it[k]) > 0);
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
    if (needsDims(it)) { const miss = ['w', 'h', 'd'].find((k) => !(Number(it[k]) > 0)); if (miss) add(`#f-items.${i}.${miss}`, `Size — ${p}`, 'Please enter the width, height and depth in inches.'); }
    if (FRAMING_TYPES.includes(it.type || 'painting')) {
      if (it.framed !== 'yes' && it.framed !== 'no') add(`[data-framing="${i}"]`, `Framed? — ${p}`, 'Please tell us if this piece is framed.');
      else if (needsGlass(it) && !['yes', 'no'].includes(it.glazing)) add(`[data-glass="${i}"]`, `Glass — ${p}`, 'Please tell us if this piece has a glass front.');
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
    if (!/\S+@\S+\.\S+/.test(S.contact.email || '')) add('#f-contact.email', 'Email', 'Please enter a valid email address.');
    if (String(S.contact.phone || '').replace(/\D/g, '').length < 7) add('#f-contact.phone', 'Mobile', 'Please enter a mobile number.');
    if (!String(S.contact.clientType || '').trim()) add('#f-contact.clientType', 'I am a…', 'Please choose one.');
    if (S.member) {
      if (!String(S.memberCode || '').trim()) add('#f-memberCode', 'Member code', 'Please enter your member code.');
      else if (!S.memberVerified) add('#f-memberCode', 'Member code', S.memberError || 'Please enter a valid member code.');
    }
    if (!(S.heard && S.heard.repeatClient)) {
      if (!S.heard || !S.heard.source) add('#f-heard.source', 'How did you hear about us?', 'Please tell us how you heard about CAD.');
      else if (S.heard.source === 'other' && !String(S.heard.sourceOther || '').trim()) add('#f-heard.sourceOther', 'Tell us where', 'Please tell us where you heard about us.');
      else if (S.heard.source === 'referral' && !S.heard.referrerKind) add('#f-heard.referrerKind', 'Who referred you?', 'Please tell us who referred you.');
    }
    const siteMiss = (key, title, required) => {
      const a = S[key] || {};
      if (!required && !filled(a)) return;
      if (key === 'dropoff' && shipService() && !String(a.country || '').trim()) add('#f-dropoff.country', 'Country', 'Please enter the country.');
      if (!String(a.street || '').trim()) add(`#f-${key}.street`, `Street address — ${title}`, `Please enter the ${title.toLowerCase()} street address.`);
      if (!String(a.city || '').trim()) add(`#f-${key}.city`, `City — ${title}`, `Please enter the ${title.toLowerCase()} city.`);
      if (!String(a.contactName || '').trim()) add(`#f-${key}.contactName`, `On-site name — ${title}`, 'Please enter the on-site contact’s name.');
      if (!String(a.contactPhone || '').trim()) add(`#f-${key}.contactPhone`, `On-site mobile — ${title}`, 'Please enter the on-site contact’s mobile number.');
      if (a.sameAsMe) { /* role = the booker's own "I am a…" (required above); no role field */ }
      else if (!String(a.contactRole || '').trim()) add(`#f-${key}.contactRole`, roleLabel(key), 'Please choose the contact’s role.');
      else if (a.contactRole === 'Other' && !String(a.contactRoleOther || '').trim()) add(`#f-${key}.contactRoleOther`, 'Describe their role', 'Please describe the contact’s role.');
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
        if (!hangPhotosOk(it)) add(`[data-hangupload="${i}"]`, `Photos of the stairwell — ${p}`, 'Please add a photo of the stairwell.');
      });
    }
    ['pickup', 'dropoff'].forEach((key) => {
      const a = S[key] || {};
      if (key === 'pickup' && !svc().needsPickup) return;
      const where = key === 'pickup' ? 'Pickup' : shipService() ? 'Destination' : S.service === 'install_only' ? 'Installation' : 'Delivery';
      const ACCESS_GAP = {
        accessMode: [`[data-seg="${key}.accessMode"]`, 'How do we get in?', 'Please tell us how we get in.'],
        stairFlights: [`[data-seg="${key}.stairFlights"]`, 'How many flights?', 'Please choose how many flights of stairs.'],
        stairs: [`#f-${key}.stairs`, 'Total number of flights', 'Enter the total number of flights (4 or more).'],
        elevatorStairs: [`[data-seg="${key}.elevatorStairs"]`, 'Any stairs on the way?', 'Please tell us if there are stairs on the way to the elevator.'],
        stairDir: [`[data-seg="${key}.stairDir"]`, 'Up or down?', 'Please tell us if the stairs go up or down.'],
        stairTurns: [`[data-seg="${key}.stairTurns"]`, 'Tight turns or narrow spots?', 'Please tell us about tight turns or narrow spots.'],
        stairPhotos: [`[data-accessupload="${key}.stairPhotos"]`, 'Photos of the stairs and path', 'Please add a photo of the stairs and path.'],
        floor: [`#f-${key}.floor`, 'Floor', 'Please enter the floor.'],
        fits: [`[data-seg="${key}.fits"]`, 'Will everything fit easily?', 'Please tell us if everything will fit easily.'],
        doorPhotos: [`[data-accessupload="${key}.doorPhotos"]`, 'Photos of the tight spot', 'Please add a photo of the tight spot and the way in.'],
      };
      CADAccess.gaps(a, S.items).forEach((g) => { const [sel, label, msg] = ACCESS_GAP[g]; add(sel, `${label} — ${where}`, msg); });
    });
    S.items.forEach((it, i) => {
      if (pieceNeedsStairwellFit(it) && !it.fitsStairwell) add(`[data-reqblock="stairwellFit-${i}"]`, `Stairwell fit — ${pieceName(i)}`, 'Please confirm this piece will fit through the stairwell.');
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
    if (!S.schedule.date) add('[data-reqblock="date"]', needsTwoDates() ? 'Pickup date' : 'Date', needsTwoDates() ? 'Please pick a pickup date.' : 'Please pick a date.');
    if (needsTwoDates() && S.schedule.date && !(S.schedule.deliveryDate && S.schedule.deliveryDate >= S.schedule.date)) add('[data-reqblock="deldate"]', 'Delivery date', 'Please pick a delivery date.');
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
    if (S.payer === 'partner' && !(isBizReferral() && (S.heard.businessName || S.heard.referrerName || S.partner.name))) add('[data-goto="1:heard"]', 'Referring partner', 'Please add the referring partner in Where so we know who to bill.');
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
  if (!S.service && !existing) { el.textContent = '—'; lbl.textContent = 'Estimate'; return; }
  if ((!existing && isShip()) || (q && q.shipping && !q.approvedPrice)) { el.textContent = 'Quote'; lbl.textContent = 'Shipping'; paintButton(); return; }
  if (!q) return;
  if (q.reviewOnly) { el.textContent = fmt(q.total); lbl.textContent = 'Estimate · date to be confirmed'; }
  else if (isQuote(q) && !q.tripPremium) { el.textContent = 'Quote'; lbl.textContent = 'Priced by CAD'; }
  else if (isQuote(q) && q.quoteRange) { el.textContent = `${fmt(q.quoteRange.low)}–${fmt(q.quoteRange.high)}`; lbl.textContent = 'Estimated range'; }
  else if (name === 'Pay') { el.textContent = fmt(q.dueNow); lbl.textContent = accessTbc(q) ? 'Estimate · access to confirm' : q.paymentPlan === 'deposit' ? 'Due today (50%)' : 'Due today'; }
  else { el.textContent = fmt(q.total); lbl.textContent = name === 'What' ? 'Estimate · before access' : accessTbc(q) ? 'Estimate · access to confirm' : 'Estimate'; }
  el.classList.toggle('long', el.textContent.length > 9 && el.textContent.length <= 13); el.classList.toggle('xlong', el.textContent.length > 13);
  // The bar's price includes the required protection charge: say so under it.
  const pn = $('#estNote'); if (pn) { const on = !!(q.protection && q.protection.amount > 0 && !isQuote(q)); pn.hidden = !on; pn.textContent = on ? PROTECTION_DOCK : ''; }
  // Refresh the value hints on the pieces step once the live quote is in.
  if (name === 'What') S.items.forEach((_, i) => updateItemHints(i));
  paintButton();
}
function refreshQuote() {
  if (existing) { paintEstimate(); return; }
  clearTimeout(qTimer);
  if (S.service) { quotePending = true; const lb = $('#estLabel'); if (lb && STEPS[step] !== 'Done') lb.textContent = 'Updating estimate…'; updateNext(); }
  qTimer = setTimeout(async () => {
    if (!S.service) { quotePending = false; paintEstimate(); return; }
    const seq = ++qSeq;
    const { ok, j } = await api('/api/quote', payload());
    if (seq !== qSeq) return;
    quotePending = false;
    if (!ok) { paintEstimate(); updateNext(); return; }
    quoteData = j; paintEstimate(); updateNext();
    if (STEPS[step] === 'Pay' && !isShip()) { const pc = document.querySelector('[data-price]'); if (pc) pc.outerHTML = `<div data-price>${priceCard(quoteData, true)}</div>`; }
  }, 120);
}
// Description step only: the Next label names the following screen so people don't type size into the description.
// One piece per p{i}a panel today; if that panel ever listed several pieces, use the generic "sizes" / "values" wording.
function nextLabelsForStep() {
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
    if (existing || !special()) btn.textContent = CFG.stripe ? `Pay ${payWhat}${q ? fmt(q.dueNow) : ''} on Stripe` : `Pay ${payWhat}${q ? fmt(q.dueNow) : ''}`;
    else btn.textContent = isShip() ? 'Request quote' : S.rush ? 'Request a rush quote' : (quoteData && quoteData.reviewOnly) ? 'Request this date' : 'Request a quote';
    btn.classList.remove('next-desc');
  } else applyNextLabel(btn);
  const wait = missingNow().length > 0;
  const hold = busy || (quotePending && name === 'Pay' && isLastPanel());
  if (hold) { btn.disabled = true; btn.classList.remove('is-wait'); btn.removeAttribute('aria-disabled'); }
  else { btn.disabled = false; btn.classList.toggle('is-wait', wait); if (wait) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled'); }
  paintRequired();
}

// ---------- render ----------
let lastStep = -1, lastSub = null, poppingStep = false;
const applyPanel = () => panelEls().forEach((p) => { p.hidden = p.dataset.panel !== sub; });
function render() {
  if ((S.items || []).some(routeDecorMirror)) persist();
  const name = STEPS[step];
  // Done: forget the draft so a refresh or Continue can't book (or charge) the same job twice; a refresh shows this order again.
  if (name === 'Done' && confirmed) { sessionStorage.removeItem('cad-order'); sessionStorage.removeItem('cad-step'); sessionStorage.removeItem('cad-sub'); }
  else if (name !== 'Done') sessionStorage.setItem('cad-step', String(step));
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
  if (name !== 'Done') sessionStorage.setItem('cad-sub', sub);
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
  // A slim progress bar (no step count): where this screen sits in the whole booking.
  const pIds = panelIds();
  const pIdx = Math.max(0, pIds.indexOf(sub)), pLen = Math.max(1, pIds.length);
  const pct = name === 'Done' ? 100 : Math.max(5, Math.min(100, Math.round(((Math.min(step, 3) + (pIdx + 1) / pLen) / 4) * 100)));
  const bar = $('#progress i'); if (bar) bar.style.width = pct + '%';
  const pg = $('#progress'); if (pg) pg.setAttribute('aria-valuenow', String(pct));
  $('#stepsLabel').textContent = name === 'Done' ? (confirmed && confirmed.status === 'pending_approval' ? 'Quote requested' : 'Confirmed') : '';
  $('#backBtn').classList.toggle('hide', (step === 0 && isFirstPanel()) || name === 'Done' || !!existing);
  const noDock = name === 'Done';
  $('#dock').classList.toggle('hide', noDock);
  app.classList.toggle('no-dock', noDock);
  paintButton();
  refreshQuote();
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
  const h2s = [...app.querySelectorAll('h2')].filter((h) => /^(Price|Estimated range)$/.test(h.textContent));
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

let memberTimer, memberCheckSeq = 0;
function paintMemberStatus() {
  const field = document.getElementById('f-memberCode');
  const wrap = field && field.closest('.field');
  if (!wrap) { updateNext(); return; }
  let ok = wrap.querySelector('.member-ok');
  if (S.member && S.memberVerified && S.memberCompany) {
    if (!ok) { ok = document.createElement('p'); ok.className = 'mini member-ok'; wrap.appendChild(ok); }
    ok.textContent = 'Member rate applied for ' + S.memberCompany + '.';
  } else if (ok) ok.remove();
  updateNext();
}
async function checkMemberCode() {
  if (!S.member) { S.memberVerified = false; S.memberCompany = ''; S.memberError = ''; persist(); paintMemberStatus(); refreshQuote(); return; }
  const code = String(S.memberCode || '').trim();
  if (!code) { S.memberVerified = false; S.memberCompany = ''; S.memberError = ''; persist(); paintMemberStatus(); refreshQuote(); return; }
  const seq = ++memberCheckSeq;
  const { ok, j } = await api('/api/member-code', { code });
  if (seq !== memberCheckSeq) return;
  if (ok && j && j.valid) {
    S.memberVerified = true;
    S.memberCompany = j.company || '';
    S.memberError = '';
    if (j.code) S.memberCode = j.code;
    const el = document.getElementById('f-memberCode');
    if (el && j.code) el.value = j.code;
  } else {
    S.memberVerified = false;
    S.memberCompany = '';
    S.memberError = 'We couldn’t find that member code. Please check it and try again.';
  }
  persist();
  paintMemberStatus();
  refreshQuote();
}

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
  if (p === 'contact.name' || p === 'contact.phone') syncSameAsMe();
  if (p === 'memberCode') {
    S.memberVerified = false; S.memberCompany = ''; S.memberError = ''; persist();
    clearTimeout(memberTimer); memberTimer = setTimeout(checkMemberCode, 350);
  }
  if (p === 'member') {
    if (!S.member) S.memberVerified = false;
    else if (S.memberCode) setTimeout(checkMemberCode, 0);
  }
  const m = p.match(/^(pickup|dropoff)\.contact(Name|Phone)$/);
  if (m && S[m[1]].sameAsMe) { S[m[1]].sameAsMe = false; persist(); const b = app.querySelector(`[data-same="${m[1]}"]`); if (b) { b.classList.remove('on'); b.textContent = 'Same as me'; } const rw = app.querySelector(`[data-rolewrap="${m[1]}"]`); if (rw) rw.hidden = false; paintButton(); }
  const hint = p.match(/^items\.(\d+)\.(weight|value)$/);
  if (hint && hint[2] === 'value' && S.items[+hint[1]] && S.items[+hint[1]].checkValue) { S.items[+hint[1]].checkValue = false; persist(); { const pid = S.items[+hint[1]].id; app.querySelectorAll(`[data-checkvalnote="${pid}"], [data-piece-id="${pid}"] [data-checkvalue]`).forEach((el) => el.remove()); } }
  if (hint) updateItemHints(+hint[1]);
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
  else if (/^(pickup|dropoff)\.(state|zip|city)$/.test(e.target.dataset.path || '')) syncOosNote();
});
function syncOosNote() {
  if (STEPS[step] !== 'Where') return;
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
  const t = e.target.closest('button'); if (!t) return;
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
    if (S.service === 'crating_shipping') { S.crating = false; S.rush = false; S.dedicated = false; }
    if (S.service === 'install_only') { S.crating = false; S.schedule.deliveryLater = false; }
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
    if (ix >= 0 && S.items.length > 1) { const gone = pieceTitle0(S.items[ix], ix); S.items.splice(ix, 1); persist(); sub = 'pieces-more'; render(); uploadToast(`${gone} removed. The price is updated.`); } else render();
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
    if (a.sameAsMe) applySameAsMe(t.dataset.same);
    persist(); render(); return;
  }
  if (t.dataset.goto != null) {
    // "1:pickup-addr" = Where, Pickup address. From the final review, the next Next brings them straight back to it.
    const [gs, gp] = String(t.dataset.goto).split(':');
    if (STEPS[step] === 'Pay' && !existing) returnToReview = true;
    returnToList = +gs === 0 && STEPS[step] === 'What' && sub === 'pieces-more' && /^p\d+a$/.test(gp || '');
    step = +gs; sub = gp || ''; render(); return;
  }
  if (t.dataset.wallet) return pay(CFG.stripe ? 'stripe' : t.dataset.wallet);
  const sg = t.closest('[data-seg]'); const hp = sg && sg.dataset.seg.match(/^items\.(\d+)\.hangPick$/);
  if (hp) { const it = S.items[+hp[1]]; const v = t.dataset.v; if (v === 'standard') { it.hangHeight = 'standard'; it.hangWhere = ''; } else { it.hangHeight = 'higher'; it.hangWhere = v; } set(sg.dataset.seg, v); render(); return; }
  const acc = sg && sg.dataset.seg.match(/^(pickup|dropoff)\.(accessMode|stairFlights|stairDir|stairTurns|serviceElevator|dock|elevatorStairs|doorway|fits)$/);
  if (acc) { setAccessAnswer(acc[1], sg.dataset.seg, t.dataset.v); render(); return; }
  if (sg) { const v = t.dataset.v; set(sg.dataset.seg, isNaN(v) ? v : Number(v)); render(); return; }
  const paySeg = t.closest('[data-pay-method]'); if (paySeg) { payMethod = t.dataset.v; render(); return; }
  const chips = t.closest('[data-chips]'); if (chips) { set(chips.dataset.chips, t.dataset.v); render(); return; }
  if (t.dataset.moredays) { moreDays[t.dataset.moredays] = true; render(); return; }
  if (t.dataset.date) {
    const changed = S.schedule.date !== t.dataset.date;
    S.schedule.date = t.dataset.date; S.rush = !!t.dataset.rush;
    if (changed) { S.schedule.deliveryDate = ''; delAvail = null; }
    persist(); render();
    if (needsTwoDates()) loadDelivery();
    return;
  }
  if (t.dataset.changePickup != null) {
    sub = 'date'; render();
    return;
  }
  if (t.dataset.level) { S.shipping.serviceLevel = t.dataset.level; persist(); render(); return; }
  if (t.dataset.deldate) { S.schedule.deliveryDate = t.dataset.deldate; persist(); render(); return; }
  if (t.id === 'newOrder') { sessionStorage.clear(); location.href = '/'; }
});

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
      if (r.pending) { confirmed = r.pending; sessionStorage.setItem('cad-done', confirmed.id); step = STEPS.indexOf('Done'); render(); return; }
    }
    const id = existing ? existing.id : orderId;
    const body = { method, card: $('#card')?.value, routing: $('#routing')?.value, account: $('#account')?.value, save: !!($('#saveMethod') && $('#saveMethod').checked) };
    const { ok, j } = await api(`/api/orders/${id}/pay`, body);
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

let returnToReview = false;
// Edit or "fix" on one piece from the list: after that piece's last screen, Next goes back to the list, not on to the next piece.
let returnToList = false;
// After Edit on the final review: check the booking is still complete and go straight back to the review.
async function backToReview() {
  busy = true; updateNext();
  try {
    if (!isShip() && S.service) {
      const r = await api('/api/availability', payload());
      if (r.ok && r.j && r.j.days) {
        avail = r.j;
        if (S.schedule.date && ![...avail.days, ...avail.rush].some((d) => d.date === S.schedule.date)) { S.schedule.date = ''; S.rush = false; S.schedule.deliveryDate = ''; persist(); }
        if (needsTwoDates() && S.schedule.date) await loadDelivery();
      }
    }
  } finally { busy = false; }
  for (const n of ['What', 'Where', 'When']) {
    if (n === 'When' && !isShip() && !avail) continue;
    if (missingFields(n).length) { step = STEPS.indexOf(n); sub = '__missing'; render(); return; }
  }
  returnToReview = false;
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
  if (name === 'Pay') return pay(CFG.stripe ? 'stripe' : payMethod);
  if (name === 'Where' && isShip()) { step++; sub = ''; render(); return; }
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
  step++; sub = ''; render();
  if (STEPS[step] === 'When' && needsTwoDates() && S.schedule.date) loadDelivery();
}
$('#nextBtn').addEventListener('click', goNext);
// Enter = Next (never on the payment screen, so a stray Enter can't charge anyone; never inside a text box that needs line breaks).
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
  const t = e.target;
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
    const saved = Math.min(Math.max(0, parseInt(sessionStorage.getItem('cad-step'), 10) || 0), STEPS.indexOf('Pay'));
    if (saved >= STEPS.indexOf('When') && !isShip()) {
      const r = await api('/api/availability', payload());
      avail = r.ok ? r.j : null;
      if (avail && S.schedule.date) await loadDelivery();
    }
    step = saved;
    if (step >= STEPS.indexOf('When') && !isShip() && !(avail && avail.days)) step = STEPS.indexOf('Where');
    if (step === STEPS.indexOf('Pay') && !isShip() && !S.schedule.date) step = STEPS.indexOf('When');
    // Same screen they were on, unless the step had to move.
    sub = step === saved ? (sessionStorage.getItem('cad-sub') || '') : '__last';
  }
  render();
  if (S.member && S.memberCode) checkMemberCode();
})();
