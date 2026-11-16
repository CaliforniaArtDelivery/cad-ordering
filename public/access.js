/* CAD access questions: one shared module for the browser (window.CADAccess) and the server (require).
 * Chad (Nov 2026): access reads like a phone call. First "How do we get in?" (ground / a few steps / stairs / elevator / not sure),
 * then only the follow-ups that apply, then the doorway. Answers are never defaulted, so they can't contradict.
 * normalize() maps the new answers onto the legacy fields pricing and scheduling already use
 * (stairKind, stairs, steps, elevator, floor, loadingDock, fits), so stair fees compute exactly as before. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.CADAccess = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const MODES = [
    ['ground', 'Ground level, straight in (no stairs)'],
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
  const ELEV_STAIRS = [['no', 'No'], ['steps', 'A few steps'], ['stairs', 'Stairs']];
  const ELEV_STEPS = ELEV_STAIRS; // old name, kept for callers
  const MODE_KEYS = MODES.map(([k]) => k);
  const REVIEW_NOTE = 'We’ll confirm access with you before the job.';

  const num = (s) => { const n = Number(String(s == null ? '' : s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const has = (v) => v != null && String(v).trim() !== '';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // "Ask firmer" pieces: sofas / large furniture, anything over ~150 lb, or any side over 72".
  const BIG_FURNITURE = /sofa|loveseat|sectional|bed|dresser|armoire|wardrobe|cabinet|credenza|sideboard|buffet|bookcase|dining table|piano|desk|hutch|chest/i;
  const HEAVY_LB = 150;
  const LONG_IN = 72;
  function isBigPiece(it) {
    if (!it) return false;
    if (num(it.weight) > HEAVY_LB) return true;
    if (Math.max(num(it.w), num(it.h), num(it.d)) > LONG_IN) return true;
    if (it.type === 'furniture' && (it.sizeClass === 'large' || BIG_FURNITURE.test(String(it.furnitureKind || '')))) return true;
    return false;
  }
  const firm = (items) => (Array.isArray(items) ? items : []).some(isBigPiece);

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
    if (!YNS.some(([k]) => k === a.dock)) a.dock = '';
    a.stairPhotos = Array.isArray(a.stairPhotos) ? a.stairPhotos : [];
    a.doorPhotos = Array.isArray(a.doorPhotos) ? a.doorPhotos : [];
    if (!fitUnsure(a)) { a.doorPhotos = []; a.narrowestIn = ''; }
    else if (has(a.narrowestIn) && !(num(a.narrowestIn) > 0)) a.narrowestIn = '';
    if (usesStairs(a) && !['yes', 'not_sure'].includes(a.stairTurns)) a.stairPhotos = [];
    a.elevator = mode === 'elevator';
    a.loadingDock = a.dock === 'yes';
    // "Not sure": CAD confirms access before the job. Never priced as plain ground level without this flag.
    a.accessReview = mode === 'not_sure';
    a.stairsPlus = false;
    const stairsFrom = () => {
      const f = String(a.stairFlights == null ? '' : a.stairFlights);
      a.steps = false;
      if (f === 'half') { a.stairKind = 'half'; a.stairs = 0.5; }
      else if (f === '4plus') { a.stairKind = 'flights'; a.stairsPlus = true; a.stairs = num(a.stairs) >= 4 ? Math.round(num(a.stairs)) : ''; }
      else if (['1', '2', '3'].includes(f)) { a.stairKind = 'flights'; a.stairs = Number(f); }
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

  const stairPhotosNeeded = (a) => usesStairs(a) && ['yes', 'not_sure'].includes(a.stairTurns);
  const doorPhotosNeeded = (a) => !!a && a.fits === 'tight';

  // What is still unanswered at one stop. Codes double as field names.
  function gaps(a, items) {
    const out = [];
    if (!a) return out;
    const big = firm(items);
    if (!MODE_KEYS.includes(a.accessMode)) { out.push('accessMode'); return out; }
    if (a.accessMode === 'elevator' && !(num(a.floor) >= 1)) out.push('floor');
    if (usesStairs(a)) {
      if (!has(a.stairFlights)) out.push('stairFlights');
      else if (String(a.stairFlights) === '4plus' && !(num(a.stairs) >= 4)) out.push('stairs');
      if (!has(a.stairDir)) out.push('stairDir');
      if (big && !has(a.stairTurns)) out.push('stairTurns');
      if (stairPhotosNeeded(a) && !(a.stairPhotos || []).length) out.push('stairPhotos');
    }
    if (big && !has(a.fits)) out.push('fits');
    if (doorPhotosNeeded(a) && !(a.doorPhotos || []).length) out.push('doorPhotos');
    return out;
  }

  const flightsWords = (a) => {
    const f = String(a.stairFlights == null ? '' : a.stairFlights);
    if (f === 'half') return 'Half flight of stairs';
    const n = f === '4plus' ? num(a.stairs) : Number(f);
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
    if (mode === 'ground') bits.push('Ground level, straight in (no stairs)');
    else if (mode === 'steps') bits.push('A few steps (3 or fewer)');
    else if (mode === 'not_sure') bits.push(`Access not sure: ${REVIEW_NOTE}`);
    else if (mode === 'stairs') stairBits(a, bits, '');
    else if (mode === 'elevator') {
      bits.push(has(a.floor) ? `Elevator to floor ${String(a.floor).trim()}` : 'Elevator');
      if (YNS_WORD[a.serviceElevator]) bits.push(`Service elevator: ${YNS_WORD[a.serviceElevator]}`);
      if (a.elevatorStairs === 'no') bits.push('No stairs on the way');
      else if (a.elevatorStairs === 'steps') bits.push('A few steps (3 or fewer) on the way');
      else if (a.elevatorStairs === 'stairs') stairBits(a, bits, ' on the way to the elevator');
    } else {
      // Older orders saved before the access questions were rebuilt.
      if (a.floor) bits.push(`Floor ${a.floor}`);
      if (a.elevator) bits.push('Elevator: yes');
      if (a.loadingDock) bits.push('Loading dock: yes');
      const k = a.stairKind;
      if (k === 'steps') bits.push('3 steps or fewer');
      else if (k === 'half') bits.push('Half flight of stairs');
      else if (k === 'flights' && num(a.stairs) > 0) bits.push(`${plural(num(a.stairs), 'flight')} of stairs`);
      if (a.fits === 'not_sure') bits.push('Not sure everything fits');
      return bits;
    }
    if (YNS_WORD[a.dock]) bits.push(`Loading dock: ${YNS_WORD[a.dock]}`);
    if (a.doorway === 'single') bits.push('Single door');
    else if (a.doorway === 'double') bits.push('Double doors');
    else if (a.doorway === 'not_sure') bits.push('Doors: not sure');
    if (a.fits === 'yes') bits.push('Fits easily');
    else if (a.fits === 'tight') bits.push('Tight fit');
    else if (a.fits === 'not_sure') bits.push('Not sure everything fits');
    if (fitUnsure(a) && num(a.narrowestIn) > 0) bits.push(`Narrowest opening ${num(a.narrowestIn)} in`);
    if ((a.doorPhotos || []).length) bits.push(`${plural(a.doorPhotos.length, 'photo')} of the tight spot and the way in`);
    return bits;
  }
  const needsReview = (a) => !!a && a.accessMode === 'not_sure';

  return { MODES, FLIGHTS, DIRS, YNS, DOORWAYS, FITS, ELEV_STAIRS, ELEV_STEPS, MODE_KEYS, REVIEW_NOTE, HEAVY_LB, LONG_IN, isBigPiece, firm, normalize, gaps, summary, stairPhotosNeeded, doorPhotosNeeded, usesStairs, fitUnsure, needsReview, plural };
});
