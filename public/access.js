/* CAD access questions: one shared module for the browser (window.CADAccess) and the server (require).
 * Chad (Nov 2026): access reads like a phone call. First "How do we get in?" (ground / a few steps / stairs / elevator / not sure),
 * then only the follow-ups that apply, then the doorway. Answers are never defaulted, so they can't contradict.
 * Path / stairs questions are asked only for heavy or big pieces; the doorway question only for truly giant ones
 * (see isPathAccessPiece / isDoorwayAccessPiece). When those questions are skipped, missing access is no stairs / standard.
 * normalize() maps the new answers onto the legacy fields pricing and scheduling already use
 * (stairKind, stairs, steps, elevator, floor, loadingDock, fits), so stair fees compute exactly as before. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.CADAccess = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const MODES = [
    ['ground', 'Same level (no stairs)'],
    ['steps', 'A few steps (3 or fewer)'],
    ['stairs', 'Stairs'],
    ['elevator', 'Elevator'],
    ['not_sure', 'Not sure'],
  ];
  const FLIGHTS = [['half', 'Half flight'], ['1', '1 flight'], ['2', '2 flights'], ['3', '3 flights'], ['4plus', '4+ flights']];
  const DIRS = [['up', 'Up'], ['down', 'Down (e.g. basement)']];
  const YNS = [['yes', 'Yes'], ['no', 'No'], ['not_sure', 'Not sure']];
  const DOORWAYS = [['single', 'Single door'], ['double', 'Double doors'], ['not_sure', 'Not sure']];
  const FITS = [['yes', 'Yes'], ['tight', 'Tight fit'], ['not_sure', 'Not sure']];
  // Elevator buildings can also have real stairs on the way (Nov 2026).
  // Required (Chad, Nov 16): Not sure flags the stop for CAD to confirm.
  const ELEV_STAIRS = [['no', 'No'], ['steps', 'A few steps (3 or fewer)'], ['stairs', 'Stairs'], ['not_sure', 'Not sure']];
  const ELEV_STEPS = ELEV_STAIRS; // old name, kept for callers
  // Chad, Nov 23 2026: "Two or more flights" picks the count from a list (2 through 10+); elevator asks regular or service,
  // then whether the piece will fit (Not sure needs the client's acknowledgment); an optional outdoor path type.
  const FLIGHT_COUNTS = [['2', '2 flights'], ['3', '3 flights'], ['4', '4 flights'], ['5', '5 flights'], ['6', '6 flights'], ['7', '7 flights'], ['8', '8 flights'], ['9', '9 flights'], ['10plus', '10+ flights']];
  const ELEV_TYPES = [['regular', 'Regular'], ['service', 'Service']];
  const ELEV_FIT = [['yes', 'Yes'], ['not_sure', 'Not sure']];
  const PATH_TYPES = [['none', 'No'], ['sand', 'Sand'], ['gravel', 'Gravel'], ['flagstone', 'Flagstone or brick'], ['grass', 'Grass'], ['gate', 'Narrow gate']];
  const roughPath = (a) => !!a && PATH_TYPES.some(([k]) => k === a.pathType) && a.pathType !== 'none';
  const ACK_TEXT = 'If it doesn’t fit, we may leave it at the ground level, lobby or entry, and you take responsibility for it from there. CAD isn’t liable.';
  const MODE_KEYS = MODES.map(([k]) => k);
  const REVIEW_NOTE = 'We’ll confirm access with you before the job.';
  // Shown next to the price whenever access is flagged for review (mode, fit or elevator stairs = Not sure).
  const PRICE_NOTE = 'Access isn’t confirmed yet. If it needs an added fee, we’ll go over it with you and get your OK before charging it.';
  const WEIGHT_NOTE = 'Price may be adjusted once the actual weight is confirmed; we’ll get your approval before charging any additional fees.';
  const WEIGHT_HINT = 'Mirrors and works on panel are often heavier than they look.';
  // Types whose online price includes a weight-based fee (wall-art over 50 lb, plus sculpture/other by weight).
  const WEIGHT_FEE_TYPES = ['painting', 'photograph', 'mirror', 'wallart', 'sculpture', 'other'];
  function pieceType(it) {
    if (!it) return '';
    if (it.type === 'decor' && it.furnitureKind === 'Mirror') return 'mirror';
    return it.type || '';
  }
  function weightFeeType(it) { return WEIGHT_FEE_TYPES.includes(pieceType(it)); }
  // Any piece marked Not sure (furniture included) is unconfirmed — never treated as 0 lb or auto-accepted.
  function weightUnconfirmed(items) { return (items || []).some((it) => it && it.weightUnsure); }
  const WEIGHT_DISPATCH_FLAG = 'WEIGHT TO CONFIRM BEFORE DISPATCH';
  function needsWeightHint(it) {
    if (pieceType(it) === 'mirror') return true;
    const blob = [it && it.materialNotes, it && it.description, it && it.furnitureKind, it && it.name].filter(Boolean).join(' ');
    return /\bpanel\b/i.test(blob);
  }
  // The customer still pays the base amount now; these labels replace "Total" and "Due today · paid in full at booking".
  const TBC_TOTAL = 'Total (before access check)';
  const TBC_DUE = 'Due today (base price)';
  const wholeFlights = (v) => { const n = num(v); return has(v) && Number.isInteger(n) && n >= 4 && /^\s*\d+\s*$/.test(String(v)); };

  const num = (s) => { const n = Number(String(s == null ? '' : s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const has = (v) => v != null && String(v).trim() !== '';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Access-question gates (Chad, Nov 25–26 2026, t2062u / t2064u / t2065u).
  // Path / stairs ("How do we reach the spot…") is asked only for heavy or big items —
  // those are the answers that can change the price (stairs, elevator handling).
  // Doorway / hallway is a stricter gate, only for truly giant items. If there is no
  // clean way to tell, we lean toward NOT asking.
  //
  // Path / stairs thresholds (any matching piece in the order):
  //   • Wall art (painting, photograph, other wall art, non-mirror décor): longest side > 72 in
  //     (existing LONG_IN / oversize line). Framed-over-60 in is only for asking weight, not access.
  //   • Mirrors (Mirror type or Décor → Mirror): face (width or height) >= 60 in, the existing
  //     large-mirror transport surcharge threshold; or a given weight > 150 lb (existing HEAVY_LB).
  //   • Furniture: recliner, loveseat, sofa, desk, sectionals, dining table, and other clearly
  //     large kinds (bed, dresser, armoire, credenza, …), or any furniture with size class large/heavy.
  //     A medium armchair, nightstand, ottoman, or side table is not asked.
  //   • Sculpture or "other": 100 lb or more. No weight (or under 100 lb) → not asked.
  //
  // Doorway / hallway thresholds (stricter; lean toward not asking):
  //   • Oversized wall art, including mirrors: longest side >= 96 in ("well over 72 in").
  //   • Sculpture: 100 lb or more.
  //   • Large furniture that is clearly a sofa, loveseat, sectional, or dining table.
  //     A desk, recliner, or large armchair gets path questions but not the doorway question.
  const PATH_FURNITURE = /sofa|loveseat|sectional|bed|dresser|armoire|wardrobe|cabinet|credenza|sideboard|buffet|bookcase|dining table|piano|desk|hutch|chest|recliner/i;
  const DOORWAY_FURNITURE = /sofa|loveseat|sectional|dining table/i;
  const HEAVY_LB = 150;
  const LONG_IN = 72;
  const MIRROR_LARGE_FACE_IN = 60;
  const SCULPTURE_PATH_LB = 100;
  const DOORWAY_WALL_IN = 96;
  const longestSide = (it) => Math.max(num(it && it.w), num(it && it.h), num(it && it.d));
  const mirrorFace = (it) => Math.max(num(it && it.w), num(it && it.h));
  const largeFurnitureClass = (it) => !!(it && it.type === 'furniture' && /^(large|heavy)$/i.test(String(it.sizeClass || '')));
  function isPathAccessPiece(it) {
    if (!it) return false;
    const t = pieceType(it);
    if (it.type === 'sculpture' || it.type === 'other') return num(it.weight) >= SCULPTURE_PATH_LB;
    if (it.type === 'furniture') return PATH_FURNITURE.test(String(it.furnitureKind || '')) || largeFurnitureClass(it);
    if (t === 'mirror') return mirrorFace(it) >= MIRROR_LARGE_FACE_IN || num(it.weight) > HEAVY_LB;
    if (['painting', 'photograph', 'wallart'].includes(it.type) || it.type === 'decor') return longestSide(it) > LONG_IN;
    return longestSide(it) > LONG_IN || num(it.weight) >= SCULPTURE_PATH_LB;
  }
  function isDoorwayAccessPiece(it) {
    if (!it) return false;
    const t = pieceType(it);
    if (it.type === 'sculpture') return num(it.weight) >= SCULPTURE_PATH_LB;
    if (it.type === 'furniture') return DOORWAY_FURNITURE.test(String(it.furnitureKind || ''));
    if (['painting', 'photograph', 'wallart'].includes(it.type) || t === 'mirror' || it.type === 'decor') return longestSide(it) >= DOORWAY_WALL_IN;
    if (it.type === 'other') return num(it.weight) >= SCULPTURE_PATH_LB || longestSide(it) >= DOORWAY_WALL_IN;
    return false;
  }
  // isBigPiece / firm: same as the path/stairs gate (heavy or big). Kept as aliases for older callers.
  function isBigPiece(it) { return isPathAccessPiece(it); }
  const firm = (items) => (Array.isArray(items) ? items : []).some(isBigPiece);
  const asksPathAccess = (items) => (Array.isArray(items) ? items : []).some(isPathAccessPiece);
  const asksDoorwayAccess = (items) => (Array.isArray(items) ? items : []).some(isDoorwayAccessPiece);

  // Stairs questions (flights, up/down, tight turns) apply to "Stairs", and to "Elevator" with stairs on the way.
  const usesStairs = (a) => !!a && (a.accessMode === 'stairs' || (a.accessMode === 'elevator' && a.elevatorStairs === 'stairs'));
  const fitUnsure = (a) => !!a && ['tight', 'not_sure'].includes(a.fits);

  // Map the conversational answers onto the legacy fields (and clear answers that no longer apply).
  function normalize(a) {
    if (!a || typeof a !== 'object') return a;
    // Orders saved before Nov 2026 used elevatorSteps ('steps' only).
    if (!has(a.elevatorStairs) && a.elevatorSteps === 'steps') a.elevatorStairs = 'steps';
    a.elevatorSteps = '';
    const mode = a.accessMode;
    if (!mode || !MODE_KEYS.includes(mode)) { if (mode) a.accessMode = ''; a.accessReview = false; return a; }
    if (mode !== 'elevator') { a.floor = ''; a.serviceElevator = ''; a.elevatorStairs = ''; }
    if (!ELEV_STAIRS.some(([k]) => k === a.elevatorStairs)) a.elevatorStairs = '';
    if (!usesStairs(a)) { a.stairFlights = ''; a.stairDir = ''; a.stairTurns = ''; a.stairPhotos = []; }
    a.dock = ''; // loading dock question removed (Chad, Nov 23 2026)
    if (mode !== 'elevator') { a.elevatorType = ''; a.elevatorFit = ''; }
    if (a.elevatorFit !== 'not_sure') a.elevatorAck = false;
    if (mode === 'elevator' && ELEV_TYPES.some(([k]) => k === a.elevatorType)) a.serviceElevator = a.elevatorType === 'service' ? 'yes' : 'no';
    if (a.fits !== 'tight') a.fitNote = '';
    if (has(a.pathType)) { if (!PATH_TYPES.some(([k]) => k === a.pathType)) a.pathType = ''; a.technicalCarry = roughPath(a); }
    a.stairPhotos = Array.isArray(a.stairPhotos) ? a.stairPhotos : [];
    a.doorPhotos = Array.isArray(a.doorPhotos) ? a.doorPhotos : [];
    if (!fitUnsure(a)) { a.doorPhotos = []; a.narrowestIn = ''; }
    else if (has(a.narrowestIn) && !(num(a.narrowestIn) > 0)) a.narrowestIn = '';
    if (usesStairs(a) && !['yes', 'not_sure'].includes(a.stairTurns)) a.stairPhotos = [];
    a.elevator = mode === 'elevator';
    a.loadingDock = false;
    // "Not sure": CAD confirms access before the job. Never priced as plain ground level without this flag.
    a.accessReview = needsReview(a);
    a.stairsPlus = false;
    const stairsFrom = () => {
      const f = String(a.stairFlights == null ? '' : a.stairFlights);
      a.steps = false;
      if (f === 'half') { a.stairKind = 'half'; a.stairs = 0.5; }
      else if (f === '4plus') { a.stairKind = 'flights'; a.stairsPlus = true; a.stairs = wholeFlights(a.stairs) ? num(a.stairs) : (has(a.stairs) && num(a.stairs) !== 0 ? String(a.stairs).trim() : ''); }
      else if (f === '10plus') { a.stairKind = 'flights'; a.stairs = 10; }
    else if (/^[1-9]$/.test(f)) { a.stairKind = 'flights'; a.stairs = Number(f); }
      else { a.stairKind = ''; a.stairs = 0; }
    };
    if (mode === 'ground' || mode === 'not_sure') { a.stairKind = 'none'; a.stairs = 0; a.steps = false; }
    else if (mode === 'steps') { a.stairKind = 'steps'; a.stairs = 0; a.steps = true; }
    else if (mode === 'elevator') {
      if (a.elevatorStairs === 'stairs') stairsFrom();
      else if (a.elevatorStairs === 'steps') { a.stairKind = 'steps'; a.stairs = 0; a.steps = true; }
      else { a.stairKind = 'none'; a.stairs = 0; a.steps = false; }
    } else if (mode === 'stairs') stairsFrom();
    return a;
  }

  // Photos are optional unless (Chad, Nov 23 2026): stairs plus a tight fit, or a rough/outdoor path with a big or heavy piece.
  // (A stairwell install's photos are asked on the hanging screen.)
  const stairPhotosNeeded = (a) => usesStairs(a) && a.fits === 'tight';
  const sitePhotosNeeded = (a, items) => roughPath(a) && asksPathAccess(items);
  const doorPhotosNeeded = () => false;

  // What is still unanswered at one stop. Codes double as field names.
  function gaps(a, items) {
    const out = [];
    if (!a) return out;
    // Small / normal pieces skip the path questions; missing access is treated as no stairs.
    if (!asksPathAccess(items)) return out;
    const needFit = asksDoorwayAccess(items) && a.stdDoorway === 'no';
    if (!MODE_KEYS.includes(a.accessMode)) { out.push('accessMode'); return out; }
    if (a.accessMode === 'elevator') {
      if (!ELEV_TYPES.some(([k]) => k === a.elevatorType)) out.push('elevatorType');
      if (!ELEV_FIT.some(([k]) => k === a.elevatorFit)) out.push('elevatorFit');
      else if (a.elevatorFit === 'not_sure' && a.elevatorAck !== true) out.push('elevatorAck');
    }
    if (usesStairs(a)) {
      if (!has(a.stairFlights)) out.push('stairFlights');
      else if (String(a.stairFlights) === '4plus' && !wholeFlights(a.stairs)) out.push('stairs');
    }
    if (needFit && !has(a.fits)) out.push('fits');
    if (stairPhotosNeeded(a) && !(a.stairPhotos || []).length) out.push('stairPhotos');
    if (sitePhotosNeeded(a, items) && !(a.sitePhotos || []).length) out.push('sitePhotos');
    return out;
  }

  const flightsWords = (a) => {
    const f = String(a.stairFlights == null ? '' : a.stairFlights);
    if (f === 'half') return 'About half a flight of stairs';
    if (f === '10plus') return '10+ flights of stairs';
    const n = f === '4plus' ? (wholeFlights(a.stairs) ? num(a.stairs) : 0) : Number(f);
    if (!(n > 0)) return f === '4plus' ? '4+ flights of stairs' : 'Stairs';
    return `${plural(n, 'flight')} of stairs`;
  };
  const YNS_WORD = { yes: 'yes', no: 'no', not_sure: 'not sure' };
  const stairBits = (a, bits, suffix) => {
    const dir = a.stairDir === 'up' ? ' up' : a.stairDir === 'down' ? ' down' : '';
    bits.push(flightsWords(a) + dir + suffix);
    if (a.stairTurns === 'yes') bits.push('Tight turns or narrow spots on the stairs');
    else if (a.stairTurns === 'no') bits.push('No tight turns on the stairs');
    else if (a.stairTurns === 'not_sure') bits.push('Not sure about tight turns on the stairs');
    if ((a.stairPhotos || []).length) bits.push(`${plural(a.stairPhotos.length, 'photo')} of the stairs`);
  };
  // Plain-words summary, one bit per answer. Only says what the customer actually chose; skipped answers say nothing.
  function summary(a) {
    const bits = [];
    if (!a) return bits;
    const mode = a.accessMode;
    if (mode === 'ground') bits.push('Same level (no stairs)');
    else if (mode === 'steps') bits.push('A few steps (3 or fewer)');
    else if (mode === 'not_sure') bits.push(`Access not sure: ${REVIEW_NOTE}`);
    else if (mode === 'stairs') stairBits(a, bits, '');
    else if (mode === 'elevator') {
      const et = a.elevatorType === 'service' ? 'Service elevator' : a.elevatorType === 'regular' ? 'Regular elevator' : 'Elevator';
      bits.push(has(a.floor) ? `${et}, floor ${String(a.floor).trim()}` : et);
      if (!a.elevatorType && YNS_WORD[a.serviceElevator]) bits.push(`Service elevator: ${YNS_WORD[a.serviceElevator]}`);
      if (a.elevatorFit === 'yes') bits.push('Fits in the elevator');
      else if (a.elevatorFit === 'not_sure') bits.push(`Not sure it fits in the elevator${a.elevatorAck ? ' (client accepted ground level, lobby or entry drop-off if it doesn’t)' : ''}`);
      if (a.elevatorStairs === 'no') bits.push('No stairs on the way');
      else if (a.elevatorStairs === 'steps') bits.push('A few steps (3 or fewer) on the way');
      else if (a.elevatorStairs === 'stairs') stairBits(a, bits, ' on the way to the elevator');
      else if (a.elevatorStairs === 'not_sure') bits.push('Not sure about stairs on the way');
    } else {
      // Older orders saved before the access questions were rebuilt.
      if (a.floor) bits.push(`Floor ${a.floor}`);
      if (a.elevator) bits.push('Elevator: yes');
      const k = a.stairKind;
      if (k === 'steps') bits.push('3 steps or fewer');
      else if (k === 'half') bits.push('Half flight of stairs');
      else if (k === 'flights' && num(a.stairs) > 0) bits.push(`${plural(num(a.stairs), 'flight')} of stairs`);
      if (a.fits === 'not_sure') bits.push('Not sure everything fits');
      return bits;
    }
    if (a.doorway === 'single') bits.push('Single door');
    else if (a.doorway === 'double') bits.push('Double doors');
    else if (a.doorway === 'not_sure') bits.push('Doors: not sure');
    if (a.fits === 'yes') bits.push('Fits easily');
    else if (a.fits === 'tight') bits.push(String(a.fitNote || '').trim() ? `Tight fit: ${String(a.fitNote).trim().slice(0, 200)}` : 'Tight fit');
    else if (a.fits === 'not_sure') bits.push('Not sure everything fits');
    if (fitUnsure(a) && num(a.narrowestIn) > 0) bits.push(`Narrowest opening ${num(a.narrowestIn)} in`);
    if ((a.doorPhotos || []).length) bits.push(`${plural(a.doorPhotos.length, 'photo')} of the tight spot and the way in`);
    if (roughPath(a)) bits.push(`Outdoor path: ${PATH_TYPES.find(([k]) => k === a.pathType)[1].toLowerCase()}`);
    return bits;
  }
  function needsReview(a) {
    if (!a || !MODE_KEYS.includes(a.accessMode)) return false;
    return a.accessMode === 'not_sure' || a.fits === 'not_sure' || (a.accessMode === 'elevator' && a.elevatorStairs === 'not_sure');
  }

  // Preferred times (Chad, Nov 23 2026): multi-select, stored as a comma list ("morning,midday"); "none" is exclusive.
  const TIME_PREFS = [['none', 'No preference'], ['morning', 'Morning'], ['late_morning', 'Late morning'], ['midday', 'Midday'], ['early_afternoon', 'Early afternoon'], ['afternoon', 'Afternoon'], ['late_afternoon', 'Late afternoon'], ['early_evening', 'Early evening'], ['evening', 'Evening'], ['late_evening', 'Late evening']];
  const timePrefList = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter((x) => x && x !== 'none' && TIME_PREFS.some(([k]) => k === x));
  const timePrefText = (v) => timePrefList(v).map((k) => TIME_PREFS.find(([x]) => x === k)[1]).join(', ');
  return { TIME_PREFS, timePrefList, timePrefText, FLIGHT_COUNTS, ELEV_TYPES, ELEV_FIT, PATH_TYPES, roughPath, ACK_TEXT, sitePhotosNeeded, MODES, FLIGHTS, DIRS, YNS, DOORWAYS, FITS, ELEV_STAIRS, ELEV_STEPS, MODE_KEYS, REVIEW_NOTE, PRICE_NOTE, WEIGHT_NOTE, WEIGHT_HINT, WEIGHT_DISPATCH_FLAG, WEIGHT_FEE_TYPES, pieceType, weightFeeType, weightUnconfirmed, needsWeightHint, TBC_TOTAL, TBC_DUE, wholeFlights, HEAVY_LB, LONG_IN, MIRROR_LARGE_FACE_IN, SCULPTURE_PATH_LB, DOORWAY_WALL_IN, isPathAccessPiece, isDoorwayAccessPiece, asksPathAccess, asksDoorwayAccess, isBigPiece, firm, normalize, gaps, summary, stairPhotosNeeded, doorPhotosNeeded, usesStairs, fitUnsure, needsReview, plural };
});
