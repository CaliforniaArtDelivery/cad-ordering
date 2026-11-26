/* CAD address and size checks: one shared module for the browser (window.CADValidate) and the server (require).
 * Samantha's Nov 19 testing: a 6-digit ZIP (123456) still got a route, and 1 x 1 x 1 was accepted as a piece size. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.CADValidate = m;
})(typeof self !== 'undefined' ? self : this, function () {
  // Smallest realistic piece CAD picks up: 4 in. wide and 4 in. tall (a small framed print). Depth is lower on purpose:
  // a framed canvas or print is often only 1 to 2 in. deep, so a flat 4 in. depth minimum would reject real art.
  const MIN_DIM = { w: 4, h: 4, d: 1 }; // default for paintings, photographs, wall art, other
  const DIM_NAME = { w: 'width', h: 'height', d: 'depth' };
  // Per-type minimums in inches (logistics, Nov 25 2026). A 1-inch sofa must be rejected.
  // Depth for framed art stays at 1 in because a canvas or print is often only 1–2 in deep.
  const TYPE_MIN = {
    painting: { w: 4, h: 4, d: 1 },
    photograph: { w: 4, h: 4, d: 1 },
    wallart: { w: 4, h: 4, d: 1 },
    mirror: { w: 6, h: 6, d: 0.25 },
    sculpture: { w: 2, h: 2, d: 2 },
    other: { w: 4, h: 4, d: 1 },
    custom: { w: 2, h: 2, d: 1 },
    furniture: { w: 12, h: 12, d: 6 },
    decor: { w: 4, h: 4, d: 1 },
  };
  const FURNITURE_MIN = {
    'Sofa': { w: 24, h: 20, d: 12 },
    'Loveseat': { w: 24, h: 20, d: 12 },
    '2-Piece Sectional': { w: 36, h: 20, d: 12 },
    '3-Piece Sectional': { w: 48, h: 20, d: 12 },
    '4-Piece Sectional': { w: 60, h: 20, d: 12 },
    'Armchair / Accent Chair': { w: 18, h: 18, d: 12 },
    'Recliner / Lounge Chair': { w: 18, h: 18, d: 12 },
    'Dining Table': { w: 24, h: 12, d: 12 },
    'Desk': { w: 20, h: 12, d: 10 },
    'Dresser': { w: 18, h: 18, d: 10 },
    'Headboard / Bed Frame': { w: 24, h: 12, d: 2 },
    'Armoire': { w: 18, h: 36, d: 10 },
  };
  function minDimsFor(it) {
    const type = (it && it.type) || 'painting';
    if (type === 'furniture') return FURNITURE_MIN[(it && it.furnitureKind) || ''] || TYPE_MIN.furniture;
    return TYPE_MIN[type] || MIN_DIM;
  }
  // Above this on ANY side the order is not refused (a genuinely big piece is real); it goes to manual review instead.
  // The server reads its own value from config.intake.reviewDimIn (REVIEW_DIM_IN env). PENDING CHAD'S APPROVAL: 120 in is a default, not an approved number.
  const REVIEW_DIM = 120;
  // A typo guard, not a business rule: no real piece is 1,000 in. (83 ft) on a side.
  const MAX_DIM = 1000;

  // Strict decimal inches: digits with an optional decimal part ("24", "24.5", ".5"), nothing else. No hex (0x10), exponent (1e3),
  // thousands comma (4,5), sign, NaN, Infinity or stray text. Returns a finite number, or null when the text is not a plain decimal.
  // Numbers (JSON bodies) are accepted only when finite, and are re-checked through their plain-decimal text, so 1e21 and -3 fail too.
  const DEC_RX = /^(\d+(\.\d+)?|\.\d+)$/;
  function parseDim(raw) {
    let t;
    if (typeof raw === 'number') { if (!Number.isFinite(raw)) return null; t = String(raw); }
    else if (typeof raw === 'string') t = raw.trim();
    else return null; // arrays, objects, booleans: never coerce
    if (!DEC_RX.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  // Lenient number for NON-dimension fields only (declared value, weight): kept as before.
  const num = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

  // 'missing' | 'invalid' | 'small' | 'huge' | 'ok' for one dimension key ('w' | 'h' | 'd').
  function dimState(it, k) {
    const raw = (it || {})[k];
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return 'missing';
    const n = parseDim(raw);
    if (n === null) return 'invalid';
    const min = minDimsFor(it)[k];
    if (n < min) return 'small';
    if (n > MAX_DIM) return 'huge';
    return 'ok';
  }
  const DIM_MESSAGES = {
    missing: () => 'Please enter the width, height and depth in inches.',
    invalid: (k) => `Enter the ${DIM_NAME[k]} as a plain number of inches (like 24 or 24.5).`,
    small: (k, it) => `Please double-check: ${DIM_NAME[k]} is below the usual minimum of ${minDimsFor(it)[k]} in. You can still request a quote so we can review the size.`,
    huge: (k) => `Please check the ${DIM_NAME[k]}: that is over ${MAX_DIM} in.`,
  };
  // First problem with a piece's W x H x D, or null. { key, state, message }
  function hasSizeClassOnly(it) {
    return !!(it && (it.sizeClassOnly || it.sizeOnly) && String((it && it.sizeClass) || '').trim());
  }
  function dimFilledCount(it) {
    return ['w', 'h', 'd'].reduce((n, k) => {
      const raw = (it || {})[k];
      return n + (raw !== undefined && raw !== null && String(raw).trim() !== '' ? 1 : 0);
    }, 0);
  }
  // Hard problem that must be fixed (partial set, invalid, huge). Below-minimum is a soft warning, not a hard block.
  function dimProblem(it) {
    const filled = dimFilledCount(it);
    if (filled > 0 && filled < 3) {
      return { key: ['w', 'h', 'd'].find((k) => dimState(it, k) === 'missing') || 'w', state: 'partial', message: 'Please enter all three dimensions (width, height and depth).' };
    }
    for (const k of ['w', 'h', 'd']) {
      const s = dimState(it, k);
      if (s === 'invalid' || s === 'huge' || s === 'missing') return { key: k, state: s, message: DIM_MESSAGES[s](k, it) };
    }
    return null;
  }
  function belowMinWarning(it) {
    if (dimProblem(it)) return null;
    for (const k of ['w', 'h', 'd']) {
      if (dimState(it, k) === 'small') return { key: k, state: 'small', message: DIM_MESSAGES.small(k, it), quote: true };
    }
    return null;
  }
  // Custom requests (and partner catalog furniture) may leave size blank; any size that is typed must be a complete set.
  function optionalDimProblem(it) {
    const filled = ['w', 'h', 'd'].some((k) => {
      const raw = (it || {})[k];
      return raw !== undefined && raw !== null && String(raw).trim() !== '';
    });
    for (const k of ['w', 'h', 'd']) {
      const s = dimState(it, k);
      if (s === 'invalid' || s === 'huge') return { key: k, state: s, message: DIM_MESSAGES[s](k, it) };
      if (filled && s === 'missing') return { key: k, state: s, message: 'Please enter the width, height and depth in inches, or clear all three.' };
    }
    return null;
  }
  // Largest side in inches when every side parses; 0 otherwise. Used for the oversized review (validity is checked separately).
  const largestSide = (it) => Math.max(0, ...['w', 'h', 'd'].map((k) => parseDim((it || {})[k]) || 0));
  const isOversized = (it, limit = REVIEW_DIM) => largestSide(it) > limit;

  // ZIP: exactly 5 digits, or ZIP+4 (12345-6789). Anything else is rejected.
  const ZIP_RX = /^\d{5}(-\d{4})?$/;
  const zipOk = (z) => ZIP_RX.test(String(z == null ? '' : z).trim());

  // City: letters (accents allowed), spaces, . , - and straight or curly apostrophes (' and U+2019); at least 2 letters; no digits.
  // Written with \u escapes so the file's bytes can never be re-encoded into mojibake.
  const CITY_RX = /^[\p{L}][\p{L} .,'\u2019\u2018\-]*$/u;
  const cityOk = (c) => {
    const s = String(c == null ? '' : c).trim();
    if (s.length < 2 || s.length > 60) return false;
    if (/\d/.test(s)) return false;
    if (!CITY_RX.test(s)) return false;
    return (s.match(/\p{L}/gu) || []).length >= 2;
  };
  // Street: required and carries a street number (digits somewhere, e.g. "2 Henry Adams St", "8678 Melrose Ave", "Pier 39").
  const streetHasNumber = (s) => /\d/.test(String(s == null ? '' : s));
  // Rural routes and named estates ("Star Route", "Rosewood Estate") have no number. The customer says so with a checkbox
  // (address.noStreetNumber === true); the order is then a manual-review request, never blocked and never given a made-up number.
  const noStreetNumberOk = (a) => !!a && a.noStreetNumber === true;
  // True when this US stop's street has no number and the customer ticked the box: the team confirms the exact location.
  const needsAddressReview = (a) => !!a && isUS(a) && !!String(a.street || '').trim() && !streetHasNumber(a.street) && noStreetNumberOk(a);

  const US_RX = /^(us|u\.s\.a?\.?|usa|united states( of america)?|america)$/i;
  const isUS = (a) => !(a && a.country && String(a.country).trim() && !US_RX.test(String(a.country).trim()));

  // Problems with one stop's address. [{ field: 'street'|'city'|'state'|'zip', message }]. Empty array = fine.
  // International shipping destinations (non-US country) are free-form, so only "street and city are given" applies.
  function addressProblems(a, label) {
    const out = [];
    const what = label ? String(label).toLowerCase() : '';
    const w = what ? `${what} ` : '';
    a = a || {};
    const street = String(a.street || '').trim();
    const city = String(a.city || '').trim();
    if (!street) out.push({ field: 'street', message: `Please enter the ${w}street address.` });
    else if (isUS(a) && !streetHasNumber(street) && !noStreetNumberOk(a)) out.push({ field: 'street', message: `Include the street number (like 2 Henry Adams St), or tick "My address has no street number".` });
    if (!city) out.push({ field: 'city', message: `Please enter the ${w}city.` });
    else if (isUS(a) && !cityOk(city)) out.push({ field: 'city', message: `Please check the ${w}city name.` });
    if (isUS(a)) {
      const zip = String(a.zip == null ? '' : a.zip).trim();
      if (!zip) out.push({ field: 'zip', message: `Please enter the ${w}ZIP code (5 digits).` });
      else if (!zipOk(zip)) out.push({ field: 'zip', message: `ZIP must be 5 digits (or ZIP+4).` });
      else {
        // State vs ZIP (QA re-check Nov 22): "New York, CA 10001" is refused. California ZIPs are 900xx to 961xx and no
        // other state uses them, so the check is exact whenever California is on either side. A blank state is not checked.
        const st = String(a.state || '').trim();
        const stCA = /^(ca|calif\.?|california)$/i.test(st);
        const zipCA = (() => { const n = parseInt(zip.slice(0, 3), 10); return n >= 900 && n <= 961; })();
        if (st && stCA && !zipCA) out.push({ field: 'zip', message: `ZIP ${zip.slice(0, 5)} isn’t in California. Fix the ZIP, or change the state.` });
        else if (st && !stCA && zipCA) out.push({ field: 'state', message: `ZIP ${zip.slice(0, 5)} is in California, not ${st}. Change the state to CA, or fix the ZIP.` });
      }
    }
    return out;
  }

  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
  const EMAIL_TYPOS = [
    ['calforniaartdelivery', 'californiaartdelivery'],
    ['californiartdelivery', 'californiaartdelivery'],
    ['californiaartdelievery', 'californiaartdelivery'],
    ['californiaartdelivrey', 'californiaartdelivery'],
    ['californiaartdeliivery', 'californiaartdelivery'],
    ['gmial.com', 'gmail.com'],
    ['gmai.com', 'gmail.com'],
    ['gmail.con', 'gmail.com'],
    ['gmail.coom', 'gmail.com'],
    ['gmail.cm', 'gmail.com'],
    ['hotmial.com', 'hotmail.com'],
    ['hotmai.com', 'hotmail.com'],
    ['hotmail.con', 'hotmail.com'],
    ['yaho.com', 'yahoo.com'],
    ['yahooo.com', 'yahoo.com'],
    ['yahoo.con', 'yahoo.com'],
    ['icloud.con', 'icloud.com'],
    ['icoud.com', 'icloud.com'],
    ['outlok.com', 'outlook.com'],
    ['outlook.con', 'outlook.com'],
  ];
  function typoEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    const at = e.lastIndexOf('@');
    if (at < 1) return null;
    const local = e.slice(0, at), domain = e.slice(at + 1);
    for (const [bad, good] of EMAIL_TYPOS) {
      if (domain === bad) return local + '@' + good;
      if (domain.startsWith(bad + '.')) return local + '@' + (good.includes('.') ? good : good + '.com');
      if (local.includes(bad) && !bad.includes('.')) return local.replace(bad, good.includes('.') ? good.split('@')[0] : good) + '@' + domain;
    }
    return null;
  }
  function emailProblem(email) {
    const e = String(email || '').trim();
    if (!e) return 'Please enter an email address.';
    if (!EMAIL_RX.test(e)) return 'Please enter a real email address (like name@example.com).';
    typoEmail(e); // suggestion only — never a hard block, and never silently changed
    return null;
  }

  const addressOk = (a) => addressProblems(a).length === 0;

  // Map entered inches to the furniture / décor rate-card tier so pricing still works with no size-class picker.
  function sizeClassFromDims(it, kind) {
    const max = Math.max(0, ...['w', 'h', 'd'].map((k) => num((it || {})[k]) || 0));
    if (!(max > 0)) return (it && it.sizeClass) || 'medium';
    const accents = new Set(['accent', 'Accents', 'Other (describe)']);
    const isAccent = !!(kind && (accents.has(kind) || /vase|figurine|bowl|box|tray|candlestick|sculpture/i.test(String(kind))));
    if (isAccent) {
      if (max < 8) return 'xs';
      if (max < 16) return 'small';
      if (max < 28) return 'medium';
      if (max < 48) return 'large';
      return 'xl';
    }
    if (max < 36) return 'small';
    if (max < 72) return 'medium';
    return 'large';
  }

  return { MIN_DIM, TYPE_MIN, FURNITURE_MIN, minDimsFor, REVIEW_DIM, MAX_DIM, num, parseDim, dimState, dimProblem, optionalDimProblem, belowMinWarning, hasSizeClassOnly, dimFilledCount, largestSide, isOversized, sizeClassFromDims, zipOk, cityOk, streetHasNumber, noStreetNumberOk, needsAddressReview, isUS, addressProblems, addressOk, emailProblem, typoEmail, EMAIL_RX };
});
