/** Payment wording and the single unpaid-balance figure written to exactly one schedule leg. */
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function hasInvoice(o) { return !!(o && o.invoice && (o.invoice.issuedAt || o.invoice.number || o.invoice.id)); }
function payStatus(o) { return String((o && o.payment && o.payment.status) || ''); }

function unpaidBalance(o) {
  const q = (o && o.quote) || {};
  const st = payStatus(o);
  if (st === 'paid' && q.paymentPlan === 'deposit') return money(q.balanceDue);
  if (st === 'paid') return 0;
  if (st === 'ach_processing') return q.paymentPlan === 'deposit' ? money(q.balanceDue) : 0;
  return money(q.dueNow != null ? q.dueNow : q.total);
}

function paymentStatusLabel(o) {
  const st = payStatus(o);
  const due = unpaidBalance(o);
  if (st === 'paid' && due <= 0) return 'Paid';
  if (st === 'paid' && due > 0) return 'Paid, balance due';
  if (st === 'ach_processing') return 'Payment processing';
  if (hasInvoice(o)) return 'Invoiced';
  return 'Booked, payment pending';
}

// Schedule column AF has a STRICT dropdown: AMT DUE, Payment Requested, PAID,
// CHECK RECEIVED, Pending Job, ..., CASH RECEIVED, Cancelled Job, CASH/CHECK HANDOVER.
// UI/email copy stays in paymentStatusLabel ("Paid", "Payment processing", …); the
// sheet must use a listed token or the write is rejected and columns after it stay blank.
function sheetPaymentStatus(o) {
  const st = payStatus(o);
  const due = unpaidBalance(o);
  if (st === 'paid' && due <= 0) return 'PAID';
  if (st === 'paid' && due > 0) return 'AMT DUE';
  if (st === 'ach_processing') return 'Payment Requested';
  if (hasInvoice(o)) return 'Payment Requested';
  return 'AMT DUE';
}

function onePaymentRecord(o) {
  return {
    "Who's paying?": payerDisplay(o),
    'Amount Due': unpaidBalance(o),
    'Payment Status': sheetPaymentStatus(o),
    'Amount Paid': payStatus(o) === 'paid' || payStatus(o) === 'ach_processing' ? money(o.payment && o.payment.amount) : '',
    'Pymnt method': methodLabel(o),
  };
}

function payerDisplay(o) {
  if (!o) return '';
  if (o.payer === 'pickup' || o.payer === 'pu') return 'Pickup contact' + (o.pickup && o.pickup.contactName ? ': ' + o.pickup.contactName : '');
  if (o.payer === 'dropoff' || o.payer === 'del' || o.payer === 'delivery') return 'Delivery contact' + (o.dropoff && o.dropoff.contactName ? ': ' + o.dropoff.contactName : '');
  if (o.payer === 'other') {
    const p = o.payerOther || {};
    return [p.name, p.phone, p.email].filter(Boolean).join(' ').trim() || 'Someone else';
  }
  if (o.payer === 'partner') return (o.partner && o.partner.name) || 'Referring partner';
  if (o.partnerOrder && o.partnerInfo && o.partnerInfo.payer === 'palomas') return "Paloma's Home Furnishings";
  if (o.payer === 'me') {
    const c = o.contact || {};
    return c.name || 'Client';
  }
  const c = o.contact || {};
  return c.name || 'Client';
}

function methodLabel(o) {
  const p = o && o.payment;
  if (!p) return '';
  return ({ stripe: 'card', stripe_card: 'card', stripe_ach: 'ACH', mock: 'card (TEST)', mock_card: 'card (TEST)', mock_ach: 'ACH (TEST)', mock_apple_pay: 'Apple Pay (TEST)', mock_google_pay: 'Google Pay (TEST)' }[p.method] || p.method || '');
}

module.exports = { money, hasInvoice, payStatus, unpaidBalance, paymentStatusLabel, sheetPaymentStatus, onePaymentRecord, payerDisplay, methodLabel };
