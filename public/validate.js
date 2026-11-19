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
  const num = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

  // 'ok' | 'missing' | 'small' for one dimension key ('w' | 'h' | 'd').
  function dimState(it, k) {
    const raw = String((it || {})[k] ?? '').trim();
    if (!raw) return 'missing';
    const n = num(raw);
    if (!(n > 0)) return 'missing';
    return n < MIN_DIM[k] ? 'small' : 'ok';
  }
  // First problem with a piece's W x H x D, or null. { key, state, message }
  function dimProblem(it) {
    for (const k of ['w', 'h', 'd']) {
      const s = dimState(it, k);
      if (s === 'missing') return { key: k, state: s, message: 'Please enter the width, height and depth in inches.' };
      if (s === 'small') return { key: k, state: s, message: `Too small: ${DIM_NAME[k]} must be at least ${MIN_DIM[k]} in.` };
    }
    return null;
  }

  // ZIP: exactly 5 digits, or ZIP+4 (12345-6789). Anything else is rejected.
  const ZIP_RX = /^\d{5}(-\d{4})?$/;
  const zipOk = (z) => ZIP_RX.test(String(z == null ? '' : z).trim());

  // City: letters (accents allowed), spaces, . ' - and an optional trailing ", CA"; at least 2 letters; no digits.
  const cityOk = (c) => {
    const s = String(c == null ? '' : c).trim();
    if (s.length < 2 || s.length > 60) return false;
    if (/\d/.test(s)) return false;
    if (!/^[\p{L}][\p{L} .'’\-,]*$/u.test(s)) return false;
    return (s.match(/\p{L}/gu) || []).length >= 2;
  };
  // Street: required and carries a street number (digits somewhere, e.g. "2 Henry Adams St", "8678 Melrose Ave", "Pier 39").
  const streetHasNumber = (s) => /\d/.test(String(s == null ? '' : s));

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
    else if (isUS(a) && !streetHasNumber(street)) out.push({ field: 'street', message: `Include the street number (like 2 Henry Adams St).` });
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

  return { MIN_DIM, num, dimState, dimProblem, zipOk, cityOk, streetHasNumber, isUS, addressProblems, addressOk };
});
