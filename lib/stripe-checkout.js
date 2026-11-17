/* Stripe Checkout helpers (TEST mode only; server.js refuses live keys).
 * Main-site orders keep the explicit card + ACH methods. Paloma's orders (partnerOrder) leave payment_method_types out, so Checkout uses
 * the account's dynamic payment methods: cards, Apple Pay, Google Pay, Link, bank debit and anything else enabled in the Stripe Dashboard.
 * Env needed: STRIPE_SECRET_KEY (sk_test_…), STRIPE_WEBHOOK_SECRET (whsec_…, for POST /api/stripe/webhook), BASE_URL. */
function sessionParams(o, { baseUrl, currency, companyName, customerId, saveMethod }) {
  const partner = !!o.partnerOrder;
  return {
    mode: 'payment',
    ...(customerId ? { customer: customerId, customer_update: { name: 'auto', address: 'auto' } } : { customer_email: o.contact.email }),
    ...(partner ? {} : {
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: { us_bank_account: { financial_connections: { permissions: ['payment_method'] } } },
    }),
    ...(saveMethod ? { payment_intent_data: { setup_future_usage: 'off_session' } } : {}),
    line_items: [{ quantity: 1, price_data: { currency, unit_amount: Math.round(o.quote.dueNow * 100), product_data: { name: `${companyName}: ${o.serviceLabel}`, description: `Order ${o.id}` } } }],
    metadata: { orderId: o.id, saveMethod: saveMethod ? '1' : '0', ...(partner ? { partner: '1' } : {}) },
    success_url: `${baseUrl}/?order=${o.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?order=${o.id}&canceled=1`,
  };
}

/** A confirmed-order payment record from a Checkout Session, or null when nothing has been paid or is processing yet. */
function paymentFromSession(s, orderId) {
  if (!s || !s.metadata || s.metadata.orderId !== orderId) return null;
  if (s.payment_status !== 'paid' && s.payment_status !== 'processing') return null;
  const partner = s.metadata.partner === '1';
  const pm = s.payment_method_types && s.payment_method_types[0];
  const ach = s.payment_status === 'processing' || (!partner && pm === 'us_bank_account');
  return {
    method: ach ? 'stripe_ach' : 'stripe_card',
    // job is confirmed now; ACH money is labeled as processing until the bank clears it
    status: ach ? 'ach_processing' : 'paid', achPending: ach,
    amount: (s.amount_total || 0) / 100, ref: s.id, saved: s.metadata.saveMethod === '1',
  };
}

/** Which webhook events settle an order. Async methods only settle on async_payment_succeeded (or completed with payment_status paid). */
const SETTLES = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
function orderFromEvent(evt) {
  if (!evt || !SETTLES.has(evt.type)) return null;
  const s = evt.data && evt.data.object;
  const id = s && s.metadata && s.metadata.orderId;
  if (!id) return null;
  const payment = paymentFromSession(s, id);
  return payment ? { orderId: id, payment, session: s } : null;
}
module.exports = { sessionParams, paymentFromSession, orderFromEvent };
