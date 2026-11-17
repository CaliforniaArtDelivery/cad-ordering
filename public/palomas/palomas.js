(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const n = Number(String(v ?? '').replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const PROTECTION_HINT = 'Its current value. Pieces valued up to $50,000 carry required declared value protection: 1.5% of their declared value.';
const PROTECTION_TERMS = 'Declared value protection applies to pieces with a declared value up to $50,000.';

let CFG = null;
const S = {
  placedBy: '', placedOther: '', pickup: 'salinas', items: [], priceSensitive: false,
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
const access = () => ({ mode: $('#aMode').value, flights: $('#aFlights').value, flightsCount: $('#aFlightsN').value.trim(), floor: $('#aFloor').value.trim() });
const outOfState = () => { const d = delivery(); const z = parseInt(d.zip.slice(0, 3), 10); return (d.state && d.state !== 'CA') || (/^\d{5}/.test(d.zip) && !(z >= 900 && z <= 961)); };
const payload = () => ({
  placedBy: { name: S.placedBy, other: S.placedOther }, pickupLocation: S.pickup, priceSensitive: S.priceSensitive,
  items: S.items.map((i) => ({ name: i.name, kind: i.kind, size: i.size, value: num(i.value), qty: i.qty, catalogId: i.catalogId, custom: !!i.custom, w: i.w, h: i.h })),
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
          <div><span class="lbl">Size</span><select data-f="size" aria-label="Size">${sz.map(([k, l]) => `<option value="${k}" ${k === i.size ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="v"><span class="lbl">Declared value</span><div class="money"><i>$</i><input data-f="value" value="${esc(i.value)}" inputmode="decimal" placeholder="0" aria-label="Declared value" class="${S.showErrors && !(num(i.value) > 0) ? 'bad' : ''}"></div></div>
        </div>
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
  S.items.forEach((i) => { if (!(num(i.value) > 0)) add(`Declared value for ${i.name}`, `[data-uid="${i.uid}"] [data-f=value]`); });
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
  if (!q.special && !outOfState() && /^\d{5}/.test(d.zip) && (!S.pickupDate || !S.deliveryDate)) add('Pickup and delivery days', '#sec-dates');
  return out;
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
    html += q.lines.map((l) => `<div class="sl"><span>${esc(l.label)}</span><span class="a">${usd(l.amount)}</span></div>`).join('');
    html += `<div class="sl partner"><span>Paloma's Home Furnishings partnership pricing<small>25% off our standard rates</small></span><span class="a"><s>${usd(q.standard)}</s>${usd(q.partner)}</span></div>`;
    if (q.volumeEligible) html += `<div class="sl disc"><span>Additional ${q.rules.volumePct}% off (delivery orders of $${q.rules.volumeThreshold.toLocaleString('en-US')}+)</span><span class="a">−${usd(q.volumeOff)}</span></div>`;
    html += `<div class="sum-note">${q.volumeEligible ? '✓ ' : ''}Any delivery order of $${q.rules.volumeThreshold.toLocaleString('en-US')} or more gets an additional ${q.rules.volumePct}% off the whole delivery price. That means an order just over $${q.rules.volumeThreshold.toLocaleString('en-US')} can cost less than one just under it. That's intended.</div>`;
    html += `<label class="check ${S.priceSensitive ? 'on' : ''}"><input type="checkbox" id="sens" ${S.priceSensitive ? 'checked' : ''}><span><b>Price sensitive client</b><span>Take an additional ${q.rules.sensitivePct}% off. Your call, no approval needed.</span></span></label>`;
    if (q.sensitive) html += `<div class="sl disc"><span>Price sensitive client: additional ${q.rules.sensitivePct}% off</span><span class="a">−${usd(q.sensitiveOff)}</span></div>`;
    if (q.protection && q.protectionAmount > 0) html += `<div class="sl"><span>Required declared value protection: 1.5% of ${usd(q.protection.eligibleValue).replace('.00', '')}</span><span class="a">${usd(q.protectionAmount)}</span></div>`;
    html += `<div class="sl big rule"><span>Total</span><span class="a">${usd(q.total)}</span></div>`;
    if (q.notes && q.notes.length) html += q.notes.filter((n) => !/access/i.test(n)).map((n) => `<p class="mini">${esc(n)}</p>`).join('');
    barTotal.textContent = usd(q.total);
  }
  $('#bar').hidden = false;
  const errs = S.showErrors ? problems() : [];
  if (errs.length) html += `<div class="errs" role="alert"><b>Still needed:</b>${errs.map((e) => esc(e.msg)).join(' · ')}</div>`;
  html += `<button type="button" class="btn primary wide" id="place" ${S.submitting ? 'disabled' : ''}>${S.submitting ? 'Placing order…' : q.special ? 'Request shipping quote' : 'Place order'}</button>`;
  html += `<p class="billing">${q.special ? 'No payment is taken online.' : `Billed to Paloma's Home Furnishings. Nothing to pay online.`}</p><p class="mini" style="text-align:center">${PROTECTION_TERMS}</p>`;
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
function renderDays() {
  $('#puDays').innerHTML = S.puDays.map((d, i) => dayCard(d, d.date === S.pickupDate, i, 'pu')).join('');
  $('#deDays').innerHTML = S.deDays.map((d, i) => dayCard(d, d.date === S.deliveryDate, i, 'de')).join('');
  const lab = (arr, v) => (arr.find((x) => x.date === v) || {}).label;
  $('#dateSummary').textContent = S.pickupDate && S.deliveryDate ? `Pickup ${lab(S.puDays, S.pickupDate) || S.pickupDate} · Delivery ${lab(S.deDays, S.deliveryDate) || S.deliveryDate}` : '';
  renderDatesVisibility();
}
function scheduleAvail() { clearTimeout(aTimer); aTimer = setTimeout(refreshDates, 250); }
async function refreshDates() {
  const tok = ++availTok; const d = delivery();
  if (!/^\d{5}/.test(d.zip) || outOfState()) { S.puDays = []; S.deDays = []; S.pickupDate = ''; S.deliveryDate = ''; renderDays(); return; }
  const { ok, j } = await api('/api/palomas/availability', { ...payload(), leg: 'pickup' });
  if (tok !== availTok) return;
  S.puDays = ok ? (j.days || []) : [];
  if (!S.puDays.some((x) => x.date === S.pickupDate)) S.pickupDate = (S.puDays[0] || {}).date || '';
  await refreshDelivery(tok);
}
async function refreshDelivery(tok = availTok) {
  if (!S.pickupDate) { S.deDays = []; S.deliveryDate = ''; renderDays(); return; }
  const { ok, j } = await api('/api/palomas/availability', { ...payload(), leg: 'dropoff', pickupDate: S.pickupDate });
  if (tok !== availTok) return;
  S.deDays = ok ? (j.days || []) : [];
  if (!S.deDays.some((x) => x.date === S.deliveryDate)) S.deliveryDate = (S.deDays[0] || {}).date || '';
  renderDays(); renderSummary();
}

/* ---------- submit ---------- */
async function place() {
  S.showErrors = true;
  const errs = problems();
  if (errs.length) {
    renderSummary(); renderItems();
    const el = $(errs[0].sel); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (el.focus && el.tagName !== 'SECTION') el.focus({ preventScroll: true }); }
    markBad(errs); return;
  }
  S.submitting = true; renderSummary();
  const { ok, j } = await api('/api/palomas/orders', payload());
  S.submitting = false;
  if (!ok) { S.showErrors = true; renderSummary(); const e = $('#sumBody'); e.insertAdjacentHTML('afterbegin', `<div class="errs" role="alert"><b>We couldn't place that order.</b>${esc(j.error || 'Please try again.')}</div>`); return; }
  showDone(j);
}
function markBad(errs) { document.querySelectorAll('.bad').forEach((e) => e.classList.remove('bad')); errs.forEach((e) => { const el = $(e.sel); if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.classList.add('bad'); }); }
function showDone(j) {
  const o = j.order || {}; const q = j.quote || {}; const d = delivery();
  const shipping = o.status === 'pending_approval';
  const day = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '');
  $('#main').innerHTML = `<div class="done"><div class="ck">✓</div>
    <h2>${shipping ? 'Shipping quote requested' : 'Order placed'}</h2>
    <p class="sub">Order <b>${esc(o.id || j.id)}</b>${shipping ? ' · Samantha will price it and email a quote.' : ' · we have it from here.'}</p>
    <div class="box">
      <p><b>Placed by</b> ${esc(S.placedBy === 'Other' ? S.placedOther : S.placedBy)}</p>
      <p><b>Pickup</b> ${esc(S.pickup === 'salinas' ? 'Salinas warehouse, 329 Rianda St' : 'Carmel-by-the-Sea showroom, Ocean Ave at Mission St')}${S.pickupDate && !shipping ? ' · ' + esc(day(S.pickupDate)) : ''}</p>
      <p><b>Deliver to</b> ${esc(d.name)} · ${esc(d.street)}${d.unit ? ', ' + esc(d.unit) : ''}, ${esc(d.city)} ${esc(d.state)} ${esc(d.zip)}${S.deliveryDate && !shipping ? ' · ' + esc(day(S.deliveryDate)) : ''}</p>
      <p><b>Items</b> ${S.items.map((i) => `${i.qty} × ${esc(i.name)}`).join('; ')}</p>
      ${shipping ? '' : `<p><b>Total</b> ${usd(q.total)}${S.priceSensitive ? ' (price sensitive client)' : ''}</p>`}
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
    $('#cName').classList.toggle('bad', !n); $('#cValue').classList.toggle('bad', !(v > 0));
    if (!n || !(v > 0)) return;
    S.items.push({ uid: uid++, name: n, kind: kind.value, size: $('#cSize').value, value: String(v), qty: 1, catalogId: 'custom-' + uid, custom: true, thumb: '', dims: '', w: '', h: '' });
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
    else it[f] = e.target.value;
    scheduleQuote(); if (f === 'qty') scheduleAvail(); renderCatalog();
  });
  // delivery fields
  ['dName', 'dPhone', 'dEmail', 'dStreet', 'dUnit', 'dCity', 'dState', 'dZip', 'dNotes', 'aFlightsN', 'aFloor'].forEach((id) => $('#' + id).addEventListener('input', (e) => {
    e.target.classList.remove('bad');
    if (id === 'dZip' || id === 'dState') { scheduleQuote(); scheduleAvail(); renderDatesVisibility(); }
  }));
  const am = $('#aMode');
  am.innerHTML = '<option value="">Choose…</option>' + CFG.access.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  $('#aFlights').innerHTML = '<option value="">Choose…</option>' + CFG.flights.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  const syncAccess = () => {
    const m = am.value; const fl = $('#aFlights').value;
    $('#aFlightsWrap').hidden = m !== 'stairs'; $('#aFlightsNWrap').hidden = !(m === 'stairs' && fl === '4plus'); $('#aFloorWrap').hidden = m !== 'elevator';
    $('#accessHint').hidden = !['stairs', 'not_sure'].includes(m);
    scheduleQuote();
  };
  am.addEventListener('change', () => { am.classList.remove('bad'); syncAccess(); });
  $('#aFlights').addEventListener('change', (e) => { e.target.classList.remove('bad'); syncAccess(); });
  $('#aFlightsN').addEventListener('input', scheduleQuote);
  // dates
  $('#puDays').addEventListener('click', (e) => { const b = e.target.closest('[data-pu]'); if (!b) return; S.pickupDate = b.dataset.pu; S.deliveryDate = ''; renderDays(); refreshDelivery(); });
  $('#deDays').addEventListener('click', (e) => { const b = e.target.closest('[data-de]'); if (!b) return; S.deliveryDate = b.dataset.de; renderDays(); });
  // summary
  $('#sumBody').addEventListener('change', (e) => { if (e.target.id === 'sens') { S.priceSensitive = e.target.checked; runQuote(); } });
  $('#sumBody').addEventListener('click', (e) => { if (e.target.id === 'place') place(); });
  $('#barBtn').addEventListener('click', (e) => { e.preventDefault(); $('#summary').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#form').addEventListener('submit', (e) => e.preventDefault());
  $('#form').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });
}

(async function init() {
  const r = await fetch('/api/palomas/config'); CFG = await r.json();
  bind(); renderCats(); renderCatalog(); renderItems(); renderSummary();
})();
})();
