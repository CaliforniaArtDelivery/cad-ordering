/**
 * Samantha's Nov 19 testing: rush math, address checks, size checks. Local only, nothing sent.
 *   node scripts/fixes-nov19-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { quote } = require('../lib/pricing');
const V = require('../public/validate');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const near = (a, b) => Math.abs(a - b) < 0.006;
const hdr = (t) => console.log('\n[' + t + ']');

const order = (items, over = {}) => ({
  service: 'pickup_delivery', schedule: { date: '2026-12-08' },
  pickup: { street: '2 Henry Adams St', city: 'San Francisco', state: 'CA', zip: '94103' },
  dropoff: { street: '1 Main St', city: 'San Francisco', state: 'CA', zip: '94110' },
  items, ...over,
});
const art = (value, o = {}) => ({ type: 'painting', w: 30, h: 40, d: 2, value, description: 'test', ...o });

hdr('1. Rush: only the moving price is multiplied');
{
  const reg = quote(order([art(12344)]));
  ok(near(reg.total, 385.16) && near(reg.protection.amount, 185.16), 'regular: $200 service + $185.16 protection = $385.16', { total: reg.total, prot: reg.protection && reg.protection.amount });
  const r = quote(order([art(12344)], { rush: true }));
  console.log(`  rush range now: $${r.quoteRange.low} to $${r.quoteRange.high} (was $577.74 to $770.32)`);
  ok(near(r.quoteRange.low, 485.16) && near(r.quoteRange.high, 585.16), 'rush: $485.16 to $585.16 (200 x 1.5 / 2.0, plus protection once)', r.quoteRange);
  ok(near(r.total, 385.16) && r.lines.some((l) => /protection/.test(l.label) && near(l.amount, 185.16)), 'the protection line is still exactly 1.5% of declared value, unmultiplied');
  const d = quote(order([art(12344)], { dedicated: true }));
  ok(near(d.quoteRange.low, 485.16) && near(d.quoteRange.high, 585.16), 'dedicated trip uses the same split', d.quoteRange);
  const two = quote(order([art(12344), art(5000)], { rush: true }));
  ok(near(two.quoteRange.valueCharges, 185.16 + 75) && near(two.quoteRange.movingTotal + two.quoteRange.valueCharges, two.total), 'two pieces: both protection lines stay unmultiplied', two.quoteRange);

  // Over $50,000: 0.75% of value is folded into the piece price; only the moving part is multiplied.
  const bigReg = quote(order([art(60000)]));
  const bigRush = quote(order([art(60000)], { rush: true }));
  const fold = 450; // 0.75% of $60,000
  const moving = bigReg.total - fold;
  console.log(`  over $50k: regular $${bigReg.total} (moving $${moving} + $${fold} value charge); rush $${bigRush.quoteRange.low} to $${bigRush.quoteRange.high}`);
  ok(!bigReg.protection && near(moving, 200), 'over $50,000: no protection line, price = $200 moving + $450 (0.75%)', { total: bigReg.total, lines: bigReg.lines });
  ok(near(bigRush.quoteRange.low, 200 * 1.5 + fold) && near(bigRush.quoteRange.high, 200 * 2 + fold), 'over $50,000 rush: $750 to $850 (moving x1.5/x2.0, plus $450 once)', bigRush.quoteRange);

  const mixReg = quote(order([art(12344), art(60000)]));
  const mix = quote(order([art(12344), art(60000)], { rush: true }));
  const mixMoving = mixReg.total - 185.16 - 450; // second piece is priced lower as a second painting, so this is not simply 2 x $200
  console.log(`  mixed: regular $${mixReg.total} = moving $${mixMoving} + $185.16 protection + $450 value charge; rush $${mix.quoteRange.low} to $${mix.quoteRange.high}`);
  ok(near(mix.quoteRange.low, mixMoving * 1.5 + 635.16) && near(mix.quoteRange.high, mixMoving * 2 + 635.16), 'mixed order: under-$50k protection and over-$50k 0.75% both stay out of the multiplier', mix.quoteRange);

  const plain = quote(order([art(12344)]));
  ok(plain.paymentPlan !== 'quote' && !plain.quoteRange, 'non-rush order is unchanged (payable now, no range)');
  const noValue = quote(order([art(0)], { rush: true }));
  ok(near(noValue.quoteRange.low, 300) && near(noValue.quoteRange.high, 400), 'no declared value: plain 1.5x to 2x of the moving price', noValue.quoteRange);
}

hdr('2. Address checks (shared module)');
{
  const good = { street: '2 Henry Adams St', city: 'San Francisco', zip: '94103' };
  ok(V.addressProblems(good).length === 0, 'a normal address passes');
  ok(V.addressProblems({ ...good, zip: '94103-1234' }).length === 0, 'ZIP+4 passes');
  for (const z of ['123456', '1234', '9410', 'abcde', '94103-12', '94103 ', ' 123456']) {
    const p = V.addressProblems({ ...good, zip: z.trim() === '94103' ? '94103x' : z.trim() });
    ok(p.some((x) => x.field === 'zip'), `ZIP "${z}" is rejected`);
  }
  ok(V.addressProblems({ ...good, zip: '' }).some((x) => x.field === 'zip'), 'blank ZIP is rejected (US address)');
  ok(V.addressProblems({ ...good, street: '' }).some((x) => x.field === 'street'), 'street required');
  ok(V.addressProblems({ ...good, street: 'Melrose Ave' }).some((x) => x.field === 'street'), 'street needs a number');
  ok(V.addressProblems({ ...good, street: '   ' }).some((x) => x.field === 'street'), 'blank-space street rejected');
  ok(V.addressProblems({ ...good, city: '' }).some((x) => x.field === 'city'), 'city required');
  for (const c of ['x', '12345', 'asdf1234', '!!', '#$%']) ok(V.addressProblems({ ...good, city: c }).some((x) => x.field === 'city'), `city "${c}" is not plausible`);
  for (const c of ["Coeur d'Alene", 'St. Helena', 'Cañon City', 'Winston-Salem', 'LA', 'San Luis Obispo']) ok(!V.addressProblems({ ...good, city: c }).some((x) => x.field === 'city'), `city "${c}" is accepted`);
  ok(V.addressProblems({ street: 'Flat 2, 10 Downing Street', city: 'London', country: 'United Kingdom' }).length === 0, 'international destination: free-form postal code, only street and city needed');
}

hdr('3. Size checks (shared module)');
{
  ok(V.dimProblem({ w: '', h: '', d: '' }).state === 'missing', 'blank sizes are missing');
  ok(V.dimProblem({ w: 1, h: 1, d: 1 }).state === 'small', '1 x 1 x 1 is refused');
  ok(V.dimProblem({ w: 3.9, h: 20, d: 2 }).key === 'w', 'width under 4 in. is refused');
  ok(V.dimProblem({ w: 20, h: 3, d: 2 }).key === 'h', 'height under 4 in. is refused');
  ok(V.dimProblem({ w: 20, h: 20, d: 0.5 }).key === 'd', 'depth under 1 in. is refused');
  ok(V.dimProblem({ w: 4, h: 4, d: 1 }) === null, 'the minimum itself (4 x 4 x 1) is accepted');
  ok(V.dimProblem({ w: 24, h: 36, d: 1.5 }) === null, 'a framed print 24 x 36 x 1.5 is accepted');
}

hdr('3b. B1: strict decimal parsing of sizes');
{
  const st = (v) => V.dimState({ w: v }, 'w');
  for (const v of ['24', '24.5', '.5'.replace('.5', '4.0'), ' 24 ', 24, 24.5]) ok(st(v) === 'ok', `size ${JSON.stringify(v)} is a valid plain decimal`);
  ok(st('.5') === 'small', '".5" parses as a decimal (0.5) and is then refused as too small, not as malformed');
  ok(V.parseDim('.5') === 0.5 && V.parseDim('5.') === null, '".5" is allowed as a decimal, "5." is not');
  for (const v of ['0x10', '1e3', '1E3', '4,5', '1,000', 'NaN', 'Infinity', '-Infinity', '-4', '+4', '4 4', '4in', '', '.', '..5', '٤', 1e21, -3, NaN, Infinity, -Infinity, [4], [], {}, true, false, null, undefined, '9'.repeat(400), '0b101', '0o7', '4e0']) {
    const r = st(v);
    ok(r === 'invalid' || r === 'missing', `size ${typeof v === 'number' ? String(v) : JSON.stringify(v)} is refused (${r})`);
  }
  ok(st('1001') === 'huge' && st('1000') === 'ok', 'a typo guard at 1,000 in refuses 1001 but not 1000');
  ok(V.optionalDimProblem({ type: 'furniture', w: '', h: '', d: '' }) === null, 'blank sizes are fine for pieces that do not ask for a size');
  ok(V.optionalDimProblem({ type: 'furniture', w: '0x10' }) !== null, 'junk sizes are refused even on pieces that do not ask for a size');
  ok(V.REVIEW_DIM === 120 && require('../config').intake.reviewDimIn === 120, 'REVIEW_DIM defaults to 120 in (pending Chad), configurable in config.intake.reviewDimIn / REVIEW_DIM_IN');
  ok(V.isOversized({ w: 120, h: 10, d: 2 }) === false && V.isOversized({ w: 120.5, h: 10, d: 2 }) === true && V.isOversized({ w: 10, h: 10, d: 121 }) === true, 'oversized = any side OVER the limit (120 itself is not)');
  const RULES = require('../lib/date-guard-rules');
  const ov = RULES.review(order([art(5000, { w: 130 })]));
  ok(ov.needed && ov.kinds.includes('oversized') && /^Oversized piece: CAD will confirm handling/.test(ov.reasons[0].text), 'the review rules flag an oversized piece with the agreed wording', ov);
  const ovq = quote(order([art(5000, { w: 130 })]));
  ok(ovq.paymentPlan === 'quote' && ovq.reviewOnly === true && ovq.total > 0 && ovq.total === ovq.regularTotal, 'an oversized piece prices at the regular rate but becomes a review-only quote (not payable)', { plan: ovq.paymentPlan, total: ovq.total });
  ok(!RULES.review(order([art(5000, { w: 120 })])).needed, 'a 120 in piece is not reviewed');
}

hdr('3c. I3: city characters and the no-street-number checkbox (shared module)');
{
  const fs = require('fs');
  const bytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'validate.js'));
  ok(!bytes.includes(Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac])) && !/â€/.test(bytes.toString('utf8')), 'validate.js has no mojibake (no "â€™" byte sequences)');
  ok(!/[^\x00-\x7f]/.test(bytes.toString('utf8').split('\n').filter((l) => /CITY_RX\s*=/.test(l)).join('')), 'the city regex line is pure ASCII (apostrophes are \\u escapes)');
  for (const c of ["O'Fallon", 'O\u2019Fallon', 'O\u2018Fallon', "Coeur d'Alene", 'St. Helena', 'Cañon City', 'Winston-Salem']) ok(V.cityOk(c), `city ${JSON.stringify(c)} is accepted (straight and curly apostrophes)`);
  for (const c of ['Oâ€™Fallon', 'Bad1', '', ' ', 'X', "'", '12345']) ok(!V.cityOk(c), `city ${JSON.stringify(c)} is refused`);
  const rural = { street: 'Star Route', city: 'Big Sur', zip: '93920' };
  ok(V.addressProblems(rural).some((x) => x.field === 'street'), 'no number and no checkbox: street is refused');
  ok(V.addressProblems({ ...rural, noStreetNumber: true }).length === 0 && V.needsAddressReview({ ...rural, noStreetNumber: true }), 'no number + checkbox: accepted and flagged for review');
  ok(V.addressProblems({ ...rural, noStreetNumber: 'true' }).some((x) => x.field === 'street') && V.addressProblems({ ...rural, noStreetNumber: 1 }).some((x) => x.field === 'street'), 'only boolean true counts as the checkbox');
  ok(V.addressProblems({ street: 'RR 2 Box 15', city: 'Willits', zip: '95490' }).length === 0 && !V.needsAddressReview({ street: 'RR 2 Box 15', city: 'Willits', zip: '95490', noStreetNumber: true }), '"RR 2 Box 15" already has a number: accepted, not reviewed even if the box is ticked');
  ok(V.addressProblems({ street: '   ', city: 'Big Sur', zip: '93920', noStreetNumber: true }).some((x) => x.field === 'street'), 'the checkbox never excuses a blank street');
  ok(V.addressProblems({ ...rural, noStreetNumber: true, zip: '123456' }).some((x) => x.field === 'zip'), 'the checkbox never excuses a bad ZIP');
  const q = quote(order([art(5000)], { pickup: { ...rural, noStreetNumber: true, zip: '94103', city: 'San Francisco' } }));
  ok(q.reviewOnly === true && q.paymentPlan === 'quote', 'a ticked no-number address becomes a review-only quote');
}

hdr('3d. I2: the 0.75% value charge is never silently dropped; the rush base never goes negative');
{
  const { movingPortion } = require('../lib/pricing');
  ok(movingPortion(385.16, 185.16, 0) === 200 && movingPortion(650, 0, 450) === 200, 'movingPortion: total minus value charges');
  ok(movingPortion(100, 185.16, 0) === 0 && movingPortion(100, 60, 60) === 0 && movingPortion(0, 0, 450) === 0, 'movingPortion is clamped at zero (never negative)');
  ok(movingPortion('x', 1, 1) === 0, 'movingPortion with garbage input is 0, not NaN');
  // no priced line at all: the charge is flagged and the order is forced to a CAD quote
  const lone = quote({ service: 'install_only', pickup: {}, dropoff: { street: '1 Main St', city: 'San Francisco', zip: '94110' }, schedule: { date: '2026-12-08' }, items: [{ type: 'sculpture', weight: 100, w: 20, h: 30, d: 20, value: 100000, description: 's' }] });
  ok(lone.paymentPlan === 'quote' && lone.valueChargeUnattached === 750, 'install-only sculpture over $50k (no line to carry the 0.75%): charge recorded ($750) and the order is a CAD quote', { plan: lone.paymentPlan, un: lone.valueChargeUnattached });
  // lands on another priced line when its own has none
  const sofa = { type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Sofa', value: 3000, weight: 100 };
  const mixed = quote(order([sofa, { type: 'sculpture', weightUnsure: true, w: 20, h: 30, d: 20, value: 80000, description: 'S' }]));
  const carried = mixed.lines.find((l) => l.valueCharge);
  ok(carried && near(carried.valueCharge, 600) && mixed.valueChargeUnattached === 0, 'a piece with no price line of its own: its 0.75% ($600) rides on another priced line, counted, not lost', mixed.lines);
  const sumLines = mixed.lines.reduce((t, l) => t + l.amount, 0);
  ok(near(sumLines, mixed.total), 'every dollar of the carried charge is in the total');
  // rush: a value charge is outside the multiplier even when it lands on a transport line
  const r = quote(order([art(60000)], { rush: true }));
  ok(near(r.quoteRange.low, 750) && near(r.quoteRange.high, 850) && near(r.quoteRange.valueCharges, 450), 'rush with an over-$50k piece: only the $200 moves, $450 stays', r.quoteRange);
}

hdr('3v3. Atlas v3: the folded 0.75% only ever attaches to an eligible service line (allowlist)');
{
  const { pickFoldTarget, isFoldEligible, FOLD_ELIGIBLE_KINDS } = require('../lib/pricing');
  const prot = { label: 'Declared value protection: 1.5% of $40,000', amount: 600, kind: 'protection' };
  const disc = { label: 'Discount code JT (25% off)', amount: -250, kind: 'discount' };
  const posDisc = { label: 'weird positive discount', amount: 50, kind: 'discount' };
  const vcOnly = { label: 'value charge only', amount: 450, valueCharge: 450, kind: 'service' };
  const unknown = { label: 'mystery', amount: 99, kind: 'mystery' };
  const noKind = { label: 'untyped', amount: 99 };
  const piece = { label: 'Piece 1 delivery', amount: 200, kind: 'transport' };
  ok(FOLD_ELIGIBLE_KINDS.has('service') && FOLD_ELIGIBLE_KINDS.has('transport') && !FOLD_ELIGIBLE_KINDS.has('protection') && !FOLD_ELIGIBLE_KINDS.has('discount'), 'allowlist holds only service and transport');
  // (a) a positive protection line and no eligible service line -> no target, so the charge goes to review, once
  ok(pickFoldTarget([prot], true, null) === null && pickFoldTarget([prot, disc, posDisc, vcOnly, unknown, noKind], true, null) === null, 'regression (a): a positive protection line with no eligible service line yields no fold target');
  const lone = quote({ service: 'install_only', pickup: {}, dropoff: { street: '1 Main St', city: 'San Francisco', zip: '94110' }, schedule: { date: '2026-12-08' }, items: [{ type: 'sculpture', weight: 100, w: 20, h: 30, d: 20, value: 100000, description: 's' }] });
  ok(lone.paymentPlan === 'quote' && lone.valueChargeUnattached === 750 && !lone.lines.some((l) => l.valueCharge), 'regression (a): over-$50k piece with no eligible service line is charged exactly once to review ($750 unattached) and nothing is attached to any line', { un: lone.valueChargeUnattached, lines: lone.lines });
  const mixedProt = quote({ service: 'install_only', pickup: {}, dropoff: { street: '1 Main St', city: 'San Francisco', zip: '94110' }, schedule: { date: '2026-12-08' }, items: [{ type: 'sculpture', weight: 100, w: 20, h: 30, d: 20, value: 100000, description: 's' }, { type: 'sculpture', weight: 100, w: 20, h: 30, d: 20, value: 40000, description: 'p' }] });
  const protLines = mixedProt.lines.filter((l) => l.kind === 'protection');
  ok(protLines.length > 0 && protLines.every((l) => !l.valueCharge && l.amount > 0) && mixedProt.valueChargeUnattached === 750 && mixedProt.paymentPlan === 'quote', 'regression (a): a real positive protection line is present, the 0.75% still goes to review once and is not put on the protection line', { un: mixedProt.valueChargeUnattached, lines: mixedProt.lines });
  // (b) a discount line is never a target
  ok(pickFoldTarget([disc], true, null) === null && pickFoldTarget([disc, posDisc], false, null) === null && !isFoldEligible(disc) && !isFoldEligible(posDisc), 'regression (b): a discount line (even a positive one) is never a fold target');
  ok(pickFoldTarget([disc, prot, piece], true, null) === piece, 'regression (b): with discount and protection lines present, the eligible service line is chosen');
  const jt = quote(order([art(60000)], { discountCode: 'JT' }));
  ok(!jt.lines.some((l) => l.kind === 'discount' && l.valueCharge) && jt.lines.filter((l) => l.valueCharge).length === 1, 'regression (b): with JT applied, no discount line carries a value charge', jt.lines);
  // (c) normal case: attaches exactly once to the piece line
  const n = quote(order([art(60000)]));
  const carriers = n.lines.filter((l) => l.valueCharge);
  ok(carriers.length === 1 && near(carriers[0].valueCharge, 450) && n.valueChargeUnattached === 0 && !n.lines.some((l) => l.kind === 'protection' && l.valueCharge), 'regression (c): normal case attaches the $450 once, to the piece line, never to protection', n.lines);
  ok(pickFoldTarget([prot, piece], true, piece) === piece && pickFoldTarget([prot, vcOnly, piece], true, null) === piece, 'regression (c): own piece line wins; a value-charge-only line is skipped');
  // JT 25% = whole order total (incl. protection, install and folded 0.75%), same in normal and rush
  const jn = quote(order([art(60000)], { discountCode: 'JT' }));
  ok(near(jn.discount.amount, 0.25 * (jn.total + jn.discount.amount)), 'JT is 25% of the full pre-discount order total, folded 0.75% included (normal)', { disc: jn.discount.amount, total: jn.total });
  const jr = quote(order([art(12344)], { discountCode: 'JT', rush: true }));
  const jrReg = quote(order([art(12344)], { discountCode: 'JT' }));
  ok(jr.discount && near(jr.discount.amount, jrReg.discount.amount) && jr.discount.type === 'percent', 'JT in a rush quote uses the same 25% of the order total as the normal quote', { rush: jr.discount && jr.discount.amount, reg: jrReg.discount.amount });
}

hdr('3e. Declared value protection: optional, included by default (Chad, Nov 19)');
{
  const base = quote(order([art(12344)]));
  ok(base.protection && near(base.protection.amount, 185.16) && base.protectionOption.declined === false && !base.protectionDeclined, 'default: included');
  for (const v of ['true', 1, 'yes', {}, [], 'on', false, null, undefined, 0]) ok(quote(order([art(12344)], { protectionDeclined: v })).protection !== null, `protectionDeclined ${JSON.stringify(v)} does not decline`);
  const dec = quote(order([art(12344)], { protectionDeclined: true }));
  ok(dec.protection === null && near(dec.total, 200) && dec.protectionDeclined === true && near(dec.protectionOption.amount, 185.16) && dec.protectionOption.declined, 'explicit true: protection line gone, total $200, add-back amount ($185.16) still reported');
  ok(!dec.lines.some((l) => /protection/i.test(l.label)), 'no protection line in the declined quote');
  const decRush = quote(order([art(12344)], { protectionDeclined: true, rush: true }));
  ok(near(decRush.quoteRange.low, 300) && near(decRush.quoteRange.high, 400) && decRush.quoteRange.valueCharges === 0, 'declined + rush: plain 1.5x to 2x of $200 ($300 to $400)', decRush.quoteRange);
  const multi = quote(order([art(12344), art(5000)], { protectionDeclined: true }));
  ok(!multi.lines.some((l) => /protection/i.test(l.label)), 'declined removes the protection line for every piece');
  const big = quote(order([art(60000)], { protectionDeclined: true }));
  const bigDef = quote(order([art(60000)]));
  ok(big.protectionOption === null && big.total === bigDef.total && !big.protectionDeclined && !big.lines.some((l) => /protection|0\.75|value/i.test(l.label)) && !JSON.stringify(big.notes).match(/0\.75|protection/i), 'over-$50k piece: unchanged by the flag, no protection line, no 0.75% wording anywhere');
  const mix = quote(order([art(12344), art(60000)], { protectionDeclined: true }));
  ok(near(mix.total, quote(order([art(12344), art(60000)])).total - 185.16), 'mixed order: declining removes only the up-to-$50k protection');
  ok(quote(order([art(12344)], { service: 'crating_shipping', protectionDeclined: true })).protectionOption == null, 'shipping quotes have no protection to decline');
  ok(/^Declared value protection: 1\.5% of \$12,344$/.test(base.lines.find((l) => /protection/i.test(l.label)).label), 'the line is no longer labelled "Required"');
}

hdr('3f. Member rate removed from the public site');
{
  const plain = quote(order([art(5000)]));
  for (const extra of [{ member: true }, { memberCode: 'JONES-TERWILLIGER' }, { member: true, memberCode: 'PALOMAS', memberCompany: 'X' }, { memberCode: 'jones-terwilliger', memberVerified: true }]) {
    const m = quote(order([art(5000)], extra));
    ok(m.total === plain.total && m.member === false && !m.lines.some((l) => /member/i.test(l.label)), `member input ${JSON.stringify(extra)} changes nothing`);
  }
  const mirror = (extra) => quote({ service: 'install_only', pickup: {}, dropoff: { street: '1 Main St', city: 'San Francisco', zip: '94110' }, schedule: { date: '2026-12-08' }, items: [{ type: 'mirror', w: 60, h: 40, description: 'm' }], ...extra });
  ok(mirror({ memberCode: 'jones-terwilliger' }).total === mirror({}).total, 'a member code on a mirror install changes nothing either');
  const partner = quote({ ...order([art(5000)]), partnerOrder: true, memberCode: 'PALOMAS' });
  ok(partner.member === true && partner.total < plain.total, "the partner showroom flow (Paloma's) still prices from the member rate card", { partner: partner.total, plain: plain.total });
  const partnerCode = quote({ ...order([art(12344)]), partnerOrder: true, memberCode: 'PALOMAS', discountCode: 'JT' });
  ok(!partnerCode.discount || !partnerCode.discount.applied, 'discount codes never stack onto partner showroom orders');
}

hdr('3g. Discount codes: percent and delivery credit');
{
  const config = require('../config');
  const D = require('../lib/discounts');
  const withRow = (row, fn) => { config.discountCodes.push(row); try { return fn(); } finally { config.discountCodes.pop(); } };
  const jt = quote(order([art(12344)], { discountCode: 'jt' }));
  ok(jt.discount.applied && near(jt.discount.amount, 96.29) && near(jt.total, 288.87), 'JT: 25% off the ORDER TOTAL (protection included): $385.16 -> $288.87', jt.discount);
  const jl = jt.lines.find((l) => l.kind === 'discount');
  ok(jl && /^Discount code JT/.test(jl.label) && near(jl.amount, -96.29), 'the discount is its own negative line, labelled with the code');
  ok(quote(order([art(12344)], { discountCode: ' Jt ' })).discount.applied && quote(order([art(12344)], { discountCode: 'jT' })).discount.applied, 'codes are case-insensitive and trimmed');
  ok(quote(order([art(12344)], { discountCode: 'NOPE' })).discount.applied === false && quote(order([art(12344)], { discountCode: 'NOPE' })).total === 385.16, 'an unknown code does nothing');
  ok(quote(order([art(12344)], { discountCode: 'FREEDELIVERY500' })).total === 385.16, 'FREEDELIVERY500 is inactive by default and does nothing');
  ok(D.lookup('FREEDELIVERY500').reason === 'inactive', 'the sample delivery credit exists and is inactive');
  ok(quote(order([art(12344)], { discountCode: 'JT', protectionDeclined: true })).total === 150, 'JT after declining protection: 25% of $200 = $150');

  // table features
  withRow({ code: 'OLD', type: 'percent', percent: 10, expires: '2020-01-01' }, () => ok(D.lookup('old').reason === 'expired' && quote(order([art(12344)], { discountCode: 'OLD' })).total === 385.16, 'an expired code does nothing'));
  withRow({ code: 'LATER', type: 'percent', percent: 10, expires: '2099-12-31' }, () => ok(D.lookup('later').ok, 'a code with a future expiry works'));
  withRow({ code: 'EDGE', type: 'percent', percent: 10, expires: D.lookup('JT').ok ? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : '' }, () => ok(D.lookup('edge').ok, 'a code works through its expiry date (Pacific)'));
  withRow({ code: 'NOFLAG', type: 'percent', percent: 10 }, () => ok(D.lookup('noflag').ok, 'a row with no active flag and no expiry is active'));
  withRow({ code: 'BROKEN', type: 'percent', percent: 150 }, () => ok(!D.lookup('broken').ok, 'a misconfigured row (150%) is refused, not applied'));
  withRow({ code: 'BROKEN2', type: 'wat', percent: 10 }, () => ok(!D.lookup('broken2').ok, 'an unknown code type is refused'));

  const credit = (items, extra = {}, rowOver = {}) => withRow({ code: 'CRED', type: 'deliveryCredit', amount: 500, ...rowOver }, () => quote(order(items, { discountCode: 'cred', ...extra })));
  const noCode = (items, extra = {}) => quote(order(items, extra));
  const c1 = credit([art(12344)]);
  ok(near(c1.discount.amount, 200) && near(c1.total, 185.16), 'delivery credit: capped at the $200 transport price, protection untouched ($185.16 left)', c1.discount);
  const c2 = credit([art(12344)], { service: 'delivery_install' });
  const c2b = noCode([art(12344)], { service: 'delivery_install' });
  ok(near(c2.discount.amount, 200) && near(c2b.total - c2.total, 200), 'delivery + install: only the $200 transport is credited, installation untouched', { credit: c2.discount.amount, lines: c2b.lines.map((l) => [l.label.slice(0, 24), l.amount]) });
  const c3 = credit([art(12344)], { service: 'install_only' });
  ok(c3.discount.applied && c3.discount.amount === 0 && c3.total === noCode([art(12344)], { service: 'install_only' }).total && /no standard pickup and delivery/.test(c3.discount.note), 'install-only: code accepted, $0 off, with an honest note');
  const c4 = credit([art(60000)]);
  ok(near(c4.discount.eligibleTransport, 200) && near(c4.discount.amount, 200) && near(c4.total, 450), 'over-$50k piece: credit takes the $200 transport only; the $450 value charge stays', c4.discount);
  const dz = { street: '1 Main St', city: 'San Francisco', zip: '94110', accessMode: 'stairs', stairFlights: 3, stairDir: 'up', stairTurns: 'no', stairPhotos: [], fits: 'yes' };
  require('../public/access').normalize(dz);
  const stairs = { dropoff: dz };
  const s0 = noCode([art(5000, { weight: 90 })], stairs), s1 = credit([art(5000, { weight: 90 })], stairs);
  ok(s0.lines.some((l) => /^Stairs/.test(l.label)) && near(s0.total - s1.total, 200) && near(s1.discount.amount, 200), 'stairs fees are not credited', { stairs: s0.lines.map((l) => [l.label.slice(0, 18), l.amount]) });
  const o0 = noCode([art(5000, { w: 80, h: 90 })]), o1 = credit([art(5000, { w: 80, h: 90 })]);
  ok(o0.lines.some((l) => /^Oversize painting/.test(l.label)) && near(o1.discount.amount, 200) && near(o0.total - o1.total, 200), 'oversize painting markup is not credited', o0.lines.map((l) => [l.label.slice(0, 22), l.amount]));
  const frame = [art(5000, { frameType: 'ornate', heavyFrame: true })];
  const h0 = noCode(frame), h1 = credit(frame);
  ok(near(h0.total - h1.total, h1.discount.amount) && h1.discount.amount <= h1.discount.eligibleTransport, 'a credit never exceeds the eligible standard transport');
  const many = Array.from({ length: 12 }, (_, i) => art(1000, { description: 'p' + i }));
  const m1 = credit(many);
  const transportSum = m1.lines.filter((l) => l.kind === 'transport').reduce((t, l) => t + l.amount, 0);
  ok(m1.discount.amount === Math.min(500, transportSum) && m1.discount.amount <= 500 && near(m1.discount.eligibleTransport, transportSum), `12 paintings: credit = min($500, transport $${transportSum})`, m1.discount);
  const small = credit([art(12344)], {}, { amount: 50 });
  ok(near(small.discount.amount, 50) && near(small.total, 335.16), 'a $50 credit takes $50');
  const furn = { type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium', description: 'Sofa', value: 3000, weight: 100 };
  const f1 = credit([furn]);
  ok(f1.discount.amount > 0 && f1.discount.amount <= f1.discount.eligibleTransport, 'furniture pickup/delivery/placement counts as standard transport');
  ok(!credit([art(12344)], { rush: false }).lines.some((l) => l.kind === 'discount' && l.amount > 0), 'a discount line is never positive');
  // percent applies to everything incl. install & fees
  const p1 = quote(order([art(5000)], { service: 'delivery_install', discountCode: 'JT' }));
  const p0 = quote(order([art(5000)], { service: 'delivery_install' }));
  ok(near(p1.total, p0.total * 0.75), 'JT takes 25% of the whole total including installation', { p0: p0.total, p1: p1.total });

  // rush
  const rj = quote(order([art(12344)], { rush: true, discountCode: 'JT' }));
  ok(near(rj.quoteRange.low, (300 + 185.16) * 0.75) && near(rj.quoteRange.high, (400 + 185.16) * 0.75), 'rush + JT: the percent comes off both ends of the range ($363.87 to $438.87)', rj.quoteRange);
  ok(/applied to this estimate/.test(rj.discount.note) && /final price/.test(rj.discount.note), 'rush + code: the quote says CAD confirms the final price with the code', rj.discount.note);
  const rc = credit([art(12344)], { rush: true });
  ok(near(rc.quoteRange.low, 485.16 - 200) && near(rc.quoteRange.high, 585.16 - 200), 'rush + $500 credit: capped at the regular $200 transport, so $285.16 to $385.16', rc.quoteRange);
  const rn = quote(order([art(12344)], { rush: true, discountCode: 'NOPE' }));
  ok(near(rn.quoteRange.low, 485.16) && near(rn.quoteRange.high, 585.16), 'rush + a bad code: range unchanged');
  ok(quote(order([art(12344)], { dedicated: true, discountCode: 'JT' })).quoteRange.low > 0, 'dedicated trip with a code still gets a range');
  // big order: deposit plan follows the discounted total
  const big = Array.from({ length: 40 }, (_, i) => art(40000, { description: 'p' + i }));
  const b0 = quote(order(big)), b1 = quote(order(big, { discountCode: 'JT' }));
  ok(near(b1.total, b0.total * 0.75) && b1.dueNow <= b0.dueNow, 'payment due follows the discounted total', { b0: b0.total, b1: b1.total });
}

hdr('4. Server: availability, order validation');
const PORT = 4200 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
(async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-fix19-'));
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', BASE_URL: BASE }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
    const o = order([art(5000)]);
    const good = (await post('/api/availability', o));
    ok(good.status === 200 && good.j.days && good.j.days.length > 0 && !!good.j.region, 'valid address still gets a route and dates', { status: good.status });
    const badZip = await post('/api/availability', { ...o, dropoff: { ...o.dropoff, zip: '123456' }, pickup: { ...o.pickup, zip: '123456' } });
    ok(badZip.status === 400 && badZip.j.days.length === 0 && !badZip.j.region && !badZip.j.zone, 'ZIP 123456: no route, no dates, HTTP 400', badZip.j);
    const badStreet = await post('/api/availability', { ...o, pickup: { ...o.pickup, street: 'Henry Adams St' } });
    ok(badStreet.status === 400 && badStreet.j.invalid.includes('pickup'), 'street without a number: no route', badStreet.j);
    const badCity = await post('/api/availability', { ...o, dropoff: { ...o.dropoff, city: '12' } });
    ok(badCity.status === 400 && badCity.j.invalid.includes('dropoff'), 'implausible city: no route', badCity.j);
    const dateOk = good.j.days[0].date;
    const full = (over = {}) => ({
      ...o, schedule: { date: dateOk, deliveryDate: dateOk, timePref: 'midday' }, payer: 'me', contact: { name: 'Test Client', email: 't@example.com', phone: '310-555-0100' },
      pickup: { ...o.pickup, contactName: 'A', contactPhone: '310-555-0101', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' },
      dropoff: { ...o.dropoff, contactName: 'B', contactPhone: '310-555-0102', contactRole: 'Homeowner', accessMode: 'ground', fits: 'yes' }, ...over,
    });
    const goodOrder = await post('/api/orders', full({ items: [{ ...art(5000), framed: 'no' }] }));
    ok(goodOrder.status === 200 || (goodOrder.status === 400 && !/ZIP|street|city|size/.test((goodOrder.j || {}).error || '')), 'a valid order is not refused for address or size', goodOrder.j && goodOrder.j.error);
    const badOrderZip = await post('/api/orders', full({ dropoff: { ...full().dropoff, zip: '123456' }, items: [{ ...art(5000), framed: 'no' }] }));
    ok(badOrderZip.status === 400 && /ZIP/.test(badOrderZip.j.error), 'order with ZIP 123456 is refused', badOrderZip.j);
    const tiny = await post('/api/orders', full({ items: [{ ...art(5000), framed: 'no', w: 1, h: 1, d: 1 }] }));
    ok(tiny.status === 400 && /size/.test(tiny.j.error), 'order with a 1 x 1 x 1 piece is refused', tiny.j);
    const blank = await post('/api/orders', full({ items: [{ ...art(5000), framed: 'no', w: '', h: '', d: '' }] }));
    ok(blank.status === 400 && /size/.test(blank.j.error), 'order with blank sizes is refused', blank.j);
  } finally { child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
