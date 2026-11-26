(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const num = (v) => { const n = Number(String(v ?? '').replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : 0; };

let CFG = null;
const S = {
  placedBy: '', placedOther: '', pickup: 'salinas', items: [], courtesy: false, staffOpen: false, payOpen: false, unlocked: false, pin: '', pinFor: '', pinVal: '', puMore: false, deMore: false, undo: null, staffMsg: '', staffVal: '', puFrom: '', deFrom: '',
  payer: 'client', card: '', exp: '', cvc: '', payError: '', quoteBusy: false,
  pickupDate: '', deliveryDate: '', puDays: [], deDays: [], quote: null, submitting: false, errors: [], showErrors: false,
  dedicatedPickup: false, dedicatedDelivery: false, customDate: false, customDateNote: '', dedicatedBlocked: null,
};
let uid = 1, cat = 'All', quoteTok = 0, availTok = 0, qTimer = 0, aTimer = 0, availPending = false;

const ACC = () => new Set(CFG.kinds.accents);
const isMirror = (kind) => kind === 'Mirror';
const client2 = () => {
  if ($('#client2').hidden) return null;
  const c = { name: $('#c2Name').value.trim(), phone: $('#c2Phone').value.trim(), email: $('#c2Email').value.trim() };
  return c.name || c.phone || c.email ? c : null;
};
const delivery = () => ({
  name: $('#dName').value.trim(), phone: $('#dPhone').value.trim(), email: $('#dEmail').value.trim(), street: $('#dStreet').value.trim(),
  unit: $('#dUnit').value.trim(), city: $('#dCity').value.trim(), state: ($('#dState').value.trim() || 'CA').toUpperCase(), zip: $('#dZip').value.trim(), notes: $('#dNotes').value.trim(), client2: client2(),
});
const access = () => ({ shape: $('#aShape').value, tight: $('#aTight').value, mode: $('#aMode').value, flights: $('#aFlights').value, flightsCount: $('#aFlightsN').value.trim(), floor: $('#aFloor').value.trim(), elevatorType: $('#aElevType').value, elevatorReserve: $('#aElevRes').checked, elevSteps: $('#aElevSteps').value, elevStepsN: $('#aElevStepsN').value.trim(), hours: $('#aHours').value.trim() });
const outOfState = () => { const d = delivery(); const z = parseInt(d.zip.slice(0, 3), 10); return (d.state && d.state !== 'CA') || (/^\d{5}/.test(d.zip) && !(z >= 900 && z <= 961)); };
const payload = (payMode = 'now') => ({
  payer: S.payer, payMode,
  placedBy: { name: S.placedBy, other: S.placedOther }, pickupLocation: S.pickup, courtesy: S.courtesy, ...(S.unlocked ? { pin: S.pin } : {}),
  items: S.items.map((i) => ({ name: i.name, kind: i.kind, qty: i.qty, catalogId: i.catalogId, custom: !!i.custom, w: i.w, h: i.h, value: i.value, ...(i.custom ? { d: i.d, weight: i.weight, weightUnsure: !!i.weightUnsure, photos: i.photos || [], photoLater: !!i.photoLater } : {}) })),
  delivery: delivery(), access: needsDeliveryAccess() ? access() : { mode: 'ground', hours: ($('#aHours') && $('#aHours').value.trim()) || '' },
  dedicatedPickup: !!S.dedicatedPickup, dedicatedDelivery: !!S.dedicatedDelivery, customDate: !!S.customDate,
  schedule: { date: S.pickupDate, deliveryDate: S.deliveryDate, customDateNote: S.customDateNote },
});
async function api(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (_) { /* ignore */ }
  return { ok: r.ok, j };
}

/* ---------- catalog ---------- */
function renderCats() {
  const groups = ['All', ...[...new Set(CFG.catalog.map((c) => c.group))]];
  $('#cats').innerHTML = groups.map((g) => `<button type="button" class="chip ${g === cat ? 'on' : ''}" data-cat="${esc(g)}" role="tab" aria-selected="${g === cat}">${esc(g)}</button>`).join('');
}
function renderCatalog() {
  const q = $('#search').value.trim().toLowerCase();
  const list = CFG.catalog.filter((c) => (cat === 'All' || c.group === cat) && (!q || (c.name + ' ' + c.kind + ' ' + c.group).toLowerCase().includes(q)));
  const added = (c) => S.items.find((i) => i.catalogId === (c.id || c.name));
  $('#catalog').innerHTML = list.length ? list.map((c) => {
    const a = added(c);
    return `<button type="button" class="pcard" data-add="${esc(c.id || c.name)}" aria-label="Add ${esc(c.name)}, ${esc(c.dims || c.kind)}">
      <div class="th">${c.id ? `<img src="/palomas/thumbs/${esc(c.id)}.jpg" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('◇'))">` : '◇'}</div>
      <div class="pt"><b>${esc(c.name)}</b><span>${esc(c.kind)}${c.dims ? ' · ' + esc(c.dims) : ''}</span></div>${a ? `<i class="added">× ${a.qty}</i>` : ''}</button>`;
  }).join('') : `<div class="none">No match. Use “Add a custom item” below.</div>`;
  $('#catalogNote').textContent = `${CFG.catalog.length} pieces from palomascarmel.com. Don't see it? Add a custom item.`;
}
function addFromCatalog(key) {
  const c = CFG.catalog.find((x) => (x.id || x.name) === key); if (!c) return;
  S.undo = null;
  const ex = S.items.find((i) => i.catalogId === key);
  if (ex) ex.qty = Math.min(99, ex.qty + 1);
  else S.items.push({ uid: uid++, name: c.name, kind: c.kind, qty: 1, catalogId: key, thumb: c.id || '', dims: c.dims, w: '', h: '' });
  itemsChanged(true);
}
function renderItems() {
  const box = $('#items');
  $('#itemCount').textContent = S.items.length ? `(${S.items.reduce((s, i) => s + i.qty, 0)})` : '';
  const undoBar = S.undo ? `<div class="undo" role="status"><span>Removed “${esc(S.undo.item.name)}”.</span> <button type="button" class="undo-btn" data-undo="1">Undo</button></div>` : '';
  if (!S.items.length) { box.innerHTML = `${undoBar}<p class="empty">Nothing added yet. Tap a piece above.</p>`; return; }
  box.innerHTML = undoBar + S.items.map((i) => {
    return `<div class="irow" data-uid="${i.uid}">
      <div class="th">${i.thumb ? `<img src="/palomas/thumbs/${esc(i.thumb)}.jpg" alt="" onerror="this.replaceWith(document.createTextNode('◇'))">` : '◇'}</div>
      <div><div class="nm">${esc(i.name)}</div><div class="ty">${esc(i.kind)}${i.dims ? ' · ' + esc(i.dims) : ''}${i.custom ? ' · custom' : ''}</div>
        <div class="ctl">
          <div><span class="lbl">Qty</span><div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><input data-f="qty" value="${i.qty}" inputmode="numeric" aria-label="Quantity"><button type="button" data-q="1" aria-label="More">+</button></div></div>
        </div>
        ${i.custom ? `<div class="cspec">${[i.w && i.d && i.h ? `<b>${esc(i.w)} × ${esc(i.d)} × ${esc(i.h)} in</b>` : '', i.weightUnsure ? 'weight not sure' : i.weight ? `<b>~${esc(i.weight)} lb</b>` : '', (i.photos || []).length ? `${i.photos.length} photo${i.photos.length > 1 ? 's' : ''}` : i.photoLater ? 'photo to follow' : ''].filter(Boolean).join(' · ')}</div>` : ''}
        ${isMirror(i.kind) && !i.custom ? `<div class="dims">Face size, optional: <input data-f="w" value="${esc(i.w)}" inputmode="numeric" placeholder="W"> × <input data-f="h" value="${esc(i.h)}" inputmode="numeric" placeholder="H"> in</div>` : ''}
        <div class="dims">Declared value $ <input data-f="value" value="${esc(i.value || '')}" inputmode="decimal" placeholder="e.g. 2500" aria-label="Declared value for ${esc(i.name)}"></div>
        <p class="info-note" data-valhint>Declared value protection (1.5%) is included on pieces of $50,000 or less.</p>
        ${i.custom && i.weightUnsure ? `<p class="mini">Price may be adjusted once the actual weight is confirmed; we’ll get your approval before charging any additional fees.</p>` : ''}
        ${isMirror(i.kind) ? `<p class="mini">Mirrors and works on panel are often heavier than they look.</p>` : ''}
        <div class="rmrow"><button type="button" class="rm" data-rm="1" aria-label="Remove ${esc(i.name)}"><span aria-hidden="true">✕</span> Remove</button></div>
      </div></div>`;
  }).join('');
}
function itemsChanged(rerenderRows) {
  if (rerenderRows) renderItems();
  renderCatalog();
  tidyAccessIfSkipped();
  scheduleQuote(); scheduleAvail();
}

/* ---------- pricing + summary ---------- */
function scheduleQuote() { clearTimeout(qTimer); if (S.items.length && !S.quoteBusy) { S.quoteBusy = true; renderSummary(); } else S.quoteBusy = S.items.length ? true : false; qTimer = setTimeout(runQuote, 180); }
async function runQuote() {
  const tok = ++quoteTok;
  if (!S.items.length) { S.quote = null; S.quoteBusy = false; renderSummary(); return; }
  const { ok, j } = await api('/api/palomas/quote', payload());
  if (tok !== quoteTok) return;
  S.quote = ok ? j : null; S.quoteBusy = false; renderSummary(); renderDatesVisibility(); syncStairsQ();
}
function problems() {
  const out = [];
  const add = (msg, sel, ask) => out.push({ msg, sel, ask: ask || `Please fill in: ${msg}.` });
  const q = S.quote || {};
  if (!S.placedBy) add('Choose who is placing the order', '#placedBy', 'Please choose who is placing the order.');
  else if (S.placedBy === 'Other' && !S.placedOther.trim()) add('Type the name of who is placing the order', '#placedOther', 'Please type your name.');
  if (!S.items.length) add('Add at least one item', '#sec-items', 'Please add at least one item.');
  S.items.forEach((i) => { if (!(num(i.value) > 0)) add('Declared value for ' + (i.name || 'item'), `[data-uid="${i.uid}"] [data-f="value"]`, 'Please enter a declared value.'); });
  const d = delivery();
  if (!d.name) add('Client name', '#dName', 'Please enter the client’s name.');
  if (d.phone.replace(/\D/g, '').length < 7) add('Client phone', '#dPhone', 'Please enter the client’s phone number.');
  { const em = (window.CADValidate && CADValidate.emailProblem) ? CADValidate.emailProblem(d.email) : (!/\S+@\S+\.\S+/.test(d.email) ? 'Please enter a valid email address.' : null); if (em) add('Client email', '#dEmail', em); }
  const c2 = d.client2;
  if (c2) {
    if (!c2.name) add('Second client name', '#c2Name', 'Please enter the second client’s name.');
    if (!c2.phone && !c2.email) add('Second client phone or email', '#c2Phone', 'Please add a phone or email for the second client.');
    else if (c2.phone && c2.phone.replace(/\D/g, '').length < 7) add('Second client phone', '#c2Phone', 'Please enter a full phone number.');
    else if (c2.email && !/\S+@\S+\.\S+/.test(c2.email)) add('Second client email', '#c2Email', 'Please enter a valid email address.');
  }
  if (!d.street) add('Delivery street address', '#dStreet', 'Please enter the street address.');
  if (!d.city) add('City', '#dCity', 'Please enter the city.');
  if (!/^\d{5}(-\d{4})?$/.test(d.zip)) add('ZIP code', '#dZip', 'Please enter a 5-digit ZIP code.');
  if (window.CADZones && d.city && d.zip) { const c = CADZones.routeConflict({ city: d.city, state: d.state || 'CA', zip: d.zip }); if (c) add('City and ZIP', '#dZip', c.message); }
  if (needsDeliveryAccess()) {
    const a = access();
    if (needsPathAccess() && !a.mode) add('How we get in at delivery', '#aMode', 'Please tell us how we get in.');
    if (a.mode === 'stairs' && !a.flights) add('Flights of stairs', '#aFlights', 'Please choose how many flights of stairs.');
    if (a.mode === 'stairs' && a.flights === '4plus' && !(parseInt(a.flightsCount, 10) >= 4)) add('How many flights (4 or more)', '#aFlightsN', 'Please enter the number of flights (4 or more).');
    if (a.mode === 'stairs' && a.flights && needsDoorwayAccess()) { if (!a.shape) add('Are the stairs straight or do they turn', '#aShape', 'Please tell us if the stairs are straight or turn.'); if (!a.tight) add('Any tight turns or narrow doorways', '#aTight', 'Please tell us about tight turns or narrow doorways.'); }
    if (a.mode === 'elevator' && !a.floor) add('Elevator floor', '#aFloor', 'Please enter the floor.');
    if (a.mode === 'elevator' && !a.elevatorType) add('Which elevator (freight or passenger)', '#aElevType', 'Please choose which elevator.');
    if (a.mode === 'elevator' && !a.elevSteps) add('Any steps before or after the elevator', '#aElevSteps', 'Please tell us if there are steps before or after the elevator.');
    if (a.mode === 'elevator' && a.elevSteps === 'yes' && !(parseInt(a.elevStepsN, 10) >= 1)) add('How many steps', '#aElevStepsN', 'Please enter how many steps.');
  }
  if (!q.special && !outOfState() && /^\d{5}/.test(d.zip)) {
    if (S.customDate) {
      if (!String(S.customDateNote || '').trim()) add('Which dates would work', '#customDateNote', 'Please tell us which dates would work.');
    } else {
      const puErr = S.dedicatedPickup ? dedDateProblem(S.pickupDate, 'pickup') : '';
      const deErr = S.dedicatedDelivery ? dedDateProblem(S.deliveryDate, 'delivery') : '';
      if (S.dedicatedPickup && !S.pickupDate) add('Dedicated pickup date', '#ded-pu-date', 'Please pick a pickup date for the dedicated trip.');
      else if (puErr) add(puErr, '#ded-pu-date', puErr);
      else if (!S.dedicatedPickup && !S.pickupDate) add('Pickup day', '#sec-dates', 'Please pick a pickup day.');
      if (S.dedicatedDelivery && !S.deliveryDate) add('Dedicated delivery date', '#ded-de-date', 'Please pick a delivery date for the dedicated trip.');
      else if (deErr) add(deErr, '#ded-de-date', deErr);
      else if (!S.dedicatedDelivery && !S.deliveryDate) add('Delivery day', '#sec-dates', 'Please pick a delivery day.');
      if (S.pickupDate && S.deliveryDate && S.deliveryDate < S.pickupDate) add('Delivery on or after pickup', '#sec-dates', 'Please pick a delivery day on or after the pickup day.');
    }
  }
  return out;
}

/* Staff code prompt: shared by the two unlabeled chevrons. Neutral on purpose (no wording about what it unlocks). */
const CHEV_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const pinHtml = (which) => (S.pinFor === which ? `<form class="pin" id="pinForm" data-for="${which}" autocomplete="off"><input type="password" id="pinInput" name="code" placeholder="Code" aria-label="Code" autocomplete="off" value="${esc(S.pinVal)}"><button type="submit" aria-label="Enter">→</button></form>` : '');
function openChevron(which) {
  // which: 'staffOpen' (courtesy) or 'payOpen' (second payer option)
  if (S.unlocked) { S[which] = !S[which]; S.pinFor = ''; renderSummary(); const c = $('#' + (which === 'staffOpen' ? 'more' : 'payMore')); if (c) c.focus({ preventScroll: true }); return; }
  S.pinFor = S.pinFor === which ? '' : which; S.pinVal = ''; renderSummary();
  const i = $('#pinInput'); if (i) i.focus({ preventScroll: true });
}
async function submitPin(e) {
  e.preventDefault();
  const which = S.pinFor, code = $('#pinInput').value;
  const { j } = await api('/api/palomas/unlock', { code });
  if (j && j.ok) { S.unlocked = true; S.pin = code; S[which] = true; S.pinFor = ''; S.pinVal = ''; renderSummary(); return; }
  S.pinVal = ''; renderSummary(); const i = $('#pinInput'); if (i) { i.classList.add('bad'); i.focus({ preventScroll: true }); }
}
/* Staff / employee discount code: a visible, labeled field in the order summary (before payment). A valid code applies the Manager's courtesy
   (an extra 15% off what is left, see lib/palomas.js applyExtras); the checkbox lets staff switch it off again. The server re-checks the code on every
   quote and order, so nothing here is trusted. */
function staffBlock(q) {
  const pct = q.rules.courtesyPct;
  if (S.unlocked) {
    return `<div class="staffcode ok" id="staffBox"><div class="sc-h">Staff / employee discount code</div>
      <p class="sc-ok" role="status">✓ Code accepted. Manager's courtesy (−${pct}%) ${S.courtesy ? 'is applied' : 'is available'}.</p>
      <label class="mc"><input type="checkbox" id="mc" ${S.courtesy ? 'checked' : ''}><span>Manager's courtesy (−${pct}%)</span></label>
      <button type="button" class="linkbtn" id="staffClear">Remove code</button></div>`;
  }
  return `<form class="staffcode" id="staffForm" autocomplete="off" novalidate><label class="sc-h" for="staffCode">Staff / employee discount code</label>
    <div class="sc-row"><input type="password" id="staffCode" name="staffcode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter code" value="${esc(S.staffVal)}" ${S.staffMsg ? 'class="bad" aria-invalid="true"' : ''}>
    <button type="submit" class="btn primary sc-apply" id="staffApply">Apply</button></div>
    <p class="mini sc-msg" role="status">${esc(S.staffMsg)}</p></form>`;
}
async function submitStaff(e) {
  e.preventDefault();
  const code = ($('#staffCode') || {}).value || '';
  S.staffVal = code;
  if (!code.trim()) { S.staffMsg = 'Please enter the code.'; renderSummary(); const i = $('#staffCode'); if (i) i.focus({ preventScroll: true }); return; }
  const { ok, j } = await api('/api/palomas/unlock', { code });
  if (ok && j && j.ok) { S.unlocked = true; S.pin = code; S.courtesy = true; S.staffMsg = ''; S.staffVal = ''; renderSummary(); runQuote(); return; }
  S.staffMsg = ok ? 'That code isn’t valid. Please check it and try again.' : 'Too many tries. Please wait a minute and try again.';
  renderSummary(); const i = $('#staffCode'); if (i) i.focus({ preventScroll: true });
}
function clearStaff() {
  S.unlocked = false; S.pin = ''; S.courtesy = false; S.staffOpen = false; S.payOpen = false; S.pinFor = ''; S.staffMsg = ''; S.staffVal = '';
  if (S.payer === 'palomas') S.payer = 'client';
  renderSummary(); runQuote();
}
const payerInfo = () => (S.payer === 'palomas' ? { name: "Paloma's Home Furnishings", email: CFG.pay.partnerEmail } : { name: delivery().name, email: delivery().email });
function payerLineHtml() { const p = payerInfo(); return p.name || p.email ? `Payer: <b>${esc(p.name || '—')}</b>${p.email ? ' · ' + esc(p.email) : ''}` : 'Payer: fill in the client name and email above.'; }
const isHeavyReview = () => !!(S.quote && S.quote.special && S.quote.review === 'heavy');
function shippingButton() {
  const custom = !!S.customDate;
  return `<button type="button" class="btn primary wide" id="place" ${S.submitting ? 'disabled' : ''}>${S.submitting ? 'Sending…' : isHeavyReview() ? 'Send for team review' : custom ? 'Send date request' : 'Request shipping quote'}</button><p class="billing">${custom ? 'We’ll confirm the date with you before anything is charged.' : 'No payment is taken online.'}</p>`;
}
function payBlock(q) {
  const pay = q.payment || {}; const deposit = pay.paymentPlan === 'deposit';
  const mock = !CFG.pay.stripe && CFG.pay.testMode, offline = !CFG.pay.stripe && !CFG.pay.testMode;
  let h = `<div class="payer" role="radiogroup" aria-label="Who is paying">
    <label class="prow ${S.payer === 'client' ? 'on' : ''}"><input type="radio" name="payer" value="client" ${S.payer === 'client' ? 'checked' : ''}><span><b>Client pays now</b><small>Card payment at checkout</small></span></label>
    ${S.payOpen ? `<label class="prow ${S.payer === 'palomas' ? 'on' : ''}"><input type="radio" name="payer" value="palomas" ${S.payer === 'palomas' ? 'checked' : ''}><span><b>Paloma's Pay</b><small>Same card checkout, billed to Paloma's</small></span></label>` : ''}
  </div>
  <div class="paymore"><button type="button" class="chev ${S.payOpen ? 'open' : ''}" id="payMore" aria-label="More (checkout)" aria-expanded="${S.payOpen ? 'true' : 'false'}">${CHEV_SVG}</button></div>${pinHtml('payOpen')}
  <p class="mini payerline" id="payerLine">${payerLineHtml()}</p>`;
  h += deposit
    ? `<div class="sl big rule due"><span>Due today<small>${esc(pay.paymentSummary || '')}</small></span><span class="a">${usd(pay.dueNow)}</span></div>`
    : `<div class="sl big rule due"><span>Due today<small>${esc(q.accessReview ? 'Estimated, before access check' : (pay.paymentSummary || 'Covers the delivery as quoted'))}</small></span><span class="a">${usd(pay.dueNow || q.total)}</span></div>`;
  if (q.accessReview) h += `<p class="mini access-note" data-access-review>${esc(q.accessFeeNote)}</p>`;
  if (mock) {
    h += `<div class="cardbox"><div class="wallets"><button type="button" class="btn ghost wal" data-wallet="apple_pay" ${S.quoteBusy ? 'disabled' : ''}>Apple Pay</button><button type="button" class="btn ghost wal" data-wallet="google_pay" ${S.quoteBusy ? 'disabled' : ''}>Google Pay</button></div>
      <div class="or">or pay by card <em>test mode, no real charge</em></div>
      <label class="field"><span class="lbl">Card number</span><input id="cardNum" type="text" inputmode="numeric" autocomplete="cc-number" maxlength="23" value="${esc(S.card)}" placeholder="4242 4242 4242 4242"></label>
      <div class="two"><label class="field"><span class="lbl">Expiry</span><input id="cardExp" type="text" inputmode="numeric" autocomplete="cc-exp" maxlength="7" value="${esc(S.exp)}" placeholder="MM / YY"></label>
      <label class="field"><span class="lbl">CVC</span><input id="cardCvc" type="text" inputmode="numeric" autocomplete="cc-csc" maxlength="4" value="${esc(S.cvc)}" placeholder="123"></label></div></div>`;
  } else if (!offline) h += `<p class="mini" style="margin:8px 0">You'll finish on our secure Stripe checkout page: card, Apple Pay, Google Pay, Link and more.</p>`;
  else h += `<p class="mini" style="margin:8px 0">Online payment isn't available right now. Please reach us through our <a href="https://californiaartdelivery.com/pages/contact">Contact Us page</a> at californiaartdelivery.com/pages/contact.</p>`;
  if (S.payError) h += `<div class="errs" role="alert"><b>Payment didn't go through.</b>${esc(S.payError)}</div>`;
  h += `<button type="button" class="btn primary wide" id="place" ${S.submitting || offline || S.quoteBusy ? 'disabled' : ''}>${S.submitting ? 'Processing…' : S.quoteBusy ? 'Updating estimate…' : 'Pay &amp; lock in delivery'}</button>`;
  if (S.payer === 'client') h += `<p class="linkrow"><button type="button" class="linkbtn" id="sendLink" ${S.submitting ? 'disabled' : ''}>Client can't pay now? Email them a payment link.</button></p>
    <p class="mini linknote">We email the client a link. The delivery isn't scheduled until it's paid.</p>`;
  return h;
}
function renderSummary() {
  const box = $('#sumBody'); const q = S.quote;
  const barTotal = $('#barTotal');
  if (!S.items.length || !q || q.empty) {
    box.innerHTML = `<p class="empty">Add an item to see pricing.</p>`;
    $('#barTot').hidden = true; return;
  }
  let html = '';
  if (q.special) {
    html = isHeavyReview()
      ? `<div class="special"><b>A piece over 500 lb needs a quick team review.</b><br>${esc(q.quoteNote || 'Our team will email your quote. Nothing is charged until you authorize payment.')}</div>`
      : `<div class="special"><b>Delivery outside California is quoted as Shipping.</b><br>${esc('Our team will email your shipping quote. Nothing is charged until you authorize payment.')}</div>`;
    barTotal.textContent = 'Quote';
  } else {
    const extras = q.volumeOff > 0 || q.courtesyOff > 0;
    const each = (l) => (l.qty > 1 ? ` · ${Math.round(l.after * 100) % l.qty === 0 ? '' : 'about '}${usd(l.each)} each` : '');
    html += q.lines.map((l) => `<div class="li"><div class="li-l">${esc(l.label)}</div>
      <div class="li-p">${l.standard != null && l.standard !== l.amount ? `<s>${usd(l.standard)}</s> ` : ''}<b>${usd(l.amount)}</b>${l.standard != null && l.standard !== l.amount ? '<small> partnership price</small>' : ''}</div>
      ${extras ? `<div class="li-all"><span>After all discounts${esc(each(l))}</span><b>${usd(l.after)}</b></div>` : ''}</div>`).join('');
    html += `<div class="sl partner"><span>Paloma's Home Furnishings partnership pricing<small>25% off standard pickup, delivery and placement. Access charges (like stairs) are additional.</small></span><span class="a"><s>${usd(q.standard)}</s>${usd(q.partner)}</span></div>`;
    if (q.volumeEligible) html += `<div class="sl disc"><span>Additional ${q.rules.volumePct}% off (delivery orders of $${q.rules.volumeThreshold.toLocaleString('en-US')}+ after partnership pricing)</span><span class="a">−${usd(q.volumeOff)}</span></div>`;
    html += `<div class="sum-note">${q.volumeEligible ? '✓ ' : ''}Delivery orders of $${q.rules.volumeThreshold.toLocaleString('en-US')} or more (after partnership pricing) get an additional ${q.rules.volumePct}% off the whole delivery price.</div>`;
    if (q.courtesy) html += `<div class="sl disc"><span>Manager's courtesy</span><span class="a">−${usd(q.courtesyOff)}</span></div>`;
    html += `<div class="sl big rule"><span>${esc(q.totalLabel || 'Total')}</span><span class="a">${q.standard !== q.total ? `<s>${usd(q.standard)}</s>` : ''}${usd(q.total)}</span></div>`;
    html += staffBlock(q);
    if (q.notes && q.notes.length) html += q.notes.filter((n) => !/access/i.test(n)).map((n) => `<p class="mini">${esc(n)}</p>`).join('');
    barTotal.textContent = S.quoteBusy ? 'Updating…' : usd(q.total);
  }
  $('#barTot').hidden = false;
  const errs = S.showErrors ? problems() : [];
  if (errs.length) html += `<div class="errs" role="alert"><b>Still needed:</b>${errs.map((e) => esc(e.msg)).join(' · ')}</div>`;
  if (q.includesDedicated && !S.customDate) html += `<p class="mini">Includes a dedicated trip.</p>`;
  html += (q.special || S.customDate) ? shippingButton() : payBlock(q);
  box.innerHTML = html;
}

/* ---------- access + weight gates (parity with the main flow) ---------- */
function localNeedsPath(it) {
  const kind = String((it && it.kind) || '');
  if (/sofa|loveseat|sectional|bed|dresser|armoire|wardrobe|cabinet|credenza|sideboard|buffet|bookcase|dining table|piano|desk|hutch|chest|recliner/i.test(kind)) return true;
  if (/^(large|heavy|xl)$/i.test(String((it && it.size) || ''))) return true;
  const dim = Math.max(num(it && it.w), num(it && it.h), num(it && it.d), ...((String((it && it.dims) || '').match(/\d+(?:\.\d+)?/g) || []).map(Number)));
  if (kind === 'Mirror') return Math.max(num(it && it.w), num(it && it.h)) >= 60 || num(it && it.weight) > 150;
  if (dim > 72) return true;
  if (num(it && it.weight) >= 100 && /sculpt|statue|bust|urn/i.test(kind)) return true;
  return false;
}
function localNeedsDoorway(it) {
  const kind = String((it && it.kind) || '');
  if (/sofa|loveseat|sectional|dining table/i.test(kind)) return true;
  const dim = Math.max(num(it && it.w), num(it && it.h), num(it && it.d), ...((String((it && it.dims) || '').match(/\d+(?:\.\d+)?/g) || []).map(Number)));
  return dim >= 96;
}
function needsPathAccess() {
  if (S.quote && !S.quote.special && typeof S.quote.needsPathAccess === 'boolean') return S.quote.needsPathAccess;
  return (S.items || []).some(localNeedsPath);
}
function needsDoorwayAccess() {
  if (S.quote && !S.quote.special && typeof S.quote.needsDoorwayAccess === 'boolean') return S.quote.needsDoorwayAccess;
  return (S.items || []).some(localNeedsDoorway);
}
function needsDeliveryAccess() { return needsPathAccess() || needsDoorwayAccess(); }
function tidyAccessIfSkipped() {
  if (needsDeliveryAccess()) return;
  ['aMode', 'aFlights', 'aFlightsN', 'aFloor', 'aElevType', 'aElevSteps', 'aElevStepsN', 'aShape', 'aTight'].forEach((id) => { const el = $('#' + id); if (el) { el.value = ''; el.classList.remove('bad'); } });
  const res = $('#aElevRes'); if (res) res.checked = false;
}
function asksWeightDraft() {
  const kind = ($('#cKind') && $('#cKind').value) || '';
  if (!/^(painting|photograph|print|drawing|canvas|poster|wall art)/i.test(kind)) return true;
  const max = Math.max(num($('#cL') && $('#cL').value), num($('#cW') && $('#cW').value), num($('#cH') && $('#cH').value));
  return max > 72;
}
function syncCustomWeight() {
  const row = $('#cWtRow'); if (!row) return;
  const ask = asksWeightDraft();
  row.hidden = !ask;
  if (!ask) { $('#cWt').value = ''; $('#cWtUnsure').checked = false; $('#cWt').disabled = false; }
}

/* ---------- dates (split-screen + dedicated boxes, parity with main 483cf68) ---------- */
const dedOn = (side) => !!(side === 'pickup' ? S.dedicatedPickup : S.dedicatedDelivery);
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function dedMin(side) {
  const R = (CFG && CFG.dedicated) || {};
  const floor = R.min || '';
  if (side === 'delivery' && S.pickupDate && S.pickupDate > floor) return S.pickupDate;
  return floor;
}
function dedDateProblem(iso, side) {
  const R = (CFG && CFG.dedicated) || {};
  if (!iso) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return 'Please pick a date.';
  const min = dedMin(side);
  if (min && iso < min) return side === 'delivery' && S.pickupDate && min === S.pickupDate ? 'Please pick a delivery date on or after your pickup date.' : `Please pick ${shortDate(min)} or later.`;
  if (R.max && iso > R.max) return `Please pick ${shortDate(R.max)} or earlier.`;
  if (!R.allowSundays && new Date(iso + 'T12:00:00Z').getUTCDay() === 0) return 'Please pick a day other than Sunday.';
  if ((R.blocked || []).includes(iso)) return 'We’re closed that day. Please pick another date.';
  const full = (S.dedicatedBlocked && S.dedicatedBlocked[side === 'pickup' ? 'pickup' : 'delivery']) || [];
  if (full.includes(iso)) return 'That date is fully booked. Please pick another date, or request a custom date below.';
  return '';
}
const lastDedSide = () => (dedOn('delivery') ? 'delivery' : 'pickup');
const customDateBlock = (side) => `<div class="ded-custom">
    <label class="chk"><input type="checkbox" data-customdate="1" ${S.customDate ? 'checked' : ''}> Request a custom date</label>
    ${S.customDate && side === lastDedSide() ? `<label class="field"><span class="lbl">Which dates would work?</span><input id="customDateNote" type="text" value="${esc(S.customDateNote)}" placeholder="For example: any weekday the week of Dec 14" maxlength="500"><p class="mini">We’ll schedule it and confirm the date with you before anything is charged.</p></label>` : ''}
  </div>`;
function dedBox(side) {
  const on = dedOn(side), R = (CFG && CFG.dedicated) || {};
  const v = side === 'pickup' ? S.pickupDate : S.deliveryDate;
  const prob = on && v && !S.customDate ? dedDateProblem(v, side) : '';
  const id = side === 'pickup' ? 'ded-pu-date' : 'ded-de-date';
  const lab = side === 'pickup' ? 'Pickup' : 'Delivery';
  return `<div class="ded-box${on ? ' on' : ''} in-col" data-ded="${side}">
    <p class="ded-q">None of these dates work for you?</p>
    <label class="ded-toggle"><span class="ded-lab">Select a dedicated trip</span><span class="sw"><input type="checkbox" data-dedtoggle="${side}" ${on ? 'checked' : ''} aria-label="Select a dedicated trip for the ${lab.toLowerCase()}"><i></i></span></label>
    <p class="ded-help">A van and crew just for your job, on a date that works for you.</p>
    ${on && !S.customDate ? `<div class="ded-date"><label class="field"><span class="lbl">${lab} date</span><input id="${id}" type="date" data-deddate="${side}" min="${esc(dedMin(side))}" max="${esc(R.max || '')}" value="${esc(v || '')}"></label>
      ${prob ? `<p class="mini ded-err" role="alert">${esc(prob)}</p>` : ''}</div>` : ''}
    ${on ? customDateBlock(side) : ''}
  </div>`;
}
function renderDatesVisibility() {
  const d = delivery();
  const el = $('#datesSub'); if (!el) return;
  el.textContent = isHeavyReview() ? 'This order goes to our team for review first, so no days are needed yet. We will email the quote.' : outOfState() || (S.quote && S.quote.special)
    ? 'Delivery outside California is quoted as Shipping, so no dates are needed. We will email the quote.'
    : /^\d{5}/.test(d.zip) ? (S.customDate ? 'Request a date that works for you. We’ll confirm it before anything is charged.' : 'Start with either side. We’ll gray out the days that don’t work together.') : 'Enter the delivery ZIP on the address step and the available days appear here.';
}
const SHOW_FIRST = 3;
const pairCard = (d, kind, st, i) => {
  const [w, m, n] = String(d.label).replace(',', '').split(' ');
  const why = st === 'off' ? (kind === 'pu' ? 'Too late for the delivery day you picked' : 'Doesn’t work with the pickup day you picked') : '';
  return `<button type="button" class="day ${st} ${i === 0 ? 'early' : ''}" data-${kind}="${d.date}" ${st === 'off' ? `aria-disabled="true" data-off="1" title="${why}"` : ''} aria-pressed="${st === 'on'}"><div class="dw">${esc(w)}</div><div class="dd">${esc(m)} ${esc(n)}</div><div class="rg">${esc(d.shortLabel || d.region || '')}</div></button>`;
};
function dayCtl(days, sel, kind) {
  const more = kind === 'pu' ? S.puMore : S.deMore, from = kind === 'pu' ? S.puFrom : S.deFrom;
  const selIdx = days.findIndex((d) => d.date === sel);
  const hidden = days.length > SHOW_FIRST && !(more || selIdx >= SHOW_FIRST);
  const min = (days[0] || {}).date || '';
  return `${hidden ? `<button type="button" class="linkbtn" data-more="${kind}">Show more dates (${days.length - SHOW_FIRST} more)</button>` : ''}
    <label class="later">Later date <input type="date" data-later="${kind}" min="${esc(from ? '' : min)}" value="${esc(from)}" aria-label="Choose a later ${kind === 'pu' ? 'pickup' : 'delivery'} date"></label>
    ${from ? `<button type="button" class="linkbtn" data-back="${kind}">Back to earliest dates</button>` : ''}`;
}
function puState(d) {
  const sel = S.pickupDate, del = S.deliveryDate;
  if (sel === d.date) return 'on';
  if (del && dedOn('delivery')) return d.date > del ? 'off' : (sel ? 'dim' : '');
  if (del && d.date > del) return 'off';
  return sel ? 'dim' : '';
}
function delState(d) {
  const sel = S.deliveryDate, pu = S.pickupDate;
  if (sel === d.date) return 'on';
  if (dedOn('pickup')) return pu && d.date < pu ? 'off' : (sel ? 'dim' : '');
  if (pu && d.date < pu) return 'off';
  return sel ? 'dim' : '';
}
function shownDays(days, stateOf, more, sel) {
  const selIdx = days.findIndex((d) => d.date === sel);
  const all = more || selIdx >= SHOW_FIRST;
  return all ? days : days.slice(0, SHOW_FIRST);
}
function renderDays() {
  const box = $('#datesPair'); if (!box) return;
  const d = delivery();
  const quoteHold = isHeavyReview() || outOfState() || (S.quote && S.quote.special);
  if (quoteHold) { box.innerHTML = ''; renderDatesVisibility(); return; }
  const hint = dedOn('pickup') && dedOn('delivery') ? 'Dedicated trip on both sides: pick the pickup and delivery dates that work for you.'
    : S.pickupDate && S.deliveryDate ? 'Both dates are set. Tap Clear on either one to change it.'
    : S.pickupDate ? 'Now pick a delivery day. Grayed-out days don’t work with that pickup.'
    : S.deliveryDate ? 'Now pick a pickup day. Grayed-out days are too late for that delivery.'
    : 'Start with either one. We’ll gray out the days that don’t work together.';
  const head = (label, iso, key) => `<div class="col-head"><span class="col-t">${label}</span>${iso ? `<span class="col-sel"><b>${esc(shortDate(iso))}</b><button type="button" class="linkbtn" data-clear="${key}" aria-label="Clear ${label.toLowerCase()} date">Clear</button></span>` : '<span class="col-sel mini">Not picked</span>'}</div>`;
  const puList = shownDays(S.puDays, puState, S.puMore, S.pickupDate);
  const deList = shownDays(S.deDays, delState, S.deMore, S.deliveryDate);
  const zipOk = /^\d{5}/.test(d.zip);
  box.innerHTML = `${zipOk ? `<p class="pair-hint mini">${hint}</p>` : '<p class="pair-hint mini">Enter the delivery ZIP on the address step and the available days appear here.</p>'}
    <div class="date-pair">
      <div class="date-col" data-col="pu">${head('Pickup', S.pickupDate, 'pu')}
        ${dedOn('pickup') ? '' : `${S.puDays.length ? `<div class="region">● Pickup route</div><div class="days col-days">${puList.map((x, i) => pairCard(x, 'pu', puState(x), i)).join('')}</div>${dayCtl(S.puDays, S.pickupDate, 'pu')}` : (zipOk ? '<p class="mini">No route days are open right now. Select a dedicated trip below, or request a custom date once the trip is on.</p>' : '<p class="mini">Available pickup days appear after the delivery ZIP is entered.</p>')}`}
        ${dedBox('pickup')}
      </div>
      <div class="date-col" data-col="del">${head('Delivery', S.deliveryDate, 'del')}
        ${dedOn('delivery') ? '' : `${S.deDays.length ? `<div class="region">● Delivery route</div><div class="days col-days">${deList.map((x, i) => pairCard(x, 'de', delState(x), i)).join('')}</div>${dayCtl(S.deDays, S.deliveryDate, 'de')}` : (zipOk ? '<p class="mini">No route days are open right now. Select a dedicated trip below, or request a custom date once the trip is on.</p>' : '<p class="mini">Available delivery days appear after the delivery ZIP is entered.</p>')}`}
        ${dedBox('delivery')}
      </div>
    </div>`;
  renderDatesVisibility();
}
function scheduleAvail() { availPending = true; clearTimeout(aTimer); aTimer = setTimeout(refreshDates, 250); }
async function refreshDates() {
  const tok = ++availTok; const d = delivery();
  if (!/^\d{5}/.test(d.zip) || outOfState()) {
    S.puDays = []; S.deDays = [];
    if (!dedOn('pickup')) S.pickupDate = '';
    if (!dedOn('delivery')) S.deliveryDate = '';
    renderDays(); availPending = false; return;
  }
  const { ok, j } = await api('/api/palomas/availability', { ...payload(), leg: 'pickup', from: S.puFrom });
  if (tok !== availTok) return;
  if (ok && j.dedicatedBlocked) S.dedicatedBlocked = j.dedicatedBlocked;
  S.puDays = ok ? (j.days || []) : [];
  if (!dedOn('pickup') && !S.puDays.some((x) => x.date === S.pickupDate)) S.pickupDate = (S.puDays[0] || {}).date || '';
  await refreshDelivery(tok);
}
async function refreshDelivery(tok = availTok) {
  const d = delivery();
  if (!/^\d{5}/.test(d.zip)) { if (!dedOn('delivery')) { S.deDays = []; if (!dedOn('delivery')) S.deliveryDate = ''; } renderDays(); availPending = false; return; }
  const puForDel = S.pickupDate || (S.puDays[0] || {}).date || '';
  if (!puForDel && !dedOn('delivery')) { S.deDays = []; if (!dedOn('delivery')) S.deliveryDate = ''; renderDays(); availPending = false; return; }
  const { ok, j } = await api('/api/palomas/availability', { ...payload(), leg: 'dropoff', pickupDate: puForDel || S.pickupDate, from: S.deFrom });
  if (tok !== availTok) return;
  if (ok && j.dedicatedBlocked) S.dedicatedBlocked = j.dedicatedBlocked;
  S.deDays = ok ? (j.days || []) : [];
  if (!dedOn('delivery') && !S.deDays.some((x) => x.date === S.deliveryDate)) S.deliveryDate = (S.deDays[0] || {}).date || '';
  renderDays(); renderSummary(); availPending = false;
}
function toggleDedicated(side, on) {
  if (side === 'pickup') S.dedicatedPickup = on; else S.dedicatedDelivery = on;
  if (!S.dedicatedPickup && !S.dedicatedDelivery) { S.customDate = false; S.customDateNote = ''; }
  if (on) {
    if (side === 'pickup' && S.puDays.some((x) => x.date === S.pickupDate)) S.pickupDate = '';
    if (side === 'delivery' && S.deDays.some((x) => x.date === S.deliveryDate)) S.deliveryDate = '';
  } else if (!S.customDate) {
    if (side === 'pickup' && !S.puDays.some((x) => x.date === S.pickupDate)) S.pickupDate = (S.puDays[0] || {}).date || '';
    if (side === 'delivery' && !S.deDays.some((x) => x.date === S.deliveryDate)) S.deliveryDate = (S.deDays[0] || {}).date || '';
  }
  scheduleQuote();
  if (side === 'pickup' && !on) refreshDelivery(); else { renderDays(); renderSummary(); }
}

/* ---------- submit ---------- */
async function place(mode = 'now', wallet = '') {
  if (S.quoteBusy) return; // wait for the latest estimate before anything is charged or sent
  S.showErrors = true; S.payError = '';
  const errs = problems();
  if (errs.length) {
    renderSummary(); renderItems();
    const sid = stepOfSel(errs[0].sel);
    if (sid !== visibleSteps()[stepI]) showStep(visibleSteps().indexOf(sid));
    showStepErrors(problemsFor(visibleSteps()[stepI]));
    markBad(errs); return;
  }
  const special = !!(S.quote && S.quote.special) || !!S.customDate;
  const card = S.card.replace(/\s/g, '');
  if (!special && mode === 'now' && !wallet && !CFG.pay.stripe && CFG.pay.testMode && !/^\d{15,16}$/.test(card)) { S.payError = 'Enter a card number (test: 4242 4242 4242 4242), or use Apple Pay / Google Pay.'; renderSummary(); return; }
  S.submitting = true; renderSummary();
  const fail = (msg, title) => { S.submitting = false; renderSummary(); $('#sumBody').insertAdjacentHTML('afterbegin', `<div class="errs" role="alert"><b>${title}</b>${esc(msg || 'Please try again.')}</div>`); };
  const created = await api('/api/palomas/orders', payload(special ? 'now' : mode));
  if (!created.ok) return fail(created.j.error, "We couldn't place that order.");
  const j = created.j;
  if (special) { S.submitting = false; return showDone(j, S.customDate ? 'custom' : undefined); }
  if (j.order && j.order.status === 'pending_approval') { S.submitting = false; return showDone(j, 'review'); }
  if (mode === 'link') { S.submitting = false; return showDone(j, 'link'); }
  if (j.order && j.order.status === 'confirmed') { S.submitting = false; return showDone(j, 'paid'); }
  const paid = await api(`/api/orders/${encodeURIComponent(j.id)}/pay`, wallet ? { method: wallet } : { method: 'card', card });
  if (!paid.ok) { S.submitting = false; S.payError = paid.j.error || 'Please check the card and try again.'; renderSummary(); return; }
  if (paid.j.redirect) { location.href = paid.j.redirect; return; }
  S.submitting = false; showDone({ id: j.id, quote: j.quote, order: paid.j.order }, 'paid');
}
function markBad(errs) { document.querySelectorAll('.bad').forEach((e) => e.classList.remove('bad')); errs.forEach((e) => { const el = $(e.sel); if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.classList.add('bad'); }); }
function showDone(j, how) {
  clearTimeout(draftTimer); try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
  const o = j.order || {}; const q = j.quote || {}; const d = delivery();
  const customReq = how === 'custom' || !!(o.customDate) || !!S.customDate;
  const reviewHold = o.status === 'pending_approval' && !!(o.review && o.review.needed) && !customReq;
  const shipping = o.status === 'pending_approval' && !reviewHold && !customReq;
  const heavy = o.reviewReason === 'heavy';
  const paySt = (o.payment || {}).status;
  const reallyPaid = how === 'paid' && paySt === 'paid';
  const processing = how === 'paid' && paySt === 'ach_processing';
  const hasInvoice = !!(o.invoice && (o.invoice.issuedAt || o.invoice.number || o.invoice.id));
  const palomasPending = (S.payer === 'palomas' || (o.partnerInfo && o.partnerInfo.payer === 'palomas')) && !reallyPaid && !processing && how !== 'link' && !shipping && !reviewHold;
  const day = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '');
  const sub = customReq
    ? ` · We’ll schedule it and confirm the date with you before anything is charged. We’ll email ${esc(d.email)}.`
    : reviewHold
    ? ` · ${esc((o.quote || {}).quoteNote || 'Our team confirms the date within 1 business day.')} We’ll email ${esc(d.email)} a payment link once confirmed. No charge until then.`
    : shipping ? (heavy ? ' · Our team reviews the heavy piece and will email your quote within 1 business day. Nothing is charged until you authorize payment.' : ' · Our team will email your shipping quote within 1 business day. Nothing is charged until you authorize payment.')
    : how === 'link' ? ` · we emailed ${esc(d.email)} a payment link. <b>Awaiting payment — not scheduled until paid.</b> We'll send a reminder each day until it's paid.`
    : reallyPaid ? ' · paid, and we have it from here.'
    : processing ? ' · payment processing. Your booking is confirmed.'
    : hasInvoice ? ' · invoiced. Payment is still pending.'
    : ' · booked, payment pending.';
  $('#main').innerHTML = `<div class="done"><div class="ck">✓</div>
    <h2>${customReq ? 'Custom date requested' : reviewHold ? 'Date held, team confirming' : shipping ? (heavy ? 'Sent for team review' : 'Shipping quote requested') : how === 'link' ? 'Payment link sent' : reallyPaid ? 'Delivery locked in' : processing ? 'Payment processing' : hasInvoice ? 'Invoiced' : 'Booked, payment pending'}</h2>
    <p class="sub">Order <b>${esc(o.id || j.id)}</b>${sub}</p>
    <div class="box">
      <p><b>Placed by</b> ${esc(S.placedBy === 'Other' ? S.placedOther : S.placedBy)}</p>
      <p><b>Pickup</b> ${esc(S.pickup === 'salinas' ? 'Salinas warehouse, 329 Rianda St' : 'Carmel-by-the-Sea showroom, Ocean Ave at Mission St')}${S.pickupDate && !shipping ? ' · ' + esc(day(S.pickupDate)) : ''}</p>
      <p><b>Deliver to</b> ${esc(d.name)} · ${esc(d.street)}${d.unit ? ', ' + esc(d.unit) : ''}, ${esc(d.city)} ${esc(d.state)} ${esc(d.zip)}${S.deliveryDate && !shipping ? ' · ' + esc(day(S.deliveryDate)) : ''}</p>
      <p><b>Items</b> ${S.items.map((i) => `${i.qty} × ${esc(i.name)}`).join('; ')}</p>
      ${shipping ? '' : (((j.order || {}).quote || {}).lines || []).filter((l) => l.label === "Manager's courtesy").map((l) => `<p><b>Manager's courtesy</b> −${usd(Math.abs(l.amount))}</p>`).join('')}
      ${shipping ? '' : `<p><b>${reviewHold || customReq ? 'Estimated total' : 'Total'}</b> ${usd(q.total)}${S.courtesy ? " (Manager's courtesy)" : ''}</p>`}
      ${shipping ? '' : `<p class="mini">${esc(q.accessFeeNote || (j.order && j.order.quote && j.order.quote.accessFeeNote) || '')}</p>`}
      ${shipping || reviewHold || how === 'link' ? '' : (reallyPaid ? `<p><b>Paid</b> ${usd((o.payment && o.payment.amount) || q.dueNow || q.total)}${o.quote && o.quote.balanceDue ? ' · balance ' + usd(o.quote.balanceDue) + ' due ' + esc(o.quote.balanceWhen || '') : ''} · by ${S.payer === 'palomas' ? "Paloma's Home Furnishings" : esc(d.name)}</p>` : processing ? `<p><b>Payment processing</b> ${usd((o.payment && o.payment.amount) || q.dueNow || q.total)}</p>` : `<p><b>${hasInvoice ? 'Invoiced' : 'Booked, payment pending'}</b> ${usd(q.dueNow || q.total)}</p>`)}
    </div>
    <button class="btn primary" id="again" type="button">Place another order</button></div>`;
  $('#bar').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#again').onclick = () => location.reload();
}

/* ---------- small steps (a few questions per screen, Next / Back) ---------- */
const ALL_STEPS = ['start', 'items', 'client', 'address', 'access', 'dates', 'review'];
const visibleSteps = () => ALL_STEPS.filter((id) => id !== 'access' || needsDeliveryAccess());
let stepI = 0, returnToReview = false, stepReady = false;
const stepOfSel = (sel) => { const el = $(sel); const st = el && el.closest ? el.closest('[data-step]') : null; return st ? st.dataset.step : 'review'; };
const problemsFor = (id) => problems().filter((p) => stepOfSel(p.sel) === id);
const firstProblemStep = () => { const vis = visibleSteps(); const ps = problems(); if (!ps.length) return vis.length - 1; const idxs = ps.map((p) => vis.indexOf(stepOfSel(p.sel))).filter((i) => i >= 0); return idxs.length ? Math.min(...idxs) : vis.length - 1; };
function clearStepErrors() {
  document.querySelectorAll('[data-stepmsg]').forEach((e) => e.remove());
  document.querySelectorAll('#form .bad').forEach((e) => e.classList.remove('bad'));
}
function showStepErrors(errs, { quiet = false } = {}) {
  clearStepErrors();
  if (!errs.length) return;
  const general = [];
  errs.forEach((e) => {
    const el = $(e.sel);
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !el.closest('[hidden]')) {
      el.classList.add('bad');
      const f = el.closest('.field') || el.parentElement;
      f.insertAdjacentHTML('beforeend', `<p class="req-msg" data-stepmsg>${esc(e.ask)}</p>`);
    } else general.push(e.ask);
  });
  if (general.length) {
    const secs = [...document.querySelectorAll(`#form [data-step="${visibleSteps()[stepI]}"]`)]; const last = secs[secs.length - 1];
    if (last) last.insertAdjacentHTML('beforeend', `<div class="errs" role="alert" data-stepmsg>${general.map(esc).join('<br>')}</div>`);
  }
  if (quiet) return;
  const first = document.querySelector('[data-stepmsg]'); const fel = $(errs[0].sel);
  const target = (fel && fel.closest && !fel.closest('[hidden]') && fel) || first;
  if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (fel && fel.focus && /^(INPUT|SELECT|TEXTAREA)$/.test(fel.tagName)) fel.focus({ preventScroll: true });
}
function refreshStepErrors() { if (document.querySelector('[data-stepmsg]')) showStepErrors(problemsFor(visibleSteps()[stepI]), { quiet: true }); }
function frontLoadedPct(index, total, atEnd) {
  if (atEnd || total <= 1) return 100;
  const i = Math.max(0, Math.min(index, total - 1));
  if (i >= total - 1) return 100;
  const ratio = (total - 1) / total;
  const k = Math.log(0.75) / Math.log(ratio || 0.5);
  const t = (i + 1) / total;
  return Math.max(1, Math.min(99, Math.round(100 * (1 - Math.pow(1 - t, k)))));
}
let palProgressHigh = 0, palLastIndex = -1;
function showStep(i, { push = true } = {}) {
  i = Math.max(0, Math.min(visibleSteps().length - 1, i));
  const first = !stepReady, changed = first || i !== stepI;
  const goingBack = palLastIndex >= 0 && i < palLastIndex;
  stepI = i; stepReady = true;
  const id = visibleSteps()[i], isLast = id === 'review';
  document.querySelectorAll('[data-step]').forEach((el) => { el.hidden = el.dataset.step !== id; });
  $('#main').classList.toggle('single', !isLast);
  document.body.classList.toggle('compact', i > 0);
  $('#backBtn').hidden = i === 0; $('#nextBtn').hidden = isLast;
  let pct = frontLoadedPct(i, visibleSteps().length, isLast);
  if (goingBack) palProgressHigh = pct;
  else { pct = Math.max(pct, palProgressHigh); palProgressHigh = pct; }
  palLastIndex = i;
  $('#pbar i').style.width = pct + '%'; $('#pbar').setAttribute('aria-valuenow', String(pct));
  clearStepErrors();
  if (isLast) { returnToReview = false; renderReview(); renderSummary(); }
  if (changed) {
    try { if (push) history.pushState({ palStep: i }, ''); else history.replaceState({ palStep: i }, ''); } catch (_) { /* ignore */ }
    if (!first) window.scrollTo({ top: Math.max(0, $('#main').offsetTop - 12), behavior: 'auto' });
  }
  if (id === 'dates') renderDays();
  tidyAccessIfSkipped();
  saveDraft();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitSettled() { for (let t = 0; t < 4000 && (S.quoteBusy || availPending); t += 60) await sleep(60); }
const customPending = () => !$('#customForm').hidden && ['#cName', '#cL', '#cW', '#cH'].concat(asksWeightDraft() ? ['#cWt'] : []).some((id) => $(id).value.trim());
async function goNext() {
  if (S.submitting) return;
  const id = visibleSteps()[stepI]; if (id === 'review') return;
  await waitSettled();
  if (id === 'items' && customPending()) {
    const err = $('#cErr'); err.hidden = false; err.textContent = 'You started a custom item. Tap “Add item” to include it, or clear the form.'; $('#cAdd').focus({ preventScroll: false }); return;
  }
  const errs = problemsFor(id);
  if (errs.length) { showStepErrors(errs); return; }
  if (returnToReview || stepI + 1 === visibleSteps().length - 1) {
    // Going to the review screen: make sure every screen is complete first.
    const all = problems();
    if (all.length) { const sid = stepOfSel(all[0].sel); showStep(visibleSteps().indexOf(sid)); showStepErrors(problemsFor(sid)); return; }
    showStep(visibleSteps().length - 1); return;
  }
  showStep(stepI + 1);
}
function goBack() { if (stepI > 0) showStep(stepI - 1); }
function accessSummary() {
  if (!needsDeliveryAccess()) return 'No stairs or doorway questions needed for these pieces.';
  const a = access(); const lab = (list, k) => ((list || []).find(([v]) => v === k) || [k, k])[1];
  const parts = [lab(CFG.access, a.mode) || 'Not answered'];
  if (a.mode === 'stairs') {
    if (a.flights) parts.push(lab(CFG.flights, a.flights) + (a.flights === '4plus' && a.flightsCount ? ` (${a.flightsCount})` : ''));
    if (a.shape) parts.push(a.shape === 'turns' ? 'stairs turn' : 'straight stairs');
    if (a.tight) parts.push(a.tight === 'yes' ? 'tight turns or narrow doorways' : 'no tight spots');
  }
  if (a.mode === 'elevator') {
    if (a.floor) parts.push(`floor ${a.floor}`);
    if (a.elevatorType) parts.push(a.elevatorType === 'freight' ? 'freight elevator' : a.elevatorType === 'passenger' ? 'passenger elevator' : 'elevator type not sure');
    if (a.elevSteps) parts.push(a.elevSteps === 'yes' ? `${a.elevStepsN || ''} steps by the elevator`.trim() : a.elevSteps === 'no' ? 'no steps by the elevator' : 'steps by the elevator not sure');
    if (a.elevatorReserve) parts.push('elevator reserved in advance');
  }
  return parts.join(' · ');
}
function renderReview() {
  const d = delivery(), who = S.placedBy === 'Other' ? S.placedOther : S.placedBy;
  const row = (label, html, to) => `<div class="rv"><div class="rv-l">${label}</div><div class="rv-v">${html}</div><button type="button" class="linkbtn rv-e" data-edit="${to}" aria-label="Edit ${esc(label)}">Edit</button></div>`;
  const day = (arr, v) => (arr.find((x) => x.date === v) || {}).label || v;
  const noDates = outOfState() || (S.quote && S.quote.special);
  const items = S.items.map((i) => `${i.qty} × ${esc(i.name)}${i.custom ? ` <span class="muted">(custom${i.w && i.d && i.h ? `, ${esc(i.w)} × ${esc(i.d)} × ${esc(i.h)} in` : ''})</span>` : ''}`).join('<br>');
  const extra = [d.client2 ? `${esc(d.client2.name)}${d.client2.phone ? ' · ' + esc(d.client2.phone) : ''}${d.client2.email ? ' · ' + esc(d.client2.email) : ''}` : ''].filter(Boolean).join('<br>');
  const a = access();
  $('#reviewBody').innerHTML = [
    row('Placed by', `${esc(who || '—')}<br><span class="muted">Pickup: ${esc(S.pickup === 'salinas' ? 'Salinas warehouse' : 'Carmel-by-the-Sea showroom')}</span>`, 'start'),
    row('Items', items || '—', 'items'),
    row('Client', `${esc(d.name)}<br><span class="muted">${esc(d.phone)} · ${esc(d.email)}</span>${extra ? `<br><span class="muted">Second client: ${extra}</span>` : ''}`, 'client'),
    row('Address', `${esc(d.street)}${d.unit ? ', ' + esc(d.unit) : ''}<br>${esc(d.city)}, ${esc(d.state)} ${esc(d.zip)}`, 'address'),
    needsDeliveryAccess() ? row('Access', esc(accessSummary()) + (((S.quote && S.quote.accessReview) || (a => a.mode === 'not_sure' || (a.mode === 'elevator' && (a.elevatorType === 'not_sure' || a.elevSteps === 'not_sure')))(access())) ? '<br><span class="muted">Access still needs confirmation by our team. We’ll get your approval before charging any extra fee.</span>' : ''), 'access') : '',
    row('Notes', d.notes || a.hours ? `${a.hours ? 'Access hours: ' + esc(a.hours) + (d.notes ? '<br>' : '') : ''}${esc(d.notes)}` : '<span class="muted">None</span>', 'address'),
    row('Days', noDates ? `<span class="muted">${isHeavyReview() ? 'Team review first, no days to pick yet' : 'Quoted as shipping, no days to pick'}</span>`
      : S.customDate ? `Custom date request${S.customDateNote ? ': ' + esc(S.customDateNote) : ''}`
      : `Pickup ${esc(day(S.puDays, S.pickupDate) || shortDate(S.pickupDate) || '—')}${S.dedicatedPickup ? ' · dedicated trip' : ''}<br>Delivery ${esc(day(S.deDays, S.deliveryDate) || shortDate(S.deliveryDate) || '—')}${S.dedicatedDelivery ? ' · dedicated trip' : ''}`, 'dates'),
  ].filter(Boolean).join('');
}

/* ---------- wiring ---------- */
function bind() {
  const sel = $('#placedBy');
  try { const saved = localStorage.getItem('palomasPlacedBy'); if (saved && [...sel.options].some((o) => o.value === saved || o.text === saved)) { sel.value = saved; S.placedBy = saved; } } catch (_) { /* ignore */ }
  const syncWho = () => { S.placedBy = sel.value; $('#otherWrap').hidden = S.placedBy !== 'Other'; try { localStorage.setItem('palomasPlacedBy', S.placedBy); } catch (_) { /* ignore */ } };
  syncWho();
  sel.addEventListener('change', () => { syncWho(); if (S.placedBy === 'Other') $('#placedOther').focus(); sel.classList.remove('bad'); });
  $('#placedOther').addEventListener('input', (e) => { S.placedOther = e.target.value; e.target.classList.remove('bad'); });
  document.querySelectorAll('input[name=pickup]').forEach((r) => r.addEventListener('change', () => {
    S.pickup = document.querySelector('input[name=pickup]:checked').value;
    document.querySelectorAll('.radio').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    scheduleQuote(); scheduleAvail();
  }));
  $('#cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; renderCats(); renderCatalog(); });
  $('#search').addEventListener('input', renderCatalog);
  $('#catalog').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) addFromCatalog(b.dataset.add); });
  $('#customToggle').addEventListener('click', () => { const f = $('#customForm'); f.hidden = !f.hidden; $('#customToggle').setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('#cName').focus(); });
  // custom item form
  const kind = $('#cKind');
  kind.innerHTML = `<optgroup label="Furniture">${CFG.kinds.furniture.map((k) => `<option>${esc(k)}</option>`).join('')}</optgroup>` +
    CFG.kinds.groups.map((g) => `<optgroup label="${esc(g.label === 'Wall' ? 'Wall décor & mirrors' : g.label === 'Lighting' ? 'Lighting' : 'Accents & objects')}">${g.items.map((k) => `<option>${esc(k)}</option>`).join('')}</optgroup>`).join('');
  const cNum = (id) => num($(id).value);
  const cHeavy = () => asksWeightDraft() && (cNum('#cWt') > 500 || $('#cWtUnsure').checked);
  const syncCustomPhoto = () => {
    const heavy = cHeavy(); $('#cLaterWrap').hidden = false;
    $('#cPhotoReq').textContent = heavy ? '(required: over 500 lb or weight not sure. Add one, or tick “I’ll send a photo”)' : '(optional)';
  };
  ['#cWt', '#cWtUnsure'].forEach((id) => $(id).addEventListener('input', syncCustomPhoto));
  $('#cWtUnsure').addEventListener('change', () => { $('#cWt').disabled = $('#cWtUnsure').checked; if ($('#cWtUnsure').checked) $('#cWt').value = ''; syncCustomPhoto(); });
  ['#cKind', '#cL', '#cW', '#cH'].forEach((id) => $(id).addEventListener('input', () => { syncCustomWeight(); syncCustomPhoto(); }));
  $('#cKind').addEventListener('change', () => { syncCustomWeight(); syncCustomPhoto(); });
  syncCustomWeight(); syncCustomPhoto();
  $('#cAdd').addEventListener('click', async () => {
    const n = $('#cName').value.trim(); const err = $('#cErr'); const bad = [];
    const mark = (id, isBad) => { $(id).classList.toggle('bad', isBad); if (isBad) bad.push(id); };
    mark('#cName', !n); ['#cL', '#cW', '#cH'].forEach((id) => mark(id, !(cNum(id) > 0)));
    mark('#cWt', asksWeightDraft() && !$('#cWtUnsure').checked && !(cNum('#cWt') > 0));
    const files = [...($('#cPhoto').files || [])];
    const needPhoto = cHeavy() && !files.length && !$('#cLater').checked;
    if (needPhoto) bad.push('#cPhoto');
    if (bad.length) {
      err.hidden = false;
      err.textContent = needPhoto && bad.length === 1 ? 'Heavy or unknown-weight pieces need a photo. Add one, or tick “I’ll send a photo”.' : 'Please add the item name, length, width, height and approximate weight (or tick “Not sure of the weight”).';
      const f = $(bad[0]); if (f && f.focus) f.focus({ preventScroll: true }); return;
    }
    err.hidden = true;
    let photos = [];
    if (files.length) {
      const fd = new FormData(); files.slice(0, 10).forEach((f) => fd.append('photos', f));
      $('#cAdd').disabled = true; $('#cAdd').textContent = 'Uploading photo…';
      try { const r = await fetch('/api/upload', { method: 'POST', body: fd }); const j = await r.json(); photos = j.files || []; } catch (_) { photos = []; }
      $('#cAdd').disabled = false; $('#cAdd').textContent = 'Add item';
      if (!photos.length && !$('#cLater').checked) { err.hidden = false; err.textContent = 'The photo didn’t upload. Try again, or tick “I’ll send a photo”.'; return; }
    }
    S.undo = null;
    S.items.push({ uid: uid++, name: n, kind: kind.value, qty: 1, catalogId: 'custom-' + uid, custom: true, thumb: '', dims: '', w: String(cNum('#cL')), d: String(cNum('#cW')), h: String(cNum('#cH')), weight: $('#cWtUnsure').checked ? '' : String(cNum('#cWt')), weightUnsure: $('#cWtUnsure').checked, photos, photoLater: $('#cLater').checked && !photos.length });
    ['#cName', '#cL', '#cW', '#cH', '#cWt', '#cPhoto'].forEach((id) => { $(id).value = ''; $(id).classList.remove('bad'); });
    $('#cWtUnsure').checked = false; $('#cWt').disabled = false; $('#cLater').checked = false; syncCustomWeight(); syncCustomPhoto();
    itemsChanged(true);
  });
  // item rows
  const rowOf = (el) => { const r = el.closest('.irow'); return r && S.items.find((i) => String(i.uid) === r.dataset.uid); };
  $('#items').addEventListener('click', (e) => {
    if (e.target.closest('[data-undo]')) {
      const u = S.undo; S.undo = null;
      if (u && !S.items.includes(u.item)) S.items.splice(Math.min(u.index, S.items.length), 0, u.item);
      itemsChanged(true); return;
    }
    const it = rowOf(e.target); if (!it) return;
    // Remove takes the piece out at once (totals, dates and the estimate refresh) and offers Undo. Removing the last piece simply
    // empties the list: the order summary clears and Next stays blocked until a piece is added again.
    if (e.target.closest('[data-rm]')) { S.undo = { item: it, index: S.items.indexOf(it) }; S.items = S.items.filter((x) => x !== it); itemsChanged(true); return; }
    const q = e.target.closest('[data-q]'); if (q) { it.qty = Math.max(1, Math.min(99, it.qty + Number(q.dataset.q))); itemsChanged(true); }
  });
  $('#items').addEventListener('input', (e) => {
    const it = rowOf(e.target); const f = e.target.dataset.f; if (!it || !f) return;
    if (f === 'qty') { it.qty = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); }
    else it[f] = e.target.value;
    scheduleQuote(); if (f === 'qty') scheduleAvail(); renderCatalog();
  });
  // delivery fields
  ['dName', 'dPhone', 'dEmail', 'dStreet', 'dUnit', 'dCity', 'dState', 'dZip', 'dNotes', 'aFlightsN', 'aFloor', 'aHours', 'aElevStepsN', 'c2Name', 'c2Phone', 'c2Email'].forEach((id) => $('#' + id).addEventListener('input', (e) => {
    e.target.classList.remove('bad');
    if (id === 'dName' || id === 'dEmail') { const pl = $('#payerLine'); if (pl) pl.innerHTML = payerLineHtml(); }
    if (id === 'dZip' || id === 'dState') { scheduleQuote(); scheduleAvail(); renderDatesVisibility(); }
  }));
  const am = $('#aMode');
  am.innerHTML = '<option value="">Choose…</option>' + CFG.access.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  $('#aFlights').innerHTML = '<option value="">Choose…</option>' + CFG.flights.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  window.syncStairsQ = () => {
    const show = am.value === 'stairs' && !!$('#aFlights').value && !!(S.quote && S.quote.stairsFollowUp);
    $('#aStairsQWrap').hidden = !show;
    if (show && S.draftStairs) { $('#aShape').value = S.draftStairs.shape || ''; $('#aTight').value = S.draftStairs.tight || ''; S.draftStairs = null; }
    else if (!show && S.quote) { $('#aShape').value = ''; $('#aTight').value = ''; }
  };
  const syncAccess = () => {
    const m = am.value; const fl = $('#aFlights').value;
    $('#aFlightsWrap').hidden = m !== 'stairs'; $('#aFlightsNWrap').hidden = !(m === 'stairs' && fl === '4plus'); $('#aFloorWrap').hidden = m !== 'elevator';
    $('#aElevTypeWrap').hidden = m !== 'elevator'; $('#aElevResWrap').hidden = m !== 'elevator';
    $('#aElevStepsWrap').hidden = m !== 'elevator'; $('#aElevStepsNWrap').hidden = !(m === 'elevator' && $('#aElevSteps').value === 'yes');
    syncStairsQ(); scheduleQuote();
  };
  am.addEventListener('change', () => { am.classList.remove('bad'); syncAccess(); });
  $('#aFlights').addEventListener('change', (e) => { e.target.classList.remove('bad'); syncAccess(); });
  $('#aFlightsN').addEventListener('input', scheduleQuote);
  $('#aElevType').addEventListener('change', (e) => e.target.classList.remove('bad'));
  ['aShape', 'aTight'].forEach((id) => $('#' + id).addEventListener('change', (e) => e.target.classList.remove('bad')));
  $('#aElevSteps').addEventListener('change', (e) => { e.target.classList.remove('bad'); syncAccess(); });
  // second client (optional)
  $('#addClient').addEventListener('click', () => { $('#client2').hidden = false; $('#addClient').hidden = true; $('#c2Name').focus(); });
  $('#c2Remove').addEventListener('click', () => { ['c2Name', 'c2Phone', 'c2Email'].forEach((id) => { $('#' + id).value = ''; $('#' + id).classList.remove('bad'); }); $('#client2').hidden = true; $('#addClient').hidden = false; scheduleQuote(); });
  // dates + dedicated boxes (event delegation on the split-screen pair)
  const datesRoot = $('#sec-dates');
  datesRoot.addEventListener('click', (e) => {
    if (e.target.closest('[data-off]')) { e.preventDefault(); return; }
    const pu = e.target.closest('[data-pu]');
    if (pu) { S.pickupDate = pu.dataset.pu; if (S.deliveryDate && S.deliveryDate < S.pickupDate) { S.deliveryDate = ''; S.deFrom = ''; S.deMore = false; } renderDays(); refreshDelivery(); scheduleQuote(); return; }
    const de = e.target.closest('[data-de]');
    if (de) { S.deliveryDate = de.dataset.de; renderDays(); scheduleQuote(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { S[more.dataset.more + 'More'] = true; renderDays(); return; }
    const back = e.target.closest('[data-back]');
    if (back) { const k = back.dataset.back; S[k + 'From'] = ''; S[k + 'More'] = false; if (k === 'pu') { if (!dedOn('pickup')) S.pickupDate = ''; refreshDates(); } else { if (!dedOn('delivery')) S.deliveryDate = ''; refreshDelivery(); } return; }
    const clr = e.target.closest('[data-clear]');
    if (clr) { const k = clr.dataset.clear; if (k === 'pu') S.pickupDate = ''; else S.deliveryDate = ''; renderDays(); scheduleQuote(); if (k === 'pu' && !dedOn('delivery')) refreshDelivery(); return; }
  });
  datesRoot.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-later]') && t.value) {
      const k = t.getAttribute('data-later'); S[k + 'From'] = t.value; S[k + 'More'] = false;
      if (k === 'pu') { if (!dedOn('pickup')) S.pickupDate = ''; if (!dedOn('delivery')) { S.deliveryDate = ''; S.deFrom = ''; } refreshDates(); } else { if (!dedOn('delivery')) S.deliveryDate = ''; refreshDelivery(); }
      return;
    }
    if (t.matches('[data-dedtoggle]')) { toggleDedicated(t.getAttribute('data-dedtoggle'), t.checked); return; }
    if (t.matches('[data-deddate]')) {
      const side = t.getAttribute('data-deddate');
      if (side === 'pickup') S.pickupDate = t.value; else S.deliveryDate = t.value;
      scheduleQuote(); renderDays(); renderSummary(); return;
    }
    if (t.matches('[data-customdate]')) { S.customDate = t.checked; if (!S.customDate) S.customDateNote = ''; scheduleQuote(); renderDays(); renderSummary(); return; }
  });
  datesRoot.addEventListener('input', (e) => {
    if (e.target.id === 'customDateNote') { S.customDateNote = e.target.value; e.target.classList.remove('bad'); }
  });
  // summary
  $('#sumBody').addEventListener('change', (e) => { if (e.target.id === 'mc') { S.courtesy = e.target.checked; runQuote(); } });
  $('#sumBody').addEventListener('click', (e) => {
    if (S.submitting) return;
    if (e.target.closest('#staffClear')) { clearStaff(); return; }
    if (e.target.closest('#payMore')) { openChevron('payOpen'); return; }
    if (e.target.id === 'place') place();
    else if (e.target.id === 'sendLink') place('link');
    else if (e.target.closest('[data-wallet]')) place('now', e.target.closest('[data-wallet]').dataset.wallet);
  });
  $('#sumBody').addEventListener('change', (e) => {
    if (e.target.name === 'payer') { S.payer = e.target.value; S.payError = ''; renderSummary(); }
  });
  $('#sumBody').addEventListener('submit', (e) => { if (e.target.id === 'pinForm') submitPin(e); else if (e.target.id === 'staffForm') submitStaff(e); });
  $('#sumBody').addEventListener('input', (e) => {
    if (e.target.id === 'staffCode') { S.staffVal = e.target.value; S.staffMsg = ''; e.target.classList.remove('bad'); const m = $('.sc-msg'); if (m) m.textContent = ''; return; }
    if (e.target.id === 'pinInput') { S.pinVal = e.target.value; e.target.classList.remove('bad'); return; }
    if (e.target.id === 'cardNum') { S.card = e.target.value.replace(/[^\d ]/g, ''); e.target.value = S.card; }
    else if (e.target.id === 'cardExp') S.exp = e.target.value;
    else if (e.target.id === 'cardCvc') S.cvc = e.target.value;
  });
  $('#form').addEventListener('submit', (e) => e.preventDefault());
  $('#form').addEventListener('keydown', (e) => {
    // Enter = Next (Add item inside the custom item form; nothing in the search box; never on the payment screen).
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || /^(checkbox|radio|file|button)$/.test(t.type)) return;
    e.preventDefault();
    if (t.closest('#customForm')) { $('#cAdd').click(); return; }
    if (t.id === 'search' || visibleSteps()[stepI] === 'review') return;
    goNext();
  });
  $('#nextBtn').addEventListener('click', goNext);
  $('#backBtn').addEventListener('click', goBack);
  $('#skipLink').addEventListener('click', (e) => { e.preventDefault(); showStep(visibleSteps().indexOf('client')); });
  $('#reviewBody').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (!b) return; returnToReview = true; showStep(visibleSteps().indexOf(b.dataset.edit)); });
  window.addEventListener('popstate', (e) => {
    const n = e.state && e.state.palStep; if (n == null || S.submitting) return;
    showStep(Math.min(n, firstProblemStep()), { push: false });
  });
  // Once a screen has shown what's missing, keep it honest as the customer fixes things.
  ['input', 'change', 'click'].forEach((ev) => $('#form').addEventListener(ev, () => setTimeout(refreshStepErrors, 0)));
}

/* ---------- keep the draft across a refresh / accidental back (sessionStorage, this tab only) ---------- */
const DRAFT_KEY = 'palomas-draft';
const DRAFT_FIELDS = ['placedOther', 'dName', 'dPhone', 'dEmail', 'dStreet', 'dUnit', 'dCity', 'dState', 'dZip', 'dNotes', 'aHours', 'aFloor', 'aFlightsN', 'aElevStepsN', 'c2Name', 'c2Phone', 'c2Email', 'aMode', 'aFlights', 'aElevType', 'aElevSteps', 'aShape', 'aTight'];
let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      const f = {}; DRAFT_FIELDS.forEach((id) => { const el = $('#' + id); if (el) f[id] = el.value; });
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ items: S.items, pickup: S.pickup, client2: !$('#client2').hidden, f, uid, step: stepI }));
    } catch (_) { /* storage full or blocked: ignore */ }
  }, 250);
}
function restoreDraft() {
  let d = null; try { d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { d = null; }
  if (!d || !Array.isArray(d.items)) return 0;
  S.items = d.items.filter((i) => i && typeof i === 'object'); uid = Math.max(uid, d.uid || 1, ...S.items.map((i) => (i.uid || 0) + 1));
  if (d.pickup) { const r = document.querySelector(`input[name=pickup][value="${d.pickup}"]`); if (r) { r.checked = true; S.pickup = d.pickup; document.querySelectorAll('.radio').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked)); } }
  if (d.client2) { $('#client2').hidden = false; $('#addClient').hidden = true; }
  Object.entries(d.f || {}).forEach(([id, v]) => { const el = $('#' + id); if (el && typeof v === 'string' && v) el.value = v; });
  if ($('#placedOther').value) S.placedOther = $('#placedOther').value;
  S.draftStairs = { shape: (d.f || {}).aShape || '', tight: (d.f || {}).aTight || '' };
  $('#aMode').dispatchEvent(new Event('change')); if ($('#aFlights').value) $('#aFlights').dispatchEvent(new Event('change'));
  ['aElevSteps'].forEach((id) => { if ($('#' + id).value) $('#' + id).dispatchEvent(new Event('change')); });
  if (S.items.length) itemsChanged(true); scheduleAvail();
  const old = ['start', 'items', 'client', 'address', 'access', 'notes', 'dates', 'review'];
  const raw = parseInt(d.step, 10) || 0;
  const id = old[raw] || 'start';
  const vis = visibleSteps();
  const mapped = id === 'notes' ? vis.indexOf('address') : vis.indexOf(id);
  return Math.max(0, Math.min(mapped >= 0 ? mapped : 0, vis.length - 2));
}

(async function init() {
  const r = await fetch('/api/palomas/config'); CFG = await r.json();
  if (CFG.pay.testMode) { S.card = '4242 4242 4242 4242'; S.exp = '12 / 34'; S.cvc = '123'; }
  bind(); renderCats(); renderCatalog(); renderItems(); renderSummary();
  const resume = restoreDraft() || 0;
  showStep(Math.min(resume, firstProblemStep()), { push: false });
  ['input', 'change', 'click'].forEach((ev) => document.addEventListener(ev, (e) => { if (e.target && e.target.closest && e.target.closest('#form')) saveDraft(); }));
})();
})();
