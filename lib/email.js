/** Email templates. Prototype: renders to ./outbox/*.html and logs to console. Never sends. */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { sheetDate } = require('./scheduling');
const OUT = require('./storage').dir('outbox');
const shipText = require('./shiptext');
const { itemLine, hangText, isHungItem } = require('./itemtypes');
const { stairsLabel } = require('./pricing');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const shell = (title, body) => `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0f1b2d">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#6b7280">${config.company.name}</div>
<h1 style="font-size:28px;font-weight:600;margin:12px 0 24px">${title}</h1>
<div style="background:#fff;border-radius:16px;padding:28px;line-height:1.55;font-size:16px">${body}</div>
<p style="font-size:12px;color:#9ca3af;margin-top:24px">${config.company.name} · ${config.company.phone} · ${config.company.email}<br>Prototype email: not actually sent.</p>
</div></body></html>`;

const payBlock = (o) => {
  const q = o.quote || {}, p = o.payment || {};
  if ((o.status === 'pending_approval' || q.paymentPlan === 'quote') && q.shipping) {
    return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 4px"><b>Status</b> Shipping quote requested — no payment is due yet</p>
<p style="margin:0">Samantha prices shipping for your pieces and destination and emails you a quote with a payment link. Nothing is charged until you approve it.</p></div>`;
  }
  if (o.status === 'pending_approval' || q.paymentPlan === 'quote') {
    const range = q.quoteRange ? `$${Number(q.quoteRange.low).toFixed(2)}–$${Number(q.quoteRange.high).toFixed(2)}` : '';
    return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 4px"><b>Status</b> Quote requested — no payment is due yet</p>
<p style="margin:0">Estimated range ${range} (1.5× to 2× the regular rate of $${Number(q.regularTotal || q.total).toFixed(2)}). CAD will email a final price and a payment link once the trip is approved.</p></div>`;
  }
  if (q.paymentPlan === 'deposit') {
    const paid = p.status === 'paid' || p.status === 'ach_processing';
    return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 4px"><b>${p.status === 'ach_processing' ? 'ACH processing' : paid ? 'Paid today' : 'Due at booking'} (${config.payment.depositPercent}%)</b> $${Number(p.amount || q.dueNow).toFixed(2)}</p>
<p style="margin:0"><b>Balance due ${q.balanceWhen}</b> $${Number(q.balanceDue).toFixed(2)}</p>
<p style="margin:8px 0 0;font-size:14px;color:#6b7280">Orders of $${config.payment.depositThreshold.toLocaleString()} or more are split 50/50: half at booking, half ${q.balanceWhen}.</p></div>`;
  }
  if (p.status === 'ach_processing') return `<p style="margin:0"><b>Payment</b> ACH processing — $${Number(p.amount || q.total).toFixed(2)} submitted at booking. Your job is confirmed.</p>`;
  if (p.status === 'paid') return `<p style="margin:0"><b>Payment</b> Paid in full at booking, $${Number(p.amount || q.total).toFixed(2)}</p>`;
  if (o.status === 'awaiting_payment') return `<p style="margin:0"><b>Payment</b> ${q.paymentSummary || 'Paid in full at booking'} — $${Number(q.dueNow || q.total).toFixed(2)} due today</p>`;
  return `<p style="margin:0"><b>Payment</b> Paid in full at booking, $${Number(q.total).toFixed(2)}</p>`;
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TIME_PREF_LABELS = { none: '', midday: 'Midday', afternoon: 'Afternoon / later in the day' };
const timePrefLine = (pref, note) => [TIME_PREF_LABELS[pref] || '', String(note || '').trim()].filter(Boolean).join(' — ');
const siteEmail = (title, a) => {
  if (!a || !a.street) return '';
  const lines = [];
  const add = (k, v) => { if (v) lines.push(`<p style="margin:0 0 4px"><b>${esc(k)}</b> ${v}</p>`); };
  add('On-site contact', [esc(a.contactName), esc(a.contactPhone)].filter(Boolean).join(' · '));
  add('Access hours', esc(a.hours));
  if (a.loadingDock) add('Loading dock', 'Yes');
  if (a.floor) add('Floor', esc(a.floor));
  if (a.fits === 'not_sure') add('Fit', 'Not sure it fits through doors/elevator');
  if (a.parkingRestricted) add('Parking / loading', esc(a.parkingNote || 'Restrictions'));
  if (a.technicalCarry) add('Carry', `Tight spaces, backyard or technical carry${(a.sitePhotos || []).length ? ` (${a.sitePhotos.length} photo(s))` : ''}`);
  if (a.wallType || a.hardware) add('Hanging', `${esc(a.wallType || 'wall type not sure')} · hardware: ${esc(a.hardware || 'not sure')}`);
  if (a.elevator) add('Elevator', 'Yes');
  const stairs = stairsLabel(a);
  if (stairs) add('Stairs', `${esc(stairs)}${a.elevator ? '' : ', no elevator'}`);
  else if (!a.elevator) add('Access', 'Ground level, no elevator');
  add('Special instructions', esc(a.notes));
  return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 8px"><b>${esc(title)}</b></p>
${lines.join('')}
</div>`;
};
const shipSummary = (o) => `<p style="margin:0 0 6px"><b>Request</b> ${o.id}</p>
<p style="margin:0 0 6px"><b>Service</b> Shipping</p>
${o.pickup && o.pickup.street ? `<p style="margin:0 0 6px"><b>Pickup</b> ${esc(o.pickup.street)}, ${esc(o.pickup.city)}${o.pickup.state ? ', ' + esc(o.pickup.state) : ''}</p>` : ''}
${shipText.lines(o).map(([k, v]) => `<p style="margin:0 0 6px"><b>${esc(k)}</b> ${esc(v)}</p>`).join('')}
${o.quote && o.quote.approvedPrice ? `<p style="margin:0 0 6px"><b>Total</b> $${Number(o.quote.total).toFixed(2)}</p>` : ''}
${payBlock(o)}
${o.pickup && o.pickup.street ? siteEmail('Pickup special instructions', o.pickup) : ''}
${o.dropoff && o.dropoff.street ? siteEmail('Destination special instructions', o.dropoff) : ''}`;
const summary = (o) => (o.service === 'crating_shipping' ? shipSummary(o) : `<p style="margin:0 0 6px"><b>Order</b> ${o.id}</p>
<p style="margin:0 0 6px"><b>Service</b> ${o.serviceLabel}${o.rush ? ' · rush' : ''}${o.dedicated ? ' · dedicated trip' : ''}</p>
<p style="margin:0 0 6px"><b>${o.schedule && o.schedule.deliveryDate ? 'Pickup' : 'Date'}</b> ${o.schedule && o.schedule.date ? sheetDate(o.schedule.date) : 'TBD'}${o.schedule && timePrefLine(o.schedule.timePref, o.schedule.timeNote) ? ' · ' + esc(timePrefLine(o.schedule.timePref, o.schedule.timeNote)) : ''}</p>
${o.schedule && o.schedule.deliveryDate ? `<p style="margin:0 0 6px"><b>Delivery</b> ${sheetDate(o.schedule.deliveryDate)}${timePrefLine(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote) ? ' · ' + esc(timePrefLine(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote)) : ''}</p>` : ''}
${o.pickup && o.pickup.street ? `<p style="margin:0 0 6px"><b>Pickup</b> ${esc(o.pickup.street)}, ${esc(o.pickup.city)}</p>` : ''}
${o.dropoff && o.dropoff.street ? `<p style="margin:0 0 6px"><b>Drop-off</b> ${esc(o.dropoff.street)}, ${esc(o.dropoff.city)}</p>` : ''}
<p style="margin:0 0 6px"><b>Items</b><br>${(o.items || []).map((i) => esc(itemLine(i) + (hangText(i) ? ' · ' + hangText(i) : ''))).join('<br>')}</p>
<p style="margin:0 0 6px"><b>${o.quote && o.quote.paymentPlan === 'quote' ? 'Regular-rate estimate' : 'Total'}</b> $${Number(o.quote.total).toFixed(2)}</p>
${payBlock(o)}
${o.pickup && o.pickup.street ? siteEmail('Pickup special instructions', o.pickup) : ''}
${o.dropoff && o.dropoff.street ? siteEmail(o.service === 'install_only' ? 'Installation special instructions' : 'Delivery special instructions', o.dropoff) : ''}`);

const payUrl = (o) => `${BASE_URL}/?order=${encodeURIComponent(o.id)}&pay=1`;

const TEMPLATES = {
  confirmation: (o) => ({ subject: `Your CAD order ${o.id} is confirmed`, html: shell(o.service === 'crating_shipping' ? 'Your shipment is confirmed.' : 'You’re on the route.', `<p>Hi ${o.contact.name.split(' ')[0]},</p><p>Thanks for booking with California Art Delivery. Here’s what we have:</p>${summary(o)}<p style="margin-top:18px">${o.service === 'crating_shipping' ? 'Samantha will confirm packing and pickup dates by email.' : 'We’ll send a reminder the day before and a live ETA when your handler is on the way.'}</p>`) }),
  reminder: (o) => ({ subject: `Reminder: CAD arrives ${sheetDate(o.schedule.date)}`, html: shell('See you tomorrow.', `<p>Hi ${o.contact.name.split(' ')[0]},</p><p>Your ${o.serviceLabel.toLowerCase()} is scheduled for <b>${sheetDate(o.schedule.date)}</b>${o.schedule.deliveryDate ? ' (delivery ' + sheetDate(o.schedule.deliveryDate) + ')' : ''}.</p><p>Please make sure the pieces are accessible and someone is on site. Reply to this email if anything has changed.</p>${summary(o)}`) }),
  eta: (o, extra = {}) => ({ subject: `CAD is on the way, ETA ${extra.eta || '45 min'}`, html: shell(`Arriving in ${extra.eta || '45 min'}.`, `<p>Hi ${o.contact.name.split(' ')[0]},</p><p>Your CAD handler is on the way to <b>${((o.service === 'pickup' ? o.pickup : o.dropoff) || {}).street || 'your address'}</b>. Estimated arrival: <b>${extra.eta || '45 minutes'}</b>.</p>${summary(o)}`) }),
  quote_received: (o) => (o.service === 'crating_shipping' ? { subject: `We received your CAD shipping quote request ${o.id}`, html: shell('Shipping quote request received.', `<p>Hi ${o.contact.name.split(' ')[0]},</p><p>Thank you for entrusting your pieces to California Art Delivery. ${o.outOfState ? 'Because this job involves an address outside California, it is custom quoted as Shipping. Within California we always provide white-glove delivery. ' : ''}Samantha is preparing your shipping quote and will email it with a payment link. There is <b>no charge yet</b>.</p>${summary(o)}`) } : { subject: `We received your CAD quote request ${o.id}`, html: shell('Quote request received.', `<p>Hi ${o.contact.name.split(' ')[0]},</p><p>Thanks for requesting a ${o.quote.quoteKind || 'rush or dedicated trip'} quote. We’ve sent this to Samantha to set a final price (she may consult Chad). There is <b>no charge yet</b> — we’ll email a final price and a payment link once the trip is approved.</p>${summary(o)}${o.dedicated ? '<p style="margin-top:18px">Dedicated trips are scheduled around existing jobs, not instead of them.</p>' : ''}`) }),
  quote_approved: (o) => ({ subject: `Your CAD quote ${o.id} is ready — please pay to confirm`, html: shell('Your quote is ready.', `<p>Hi ${o.contact.name.split(' ')[0]},</p><p>CAD has approved your ${o.quote.quoteKind || 'trip'} ${o.service === 'crating_shipping' ? 'request' : ''} and set a final price of <b>$${Number(o.quote.total).toFixed(2)}</b>.</p>${summary(o)}<p style="margin:18px 0"><a href="${payUrl(o)}" style="display:inline-block;background:#0f1b2d;color:#fff;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px">Pay ${o.quote.paymentPlan === 'deposit' ? 'the ' + config.payment.depositPercent + '% due today' : 'in full'} · $${Number(o.quote.dueNow).toFixed(2)}</a></p><p style="font-size:13px;color:#6b7280">Payment link (prototype, not sent): ${payUrl(o)}</p>`) }),
};

function send(kind, order, extra) {
  const tmpl = TEMPLATES[kind];
  if (!tmpl) throw new Error('unknown email template: ' + kind);
  const { subject, html } = tmpl(order, extra);
  const to = order.contact.email;
  const file = path.join(OUT, `${order.id}-${kind}-${Date.now()}.html`);
  fs.writeFileSync(file, html);
  console.log(`[email:${kind}] (not sent) to=${to} subject="${subject}" -> ${path.relative(process.cwd(), file)}`);
  return { kind, to, subject, file: path.basename(file), at: new Date().toISOString() };
}

module.exports = { send, TEMPLATES, payUrl };
