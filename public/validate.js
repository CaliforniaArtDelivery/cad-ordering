/* CAD address and size checks: one shared module for the browser (window.CADValidate) and the server (require).
 * Samantha's Nov 19 testing: a 6-digit ZIP (123456) still got a route, and 1 x 1 x 1 was accepted as a piece size. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.CADValidate = m;
})(typeof self !== 'undefined' ? self : this, function () {
  // Smallest realistic piece CAD picks up: 4 in. wide and 4 in. tall (a small framed print). Depth is lower on purpose:
  // a framed canvas or print is often only 1 to 2 in. deep, so a flat 4 in. depth minimum would reject real art.
  const MIN_DIM = { w: 4, h: 4, d: 1 };
  const DIM_NAME = { w: 'width', h: 'height', d: 'depth' };
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
    if (n < MIN_DIM[k]) return 'small';
    if (n > MAX_DIM) return 'huge';
    return 'ok';
  }
  const DIM_MESSAGES = {
    missing: () => 'Please enter the width, height and depth in inches.',
    invalid: (k) => `Enter the ${DIM_NAME[k]} as a plain number of inches (like 24 or 24.5).`,
    small: (k) => `Too small: ${DIM_NAME[k]} must be at least ${MIN_DIM[k]} in.`,
    huge: (k) => `Please check the ${DIM_NAME[k]}: that is over ${MAX_DIM} in.`,
  };
  // First problem with a piece's W x H x D, or null. { key, state, message }
  function dimProblem(it) {
    for (const k of ['w', 'h', 'd']) {
      const s = dimState(it, k);
      if (s !== 'ok') return { key: k, state: s, message: DIM_MESSAGES[s](k) };
    }
    return null;
  }
  // For pieces that don't ask for a size (custom, furniture): blank is fine, but anything sent must still be a plain decimal.
  function optionalDimProblem(it) {
    for (const k of ['w', 'h', 'd']) {
      const s = dimState(it, k);
      if (s === 'invalid' || s === 'huge') return { key: k, state: s, message: DIM_MESSAGES[s](k) };
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

  // Problems with one stop's address. [{ field: 'street'|'city'|'zip', message }]. Empty array = fine.
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
    }
    return out;
  }
  const addressOk = (a) => addressProblems(a).length === 0;

  return { MIN_DIM, REVIEW_DIM, MAX_DIM, num, parseDim, dimState, dimProblem, optionalDimProblem, largestSide, isOversized, zipOk, cityOk, streetHasNumber, noStreetNumberOk, needsAddressReview, isUS, addressProblems, addressOk };
});
