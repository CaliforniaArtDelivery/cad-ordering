// Unit tests for quote() pricing. Usage: npm test
const { quote, roundToNearest, mirrorInstallTier } = require('../lib/pricing');

const errors = [];
const check = (cond, msg, extra) => {
  if (!cond) {
    errors.push(msg);
    console.error('FAIL:', msg, extra != null ? extra : '');
  }
};

const q = (service, items, extra = {}) => quote({ service, items, ...extra });
const line = (res, re) => (res.lines || []).find((l) => re.test(l.label));

check(roundToNearest(112.5, 5) === 115, '112.50 should round to $115');
check(roundToNearest(82.5, 5) === 85, '82.50 should round to $85');
check(roundToNearest(137.5, 5) === 140, '137.50 should round to $140');
check(roundToNearest(110, 5) === 110, '110 should stay $110');

const tierOf = (w, h) => mirrorInstallTier({ w, h }).multiplier;
check(tierOf(40, 40) === 1, '40×40 should be the 1× tier');
check(tierOf(48, 48) === 1, '48×48 should be the 1× tier');
check(tierOf(48, 49) === 1.5, '48×49 should be the 1.5× tier');
check(tierOf(60, 40) === 1.5, '60×40 should be the 1.5× tier (60 is not over 60)');
check(tierOf(60, 60) === 1.5, '60×60 should be the 1.5× tier');
check(tierOf(61, 40) === 2.5, '61×40 should be the 2.5× tier');
check(tierOf(70, 40) === 2.5, '70×40 should be the 2.5× tier (70 is not over 70)');
check(tierOf(71, 40) === 3, '71×40 should be the 3× tier');
check(mirrorInstallTier({ w: 40, h: 40, d: 80 }).multiplier === 1, 'depth alone must not raise the install tier');

// 40×40 mirror install equals a painting of the same size ($75).
const small = q('install_only', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }]);
const paintSmall = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, description: 'p' }]);
check(small.total === 75, '40×40 mirror install-only should be $75', small);
check(paintSmall.total === 75, '40×40 painting install-only should be $75', paintSmall);
check(!line(small, /Large mirror install/), '40×40 must not get a large-mirror surcharge', small.lines);

// 60×40: over 48" but not over 60", so 1.5 × $75 = $112.50 → $115.
const large = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }]);
check(large.total === 115, '60×40 mirror install-only should be $115', large);
check(line(large, /Large mirror install \(over 48"\) × 1/) && line(large, /Large mirror install \(over 48"\)/).amount === 40,
  '60×40 should add a $40 large-mirror install (over 48") line', large.lines);

// Boundaries.
const at48 = q('install_only', [{ qty: 1, type: 'mirror', w: 48, h: 48, description: 'm' }]);
const over48 = q('install_only', [{ qty: 1, type: 'mirror', w: 48, h: 49, description: 'm' }]);
check(at48.total === 75, '48×48 mirror install should equal the painting rate $75', at48);
check(over48.total === 115, '48×49 mirror install should be $115', over48);

// Over 60": 2.5 × $75 = $187.50 → $190. No 50" tier.
const over60 = q('install_only', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }]);
check(over60.total === 190, '61×40 mirror install-only should be $190 (2.5× $75)', over60);
check(line(over60, /Large mirror install \(over 60"\) × 1/) && line(over60, /Large mirror install \(over 60"\)/).amount === 115,
  '61×40 should add a $115 large-mirror install (over 60") line', over60.lines);
check(!line(over60, /over 48"/) && !line(over60, /over 50"/), '61×40 must not use a 48" or 50" line', over60.lines);

const at70 = q('install_only', [{ qty: 1, type: 'mirror', w: 70, h: 40, description: 'm' }]);
check(at70.total === 190, '70×40 should stay in the 2.5× tier ($190)', at70);

// Over 70": 3 × $75 = $225.
const over70 = q('install_only', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }]);
check(over70.total === 225, '71×40 mirror install-only should be $225 (3× $75)', over70);
check(line(over70, /Large mirror install \(over 70"\) × 1/) && line(over70, /Large mirror install \(over 70"\)/).amount === 150,
  '71×40 should add a $150 large-mirror install (over 70") line', over70.lines);

// Depth does not raise the mirror multiplier (it can still trigger the existing 72"+ oversize fee, same as a painting).
const deep = q('install_only', [{ qty: 1, type: 'mirror', w: 40, h: 40, d: 80, description: 'm' }]);
const deepPaint = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, d: 80, description: 'p' }]);
const noDim = q('install_only', [{ qty: 1, type: 'mirror', description: 'm' }]);
check(!line(deep, /Large mirror install/), '40×40×80 depth must not add a large-mirror install multiplier', deep.lines);
check(deep.total === deepPaint.total, '40×40×80 mirror install should match a painting of the same size', { deep: deep.total, deepPaint: deepPaint.total });
check(noDim.total === 75, 'mirror with no dimensions should use the painting install rate', noDim);

// Pickup + delivery is unchanged for every size (painting delivery table, $200; 72"+ still +$100 delivery).
const pdSmall = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }]);
const pdLarge = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }]);
const pdOver60 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }]);
const pdOver70 = q('pickup_delivery', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }]);
const pdPaint = q('pickup_delivery', [{ qty: 1, type: 'painting', framed: 'no', w: 60, h: 40, description: 'p' }]);
check(pdSmall.total === 200 && pdLarge.total === 200 && pdOver60.total === 200 && pdOver70.total === 200 && pdPaint.total === 200,
  'pickup + delivery for mirrors of every install tier should stay $200, same as a painting',
  { pdSmall: pdSmall.total, pdLarge: pdLarge.total, pdOver60: pdOver60.total, pdOver70: pdOver70.total, pdPaint: pdPaint.total });
check(!line(pdLarge, /Large mirror install/) && !line(pdOver70, /Large mirror install/),
  'large-mirror surcharge must not apply without install', pdLarge.lines);

// Delivery + install: $200 delivery stays; only the install portion changes on large mirrors.
const diSmall = q('delivery_install', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }]);
const diLarge = q('delivery_install', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }]);
const diOver60 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }]);
const diOver70 = q('delivery_install', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }]);
check(diSmall.total === 275, '40×40 delivery+install should stay $275', diSmall);
check(diLarge.total === 315, '60×40 delivery+install should be $315 ($200 + $115)', diLarge);
check(diOver60.total === 390, '61×40 delivery+install should be $390 ($200 + $190)', diOver60);
check(diOver70.total === 425, '71×40 delivery+install should be $425 ($200 + $225)', diOver70);

// 80×40: 72"+ oversize delivery stays $100; install is 3 × ($75 + $200) = $825. Total $1,125.
const diHuge = q('delivery_install', [{ qty: 1, type: 'mirror', w: 80, h: 40, description: 'm' }]);
const paintHuge = q('delivery_install', [{ qty: 1, type: 'painting', framed: 'no', w: 80, h: 40, description: 'p' }]);
check(paintHuge.total === 575, '80×40 painting delivery+install should be $575', paintHuge);
check(diHuge.total === 1125, '80×40 mirror delivery+install should be $1,125', diHuge);
check(line(diHuge, /Oversize painting \(72"\+\) delivery/) && line(diHuge, /Oversize painting \(72"\+\) delivery/).amount === 100,
  '72"+ mirror delivery surcharge should stay $100', diHuge.lines);
check(line(diHuge, /Large mirror install \(over 70"\)/) && line(diHuge, /Large mirror install \(over 70"\)/).amount === 550,
  '80×40 install extra should be $550 (3× $275 − $275)', diHuge.lines);

// Member: 1.5 × $55 = $82.50 → $85; 2.5 × $55 = $137.50 → $140; 3 × $55 = $165.
const mem = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(mem.member && mem.total === 85, 'member 60×40 install-only should be $85', mem);
const memSmall = q('install_only', [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(memSmall.member && memSmall.total === 55, 'member 40×40 install-only should stay $55', memSmall);
const mem60 = q('install_only', [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(mem60.member && mem60.total === 140, 'member 61×40 install-only should be $140', mem60);
const mem70 = q('install_only', [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }], { memberCode: 'jones-terwilliger' });
check(mem70.member && mem70.total === 165, 'member 71×40 install-only should be $165', mem70);

// Décor → Mirror uses the same path, not the furniture card ($175/$235/$290).
const decorSmall = q('install_only', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', w: 40, h: 40, description: 'm' }]);
const decorLarge = q('delivery_install', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', w: 60, h: 40, description: 'm' }]);
const decorPD = q('pickup_delivery', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', description: 'm' }]);
const decorOver60 = q('install_only', [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', w: 61, h: 40, description: 'm' }]);
check(decorSmall.total === 75, 'Décor Mirror 40×40 install should be $75, not a furniture-card rate', decorSmall);
check(decorLarge.total === 315, 'Décor Mirror 60×40 delivery+install should be $315', decorLarge);
check(decorPD.total === 200, 'Décor Mirror pickup+delivery should use painting delivery $200', decorPD);
check(decorOver60.total === 190, 'Décor Mirror 61×40 install should be $190', decorOver60);

// Mixed cart: quantity table still shared; only the large mirror's install is multiplied.
const mixed = q('delivery_install', [
  { qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, description: 'p' },
  { qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' },
]);
check(line(mixed, /Wall art delivery .* × 2/) && line(mixed, /Wall art delivery/).amount === 300, 'mixed delivery ×2 should stay $300', mixed.lines);
check(line(mixed, /Hanging .* × 2/) && line(mixed, /Hanging/).amount === 150, 'mixed hanging ×2 should stay $150', mixed.lines);
check(line(mixed, /Large mirror install \(over 48"\) × 1/) && line(mixed, /Large mirror install \(over 48"\)/).amount === 40, 'mixed large-mirror extra should be $40', mixed.lines);
check(mixed.total === 490, 'mixed painting + 60×40 mirror delivery+install should be $490', mixed);

const two = q('install_only', [{ qty: 2, type: 'mirror', w: 60, h: 40, description: 'm' }]);
check(two.total === 230, 'two 60×40 mirrors install-only should be $230 ($150 + $40 × 2)', two);

// Two different tiers in one job get separate lines.
const split = q('install_only', [
  { qty: 1, type: 'mirror', w: 60, h: 40, description: 'a' },
  { qty: 1, type: 'mirror', w: 61, h: 40, description: 'b' },
]);
// hang ×2 = $150, share $75 each; extras $40 + $115 = $155; total $305
check(line(split, /over 48"/) && line(split, /over 48"/).amount === 40, 'split job should keep the over-48" line at $40', split.lines);
check(line(split, /over 60"/) && line(split, /over 60"/).amount === 115, 'split job should have the over-60" line at $115', split.lines);
check(split.total === 305, '60×40 + 61×40 install-only should be $305', split);

// High-value markup is on the mirrored install price ($115), not the pre-surcharge $75.
const hv = q('install_only', [{ qty: 1, type: 'mirror', w: 60, h: 40, value: 100001, description: 'm' }]);
const hl = line(hv, /High-value handling \+200%/);
check(hl && hl.amount === 230, 'high-value +200% should be based on $115, so $230', hv.lines);
check(hv.total === 345, 'high-value 60×40 install-only should be $345', hv);

// Paintings over 48"/60"/70" are unchanged.
const paint60 = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 60, h: 40, description: 'p' }]);
const paint71 = q('install_only', [{ qty: 1, type: 'painting', framed: 'no', w: 71, h: 40, description: 'p' }]);
check(paint60.total === 75, '60×40 painting install should stay $75', paint60);
check(paint71.total === 75, '71×40 painting install should stay $75 (no 72" fee yet)', paint71);

if (errors.length) {
  console.error('\n' + errors.length + ' pricing test(s) failed.');
  process.exit(1);
}
console.log('All pricing tests passed.');
