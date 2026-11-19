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
// Quantity no longer exists on the main site (one entry = one piece): qty in a test fixture means that many separate pieces, each with its own line.
const near = (a, b) => Math.abs(a - b) < 0.006;
const lines2 = (res, re) => (res.lines || []).filter((l) => re.test(l.label));
const sumLines = (res, re) => Math.round((res.lines || []).filter((l) => re.test(l.label)).reduce((t, l) => t + l.amount, 0) * 100) / 100;

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

// High-value handling is the +% markup on the piece's normal price only (no 1.5% floor), folded into the normal line.
const hv = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, value: 100001, description: 'm' }]);
check(!line(hv, /High-value/) && !hv.protection && near(hv.total, 865.01), 'over-$50,000 60×40 install-only: $115 + 0.75% of $100,001 ($750.01) = $865.01 in one price, no labeled line', hv.lines);
check(hv.highValueItems && hv.highValueItems[0].perPiece === 750.01 && hv.highValueItems[0].pct === 0.75, 'admin records the built-in 0.75% = $750.01', hv.highValueItems);
const hvPd = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 60, h: 40, value: 100001, description: 'm' }]);
check(!line(hvPd, /High-value/) && near(hvPd.total, 1050.01), 'over-$50,000 60×40 pickup+delivery: $300 + $750.01 = $1,050.01 in one price', hvPd.lines);
check(hvPd.highValueItems && hvPd.highValueItems[0].perPiece === 750.01, 'admin records $750.01 for the pickup+delivery piece', hvPd.highValueItems);

const paint60 = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 60, h: 40, description: 'p' }]);
const paint71 = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 71, h: 40, description: 'p' }]);
check(paint60.total === 75, '60×40 painting install should stay $75', paint60);
check(paint71.total === 75, '71×40 painting install should stay $75 (no 72" fee yet)', paint71);

// ---- Chad, Nov 16 2026, decision 1: declared value protection is a REQUIRED 1.5% line, worded honestly ----
const config = require('../config');
check(config.pricing.valuation.optional === false && config.pricing.valuation.rate === 0.015 && config.pricing.valuation.maxValue === 50000, 'protection config must be required, 1.5%, up to $50,000', config.pricing.valuation);
const sc = (value, extra = {}) => q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 120, value, description: 's', ...extra }]);
const at50 = sc(50000), over50 = sc(50001);
const DVP = /^Required declared value protection( — Piece \d+[^:]*)?: 1\.5% of \$/;
const pl = line(at50, DVP);
check(pl && pl.label === 'Required declared value protection: 1.5% of $50,000' && pl.amount === 750, '$50,000 piece: required protection line, $750', at50.lines);
check(at50.protection && at50.protection.amount === 750 && at50.protection.eligibleValue === 50000, '$50,000 piece: quote.protection should carry $750 on $50,000 eligible', at50.protection);
check(!line(at50, /High-value/), '$50,000 piece: no high-value markup', at50.lines);
check(!line(over50, /declared value protection/i) && !over50.protection && !line(over50, /High-value/) && near(line(over50, /Sculpture/).amount, 775.01) && near(over50.total, 775.01), '$50,001 piece: no protection line or handling label; $400 move + $375.01 built in = $775.01', over50.lines);
check(over50.highValueItems && over50.highValueItems[0].perPiece === 375.01, '$50,001: admin records the built-in $375.01', over50.highValueItems);
check(!(over50.notes || []).length, '$50,001: no customer note', over50.notes);
// Dot, Nov 16 2026: protection uses only ELIGIBLE pieces (each <= $50,000, times quantity), never the total declared value.
const mixedDv = q('pickup_delivery', [
  { qty: 2, type: 'sculpture', weight: 120, value: 10000, description: 'a' },
  { qty: 3, type: 'sculpture', weight: 120, value: 60000, description: 'b' },
  { qty: 1, type: 'painting', framed: 'no', w: 20, h: 20, d: 2, value: '50,000', description: 'c' },
  { qty: 4, type: 'painting', framed: 'no', w: 20, h: 20, d: 2, value: 250, description: 'd' },
]);
const mdl = line(mixedDv, DVP);
check(mdl && sumLines(mixedDv, DVP) === 1065 && mixedDv.lines.filter((l) => DVP.test(l.label)).length === 7, 'mixed: 2×$10,000 + $50,000 + 4×$250 = $71,000 eligible → $1,065 (the 3×$60,000 never counts)', mixedDv.lines);
check(mixedDv.protection && mixedDv.protection.eligibleValue === 71000 && mixedDv.protection.amount === 1065, 'mixed: quote.protection.eligibleValue = $71,000', mixedDv.protection);
check(!line(mixedDv, /High-value/) && sumLines(mixedDv, /Sculpture:.*· b/) === 2550 && mixedDv.lines.filter((l) => /Sculpture:.*· b/.test(l.label)).every((l) => l.amount === 850), 'mixed: each $60,000 sculpture is $400 + 0.75% of $60,000 ($450) = $850 in its own line (3 pieces = $2,550)', mixedDv.lines);
check((mixedDv.highValueItems || []).length === 3 && mixedDv.highValueItems.every((h) => h.perPiece === 450 && h.qty === 1) && mixedDv.highValueItems.map((h) => h.index).join() === '2,3,4', 'mixed: admin records the built-in $450 for each of the three $60,000 pieces (pieces 3, 4, 5)', mixedDv.highValueItems);
const onlyHv = q('pickup_delivery', [{ qty: 2, type: 'sculpture', weight: 120, value: 75000, description: 'x' }]);
check(!line(onlyHv, /declared value protection/i) && !onlyHv.protection && !line(onlyHv, /High-value/) && near(onlyHv.total, 1925), 'only over-$50,000 pieces: no protection line or handling label; 2 × ($400 + 0.75% of $75,000 = $562.50) = $1,925 total', onlyHv.lines);
const cents = q('pickup_delivery', [{ qty: 3, type: 'sculpture', weight: 120, value: 12345.67, description: 'x' }]);
check(cents.lines.filter((l) => DVP.test(l.label)).length === 3 && cents.lines.filter((l) => DVP.test(l.label)).every((l) => l.amount === 185.19 && /Piece [123]/.test(l.label)) && sumLines(cents, DVP) === 555.57 && cents.protection.amount === 555.57, '3 pieces × $12,345.67 → 1.5% each = $185.19 (rounded per piece) = $555.57, one labeled line per piece', cents.lines);
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
// Samantha, Nov 18 2026: NEED HELPER (over 150 lb, any sofa / heavy furniture) keeps Chad's price rule (priced from the card, never a CAD-priced quote).
// Chad's standing Nov 16 rule wins by default (config.scheduling.helperRules.holdOrders = false): heavy pieces book and pay immediately at the card price and
// NEED HELPER is only a label on the sheet so Samantha books a helper. With HELPER_HOLD_ORDERS=1 (run: HELPER_HOLD_ORDERS=1 node scripts/pricing-test.js)
// the order is a pending request instead: the date is held until a helper is booked, and nothing is charged until the team confirms.
const HELPER_HOLD = process.env.HELPER_HOLD_ORDERS === '1';
const RULES = require('../lib/date-guard-rules');
console.log(`NEED HELPER mode: ${HELPER_HOLD ? 'HOLD (HELPER_HOLD_ORDERS=1)' : 'label only (default, Chad Nov 16 rule)'}`);
const helperHold = (name, service, items) => {
  const r = q(service, items);
  check(RULES.review({ service, items }).helper === true, `${name}: flagged NEED HELPER by the rules`);
  if (HELPER_HOLD) {
    check(r.reviewOnly === true && r.total > 0 && /NEED HELPER/.test((r.reviewReasons || []).join(' ')) && r.reviewKinds.includes('helper'), `${name}: priced from the card, held for NEED HELPER review`, { plan: r.paymentPlan, total: r.total, why: r.reviewReasons });
    check(r.quoteRange && r.quoteRange.low === r.total && r.quoteRange.high === r.total, `${name}: no 1.5x-2x range, the regular price is the price`, r.quoteRange);
  } else {
    check(r.paymentPlan !== 'quote' && !r.reviewOnly && r.total > 0 && r.dueNow > 0, `${name}: not held, bookable and payable now at the card price (NEED HELPER is only a sheet label)`, { plan: r.paymentPlan, total: r.total, due: r.dueNow });
    check(!r.quoteRange && !r.reviewKinds, `${name}: no quote range or review state`, r.quoteRange);
  }
  return r;
};
helperHold('501 lb sculpture', 'pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 501, w: 30, h: 40, d: 30, value: 5000, description: 's' }]);
const s750 = helperHold('750 lb sculpture', 'pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 750, w: 30, h: 40, d: 30, value: 5000, description: 's' }]);
check(line(s750, /Sculpture/) && line(s750, /Sculpture/).amount === 1000, '750 lb sculpture keeps the $1,000 over-700 rate', s750.lines);
helperHold('80" sculpture (200 lb)', 'pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 200, w: 20, h: 80, d: 20, value: 5000, description: 's' }]);
const p72 = q('delivery_install', [{ qty: 1, type: 'painting', framed: 'no', w: 72, h: 40, value: 5000, description: 'p' }]);
noGate('72" painting', p72);
check(line(p72, /Oversize painting \(72"\+\) delivery/) && line(p72, /Oversize painting \(72"\+\) install/), '72" painting keeps the oversize lines', p72.lines);
helperHold('600 lb, 90" other item', 'pickup_delivery', [{ qty: 1, type: 'other', weight: 600, w: 90, h: 30, d: 30, value: 5000, description: 'o' }]);
helperHold('large 96" sofa', 'pickup_delivery', [{ qty: 1, type: 'furniture', furnitureKind: 'Sofa', sizeClass: 'large', w: 96, h: 36, d: 40, value: 3000, description: 'f' }]);
// Unknown weight is not "heavy": it still can't be priced from the weight card, so it stays a CAD-priced request.
check(q('pickup_delivery', [{ qty: 1, type: 'sculpture', weightUnsure: true, value: 5000, description: 's' }]).paymentPlan === 'quote', 'unknown sculpture weight stays priced by CAD (no weight to price from)');

// ---- Chad, Nov 18 2026: over $50,000 = normal moving price + 0.75% of the piece's declared value, one price, nothing shown ----
{
  const sc2 = (v) => q('pickup_delivery', [{ type: 'sculpture', weight: 120, value: v, description: 's' }]);
  const cases = [[50000, 1150, 750], [50001, 775.01, 0], [75000, 962.5, 0], [500000, 4150, 0]];
  for (const [v, total, protAmt] of cases) {
    const r = sc2(v);
    check(near(r.total, total), `$${v.toLocaleString()} 120 lb sculpture totals $${total}`, r.lines);
    if (protAmt) check(lines2(r, /declared value protection/i).length === 1 && lines2(r, /declared value protection/i)[0].amount === protAmt, `$${v.toLocaleString()} adds a $${protAmt} protection line`, r.lines);
    else check(!lines2(r, /protection|handling|high-value|0\.75/i).length && !r.protection && !(r.notes || []).some((n) => /protection|0\.75|50,000/i.test(n)), `$${v.toLocaleString()}: ${(total - 400).toFixed(2)} is built in; no separate line, protection wording or note`, [r.lines, r.notes]);
  }
  check(near(sc2(50001).total - 400, 375.01) && near(sc2(75000).total - 400, 562.5) && near(sc2(500000).total - 400, 3750), 'built-in amounts: $50,001 → $375.01, $75,000 → $562.50, $500,000 → $3,750');
  check(!(sc2(75000).lines || []).some((l) => /protection/i.test(l.label)) && sc2(75000).lines.length === 1, 'an over-$50,000 piece is one price line');
  // threshold is per piece: two pieces at $40,000 (order total $80,000) both keep protection
  const two = q('pickup_delivery', [{ type: 'sculpture', weight: 120, value: 40000, description: 'a' }, { type: 'sculpture', weight: 120, value: 40000, description: 'b' }]);
  check(lines2(two, /declared value protection/i).length === 2 && near(two.total, 800 + 1200), 'two $40,000 pieces keep protection (limit is per piece, not per order)', two.lines);
  // very low and zero values
  const low = sc2(1), zero = sc2(0);
  check(near(low.total, 400.02) && lines2(low, /protection/i)[0].amount === 0.02, '$1 value: 1.5% rounds to $0.02, no minimum fee', low.lines);
  check(near(zero.total, 400) && !zero.protection && !lines2(zero, /protection/i).length, '$0 value in the engine: no protection line and no built-in amount (the form and server refuse $0; only a custom request has no value)', zero.lines);
}
// ---- Dot, Nov 18 2026: each painting over $50,000 gets its own moving-price line; ordinary paintings stay grouped ----
{
  const P = (v, d) => ({ type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: v, description: d });
  for (const svc of ['pickup_delivery', 'delivery_install', 'install_only']) {
    const plain = q(svc, [P(5000, 'a'), P(6000, 'b'), P(7000, 'c')]);
    const mixed = q(svc, [P(5000, 'a'), P(75000, 'b'), P(7000, 'c')]);
    const transport = svc !== 'install_only';
    const own = mixed.lines.filter((l) => /^Piece 2 — Painting (delivery|installation)/.test(l.label));
    check(own.length === (svc === 'delivery_install' ? 2 : 1), `${svc}: the $75,000 painting has its own line${svc === 'delivery_install' ? 's (delivery and installation)' : ''}`, mixed.lines);
    check(!mixed.lines.some((l) => /Piece 2\b/.test(l.label) && /protection|0\.75|high-value/i.test(l.label)) && !(mixed.notes || []).some((n) => /protection|0\.75|50,000/i.test(n)), `${svc}: no extra wording on the over-$50,000 line`, mixed.lines);
    const group = mixed.lines.filter((l) => /× 2/.test(l.label) && /Pieces 1, 3/.test(l.label));
    check(group.length === own.length, `${svc}: ordinary paintings stay grouped as "× 2 (Pieces 1, 3)"`, mixed.lines);
    const protLines = mixed.lines.filter((l) => /^Required declared value protection/.test(l.label));
    const moveNow = mixed.total - protLines.reduce((a, l) => a + l.amount, 0), movePlain = plain.total - plain.lines.filter((l) => /^Required declared value protection/.test(l.label)).reduce((a, l) => a + l.amount, 0);
    check(near(moveNow, movePlain + 562.5), `${svc}: moving total is exactly the grouped price + $562.50 (0.75% of $75,000) – carving the line out changes nothing else`, [moveNow, movePlain]);
  }
  const solo = q('pickup_delivery', [P(75000, 'solo')]);
  check(solo.lines.length === 1 && /^Piece 1 — Painting delivery$/.test(solo.lines[0].label) && near(solo.total, solo.lines[0].amount), 'one $75,000 painting: a single plain line, 0.75% built in', solo.lines);
  const two = q('pickup_delivery', [P(60000, 'x'), P(80000, 'y')]);
  check(two.lines.length === 2 && two.lines.every((l) => /^Piece [12] — Painting delivery$/.test(l.label)), 'two over-$50,000 paintings: one line each, no empty group line', two.lines);
  const edge = q('pickup_delivery', [P(50000, 'e'), P(50001, 'f')]);
  check(edge.lines.some((l) => /^Piece 2 — Painting delivery$/.test(l.label)) && !edge.lines.some((l) => /^Piece 1 — Painting delivery$/.test(l.label)) && edge.lines.filter((l) => /^Required declared value protection/.test(l.label)).length === 1, '$50,000 stays grouped with protection; $50,001 gets its own line', edge.lines);
}
// ---- (retired) Nov 16 tiered high-value markup replaced by the 0.75% rule above ----
check(!('highValueFloor' in config.pricing.valuation), 'the 1.5% high-value minimum is no longer the rule (Chad, Nov 16 2026)');
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
const quiet = (r) => !line(r, /High-value/) && !(r.notes || []).some((n) => /protection not offered|isn’t eligible|isn't eligible|high-value handling/i.test(n));
for (const [name, svc, it] of kinds) for (const qty of [1, 3]) {
  const t = (value) => q(svc, [{ qty, description: 'x', ...it, value }]);
  const [a, b, c] = [49999, 50000, 50001].map(t);
  check(line(a, DVP) && sumLines(a, DVP) === Math.round(Math.round(49999 * 0.015 * 100 + 1e-6) * qty) / 100, `${name} × ${qty}: $49,999 includes the 1.5% protection charge`, a.lines);
  check(line(b, DVP) && sumLines(b, DVP) === 750 * qty && b.lines.filter((l) => DVP.test(l.label)).length === qty, `${name} × ${qty}: $50,000 keeps $750 per piece protection`, b.lines);
  check(quiet(a) && quiet(b), `${name} × ${qty}: $49,999 and $50,000 have no handling line or over-$50,000 note`, [a.lines, a.notes, b.lines, b.notes]);
  check(!line(c, /declared value protection/i) && !c.protection, `${name} × ${qty}: $50,001 gets no protection line`, c.lines);
  check(quiet(c) && (c.highValueItems || []).length && c.highValueItems[0].perPiece > 0, `${name} × ${qty}: $50,001 is quiet for the customer; admin still has the markup`, { l: c.lines, n: c.notes, h: c.highValueItems });
}
const flo = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 120, value: 50001, description: 's' }]);
check(!line(flo, /High-value|declared value protection/i) && !flo.protection && near(line(flo, /Sculpture/).amount, 775.01) && near(flo.total, 775.01) && quiet(flo), '$50,001 120 lb sculpture: $400 move + $375.01 built in = $775.01, no protection line or note', flo.lines);
const floQty = q('pickup_delivery', [{ qty: 2, type: 'sculpture', weight: 120, value: 50001, description: 's' }]);
check(!line(floQty, /declared value protection|High-value/i) && !floQty.protection && near(sumLines(floQty, /Sculpture/), 1550.02) && near(floQty.total, 1550.02), '2 pieces × $50,001 120 lb sculpture: $775.01 each, no protection line', floQty.lines);
const big = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 900, value: 1000001, description: 's' }]);
check(!line(big, /High-value/) && near(line(big, /Sculpture/).amount, 8500.01) && near(big.total, 8500.01) && big.highValueItems[0].perPiece === 7500.01, '$1,000,001 900 lb sculpture: $1,000 + 0.75% of $1,000,001 ($7,500.01) = $8,500.01 in the sculpture line', big.lines);
const big2 = q('pickup_delivery', [{ qty: 1, type: 'sculpture', weight: 900, value: 60000, description: 's' }]);
check(!line(big2, /High-value/) && line(big2, /Sculpture/).amount === 1450 && big2.total === 1450, '$60,000 900 lb sculpture: $1,000 + $450 = $1,450 in the sculpture line', big2.lines);

check(!line(sc(300001), /High-value/) && near(line(sc(300001), /Sculpture/).amount, 2650.01) && near(sc(300001).total, 2650.01), '$300,001 120 lb sculpture: $400 + $2,250.01 = $2,650.01 in the sculpture line', sc(300001).lines);

// ---- Decision 3: no sales tax anywhere ----
const fs = require('fs'), path = require('path');
for (const r of [at50, over50, mixedDv, instP, s750, p72, shipP]) for (const t of [...r.lines.map((l) => l.label), ...(r.notes || []), r.paymentSummary || '', r.quoteNote || '']) check(!/\btax/i.test(t), 'no tax wording in quotes: ' + t);
for (const f of ['public/app.js', 'public/index.html', 'public/admin.html', 'lib/email.js', 'lib/pricing.js', 'lib/shiptext.js', 'config.js', 'server.js']) check(!/\btax(es)?\b/i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), `${f} must not mention tax`);
const TERMS = 'Declared value protection applies to pieces valued up to $50,000.';
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
check(appJs.includes('data-protection-terms') && appJs.includes(TERMS), 'checkout small print must include the exact protection terms sentence');
for (const f of ['public/app.js', 'public/index.html', 'lib/email.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  check(!/protection not offered|isn’t eligible for declared value protection|isn't eligible for declared value protection/i.test(src), `${f} must not tell the customer protection is not offered`);
}

// CAD are fine art handlers, not movers (Chad, Nov 18 2026): the items-step heading follows the service and customer copy never says "moving".
check(!/What are we moving|Anything else to move/i.test(appJs), 'customer copy must not say "What are we moving?" / "Anything else to move?"');
for (const [k, h] of [['pickup_delivery', 'delivering'], ['delivery_install', 'delivering and installing'], ['install_only', 'installing'], ['crating_shipping', 'shipping']]) check(new RegExp(`${k}: '${h}'`).test(appJs), `items-step heading for ${k} is "What are we ${h}?"`);
check(/Within California/.test(appJs) && /Domestic & International/.test(appJs) && /anything going outside California/.test(appJs), 'service cards carry the Within California / Domestic & International subtitles and the clear Shipping description');

console.log(JSON.stringify({ errors }, null, 2));
if (errors.length) {
  console.error('\n' + errors.length + ' pricing test(s) failed.');
  process.exit(1);
}
console.log('All pricing tests passed.');
