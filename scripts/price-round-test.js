// Customer-facing prices: nearest $5, no cents, half-up at $2.50. Usage: node scripts/price-round-test.js
const { quote, roundToNearest5, paymentPlan } = require('../lib/pricing');
const Pal = require('../lib/palomas');

const errors = [];
const ok = (c, msg, extra) => { if (!c) { errors.push(msg); console.error('FAIL:', msg, extra != null ? extra : ''); } else console.log('ok', msg); };
const sumLines = (q) => Math.round((q.lines || []).reduce((s, l) => s + Number(l.after != null ? l.after : l.amount), 0) * 100) / 100;
const noCents = (n) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n / 5) * 500) < 1e-6;

ok(roundToNearest5(273.75) === 275, '273.75 → 275');
ok(roundToNearest5(236.25) === 235, '236.25 → 235');
ok(roundToNearest5(272.50) === 275, '272.50 half-up → 275');

const chair = Pal.partnerQuote({
  items: [{ name: 'Armchair', kind: 'Armchair / Accent Chair', qty: 1, value: 2500 }],
  pickupLocation: 'salinas',
  access: { mode: 'ground' },
  delivery: { name: 'Test', phone: '8315550100', email: 'a@b.com', street: '1 Ocean', city: 'Carmel', state: 'CA', zip: '93921' },
});
ok(chair.total === 275, 'Paloma medium armchair + $2,500 declared value totals $275', chair.total);
ok(chair.protectionAmount === 40 && chair.delivery === 235, 'chair lines: delivery $235 + protection $40', { d: chair.delivery, p: chair.protectionAmount });
ok(sumLines(chair) === chair.total, 'chair line items sum to the rounded total');
ok(chair.payment && chair.payment.dueNow === 275, 'chair dueNow (Stripe charge) is $275', chair.payment);
ok(Math.round(chair.payment.dueNow * 100) === 27500, 'Stripe unit_amount cents would be 27500');

const paint = quote({ service: 'pickup_delivery', items: [{ qty: 1, type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 12344, description: 'painting' }] });
ok(paint.total === 385 && paint.dueNow === 385, 'CAD 30×40 painting + $12,344 DV totals $385 (was $385.16)', { total: paint.total, dueNow: paint.dueNow, prot: paint.protection && paint.protection.amount });
ok(sumLines(paint) === 385 && noCents(paint.total), 'painting lines sum to $385 with no cents');

const cadChair = quote({ service: 'pickup_delivery', items: [{ qty: 1, type: 'furniture', furnitureKind: 'Armchair / Accent Chair', sizeClass: 'medium', w: 32, h: 36, d: 32, value: 2500, description: 'armchair' }] });
ok(cadChair.total === 355 && cadChair.dueNow === 355, 'CAD medium armchair + $2,500 DV totals $355 (was $352.50)', cadChair.total);
ok(sumLines(cadChair) === 355, 'CAD chair lines sum to the rounded total');

const rawMember = quote(Pal.engineOrder({
  items: [{ name: 'Armchair', kind: 'Armchair / Accent Chair', qty: 1, value: 2500 }],
  pickupLocation: 'salinas', access: { mode: 'ground' },
  delivery: { name: 'Test', phone: '8315550100', email: 'a@b.com', street: '1 Ocean', city: 'Carmel', state: 'CA', zip: '93921' },
}, { member: true }), { skipCustomerRound: true });
ok(rawMember.total === 273.75, 'unrounded Paloma chair engine total is still $273.75', rawMember.total);

const plan = paymentPlan(273.75, 'pickup_delivery');
ok(plan.dueNow === 275 && !/\.\d/.test(plan.paymentSummary || ''), 'payment plan charges the rounded $275 and shows no cents', plan);

if (errors.length) { console.error('\n' + errors.length + ' failed'); process.exit(1); }
console.log('\nAll price-round checks passed');
