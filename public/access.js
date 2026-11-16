/* CAD access questions: one shared module for the browser (window.CADAccess) and the server (require).
 * Chad (Nov 2026): access reads like a phone call. First "How do we get in?" (ground / a few steps / stairs / elevator),
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
  ];
  const FLIGHTS = [['half', 'Half flight'], ['1', '1 flight'], ['2', '2 flights'], ['3', '3 flights'], ['4plus', '4+ flights']];
  const DIRS = [['up', 'Up'], ['down', 'Down (e.g. basement)']];
  const YNS = [['yes', 'Yes'], ['no', 'No'], ['not_sure', 'Not sure']];
  const DOORWAYS = [['single', 'Single door'], ['double', 'Double doors'], ['not_sure', 'Not sure']];
  const FITS = [['yes', 'Yes'], ['tight', 'Tight fit'], ['not_sure', 'Not sure']];
  const ELEV_STEPS = [['no', 'No'], ['steps', 'A few steps (3 or fewer)']];
  const MODE_KEYS = MODES.map(([k]) => k);

  const num = (s) => { const n = Number(String(s == null ? '' : s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const has = (v) => v != null && String(v).trim() !== '';

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

  // Map the conversational answers onto the legacy fields (and clear answers that no longer apply).
  function normalize(a) {
    if (!a || typeof a !== 'object') return a;
    const mode = a.accessMode;
    if (!mode || !MODE_KEYS.includes(mode)) { if (mode) a.accessMode = ''; return a; }
    if (mode !== 'stairs') { a.stairFlights = ''; a.stairDir = ''; a.stairTurns = ''; a.stairPhotos = []; }
    if (mode !== 'elevator') { a.floor = ''; a.serviceElevator = ''; a.dock = ''; a.elevatorSteps = ''; }
    a.stairPhotos = Array.isArray(a.stairPhotos) ? a.stairPhotos : [];
    a.doorPhotos = Array.isArray(a.doorPhotos) ? a.doorPhotos : [];
    if (!['tight', 'not_sure'].includes(a.fits)) a.doorPhotos = [];
    if (mode === 'stairs' && !['yes', 'not_sure'].includes(a.stairTurns)) a.stairPhotos = [];
    a.elevator = mode === 'elevator';
    a.loadingDock = mode === 'elevator' && a.dock === 'yes';
    a.stairsPlus = false;
    if (mode === 'ground') { a.stairKind = 'none'; a.stairs = 0; a.steps = false; }
    else if (mode === 'steps') { a.stairKind = 'steps'; a.stairs = 0; a.steps = true; }
    else if (mode === 'elevator') {
      if (a.elevatorSteps === 'steps') { a.stairKind = 'steps'; a.stairs = 0; a.steps = true; }
      else { a.stairKind = 'none'; a.stairs = 0; a.steps = false; }
    } else if (mode === 'stairs') {
      const f = String(a.stairFlights == null ? '' : a.stairFlights);
      a.steps = false;
      if (f === 'half') { a.stairKind = 'half'; a.stairs = 0.5; }
      else if (f === '4plus') { a.stairKind = 'flights'; a.stairsPlus = true; a.stairs = num(a.stairs) >= 4 ? Math.round(num(a.stairs)) : ''; }
      else if (['1', '2', '3'].includes(f)) { a.stairKind = 'flights'; a.stairs = Number(f); }
      else { a.stairKind = ''; a.stairs = 0; }
    }
    return a;
  }

  const stairPhotosNeeded = (a) => !!a && a.accessMode === 'stairs' && ['yes', 'not_sure'].includes(a.stairTurns);
  const doorPhotosNeeded = (a) => !!a && a.fits === 'tight';

  // What is still unanswered at one stop. Codes double as field names.
  function gaps(a, items) {
    const out = [];
    if (!a) return out;
    const big = firm(items);
    if (!MODE_KEYS.includes(a.accessMode)) { out.push('accessMode'); return out; }
    if (a.accessMode === 'stairs') {
      if (!has(a.stairFlights)) out.push('stairFlights');
      else if (String(a.stairFlights) === '4plus' && !(num(a.stairs) >= 4)) out.push('stairs');
      if (!has(a.stairDir)) out.push('stairDir');
      if (big && !has(a.stairTurns)) out.push('stairTurns');
      if (stairPhotosNeeded(a) && !(a.stairPhotos || []).length) out.push('stairPhotos');
    }
    if (a.accessMode === 'elevator' && !(num(a.floor) >= 1)) out.push('floor');
    if (big && !has(a.fits)) out.push('fits');
    if (doorPhotosNeeded(a) && !(a.doorPhotos || []).length) out.push('doorPhotos');
    return out;
  }

  const flightsWords = (a) => {
    const f = String(a.stairFlights == null ? '' : a.stairFlights);
    if (f === 'half') return 'Half flight of stairs';
    const n = f === '4plus' ? num(a.stairs) : Number(f);
    if (!(n > 0)) return f === '4plus' ? '4+ flights of stairs' : 'Stairs';
    return `${n} flight${n === 1 ? '' : 's'} of stairs`;
  };
  const YNS_WORD = { yes: 'yes', no: 'no', not_sure: 'not sure' };
  // Plain-words summary, one bit per answer. Only says what the customer actually chose.
  function summary(a) {
    const bits = [];
    if (!a) return bits;
    const mode = a.accessMode;
    if (mode === 'ground') bits.push('Ground level, straight in (no stairs)');
    else if (mode === 'steps') bits.push('A few steps (3 or fewer)');
    else if (mode === 'stairs') {
      const dir = a.stairDir === 'up' ? ' up' : a.stairDir === 'down' ? ' down' : '';
      bits.push(flightsWords(a) + dir);
      if (a.stairTurns === 'yes') bits.push('Tight turns or narrow spots on the stairs');
      else if (a.stairTurns === 'no') bits.push('No tight turns on the stairs');
      else if (a.stairTurns === 'not_sure') bits.push('Not sure about tight turns on the stairs');
      if ((a.stairPhotos || []).length) bits.push(`${a.stairPhotos.length} photo(s) of the stairs`);
    } else if (mode === 'elevator') {
      bits.push(has(a.floor) ? `Elevator to floor ${String(a.floor).trim()}` : 'Elevator');
      if (YNS_WORD[a.serviceElevator]) bits.push(`Service elevator: ${YNS_WORD[a.serviceElevator]}`);
      if (YNS_WORD[a.dock]) bits.push(`Loading dock: ${YNS_WORD[a.dock]}`);
      if (a.elevatorSteps === 'steps') bits.push('A few steps (3 or fewer) to the elevator');
    } else {
      // Older orders saved before the access questions were rebuilt.
      if (a.floor) bits.push(`Floor ${a.floor}`);
      if (a.elevator) bits.push('Elevator: yes');
      if (a.loadingDock) bits.push('Loading dock: yes');
      const k = a.stairKind;
      if (k === 'steps') bits.push('3 steps or fewer');
      else if (k === 'half') bits.push('Half flight of stairs');
      else if (k === 'flights' && num(a.stairs) > 0) bits.push(`${num(a.stairs)} flight${num(a.stairs) === 1 ? '' : 's'} of stairs`);
      if (a.fits === 'not_sure') bits.push('Not sure it fits through doors/elevator');
      return bits;
    }
    if (a.doorway === 'single') bits.push('Single door');
    else if (a.doorway === 'double') bits.push('Double doors');
    else if (a.doorway === 'not_sure') bits.push('Doorway: not sure');
    if (a.fits === 'yes') bits.push('Fits easily');
    else if (a.fits === 'tight') bits.push('Tight fit');
    else if (a.fits === 'not_sure') bits.push('Not sure it fits through doors/elevator');
    if ((a.doorPhotos || []).length) bits.push(`${a.doorPhotos.length} photo(s) of the doorway`);
    return bits;
  }

  return { MODES, FLIGHTS, DIRS, YNS, DOORWAYS, FITS, ELEV_STEPS, MODE_KEYS, HEAVY_LB, LONG_IN, isBigPiece, firm, normalize, gaps, summary, stairPhotosNeeded, doorPhotosNeeded };
});
