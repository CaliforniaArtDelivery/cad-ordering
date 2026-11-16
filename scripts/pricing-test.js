// Unit tests for quote() pricing. Usage: npm test
const { quote, roundUpTo, mirrorInstallTier, mirrorTransportTier } = require('../lib/pricing');

const errors = [];
const check = (cond, msg, extra) => {
  if (!cond) {
    errors.push(msg);
    console.error('FAIL:', msg, extra != null ? extra : '');
  }
};

const q = (service, items, extra = {}) => quote({ service, items, ...extra });
const line = (res, re) => (res.lines || []).find((l) => re.test(l.label));

check(roundUpTo(112.5, 5) === 115, '112.50 should round up to $115');
check(roundUpTo(82.5, 5) === 85, '82.50 should round up to $85');
check(roundUpTo(137.5, 5) === 140, '137.50 should round up to $140');
check(roundUpTo(110, 5) === 110, '110 is already a $5 step and should stay $110');
check(roundUpTo(111, 5) === 115, '111 should round up to $115, not down to $110');
check(roundUpTo(187.5, 5) === 190, '187.50 should round up to $190');

const inst = (w, h) => mirrorInstallTier({ w, h }).multiplier;
const trn = (w, h) => mirrorTransportTier({ w, h }).multiplier;
check(inst(40, 40) === 1 && trn(40, 40) === 1, '40×40 should be 1× install and 1× transport');
check(inst(48, 48) === 1 && trn(48, 48) === 1, '48×48 should be 1× install and 1× transport');
check(inst(48, 49) === 1.5 && trn(48, 49) === 1, '48×49 should be 1.5× install and 1× transport');
check(inst(59, 40) === 1.5 && trn(59, 40) === 1, '59×40 should be 1.5× install and 1× transport (under 60")');
check(inst(60, 40) === 1.5 && trn(60, 40) === 1.5, '60×40 should be 1.5× install and 1.5× transport (60" inclusive for transport)');
check(inst(60, 60) === 1.5 && trn(60, 60) === 1.5, '60×60 should be 1.5× / 1.5×');
check(inst(61, 40) === 2.5 && trn(61, 40) === 1.5, '61×40 should be 2.5× install and 1.5× transport');
check(inst(70, 40) === 2.5 && trn(70, 40) === 1.5, '70×40 should be 2.5× install and 1.5× transport (70 is not over 70)');
check(inst(71, 40) === 3 && trn(71, 40) === 2, '71×40 should be 3× install and 2× transport');
check(mirrorInstallTier({ w: 40, h: 40, d: 80 }).multiplier === 1, 'depth alone must not raise the install tier');
check(mirrorTransportTier({ w: 40, h: 40, d: 80 }).multiplier === 1, 'depth alone must not raise the transport tier');

// 40×40: both 1×. Install equals a painting. Transport stays $200.
const small = q('install_only', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }]);
const paintSmall = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, description: 'p' }]);
check(small.total === 75, '40×40 mirror install-only should be $75', small);
check(paintSmall.total === 75, '40×40 painting install-only should be $75', paintSmall);
check(!line(small, /Large mirror/), '40×40 must not get a large-mirror surcharge', small.lines);
const diSmall = q('delivery_install', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }]);
const pdSmall = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }]);
check(pdSmall.total === 200, '40×40 pickup+delivery should stay $200', pdSmall);
check(diSmall.total === 275, '40×40 delivery+install should stay $275', diSmall);

// 59×40: install 1.5× $75 → $115; transport still 1× $200.
const inst59 = q('install_only', [{ qty: 1, type: 'mirror', w: 59, h: 40, description: 'm' }]);
const pd59 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 59, h: 40, description: 'm' }]);
const di59 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 59, h: 40, description: 'm' }]);
check(inst59.total === 115, '59×40 install-only should be $115', inst59);
check(pd59.total === 200, '59×40 pickup+delivery should stay $200 (under 60")', pd59);
check(di59.total === 315, '59×40 delivery+install should be $315 ($200 + $115)', di59);
check(!line(pd59, /Large mirror pickup/) && !line(di59, /Large mirror pickup/),
  '59×40 must not get a transport multiplier', pd59.lines);

// 60×40: install 1.5× $75 → $115; transport 1.5× $200 → $300 (60" inclusive).
const inst60 = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }]);
const pd60 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }]);
const di60 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }]);
check(inst60.total === 115, '60×40 install-only should be $115', inst60);
check(line(inst60, /Large mirror install \(over 48"\) × 1/) && line(inst60, /Large mirror install \(over 48"\)/).amount === 40,
  '60×40 install should add a $40 over-48" line', inst60.lines);
check(pd60.total === 300, '60×40 pickup+delivery should be $300 (1.5× $200)', pd60);
check(line(pd60, /Large mirror pickup & delivery \(60"\+\) × 1/) && line(pd60, /Large mirror pickup & delivery \(60"\+\)/).amount === 100,
  '60×40 should add a $100 transport line at 60"+', pd60.lines);
check(di60.total === 415, '60×40 delivery+install should be $415 ($300 + $115)', di60);

const at48 = q('install_only', [{ qty: 1, type: 'mirror', w: 48, h: 48, description: 'm' }]);
const over48 = q('install_only', [{ qty: 1, type: 'mirror', w: 48, h: 49, description: 'm' }]);
check(at48.total === 75, '48×48 install should equal the painting rate $75', at48);
check(over48.total === 115, '48×49 install should be $115', over48);

// 61×40 / 70×40: install 2.5× $75 = $187.50 → $190; transport 1.5× $200 → $300.
const inst61 = q('install_only', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }]);
const pd61 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }]);
const di61 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }]);
check(inst61.total === 190, '61×40 install-only should be $190 (2.5× $75, rounded up)', inst61);
check(line(inst61, /Large mirror install \(over 60"\) × 1/) && line(inst61, /Large mirror install \(over 60"\)/).amount === 115,
  '61×40 should add a $115 over-60" install line', inst61.lines);
check(!line(inst61, /over 48"/) && !line(inst61, /over 50"/), '61×40 must not use a 48" or 50" install line', inst61.lines);
check(pd61.total === 300, '61×40 pickup+delivery should be $300', pd61);
check(di61.total === 490, '61×40 delivery+install should be $490 ($300 + $190)', di61);

const inst70 = q('install_only', [{ qty: 1, type: 'mirror', w: 70, h: 40, description: 'm' }]);
const pd70 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 70, h: 40, description: 'm' }]);
const di70 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 70, h: 40, description: 'm' }]);
check(inst70.total === 190, '70×40 should stay in the 2.5× install tier ($190)', inst70);
check(pd70.total === 300, '70×40 pickup+delivery should stay in the 1.5× transport tier ($300)', pd70);
check(di70.total === 490, '70×40 delivery+install should be $490', di70);
check(line(pd70, /60"\+/) && !line(pd70, /over 70"/), '70×40 transport should use the 60"+ line, not over 70"', pd70.lines);

// 71×40: install 3× $75 = $225; transport 2× $200 = $400.
const inst71 = q('install_only', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }]);
const pd71 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }]);
const di71 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }]);
check(inst71.total === 225, '71×40 install-only should be $225 (3× $75)', inst71);
check(line(inst71, /Large mirror install \(over 70"\) × 1/) && line(inst71, /Large mirror install \(over 70"\)/).amount === 150,
  '71×40 should add a $150 over-70" install line', inst71.lines);
check(pd71.total === 400, '71×40 pickup+delivery should be $400 (2× $200)', pd71);
check(line(pd71, /Large mirror pickup & delivery \(over 70"\) × 1/) && line(pd71, /Large mirror pickup & delivery \(over 70"\)/).amount === 200,
  '71×40 should add a $200 over-70" transport line', pd71.lines);
check(di71.total === 625, '71×40 delivery+install should be $625 ($400 + $225)', di71);

// Depth does not raise a mirror multiplier (it can still trigger the existing 72"+ oversize fee, same as a painting).
const deep = q('install_only', [{ qty: 1, type: 'mirror', w: 40, h: 40, d: 80, description: 'm' }]);
const deepPaint = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, d: 80, description: 'p' }]);
const noDim = q('install_only', [{ qty: 1, type: 'mirror', description: 'm' }]);
const pdDeep = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 40, h: 40, d: 80, description: 'm' }]);
const pdDeepPaint = q('pickup_delivery', [{ qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, d: 80, description: 'p' }]);
check(!line(deep, /Large mirror install/), '40×40×80 depth must not add a large-mirror install multiplier', deep.lines);
check(deep.total === deepPaint.total, '40×40×80 mirror install should match a painting of the same size', { deep: deep.total, deepPaint: deepPaint.total });
check(noDim.total === 75, 'mirror with no dimensions should use the painting install rate', noDim);
check(!line(pdDeep, /Large mirror pickup/), '40×40×80 depth must not add a transport multiplier', pdDeep.lines);
check(pdDeep.total === pdDeepPaint.total, '40×40×80 mirror pickup+delivery should match a painting of the same size', { pdDeep: pdDeep.total, pdDeepPaint: pdDeepPaint.total });

const pdPaint = q('pickup_delivery', [{ qty: 1, type: 'painting', framed: 'no', w: 60, h: 40, description: 'p' }]);
check(pdPaint.total === 200, '60×40 painting pickup+delivery should stay $200 (multipliers are mirrors only)', pdPaint);

// 80×40: 72"+ oversize delivery $100 is part of the transport base; 2 × ($200 + $100) = $600.
// Install is 3 × ($75 + $200) = $825. Delivery+install total $1,425.
const diHuge = q('delivery_install', [{ qty: 1, type: 'mirror', w: 80, h: 40, description: 'm' }]);
const pdHuge = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 80, h: 40, description: 'm' }]);
const paintHuge = q('delivery_install', [{ qty: 1, type: 'painting', framed: 'no', w: 80, h: 40, description: 'p' }]);
check(paintHuge.total === 575, '80×40 painting delivery+install should stay $575', paintHuge);
check(pdHuge.total === 600, '80×40 pickup+delivery should be $600 (2× $300)', pdHuge);
check(diHuge.total === 1425, '80×40 delivery+install should be $1,425', diHuge);
check(line(diHuge, /Oversize painting \(72"\+\) delivery/) && line(diHuge, /Oversize painting \(72"\+\) delivery/).amount === 100,
  '72"+ mirror delivery surcharge line should still be the $100 base', diHuge.lines);
check(line(diHuge, /Large mirror pickup & delivery \(over 70"\)/) && line(diHuge, /Large mirror pickup & delivery \(over 70"\)/).amount === 300,
  '80×40 transport extra should be $300 (2× $300 − $300)', diHuge.lines);
check(line(diHuge, /Large mirror install \(over 70"\)/) && line(diHuge, /Large mirror install \(over 70"\)/).amount === 550,
  '80×40 install extra should be $550 (3× $275 − $275)', diHuge.lines);

// Member install amounts are unchanged; member transport is 1.5× / 2× the member painting delivery rate.
const memInst60 = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(memInst60.member && memInst60.total === 85, 'member 60×40 install-only should be $85 (1.5 × $55, rounded up)', memInst60);
const memSmall = q('install_only', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(memSmall.member && memSmall.total === 55, 'member 40×40 install-only should stay $55', memSmall);
const mem61 = q('install_only', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(mem61.member && mem61.total === 140, 'member 61×40 install-only should be $140 (2.5 × $55, rounded up)', mem61);
const mem71 = q('install_only', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(mem71.member && mem71.total === 165, 'member 71×40 install-only should be $165 (3 × $55)', mem71);
const memPd60 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(memPd60.member && memPd60.total === 225, 'member 60×40 pickup+delivery should be $225 (1.5 × $150)', memPd60);
const memPd71 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(memPd71.member && memPd71.total === 300, 'member 71×40 pickup+delivery should be $300 (2 × $150)', memPd71);
const memDi60 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(memDi60.member && memDi60.total === 310, 'member 60×40 delivery+install should be $310 ($225 + $85)', memDi60);

// Décor → Mirror uses the same path.
const decorSmall = q('install_only', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', w: 40, h: 40, description: 'm' }]);
const decor60di = q('delivery_install', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', w: 60, h: 40, description: 'm' }]);
const decorPD = q('pickup_delivery', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', description: 'm' }]);
const decorOver60 = q('install_only', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', w: 61, h: 40, description: 'm' }]);
const decorPd60 = q('pickup_delivery', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', w: 60, h: 40, description: 'm' }]);
check(decorSmall.total === 75, 'Décor Mirror 40×40 install should be $75', decorSmall);
check(decor60di.total === 415, 'Décor Mirror 60×40 delivery+install should be $415', decor60di);
check(decorPD.total === 200, 'Décor Mirror with no size should use 1× painting delivery $200', decorPD);
check(decorOver60.total === 190, 'Décor Mirror 61×40 install should be $190', decorOver60);
check(decorPd60.total === 300, 'Décor Mirror 60×40 pickup+delivery should be $300', decorPd60);

// Mixed cart: quantity tables still shared; only the mirror's shares are multiplied.
const mixed = q('delivery_install', [
  { qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, description: 'p' },
  { qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' },
]);
check(line(mixed, /Wall art delivery .* × 2/) && line(mixed, /Wall art delivery/).amount === 300, 'mixed delivery ×2 should stay $300', mixed.lines);
check(line(mixed, /Hanging .* × 2/) && line(mixed, /Hanging/).amount === 150, 'mixed hanging ×2 should stay $150', mixed.lines);
check(line(mixed, /Large mirror pickup & delivery \(60"\+\) × 1/) && line(mixed, /Large mirror pickup & delivery \(60"\+\)/).amount === 75,
  'mixed 60×40 transport extra should be $75 (1.5 × $150 − $150)', mixed.lines);
check(line(mixed, /Large mirror install \(over 48"\) × 1/) && line(mixed, /Large mirror install \(over 48"\)/).amount === 40, 'mixed large-mirror install extra should be $40', mixed.lines);
check(mixed.total === 565, 'mixed painting + 60×40 mirror delivery+install should be $565', mixed);

const two = q('install_only', [{ qty: 2, type: 'mirror', w: 60, h: 40, description: 'm' }]);
check(two.total === 230, 'two 60×40 mirrors install-only should stay $230 ($150 + $40 × 2)', two);

const split = q('install_only', [
  { qty: 1, type: 'mirror', w: 60, h: 40, description: 'a' },
  { qty: 1, type: 'mirror', w: 61, h: 40, description: 'b' },
]);
check(line(split, /over 48"/) && line(split, /over 48"/).amount === 40, 'split job should keep the over-48" install line at $40', split.lines);
check(line(split, /over 60"/) && line(split, /over 60"/).amount === 115, 'split job should have the over-60" install line at $115', split.lines);
check(split.total === 305, '60×40 + 61×40 install-only should stay $305', split);

// Markup base (the +% part) checked with the 1.5% minimum switched off, then the minimum on top.
const configHv = require('../config');
configHv.pricing.valuation.highValueFloor = false;
const hv = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, value: 100001, description: 'm' }]);
const hl = line(hv, /High-value handling \+200%/);
check(hl && hl.amount === 230, 'high-value +200% on install-only should be based on $115, so $230', hv.lines);
check(hv.total === 345, 'high-value 60×40 install-only should stay $345', hv);
const hvPd = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 60, h: 40, value: 100001, description: 'm' }]);
const hlPd = line(hvPd, /High-value handling \+200%/);
check(hlPd && hlPd.amount === 600, 'high-value +200% on 60×40 pickup+delivery should be based on $300, so $600', hvPd.lines);
check(hvPd.total === 900, 'high-value 60×40 pickup+delivery should be $900', hvPd);
configHv.pricing.valuation.highValueFloor = true;
const hvMin = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, value: 100001, description: 'm' }]);
check(line(hvMin, /minimum 1\.5%/) && line(hvMin, /High-value/).amount === 1500.02 && hvMin.total === 1615.02, 'with the 1.5% minimum: $100,001 mirror install pays $1,500.02 (beats +200% = $230), total $1,615.02', hvMin.lines);

const paint60 = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 60, h: 40, description: 'p' }]);
const paint71 = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 71, h: 40, description: 'p' }]);
check(paint60.total === 75, '60×40 painting install should stay $75', paint60);
check(paint71.total === 75, '71×40 painting install should stay $75 (no 72" fee yet)', paint71);

// ---- Chad, Nov 16 2026, decision 1: declared value protection is a REQUIRED 1.5% line, worded honestly ----
const config = require('../config');
check(config.pricing.valuation.optional === false && config.pricing.valuation.rate === 0.015 && config.pricing.valuation.maxValue === 50000, 'protection config must be required, 1.5%, up to $50,000', config.pricing.valuation);
const sc = (value, extra = {}) => q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 120, value, description: 's', ...extra }]);
const at50 = sc(50000), over50 = sc(50001);
const DVP = /^Required declared value protection: 1\.5% of \$/;
const pl = line(at50, DVP);
check(pl && pl.label === 'Required declared value protection: 1.5% of $50,000' && pl.amount === 750, '$50,000 piece: required protection line, $750', at50.lines);
check(at50.protection && at50.protection.amount === 750 && at50.protection.eligibleValue === 50000, '$50,000 piece: quote.protection should carry $750 on $50,000 eligible', at50.protection);
check(!line(at50, /High-value/), '$50,000 piece: no high-value markup', at50.lines);
check(!line(over50, /declared value protection/i) && !over50.protection && line(over50, /High-value handling \(minimum 1\.5% of declared value\)/) && over50.total === 1150.02, '$50,001 piece: no protection, high-value handling at the 1.5% minimum ($750.02), total $1,150.02', over50.lines);
// Dot, Nov 16 2026: protection uses only ELIGIBLE pieces (each <= $50,000, times quantity), never the total declared value.
const mixedDv = q('pickup_delivery', [
  { qty: 2, type: 'sculpture', weight: 120, value: 10000, description: 'a' },
  { qty: 3, type: 'sculpture', weight: 120, value: 60000, description: 'b' },
  { qty: 1, type: 'painting', framed: 'no', w: 20, h: 20, d: 2, value: '50,000', description: 'c' },
  { qty: 4, type: 'painting', framed: 'no', w: 20, h: 20, d: 2, value: 250, description: 'd' },
]);
const mdl = line(mixedDv, DVP);
check(mdl && mdl.label === 'Required declared value protection: 1.5% of $71,000' && mdl.amount === 1065, 'mixed: 2×$10,000 + $50,000 + 4×$250 = $71,000 eligible → $1,065 (the 3×$60,000 never counts)', mixedDv.lines);
check(mixedDv.protection && mixedDv.protection.eligibleValue === 71000 && mixedDv.protection.amount === 1065, 'mixed: quote.protection.eligibleValue = $71,000', mixedDv.protection);
const mhv = line(mixedDv, /High-value handling \(minimum 1\.5% of declared value\) · b \(\$60,000\) × 3/);
check(mhv && mhv.amount === 2700 && (mixedDv.highValueItems || []).length === 1 && mixedDv.highValueItems[0].index === 1 && mixedDv.highValueItems[0].perPiece === 900, 'mixed: only the $60,000 pieces get high-value handling ($900 each, 1.5% minimum, × 3)', { l: mixedDv.lines, h: mixedDv.highValueItems });
const onlyHv = q('pickup_delivery', [{ qty: 2, type: 'sculpture', weight: 120, value: 75000, description: 'x' }]);
check(!line(onlyHv, /declared value protection/i) && !onlyHv.protection, 'only ineligible pieces: no protection line at all', onlyHv.lines);
const cents = q('pickup_delivery', [{ qty: 3, type: 'sculpture', weight: 120, value: 12345.67, description: 'x' }]);
check(line(cents, DVP) && line(cents, DVP).label === 'Required declared value protection: 1.5% of $37,037.01' && line(cents, DVP).amount === 555.56, 'quantity 3 × $12,345.67 → 1.5% of $37,037.01 = $555.56', cents.lines);
const instP = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 30, h: 30, value: 2000, description: 'p' }]);
check(line(instP, DVP) && line(instP, DVP).label === 'Required declared value protection: 1.5% of $2,000' && line(instP, DVP).amount === 30, 'install only also carries the required protection line', instP.lines);
for (const r of [at50, over50, mixedDv, instP, onlyHv]) for (const t of [...r.lines.map((l) => l.label), ...(r.notes || [])]) check(!/optional|insur|full coverage|fully covered/i.test(t), 'protection wording must not say optional, insurance or full coverage: ' + t);
const shipP = q('crating_shipping', [{ qty: 1, type: 'painting', value: 20000, description: 'x' }]);
check(!line(shipP, /declared value protection/i) && !shipP.protection, 'shipping quotes carry no protection line', shipP.lines);

// ---- Decision 2: over 500 lb and 72"+ pieces book and pay now (no quote review, no "CAD confirms" copy) ----
const noGate = (name, r) => {
  check(r.paymentPlan !== 'quote' && r.total > 0 && r.dueNow > 0, `${name}: should be bookable and payable now`, { plan: r.paymentPlan, total: r.total });
  for (const n of r.notes || []) check(!/confirm|may apply|review|adjust|starting rate|quote/i.test(n), `${name}: note implies a later price review: ${n}`);
};
noGate('501 lb sculpture', q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 501, w: 30, h: 40, d: 30, value: 5000, description: 's' }]));
const s750 = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 750, w: 30, h: 40, d: 30, value: 5000, description: 's' }]);
noGate('750 lb sculpture', s750);
check(line(s750, /Sculpture/) && line(s750, /Sculpture/).amount === 1000, '750 lb sculpture keeps the $1,000 over-700 rate', s750.lines);
noGate('80" sculpture', q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 200, w: 20, h: 80, d: 20, value: 5000, description: 's' }]));
const p72 = q('delivery_install', [{ qty: 1, type: 'painting', framed: 'no', w: 72, h: 40, value: 5000, description: 'p' }]);
noGate('72" painting', p72);
check(line(p72, /Oversize painting \(72"\+\) delivery/) && line(p72, /Oversize painting \(72"\+\) install/), '72" painting keeps the oversize lines', p72.lines);
noGate('600 lb, 90" other item', q('pickup_delivery', [{ qty: 1, type: 'other', weight: 600, w: 90, h: 30, d: 30, value: 5000, description: 'o' }]));
noGate('large 96" sofa', q('pickup_delivery', [{ qty: 1, type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'large', w: 96, h: 36, d: 40, value: 3000, description: 'f' }]));
// Unknown weight is not "heavy": it still can't be priced from the weight card, so it stays a CAD-priced request.
check(q('pickup_delivery', [{ qty: 1, type: 'sculpture', weightUnsure: true, value: 5000, description: 's' }]).paymentPlan === 'quote', 'unknown sculpture weight stays priced by CAD (no weight to price from)');

// ---- Chad approved Nov 16 2026: over $50,000 pays the greater of high-value handling or 1.5% of declared value ----
check(config.pricing.valuation.highValueFloor === true, 'high-value 1.5% minimum is the rule (Chad approved Nov 16 2026)');
const kinds = [
  ['painting, pickup + delivery', 'pickup_delivery', { type: 'painting', framed: 'no', w: 30, h: 40, d: 2 }],
  ['painting, delivery + install', 'delivery_install', { type: 'painting', framed: 'no', w: 30, h: 40, d: 2 }],
  ['mirror, install only', 'install_only', { type: 'mirror', w: 40, h: 40 }],
  ['photograph, pickup + delivery', 'pickup_delivery', { type: 'photograph', framed: 'yes', frameType: 'medium', glazing: 'glass', w: 30, h: 40, d: 2 }],
  ['120 lb sculpture', 'pickup_delivery', { type: 'sculpture', weight: 120, w: 20, h: 30, d: 20 }],
  ['900 lb sculpture', 'pickup_delivery', { type: 'sculpture', weight: 900, w: 30, h: 40, d: 30 }],
  ['medium sofa', 'pickup_delivery', { type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'medium' }],
  ['other fragile item', 'pickup_delivery', { type: 'other', weight: 80, w: 20, h: 20, d: 20 }],
];
for (const [name, svc, it] of kinds) for (const qty of [1, 3]) {
  const t = (value) => q(svc, [{ qty, description: 'x', ...it, value }]);
  const [a, b, c] = [49999, 50000, 50001].map(t);
  check(a.total <= b.total && b.total <= c.total, `${name} × ${qty}: price must never drop crossing $50,000`, [a.total, b.total, c.total]);
  const hvl = line(c, /High-value handling/);
  check(hvl && hvl.amount >= Math.round(50001 * 0.015 * qty * 100) / 100 - 0.01, `${name} × ${qty}: $50,001 charge is at least 1.5% of declared value`, c.lines);
  check(!line(c, /declared value protection/i), `${name} × ${qty}: $50,001 still gets no protection line`, c.lines);
  check(line(b, DVP) && line(b, DVP).amount === 750 * qty, `${name} × ${qty}: $50,000 keeps $750 per piece protection`, b.lines);
}
const flo = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 120, value: 50001, description: 's' }]);
check(line(flo, /^High-value handling \(minimum 1\.5% of declared value\) · s \(\$50,001\)$/) && line(flo, /High-value/).amount === 750.02 && flo.highValueItems[0].minimumApplied, 'the 1.5% minimum is labelled and recorded', flo.lines);
const big = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 900, value: 1000001, description: 's' }]);
check(line(big, /High-value/).amount === Math.max(1000 * 6, 15000.02) && /1\.5% of declared value/.test(line(big, /High-value/).label), '$1M+ piece pays the greater (1.5% = $15,000.02 beats +600% of $1,000)', big.lines);
const big2 = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 900, value: 60000, description: 's' }]);
check(line(big2, /High-value handling \+100%/) && line(big2, /High-value/).amount === 1000, 'when +100% ($1,000) beats 1.5% ($900) the markup stays', big2.lines);

check(line(sc(300001), /High-value/).amount === 4500.02, '1.5% of $300,001 rounds half-up to $4,500.02 (no float drift)', sc(300001).lines);

// ---- Decision 3: no sales tax anywhere ----
const fs = require('fs'), path = require('path');
for (const r of [at50, over50, mixedDv, instP, s750, p72, shipP]) for (const t of [...r.lines.map((l) => l.label), ...(r.notes || []), r.paymentSummary || '', r.quoteNote || '']) check(!/\btax/i.test(t), 'no tax wording in quotes: ' + t);
for (const f of ['public/app.js', 'public/index.html', 'public/admin.html', 'lib/email.js', 'lib/pricing.js', 'lib/shiptext.js', 'config.js', 'server.js']) check(!/\btax(es)?\b/i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), `${f} must not mention tax`);

console.log(JSON.stringify({ errors }, null, 2));
if (errors.length) {
  console.error('\n' + errors.length + ' pricing test(s) failed.');
  process.exit(1);
}
console.log('All pricing tests passed.');
