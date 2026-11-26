/** Email templates. Prototype: renders to ./outbox/*.html and logs to console. Never sends. */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { sheetDate } = require('./scheduling');
const OUT = require('./storage').dir('outbox');
const shipText = require('./shiptext');
const { itemLine, pieceDetail, hangText, isHungItem, piecesOf } = require('./itemtypes');
const ACCESS = require('../public/access');
const businessDays = require('./business-days');
const PS = require('./payment-status');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
// Every price in every email: $4,050.00 (commas, two decimals).
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPhone = (raw) => {
  const s = String(raw || '').trim();
  if (!s || s.startsWith('+')) return s;
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s;
};
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const shell = (title, body) => `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0f1b2d">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#6b7280">${config.company.name}</div>
<h1 style="font-size:28px;font-weight:600;margin:12px 0 24px">${title}</h1>
<div style="background:#fff;border-radius:16px;padding:28px;line-height:1.55;font-size:16px">${body}</div>
<p style="font-size:12px;color:#9ca3af;margin-top:24px">${config.company.name} · <a href="https://californiaartdelivery.com/pages/contact" style="color:#9ca3af">Contact Us</a> (californiaartdelivery.com/pages/contact) · ${config.company.email}<br>Prototype email: not actually sent.</p>
</div></body></html>`;

// Access flagged "Not sure" (mode, fit or elevator stairs): the price may still be adjusted, say so next to it.
const accessReviewed = (o) => !o.partnerOrder && !!(o.accessReview || ['pickup', 'dropoff'].some((k) => ACCESS.needsReview(o[k])));
const courtesyLine = (o) => { const l = ((o.quote || {}).lines || []).find((x) => x.label === "Manager's courtesy"); return l ? `<p style="margin:0 0 6px"><b>Manager's courtesy</b> −${usd(Math.abs(l.amount))}</p>\n` : ''; };
const feeNote = (o) => ((o.quote || {}).accessFeeNote ? `<p style="margin:10px 0 0;font-size:14px;color:#6b7280">${esc(o.quote.accessFeeNote)}</p>` : '');
const weightReviewed = (o) => ACCESS.weightUnconfirmed((o && o.items) || []);
const payBlock = (o) => payBlockBase(o) + feeNote(o)
  + (accessReviewed(o) && !(o.quote || {}).shipping ? `<p style="margin:10px 0 0"><b>${esc(ACCESS.PRICE_NOTE)}</b></p>` : '')
  + (weightReviewed(o) && !(o.quote || {}).shipping ? `<p style="margin:10px 0 0"><b>${esc(ACCESS.WEIGHT_NOTE)}</b></p>` : '');
const payBlockBase = (o) => {
  const q = o.quote || {}, p = o.payment || {};
  if ((o.status === 'pending_approval' || q.paymentPlan === 'quote') && q.shipping) {
    return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 4px"><b>Status</b> Shipping quote requested — no payment is due yet</p>
<p style="margin:0">Our shipping team prices shipping for your pieces and destination and emails you a quote with a payment link. Nothing is charged until you authorize payment.</p></div>`;
  }
  if (o.status === 'pending_approval' || q.paymentPlan === 'quote') {
    // A range only when it is a real range (rush). Never "$75.00–$75.00", never the multiplier.
    const r = q.quoteRange;
    const range = q.tripPremium && r && Number(r.high) > Number(r.low) ? `<p style="margin:0 0 4px"><b>Estimated range</b> ${usd(r.low)}–${usd(r.high)}</p>` : '';
    return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 4px"><b>Status</b> Quote requested. Nothing is charged yet.</p>
${range}<p style="margin:0">${businessDays.quoteEtaSentence()}</p></div>`;
  }
  if (q.paymentPlan === 'deposit') {
    const paid = p.status === 'paid';
    const dueLabel = p.status === 'ach_processing' ? 'Payment processing' : paid ? 'Paid today' : 'Due at booking';
    return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 4px"><b>${dueLabel} (${config.payment.depositPercent}%${accessReviewed(o) ? ' of the base price' : ''})</b> ${usd(p.amount || q.dueNow)}</p>
<p style="margin:0"><b>Balance due ${q.balanceWhen}${accessReviewed(o) ? ' (before access check)' : ''}</b> ${usd(q.balanceDue)}</p>
<p style="margin:8px 0 0;font-size:14px;color:#6b7280">Orders of $${config.payment.depositThreshold.toLocaleString('en-US')} or more are split 50/50: half at booking, half ${q.balanceWhen}.</p></div>`;
  }
  if (p.method === 'zelle' && p.status === 'zelle_requested') return `<div style="margin:0;padding:12px 14px;background:#f4f3ef;border-radius:10px"><p style="margin:0 0 6px"><b>Payment: Zelle requested (not yet received)</b></p>${zelleLines(o).map((l) => `<p style="margin:0 0 4px">${esc(l)}</p>`).join('')}</div>`;
  if (p.status === 'ach_processing') return `<p style="margin:0"><b>Payment</b> Payment processing: ${usd(p.amount || q.total)} submitted at booking. Your job is confirmed.</p>`;
  // Access "Not sure": the base price is paid now; never call it paid in full.
  if (accessReviewed(o)) return o.status === 'awaiting_payment' ? `<p style="margin:0"><b>${ACCESS.TBC_DUE}</b> ${usd(q.dueNow || q.total)}</p>` : `<p style="margin:0"><b>Paid today (base price)</b> ${usd(p.amount || q.total)}</p>`;
  if (p.status === 'paid') return `<p style="margin:0"><b>Payment</b> ${o.partnerOrder ? 'Paid today' : (weightReviewed(o) ? 'Paid today (weight to be confirmed)' : 'Paid in full at booking')}, ${usd(p.amount || q.total)}</p>`;
  if (o.status === 'awaiting_payment') return `<p style="margin:0"><b>Payment</b> ${q.paymentSummary || 'Due at booking'}: ${usd(q.dueNow || q.total)} due today</p>`;
  return `<p style="margin:0"><b>Payment</b> ${weightReviewed(o) ? 'Paid today (weight to be confirmed)' : 'Paid in full at booking'}, ${usd(q.total)}</p>`;
};

// Pay by Zelle instructions (Chad, Nov 25 2026). Same words on the confirmation page (public/app.js).
const zelleLines = (o) => {
  const Z = config.payment.zelle || {}, p = o.payment || {};
  const due = p.dueBy ? new Date(p.dueBy).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT' : 'within 24 hours';
  return [
    `Pay by Zelle: ${usd(p.amount != null ? p.amount : (o.quote || {}).dueNow)} to ${Z.payee || 'California Art Delivery, LLC'} at ${Z.email || 'contact@californiaartdelivery.com'}.`,
    `Put your order number ${o.id} in the Zelle memo.`,
    `Payment is due within 24 hours (by ${due}). Split transfers are OK as long as the full amount arrives on time.`,
    'Your time slot is held for 24 hours. If payment isn’t received by then, the slot may be released.',
  ];
};
// Itemized lines for every confirmation: each piece, then each price line and the total (Chad, Nov 25 2026).
const itemizedText = (o) => {
  const q = o.quote || {};
  const out = ['', 'Your pieces:'];
  piecesOf(o).forEach((it, n) => out.push(`  ${(o.partnerOrder ? itemLine(it) : pieceDetail(it, n))}`));
  if (q.paymentPlan === 'quote' && !q.approvedPrice) { out.push('', 'Price: set by our team (we’ll email it to you).'); return out; }
  const lines = (q.lines || []).filter((l) => l && l.label && Number(l.amount));
  if (lines.length) { out.push('', 'Price details:'); lines.forEach((l) => out.push(`  ${l.label}: ${Number(l.amount) < 0 ? '−' + usd(-l.amount) : usd(l.amount)}`)); }
  if (q.protection && q.protection.amount > 0 && !o.protectionDeclined && !lines.some((l) => l.kind === 'protection')) out.push(`  Declared value protection: ${usd(q.protection.amount)}`);
  if (q.discount && q.discount.amount > 0 && !lines.some((l) => l.kind === 'discount')) out.push(`  Discount ${q.discount.code || ''}: −${usd(q.discount.amount)}`);
  out.push(`  Total: ${usd(q.total)}`);
  return out;
};
const itemizedHtml = (o) => {
  const q = o.quote || {};
  const lines = (q.lines || []).filter((l) => l && l.label && Number(l.amount));
  if (!lines.length || (q.paymentPlan === 'quote' && !q.approvedPrice)) return '';
  return `<div style="margin:6px 0 10px"><p style="margin:0 0 4px"><b>Price details</b></p>${lines.map((l) => `<p style="margin:0 0 2px;padding-left:12px">${esc(l.label)}: ${Number(l.amount) < 0 ? '−' + usd(-l.amount) : usd(l.amount)}</p>`).join('')}</div>`;
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const timePrefLine = (pref, note) => [ACCESS.timePrefText(pref), String(note || '').trim()].filter(Boolean).join(' — ');
const siteContactLabel = (title) => {
  if (/^Pickup/i.test(title || '')) return 'Pickup contact';
  if (/^Install/i.test(title || '')) return 'Install contact';
  if (/^Destination/i.test(title || '')) return 'Destination contact';
  return 'Delivery contact';
};
const siteEmail = (title, a) => {
  if (!a || !a.street) return '';
  const lines = [];
  const add = (k, v) => { if (v) lines.push(`<p style="margin:0 0 4px"><b>${esc(k)}</b> ${v}</p>`); };
  add(siteContactLabel(title), [esc(a.contactName), esc(fmtPhone(a.contactPhone))].filter(Boolean).join(' · '));
  add('Access hours', esc(a.hours));
  add('Access', esc(ACCESS.summary(a).join(' · ')));
  if (a.parkingRestricted) add('Parking / loading', esc(a.parkingNote || 'Restrictions'));
  if (a.technicalCarry && !ACCESS.roughPath(a)) add('Carry', `Tight spaces, backyard or technical carry${(a.sitePhotos || []).length ? ` (${ACCESS.plural(a.sitePhotos.length, 'photo')})` : ''}`);
  if (a.wallType || a.hardware) add('Hanging', `${esc(a.wallType || 'wall type not sure')} · hardware: ${esc(a.hardware || 'not sure')}`);
  add('Special instructions', esc(a.notes));
  return `<div style="margin-top:14px;padding:14px 16px;background:#f4f3ef;border-radius:12px">
<p style="margin:0 0 8px"><b>${esc(title)}</b></p>
${lines.join('')}
</div>`;
};
const shipSummary = (o) => `<p style="margin:0 0 6px"><b>Request</b> ${o.id}</p>
<p style="margin:0 0 6px"><b>Service</b> Shipping</p>
${o.pickup && o.pickup.street ? `<p style="margin:0 0 6px"><b>Pickup</b> ${esc(o.pickup.street)}, ${esc(o.pickup.city)}${o.pickup.state ? ', ' + esc(o.pickup.state) : ''}</p>` : ''}
${shipText.lines(o, { customer: true }).map(([k, v]) => `<p style="margin:0 0 6px"><b>${esc(k)}</b> ${esc(v)}</p>`).join('')}
${o.quote && o.quote.approvedPrice ? `<p style="margin:0 0 6px"><b>Total</b> ${usd(o.quote.total)}</p>` : ''}
${payBlock(o)}
${o.pickup && o.pickup.street ? siteEmail('Pickup details', o.pickup) : ''}
${o.dropoff && o.dropoff.street ? siteEmail('Destination details', o.dropoff) : ''}`;
const usdSmart = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
// Declared value protection (Chad, Nov 16 2026; optional but included by default since Nov 19 2026): 1.5% of the declared value of pieces up to $50,000.
const protectionLine = (o) => {
  const pr = o.quote && o.quote.protection;
  if (o.protectionDeclined && o.quote && o.quote.protectionOption) return '<p style="margin:0 0 6px">Declared value protection: declined at your request.</p>';
  if (!pr || !(pr.amount > 0) || (o.quote.paymentPlan === 'quote' && !o.quote.approvedPrice)) return '';
  // Customers see the protection name and the dollar amount only — no rates or formulas.
  if (Array.isArray(pr.pieces) && pr.pieces.length > 1) {
    return `<p style="margin:0 0 6px"><b>Declared value protection</b>: ${usdSmart(pr.amount)}</p>`
      + pr.pieces.map((x) => `<p style="margin:0 0 4px;padding-left:12px">Piece ${x.piece}${x.description ? ' — ' + esc(x.description) : ''}: ${usdSmart(x.amount)}</p>`).join('');
  }
  return `<p style="margin:0 0 6px">Declared value protection: ${usdSmart(pr.amount)}</p>`;
};
const summary = (o) => (o.service === 'crating_shipping' ? shipSummary(o) : `<p style="margin:0 0 6px"><b>Order</b> ${o.id}</p>
<p style="margin:0 0 6px"><b>Service</b> ${o.serviceLabel}${o.rush ? ' · rush' : ''}${require('./dedicated-fee').label(o)}</p>
<p style="margin:0 0 6px"><b>${o.schedule && o.schedule.deliveryDate ? 'Pickup' : 'Date'}</b> ${o.schedule && o.schedule.date ? sheetDate(o.schedule.date) : 'TBD'}${o.schedule && timePrefLine(o.schedule.timePref, o.schedule.timeNote) ? ' · ' + esc(timePrefLine(o.schedule.timePref, o.schedule.timeNote)) : ''}</p>
${o.schedule && o.schedule.deliveryDate ? `<p style="margin:0 0 6px"><b>Delivery</b> ${sheetDate(o.schedule.deliveryDate)}${timePrefLine(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote) ? ' · ' + esc(timePrefLine(o.schedule.deliveryTimePref, o.schedule.deliveryTimeNote)) : ''}</p>` : ''}
${o.pickup && o.pickup.street ? `<p style="margin:0 0 6px"><b>Pickup</b> ${esc(o.pickup.street)}, ${esc(o.pickup.city)}</p>` : ''}
${o.dropoff && o.dropoff.street ? `<p style="margin:0 0 6px"><b>${o.service === 'install_only' ? 'Install address' : 'Delivery'}</b> ${esc(o.dropoff.street)}, ${esc(o.dropoff.city)}</p>` : ''}
<p style="margin:0 0 6px"><b>Items</b><br>${piecesOf(o).map((i, n) => esc((o.partnerOrder ? itemLine(i) : pieceDetail(i, n)) + (hangText(i) ? ' · ' + hangText(i) : ''))).join('<br>')}</p>
${itemizedHtml(o)}${courtesyLine(o)}${o.quote && o.quote.paymentPlan === 'quote' ? (o.quote.tripPremium && o.quote.regularTotal > 0 ? `<p style="margin:0 0 6px"><b>Regular rate</b> ${usd(o.quote.regularTotal)}</p>` : '') : `<p style="margin:0 0 6px"><b>${accessReviewed(o) ? ACCESS.TBC_TOTAL : 'Total'}</b> ${usd(o.quote.total)}</p>`}
${protectionLine(o)}
${payBlock(o)}
${o.pickup && o.pickup.street ? siteEmail('Pickup details', o.pickup) : ''}
${o.dropoff && o.dropoff.street ? siteEmail(o.service === 'install_only' ? 'Installation details' : 'Delivery details', o.dropoff) : ''}`);

const payUrl = (o) => `${BASE_URL}/?order=${encodeURIComponent(o.id)}&pay=1`;

// Why a non-shipping request needs Samantha's price (customer wording, no internal notes).
const quoteReasons = (o) => {
  const q = o.quote || {};
  const hang = (q.quoteHang && q.quoteHang.length ? q.quoteHang : (/chandelier|sconce/i.test(q.quoteKind || '') ? ['Chandelier'] : []))
    .map((k) => `${String(k).toLowerCase()} hanging`);
  return [
    o.rush && 'a rush date',
    o.customDate && 'your custom date request',
    ...hang,
    (q.customRequest || /custom request/.test(q.quoteKind || '')) && 'your custom request',
    (q.weightReview || /weight review/.test(q.quoteKind || '')) && 'a piece whose weight wasn’t provided',
  ].filter(Boolean);
};
const payButton = (o) => `<p style="margin:18px 0"><a href="${payUrl(o)}" style="display:inline-block;background:#0f1b2d;color:#fff;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px">Pay ${o.quote.paymentPlan === 'deposit' ? 'the ' + config.payment.depositPercent + '% due today' : 'in full'} · ${usd(o.quote.dueNow)}</a></p><p style="font-size:13px;color:#6b7280">Payment link (prototype, not sent): ${payUrl(o)}</p>`;
const ship = (o) => o.service === 'crating_shipping';

// extra.to / extra.name: send a copy to someone other than the booker (the payer).
const TEMPLATES = {
  confirmation: (o) => ({ subject: `Your CAD order ${o.id} is confirmed`, html: shell(ship(o) ? 'Your shipment is confirmed.' : 'You’re booked.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Thanks for booking with California Art Delivery. Here’s what we have:</p>${summary(o)}<p style="margin-top:18px">${ship(o) ? 'Our shipping team will confirm packing and pickup dates by email.' : 'We’ll be in touch before your date to confirm the arrival window.'}</p>`) }),
  payment_received: (o) => {
    const st = PS.payStatus(o);
    if (st === 'zelle_requested') return { subject: `CAD order ${o.id} is booked: Zelle payment due within 24 hours`, html: shell('Booked. Zelle payment due within 24 hours.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Your booking is in and your time slot is held for 24 hours while your Zelle payment arrives.</p>${summary(o)}`) };
    if (st === 'ach_processing') return { subject: `Payment processing for CAD order ${o.id}`, html: shell('Payment processing.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Thank you. Your bank payment is processing and your booking is confirmed. We’ll email you once it settles. We’ll be in touch before your date with your arrival window.</p>${summary(o)}`) };
    if (st !== 'paid') return { subject: `CAD order ${o.id} is booked`, html: shell('Booked, payment pending.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Your booking is in. ${PS.paymentStatusLabel(o)}. We’ll be in touch before your date with your arrival window.</p>${summary(o)}`) };
    return { subject: `We received your payment for CAD order ${o.id}`, html: shell('Payment received.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Thank you. Your payment is in and your booking is confirmed. We’ll be in touch before your date with your arrival window.</p>${summary(o)}`) };
  },
  reminder: (o) => ({ subject: `Reminder: CAD arrives ${sheetDate(o.schedule.date)}`, html: shell('See you tomorrow.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Your ${o.serviceLabel.toLowerCase()} is scheduled for <b>${sheetDate(o.schedule.date)}</b>${o.schedule.deliveryDate ? ' (delivery ' + sheetDate(o.schedule.deliveryDate) + ')' : ''}.</p><p>Please make sure the pieces are accessible and someone is on site. Reply to this email if anything has changed.</p>${summary(o)}`) }),
  eta: (o, extra = {}) => ({ subject: `CAD is on the way, ETA ${extra.eta || '45 min'}`, html: shell(`Arriving in ${extra.eta || '45 min'}.`, `<p>Hi ${esc(first(o.contact.name))},</p><p>Our team is on the way to <b>${esc(((o.service === 'pickup' ? o.pickup : o.dropoff) || {}).street || 'your address')}</b>. Estimated arrival: <b>${esc(extra.eta || '45 minutes')}</b>.</p>${summary(o)}`) }),
  // Paloma's partner flow: the client can't pay at the showroom, so they get a payment link. Nothing is scheduled until it is paid.
  payment_link: (o) => ({ subject: `Pay to lock in your CAD delivery ${o.id}`, html: shell('Pay to lock in your delivery.', `<p>Hi ${esc(first(o.contact.name))},</p><p>${esc((o.partnerInfo && o.partnerInfo.placedBy) || 'Our partner')} at ${esc(o.memberCompany || 'our partner')} set up a white glove delivery with California Art Delivery for you. <b>It isn’t scheduled until payment is received.</b> The dates below are held for you as requested and confirmed when you pay.</p>${summary(o)}${payButton(o)}`) }),
  payment_reminder: (o, extra = {}) => ({ subject: `Reminder: pay to lock in your CAD delivery ${o.id}`, html: shell('Your delivery isn’t locked in yet.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Just a reminder: your delivery from ${esc(o.memberCompany || 'our partner')} isn’t scheduled until payment is received.</p>${summary(o)}${payButton(o)}`) }),
  quote_received: (o) => (ship(o)
    ? { subject: `We received your CAD shipping request ${o.id}`, html: shell('Shipping request received.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Thank you for entrusting your pieces to California Art Delivery. ${o.outOfState ? 'Because this job involves an address outside California, it is quoted as Shipping. ' : ''}Our shipping team is preparing your shipping quote and will email it with a payment link ${businessDays.quoteReplyBy().text}. ${businessDays.authorizePaymentNote()}</p>${summary(o)}`) }
    : (() => {
      const why = quoteReasons(o);
      if (o.review && o.review.needed && !why.length) {
        const note = require('./date-guard-rules').customerNote(o.review);
        return { subject: `We received your CAD request ${o.id}`, html: shell('Request received.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Thanks for your request. ${esc(note)} We’ll email you ${businessDays.quoteReplyBy().text} to confirm your date and send your payment link. ${businessDays.authorizePaymentNote()}</p>${summary(o)}`) };
      }
      return { subject: `We received your CAD request ${o.id}`, html: shell('Request received.', `<p>Hi ${esc(first(o.contact.name))},</p><p>Thanks for your request.${why.length ? ` It includes ${andList(why)}, so our team prices it personally.` : ' Our team is pricing it personally.'} ${businessDays.quoteEtaSentence()}</p>${summary(o)}`) };
    })()),
  quote_approved: (o, extra = {}) => ({ subject: `Your CAD price for ${o.id} is ready`, html: shell('Your price is ready.', `<p>Hi ${esc(first(extra.name || o.contact.name))},</p><p>${extra.name ? `${esc(o.contact.name)} listed you as the payer for this booking. ` : ''}Your ${ship(o) ? 'shipping price' : 'price'} is set at <b>${usd(o.quote.total)}</b>. The booking is confirmed once payment goes through.</p>${summary(o)}${payButton(o)}`) }),
  // Payer = "Someone else": they hear about the booking from us, not only from the booker.
  payer_quote: (o, extra = {}) => ({ subject: `${o.contact.name} listed you as the payer for CAD request ${o.id}`, html: shell('You’re listed as the payer.', `<p>Hi ${esc(first(extra.name))},</p><p>${esc(o.contact.name)} has requested ${ship(o) ? 'a shipping quote' : 'a quote'} from California Art Delivery and listed you as the payer. When the price is ready we’ll email you a payment link. Nothing is charged until you authorize payment.</p>${summary(o)}<p style="margin-top:18px">Questions? Just reply to this email.</p>`) }),
  payer_receipt: (o, extra = {}) => ({ subject: `Receipt: CAD order ${o.id}`, html: shell('Booking receipt.', `<p>Hi ${esc(first(extra.name))},</p><p>${esc(o.contact.name)} booked with California Art Delivery and listed you as the payer. Here’s a copy of the booking and payment for your records.</p>${summary(o)}<p style="margin-top:18px">Questions? Just reply to this email.</p>`) }),
};

function send(kind, order, extra) {
  const tmpl = TEMPLATES[kind];
  if (!tmpl) throw new Error('unknown email template: ' + kind);
  const { subject, html } = tmpl(order, extra);
  const to = (extra && extra.to) || order.contact.email;
  const file = path.join(OUT, `${order.id}-${kind}${extra && extra.to ? '-copy' : ''}-${Date.now()}.html`);
  fs.writeFileSync(file, html);
  console.log(`[email:${kind}] (not sent) to=${to} subject="${subject}" -> ${path.relative(process.cwd(), file)}`);
  return { kind, to, subject, file: path.basename(file), at: new Date().toISOString() };
}

// Plain-text client confirmation (Chad, Nov 23 2026): short, booking id, dates, addresses, total paid. No staff names, no phone numbers.
function confirmationText(o, forPayer) {
  const day = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'TBD');
  const addr = (a) => (a && a.street ? [a.street, a.city, [a.state || 'CA', a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');
  const sc = o.schedule || {}, q = o.quote || {}, pay = o.payment || {};
  const lines = [forPayer ? `${o.contact.name} booked with California Art Delivery and listed you as the payer.` : 'You’re booked.', '', `Booking ${o.id}`, (o.serviceLabel || '') + require('./dedicated-fee').label(o)];
  const two = o.pickup && o.pickup.street && sc.deliveryDate;
  if (two) lines.push('', `Pickup: ${day(sc.date)}`, addr(o.pickup), '', `Delivery: ${day(sc.deliveryDate)}`, addr(o.dropoff));
  else lines.push('', `${o.service === 'install_only' ? 'Install' : 'Date'}: ${day(sc.date)}`, addr(o.service === 'install_only' ? o.dropoff : (o.dropoff || o.pickup)));
  const paid = Number(pay.amount != null ? pay.amount : q.dueNow) || 0;
  const st = PS.payStatus(o);
  const payLabel = st === 'paid' ? (q.paymentPlan === 'deposit' ? 'Paid today' : (ACCESS.weightUnconfirmed(o.items) ? 'Paid today (weight to be confirmed)' : 'Total paid'))
    : st === 'ach_processing' ? 'Payment processing (bank transfer, not yet cleared)'
    : st === 'zelle_requested' ? 'Zelle payment due within 24 hours'
    : PS.hasInvoice(o) ? 'Invoiced'
    : 'Booked, payment pending';
  lines.push(...itemizedText(o));
  lines.push('', `${payLabel}: ${usd(st === 'paid' || st === 'ach_processing' ? paid : (q.dueNow || q.total || 0))}`);
  if (st === 'zelle_requested') lines.push('', ...zelleLines(o));
  if (q.paymentPlan === 'deposit' && q.balanceDue) lines.push(`Balance due ${q.balanceWhen || 'at delivery'}: ${usd(q.balanceDue)}`);
  if (ACCESS.weightUnconfirmed(o.items)) lines.push('', ACCESS.WEIGHT_NOTE);
  lines.push('', 'As your date gets closer, and on the day, we’ll send you narrower arrival windows.', '', 'Questions? Just reply to this email.', '', 'California Art Delivery', 'californiaartdelivery.com');
  return { subject: st === 'zelle_requested' ? `You’re booked: ${o.id} (Zelle payment due within 24 hours)` : `You’re booked: ${o.id}`, body: lines.join('\n') };
}
// Plain-text "request received" for orders our team prices (rush, dedicated, custom, review): itemized too, so every order gets one.
function requestText(o, forPayer) {
  const day = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'to be arranged');
  const sc = o.schedule || {};
  const lines = [forPayer ? `${o.contact.name} sent a request to California Art Delivery and listed you as the payer.` : 'We received your request.', '', `Request ${o.id}`, (o.serviceLabel || '') + require('./dedicated-fee').label(o)];
  if (o.customDate) lines.push('', `Custom date request. Dates that would work: ${o.customDate.note || ''}`, 'We’ll confirm the date with you before anything is charged.');
  if (sc.date) lines.push('', `${sc.deliveryDate ? 'Pickup' : 'Date'} requested: ${day(sc.date)}`); if (sc.deliveryDate) lines.push(`Delivery requested: ${day(sc.deliveryDate)}`);
  lines.push(...itemizedText(o));
  lines.push('', `We’ll email your price and a payment link ${businessDays.quoteReplyBy().text}. Nothing is charged until you authorize payment.`, '', 'Questions? Just reply to this email.', '', 'California Art Delivery', 'californiaartdelivery.com');
  return { subject: `We received your request: ${o.id}`, body: lines.join('\n') };
}

module.exports = { send, TEMPLATES, payUrl, confirmationText, requestText, zelleLines, itemizedText };
