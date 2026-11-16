// Regression checks for the Nov 16, 2026 pre-flight audit (AUDIT_FINDINGS.md). API + library level, no browser.
// Standalone: node scripts/audit-regression.js (server on BASE_URL, started with STORAGE_DIR, ADMIN_KEY and TEST_MODE=1).
// Also run at the end of scripts/e2e.js; every failure goes into the same errors list.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const sched = require('../lib/scheduling');
const config = require('../config');

async function run(BASE, errors, { dataRoot = process.env.STORAGE_DIR || ROOT, adminKey = process.env.ADMIN_KEY || '' } = {}) {
  const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const outbox = path.join(dataRoot, 'outbox');
  const mails = (id, kind) => fs.readdirSync(outbox).filter((f) => f.startsWith(id + '-') && (!kind || f.includes(`-${kind}`))).map((f) => fs.readFileSync(path.join(outbox, f), 'utf8'));
  const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  // ---- 1. Routing: ZIP first, city field only, never the street (P0-1) ----
  const zones = [
    [{ street: '1800 Laguna St', city: 'San Francisco', zip: '94109' }, 'BayWest'],
    [{ street: '2000 Van Ness Ave', city: 'San Francisco', zip: '94109' }, 'BayWest'],
    [{ street: '100 Marina Blvd', city: 'San Francisco', zip: '94123' }, 'BayWest'],
    [{ street: '500 Davis St', city: 'San Francisco', zip: '94111' }, 'BayWest'],
    [{ street: '1 Fremont St', city: 'San Francisco', zip: '94105' }, 'BayWest'],
    [{ street: '10 Richmond Ave', city: 'San Jose', zip: '95128' }, 'BayWest'],
    [{ street: '200 Lincoln Ave', city: 'Palo Alto', zip: '94301' }, 'BayWest'],
    [{ street: '4000 Lincoln Blvd', city: 'Marina del Rey', zip: '90292' }, 'LA'],
    [{ street: '123 Orange Grove Blvd', city: 'Pasadena', zip: '91105' }, 'LA'],
    [{ street: '1 Huntington Dr', city: 'San Marino', zip: '91108' }, 'LA'],
    [{ street: '50 Sonoma Ave', city: 'Los Angeles', zip: '90024' }, 'LA'],
    [{ street: '1 Carmel Ave', city: 'Palm Springs', zip: '92262' }, 'Coachella'],
    [{ street: '100 Main St', city: 'Orangevale', zip: '95662' }, 'Sacramento'],
    [{ street: '1 Ocean Ave', city: 'Carmel-by-the-Sea', zip: '93921' }, 'Carmel'],
    [{ street: '', city: 'Marina', zip: '93933' }, 'Carmel'],
    [{ street: '', city: 'Gilroy', zip: '95020' }, 'Carmel'],
    [{ street: '', city: 'Napa', zip: '94558' }, 'NapaWine'],
    [{ street: '', city: 'Oakland', zip: '94611' }, 'EastBay'],
    [{ street: '', city: 'Healdsburg', zip: '95448' }, 'BayWest'],
    [{ street: '', city: 'Tahoe City', zip: '96145' }, 'Tahoe'],
    [{ street: '', city: 'Laguna Beach', zip: '92651' }, 'OC'],
    [{ street: '', city: 'La Jolla', zip: '92037' }, 'SD'],
    [{ street: '', city: 'Montecito', zip: '93108' }, 'SB'],
    // No ZIP: the city field decides, never the street.
    [{ street: '1 Laguna St', city: 'San Francisco', zip: '' }, 'BayWest'],
    [{ street: '1 Marina Way', city: 'Marina del Rey', zip: '' }, 'LA'],
    [{ street: '1 Main St', city: 'Orangevale', zip: '' }, 'Sacramento'],
  ];
  zones.forEach(([a, want]) => { const got = sched.zoneFor(a); if (got !== want) errors.push(`routing: ${a.street || '-'}, ${a.city} ${a.zip} → ${got}, expected ${want}`); });
  const sfDays = sched.availableDays({ street: '1800 Laguna St', city: 'San Francisco', zip: '94109' }, { count: 30 });
  if (!sfDays.length || sfDays.some((d) => ![3, 5].includes(new Date(d.date + 'T12:00:00Z').getUTCDay()))) errors.push('routing: 1800 Laguna St 94109 should only get Wed/Fri Bay Area days');

  // ---- 2. Holidays (P1-28) and customer route labels (P0-10) ----
  ['2027-01-18', '2027-02-15', '2027-05-31', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24', '2027-12-25'].forEach((d) => {
    if (!config.scheduling.blackoutDates.includes(d)) errors.push(`holidays: ${d} should be blacked out`);
  });
  const allDays = ['90069', '94109', '92618', '93921', '96145', '92262', '92037', '93711']
    .flatMap((zip) => sched.availableDays({ zip, city: '' }, { count: 200 }));
  if (allDays.some((d) => config.scheduling.blackoutDates.includes(d.date))) errors.push('holidays: a blackout date is offered as a route day');
  const badLabel = allDays.find((d) => /→|·|heading|simple stop|hub|night in|if quick/i.test(`${d.shortLabel} ${d.routeLabel}`));
  if (badLabel) errors.push(`route labels: internal wording shown to customers: "${badLabel.shortLabel}" / "${badLabel.routeLabel}"`);

  // ---- 3. Server-side validation mirrors the form (P0-2) ----
  const addr = (o) => ({ street: '1 Main St', city: 'Los Angeles', state: 'CA', zip: '90069', country: 'United States', contactName: 'Pat Pickup', contactPhone: '3105550101', contactRole: 'Assistant', accessMode: 'ground', fits: 'yes', ...o });
  const item = (o) => ({ qty: 1, type: 'painting', description: 'Oil', w: 30, h: 40, d: 2, framed: 'no', value: '5000', photos: [], ...o });
  const laDays = sched.availableDays(addr(), { count: 10 });
  const date = laDays[0].date;
  const base = (o) => ({
    service: 'pickup_delivery', items: [item()], pickup: addr(), dropoff: addr({ contactName: 'Rita Recipient', contactPhone: '4155550102', contactRole: 'Homeowner' }),
    contact: { name: 'Bea Buyer', email: 'buyer@example.com', phone: '3105550100' }, heard: { source: 'google' },
    schedule: { date, deliveryDate: date }, payer: 'me', ...o,
  });
  const nonRoute = (() => { for (let i = 3; i < 30; i++) { const d = new Date(Date.now() + i * 864e5).toISOString().slice(0, 10); if (!laDays.some((x) => x.date === d) && !sched.availableDays(addr(), { count: 40 }).some((x) => x.date === d)) return d; } return null; })();
  const bad = [
    ['blackout date', base({ schedule: { date: '2027-12-25', deliveryDate: '2027-12-25' } })],
    ['past date', base({ schedule: { date: '2020-01-01', deliveryDate: '2020-01-01' } })],
    ['non-route day for the address', base({ schedule: { date: nonRoute, deliveryDate: nonRoute } })],
    ['delivery before pickup', base({ schedule: { date: laDays[1].date, deliveryDate: laDays[0].date } })],
    ['missing dimensions', base({ items: [item({ w: '', h: '', d: '' })] })],
    ['missing contact role', base({ pickup: addr({ contactRole: '' }) })],
    ['"Other" role without text', base({ pickup: addr({ contactRole: 'Other', contactRoleOther: '' }) })],
    ['sculpture without weight', base({ items: [item({ type: 'sculpture', framed: '', weight: '' })] })],
    ['over 500 lb without photo', base({ items: [item({ type: 'sculpture', framed: '', weight: '501' })] })],
  ];
  for (const [name, b] of bad) { const r = await post('/api/orders', b); if (r.s !== 400) errors.push(`validation: ${name} should be refused (got ${r.s} ${r.j.status || ''})`); }
  const at500 = await post('/api/orders', base({ items: [item({ type: 'sculpture', framed: '', weight: '500', description: 'Exactly 500 lb' })] }));
  if (at500.s !== 200) errors.push(`validation: exactly 500 lb needs no photo (got ${at500.s} ${at500.j.error || ''})`);

  // ---- 4. Idempotency: double tap / refresh after paying (P0-16) ----
  const once = base({ items: [item({ description: 'Idempotency check ' + Date.now() })] });
  const [a1, a2] = await Promise.all([post('/api/orders', once), post('/api/orders', once)]);
  if (!a1.j.id || a1.j.id !== a2.j.id) errors.push(`idempotency: two identical submits made two orders (${a1.j.id}, ${a2.j.id})`);
  const p1 = await post(`/api/orders/${a1.j.id}/pay`, { method: 'card', card: '4242424242424242' });
  const again = await post('/api/orders', once);
  const p2 = await post(`/api/orders/${again.j.id}/pay`, { method: 'card', card: '4242424242424242' });
  if (again.j.id !== a1.j.id || again.j.status !== 'confirmed') errors.push('idempotency: resubmitting after paying should return the confirmed order');
  if (!p1.j.order || !p2.j.order || p1.j.order.payment.ref !== p2.j.order.payment.ref) errors.push('idempotency: paying twice should not create a second payment');
  if (mails(a1.j.id, 'confirmation').length !== 1) errors.push('idempotency: exactly one confirmation email expected');

  // ---- 5. Emails: wording, commas, payer copies, install address (P0-7, P0-8, P0-15, P1-10) ----
  const banned = /\(she may consult Chad\)|rush or dedicated trip quote|1\.5× to 2×|handler|Drop-off|crat(e|ed|ing)|\$\d{4,}\.\d\d/i;
  const weightQ = await post('/api/orders', base({ items: [item({ type: 'sculpture', framed: '', weight: '', weightUnsure: true, photos: ['/uploads/x.png'], description: 'Bronze, weight unknown' })], payer: 'other', payerOther: { name: 'Paul Payer', email: 'payer@example.com', phone: '2125550103' } }));
  if (weightQ.j.status !== 'pending_approval') errors.push('weight-unknown sculpture should be a quote request');
  else {
    const m = text(mails(weightQ.j.id, 'quote_received')[0] || '');
    if (!m) errors.push('quote_received email missing');
    if (banned.test(m)) errors.push(`quote email has banned wording: ${(m.match(banned) || [])[0]}`);
    if (/\$75\.00–\$75\.00|\$0\.00–\$0\.00/.test(m)) errors.push('quote email shows a fake same-number range');
    if (!/weight we’ll confirm/.test(m)) errors.push('quote email should say why it needs a price (weight to confirm)');
    if (!mails(weightQ.j.id, 'payer_quote').length) errors.push('payer should get a notice when listed as "Someone else"');
  }
  const big = await post('/api/orders', { ...base({ service: 'install_only', items: [item({ qty: 20, value: '10000', description: 'Install receipt check' })], payer: 'other', payerOther: { name: 'Paul Payer', email: 'payer@example.com', phone: '2125550103' } }), pickup: undefined });
  if (big.s !== 200) errors.push(`install-only order refused: ${big.j.error}`);
  else {
    await post(`/api/orders/${big.j.id}/pay`, { method: 'card', card: '4242424242424242' });
    const m = text(mails(big.j.id, 'confirmation')[0] || '');
    if (!/Install address/.test(m) || /Drop-off/.test(m)) errors.push('install-only email should say "Install address", never "Drop-off"');
    if (!/\$4,050\.00/.test(m) || !/\$2,025\.00/.test(m)) errors.push('email prices need commas ($4,050.00 / $2,025.00)');
    if (/at pickup/.test(m)) errors.push('install-only email should never mention "at pickup"');
    if (banned.test(m)) errors.push(`confirmation email has banned wording: ${(m.match(banned) || [])[0]}`);
    if (!mails(big.j.id, 'payer_receipt').length) errors.push('payer should get a receipt copy when listed as "Someone else"');
  }
  const shipQ = await post('/api/orders', base({ service: 'crating_shipping', dropoff: addr({ city: 'Portland', state: 'OR', zip: '97201', locationType: 'residential' }), items: [item({ weight: '20' })], shipping: { serviceLevel: 'inside', shipBy: '', flexible: true }, schedule: {} }));
  if (shipQ.s !== 200) errors.push(`shipping request refused: ${shipQ.j.error}`);
  else { const m = text(mails(shipQ.j.id, 'quote_received')[0] || ''); if (/crat(e|ed|ing)|Why a quote|customer chose/i.test(m)) errors.push('shipping email should not mention crating or internal notes'); }

  // ---- 6. Admin key (P0-3) ----
  for (const k of ['', 'cad-admin']) { const r = await fetch(`${BASE}/api/admin/orders?key=${k}`); if (r.status === 200) errors.push(`admin: key "${k || '(none)'}" must not open admin`); }
  if (adminKey) { const r = await fetch(`${BASE}/api/admin/orders?key=${encodeURIComponent(adminKey)}`); if (r.status !== 200) errors.push('admin: the configured ADMIN_KEY should open admin'); }

  // ---- 7. Access fixes (Dot review, Nov 16 2026) ----
  const A = require('../public/access');
  const schedSheet = require('../lib/schedule');
  if (!A.MODES.some(([k, l]) => k === 'not_sure' && l === 'Not sure') || A.MODES.length !== 5) errors.push('access: "Not sure" should be the 5th first answer');
  ['Ground level, straight in (no stairs)', 'A few steps (3 or fewer)', 'Stairs', 'Elevator'].forEach((l, i) => { if (A.MODES[i][1] !== l) errors.push(`access: Chad's option wording changed: ${A.MODES[i][1]}`); });
  const heavyIt = [item({ type: 'sculpture', framed: '', weight: '226', w: 16, h: 52, d: 15, photos: ['/uploads/x.png'] })];
  const qFee = async (dropoff, pickup = {}) => {
    const r = await post('/api/quote', { service: 'pickup_delivery', items: heavyIt, pickup: { zip: '90069', ...pickup }, dropoff: { zip: '90210', ...dropoff } });
    const lines = (r.j.lines || []).filter((l) => /^Stairs/.test(l.label));
    return { fee: lines.reduce((t, l) => t + l.amount, 0), lines, j: r.j };
  };
  // Elevator buildings with real stairs on the way: same follow-ups and the same fee as Stairs.
  const elevStairs = { accessMode: 'elevator', floor: '9', elevatorStairs: 'stairs', stairFlights: '2', stairDir: 'up', stairTurns: 'no', fits: 'yes' };
  const plain2 = { accessMode: 'stairs', stairFlights: '2', stairDir: 'up', stairTurns: 'no', fits: 'yes' };
  const fe = await qFee(elevStairs); const fs2 = await qFee(plain2);
  if (fe.fee !== 300 || fe.fee !== fs2.fee) errors.push(`access fee: elevator + 2 flights should be $300 like plain stairs (got $${fe.fee} vs $${fs2.fee})`);
  const both = await qFee(elevStairs, { accessMode: 'stairs', stairFlights: 'half', stairDir: 'down', stairTurns: 'no', fits: 'yes' });
  if (both.fee !== 375 || both.lines.length !== 2) errors.push(`access fee: pickup half flight + delivery elevator with 2 flights should sum to $375 in 2 lines (got $${both.fee}, ${both.lines.length})`);
  const fsteps = await qFee({ accessMode: 'elevator', floor: '9', elevatorStairs: 'steps', fits: 'yes' });
  const fno = await qFee({ accessMode: 'elevator', floor: '9', elevatorStairs: 'no', fits: 'yes' });
  if (fsteps.fee || fno.fee) errors.push('access fee: elevator with no stairs or a few steps has no stairs fee');
  const legacy = A.normalize({ accessMode: 'elevator', floor: '3', elevatorSteps: 'steps' });
  if (legacy.elevatorStairs !== 'steps' || legacy.stairKind !== 'steps') errors.push('access: old "steps to the elevator" answers should still map to A few steps');
  // Elevator + Stairs asks the same follow-ups (and photos for tight turns).
  const g1 = A.gaps(A.normalize({ accessMode: 'elevator', floor: '4', elevatorStairs: 'stairs' }), heavyIt);
  ['stairFlights', 'stairDir', 'stairTurns'].forEach((k) => { if (!g1.includes(k)) errors.push(`access: elevator + stairs should require ${k}`); });
  const g2 = A.gaps(A.normalize({ accessMode: 'elevator', floor: '4', elevatorStairs: 'stairs', stairFlights: '1', stairDir: 'up', stairTurns: 'yes', fits: 'yes' }), heavyIt);
  if (!g2.includes('stairPhotos')) errors.push('access: elevator + stairs with tight turns should require stair photos');
  // Not sure: priced like no stairs, but always flagged for review, with the customer note.
  const fns = await qFee({ accessMode: 'not_sure', fits: 'yes' });
  if (fns.fee) errors.push('access: Not sure should not add a stairs fee');
  if (!(fns.j.notes || []).includes(A.PRICE_NOTE)) errors.push('access: Not sure quote must carry the access-to-be-confirmed price line');
  const ns = A.normalize({ accessMode: 'not_sure' });
  if (!ns.accessReview || ns.stairKind !== 'none') errors.push('access: Not sure should set accessReview');
  if (A.summary(ns).some((x) => /Ground level/.test(x))) errors.push('access: Not sure must never read as Ground level');
  if (!A.summary(ns).join(' ').includes('We’ll confirm access with you before the job.')) errors.push('access: Not sure review line missing the confirm note');
  if (A.gaps(ns, [item()]).length) errors.push('access: Not sure must not block checkout for a small piece');
  const nsOrder = await post('/api/orders', base({ items: [item({ description: 'Access not sure ' + Date.now() })], dropoff: addr({ contactName: 'Rita Recipient', contactPhone: '4155550102', contactRole: 'Homeowner', accessMode: 'not_sure', fits: '' }) }));
  if (nsOrder.s !== 200) errors.push(`access: Not sure order refused: ${nsOrder.j.error}`);
  else {
    if (!nsOrder.j.order || nsOrder.j.order.accessReview !== true) errors.push('access: Not sure order should carry accessReview: true');
    const row = schedSheet.toRow ? schedSheet.toRow(nsOrder.j.order) : null;
    const notes = schedSheet.formatAccessNotes ? schedSheet.formatAccessNotes(nsOrder.j.order.dropoff) : JSON.stringify(row || '');
    if (!/ACCESS REVIEW/.test(notes)) errors.push('access: schedule sheet notes should flag ACCESS REVIEW');
    if (adminKey) {
      const adm = await (await fetch(`${BASE}/api/admin/orders?key=${encodeURIComponent(adminKey)}`)).json();
      const found = (adm.orders || adm).find ? (adm.orders || adm).find((o) => o.id === nsOrder.j.id) : null;
      if (!found || !found.accessReview) errors.push('access: admin view should see accessReview on the order');
    }
    const admHtml = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
    if (!/ACCESS REVIEW/.test(admHtml)) errors.push('access: admin list should show an ACCESS REVIEW tag');
  }
  // Loading dock for every mode; label + summary wording; skipped answers never asserted; plurals.
  const dk = A.normalize({ accessMode: 'ground', dock: 'yes' });
  if (dk.dock !== 'yes' || !dk.loadingDock || !A.summary(dk).includes('Loading dock: yes')) errors.push('access: Loading dock should be kept for ground level too');
  const skipped = A.summary(A.normalize({ accessMode: 'elevator', floor: '12' }));
  if (skipped.join(' · ') !== 'Elevator, floor 12') errors.push('access: skipped answers must not appear: ' + skipped.join(' · '));
  const one = A.summary(A.normalize({ accessMode: 'stairs', stairFlights: '1', stairDir: 'up', stairTurns: 'yes', stairPhotos: ['a'], fits: 'tight', doorPhotos: ['a', 'b'], narrowestIn: '28' })).join(' · ');
  if (!/1 photo of the stairs/.test(one) || !/2 photos of the tight spot/.test(one) || /photo\(s\)/.test(one)) errors.push('access: plurals wrong: ' + one);
  if (!/Narrowest opening 28 in/.test(one)) errors.push('access: narrowest opening missing from summary');
  if (A.normalize({ accessMode: 'ground', fits: 'yes', narrowestIn: '28' }).narrowestIn !== '') errors.push('access: narrowest opening only applies to a tight or not-sure fit');
  // Server error wording.
  const e4 = await post('/api/orders', base({ dropoff: addr({ contactRole: 'Homeowner', accessMode: 'stairs', stairFlights: '4plus', stairDir: 'up' }) }));
  if (!/number of flights \(4 or more\)/.test(e4.j.error || '')) errors.push('access: 4+ flights without a total should be refused');
  // Stairwell fit: "A few steps" only asks for a large piece that is also heavy.
  const pr = require('../lib/pricing');
  const tall = { w: 90, h: 40, d: 3, weight: 40 };
  const tallHeavy = { w: 90, h: 40, d: 3, weight: 300 };
  const ord = (dropoff) => ({ service: 'delivery', dropoff });
  if (pr.needsStairwellFit(tall, ord(A.normalize({ accessMode: 'steps' })))) errors.push('stairwell fit: a light 90" piece with a few steps should not ask');
  if (!pr.needsStairwellFit(tallHeavy, ord(A.normalize({ accessMode: 'steps' })))) errors.push('stairwell fit: a heavy 90" piece with a few steps should ask');
  if (!pr.needsStairwellFit(tall, ord(A.normalize({ accessMode: 'stairs', stairFlights: '1', stairDir: 'up' })))) errors.push('stairwell fit: real stairs should ask for a 90" piece');
  if (!pr.needsStairwellFit(tall, ord(A.normalize({ accessMode: 'elevator', floor: '3', elevatorStairs: 'stairs', stairFlights: '1', stairDir: 'up' })))) errors.push('stairwell fit: elevator + stairs should ask for a 90" piece');
  // ACCESS_COPY.txt matches the new copy.
  const copy = fs.readFileSync(path.join(ROOT, 'ACCESS_COPY.txt'), 'utf8');
  ['Not sure', 'Any stairs on the way?', 'Count steps before or after the elevator.', 'Service elevator available?', 'Loading dock available?', 'Doors (optional)', 'Think doors, halls, turns, stairs and the elevator.', 'Please add a photo of the tight spot and the way in.', 'Photos help if you have them.', 'Narrowest opening (inches)', 'Total number of flights', 'Enter the total number of flights (4 or more).', 'e.g. 3, Basement', 'Elevator, floor 30', A.PRICE_NOTE, 'Add a photo so we can plan for the weight.']
    .forEach((t) => { if (!copy.includes(t)) errors.push('ACCESS_COPY.txt missing: ' + t); });
  ['send them later', 'Doorway (optional)', 'steps on the way to the elevator', 'photo(s)', 'Elevator to floor', 'Exact number of flights', 'the way in, so we can plan the carry'].forEach((t) => { if (copy.includes(t)) errors.push('ACCESS_COPY.txt still has: ' + t); });

  // ---- 8. Boundaries (Chad, Nov 16 second review): server side ----
  {
    let n = 0;
    const tag = () => `Boundary ${Date.now()}-${++n}`;
    const order = (it, dropoff) => post('/api/orders', base({ items: [item({ description: tag(), ...it })], dropoff: addr({ contactName: 'Rita Recipient', contactPhone: '4155550102', contactRole: 'Homeowner', ...dropoff }) }));
    const ok = async (name, r) => { const x = await r; if (x.s !== 200) errors.push(`boundary: ${name} should be accepted (got ${x.s} ${x.j.error || ''})`); return x; };
    const no = async (name, r, re) => { const x = await r; if (x.s !== 400 || (re && !re.test(x.j.error || ''))) errors.push(`boundary: ${name} should be refused${re ? ' with ' + re : ''} (got ${x.s} ${x.j.error || ''})`); return x; };
    const oneFlight = { accessMode: 'stairs', stairFlights: '1', stairDir: 'up', stairTurns: 'no', fits: 'yes' };
    // 80" vs 81": stairwell fit confirmation on real stairs.
    await ok('80" piece on 1 flight without stairwell confirmation', order({ w: 80, h: 30, d: 2 }, oneFlight));
    await no('81" piece on 1 flight without stairwell confirmation', order({ w: 81, h: 30, d: 2 }, oneFlight), /stairwell fit/);
    await ok('81" piece on 1 flight with stairwell confirmation', order({ w: 81, h: 30, d: 2, fitsStairwell: true }, oneFlight));
    // 150 vs 151 lb: the fit question becomes required.
    await ok('150 lb sculpture, ground, no fit answer', order({ type: 'sculpture', framed: '', weight: '150', w: 20, h: 30, d: 20 }, { fits: '' }));
    await no('151 lb sculpture, ground, no fit answer', order({ type: 'sculpture', framed: '', weight: '151', w: 20, h: 30, d: 20 }, { fits: '' }), /will everything fit easily/);
    // 500 vs 501 lb, unknown weight: photos.
    await ok('500 lb sculpture without a photo', order({ type: 'sculpture', framed: '', weight: '500', w: 20, h: 30, d: 20 }, {}));
    await no('501 lb sculpture without a photo', order({ type: 'sculpture', framed: '', weight: '501', w: 20, h: 30, d: 20 }, {}), /photos/);
    await ok('501 lb sculpture with a photo', order({ type: 'sculpture', framed: '', weight: '501', w: 20, h: 30, d: 20, photos: ['/uploads/x.png'] }, {}));
    await no('unknown weight without a photo', order({ type: 'sculpture', framed: '', weight: '', weightUnsure: true, w: 20, h: 30, d: 20 }, {}), /unknown weight/);
    await ok('unknown weight with a photo', order({ type: 'sculpture', framed: '', weight: '', weightUnsure: true, w: 20, h: 30, d: 20, photos: ['/uploads/x.png'] }, {}));
    // Floor as text.
    const bas = await ok('elevator, floor Basement', order({}, { accessMode: 'elevator', floor: 'Basement', elevatorStairs: 'no' }));
    if (bas.j.order && !A.summary(bas.j.order.dropoff).includes('Elevator, floor Basement')) errors.push('boundary: summary should read "Elevator, floor Basement"');
    // 4+ flights: whole number of 4 or more.
    const four = (stairs) => ({ accessMode: 'stairs', stairFlights: '4plus', stairs, stairDir: 'up' });
    const f4 = await ok('4 flights in the 4+ field', order({}, four('4')));
    if (f4.j.order && f4.j.order.dropoff.stairs !== 4) errors.push('boundary: 4 flights should be stored as 4');
    await no('3 in the 4+ field', order({}, four('3')), /number of flights \(4 or more\)/);
    await no('4.5 in the 4+ field', order({}, four('4.5')), /number of flights \(4 or more\)/);
    const q4 = await post('/api/quote', { service: 'pickup_delivery', items: heavyIt, pickup: { zip: '90069' }, dropoff: { zip: '90210', ...four('3') } });
    if ((q4.j.lines || []).some((l) => /^Stairs/.test(l.label))) errors.push('boundary: an invalid 4+ count must not be priced');
    // Every elevator stairs answer.
    const elev = (x) => ({ accessMode: 'elevator', floor: '30', ...x });
    await no('elevator with stairs unanswered', order({}, elev({})), /stairs on the way to the elevator/);
    await ok('elevator, stairs No', order({}, elev({ elevatorStairs: 'no' })));
    await ok('elevator, A few steps', order({}, elev({ elevatorStairs: 'steps' })));
    await no('elevator, Stairs without flights', order({}, elev({ elevatorStairs: 'stairs' })), /number of flights/);
    await ok('elevator, Stairs with 2 flights up', order({}, elev({ elevatorStairs: 'stairs', stairFlights: '2', stairDir: 'up' })));
    const ns = await ok('elevator, stairs Not sure', order({}, elev({ elevatorStairs: 'not_sure' })));
    if (ns.j.order && !ns.j.order.accessReview) errors.push('boundary: elevator stairs Not sure should set accessReview');
    if (ns.j.order && !(ns.j.order.quote.notes || []).includes(A.PRICE_NOTE)) errors.push('boundary: elevator stairs Not sure should show the access-to-be-confirmed price line');
    // Fit Not sure: review flag, photos optional, price line in the email.
    const fns2 = await ok('fit Not sure without photos', order({}, { fits: 'not_sure' }));
    if (fns2.j.order && !fns2.j.order.accessReview) errors.push('boundary: fit Not sure should set accessReview');
    if (fns2.j.id) {
      await post(`/api/orders/${fns2.j.id}/pay`, { method: 'card', card: '4242424242424242' });
      const m = text(mails(fns2.j.id, 'confirmation')[0] || '');
      if (!m.includes(A.PRICE_NOTE)) errors.push('boundary: confirmation email should carry the access-to-be-confirmed line');
      if (/final price/i.test(m)) errors.push('boundary: access-review email must not call the price final');
    }
    await no('tight fit without a photo', order({}, { fits: 'tight' }), /photos of the tight spot/);
    // ---- 9. Dot round 3: "Not sure" pays the base price now; wording on the confirmation email ----
    if (fns2.j.id) {
      const m = text(mails(fns2.j.id, 'confirmation')[0] || '');
      for (const want of [A.PRICE_NOTE, A.TBC_TOTAL, 'Paid today (base price)']) if (!m.includes(want)) errors.push(`round 3: access-review confirmation email must say "${want}"`);
      if (/paid in full/i.test(m) || / Total \$/.test(m) || /\bfinal\b/i.test(m)) errors.push('round 3: access-review email must not say paid in full, a bare Total, or final');
    }
    if (A.PRICE_NOTE !== 'Access isn’t confirmed yet. If it needs an added fee, we’ll go over it with you and get your OK before charging it.') errors.push('round 3: price note text changed: ' + A.PRICE_NOTE);
    const plain = await ok('normal branch order', order({}, {}));
    if (plain.j.id) {
      if (plain.j.order && plain.j.order.accessReview) errors.push('round 3: plain order must not be flagged for access review');
      await post(`/api/orders/${plain.j.id}/pay`, { method: 'card', card: '4242424242424242' });
      const m = text(mails(plain.j.id, 'confirmation')[0] || '');
      if (!/Paid in full at booking/.test(m) || !/ Total \$/.test(m)) errors.push('round 3: normal branch email must keep "Total" and "Paid in full at booking"');
      if (m.includes(A.PRICE_NOTE) || m.includes(A.TBC_TOTAL) || /base price/.test(m)) errors.push('round 3: normal branch email must not carry access-check wording');
    }
    // ---- 10. Dot round 3: "Same as me" contact uses the booker's own "I am a…" role ----
    const meBase = (dropoff, contact) => base({ items: [item({ description: tag() })], dropoff: addr({ contactName: 'Bea Buyer', contactPhone: '3105550100', contactRole: '', sameAsMe: true, ...dropoff }), contact: { name: 'Bea Buyer', email: 'buyer@example.com', phone: '3105550100', ...contact } });
    const same1 = await ok('Same as me with an "I am a…" role', post('/api/orders', meBase({}, { clientType: 'Gallery' })));
    if (same1.j.order && same1.j.order.dropoff.contactRole !== 'Gallery') errors.push('round 3: Same as me contact role should be the booker’s "I am a…" (Gallery), got ' + same1.j.order.dropoff.contactRole);
    const same2 = await ok('Same as me ignores a client-sent role', post('/api/orders', meBase({ contactRole: 'Homeowner' }, { clientType: 'Interior designer' })));
    if (same2.j.order && same2.j.order.dropoff.contactRole !== 'Interior designer') errors.push('round 3: Same as me must ignore a client-sent role, got ' + same2.j.order.dropoff.contactRole);
    await no('Same as me without an "I am a…" role (no silent default)', post('/api/orders', meBase({ contactRole: 'Homeowner' }, {})), /I am a/);
    await no('someone else without a role', order({}, { contactRole: '' }), /delivery contact role/);
    if (same1.j.id) { const m = text(mails(same1.j.id)[0] || ''); if (/Homeowner/.test(m)) errors.push('round 3: Same as me email must not show a default role'); }
    // ---- 11. Chad, Nov 16 2026: heavy (over 500 lb) and 72"+ pieces book and pay now; required protection; no tax ----
    const bookPay = async (name, it, dropoff = {}) => {
      const r = await ok(name, order(it, dropoff));
      if (!r.j.id) return null;
      if (r.j.status !== 'awaiting_payment' || r.j.quote.paymentPlan === 'quote') errors.push(`decision 2: ${name} must book for payment now, got ${r.j.status} / ${r.j.quote.paymentPlan}`);
      for (const n of r.j.quote.notes || []) if (/confirm|may apply|review|adjust|starting rate/i.test(n)) errors.push(`decision 2: ${name} note implies a later price review: ${n}`);
      const pay = await post(`/api/orders/${r.j.id}/pay`, { method: 'card', card: '4242424242424242' });
      if (pay.s !== 200) errors.push(`decision 2: ${name} payment should go through (got ${pay.s} ${pay.j.error || ''})`);
      return r;
    };
    const h600 = await bookPay('600 lb, 80" sculpture with a photo', { type: 'sculpture', weight: 600, w: 30, h: 80, d: 30, value: '20000', photos: ['/uploads/x.png'] });
    await no('600 lb sculpture without a photo', order({ type: 'sculpture', weight: 600, w: 30, h: 40, d: 30, value: '20000' }), /photos/);
    await bookPay('750 lb sculpture', { type: 'sculpture', weight: 750, w: 30, h: 40, d: 30, value: '20000', photos: ['/uploads/x.png'] });
    await bookPay('72" painting', { w: 72, h: 40, value: '20000' });
    await bookPay('80" sculpture up 2 flights (fit questions answered)', { type: 'sculpture', weight: 200, w: 20, h: 80, d: 20, value: '20000', fitsStairwell: true }, { accessMode: 'stairs', stairFlights: '2', stairDir: 'up', stairTurns: 'no', fits: 'yes' });
    await no('80" sculpture up stairs without the fit answers', order({ type: 'sculpture', weight: 200, w: 20, h: 80, d: 20, value: '20000' }, { accessMode: 'stairs', stairFlights: '2', stairDir: 'up', fits: '' }), /tight turns|fit/);
    if (h600 && h600.j.id) {
      const m = text(mails(h600.j.id, 'confirmation')[0] || '');
      if (!m.includes('Required declared value protection: $300 (1.5% of $20,000 in eligible pieces).')) errors.push('decision 1: confirmation email should carry the required protection line ($300 on $20,000)');
      if (/\btax/i.test(m) || /insur|optional/i.test(m)) errors.push('decisions 1/3: confirmation email must not mention tax, insured or optional');
      const qq = h600.j.quote;
      if (!qq.protection || qq.protection.amount !== 300 || qq.protection.eligibleValue !== 20000) errors.push('decision 1: order quote should record protection $300 on $20,000');
      if ((qq.lines || []).some((l) => /\btax/i.test(l.label))) errors.push('decision 3: no tax line');
    }
    // Dot, Nov 16 2026: protection is 1.5% of ELIGIBLE pieces only (each <= $50,000, times quantity), in the line and the email.
    const mix = await ok('mixed eligible and ineligible pieces', post('/api/orders', base({ items: [item({ description: tag(), qty: 2, value: '10000' }), item({ description: tag(), qty: 1, value: '60000' }), item({ description: tag(), qty: 3, value: '50000' })] })));
    if (mix.j.id) {
      const ql = mix.j.quote.lines || [];
      const dl = ql.find((l) => /^Required declared value protection: /.test(l.label));
      if (!dl || dl.label !== 'Required declared value protection: 1.5% of $170,000' || dl.amount !== 2550) errors.push('eligible-only protection: 2 × $10,000 + 3 × $50,000 = $170,000 → $2,550 (the $60,000 piece excluded): ' + JSON.stringify(dl));
      const hl = ql.find((l) => /^High-value handling/.test(l.label));
      if (!hl || hl.amount !== 900 || !/minimum 1\.5% of declared value/.test(hl.label)) errors.push('the $60,000 piece should pay high-value handling at the 1.5% minimum ($900): ' + JSON.stringify(hl));
      await post(`/api/orders/${mix.j.id}/pay`, { method: 'card', card: '4242424242424242' });
      const m = text(mails(mix.j.id, 'confirmation')[0] || '');
      if (!m.includes('Required declared value protection: $2,550 (1.5% of $170,000 in eligible pieces).')) errors.push('eligible-only protection: email line wrong: ' + (m.match(/Required declared value protection[^.]{0,120}\./) || [''])[0]);
      if (/\$230,000/.test(m)) errors.push('email must never show the total declared value incl. ineligible pieces as the protection base');
    }
  }
  return errors;
}

module.exports = { run };
if (require.main === module) {
  const errors = [];
  run(process.env.BASE_URL || 'http://localhost:3000', errors).then(() => { console.log(JSON.stringify({ errors }, null, 2)); if (errors.length) process.exit(1); })
    .catch((e) => { console.error(e); process.exit(1); });
}
