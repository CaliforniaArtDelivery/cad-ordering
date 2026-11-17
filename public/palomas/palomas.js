(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const n = Number(String(v ?? '').replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : 0; };

let CFG = null;
const S = {
  placedBy: '', placedOther: '', pickup: 'salinas', items: [], courtesy: false, staffOpen: false, puMore: false, deMore: false, puFrom: '', deFrom: '',
  payer: 'client', card: '', exp: '', cvc: '', payError: '',
  pickupDate: '', deliveryDate: '', puDays: [], deDays: [], quote: null, submitting: false, errors: [], showErrors: false,
};
let uid = 1, cat = 'All', quoteTok = 0, availTok = 0, qTimer = 0, aTimer = 0;

const ACC = () => new Set(CFG.kinds.accents);
const STD_SIZES = () => CFG.kinds.sizeLabels.standard;
const ACC_SIZES = () => CFG.kinds.sizeLabels.accents;
const sizesFor = (kind) => (ACC().has(kind) ? ACC_SIZES() : STD_SIZES());
const isMirror = (kind) => kind === 'Mirror';
const delivery = () => ({
  name: $('#dName').value.trim(), phone: $('#dPhone').value.trim(), email: $('#dEmail').value.trim(), street: $('#dStreet').value.trim(),
  unit: $('#dUnit').value.trim(), city: $('#dCity').value.trim(), state: ($('#dState').value.trim() || 'CA').toUpperCase(), zip: $('#dZip').value.trim(), notes: $('#dNotes').value.trim(),
});
const access = () => ({ mode: $('#aMode').value, flights: $('#aFlights').value, flightsCount: $('#aFlightsN').value.trim(), floor: $('#aFloor').value.trim(), elevatorType: $('#aElevType').value, elevatorReserve: $('#aElevRes').checked, elevSteps: $('#aElevSteps').value, elevStepsN: $('#aElevStepsN').value.trim(), hours: $('#aHours').value.trim(), tight: $('#aTight').value.trim() });
const outOfState = () => { const d = delivery(); const z = parseInt(d.zip.slice(0, 3), 10); return (d.state && d.state !== 'CA') || (/^\d{5}/.test(d.zip) && !(z >= 900 && z <= 961)); };
const payload = (payMode = 'now') => ({
  payer: S.payer, payMode,
  placedBy: { name: S.placedBy, other: S.placedOther }, pickupLocation: S.pickup, courtesy: S.courtesy,
  items: S.items.map((i) => ({ name: i.name, kind: i.kind, size: i.size, value: num(i.value), qty: i.qty, catalogId: i.catalogId, custom: !!i.custom, oversized: !!i.oversized, w: i.w, h: i.h })),
  delivery: delivery(), access: access(), schedule: { date: S.pickupDate, deliveryDate: S.deliveryDate },
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
    return `<button type="button" class="pcard" data-add="${esc(c.id || c.name)}" aria-label="Add ${esc(c.name)}">
      <div class="th">${c.id ? `<img src="/palomas/thumbs/${esc(c.id)}.jpg" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('◇'))">` : '◇'}</div>
      <div class="pt"><b>${esc(c.name)}</b><span>${esc(c.dims || c.kind)}</span></div>${a ? `<i class="added">× ${a.qty}</i>` : ''}</button>`;
  }).join('') : `<div class="none">No match. Use “Add a custom item” below.</div>`;
  $('#catalogNote').textContent = `${CFG.catalog.length} pieces from palomascarmel.com. Don't see it? Add a custom item.`;
}
function addFromCatalog(key) {
  const c = CFG.catalog.find((x) => (x.id || x.name) === key); if (!c) return;
  const ex = S.items.find((i) => i.catalogId === key);
  if (ex) ex.qty = Math.min(99, ex.qty + 1);
  else S.items.push({ uid: uid++, name: c.name, kind: c.kind, size: c.size, value: c.price ? String(c.price) : '', qty: 1, catalogId: key, thumb: c.id || '', dims: c.dims, w: '', h: '' });
  itemsChanged(true);
}
function renderItems() {
  const box = $('#items');
  $('#itemCount').textContent = S.items.length ? `(${S.items.reduce((s, i) => s + i.qty, 0)})` : '';
  if (!S.items.length) { box.innerHTML = `<p class="empty">Nothing added yet. Tap a piece above.</p>`; return; }
  box.innerHTML = S.items.map((i) => {
    const sz = sizesFor(i.kind);
    return `<div class="irow" data-uid="${i.uid}">
      <div class="th">${i.thumb ? `<img src="/palomas/thumbs/${esc(i.thumb)}.jpg" alt="" onerror="this.replaceWith(document.createTextNode('◇'))">` : '◇'}</div>
      <div><div class="nm">${esc(i.name)}</div><div class="ty">${esc(i.kind)}${i.dims ? ' · ' + esc(i.dims) : ''}${i.custom ? ' · custom' : ''}</div>
        <div class="ctl">
          <div><span class="lbl">Qty</span><div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><input data-f="qty" value="${i.qty}" inputmode="numeric" aria-label="Quantity"><button type="button" data-q="1" aria-label="More">+</button></div></div>
          <div><span class="lbl">Size tier</span><select data-f="size" aria-label="Size tier">${sz.map(([k, l]) => `<option value="${k}" ${k === i.size ? 'selected' : ''} ${i.oversized && sz.findIndex(([x]) => x === k) < sz.findIndex(([x]) => x === 'large') ? 'disabled' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="v"><span class="lbl">Declared value (for our records)</span><div class="money"><i>$</i><input data-f="value" value="${esc(i.value)}" inputmode="decimal" placeholder="Optional" aria-label="Declared value (for our records), optional"></div></div>
        </div>
        <label class="check-sm"><input type="checkbox" data-f="oversized" ${i.oversized ? 'checked' : ''}><span>Oversized or very heavy <small>(e.g., 150+ lbs, marble, armoire)</small>${i.oversized ? '<em> Large tier applied, crew is told to bring extra help.</em>' : ''}</span></label>
        ${isMirror(i.kind) ? `<div class="dims">Face size, optional: <input data-f="w" value="${esc(i.w)}" inputmode="numeric" placeholder="W"> × <input data-f="h" value="${esc(i.h)}" inputmode="numeric" placeholder="H"> in</div>` : ''}
      </div><button type="button" class="rm" data-rm="1" aria-label="Remove ${esc(i.name)}">×</button></div>`;
  }).join('');
}
function itemsChanged(rerenderRows) {
  if (rerenderRows) renderItems();
  renderCatalog();
  scheduleQuote(); scheduleAvail();
}

/* ---------- pricing + summary ---------- */
function scheduleQuote() { clearTimeout(qTimer); qTimer = setTimeout(runQuote, 180); }
async function runQuote() {
  const tok = ++quoteTok;
  if (!S.items.length) { S.quote = null; renderSummary(); return; }
  const { ok, j } = await api('/api/palomas/quote', payload());
  if (tok !== quoteTok) return;
  S.quote = ok ? j : null; renderSummary(); renderDatesVisibility();
}
function problems() {
  const out = [];
  const add = (msg, sel) => out.push({ msg, sel });
  const q = S.quote || {};
  if (!S.placedBy) add('Choose who is placing the order', '#placedBy');
  else if (S.placedBy === 'Other' && !S.placedOther.trim()) add('Type the name of who is placing the order', '#placedOther');
  if (!S.items.length) add('Add at least one item', '#sec-items');
  const d = delivery();
  if (!d.name) add('Client name', '#dName');
  if (d.phone.replace(/\D/g, '').length < 7) add('Client phone', '#dPhone');
  if (!/\S+@\S+\.\S+/.test(d.email)) add('Client email', '#dEmail');
  if (!d.street) add('Delivery street address', '#dStreet');
  if (!d.city) add('City', '#dCity');
  if (!/^\d{5}(-\d{4})?$/.test(d.zip)) add('ZIP code', '#dZip');
  const a = access();
  if (!a.mode) add('How we get in at delivery', '#aMode');
  if (a.mode === 'stairs' && !a.flights) add('Flights of stairs', '#aFlights');
  if (a.mode === 'stairs' && a.flights === '4plus' && !(parseInt(a.flightsCount, 10) >= 4)) add('How many flights (4 or more)', '#aFlightsN');
  if (a.mode === 'elevator' && !a.floor) add('Elevator floor', '#aFloor');
  if (a.mode === 'elevator' && !a.elevatorType) add('Which elevator (freight or passenger)', '#aElevType');
  if (a.mode === 'elevator' && !a.elevSteps) add('Any steps before or after the elevator', '#aElevSteps');
  if (a.mode === 'elevator' && a.elevSteps === 'yes' && !(parseInt(a.elevStepsN, 10) >= 1)) add('How many steps', '#aElevStepsN');
  if (!q.special && !outOfState() && /^\d{5}/.test(d.zip) && (!S.pickupDate || !S.deliveryDate)) add('Pickup and delivery days', '#sec-dates');
  return out;
}

const payerInfo = () => (S.payer === 'palomas' ? { name: "Paloma's Home Furnishings", email: CFG.pay.partnerEmail } : { name: delivery().name, email: delivery().email });
function payerLineHtml() { const p = payerInfo(); return p.name || p.email ? `Payer: <b>${esc(p.name || '—')}</b>${p.email ? ' · ' + esc(p.email) : ''}` : 'Payer: fill in the client name and email above.'; }
function shippingButton() {
  return `<button type="button" class="btn primary wide" id="place" ${S.submitting ? 'disabled' : ''}>${S.submitting ? 'Sending…' : 'Request shipping quote'}</button><p class="billing">No payment is taken online.</p>`;
}
function payBlock(q) {
  const pay = q.payment || {}; const deposit = pay.paymentPlan === 'deposit';
  const mock = !CFG.pay.stripe && CFG.pay.testMode, offline = !CFG.pay.stripe && !CFG.pay.testMode;
  let h = `<div class="payer" role="radiogroup" aria-label="Who is paying">
    <label class="prow ${S.payer === 'client' ? 'on' : ''}"><input type="radio" name="payer" value="client" ${S.payer === 'client' ? 'checked' : ''}><span><b>Client pays now</b><small>Card payment at checkout</small></span></label>
    <label class="prow ${S.payer === 'palomas' ? 'on' : ''}"><input type="radio" name="payer" value="palomas" ${S.payer === 'palomas' ? 'checked' : ''}><span><b>Paloma's is paying</b><small>Same card checkout, billed to Paloma's</small></span></label>
  </div>
  <p class="mini payerline" id="payerLine">${payerLineHtml()}</p>`;
  h += deposit
    ? `<div class="sl big rule due"><span>Due today<small>${esc(pay.paymentSummary || '')}</small></span><span class="a">${usd(pay.dueNow)}</span></div>`
    : `<div class="sl big rule due"><span>Due today<small>${esc(pay.paymentSummary || 'Covers the delivery as quoted')}</small></span><span class="a">${usd(pay.dueNow || q.total)}</span></div>`;
  if (q.accessFeeNote) h += `<p class="mini fee-note" id="feeNote">${esc(q.accessFeeNote)}</p>`;
  if (mock) {
    h += `<div class="cardbox"><div class="wallets"><button type="button" class="btn ghost wal" data-wallet="apple_pay">Apple Pay</button><button type="button" class="btn ghost wal" data-wallet="google_pay">Google Pay</button></div>
      <div class="or">or pay by card <em>test mode, no real charge</em></div>
      <label class="field"><span class="lbl">Card number</span><input id="cardNum" type="text" inputmode="numeric" autocomplete="cc-number" maxlength="23" value="${esc(S.card)}" placeholder="4242 4242 4242 4242"></label>
      <div class="two"><label class="field"><span class="lbl">Expiry</span><input id="cardExp" type="text" inputmode="numeric" autocomplete="cc-exp" maxlength="7" value="${esc(S.exp)}" placeholder="MM / YY"></label>
      <label class="field"><span class="lbl">CVC</span><input id="cardCvc" type="text" inputmode="numeric" autocomplete="cc-csc" maxlength="4" value="${esc(S.cvc)}" placeholder="123"></label></div></div>`;
  } else if (!offline) h += `<p class="mini" style="margin:8px 0">You'll finish on our secure Stripe checkout page (card or bank).</p>`;
  else h += `<p class="mini" style="margin:8px 0">Online payment isn't available right now. Please call us.</p>`;
  if (S.payError) h += `<div class="errs" role="alert"><b>Payment didn't go through.</b>${esc(S.payError)}</div>`;
  h += `<button type="button" class="btn primary wide" id="place" ${S.submitting || offline ? 'disabled' : ''}>${S.submitting ? 'Processing…' : 'Pay &amp; lock in delivery'}</button>`;
  if (S.payer === 'client') h += `<p class="linkrow"><button type="button" class="linkbtn" id="sendLink" ${S.submitting ? 'disabled' : ''}>Client can't pay now? Email them a payment link.</button></p>
    <p class="mini linknote">We email the client a link. The delivery isn't scheduled until it's paid.</p>`;
  return h;
}
function renderSummary() {
  const box = $('#sumBody'); const q = S.quote;
  const barTotal = $('#barTotal');
  if (!S.items.length || !q || q.empty) {
    box.innerHTML = `<p class="empty">Add an item to see pricing.</p>`;
    $('#bar').hidden = true; return;
  }
  let html = '';
  if (q.special) {
    html = `<div class="special"><b>Delivery outside California is quoted as Shipping.</b><br>${esc(q.quoteNote || 'Samantha prices it and emails you a quote. Nothing is charged until it is approved.')}</div>`;
    barTotal.textContent = 'Quote'; 
  } else {
    const extras = q.volumeOff > 0 || q.courtesyOff > 0;
    const each = (l) => (l.qty > 1 ? ` · ${Math.round(l.after * 100) % l.qty === 0 ? '' : 'about '}${usd(l.each)} each` : '');
    html += q.lines.map((l) => `<div class="li"><div class="li-l">${esc(l.label)}</div>
      <div class="li-p">${l.standard != null && l.standard !== l.amount ? `<s>${usd(l.standard)}</s> ` : ''}<b>${usd(l.amount)}</b><small> partnership price</small></div>
      ${extras ? `<div class="li-all"><span>After all discounts${esc(each(l))}</span><b>${usd(l.after)}</b></div>` : ''}</div>`).join('');
    html += `<div class="sl partner"><span>Paloma's Home Furnishings partnership pricing<small>25% off our standard rates</small></span><span class="a"><s>${usd(q.standard)}</s>${usd(q.partner)}</span></div>`;
    if (q.volumeEligible) html += `<div class="sl disc"><span>Additional ${q.rules.volumePct}% off (delivery orders of $${q.rules.volumeThreshold.toLocaleString('en-US')}+ after partnership pricing)</span><span class="a">−${usd(q.volumeOff)}</span></div>`;
    html += `<div class="sum-note">${q.volumeEligible ? '✓ ' : ''}Delivery orders of $${q.rules.volumeThreshold.toLocaleString('en-US')} or more (after partnership pricing) get an additional ${q.rules.volumePct}% off the whole delivery price.</div>`;
    if (q.courtesy) html += `<div class="sl disc"><span>Manager's courtesy</span><span class="a">−${usd(q.courtesyOff)}</span></div>`;
    html += `<div class="sl big rule"><span>Total</span><span class="a">${q.standard !== q.total ? `<s>${usd(q.standard)}</s>` : ''}${usd(q.total)}</span></div>`;
    // Discreet control: a small unlabeled chevron (aria-label "More"); the checkbox only exists in the page while it is expanded.
    html += `<div class="more"><button type="button" class="chev ${S.staffOpen ? 'open' : ''}" id="more" aria-label="More" aria-expanded="${S.staffOpen ? 'true' : 'false'}" aria-controls="morePanel"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
    if (S.staffOpen) html += `<div id="morePanel" class="morepanel"><label class="mc"><input type="checkbox" id="mc" ${S.courtesy ? 'checked' : ''}><span>Manager's courtesy (−${q.rules.courtesyPct}%)</span></label></div>`;
    if (q.notes && q.notes.length) html += q.notes.filter((n) => !/access/i.test(n)).map((n) => `<p class="mini">${esc(n)}</p>`).join('');
    barTotal.textContent = usd(q.total);
  }
  $('#bar').hidden = false;
  const errs = S.showErrors ? problems() : [];
  if (errs.length) html += `<div class="errs" role="alert"><b>Still needed:</b>${errs.map((e) => esc(e.msg)).join(' · ')}</div>`;
  html += q.special ? shippingButton() : payBlock(q);
  box.innerHTML = html;
}

/* ---------- dates ---------- */
function renderDatesVisibility() {
  const d = delivery();
  const ok = /^\d{5}/.test(d.zip) && !outOfState() && !(S.quote && S.quote.special);
  $('#datesBox').hidden = !ok || !S.puDays.length;
  $('#datesSub').textContent = outOfState() || (S.quote && S.quote.special)
    ? 'Delivery outside California is quoted as Shipping, so no dates are needed. We will email the quote.'
    : /^\d{5}/.test(d.zip) ? 'Pick a pickup day, then a delivery day. We pre-selected the earliest.' : 'Enter the delivery ZIP above and the available days appear here. We pre-select the earliest.';
}
const dayCard = (d, on, i, kind) => { const [w, m, n] = String(d.label).replace(',', '').split(' '); return `<button type="button" class="day ${on ? 'on' : ''} ${i === 0 ? 'early' : ''}" data-${kind}="${d.date}"><div class="dw">${esc(w)}</div><div class="dd">${esc(m)} ${esc(n)}</div><div class="rg">${esc(d.shortLabel || d.region || '')}</div></button>`; };
const SHOW_FIRST = 6; // the first few days, then "More dates" (up to 14) and "Later date"
function dayList(days, sel, kind, more) {
  const selIdx = days.findIndex((d) => d.date === sel);
  const all = more || selIdx >= SHOW_FIRST;
  return (all ? days : days.slice(0, SHOW_FIRST)).map((d, i) => dayCard(d, d.date === sel, i, kind)).join('');
}
function dayCtl(days, sel, kind) {
  const more = kind === 'pu' ? S.puMore : S.deMore, from = kind === 'pu' ? S.puFrom : S.deFrom;
  const selIdx = days.findIndex((d) => d.date === sel);
  const hidden = days.length > SHOW_FIRST && !(more || selIdx >= SHOW_FIRST);
  const min = (days[0] || {}).date || '';
  return `${hidden ? `<button type="button" class="linkbtn" data-more="${kind}">More dates (${days.length - SHOW_FIRST} more)</button>` : ''}
    <label class="later">Later date <input type="date" data-later="${kind}" min="${esc(from ? '' : min)}" value="${esc(from)}" aria-label="Choose a later ${kind === 'pu' ? 'pickup' : 'delivery'} date"></label>
    ${from ? `<button type="button" class="linkbtn" data-back="${kind}">Back to earliest dates</button>` : ''}`;
}
function renderDays() {
  $('#puDays').innerHTML = dayList(S.puDays, S.pickupDate, 'pu', S.puMore);
  $('#deDays').innerHTML = dayList(S.deDays, S.deliveryDate, 'de', S.deMore);
  $('#puCtl').innerHTML = S.puDays.length ? dayCtl(S.puDays, S.pickupDate, 'pu') : '';
  $('#deCtl').innerHTML = S.deDays.length ? dayCtl(S.deDays, S.deliveryDate, 'de') : '';
  const lab = (arr, v) => (arr.find((x) => x.date === v) || {}).label;
  $('#dateSummary').textContent = S.pickupDate && S.deliveryDate ? `Pickup ${lab(S.puDays, S.pickupDate) || S.pickupDate} · Delivery ${lab(S.deDays, S.deliveryDate) || S.deliveryDate}` : '';
  renderDatesVisibility();
}
function scheduleAvail() { clearTimeout(aTimer); aTimer = setTimeout(refreshDates, 250); }
async function refreshDates() {
  const tok = ++availTok; const d = delivery();
  if (!/^\d{5}/.test(d.zip) || outOfState()) { S.puDays = []; S.deDays = []; S.pickupDate = ''; S.deliveryDate = ''; renderDays(); return; }
  const { ok, j } = await api('/api/palomas/availability', { ...payload(), leg: 'pickup', from: S.puFrom });
  if (tok !== availTok) return;
  S.puDays = ok ? (j.days || []) : [];
  if (!S.puDays.some((x) => x.date === S.pickupDate)) S.pickupDate = (S.puDays[0] || {}).date || '';
  await refreshDelivery(tok);
}
async function refreshDelivery(tok = availTok) {
  if (!S.pickupDate) { S.deDays = []; S.deliveryDate = ''; renderDays(); return; }
  const { ok, j } = await api('/api/palomas/availability', { ...payload(), leg: 'dropoff', pickupDate: S.pickupDate, from: S.deFrom });
  if (tok !== availTok) return;
  S.deDays = ok ? (j.days || []) : [];
  if (!S.deDays.some((x) => x.date === S.deliveryDate)) S.deliveryDate = (S.deDays[0] || {}).date || '';
  renderDays(); renderSummary();
}

/* ---------- submit ---------- */
async function place(mode = 'now', wallet = '') {
  S.showErrors = true; S.payError = '';
  const errs = problems();
  if (errs.length) {
    renderSummary(); renderItems();
    const el = $(errs[0].sel); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (el.focus && el.tagName !== 'SECTION') el.focus({ preventScroll: true }); }
    markBad(errs); return;
  }
  const special = !!(S.quote && S.quote.special);
  const card = S.card.replace(/\s/g, '');
  if (!special && mode === 'now' && !wallet && !CFG.pay.stripe && CFG.pay.testMode && !/^\d{15,16}$/.test(card)) { S.payError = 'Enter a card number (test: 4242 4242 4242 4242), or use Apple Pay / Google Pay.'; renderSummary(); return; }
  S.submitting = true; renderSummary();
  const fail = (msg, title) => { S.submitting = false; renderSummary(); $('#sumBody').insertAdjacentHTML('afterbegin', `<div class="errs" role="alert"><b>${title}</b>${esc(msg || 'Please try again.')}</div>`); };
  const created = await api('/api/palomas/orders', payload(special ? 'now' : mode));
  if (!created.ok) return fail(created.j.error, "We couldn't place that order.");
  const j = created.j;
  if (special) { S.submitting = false; return showDone(j); }
  if (mode === 'link') { S.submitting = false; return showDone(j, 'link'); }
  if (j.order && j.order.status === 'confirmed') { S.submitting = false; return showDone(j, 'paid'); }
  const paid = await api(`/api/orders/${encodeURIComponent(j.id)}/pay`, wallet ? { method: wallet } : { method: 'card', card });
  if (!paid.ok) { S.submitting = false; S.payError = paid.j.error || 'Please check the card and try again.'; renderSummary(); return; }
  if (paid.j.redirect) { location.href = paid.j.redirect; return; }
  S.submitting = false; showDone({ id: j.id, quote: j.quote, order: paid.j.order }, 'paid');
}
function markBad(errs) { document.querySelectorAll('.bad').forEach((e) => e.classList.remove('bad')); errs.forEach((e) => { const el = $(e.sel); if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.classList.add('bad'); }); }
function showDone(j, how) {
  const o = j.order || {}; const q = j.quote || {}; const d = delivery();
  const shipping = o.status === 'pending_approval';
  const day = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '');
  $('#main').innerHTML = `<div class="done"><div class="ck">✓</div>
    <h2>${shipping ? 'Shipping quote requested' : how === 'link' ? 'Payment link sent' : 'Delivery locked in'}</h2>
    <p class="sub">Order <b>${esc(o.id || j.id)}</b>${shipping ? ' · Samantha will price it and email a quote.' : how === 'link' ? ` · we emailed ${esc(d.email)} a payment link. <b>Awaiting payment — not scheduled until paid.</b> We'll send a reminder each day until it's paid.` : ' · paid, and we have it from here.'}</p>
    <div class="box">
      <p><b>Placed by</b> ${esc(S.placedBy === 'Other' ? S.placedOther : S.placedBy)}</p>
      <p><b>Pickup</b> ${esc(S.pickup === 'salinas' ? 'Salinas warehouse, 329 Rianda St' : 'Carmel-by-the-Sea showroom, Ocean Ave at Mission St')}${S.pickupDate && !shipping ? ' · ' + esc(day(S.pickupDate)) : ''}</p>
      <p><b>Deliver to</b> ${esc(d.name)} · ${esc(d.street)}${d.unit ? ', ' + esc(d.unit) : ''}, ${esc(d.city)} ${esc(d.state)} ${esc(d.zip)}${S.deliveryDate && !shipping ? ' · ' + esc(day(S.deliveryDate)) : ''}</p>
      <p><b>Items</b> ${S.items.map((i) => `${i.qty} × ${esc(i.name)}`).join('; ')}</p>
      ${shipping ? '' : (((j.order || {}).quote || {}).lines || []).filter((l) => l.label === "Manager's courtesy").map((l) => `<p><b>Manager's courtesy</b> −${usd(Math.abs(l.amount))}</p>`).join('')}
      ${shipping ? '' : `<p><b>Total</b> ${usd(q.total)}${S.courtesy ? " (Manager's courtesy)" : ''}</p>`}
      ${shipping ? '' : `<p class="mini">${esc(q.accessFeeNote || (j.order && j.order.quote && j.order.quote.accessFeeNote) || '')}</p>`}
      ${shipping || how === 'link' ? '' : `<p><b>Paid today</b> ${usd(q.dueNow || q.total)}${o.quote && o.quote.balanceDue ? ' · balance ' + usd(o.quote.balanceDue) + ' due ' + esc(o.quote.balanceWhen || '') : ''} · by ${S.payer === 'palomas' ? "Paloma's Home Furnishings" : esc(d.name)}</p>`}
    </div>
    <button class="btn primary" id="again" type="button">Place another order</button></div>`;
  $('#bar').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#again').onclick = () => location.reload();
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
  const fillSize = () => { $('#cSize').innerHTML = sizesFor(kind.value).map(([k, l]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${esc(l)}</option>`).join(''); };
  kind.addEventListener('change', fillSize); fillSize();
  $('#cAdd').addEventListener('click', () => {
    const n = $('#cName').value.trim(), v = num($('#cValue').value);
    $('#cName').classList.toggle('bad', !n);
    if (!n) return;
    S.items.push({ uid: uid++, name: n, kind: kind.value, size: $('#cSize').value, value: v > 0 ? String(v) : '', qty: 1, catalogId: 'custom-' + uid, custom: true, thumb: '', dims: '', w: '', h: '' });
    $('#cName').value = ''; $('#cValue').value = ''; itemsChanged(true);
  });
  // item rows
  const rowOf = (el) => { const r = el.closest('.irow'); return r && S.items.find((i) => String(i.uid) === r.dataset.uid); };
  $('#items').addEventListener('click', (e) => {
    const it = rowOf(e.target); if (!it) return;
    if (e.target.closest('[data-rm]')) { S.items = S.items.filter((x) => x !== it); itemsChanged(true); return; }
    const q = e.target.closest('[data-q]'); if (q) { it.qty = Math.max(1, Math.min(99, it.qty + Number(q.dataset.q))); itemsChanged(true); }
  });
  $('#items').addEventListener('input', (e) => {
    const it = rowOf(e.target); const f = e.target.dataset.f; if (!it || !f) return;
    if (f === 'qty') { it.qty = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); }
    else if (f === 'value') { it.value = e.target.value.replace(/[^0-9.,]/g, ''); e.target.value = it.value; e.target.classList.remove('bad'); }
    else if (f === 'oversized') {
      it.oversized = e.target.checked;
      const order = sizesFor(it.kind).map(([k]) => k);
      if (it.oversized && order.indexOf(it.size) < order.indexOf('large')) it.size = 'large';
      itemsChanged(true); return;
    } else it[f] = e.target.value;
    scheduleQuote(); if (f === 'qty') scheduleAvail(); renderCatalog();
  });
  // delivery fields
  ['dName', 'dPhone', 'dEmail', 'dStreet', 'dUnit', 'dCity', 'dState', 'dZip', 'dNotes', 'aFlightsN', 'aFloor', 'aHours', 'aTight', 'aElevStepsN'].forEach((id) => $('#' + id).addEventListener('input', (e) => {
    e.target.classList.remove('bad');
    if (id === 'dName' || id === 'dEmail') { const pl = $('#payerLine'); if (pl) pl.innerHTML = payerLineHtml(); }
    if (id === 'dZip' || id === 'dState') { scheduleQuote(); scheduleAvail(); renderDatesVisibility(); }
  }));
  const am = $('#aMode');
  am.innerHTML = '<option value="">Choose…</option>' + CFG.access.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  $('#aFlights').innerHTML = '<option value="">Choose…</option>' + CFG.flights.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  const syncAccess = () => {
    const m = am.value; const fl = $('#aFlights').value;
    $('#aFlightsWrap').hidden = m !== 'stairs'; $('#aFlightsNWrap').hidden = !(m === 'stairs' && fl === '4plus'); $('#aFloorWrap').hidden = m !== 'elevator';
    $('#aElevTypeWrap').hidden = m !== 'elevator'; $('#aElevResWrap').hidden = m !== 'elevator'; $('#aMoreWrap').hidden = !m;
    $('#aElevStepsWrap').hidden = m !== 'elevator'; $('#aElevStepsNWrap').hidden = !(m === 'elevator' && $('#aElevSteps').value === 'yes');
    $('#accessHint').hidden = !(['stairs', 'not_sure'].includes(m) || (m === 'elevator' && ['yes', 'not_sure'].includes($('#aElevSteps').value)));
    scheduleQuote();
  };
  am.addEventListener('change', () => { am.classList.remove('bad'); syncAccess(); });
  $('#aFlights').addEventListener('change', (e) => { e.target.classList.remove('bad'); syncAccess(); });
  $('#aFlightsN').addEventListener('input', scheduleQuote);
  $('#aElevType').addEventListener('change', (e) => e.target.classList.remove('bad'));
  $('#aElevSteps').addEventListener('change', (e) => { e.target.classList.remove('bad'); syncAccess(); });
  // dates
  $('#puDays').addEventListener('click', (e) => { const b = e.target.closest('[data-pu]'); if (!b) return; S.pickupDate = b.dataset.pu; S.deliveryDate = ''; S.deFrom = ''; S.deMore = false; renderDays(); refreshDelivery(); });
  $('#deDays').addEventListener('click', (e) => { const b = e.target.closest('[data-de]'); if (!b) return; S.deliveryDate = b.dataset.de; renderDays(); });
  // date list controls: more dates / later date / back
  ['pu', 'de'].forEach((k) => {
    const ctl = $('#' + k + 'Ctl');
    ctl.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { S[k + 'More'] = true; renderDays(); }
      else if (e.target.closest('[data-back]')) { S[k + 'From'] = ''; S[k + 'More'] = false; if (k === 'pu') { S.pickupDate = ''; refreshDates(); } else { S.deliveryDate = ''; refreshDelivery(); } }
    });
    ctl.addEventListener('change', (e) => {
      if (!e.target.matches('[data-later]') || !e.target.value) return;
      S[k + 'From'] = e.target.value; S[k + 'More'] = false;
      if (k === 'pu') { S.pickupDate = ''; S.deliveryDate = ''; S.deFrom = ''; refreshDates(); } else { S.deliveryDate = ''; refreshDelivery(); }
    });
  });
  // summary
  $('#sumBody').addEventListener('change', (e) => { if (e.target.id === 'mc') { S.courtesy = e.target.checked; runQuote(); } });
  $('#sumBody').addEventListener('click', (e) => {
    if (S.submitting) return;
    if (e.target.closest('#more')) { S.staffOpen = !S.staffOpen; renderSummary(); const m = $('#more'); if (m) m.focus({ preventScroll: true }); return; }
    if (e.target.id === 'place') place();
    else if (e.target.id === 'sendLink') place('link');
    else if (e.target.closest('[data-wallet]')) place('now', e.target.closest('[data-wallet]').dataset.wallet);
  });
  $('#sumBody').addEventListener('change', (e) => {
    if (e.target.name === 'payer') { S.payer = e.target.value; S.payError = ''; renderSummary(); }
  });
  $('#sumBody').addEventListener('input', (e) => {
    if (e.target.id === 'cardNum') { S.card = e.target.value.replace(/[^\d ]/g, ''); e.target.value = S.card; }
    else if (e.target.id === 'cardExp') S.exp = e.target.value;
    else if (e.target.id === 'cardCvc') S.cvc = e.target.value;
  });
  $('#barBtn').addEventListener('click', (e) => { e.preventDefault(); $('#summary').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#form').addEventListener('submit', (e) => e.preventDefault());
  $('#form').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });
}

(async function init() {
  const r = await fetch('/api/palomas/config'); CFG = await r.json();
  if (CFG.pay.testMode) { S.card = '4242 4242 4242 4242'; S.exp = '12 / 34'; S.cvc = '123'; }
  bind(); renderCats(); renderCatalog(); renderItems(); renderSummary();
})();
})();
