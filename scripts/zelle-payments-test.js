/**
 * Payments round (Chad, Nov 25 2026): Pay by Zelle (books now, "Payment Requested", 24 h hold, flag never delete, never auto-PAID),
 * ACH shown as processing until Stripe confirms, itemized confirmation email for every order, no check / cash, no surcharge.
 * Real server + unchanged Code.gs in the mock bridge (never the live sheet, no real email).
 *   node scripts/zelle-payments-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { startBridge } = require('./mock-bridge');
const failures = [], passes = [];
const ok = (c, m) => { (c ? passes : failures).push(m); console.log(c ? '  ok  :' : '  FAIL:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 4300 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`, ADMIN = 'zelle-admin-key-0123456789';
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const get = async (p) => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const addr = (street, city, zip, extra = {}) => ({ street, city, zip, state: 'CA', contactName: 'Pat Contact', contactPhone: '310-555-0110', accessMode: 'ground', fits: 'yes', contactRole: 'Homeowner', ...extra });
const paint = (d, v, o = {}) => ({ type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: v, description: d, ...o });

(async () => {
  console.log('\n[1] Stripe ACH is processing until Stripe confirms (pure)');
  const SC = require('../lib/stripe-checkout');
  const sess = (st, types) => ({ id: 'cs_x', metadata: { orderId: 'CAD-1' }, payment_status: st, payment_method_types: types, amount_total: 100000 });
  ok(SC.paymentFromSession(sess('processing', ['card', 'us_bank_account']), 'CAD-1').status === 'ach_processing', 'bank payment still processing => "ach_processing" (shown as Payment processing, sheet "Payment Requested")');
  ok(SC.paymentFromSession(sess('paid', ['us_bank_account', 'card']), 'CAD-1').status === 'paid', 'a card payment is not mislabeled ACH just because bank is listed first');
  ok(SC.orderFromEvent({ type: 'checkout.session.async_payment_succeeded', data: { object: sess('paid', ['us_bank_account']) } }).payment.status === 'paid', 'async_payment_succeeded => paid (the only way ACH becomes PAID)');
  ok(SC.orderFromEvent({ type: 'checkout.session.async_payment_failed', data: { object: sess('unpaid', ['us_bank_account']) } }).failed === true, 'async_payment_failed is recognized (never shown as paid)');
  const PS = require('../lib/payment-status');
  const zo = { payment: { method: 'zelle', status: 'zelle_requested', amount: 500 }, quote: { dueNow: 500, total: 500 } };
  ok(PS.sheetPaymentStatus(zo) === 'Payment Requested' && PS.onePaymentRecord(zo)['Amount Paid'] === '' && PS.methodLabel(zo) === 'Zelle', 'Zelle order: AF "Payment Requested", no Amount Paid, method Zelle');
  ok(PS.sheetPaymentStatus({ payment: { method: 'stripe_ach', status: 'ach_processing', amount: 500 }, quote: { dueNow: 500, total: 500 } }) === 'Payment Requested', 'ACH processing is never PAID on the sheet');

  console.log('\n[2] Real server: Pay by Zelle');
  const seed = JSON.parse(fs.readFileSync('/workspace/fixtures/schedule-2026.json', 'utf8'));
  const bridge = await startBridge({ seed });
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-zelle-'));
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', ADMIN_KEY: ADMIN, BASE_URL: BASE, NODE_ENV: 'test', SKIP_GEOCODE: '1', SHEETS_WEBHOOK_URL: bridge.url, SHEETS_WEBHOOK_SECRET: bridge.secret, SHEETS_PUMP_MS: '250', SHEETS_BACKOFF_SCALE: '0.01', HOLD_MS: '60000', ZELLE_HOLD_HOURS: '0.0008', ZELLE_SWEEP_MS: '700' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', () => {});
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
    await sleep(900);
    const cfg = (await get('/api/config')).j;
    ok(cfg.payment.zelle && cfg.payment.zelle.enabled && cfg.payment.zelle.email === 'contact@californiaartdelivery.com' && cfg.payment.zelle.payee === 'California Art Delivery, LLC', 'site offers Pay by Zelle to California Art Delivery, LLC at contact@californiaartdelivery.com');
    ok(!/check|cash/i.test(JSON.stringify(cfg.payment.methods)) && !/surcharge/i.test(JSON.stringify(cfg.payment)), 'no public check or cash option and no card surcharge in the payment settings');
    const base = { service: 'pickup_delivery', contact: { name: 'Zelle Tester', email: 'zelle.tester@example.com', phone: '310-555-0100' }, payer: 'me', notes: '',
      pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: addr('1200 Summit Ridge Dr', 'Beverly Hills', '90210'),
      items: [paint('Oil on canvas by J. Smith', 5000), paint('Watercolor study', 1200)] };
    const av = (await post('/api/availability', base)).j;
    const D = av.days && av.days[0] && av.days[0].date;
    ok(!!D, `a date is offered (${D})`);
    const c = await post('/api/orders', { ...base, schedule: { date: D, deliveryDate: D, timePref: 'none', deliveryTimePref: 'none' } });
    ok(c.status === 200 && c.j.id, `order created (${c.status} ${c.j && (c.j.id || c.j.error)})`);
    const id = c.j.id;
    const z = await post(`/api/orders/${id}/pay`, { method: 'zelle' });
    const o = z.j && z.j.order;
    ok(z.status === 200 && o && o.status === 'confirmed' && o.payment.method === 'zelle' && o.payment.status === 'zelle_requested', 'Pay by Zelle books the order at once, payment "zelle_requested" (not paid)');
    ok(o && Math.abs(Date.parse(o.payment.dueBy) - Date.parse(o.payment.requestedAt) - 0.0008 * 3600e3) < 2000, 'payment due-by = request time + the hold window (24 h in production)');
    await sleep(1500);
    const rows = bridge.sheet('TEST SCHEDULE 2026') || bridge.sheet('SCHEDULE 2026');
    const mine = rows.cells.filter((r) => String(r[9] || '').includes(id));
    const beforeAll = rows.cells.map((r) => r.slice()); const mineIdx = rows.cells.map((r, i) => (String(r[9] || '').includes(id) ? i : -1)).filter((i) => i >= 0);
    ok(mine.length >= 1 && mine.filter((r) => r[31] === 'Payment Requested').length === 1 && mine.every((r) => ['Payment Requested', '...'].includes(r[31])), `schedule rows written; the payment leg has AF = "Payment Requested", never PAID (${mine.map((r) => r[31]).join(', ')})`);
    ok(mine.some((r) => /ZELLE REQUESTED/.test(String(r[34] || ''))) && mine.every((r) => r[32] === '' || r[32] == null), 'Payment Notes say ZELLE REQUESTED with the memo; Amount Paid stays empty');
    const conf = bridge.mails.find((m) => /zelle\.tester@example\.com/.test(m.to) && /booked/i.test(m.subject));
    ok(!!conf, `confirmation email delivered through the bridge (mock): "${conf && conf.subject}"`);
    ok(conf && /California Art Delivery, LLC/.test(conf.body) && /contact@californiaartdelivery\.com/.test(conf.body) && new RegExp(`order number ${id} in the Zelle memo`).test(conf.body) && /due within 24 hours/.test(conf.body) && /Split transfers are OK/.test(conf.body), 'confirmation email has the Zelle instructions (payee, email, memo = order number, 24 h, split transfers OK)');
    ok(conf && /Your pieces:/.test(conf.body) && /Oil on canvas by J\. Smith/.test(conf.body) && /Watercolor study/.test(conf.body) && /Price details:/.test(conf.body) && /Total: \$/.test(conf.body), 'confirmation email is itemized (each piece, each price line, total)');
    ok(conf && !/\(\d{3}\)\s?\d{3}-\d{4}|\bcall us\b/i.test(conf.body), 'no phone number or call-us prompt in the email');
    const teamReq = bridge.mails.find((m) => /ZELLE REQUESTED/.test(m.subject));
    ok(!!teamReq, `team heads-up sent: "${teamReq && teamReq.subject}"`);
    const again = await post(`/api/orders/${id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(again.j && again.j.order && again.j.order.payment.status === 'zelle_requested', 'paying again does not silently flip a Zelle order to paid');
    // 24 h passes (shortened for the test): flagged, alerted, nothing deleted.
    await sleep(3500);
    const flagged = (await get(`/api/admin/zelle?key=${ADMIN}`)).j;
    ok(flagged && flagged.overdue.some((r) => r.id === id), 'after the hold window the order is on the admin "overdue" Zelle list');
    ok(bridge.mails.some((m) => /ZELLE NOT VERIFIED IN 24 H/.test(m.subject) && m.subject.includes(id)), 'team alert "ZELLE NOT VERIFIED IN 24 H … release the slot?" sent once');
    ok(rows.cells.filter((r) => String(r[9] || '').includes(id)).length === mine.length, 'no schedule rows were deleted automatically');
    const still = (await get(`/api/orders/${id}`)).j.order;
    ok(still.payment.status === 'zelle_requested', 'still not PAID (the site never marks Zelle paid on its own)');
    ok((await get('/api/admin/zelle')).status === 401, 'the Zelle list needs the admin key');
    const v = await post(`/api/admin/orders/${id}/zelle-received?key=${ADMIN}`, { by: 'test' });
    ok(v.j && v.j.order && v.j.order.payment.status === 'paid' && v.j.order.payment.verifiedBy === 'test', 'only a person marking it received (admin) makes it PAID');
    await sleep(1500);
    { const now = rows.cells; const AD = 29;
      ok(now.length === beforeAll.length, `payment update added/removed no rows (${beforeAll.length} -> ${now.length})`);
      const outside = []; now.forEach((r, i) => { const b = beforeAll[i] || []; const lim = mineIdx.includes(i) ? AD : Math.max(r.length, b.length); for (let c = 0; c < lim; c++) if (String(r[c] == null ? '' : r[c]) !== String(b[c] == null ? '' : b[c])) outside.push(`row ${i + 3} col ${c + 1}`); });
      ok(!outside.length, `payment update (Code.gs v5 event "payment") changed only AD..AI on this order's rows; every other cell identical (${outside.slice(0, 5).join(', ') || 'none'})`);
      const changedPay = mineIdx.some((i) => beforeAll[i].slice(AD).join('|') !== now[i].slice(AD).join('|')); ok(changedPay, 'and AD..AI did change on the order rows'); }
    { const before = bridge.mails.length; const res = bridge.run('verifyAll'); const flag = bridge.mails.slice(before).filter((m) => m.body.includes(id));
      const ae = mineIdx.map((i) => `${beforeAll[i][30]} -> ${rows.cells[i][30]}`).join(', ');
      ok(!flag.length, `verifier (verifyAll trigger) does not report the site's own payment update as "CHANGED after booking" (Amount Due ${ae}; checked ${res && res.checked})`); }
    { const after = rows.cells.filter((r) => String(r[9] || '').includes(id)); ok(after.length === mine.length && after.some((r) => r[31] === 'PAID') && !after.some((r) => r[31] === 'Payment Requested'), `after manual verification the payment leg shows PAID, same rows, nothing added (${after.map((r) => r[31]).join(', ')})`); }

    console.log('\n[3] Every order gets an itemized email (requests our team prices too)');
    const dd = await post('/api/orders', { ...base, contact: { ...base.contact, email: 'request.tester@example.com' }, dedicated: true, schedule: { date: D, deliveryDate: D, timePref: 'none', deliveryTimePref: 'none' } });
    ok(dd.status === 200 && dd.j.status === 'pending_approval', 'dedicated-trip request created (team prices it)');
    await sleep(800);
    const rq = bridge.mails.find((m) => /request\.tester@example\.com/.test(m.to));
    ok(rq && /We received your request/.test(rq.subject) && /Your pieces:/.test(rq.body) && /Watercolor study/.test(rq.body), `request-received email is itemized ("${rq && rq.subject}")`);

    console.log('\n[4] Bank payment shown as processing (mock checkout)');
    const a = await post('/api/orders', { ...base, contact: { ...base.contact, email: 'ach.tester@example.com' }, items: [paint('Big canvas', 9000)], schedule: { date: D, deliveryDate: D, timePref: 'none', deliveryTimePref: 'none' } });
    const ap = await post(`/api/orders/${a.j.id}/pay`, { method: 'ach', routing: '110000000', account: '000123456789' });
    ok(ap.j && ap.j.order && ap.j.order.payment.status === 'ach_processing', 'bank payment books the job and shows "processing", not paid');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    ok(/bankFirst\(q\)/.test(src) && /Pay by bank/.test(src) && /Recommended for larger orders/.test(src), 'larger orders open on "Pay by bank" with a "Recommended for larger orders" note');
  } finally { child.kill('SIGKILL'); await bridge.close(); }
  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
