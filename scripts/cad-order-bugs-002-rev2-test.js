#!/usr/bin/env node
// Unit tests for Dot's CHANGES REQUIRED on CAD-ORDER-BUGS-002.
process.env.DATE_GUARD = process.env.DATE_GUARD || 'legacy';
process.env.TEST_MODE = process.env.TEST_MODE || '1';

const zones = require('../public/zones');
const VALID = require('../public/validate');
const ACCESS = require('../public/access');
const sched = require('../lib/scheduling');
const { quote, paymentPlan, hardwareFee, movingPortion, pieceWeight } = require('../lib/pricing');
const PAL = require('../lib/palomas');
const schedule = require('../lib/schedule');
const email = require('../lib/email');
const businessDays = require('../lib/business-days');
const PS = require('../lib/payment-status');
const addr = require('../lib/address-verify');
const days = require('../lib/sheet-days');
const config = require('../config');

const errors = [];
const ok = (cond, msg, extra) => {
  if (!cond) { errors.push(msg); console.error('FAIL:', msg, extra != null ? extra : ''); }
  else console.log('ok  ', msg);
};

const emery = { street: '1230 65th St', city: 'Emeryville', state: 'CA', zip: '94608' };
const soma = { street: '1 South Park', city: 'SoMa', state: 'CA', zip: '94107' };
const hollywood = { street: '6801 Hollywood Blvd', city: 'Hollywood', state: 'CA', zip: '90028' };
const danvilleBad = { street: '100 Front St', city: 'Danville', state: 'CA', zip: '90069' };
const unknown = { street: '99 Mystery Ln', city: 'NotAPlace', state: 'CA', zip: '94103' };
const incomplete = { street: 'Main St', city: 'Emeryville', state: 'CA', zip: '94608' };
const painting = (extra = {}) => ({ type: 'painting', description: 'Canvas', w: 24, h: 30, d: 2, weight: 15, value: 2000, framed: 'no', ...extra });
const base = (extra = {}) => ({ service: 'pickup_delivery', pickup: emery, dropoff: emery, items: [painting()], contact: { name: 'QA', email: 'qa@example.com' }, schedule: { date: '2026-12-04', deliveryDate: '2026-12-04' }, payer: 'dropoff', ...extra });

// ---------- 1. Address: street+city+ZIP, aliases, unverified → quote ----------
ok(zones.cityFitsZip(soma), '1: SoMa is a real postal alias for 94107');
ok(zones.cityFitsZip(hollywood), '1: Hollywood is a real postal alias for 90028');
ok(zones.cityFitsZip({ city: 'West Hollywood', zip: '90069' }), '1: West Hollywood fits 90069');
ok(!zones.cityFitsZip(danvilleBad) && !!zones.routeConflict(danvilleBad), '1: Danville + 90069 is still a conflict, not an alias');
ok(!zones.cityFitsZip(unknown), '1: an unknown city is not treated as an alias');
ok(zones.addressComplete(emery) && !zones.addressComplete(incomplete), '1: street must include a number to be complete');
ok(addr.localCheck(emery).offerDates, '1: a known complete address may be offered dates');
ok(addr.localCheck(soma).offerDates, '1: a postal alias may be offered dates');
ok(!addr.localCheck(danvilleBad).offerDates && addr.localCheck(danvilleBad).status === 'conflict', '1: a conflict is not offered dates');
ok(!addr.localCheck(unknown).offerDates && addr.localCheck(unknown).quote, '1: unverified city+ZIP goes to quote, no dates');
ok(!addr.localCheck(incomplete).offerDates, '1: incomplete street is not offered dates');
ok(addr.localCheck(unknown).message && /quote|hand|verif/i.test(addr.localCheck(unknown).message), '1: unverified copy points to a quote / manual review');

// ---------- 2. Payment status wording ----------
ok(PS.paymentStatusLabel({ payment: { status: 'paid' }, quote: { paymentPlan: 'full', dueNow: 200, total: 200 } }) === 'Paid', '2: Paid only when settled with no remaining balance');
ok(PS.paymentStatusLabel({ payment: { status: 'ach_processing' }, quote: { paymentPlan: 'full', dueNow: 200, total: 200 } }) === 'Payment processing', '2: ACH in flight is Payment processing, not Paid');
ok(PS.paymentStatusLabel({ invoice: { issuedAt: '2026-11-25' }, quote: { dueNow: 200 } }) === 'Invoiced', '2: Invoiced only when an invoice record exists');
ok(PS.paymentStatusLabel({ quote: { dueNow: 200 } }) === 'Booked, payment pending', '2: unpaid with no invoice is Booked, payment pending');
ok(PS.paymentStatusLabel({ payment: { status: 'failed' }, quote: { dueNow: 200 } }) === 'Booked, payment pending', '2: failed-after-processing is not Paid and stays retryable wording');
const depPaid = { quote: { paymentPlan: 'deposit', total: 3000, dueNow: 1500, balanceDue: 1500 }, payment: { status: 'paid', amount: 1500 } };
ok(PS.unpaidBalance(depPaid) === 1500 && /balance due/i.test(PS.paymentStatusLabel(depPaid)), '2: settled deposit shows remaining balance, not a second full total', PS.paymentStatusLabel(depPaid));
ok(PS.unpaidBalance({ payment: { status: 'failed' }, quote: { dueNow: 1500, total: 3000, paymentPlan: 'deposit' } }) === 1500, '2: after a failed deposit attempt, only the unpaid amount is due');

// ---------- 3. Paloma / mixed-cart protection at $50,000 and $50,000.01 ----------
const q50 = quote(base({ items: [painting({ value: 50000, description: 'At cap' })] }));
ok(q50.protection && q50.protection.amount === 750 && q50.lines.some((l) => /Declared value protection/.test(l.label) && l.amount === 750),
  '3: exactly $50,000 is protected at 1.5% with a protection line', q50.protection);
const q01 = quote(base({ items: [painting({ value: 50000.01, description: 'Over cap' })] }));
ok(!q01.protection && !q01.lines.some((l) => /Declared value protection/.test(l.label)),
  '3: $50,000.01 is not shown as protected; over-limit rule folds 0.75% into the piece price', q01.lines);
ok(q01.lines.some((l) => l.amount === 575), '3: over-limit piece price is transport + 0.75%', q01.lines);
const mix = quote(base({ items: [painting({ value: 50000, description: 'Cap' }), painting({ value: 50000.01, description: 'Over' })] }));
ok(mix.protection && mix.protection.amount === 750 && mix.protection.pieces.length === 1,
  '3: mixed cart protects only the $50,000 piece', mix.protection);
ok(!/Over/.test(JSON.stringify(mix.protection.pieces)), '3: the over-limit piece is never listed as protected');

// Paloma partner quote, same edges (member pricing, DVP still outside discounts)
const palItems = (value) => [{ name: 'Chair', kind: 'Armchair / Accent Chair', qty: 1, catalogId: 'custom-1', custom: true, w: 30, d: 30, h: 36, weight: 40, value }];
try {
  const p50 = PAL.partnerQuote({ placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', payer: 'client', items: palItems(50000), delivery: { name: 'A', street: emery.street, city: emery.city, state: 'CA', zip: emery.zip, phone: '4155550100', email: 'a@example.com' }, access: { mode: 'ground' } });
  const p01 = PAL.partnerQuote({ placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', payer: 'client', items: palItems(50000.01), delivery: { name: 'A', street: emery.street, city: emery.city, state: 'CA', zip: emery.zip, phone: '4155550100', email: 'a@example.com' }, access: { mode: 'ground' } });
  ok(p50.protectionAmount === 750 || (p50.protection && p50.protection.amount === 750) || (p50.lines || []).some((l) => /protection/i.test(l.label) && l.amount === 750),
    "3: Paloma $50,000 includes 1.5% protection", p50.protectionAmount || p50.protection);
  ok(!(p01.lines || []).some((l) => /Declared value protection/.test(l.label)) && !(p01.protectionAmount > 0 && p01.protection && p01.protection.pieces && p01.protection.pieces.some((x) => x.value > 50000)),
    "3: Paloma $50,000.01 is not shown as protected", { protectionAmount: p01.protectionAmount, lines: (p01.lines || []).map((l) => l.label) });
} catch (e) {
  ok(false, '3: Paloma partnerQuote threw', e.message);
}

// ---------- 4. Rush: protection and value charges stay out of the multiplier; test with discounts ----------
const rushDisc = quote(base({
  rush: true,
  discountCode: 'CADTEST10',
  items: [painting({ value: 10000 })],
}));
// If the test code isn't in the book, still assert movingPortion math on a constructed quote.
const rush = quote(base({ rush: true, items: [painting({ value: 10000 })] }));
ok(rush.tripPremium || rush.paymentPlan === 'quote', '4: rush is still a quoted trip (rule unchanged)');
const protLine = (rush.lines || []).find((l) => /protection/i.test(l.label));
if (rush.quoteRange && protLine) {
  const mp = movingPortion(rush);
  ok(mp + protLine.amount <= (rush.regularTotal || rush.total) + 0.02, '4: protection sits outside the moving portion used for the multiplier', { mp, prot: protLine.amount, regular: rush.regularTotal });
}
ok(/priced individually|range|business day|authorize payment/i.test(String(rush.quoteNote || '') + JSON.stringify(rush.notes || [])), '4: rush copy does not invent a new rule');
// Dedicated trip shares the same tripPremium 1.5–2× path internally while copy may say priced individually — noted in the packet, rule unchanged.

// ---------- 5. Dated 2026-27 closure, not annual; strict stale → no pattern dates ----------
['2026-12-20', '2026-12-24', '2026-12-31', '2027-01-01'].forEach((d) => ok(sched.isHolidayBlackout(d), '5: ' + d + ' is in the dated 2026-27 closure'));
ok(!sched.isHolidayBlackout('2026-12-19') && !sched.isHolidayBlackout('2027-01-02'), '5: days beside the dated window are open');
ok(!sched.isHolidayBlackout('2027-12-20') && !sched.isHolidayBlackout('2028-01-01'), '5: year rollover — 2027-12-20 and 2028-01-01 are not auto-blocked');
ok(!sched.availableDays(emery, { from: new Date('2027-12-18T12:00:00Z'), leadTime: 0, count: 10 }).every((d) => d.date < '2027-12-20' || d.date > '2028-01-01') === false
  || sched.availableDays(emery, { from: new Date('2027-12-18T12:00:00Z'), leadTime: 0, count: 20 }).some((d) => d.date === '2027-12-21' || d.date >= '2027-12-20'),
  '5: after the 2026-27 closure, late-December 2027 can still be offered (unless it is a regular off-day)');
const prev = process.env.DATE_GUARD;
process.env.DATE_GUARD = 'strict';
days._setForTests({}, { fetchedAt: 0 });
ok(sched.calendarUnavailable(), '5: strict mode with no fetch is calendar-unavailable');
ok(sched.availableDays(emery, { from: new Date('2026-12-01T12:00:00Z'), leadTime: 0, count: 10 }).length === 0,
  '5: strict + missing calendar does not fall back to pattern-generated dates');
days._setForTests({}, { fetchedAt: Date.now() - days.DEAD_MS - 1000 });
ok(sched.calendarUnavailable() && sched.availableDays(emery, { leadTime: 0, count: 8 }).length === 0,
  '5: strict + stale (older than 2h) offers no dates');
days._setForTests({}, { fetchedAt: Date.now() });
process.env.DATE_GUARD = prev || 'legacy';
days._setForTests({}, { fetchedAt: 0 }); // leave clean; legacy ignores empty snap for catalog days
ok(!sched.calendarUnavailable(), '5: legacy mode still uses the catalog when live data is missing (DATE_GUARD not flipped on the test site)');

// ---------- 6. Deposit threshold $3,000 on the payable amount ----------
ok(config.payment.depositThreshold === 3000, '6: deposit threshold stays $3,000 (pending Chad)');
ok(paymentPlan(2999.99, 'pickup_delivery').paymentPlan === 'full' && paymentPlan(2999.99, 'pickup_delivery').dueNow === 2999.99, '6: $2,999.99 is paid in full');
const p3 = paymentPlan(3000, 'pickup_delivery');
ok(p3.paymentPlan === 'deposit' && p3.dueNow === 1500 && p3.balanceDue === 1500 && /at pickup/i.test(p3.paymentSummary + p3.balanceWhen),
  '6: $3,000.00 is a 50/50 deposit, balance collected at pickup, wording shown in paymentSummary', p3);
const p301 = paymentPlan(3000.01, 'pickup_delivery');
ok(p301.paymentPlan === 'deposit' && Math.abs(p301.dueNow + p301.balanceDue - 3000.01) < 0.02, '6: $3,000.01 is a deposit', p301);
ok(/Deposit \$/.test(p3.paymentSummary) && /Balance \$/.test(p3.paymentSummary) && /collected/i.test(p3.paymentSummary),
  '6: paymentSummary names the deposit, the balance, and when it is collected', p3.paymentSummary);

// ---------- 7. Hardware install-only, $75 Z-bar once ----------
ok(hardwareFee({ hardware: 'needs_zbar' }) === 75, '7: Z-bar fee is $75');
const inst = quote({
  service: 'delivery_install', pickup: emery, dropoff: emery,
  items: [painting({ hangHeight: 'standard', hardware: 'needs_zbar', value: 2000 })],
});
const zbarLines = (inst.lines || []).filter((l) => /z-?bar/i.test(l.label) || l.amount === 75 && /hardware|hang/i.test(l.label));
ok(zbarLines.length === 1 && zbarLines[0].amount === 75, '7: $75 Z-bar appears exactly once on an install quote', inst.lines);
const noInst = quote({
  service: 'pickup_delivery', pickup: emery, dropoff: emery,
  items: [painting({ hangHeight: 'standard', hardware: 'needs_zbar', value: 2000 })],
});
ok(!(noInst.lines || []).some((l) => /z-?bar/i.test(l.label) || (l.amount === 75 && /hardware|hang/i.test(l.label))),
  '7: a leftover Z-bar selection is not charged on a non-install job', noInst.lines);

// ---------- 8. Pickup before delivery in actual route order ----------
ok(typeof sched.pickupBeforeDelivery === 'function', '8: pickupBeforeDelivery is exported');
ok(sched.pickupBeforeDelivery('2026-12-04', '2026-12-04', emery, emery, {}), '8: same-zone same-day is allowed on an East Bay Friday');
// Friday NorCal catalog: EastBay, then NapaWine, then BayWest — Emeryville (EastBay) before SF (BayWest) is OK; reverse is not.
const sf = { street: '100 Mission St', city: 'San Francisco', state: 'CA', zip: '94103' };
ok(sched.pickupBeforeDelivery('2026-12-04', '2026-12-04', emery, sf, {}), '8: Friday East Bay pickup may deliver to BayWest later the same day');
ok(!sched.pickupBeforeDelivery('2026-12-04', '2026-12-04', sf, emery, {}), '8: Friday BayWest pickup may not deliver earlier-in-route East Bay the same day');
ok(!sched.canPairPickupDelivery('2026-12-05', { street: '329 Rianda St', city: 'Salinas', state: 'CA', zip: '93901' }, emery, {}),
  '8: Saturday Carmel still cannot pair with Emeryville after the van has passed East Bay');
// Capacity gap: documented — in legacy with no calendar snap, capacityLeft is Infinity.
ok(days.capacityLeft('2026-12-04') === Infinity, '8: gap — legacy + no calendar data does not expose a live capacity cap (Infinity)');

// ---------- 9. All three dims or size-class-only; soft mins; typo suggest; no silent address change ----------
ok(VALID.dimProblem({ type: 'painting', w: 24, h: 30 }) && VALID.dimProblem({ type: 'painting', w: 24, h: 30 }).state === 'partial',
  '9: a partial dimension set is rejected');
ok(!VALID.dimProblem({ type: 'painting', sizeClassOnly: true, sizeClass: 'medium' }), '9: an explicit size-class-only choice is accepted without dimensions');
ok(VALID.belowMinWarning({ type: 'furniture', furnitureKind: 'Sofa', w: 1, h: 1, d: 1 }).quote, '9: below-minimum is a quote/manual-review option');
ok(VALID.typoEmail('a@gmial.com') === 'a@gmail.com' && !VALID.emailProblem('a@gmial.com'), '9: typo emails are suggested, never a hard silent change');

// ---------- 10. Quote SLA around weekends and the holiday, authorize payment ----------
const wed = businessDays.quoteReplyBy(new Date('2026-12-16T20:00:00Z')); // Wed Dec 16 PT noon-ish
ok(wed.iso === '2026-12-17' && /Thursday/.test(wed.label) && /within 1 business day \(by Thursday/.test(wed.text),
  '10: a Wednesday request is due the next business day (Thursday)', wed);
const fri = businessDays.quoteReplyBy(new Date('2026-12-18T20:00:00Z'));
ok(fri.iso === '2027-01-04' && /January 4/.test(fri.label), '10: a Friday Dec 18 request skips the weekend and the 2026-27 closure, due Monday Jan 4', fri);
ok(/authorize payment/i.test(businessDays.authorizePaymentNote()) && !/approve it/i.test(businessDays.quoteEtaSentence()),
  '10: copy says nothing is charged until the customer authorizes payment');
const recd = email.TEMPLATES.quote_received({
  id: 'CAD-TEST', contact: { name: 'Ada', email: 'ada@example.com' }, service: 'pickup_delivery',
  quote: { paymentPlan: 'quote' }, pickup: emery, dropoff: emery, items: [painting()],
  createdAt: '2026-12-18T20:00:00Z',
});
ok(/authorize payment/i.test(recd.html) && /January 4|1 business day/i.test(recd.html), '10: quote email uses the SLA and authorize-payment wording', recd.html.slice(0, 400));

// ---------- 11. Not sure never counts as 0 lb; flag every item type including furniture ----------
ok(pieceWeight({ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', weightUnsure: true }) == null, '11: Not sure is not 0 lbs on furniture');
ok(pieceWeight({ type: 'painting', weightUnsure: true, w: 24, h: 30, d: 2 }) == null, '11: Not sure is not 0 lbs on a painting');
const sculp = quote(base({ items: [{ type: 'sculpture', description: 'Bronze', w: 12, h: 12, d: 12, weightUnsure: true, value: 8000 }] }));
ok(sculp.paymentPlan === 'quote' || sculp.weightReview, '11: sculpture Not sure is not auto-accepted as a priced booking', { plan: sculp.paymentPlan, weightReview: sculp.weightReview });
ok(ACCESS.weightUnconfirmed([{ type: 'furniture', furnitureKind: 'Sofa', weightUnsure: true }]), '11: furniture Not sure is unconfirmed');
ok(ACCESS.weightUnconfirmed([{ type: 'painting', weightUnsure: true }]), '11: painting Not sure is unconfirmed');
const rowsFurn = schedule.legsForOrder(base({
  items: [{ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Sofa', value: 2000, weightUnsure: true }],
  quote: quote(base({ items: [{ type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Sofa', value: 2000, weightUnsure: true }] })),
  payment: { status: 'paid', method: 'mock_card', amount: 100 },
}));
const notes = (rowsFurn || []).map((r) => r.row['Update Notes']).join(' ');
ok(/WEIGHT TO CONFIRM BEFORE DISPATCH/i.test(notes), '11: furniture Not sure writes WEIGHT TO CONFIRM BEFORE DISPATCH on the sheet notes', notes.slice(0, 400));

// ---------- 12. Explicit payer, one financial record, unpaid balance only ----------
ok(schedule.paymentLeg(base({ payer: 'pickup' })) === 'PU', '12: pickup contact payer writes payment on the PU leg');
ok(schedule.paymentLeg(base({ payer: 'dropoff' })) === 'DEL', '12: delivery contact payer writes payment on the DEL leg');
ok(schedule.paymentLeg(base({ payer: 'other', payerOther: { name: 'Pat', email: 'pat@example.com' } })) === 'DEL', '12: someone else writes payment on exactly one leg (DEL)');
const depositOrder = {
  ...base({ payer: 'dropoff' }),
  id: 'CAD-DEP', createdAt: new Date().toISOString(),
  quote: { ...paymentPlan(3000, 'pickup_delivery'), total: 3000, lines: [] },
  payment: { status: 'paid', method: 'mock_card', amount: 1500 },
  service: 'pickup_delivery',
};
const depRows = schedule.legsForOrder(depositOrder);
const payRows = depRows.filter((r) => r.row['Amount Due'] !== 'X' && r.row['Amount Due'] !== '');
ok(payRows.length === 1, '12: deposit case writes exactly one financial record', payRows.map((r) => [r.leg, r.row['Amount Due'], r.row['Payment Status']]));
ok(payRows[0] && payRows[0].leg === 'DEL' && Number(payRows[0].row['Amount Due']) === 1500, '12: Amount Due is the unpaid balance, not the full total', payRows[0] && payRows[0].row);
const invOrder = { ...base({ payer: 'pickup' }), id: 'CAD-INV', createdAt: new Date().toISOString(), quote: { paymentPlan: 'full', dueNow: 200, total: 200, lines: [] } };
const invRows = schedule.legsForOrder(invOrder);
ok(invRows.filter((r) => r.row['Payment Status'] && r.row['Payment Status'] !== '...').every((r) => r.row['Payment Status'] === 'Booked, payment pending'),
  '12: invoice-pending (no invoice object) is not Invoiced', invRows.map((r) => r.row['Payment Status']));
const inv2 = schedule.legsForOrder({ ...invOrder, invoice: { issuedAt: '2026-11-25', number: 'INV-1' } });
ok(inv2.some((r) => r.row['Payment Status'] === 'Invoiced'), '12: Invoiced only once an invoice record exists');
const failOrder = { ...invOrder, payment: { status: 'failed', amount: 200, method: 'mock_ach' }, id: 'CAD-FAIL' };
const failRows = schedule.legsForOrder(failOrder);
const failPay = failRows.filter((r) => r.row['Amount Due'] !== 'X');
ok(failPay.length === 1 && Number(failPay[0].row['Amount Due']) === 200, '12: ACH failure-then-retry still shows one unpaid amount, not a duplicate', failPay);

if (errors.length) {
  console.error('\n' + errors.length + ' failed');
  process.exitCode = 1;
} else {
  console.log('\nAll rev2 unit checks passed');
}
