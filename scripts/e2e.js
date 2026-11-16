// End-to-end test + screenshots for the 4-step flow. Usage: npm run e2e (server must be running on :3000)
// E2E_BROWSER=webkit to run in WebKit (if host deps are installed); default Chromium with iPhone emulation.
const pw = require('playwright');
const path = require('path');
// API fixtures: fill the fields the server now requires (contact role at each stop, W×H×D) unless a test sets them.
const fillApi = (b) => {
  const o = JSON.parse(JSON.stringify(b));
  ['pickup', 'dropoff'].forEach((k) => { if (o[k] && o[k].street && o[k].contactRole === undefined) o[k].contactRole = 'Homeowner'; });
  (o.items || []).forEach((it) => { if (!['custom', 'furniture'].includes(it.type) && it.w === undefined && it.h === undefined && it.d === undefined) Object.assign(it, { w: 20, h: 20, d: 4 }); });
  return o;
};
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
// Orders, CSV and outbox live under STORAGE_DIR when the server was started with one (temporary test data).
const DATA_ROOT = process.env.STORAGE_DIR || ROOT;
// Admin needs the server's ADMIN_KEY (no default key exists any more).
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const SHOTS = path.join(ROOT, 'screenshots', 'v-next');
fs.mkdirSync(SHOTS, { recursive: true });
const engine = pw[process.env.E2E_BROWSER || 'chromium'];
const [VIEW_W, VIEW_H] = (process.env.E2E_VIEWPORT || '390x844').split('x').map((n) => parseInt(n, 10) || 0);

// Viewport screenshot = exactly what the phone shows (real header + docked bar). Full = whole page with the dock un-fixed.
const shot = async (page, name, { full = true, top = true } = {}) => {
  if (top) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(450); }
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  if (full) await page.screenshot({ path: path.join(SHOTS, name + '-full.png'), fullPage: true, style: '.dock{position:relative!important}.app{padding-bottom:24px!important}' });
};
const docShot = async (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
const fill = (page, p, v) => page.fill(`[data-path="${p}"]`, String(v));
const frame = async (page, i, framed, glazing) => {
  await page.click(`[data-seg="items.${i}.framed"] [data-v="${framed}"]`);
  await page.waitForTimeout(150);
  if (glazing) {
    const sel = `[data-seg="items.${i}.glazing"] [data-v="${glazing}"]`;
    if (await page.locator(sel).count()) { await page.click(sel); await page.waitForTimeout(150); }
  }
};
const isBlocked = async (page) => page.$eval('#nextBtn', (b) => !!(b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('is-wait')));
const next = async (page) => { await page.click('#nextBtn:not([disabled]):not([aria-disabled="true"])'); await page.waitForTimeout(450); };
const hasText = async (page, re) => re.test(await page.content());
const startFresh = async (page) => { await page.goto(BASE); await page.waitForLoadState('networkidle').catch(() => {}); await page.evaluate(() => sessionStorage.clear()); await page.goto(BASE); await page.waitForSelector('[data-service]'); };
const me = async (page, name, email, phone) => {
  await fill(page, 'contact.name', name); await fill(page, 'contact.email', email); await fill(page, 'contact.phone', phone);
  if (await page.$('[data-path="contact.clientType"]') && !(await page.inputValue('[data-path="contact.clientType"]'))) await page.selectOption('[data-path="contact.clientType"]', 'Collector');
  if (await page.$('[data-path="heard.source"]')) {
    const v = await page.inputValue('[data-path="heard.source"]');
    if (!v) await page.selectOption('[data-path="heard.source"]', 'google');
  }
};
// Access, asked like a phone call: How do we get in? → follow-ups → doorway / fit. fit: 'auto' answers Yes only when it is required.
const segClick = async (page, path, v) => { await page.click(`[data-seg="${path}"] button[data-v="${v}"]`); await page.waitForTimeout(150); };
const setAccess = async (page, key, acc = {}) => {
  const { mode = 'ground', flights, stairs, dir, turns, floor, service, dock, elevStairs, doorway, fit = 'auto' } = acc;
  if (!mode) return;
  await segClick(page, `${key}.accessMode`, mode);
  if (mode === 'elevator') {
    if (floor) await fill(page, `${key}.floor`, floor);
    if (service) await segClick(page, `${key}.serviceElevator`, service);
    if (elevStairs) await segClick(page, `${key}.elevatorStairs`, elevStairs);
  }
  if (mode === 'stairs' || elevStairs === 'stairs') {
    if (flights) await segClick(page, `${key}.stairFlights`, flights);
    if (stairs) await fill(page, `${key}.stairs`, stairs);
    if (dir) await segClick(page, `${key}.stairDir`, dir);
    if (turns) await segClick(page, `${key}.stairTurns`, turns);
  }
  if (dock) await segClick(page, `${key}.dock`, dock);
  if (doorway) await segClick(page, `${key}.doorway`, doorway);
  if (fit === 'auto') {
    const required = await page.$eval(`[data-seg="${key}.fits"]`, (el) => !!el.closest('.field').querySelector('.req')).catch(() => false);
    if (required) await segClick(page, `${key}.fits`, 'yes');
  } else if (fit) await segClick(page, `${key}.fits`, fit);
};
const fillSite = async (page, key, { street, city, zip, business, contactName, contactPhone, same, hours, notes, role, roleOther, installLocation, access }) => {
  await fill(page, `${key}.street`, street); await fill(page, `${key}.city`, city); await fill(page, `${key}.zip`, zip);
  if (business) await fill(page, `${key}.business`, business);
  if (same) { await page.click(`[data-same="${key}"]`); await page.waitForTimeout(200); }
  else {
    await fill(page, `${key}.contactName`, contactName); await fill(page, `${key}.contactPhone`, contactPhone);
    await page.selectOption(`[data-path="${key}.contactRole"]`, role || 'Homeowner');
    if ((role || 'Homeowner') === 'Other' && roleOther) await fill(page, `${key}.contactRoleOther`, roleOther);
  }
  // "Same as me": the role field is hidden; the booker's own "I am a…" is used (Dot round 3).
  if (same && await page.locator(`[data-path="${key}.contactRole"]`).isVisible().catch(() => false)) pickDayErrors.push(`${key}: role field must be hidden for Same as me`);
  await setAccess(page, key, access || {});
  if (hours) await fill(page, `${key}.hours`, hours);
  if (notes) await fill(page, `${key}.notes`, notes);
  if (await page.$(`[data-path="${key}.installLocation"]`)) await page.selectOption(`[data-path="${key}.installLocation"]`, installLocation || 'standard');
};
const pickDayErrors = [];
const pickDay = async (page, opts = {}) => {
  const delivery = (opts && typeof opts === 'object') ? opts.delivery : undefined;
  await page.waitForSelector('[data-reqblock="date"] .day:not(.rush)');
  { const reg = (await page.textContent('.region').catch(() => '')) || ''; if (/BayWest|EastBay|NapaWine|Coachella|SoCal|NorCal|·/.test(reg)) pickDayErrors.push('route line shows internal zone codes (P0-10): ' + reg.trim()); }
  await page.click('[data-reqblock="date"] .day:not(.rush)');
  await page.waitForTimeout(200);
  const del = page.locator('[data-deldate]');
  try { await del.first().waitFor({ timeout: 5000 }); } catch (e) {}
  if (await del.count()) {
    const pickup = await page.$eval('[data-reqblock="date"] .day.on', (el) => el.dataset.date);
    const dates = await page.$$eval('[data-deldate]', (els) => els.map((e) => e.dataset.deldate));
    let i = 0;
    if (delivery === 'later') {
      const later = dates.findIndex((d) => d > pickup);
      i = later >= 0 ? later : Math.max(0, dates.length - 1);
    } else if (typeof delivery === 'number') i = delivery;
    await page.click(`[data-deldate] >> nth=${i}`);
  }
  await page.waitForTimeout(250);
};
const laTrip = async (page, name, email) => {
  await me(page, name, email, '310-555-0100');
  await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', contactName: name, contactPhone: '310-555-0100' });
  await fillSite(page, 'dropoff', { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', zip: '90210', same: true });
  await next(page); await pickDay(page); await next(page); await page.waitForTimeout(500);
};
const readOrders = () => JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'data', 'orders.json'), 'utf8'));

(async () => {
  const browser = await engine.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: VIEW_W || 390, height: VIEW_H || 844 }, deviceScaleFactor: 2, isMobile: process.env.E2E_BROWSER !== 'firefox' && process.env.E2E_BROWSER !== 'webkit' ? true : undefined, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const expect = async (re, msg, neg = false) => { const ok = await hasText(page, re); if (neg ? ok : !ok) errors.push(msg); };
  const checkPricesNoWrap = async (label) => {
    const bad = await page.evaluate(() => [...document.querySelectorAll('.amt, .total > span:last-child, .est-total')].filter((el) => {
      const st = getComputedStyle(el);
      const text = (el.textContent || '').trim();
      if (!text) return false;
      // "Never wrap" means the amount stays on one line (e.g. "$1,722.50" must not split).
      // Dock totals may ellipsis at very narrow widths; that is overflow, not wrapping.
      const wraps = st.whiteSpace !== 'nowrap' && el.getClientRects().length > 1;
      const split = el.getClientRects().length > 1;
      return wraps || split;
    }).map((el) => (el.textContent || '').trim()));
    if (bad.length) errors.push((label || 'price') + ' wrapped at ' + (VIEW_W || 390) + 'px: ' + bad.join(' | '));
  };

  // ---- Order 1: Delivery + Install, paintings + sculpture, full payment by card ----
  await startFresh(page);
  await shot(page, '01-what-service');
  if (await page.locator('[data-path="items.0.description"]').count()) errors.push('item fields should appear only after a service is picked');
  const svcIds = await page.$$eval('[data-service]', (els) => els.map((e) => e.dataset.service));
  if (svcIds.join(',') !== 'pickup_delivery,delivery_install,install_only,crating_shipping') errors.push('services must be Pickup + Delivery / Pickup, Delivery + Install / Install only / Shipping, got ' + svcIds);
  await expect(/door[ -]to[ -]door/i, 'never say door to door', true);
  await expect(/White-glove pickup and delivery/, 'Pickup + Delivery card should use white-glove copy');
  await expect(/>Delivery<\/b>|>Pickup<\/b>/, 'delivery-only / pickup-only must not be offered', true);
  await expect(/Pickup, Delivery \+ Install/, 'missing Pickup, Delivery + Install');
  await page.click('[data-service="delivery_install"]'); await page.waitForTimeout(600);
  await expect(/Oil on canvas by J\. Smith/, 'painting description placeholder should be e.g. Oil on canvas by J. Smith');
  await fill(page, 'items.0.description', 'Oil on canvas by J. Smith');
  await fill(page, 'items.0.w', 48); await fill(page, 'items.0.h', 60); await fill(page, 'items.0.d', 3);
  if (!(await page.locator('[data-path="items.0.weight"], [data-weight="0"]').count())) errors.push('paintings should offer an optional weight field');
  if (await page.locator('[data-path="items.0.weight"][required], [data-weight="0"][required]').count()) errors.push('painting weight must be optional');
  await fill(page, 'items.0.value', 28000);
  if (await page.locator('[data-path="items.0.framedGlass"]').count()) errors.push('old Framed with glass toggle must be gone for paintings');
  if (!(await page.$('[data-seg="items.0.framed"]'))) errors.push('painting must ask Framed?');
  if (await page.$('[data-seg="items.0.framed"] button.on')) errors.push('Framed? must have no default');
  if (!(await isBlocked(page))) errors.push('Continue must be blocked until Framed? is answered');
  await frame(page, 0, 'yes');
  if (await page.$('[data-seg="items.0.glazing"]')) errors.push('Paintings must not ask Glass?');
  if (!(await page.$('[data-seg="items.0.frameType"]'))) errors.push('Framed painting over 48" must ask Frame type');
  if (!(await isBlocked(page))) errors.push('Continue must be blocked until Frame type is answered');
  await page.click('[data-seg="items.0.frameType"] [data-v="medium"]'); await page.waitForTimeout(150);
  if (await isBlocked(page)) errors.push('Continue should enable once Framed + Frame type are answered');
  await page.evaluate(() => { document.getElementById('dock').style.visibility = 'hidden'; });
  await page.locator('#app .card').first().screenshot({ path: path.join(SHOTS, 'piece1-painting-framed.png') });
  await page.evaluate(() => { document.getElementById('dock').style.visibility = ''; });
  await page.setInputFiles('[data-upload="0"]', path.join(__dirname, 'sample-artwork.png')); await page.waitForTimeout(700);
  await page.click('[data-dup="0"]'); await page.waitForTimeout(200);
  if ((await page.inputValue('[data-path="items.1.description"]')) !== 'Oil on canvas by J. Smith') errors.push('Duplicate item did not copy the piece');
  await page.click('[data-remove="1"]'); await page.waitForTimeout(200);
  await page.click('#addItem'); await page.waitForTimeout(200);
  await page.click('[data-itemtype="1"] button[data-v="sculpture"]'); await page.waitForTimeout(200);
  await fill(page, 'items.1.qty', 2); await fill(page, 'items.1.description', 'Bronze sculpture on plinth');
  await fill(page, 'items.1.w', 16); await fill(page, 'items.1.h', 52); await fill(page, 'items.1.d', 15); await fill(page, 'items.1.weight', 226); await fill(page, 'items.1.value', 30000);
  const chipOrder = await page.$$eval('[data-itemtype="0"] .chip', (els) => els.map((e) => e.textContent.trim()));
  if (chipOrder.join('|') !== 'Painting|Photograph|Mirror|Other wall art|Sculpture|Furniture|Décor|Other fragile or valuable item|Other request') errors.push('item type chips wrong: ' + chipOrder.join('|'));
  await expect(/Painting \/ fine art/, 'Painting / fine art chip must be gone', true);
  if (await page.$('[data-seg="items.1.framed"]')) errors.push('sculpture must not ask Framed?');
  await expect(/insurance/i, 'must never say insurance', true);
  await page.waitForTimeout(400);
  await shot(page, '01-what');
  await next(page);

  await me(page, 'Jordan Lee', 'jordan@example.com', '310-555-0199');
  await page.selectOption('[data-path="contact.clientType"]', 'Collector');
  await page.selectOption('[data-path="heard.source"]', 'referral'); await page.waitForTimeout(150);
  await page.selectOption('[data-path="heard.referrerKind"]', 'gallery'); await page.waitForTimeout(150);
  await fill(page, 'heard.businessName', 'Hamilton Selway Gallery');
  await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', business: 'Hamilton Selway Gallery', contactName: 'Andrea B.', contactPhone: '310-555-0101', role: 'Gallery staff', hours: 'Mon–Sat 10am–6pm', notes: 'Use the rear alley off Melrose. Ask for Andrea at the front desk.' });
  // Pickup: gallery on floor 2 with an elevator, a service elevator, a loading dock and a few steps to the elevator.
  await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', business: 'Hamilton Selway Gallery', contactName: 'Andrea B.', contactPhone: '310-555-0101', role: 'Gallery staff', hours: 'Mon–Sat 10am–6pm', notes: 'Use the rear alley off Melrose. Ask for Andrea at the front desk.', access: { mode: 'elevator', floor: '2', service: 'yes', dock: 'yes', elevStairs: 'steps', fit: 'not_sure' } });
  // Delivery: 2 flights up, no tight turns, double doors, fits easily. Pieces include a 226 lb sculpture, so turns + fit are required.
  await fillSite(page, 'dropoff', { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', zip: '90210', same: true, hours: 'After 10am. Gate closes at 7pm.', notes: 'Gate code 4411. Hang in living room, 57" on center.', access: { mode: 'stairs', flights: '2', dir: 'up', turns: 'no', doorway: 'double', fit: 'yes' } });
  if ((await page.inputValue('[data-path="dropoff.contactName"]')) !== 'Jordan Lee') errors.push('"Same as me" did not fill the on-site contact');
  {
    const reqOn = (sel) => page.$eval(sel, (el) => !!el.closest('.field').querySelector('.req')).catch(() => false);
    if (!(await reqOn('[data-seg="dropoff.stairTurns"]'))) errors.push('heavy piece (226 lb): tight-turns question must be required');
    if (!(await reqOn('[data-seg="dropoff.fits"]'))) errors.push('heavy piece (226 lb): fit question must be required');
  }
  if (await hasText(page, /COI required|coiRequired/)) errors.push('COI fields should not exist');
  if ((await page.locator('[data-seg="items.0.hangPick"] button').count()) !== 4) errors.push('install job should offer 4 hanging-height options per piece');
  await expect(/57–60" to center/, 'eye-level option should show 57–60 inches to center');
  await expect(/hanging height, COI|COI, anything/, 'special instructions must not mention COI', true);
  if (await page.locator('[data-path="dropoff.centerHeight"], [data-path="pickup.centerHeight"]').count()) errors.push('hanging height should be per piece, not on the address');
  if (await page.locator('[data-seg="items.1.hangPick"]').count()) errors.push('sculpture should not ask hanging height');
  await page.selectOption('[data-path="dropoff.wallType"]', 'Plaster');
  await page.click('[data-seg="dropoff.hardware"] button[data-v="CAD brings it"]'); await page.waitForTimeout(150);
  await page.click('label.toggle:has([data-path="pickup.parkingRestricted"])'); await page.waitForTimeout(200);
  await fill(page, 'pickup.parkingNote', 'Loading zone only 9–11am');
  await shot(page, '02-where');
  await next(page);

  await pickDay(page, { delivery: 'later' });
  await expect(/class="promise/, 'date step should show the promised pickup + delivery dates');
  await expect(/We pick up and deliver on the same route day/, 'same-route-day copy should be gone', true);
  await expect(/Deliver on a later date/, 'later-delivery toggle should be gone', true);
  await expect(/Morning \(8/, 'must not offer a morning / 8am arrival window', true);
  if (await page.locator('[data-path="schedule.deliveryLater"]').count()) errors.push('later-delivery toggle should be removed');
  if (!/Pickup .* · Delivery /.test(await page.textContent('.promise b'))) errors.push('later delivery: promise should show pickup + delivery dates');
  await shot(page, '03-when');
  await next(page); await page.waitForTimeout(500);
  await expect(/split 50\/50/i, 'review missing 50/50 split (install + access fees put this job over $3,000)');
  await expect(/Balance due/i, 'review missing balance due');
  await expect(/Pickup details/i, 'review missing pickup details card');
  await expect(/Delivery details/i, 'review missing delivery details card');
  await expect(/Andrea B/, 'review missing pickup on-site contact');
  await expect(/Loading dock/i, 'review missing loading dock');
  await expect(/2 flights of stairs up/i, 'review missing delivery stairs');
  await expect(/A few steps \(3 or fewer\) on the way/i, 'review missing pickup steps (with elevator)');
  await expect(/Elevator, floor 2/, 'review missing pickup elevator floor');
  await expect(/Double doors · Fits easily/, 'review missing delivery doorway + fit');
  await expect(/Ground level, no elevator/, 'review must never print Ground level, no elevator', true);
  await expect(/Gate code 4411/, 'review missing delivery notes');
  await expect(/booked as soon as payment goes through/i, 'review missing booked-on-payment copy');
  await expect(/No approval step/i, 'review must not say No approval step (audit P0-5)', true);
  await expect(/Apple Pay/, 'review missing Apple Pay');
  await expect(/Google Pay/, 'review missing Google Pay');
  await expect(/Bank \(ACH\)/, 'review missing ACH option');
  await expect(/Save this payment method/i, 'review missing save-method option');
  await expect(/one tap/i, 'save option must not promise one-tap rebooking (audit P0-12)', true);
  await expect(/Declared value protection/i, 'review missing protection choice');
  await expect(/change or cancel/i, 'review missing cancellation note');
  await expect(/Bill my account/i, 'Bill my account must not appear', true);
  const promise = await page.textContent('.promise b');
  if (!/Pickup [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+ · Delivery /.test(promise)) errors.push('review promise should show pickup + delivery, got: ' + promise);
  await expect(/Plaster/, 'review missing wall type');
  await expect(/Standard eye level \(59" center\)/, 'review missing default 59" center height');
  await expect(/Loading zone only/, 'review missing parking restriction');
  if (!/^Pay 50% of base price \$\d{1,3}(,\d{3})+(\.\d{2})?$/.test(await page.textContent('#nextBtn'))) errors.push('review button (Not sure, 50/50) should be "Pay 50% of base price $…", got ' + (await page.textContent('#nextBtn')));
  // Order 1 has pickup fit = Not sure (access review) on a 50/50 job: base-price wording (Dot round 3).
  { const pc = (await page.textContent('.price-card').catch(() => '')) || '';
    for (const w of ['Estimated total (before access check)', 'Due today (base price)', '(before access check)', 'Access isn’t confirmed yet.']) if (!pc.includes(w)) errors.push('access review 50/50: price card missing "' + w + '"');
    if (/paid in full|final/i.test(pc)) errors.push('access review 50/50: price card must not say paid in full / final'); }
  await expect(/Jordan Lee · [^<]*· Collector/, 'review: Same as me contact should use the booker’s own role (Collector)');
  if (await page.evaluate(() => payload().dropoff.contactRole)) errors.push('Same as me must not send a contact role from the browser');
  await checkPricesNoWrap('order 1 review');
  await shot(page, '04-review-pay');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(700);
  await expect(/You’re booked for [A-Z][a-z]+day, [A-Z][a-z]+ \d+\./, 'confirmation should say "You’re booked for [date]."');
  await expect(/Delivery: [A-Z][a-z]+day/, 'confirmation should show the later delivery date');
  await expect(/is confirmed/i, 'standard order did not auto-confirm');
  await expect(/Quote request received/i, 'standard order should not go to Samantha', true);
  await shot(page, '05-confirmation');
  const id1 = (await page.textContent('.done b')).trim();

  // ---- Order 2: Pickup + Delivery, cross-region, $3,000+ → 50/50, protection on, ACH ----
  await page.click('#newOrder'); await page.waitForSelector('[data-service]');
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="sculpture"]'); await page.waitForTimeout(150);
  await fill(page, 'items.0.qty', 3); await fill(page, 'items.0.description', 'Bronze sculpture + marble pedestal'); await fill(page, 'items.0.w', 24); await fill(page, 'items.0.h', 80); await fill(page, 'items.0.d', 24); await fill(page, 'items.0.weight', 226); await fill(page, 'items.0.value', 45000);
  await next(page);
  await me(page, 'Cyd G.', 'cyd@example.com', '805-555-0144');
  await page.selectOption('[data-path="contact.clientType"]', 'Interior designer');
  await fillSite(page, 'pickup', { street: '1153 Camino Dos Rios', city: 'Thousand Oaks', zip: '91360', same: true });
  await fillSite(page, 'dropoff', { street: '850 Sanitarium Rd', city: 'Deer Park', zip: '94576', same: true, access: { mode: 'elevator', floor: '3', elevStairs: 'no' } });
  await next(page); await pickDay(page);
  await expect(/different regions, so delivery is usually 1–2 weeks later/, 'cross-region job should explain the later delivery day');
  if (await page.locator('[data-path="schedule.deliveryLater"]').count()) errors.push('later-delivery toggle should be gone on cross-region jobs');
  if (!(await page.locator('[data-deldate]').count())) errors.push('cross-region job should still let the customer pick a delivery date');
  await next(page); await page.waitForTimeout(500);
  await expect(/data-path="declaredValueProtection"/, 'in-CA jobs must not offer an optional protection toggle', true);
  await expect(/Declared value protection \(1\.5%\) on \$135,000/, 'mandatory protection line missing (pieces at $50K or less)');
  await expect(/split 50\/50/i, 'over-$3k review missing 50/50 split');
  await expect(/Balance due at pickup/i, 'over-$3k review missing balance due at pickup');
  // Normal branch (no access review) keeps the regular price labels (Dot round 3).
  { const pc = (await page.textContent('.price-card').catch(() => '')) || ''; const lbl = (await page.textContent('#estLabel')) || '';
    if (/before access check|base price|Access isn’t confirmed/.test(pc)) errors.push('normal branch: price card must not show access-check labels: ' + pc.slice(0, 200));
    if (!/Total/.test(pc) || !/Due today/.test(pc)) errors.push('normal branch: price card should keep "Total" and "Due today"');
    if (/access to confirm/.test(lbl)) errors.push('normal branch: dock must not say access to confirm: ' + lbl);
    if (/base price/.test((await page.textContent('#nextBtn')) || '')) errors.push('normal branch: Pay button must not mention base price'); }
  await page.click('[data-pay-method] button[data-v="ach"]'); await page.waitForTimeout(200);
  await expect(/ACH processing/, 'ACH copy should mention “ACH processing”');
  await shot(page, '06-review-split-ach');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(600);
  await expect(/ACH processing/, 'ACH confirmation should show “ACH processing”');
  await expect(/is confirmed/i, 'ACH job must confirm immediately');
  await shot(page, '07-confirmation-ach');
  const id2 = (await page.textContent('.done b')).trim();
  const o2 = readOrders().find((o) => o.id === id2);
  if (!o2 || o2.pickup.contactRole !== 'Interior designer' || o2.dropoff.contactRole !== 'Interior designer') errors.push('Same as me stops should be saved with the booker’s "I am a…" role (Interior designer): ' + (o2 && [o2.pickup.contactRole, o2.dropoff.contactRole]));
  if (!o2 || o2.status !== 'confirmed') errors.push('ACH order should be confirmed on submit');
  if (!o2 || o2.payment.status !== 'ach_processing') errors.push('ACH payment status should be ach_processing, got ' + (o2 && o2.payment.status));
  if (!o2 || !o2.declaredValueProtection) errors.push('mandatory protection not recorded on order 2');

  // ---- Order 3: rush / dedicated quote request ----
  await page.click('#newOrder'); await page.waitForSelector('[data-service]');
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="wallart"]'); await page.waitForTimeout(200);
  await expect(/Mixed media, wall sculpture, etc\./, 'Other wall art helper text missing');
  await fill(page, 'items.0.description', 'Photograph, rushed for an opening'); await fill(page, 'items.0.w', 30); await fill(page, 'items.0.h', 40); await fill(page, 'items.0.d', 2); await frame(page, 0, 'yes', 'no');
  if (!(await isBlocked(page))) errors.push('declared value should be required for in-CA pieces');
  await fill(page, 'items.0.value', 120000); await page.press('[data-path="items.0.value"]', 'Tab'); await page.waitForTimeout(300);
  await expect(/high-value handling applies/, 'item over $50K should explain high-value handling');
  await next(page);
  await me(page, 'Priya Shah', 'priya@example.com', '310-555-0177');
  await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', same: true });
  await fillSite(page, 'dropoff', { street: '456 N Rodeo Dr', city: 'Beverly Hills', zip: '90210', same: true });
  await next(page); await page.waitForSelector('[data-reqblock="date"] .day');
  const rush = page.locator('[data-reqblock="date"] .day.rush, .days .day.rush'); const isRush = !!(await rush.count());
  if (isRush) await rush.first().click();
  else { await page.click('label.toggle:has([data-path="dedicated"])'); await page.waitForTimeout(200); await page.click('[data-reqblock="date"] .day:not(.rush)'); }
  await page.waitForSelector('[data-deldate]'); await page.click('[data-deldate]'); await page.waitForTimeout(300);
  await shot(page, '08-when-rush');
  await next(page); await page.waitForTimeout(500);
  await expect(/High-value handling \+200%/, 'review should show the per-item high-value line');
  await expect(/own fine art insurance/, 'review should tell high-value clients to use their own fine art insurance');
  await expect(/Declared value protection \(1\.5%\) on/, 'no protection line on a piece over $50K', true);
  await expect(/Estimated range/i, 'rush review missing estimated range');
  await expect(/1\.5×|Quoted range/, 'rush review must not show the multiplier (audit P1-6)', true);
  await expect(/no payment due yet/i, 'rush review missing no-payment copy');
  await expect(/data-wallet/, 'rush review must not show payment buttons', true);
  const btn3 = (await page.textContent('#nextBtn')).trim();
  if (btn3 !== (isRush ? 'Request a rush quote' : 'Request a quote')) errors.push('quote button text wrong: ' + btn3);
  await shot(page, '09-review-rush-quote');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(500);
  await expect(/Quote request received/i, 'rush confirmation missing quote-request heading');
  await shot(page, '10-quote-received');
  const id3 = (await page.textContent('.done b')).trim();

  // ---- Order 4: furniture-only over $1,000 → extra 10% off (stop at review) ----
  await startFresh(page);
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="furniture"]');
  await page.waitForSelector('[data-path="items.0.furnitureKind"]');
  await page.selectOption('[data-path="items.0.furnitureKind"]', 'Sofa');
  await page.selectOption('[data-path="items.0.sizeClass"]', 'large');
  await fill(page, 'items.0.qty', 3); await fill(page, 'items.0.description', 'Three large sofas from the showroom'); await fill(page, 'items.0.value', 1000);
  await next(page); await laTrip(page, 'Alex Ruiz', 'alex@example.com');
  await expect(/Furniture (&amp;|&) décor orders of \$1,000\+ \(additional 10% off\)/i, 'furniture-only $1,000+ missing 10% line');
  await expect(/\$1,650/, 'furniture-only missing pre-discount $1,650');
  await expect(/-\$165|−\$165|\$-165/, 'furniture-only missing the $165 discount', false);
  await expect(/\$1,530/, 'furniture-only total should be $1,485 after discount + $45 protection = $1,530');
  await shot(page, '11-review-furniture-discount', { full: true });

  // ---- Order 5: paintings over $1,000 → no furniture discount; member 25% off check ----
  await startFresh(page);
  await page.click('[data-service="delivery_install"]'); await page.waitForTimeout(300);
  await fill(page, 'items.0.qty', 8); await fill(page, 'items.0.description', 'A group of works on canvas'); await fill(page, 'items.0.w', 24); await fill(page, 'items.0.h', 30); await fill(page, 'items.0.d', 2); await fill(page, 'items.0.value', 1000); await frame(page, 0, 'no');
  await next(page); await laTrip(page, 'Morgan Chen', 'morgan@example.com');
  await expect(/additional 10% off/i, 'paintings review shows 10% off line', true);
  await expect(/\$1,195/, 'paintings review should total $1,075 + $120 protection = $1,195');
  await page.click('[data-goto="1"]'); await page.waitForTimeout(300);
  await expect(/Not a member\? CAD Membership is \$200\/month/, 'membership pitch missing (member toggle off)');
  await page.click('label.toggle:has([data-path="member"])'); await page.waitForTimeout(200);
  await expect(/Not a member\? CAD Membership/, 'membership pitch must hide once they say they are a member (audit P1-13)', true);
  if (!(await isBlocked(page))) errors.push('member toggle without a code should require the member code');
  await fill(page, 'memberCode', 'WRONG'); await page.waitForTimeout(700);
  await expect(/couldn’t find that member code|couldn't find that member code/, 'invalid member code should show a friendly error');
  if (!(await isBlocked(page))) errors.push('invalid member code should keep Continue waiting');
  await fill(page, 'memberCode', 'palomas'); await page.waitForTimeout(800);
  await expect(/Paloma's Home Furnishings|Paloma’s Home Furnishings/, 'verified company should be shown');
  if (await isBlocked(page)) errors.push('valid member code should allow Continue');
  await next(page); await next(page); await page.waitForTimeout(600);
  await expect(/Member rate \(25% off\) applied/, 'member rate note missing');
  await expect(/\(member\)/, 'member pricing lines missing');
  const memberTotal = Number((await page.textContent('[data-price] .total span:last-child')).replace(/\D/g, ''));
  if (!(memberTotal > 0 && memberTotal < 1195)) errors.push('member total should be below the $1,195 non-member total, got ' + memberTotal);

  // ---- Order 6: Apple Pay (mock) ----
  await page.click('[data-wallet="apple_pay"]'); await page.waitForSelector('.check'); await page.waitForTimeout(500);
  await expect(/Apple Pay/, 'Apple Pay confirmation missing');
  const id6 = (await page.textContent('.done b')).trim();
  const o6 = readOrders().find((o) => o.id === id6);
  if (!o6 || !o6.member || o6.memberCode !== 'PALOMAS' || o6.memberCompany !== "Paloma's Home Furnishings" || o6.quote.total !== memberTotal) errors.push('server price must honor member pricing (UI ' + memberTotal + ', server ' + (o6 && o6.member) + ' ' + (o6 && o6.memberCompany) + ' ' + (o6 && o6.quote && o6.quote.total) + ')');
  await shot(page, '12-confirmation-apple-pay', { full: false });

  // ---- Order 7: Install only (no pickup address, no furniture type) ----
  await startFresh(page);
  await page.click('[data-service="install_only"]'); await page.waitForTimeout(300);
  if (await page.locator('[data-itemtype="0"] button[data-v="furniture"]').count()) errors.push('install-only should not offer furniture');
  await expect(/Need custom crating/, 'crating question must be gone', true);
  await fill(page, 'items.0.description', 'Large abstract on canvas'); await fill(page, 'items.0.w', 40); await fill(page, 'items.0.h', 50); await fill(page, 'items.0.d', 2); await frame(page, 0, 'no'); await fill(page, 'items.0.value', 8000);
  await next(page);
  if (await page.locator('[data-path="pickup.street"]').count()) errors.push('install-only must not ask a pickup address');
  await me(page, 'Sam Ortiz', 'sam@example.com', '310-555-0123');
  await fillSite(page, 'dropoff', { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', zip: '90210', same: true });
  await shot(page, '16-where-install-only');
  await next(page); await pickDay(page);
  if (await page.locator('[data-path="schedule.deliveryLater"], [data-deldate]').count()) errors.push('install-only should not show a separate delivery date or later-delivery toggle');
  await expect(/Choose your <b>PICKUP<\/b> date|Choose your PICKUP date/, 'install-only should not use the two-date pickup/delivery split', true);
  await next(page); await page.waitForTimeout(500);
  await expect(/Painting installation × 1/, 'install-only painting should price installation');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  await expect(/You’re booked for/, 'install-only should book instantly');

  // Custom crating question removed (Chad): the shipping partner decides packing.

  const IMG = path.join(__dirname, 'sample-artwork.png');
  const toggleOn = (p) => page.click(`label.toggle:has([data-path="${p}"])`);
  const nextDisabled = async () => isBlocked(page);

  // ---- Order 9: Shipping, international destination, technical carry photos ----
  await startFresh(page);
  await page.click('[data-service="crating_shipping"]'); await page.waitForTimeout(300);
  await expect(/Out-of-state shipping by air or ground/, 'shipping card subtitle missing');
  await expect(/If pickup and delivery are both in California, choose Pickup \+ Delivery above/, 'shipping card should send in-state jobs to Pickup + Delivery');
  await expect(/Custom quote/, 'shipping card should say Custom quote');
  await fill(page, 'items.0.description', 'Large abstract, oil on linen'); await frame(page, 0, 'no');
  await fill(page, 'items.0.w', 60); await fill(page, 'items.0.h', 48); await fill(page, 'items.0.d', 3); await fill(page, 'items.0.weight', 35); await fill(page, 'items.0.value', 20000);
  if (await page.$('[data-seg="items.0.crateStatus"]')) errors.push('shipping must not ask about packing or crating');
  await expect(/Need custom crating\?/, 'shipping should not show the generic crating toggle', true);
  await shot(page, '20-shipping-what');
  await next(page);
  await me(page, 'Claire Dubois', 'claire@example.com', '310-555-0144');
  await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', contactName: 'Gallery desk', contactPhone: '310-555-0101' });
  await toggleOn('pickup.technicalCarry'); await page.waitForTimeout(300);
  await expect(/Photos of the route \(stairs, stairwell, narrow halls or path\)/, 'technical carry should ask for photos of the route');
  await expect(/Photos required: show the carry path/, 'route photos must not be required', true);
  await fill(page, 'dropoff.country', 'France'); await page.press('[data-path="dropoff.country"]', 'Tab'); await page.waitForTimeout(400);
  if (!(await page.$('textarea[data-path="dropoff.street"]'))) errors.push('international destination should use a free-form address');
  await fill(page, 'dropoff.street', '12 Rue de Rivoli, 75004'); await fill(page, 'dropoff.city', 'Paris');
  await fill(page, 'dropoff.contactName', 'Claire Dubois'); await fill(page, 'dropoff.contactPhone', '+33 6 12 34 56 78');
  await page.selectOption('[data-path="dropoff.contactRole"]', 'Homeowner');
  await page.click('[data-seg="dropoff.locationType"] [data-v="residential"]'); await page.waitForTimeout(200);
  await setAccess(page, 'dropoff', { mode: 'ground' });
  await fill(page, 'shipping.customs.name', 'Paris Fine Art Customs'); await fill(page, 'shipping.customs.phone', '+33 1 00 00 00 00');
  if (await nextDisabled()) errors.push('technical carry without path photos must not block Continue');
  await shot(page, '21-shipping-where');
  await next(page);
  await expect(/Shipping details/, 'shipping step 3 should be Shipping details');
  await page.click('[data-level="inside"]'); await page.waitForTimeout(200);
  await fill(page, 'shipping.shipBy', '2026-12-10');
  await shot(page, '22-shipping-details');
  await next(page);
  await expect(/Review your shipping request/, 'shipping review heading');
  await expect(/data-wallet/, 'shipping must not show payment buttons', true);
  {
    const shipBtn = (await page.textContent('#nextBtn')).trim();
    const shipOk = shipBtn === 'Request quote';
    if (!shipOk) errors.push('shipping button should read Request quote, got: ' + shipBtn);
  }
  if (process.env.DBG) { console.log(await page.evaluate(() => document.querySelector('#app').innerText.slice(-900))); console.log(await page.evaluate(() => sessionStorage.getItem('cad-order').slice(0, 600))); }
  await expect(/Fully insured through our shipping partners/, 'shipping review should say fully insured through shipping partners');
  await expect(/data-path="declaredValueProtection"|High-value handling/, 'shipping must not offer protection or high-value markup', true);
  await shot(page, '23-shipping-review');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  await expect(/Shipping quote request received/, 'shipping should end at Shipping quote request received');
  await shot(page, '24-shipping-done', { full: false });
  const shipOrder = readOrders()[0];
  if (shipOrder.service !== 'crating_shipping' || shipOrder.status !== 'pending_approval' || shipOrder.schedule.date) errors.push('shipping order should be a pending crating_shipping quote with no route date');
  if (shipOrder.dropoff.country !== 'France' || shipOrder.shipping.serviceLevel !== 'inside' || shipOrder.declaredValueProtection || Number(shipOrder.items[0].value) !== 20000) errors.push('shipping order: country / service level / crating / value wrong, or protection set');
  const shipMail = fs.readdirSync(path.join(DATA_ROOT, 'outbox')).find((x) => x.startsWith(shipOrder.id) && x.includes('quote_received'));
  const shipHtml = shipMail ? fs.readFileSync(path.join(DATA_ROOT, 'outbox', shipMail), 'utf8') : '';
  if (!/Shipping request received/.test(shipHtml) || !/France/.test(shipHtml) || !/Inside delivery/.test(shipHtml)) errors.push('shipping quote email should be labeled shipping and list destination + service level');

  // ---- Order 10: Pickup + Delivery to Nevada → automatically a Shipping quote; special handling does not require photos ----
  await startFresh(page);
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="decor"]'); await page.waitForTimeout(200);
  if (await page.$('[data-seg="items.0.framed"]')) errors.push('décor must not ask Framed?');
  await fill(page, 'items.0.description', 'Blown-glass vessel'); await fill(page, 'items.0.w', 12); await fill(page, 'items.0.h', 18); await fill(page, 'items.0.d', 12); await fill(page, 'items.0.value', 2500);
  if (!(await page.$('[data-path="items.0.weight"]')) && !(await page.$('[data-weight="0"]'))) errors.push('décor should offer an optional weight field');
  await toggleOn('items.0.fragile'); await page.waitForTimeout(300);
  await expect(/Special handling needed/, 'should rename the toggle to Special handling needed');
  await expect(/Standard paintings, framed art and solid bronze sculpture don't need this/, 'should show the short special-handling guidance');
  await expect(/Photo required for special handling/, 'special handling must require a photo');
  if (!(await nextDisabled())) errors.push('special handling without photos must block Continue');
  await page.setInputFiles('[data-upload="0"]', require('path').join(__dirname, 'sample-artwork.png')); await page.waitForTimeout(1500);
  await next(page);
  await me(page, 'Sam Reyes', 'sam@example.com', '310-555-0177');
  await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', contactName: 'Sam Reyes', contactPhone: '310-555-0177' });
  await fillSite(page, 'dropoff', { street: '3600 Las Vegas Blvd S', city: 'Las Vegas', zip: '89109', contactName: 'Front desk', contactPhone: '702-555-0100' });
  await fill(page, 'dropoff.state', 'NV'); await page.press('[data-path="dropoff.state"]', 'Tab'); await page.waitForTimeout(400);
  await expect(/outside California are custom quoted as Shipping/, 'out-of-state job should explain the custom quote');
  await expect(/Within California we always provide white-glove delivery/, 'shipping copy should say California jobs are always white-glove');
  await shot(page, '25-out-of-state-where');
  await next(page);
  await expect(/Shipping details/, 'out-of-state job should go to Shipping details');
  await fill(page, 'items.0.w', 14); await fill(page, 'items.0.h', 22); await fill(page, 'items.0.weight', 12);
  await page.click('[data-level="unpack"]'); await page.waitForTimeout(200);
  await toggleOn('shipping.flexible'); await page.waitForTimeout(300);
  await next(page);
  await expect(/data-wallet/, 'out-of-state job must not show payment buttons', true);
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  const oos = readOrders()[0];
  if (oos.service !== 'crating_shipping' || !oos.outOfState || oos.requestedService !== 'pickup_delivery' || oos.status !== 'pending_approval') errors.push('Nevada delivery should become a pending Shipping quote: ' + JSON.stringify({ s: oos.service, o: oos.outOfState, r: oos.requestedService, st: oos.status }));

  // ---- Access: one cohesive question, no contradictions, photos only when triggered ----
  await startFresh(page);
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await fill(page, 'items.0.description', 'Small landscape'); await fill(page, 'items.0.w', 24); await fill(page, 'items.0.h', 30); await fill(page, 'items.0.d', 2); await frame(page, 0, 'no'); await fill(page, 'items.0.value', 1000);
  await next(page);
  await me(page, 'Dana Wu', 'dana@example.com', '415-555-0188');
  await fillSite(page, 'pickup', { street: '1 Market St', city: 'San Francisco', zip: '94105', same: true, access: { mode: null } });
  await fillSite(page, 'dropoff', { street: '100 Ocean Ave', city: 'Carmel-by-the-Sea', zip: '93921', same: true, access: { mode: null } });
  {
    const count = (sel) => page.locator(sel).count();
    const accState = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('cad-order')));
    if (await count('[data-seg="pickup.accessMode"] button.on')) errors.push('access: How do we get in? must have no default');
    for (const old of ['pickup.elevator', 'pickup.loadingDock']) if (await count(`[data-path="${old}"]`)) errors.push('access: old independent toggle still shown: ' + old);
    if (await count('[data-stairs]')) errors.push('access: old Stairs or steps chips still shown');
    if (await count('[data-path="pickup.floor"]')) errors.push('access: Floor must not show before the customer picks Elevator');
    if (!(await isBlocked(page))) errors.push('access: Continue must be blocked until How do we get in? is answered');
    await expect(/Ground level, no elevator/, 'access: never print Ground level, no elevator', true);
    { const txt = await page.evaluate(() => document.querySelector('#app').innerText); const bad = txt.match(/\bCOI\b|\bcrating\b|\bhoist\w*|\bmoving\b/i); if (bad) errors.push('access: banned word on the Where step: ' + bad[0]); }
    // Ground level, straight in, easy fit: no photos, no floor, no stairs questions.
    await setAccess(page, 'dropoff', { mode: 'ground', doorway: 'double', fit: 'yes' });
    await setAccess(page, 'pickup', { mode: 'ground', fit: null });
    if (await count('[data-path="pickup.floor"], [data-path="dropoff.floor"]')) errors.push('access: Floor must not show for ground level');
    if (await count('[data-seg="pickup.stairFlights"], [data-seg="dropoff.stairFlights"]')) errors.push('access: flights must only show for Stairs');
    if (await count('[data-accessupload]')) errors.push('access: ground level with an easy fit must not ask for photos');
    if (await isBlocked(page)) errors.push('access: ground level + easy fit (small piece) should allow Continue without photos or a fit answer at pickup');
    // Elevator: Floor appears and is required; switching away clears it (no Floor 30 with no elevator).
    await segClick(page, 'pickup.accessMode', 'elevator');
    if (!(await count('[data-path="pickup.floor"]'))) errors.push('access: Floor must show for Elevator');
    if (!(await count('[data-seg="pickup.serviceElevator"]')) || !(await count('[data-seg="pickup.dock"]'))) errors.push('access: Elevator should ask Service elevator and Loading dock');
    if (!(await isBlocked(page))) errors.push('access: Elevator without a floor must block Continue');
    await fill(page, 'pickup.floor', '30');
    if (!(await isBlocked(page))) errors.push('access: Elevator without an answer to Any stairs on the way? must block Continue (required)');
    await expect(/Count steps before or after the elevator\./, 'access: elevator stairs helper text');
    await segClick(page, 'pickup.elevatorStairs', 'no');
    if (await isBlocked(page)) errors.push('access: Elevator, floor 30, no stairs should allow Continue');
    // Dot review fixes: labels as questions, stairs on the way to the elevator, Not sure, dock + fit helper everywhere.
    { const t = await page.evaluate(() => document.querySelector('#app').innerText);
      for (const l of ['Service elevator available? (optional)', 'Any stairs on the way?', 'Loading dock available? (optional)', 'Doors (optional)', 'Think doors, halls, turns, stairs and the elevator.']) if (!t.includes(l)) errors.push('access copy missing: ' + l);
      for (const l of ['Doorway (optional)', 'Any steps on the way to the elevator?']) if (t.includes(l)) errors.push('access copy still shows: ' + l); }
    await segClick(page, 'pickup.elevatorStairs', 'stairs');
    if (!(await count('[data-seg="pickup.stairFlights"]')) || !(await count('[data-seg="pickup.stairDir"]')) || !(await count('[data-seg="pickup.stairTurns"]'))) errors.push('access: Elevator + Stairs should reuse flights / up-or-down / tight turns');
    if (!(await isBlocked(page))) errors.push('access: Elevator + Stairs without flights must block Continue');
    await segClick(page, 'pickup.stairFlights', '2'); await segClick(page, 'pickup.stairDir', 'up');
    if (await isBlocked(page)) errors.push('access: Elevator + 2 flights up should allow Continue');
    { const st = await accState(); if (st.pickup.stairKind !== 'flights' || Number(st.pickup.stairs) !== 2 || !st.pickup.elevator) errors.push('access: Elevator + 2 flights should map to elevator + 2 flights'); }
    await segClick(page, 'pickup.elevatorStairs', 'no');
    if (await count('[data-seg="pickup.stairFlights"]')) errors.push('access: flights must hide when there are no stairs on the way');
    await segClick(page, 'pickup.accessMode', 'not_sure');
    if (await count('[data-path="pickup.floor"]')) errors.push('access: Floor must hide for Not sure');
    if (await isBlocked(page)) errors.push('access: Not sure must not block Continue');
    await expect(/We’ll confirm access with you before the job\./, 'access: Not sure must say We’ll confirm access with you before the job.');
    { const st = await accState(); if (!st.pickup.accessReview) errors.push('access: Not sure should set accessReview'); }
    if (!(await count('[data-seg="pickup.dock"]'))) errors.push('access: Loading dock should show for every mode (Not sure)');
    await segClick(page, 'pickup.fits', 'not_sure');
    await expect(/Photos help if you have them\./, 'access: Not sure fit line');
    if (!(await count('[data-path="pickup.narrowestIn"]'))) errors.push('access: Narrowest opening should show for a not-sure fit');
    await expect(/send them later/, 'access: never say send later on the access fit photos', true);
    await segClick(page, 'pickup.accessMode', 'steps');
    if (await count('[data-path="pickup.floor"]')) errors.push('access: Floor must hide for A few steps');
    { const st = await accState(); if (st.pickup.floor || st.pickup.elevator || st.pickup.stairKind !== 'steps') errors.push('access: switching to A few steps must clear floor/elevator: ' + JSON.stringify({ f: st.pickup.floor, e: st.pickup.elevator, k: st.pickup.stairKind })); }
    // Stairs: flights + direction required; tight turns → photos required.
    await segClick(page, 'pickup.accessMode', 'stairs');
    if (await count('[data-path="pickup.floor"]')) errors.push('access: Floor must not show for Stairs (flights cover it)');
    if (!(await isBlocked(page))) errors.push('access: Stairs without flights / direction must block Continue');
    await segClick(page, 'pickup.stairFlights', '1'); await segClick(page, 'pickup.stairDir', 'down');
    if (await isBlocked(page)) errors.push('access: small piece, 1 flight down, turns unanswered should allow Continue (turns optional)');
    await segClick(page, 'pickup.stairTurns', 'yes');
    if (!(await count('[data-accessupload="pickup.stairPhotos"]'))) errors.push('access: tight turns must ask for photos of the stairs');
    if (!(await isBlocked(page))) errors.push('access: tight turns without photos must block Continue');
    await page.setInputFiles('[data-accessupload="pickup.stairPhotos"]', IMG); await page.waitForTimeout(1200);
    if (await isBlocked(page)) errors.push('access: tight turns with photos should allow Continue');
    await segClick(page, 'pickup.stairTurns', 'not_sure');
    if (await isBlocked(page)) errors.push('access: Not sure keeps the stair photos and stays unblocked');
    // Tight fit at the door → photo required.
    await segClick(page, 'dropoff.fits', 'tight');
    if (!(await isBlocked(page))) errors.push('access: Tight fit without a doorway photo must block Continue');
    await page.setInputFiles('[data-accessupload="dropoff.doorPhotos"]', IMG); await page.waitForTimeout(1200);
    if (await isBlocked(page)) errors.push('access: Tight fit with a doorway photo should allow Continue');
    const st = await accState();
    if (st.pickup.stairKind !== 'flights' || Number(st.pickup.stairs) !== 1 || st.pickup.elevator) errors.push('access: Stairs 1 flight should map to stairKind flights / stairs 1: ' + JSON.stringify({ k: st.pickup.stairKind, s: st.pickup.stairs }));
    if (st.dropoff.stairKind !== 'none' || st.dropoff.elevator || st.dropoff.floor) errors.push('access: Ground level should map to stairKind none with no elevator / floor');
    await shot(page, '27-where-access');
    await next(page); await pickDay(page); await next(page); await page.waitForTimeout(500);
    await expect(/1 flight of stairs down · Not sure about tight turns on the stairs · 1 photo of the stairs/, 'review: pickup stairs in plain words');
    // Fit = Not sure at pickup: the access-to-be-confirmed line sits next to the price, and nothing calls the price final.
    await expect(/Access isn’t confirmed yet\. If it needs an added fee, we’ll go over it with you and get your OK before charging it\./, 'review: access-review price line missing');
    { const pc = (await page.textContent('.price-card').catch(() => '')) || '';
      if (!pc.includes('Estimated total (before access check)')) errors.push('review: access review total must read "Estimated total (before access check)"');
      if (!/Due today \(base price\)/.test(pc)) errors.push('review: access review must read "Due today (base price)"');
      if (/paid in full/i.test(pc) || /(^|[^d ])Total\$/.test(pc)) errors.push('review: access review must not say paid in full or a bare Total: ' + pc.slice(0, 300)); }
    if (!(await page.locator('.price-card [data-access-tbc]').count())) errors.push('review: access-review line must be inside the price card');
    { const pc = (await page.textContent('.price-card').catch(() => '')) || ''; if (/final/i.test(pc)) errors.push('review: price card must not call the price final when access is to be confirmed'); }
    { const lbl = (await page.textContent('#estLabel')) || ''; if (lbl.trim() !== 'Estimate · access to confirm') errors.push('dock label with access review must stay "Estimate · access to confirm": ' + lbl); }
    await expect(/Ground level, straight in \(no stairs\) · Double doors · Tight fit · 1 photo of the tight spot and the way in/, 'review: delivery access in plain words');
    await expect(/Ground level, no elevator/, 'review must never print Ground level, no elevator', true);
    await expect(/Stairs — Piece 1/, 'small painting (no weight, under 72") should have no stairs fee', true);
  }

  // ---- Access rules via API: required answers + photos, and stair fees unchanged vs the old fields ----
  {
    const postA = async (body) => fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fillApi(body)) });
    const quoteA = async (body) => (await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
    const site = (extra) => ({ street: '2 B St', city: 'Los Angeles', zip: '90210', contactName: 'T', contactPhone: '1', ...extra });
    const base = { service: 'pickup_delivery', contact: { name: 'T', email: 't@x.com', phone: '3105550100' }, pickup: site({ street: '1 A St', zip: '90069', accessMode: 'ground' }), schedule: { date: '2026-12-07', deliveryDate: '2026-12-07', timePref: 'none' } };
    const small = [{ qty: 1, type: 'painting', framed: 'no', w: 24, h: 30, d: 2, value: 1000, description: 'small' }];
    const heavy = [{ qty: 1, type: 'sculpture', weight: 226, w: 16, h: 52, d: 15, value: 5000, description: 'bronze', photos: ['/uploads/x.png'] }];
    const errOf = async (r) => (r.status === 400 ? (await r.json()).error : '');
    const e1 = await errOf(await postA({ ...base, items: small, dropoff: site({}) }));
    if (!/delivery access \(how do we get in\?\)/.test(e1)) errors.push('API: missing access mode should be rejected: ' + e1);
    const e2 = await errOf(await postA({ ...base, items: small, dropoff: site({ accessMode: 'ground' }) }));
    if (e2) errors.push('API: ground level, small piece, no fit answer should be accepted: ' + e2);
    const e3 = await errOf(await postA({ ...base, items: heavy, dropoff: site({ accessMode: 'stairs', stairFlights: '1', stairDir: 'up' }) }));
    if (!/tight turns on the stairs/.test(e3) || !/will everything fit easily/.test(e3)) errors.push('API: heavy piece on stairs must require tight turns + fit: ' + e3);
    const e4 = await errOf(await postA({ ...base, items: heavy, dropoff: site({ accessMode: 'stairs', stairFlights: '1', stairDir: 'up', stairTurns: 'yes', fits: 'yes' }) }));
    if (!/photos of the stairs and path/.test(e4)) errors.push('API: tight turns without photos must be rejected: ' + e4);
    const e5 = await errOf(await postA({ ...base, items: heavy, dropoff: site({ accessMode: 'stairs', stairFlights: '1', stairDir: 'up', stairTurns: 'yes', stairPhotos: ['/uploads/s.png'], fits: 'tight' }) }));
    if (!/photos of the tight spot/.test(e5) || /photos of the stairs/.test(e5)) errors.push('API: tight fit without a doorway photo must be rejected (stairs photos present): ' + e5);
    const e6 = await errOf(await postA({ ...base, items: small, dropoff: site({ accessMode: 'elevator' }) }));
    if (!/delivery elevator floor/.test(e6)) errors.push('API: elevator without a floor must be rejected: ' + e6);
    const e7 = await errOf(await postA({ ...base, items: small, dropoff: site({ accessMode: 'stairs', stairFlights: '4plus', stairDir: 'down' }) }));
    if (!/number of flights \(4 or more\)/.test(e7)) errors.push('API: 4+ flights without a number must be rejected: ' + e7);
    const e8 = await errOf(await postA({ service: 'install_only', contact: base.contact, items: [{ qty: 1, type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 1000, description: 'p' }], dropoff: site({}), schedule: { date: '2026-12-07', timePref: 'none' } }));
    if (!/install access \(how do we get in\?\)/.test(e8)) errors.push('API: install-only location must require access: ' + e8);
    // Fee parity: the same scenario priced from the old fields and from the new answers.
    const stairLines = (q) => JSON.stringify(q.lines.filter((l) => /Stairs|Technical carry/.test(l.label)));
    const scenarios = [
      ['2 flights', { stairKind: 'flights', stairs: 2 }, { accessMode: 'stairs', stairFlights: '2', stairDir: 'up', stairTurns: 'no', fits: 'yes' }, 300],
      ['half flight', { stairKind: 'half', stairs: 0.5 }, { accessMode: 'stairs', stairFlights: 'half', stairDir: 'down', stairTurns: 'no', fits: 'yes' }, 75],
      ['5 flights', { stairKind: 'flights', stairs: 5 }, { accessMode: 'stairs', stairFlights: '4plus', stairs: 5, stairDir: 'up', stairTurns: 'no', fits: 'yes' }, 750],
      ['3 steps', { stairKind: 'steps', steps: true }, { accessMode: 'steps', fits: 'yes' }, 0],
      ['elevator + steps', { elevator: true, floor: '9', stairKind: 'steps', steps: true }, { accessMode: 'elevator', floor: '9', elevatorSteps: 'steps', fits: 'yes' }, 0],
      ['ground + technical carry', { stairKind: 'none', technicalCarry: true }, { accessMode: 'ground', technicalCarry: true, fits: 'yes' }, 150],
    ];
    for (const [name, oldA, newA, fee] of scenarios) {
      const body = (a) => ({ service: 'pickup_delivery', items: heavy, pickup: { zip: '90069' }, dropoff: { zip: '90210', ...a } });
      const qOld = await quoteA(body(oldA)); const qNew = await quoteA(body(newA));
      const feeNew = qNew.lines.filter((l) => /Stairs|Technical carry/.test(l.label)).reduce((t, l) => t + l.amount, 0);
      if (stairLines(qOld) !== stairLines(qNew) || qOld.total !== qNew.total) errors.push(`fee parity (${name}): old ${stairLines(qOld)} ${qOld.total} vs new ${stairLines(qNew)} ${qNew.total}`);
      if (feeNew !== fee) errors.push(`fee parity (${name}): expected $${fee} access fee, got $${feeNew}`);
    }
  }

  // ---- Photo rules via API ----
  const post = async (body) => fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fillApi(body)) });
  const baseOrder = { service: 'pickup_delivery', contact: { name: 'T', email: 't@x.com', phone: '3105550100' }, pickup: { street: '1 A St', city: 'Los Angeles', zip: '90069', contactName: 'T', contactPhone: '1', accessMode: 'ground', fits: 'yes' }, dropoff: { street: '2 B St', city: 'Los Angeles', zip: '90210', contactName: 'T', contactPhone: '1', accessMode: 'ground', fits: 'yes' }, schedule: { date: '2026-12-07', deliveryDate: '2026-12-07', timePref: 'none' } };
  const mid = await post({ ...baseOrder, items: [{ qty: 1, type: 'sculpture', weight: 350, value: 2000, description: 'Granite' }] });
  if (mid.status === 400) errors.push('350 lb piece without photos should be accepted (threshold is over 500 lb)');
  const heavy = await post({ ...baseOrder, items: [{ qty: 1, type: 'sculpture', weight: 501, value: 2000, description: 'Granite' }] });
  if (heavy.status !== 400) errors.push('piece over 500 lb without photos should be rejected');
  const other = await post({ ...baseOrder, items: [{ qty: 1, type: 'other', weight: 40, value: 1000, description: 'Antique clock' }] });
  if (other.status !== 400) errors.push('Other-type piece without photos should be rejected');
  const handling = await post({ ...baseOrder, items: [{ qty: 1, type: 'decor', furnitureKind: 'Wall Decor', sizeClass: 'medium', fragile: true, value: 1000, description: 'Glass bowl' }] });
  if (handling.status !== 400) errors.push('special handling without photos should be rejected');
  const qOOS = await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...baseOrder, dropoff: { ...baseOrder.dropoff, zip: '85004', city: 'Phoenix' }, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }] }) })).json();
  if (qOOS.paymentPlan !== 'quote' || !qOOS.outOfState) errors.push('Arizona ZIP should make the quote an out-of-state shipping quote');

  const cfgText = await (await fetch(BASE + '/api/config')).text();
  if (/JONES-TERWILLIGER|PALOMAS/.test(cfgText)) errors.push('config must not expose member codes');
  const qMem = async (body) => (await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  const sculp = { service: 'pickup_delivery', items: [{ qty: 1, type: 'sculpture', weight: 120, description: 'Bronze' }] };
  const qOpen = await qMem({ ...sculp, member: true });
  if (qOpen.member || qOpen.total !== 400) errors.push('member toggle without a valid code must not get the discount, got ' + JSON.stringify({ m: qOpen.member, t: qOpen.total }));
  const qBad = await qMem({ ...sculp, member: true, memberCode: 'NOPE' });
  if (qBad.member || qBad.total !== 400) errors.push('invalid member code must not get the discount');
  const qYes = await qMem({ ...sculp, memberCode: 'jones-terwilliger' });
  if (!qYes.member || qYes.total !== 300 || qYes.memberCompany !== 'Jones & Terwilliger') errors.push('valid member code should apply 25% off and record the company: ' + JSON.stringify({ m: qYes.member, t: qYes.total, c: qYes.memberCompany }));
  const chk = await (await fetch(BASE + '/api/member-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ' palomas ' }) })).json();
  if (!chk.valid || chk.company !== "Paloma's Home Furnishings" || chk.code !== 'PALOMAS') errors.push('member-code endpoint should be case-insensitive and trimmed');

  // ---- Declared value / high-value boundaries via API (120 lb sculpture = $400 normal price) ----
  const qAPI = async (body) => (await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  const hv = async (value) => qAPI({ service: 'pickup_delivery', items: [{ qty: 1, type: 'sculpture', weight: 120, value, description: 'S' }], pickup: { zip: '90069' }, dropoff: { zip: '90210' } });
  for (const [v, pct, total] of [[50000, 0, 1150], [50001, 100, 800], [100001, 200, 1200], [300001, 300, 1600], [500001, 400, 2000], [750001, 500, 2400], [1000001, 600, 2800]]) {
    const r = await hv(v);
    const hl = r.lines.find((l) => /High-value handling/.test(l.label));
    const dvp = r.lines.find((l) => /Declared value protection/.test(l.label));
    if (pct === 0 && (hl || !dvp || dvp.amount !== 750)) errors.push(`$${v}: should get mandatory 1.5% protection ($750), no markup: ` + JSON.stringify(r.lines));
    if (pct && (dvp || !hl || !hl.label.includes(`+${pct}%`) || hl.amount !== 400 * pct / 100)) errors.push(`$${v}: should be High-value handling +${pct}% ($${400 * pct / 100}) and no protection: ` + JSON.stringify(r.lines));
    if (r.total !== total) errors.push(`$${v}: total should be $${total}, got ${r.total}`);
    if (pct && !r.notes.some((n) => /own fine art insurance/.test(n))) errors.push(`$${v}: missing own-insurance note`);
  }
  const shipHV = await qAPI({ service: 'crating_shipping', items: [{ qty: 1, type: 'painting', value: 900000, description: 'x' }] });
  if (shipHV.lines.some((l) => /High-value|Declared value protection/.test(l.label)) || !shipHV.notes.some((n) => /Fully insured through our shipping partners/.test(n))) errors.push('shipping quotes: no protection/markup, and say fully insured through shipping partners');
  const noVal = await post({ ...baseOrder, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'No value' }] });
  if (noVal.status !== 400) errors.push('in-CA order without a declared value should be rejected');

  // ---- Item types + framing via API ----
  const qAPI2 = async (body) => (await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  const qw = await qAPI2({ service: 'delivery_install', items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }, { qty: 1, type: 'mirror', description: 'm' }, { qty: 1, type: 'wallart', framed: 'yes', glazing: 'no', description: 'wall sculpture' }] });
  if (!qw.lines.some((l) => /Wall art delivery .* × 3/.test(l.label) && l.amount === 375) || !qw.lines.some((l) => /Hanging .* × 3/.test(l.label) && l.amount === 200)) errors.push('mirror + other wall art should price from the painting tables (3 → $375 delivery, $200 hanging): ' + JSON.stringify(qw.lines));
  const qc = await qAPI2({ service: 'pickup_delivery', items: [{ qty: 1, type: 'custom', description: 'Hold 3 crates in storage' }] });
  if (qc.paymentPlan !== 'quote' || !/Other request/.test(qc.extraQuoted || '')) errors.push('Other request should route to a custom quote');
  const noFrame = await post({ ...baseOrder, items: [{ qty: 1, type: 'painting', value: 1000, description: 'x' }] });
  if (noFrame.status !== 400) errors.push('painting without Framed? should be rejected');
  const noGlaze = await post({ ...baseOrder, items: [{ qty: 1, type: 'wallart', framed: 'yes', value: 1000, description: 'x' }] });
  if (noGlaze.status !== 400) errors.push('framed wall art without Glass? should be rejected');
  const paintNoGlass = await post({ ...baseOrder, items: [{ qty: 1, type: 'painting', framed: 'yes', value: 1000, description: 'x' }] });
  if (paintNoGlass.status === 400) errors.push('framed painting must not require Glass?');
  const photoNoGlass = await post({ ...baseOrder, items: [{ qty: 1, type: 'photograph', framed: 'yes', value: 1000, description: 'x' }] });
  if (photoNoGlass.status !== 400) errors.push('framed photograph without Glass? should be rejected');
  const noFT = await post({ ...baseOrder, items: [{ qty: 1, type: 'painting', framed: 'yes', w: 50, h: 40, value: 1000, description: 'x' }] });
  if (noFT.status !== 400) errors.push('framed wall piece over 48" without Frame type should be rejected');

  // ---- Pricing rules via API: sculpture is placed (never hung), décor/other from real cards ----
  const q = async (body) => (await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  const qs1 = await q({ service: 'delivery_install', items: [{ qty: 1, type: 'sculpture', weight: 120, description: 'Bronze' }] });
  if (qs1.lines.some((l) => /install|hang/i.test(l.label))) errors.push('sculpture must never carry an install/hanging charge: ' + JSON.stringify(qs1.lines));
  if (qs1.lines.length !== 1 || qs1.lines[0].label.indexOf('Sculpture: pickup, delivery & placement (120 lb)') !== 0) errors.push('sculpture should be one line "Sculpture: pickup, delivery & placement (120 lb)": ' + JSON.stringify(qs1.lines));
  const qs1b = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'sculpture', weight: 120, description: 'Bronze' }] });
  if (qs1b.total !== 400 || qs1b.lines.length !== 1 || !/^Sculpture: pickup, delivery & placement \(120 lb\)/.test(qs1b.lines[0].label)) errors.push('Pickup + Delivery sculpture should be the same single $400 line: ' + JSON.stringify(qs1b.lines));
  if (qs1.total !== 400) errors.push('120 lb sculpture should be $400 (100–149 lb tier), got ' + qs1.total);
  const qs2 = await q({ service: 'delivery_install', items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }, { qty: 1, type: 'mirror', description: 'm' }, { qty: 1, type: 'sculpture', weight: 40, description: 's' }] });
  const hang = qs2.lines.find((l) => /Hanging/.test(l.label));
  if (!hang || !/× 2/.test(hang.label) || hang.amount !== 150) errors.push('hanging should count painting + mirror only (2 → $150): ' + JSON.stringify(qs2.lines));
  const qs3 = await q({ service: 'delivery_install', items: [{ qty: 1, type: 'decor', furnitureKind: 'Chandelier', sizeClass: 'medium', description: 'c' }] });
  if (qs3.paymentPlan !== 'quote') errors.push('chandelier hanging is not on the cards and should be a quote request');
  const qs4 = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Floor Lamp', sizeClass: 'large', description: 'l' }] });
  if (qs4.total !== 240) errors.push('large floor lamp should be $240 from the décor card, got ' + qs4.total);
  const cfg = JSON.parse(cfgText);
  const expectedDecor = ['Wall Decor', 'Wall sculptures', 'Tapestries & textiles', 'Mirror', 'Table Lamp', 'Floor Lamp', 'Sconces', 'Chandelier', 'Baskets', 'Bookends', 'Bowls & trays', 'Candle holders & candelabras', 'Ceramics & pottery', 'Clocks', 'Decorative boxes', 'Figurines', 'Globes', 'Lanterns', "Objets d'art", 'Picture frames (tabletop)', 'Planters & pots', 'Sculptural Décor', 'Statues & busts', 'Urns', 'Vases', 'Other (describe)'];
  const gotDecor = cfg.pricing.decorKinds || [];
  if (expectedDecor.some((k) => !gotDecor.includes(k))) errors.push('décor kinds missing from /api/config: ' + JSON.stringify(gotDecor));
  if ((cfg.pricing.furnitureKinds || []).includes('Mirror')) errors.push('Mirror should not be in the furniture dropdown');
  const qFigXs = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Figurines', sizeClass: 'xs', description: 'f' }] });
  if (qFigXs.total !== 85) errors.push('extra-small figurines should be $85, got ' + qFigXs.total);
  const qFigXl = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Figurines', sizeClass: 'xl', description: 'f' }] });
  if (qFigXl.total !== 305) errors.push('extra-large figurines should be $305, got ' + qFigXl.total);
  const qVaseM = await q({ service: 'pickup_delivery', memberCode: 'jones-terwilliger', items: [{ qty: 1, type: 'decor', furnitureKind: 'Vases', sizeClass: 'medium', description: 'v' }] });
  if (qVaseM.total !== 145) errors.push('member medium vases should be $145, got ' + qVaseM.total);
  const qOther = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Other (describe)', sizeClass: 'medium', description: 'Garden stool' }] });
  if (qOther.total !== 195) errors.push('medium Other (describe) should be $195, got ' + qOther.total);
  const qLegacy = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Vases / Sculptural Décor / Accents / Figurines', sizeClass: 'small', description: 'legacy' }] });
  if (qLegacy.total !== 85) errors.push('legacy lumped accents + small should stay $85, got ' + qLegacy.total);
  const qMir = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', description: 'm' }] });
  if (qMir.total !== 200) errors.push('Décor Mirror should use painting delivery ($200 for 1), got ' + qMir.total);
  const qMirMem = await q({ service: 'pickup_delivery', memberCode: 'jones-terwilliger', items: [{ qty: 1, type: 'decor', furnitureKind: 'Mirror', sizeClass: 'medium', description: 'm' }] });
  if (qMirMem.total !== 150) errors.push('member Décor Mirror should use member painting delivery ($150), got ' + qMirMem.total);
  const qMir40 = await q({ service: 'install_only', items: [{ qty: 1, type: 'mirror', w: 40, h: 40, description: 'm' }] });
  if (qMir40.total !== 75) errors.push('40×40 mirror install should equal the painting rate $75, got ' + qMir40.total);
  const qMir60 = await q({ service: 'install_only', items: [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }] });
  if (qMir60.total !== 115) errors.push('60×40 mirror install should be 1.5× $75 rounded to $115, got ' + qMir60.total);
  const qMir60di = await q({ service: 'delivery_install', items: [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }] });
  if (qMir60di.total !== 415) errors.push('60×40 mirror delivery+install should be $415 ($300 transport + $115 install), got ' + qMir60di.total);
  const qMirPD = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'mirror', w: 60, h: 40, description: 'm' }] });
  if (qMirPD.total !== 300) errors.push('60×40 mirror pickup+delivery should be $300 (1.5× $200, 60" inclusive), got ' + qMirPD.total);
  const qMir59pd = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'mirror', w: 59, h: 40, description: 'm' }] });
  if (qMir59pd.total !== 200) errors.push('59×40 mirror pickup+delivery should stay $200 (under 60"), got ' + qMir59pd.total);
  const qMir61 = await q({ service: 'install_only', items: [{ qty: 1, type: 'mirror', w: 61, h: 40, description: 'm' }] });
  if (qMir61.total !== 190) errors.push('61×40 mirror install should be 2.5× $75 rounded up to $190, got ' + qMir61.total);
  const qMir70pd = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'mirror', w: 70, h: 40, description: 'm' }] });
  if (qMir70pd.total !== 300) errors.push('70×40 mirror pickup+delivery should stay $300 (1.5×, 70 is not over 70), got ' + qMir70pd.total);
  const qMir70di = await q({ service: 'delivery_install', items: [{ qty: 1, type: 'mirror', w: 70, h: 40, description: 'm' }] });
  if (qMir70di.total !== 490) errors.push('70×40 mirror delivery+install should be $490 ($300 + $190), got ' + qMir70di.total);
  const qMir71 = await q({ service: 'install_only', items: [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }] });
  if (qMir71.total !== 225) errors.push('71×40 mirror install should be 3× $75 = $225, got ' + qMir71.total);
  const qMir71pd = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'mirror', w: 71, h: 40, description: 'm' }] });
  if (qMir71pd.total !== 400) errors.push('71×40 mirror pickup+delivery should be $400 (2× $200), got ' + qMir71pd.total);
  const qMir80pd = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'mirror', w: 80, h: 40, description: 'm' }] });
  if (qMir80pd.total !== 600) errors.push('80×40 mirror pickup+delivery should be $600 (2× ($200 + $100 oversize)), got ' + qMir80pd.total);
  const qWall = await q({ service: 'pickup_delivery', memberCode: 'jones-terwilliger', items: [{ qty: 1, type: 'decor', furnitureKind: 'Wall Decor', sizeClass: 'small', description: 'w' }] });
  if (qWall.total !== 145) errors.push('member small Wall Decor should be $145 as printed, got ' + qWall.total);
  if ((cfg.pricing.decorKinds || []).includes('Accents')) errors.push('generic Accents should not stay in the décor dropdown');
  const qSconce = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Sconces', sizeClass: 'large', description: 's' }] });
  if (qSconce.total !== 200) errors.push('large sconces should use the table lamp rate $200, got ' + qSconce.total);
  const qSconceMem = await q({ service: 'pickup_delivery', memberCode: 'jones-terwilliger', items: [{ qty: 1, type: 'decor', furnitureKind: 'Sconces', sizeClass: 'medium', description: 's' }] });
  if (qSconceMem.total !== 130) errors.push('member medium sconces should be $130, got ' + qSconceMem.total);
  const qTap = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Tapestries & textiles', sizeClass: 'medium', description: 't' }] });
  if (qTap.total !== 235) errors.push('medium tapestries should use the wall décor rate $235, got ' + qTap.total);
  const qScu = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Wall sculptures', sizeClass: 'large', description: 'ws' }] });
  if (qScu.total !== 305) errors.push('large wall sculptures should use the wall décor rate $305, got ' + qScu.total);
  const qBasket = await q({ service: 'pickup_delivery', items: [{ qty: 1, type: 'decor', furnitureKind: 'Baskets', sizeClass: 'xs', description: 'b' }] });
  if (qBasket.total !== 85) errors.push('extra-small baskets should be $85, got ' + qBasket.total);
  const qSconceHang = await q({ service: 'delivery_install', items: [{ qty: 1, type: 'decor', furnitureKind: 'Sconces', sizeClass: 'medium', description: 's' }] });
  if (qSconceHang.paymentPlan !== 'quote') errors.push('sconce hanging is not on the cards and should be a quote request');

  // ---- Access fees, install surcharges, availability, payer ----
  const qFee = async (body) => (await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  const stairsJob = (item, stairs, extra = {}) => qFee({ service: 'pickup_delivery', items: [item], pickup: { zip: '90069', stairKind: 'flights', stairs, ...extra }, dropoff: { zip: '90210' } });
  const s50 = await stairsJob({ qty: 1, type: 'sculpture', weight: 60, description: 's' }, 1);
  if (!s50.lines.some((l) => /Stairs/.test(l.label) && l.amount === 50)) errors.push('>50 lb 1 flight should be $50: ' + JSON.stringify(s50.lines));
  const s75 = await stairsJob({ qty: 1, type: 'sculpture', weight: 100, description: 's' }, 1);
  if (!s75.lines.some((l) => /Stairs/.test(l.label) && l.amount === 75)) errors.push('100 lb 1 flight should be $75: ' + JSON.stringify(s75.lines));
  const s150 = await stairsJob({ qty: 1, type: 'sculpture', weight: 200, description: 's' }, 1);
  if (!s150.lines.some((l) => /Stairs/.test(l.label) && l.amount === 150)) errors.push('200 lb 1 flight should be $150');
  const s200 = await stairsJob({ qty: 1, type: 'sculpture', weight: 400, description: 's' }, 1);
  if (!s200.lines.some((l) => /Stairs/.test(l.label) && l.amount === 200)) errors.push('400 lb 1 flight should be $200');
  const s0 = await stairsJob({ qty: 1, type: 'painting', framed: 'no', w: 40, h: 40, weight: 40, description: 'p' }, 1);
  if (s0.lines.some((l) => /Stairs/.test(l.label) && l.amount)) errors.push('painting under 72" and ≤50 lb should have $0 stairs');
  const size50 = await stairsJob({ qty: 1, type: 'painting', framed: 'no', w: 72, h: 40, weight: 20, description: 'p' }, 1);
  if (!size50.lines.some((l) => /Stairs/.test(l.label) && l.amount === 50)) errors.push('72–80" 1 flight should be $50 size rate');
  const size100 = await stairsJob({ qty: 1, type: 'painting', framed: 'no', w: 81, h: 40, weight: 20, description: 'p' }, 1);
  if (!size100.lines.some((l) => /Stairs/.test(l.label) && l.amount === 100)) errors.push('>80" 1 flight should be $100 size rate');
  const half = await qFee({ service: 'pickup_delivery', items: [{ qty: 1, type: 'sculpture', weight: 100, description: 's' }], pickup: { zip: '90069', stairKind: 'half', stairs: 0.5 }, dropoff: { zip: '90210' } });
  if (!half.lines.some((l) => /Stairs/.test(l.label) && l.amount === 37.5)) errors.push('half flight of $75 should be $37.50: ' + JSON.stringify(half.lines));

  const inst = await qFee({ service: 'delivery_install', items: [{ qty: 1, type: 'photograph', framed: 'yes', glazing: 'yes', frameType: 'large', w: 80, h: 40, description: 'Print', hangHeight: 'higher', hangWhere: 'stairwell' }], pickup: { zip: '90069' }, dropoff: { zip: '90210' } });
  if (!inst.lines.some((l) => /Frame handling — Piece 1 \(large\/heavy, over 72/.test(l.label) && l.amount === 150)) errors.push('frame handling over 72" large should be $150: ' + JSON.stringify(inst.lines));
  if (!inst.lines.some((l) => /Stairwell install — Piece 1/.test(l.label) && l.amount === 150)) errors.push('stairwell install should be $150');
  if (!inst.lines.some((l) => /pickup & delivery/.test(l.label) && /frame/i.test(l.label) && l.amount === 25)) errors.push('large frame pickup & delivery $25 should still apply on install jobs');
  const mantel = await qFee({ service: 'delivery_install', items: [{ qty: 1, type: 'painting', framed: 'yes', frameType: 'medium', w: 60, h: 40, description: 'p', hangHeight: 'higher', hangWhere: 'mantel' }], pickup: { zip: '90069' }, dropoff: { zip: '90210' } });
  if (!mantel.lines.some((l) => /Frame handling — Piece 1 \(medium, over 48/.test(l.label) && l.amount === 50)) errors.push('medium frame >48 up to 72 should be $50');
  if (!mantel.lines.some((l) => /mantel/i.test(l.label) && l.amount === 50)) errors.push('mantel install ≤72 should be $50: ' + JSON.stringify(mantel.lines));
  const noInstFees = await qFee({ service: 'pickup_delivery', items: [{ qty: 1, type: 'photograph', framed: 'yes', glazing: 'yes', frameType: 'large', w: 80, h: 40, description: 'Print', hangHeight: 'higher', hangWhere: 'stairwell' }], pickup: { zip: '90069' }, dropoff: { zip: '90210' } });
  if (noInstFees.lines.some((l) => /Frame handling|Stairwell install|mantel|High-wall/i.test(l.label))) errors.push('install surcharges must not apply on pickup + delivery: ' + JSON.stringify(noInstFees.lines));

  const availPU = await (await fetch(BASE + '/api/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'pickup_delivery', pickup: { zip: '90069', city: 'West Hollywood' }, dropoff: { zip: '90210', city: 'Beverly Hills' }, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }] }) })).json();
  const puDay = availPU.days && availPU.days[0] && availPU.days[0].date;
  const availDE = await (await fetch(BASE + '/api/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'pickup_delivery', leg: 'dropoff', pickup: { zip: '90069', city: 'West Hollywood' }, dropoff: { zip: '90210', city: 'Beverly Hills' }, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }], schedule: { date: puDay } }) })).json();
  if (!puDay || !availDE.days.some((d) => d.date === puDay)) errors.push('same-day delivery should be offered when both addresses are on the same route');
  if (!availPU.days.some((d) => d.routeType === 'through' || d.routeType === 'downAndBack')) errors.push('availability days should include a routeType');

  const missingPayer = await post({ ...baseOrder, items: [{ qty: 1, type: 'painting', framed: 'no', value: 1000, description: 'x' }], payer: 'other', payerOther: { name: 'Pat', email: 'pat@example.com' } });
  if (missingPayer.status !== 400) errors.push('someone-else payer without a phone should be rejected');
  const okPayer = await post({ ...baseOrder, items: [{ qty: 1, type: 'painting', framed: 'no', value: 1000, description: 'x' }], payer: 'other', payerOther: { name: 'Pat Lee', email: 'pat@example.com', phone: '6504604296' } });
  if (okPayer.status === 400) errors.push('someone-else payer with name, email and phone should be accepted: ' + await okPayer.text());

  // ---- Décor → Mirror routes to the same Mirror item (UI) ----
  await startFresh(page);
  await page.click('[data-service="install_only"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="decor"]'); await page.waitForTimeout(250);
  if (!(await page.$('[data-path="items.0.furnitureKind"]'))) errors.push('Décor should show Type of décor');
  const decorHasMirror = await page.$eval('[data-path="items.0.furnitureKind"]', (el) => [...el.options].some((o) => o.value === 'Mirror'));
  if (!decorHasMirror) errors.push('Type of décor should still list Mirror as an option');
  await page.selectOption('[data-path="items.0.furnitureKind"]', 'Mirror'); await page.waitForTimeout(400);
  const mirrorOn = await page.$eval('[data-itemtype="0"] button[data-v="mirror"]', (el) => el.classList.contains('on')).catch(() => false);
  if (!mirrorOn) errors.push('choosing Mirror under Décor should switch the item type to Mirror');
  if (await page.$('[data-path="items.0.furnitureKind"]')) errors.push('after routing, Type of décor should be replaced by Mirror fields');
  if (await page.$('[data-seg="items.0.framed"]')) errors.push('routed Mirror must not ask Framed?');
  await expect(/Glass is assumed for mirrors/, 'mirror helper line was removed (audit P2-24)', true);
  await fill(page, 'items.0.description', 'Venetian mirror');
  await fill(page, 'items.0.w', 60); await fill(page, 'items.0.h', 40); await fill(page, 'items.0.d', 3); await fill(page, 'items.0.value', 4000);
  await next(page);
  await me(page, 'Rita Cole', 'rita@example.com', '310-555-0199');
  await fillSite(page, 'dropoff', { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', zip: '90210', same: true, installLocation: 'standard' });
  await next(page); await pickDay(page); await next(page); await page.waitForTimeout(500);
  await expect(/Large mirror install \(over 48"\)/, 'review should show the large-mirror install line for a 60×40');
  await expect(/\$40/, 'review should show the $40 large-mirror surcharge (1.5 × $75 = $115, less the $75 hanging line)');
  await expect(/\$175/, 'review total should be $175 ($115 install + $60 declared-value protection on $4,000)');
  await checkPricesNoWrap('décor-routed 60×40 review');

  // ---- Admin ----
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await admin.goto(`${BASE}/admin?key=${encodeURIComponent(ADMIN_KEY)}`); await admin.waitForSelector('tr.o');
  if (!(await hasText(admin, /ACH processing/))) errors.push('admin should label ACH payment as processing');
  await docShot(admin, '13-admin');
  await admin.click(`tr.o[data-id="${id3}"]`); await admin.waitForSelector('#approveBox'); await admin.waitForTimeout(300);
  if (!(await hasText(admin, /Samantha — approve and set a price/i))) errors.push('admin approval missing Samantha label');
  await docShot(admin, '14-admin-approval');
  if (!(await admin.inputValue('#approvePrice'))) errors.push('approve price field empty');
  await admin.click('#approveBtn');
  await admin.waitForSelector(`tr.o[data-id="${id3}"] .pill.awaiting_payment`, { timeout: 5000 });
  if (!await admin.$('a[href*="quote_approved"]')) await admin.click(`tr.o[data-id="${id3}"]`);
  await admin.waitForSelector('a[href*="quote_approved"]', { timeout: 5000 }).catch(() => errors.push('missing quote_approved email after approve'));
  await admin.click(`tr.o[data-id="${id3}"]`);
  await admin.click(`tr.o[data-id="${id1}"]`); await admin.waitForSelector('[data-email="eta"]');
  await admin.click('[data-email="reminder"]'); await admin.waitForTimeout(500);
  await admin.click(`tr.o[data-id="${id1}"]`); await admin.waitForTimeout(300); await admin.click(`tr.o[data-id="${id1}"]`); await admin.waitForSelector('[data-email="eta"]');
  await admin.click('[data-email="eta"]'); await admin.waitForTimeout(500);

  // ---- Payment link from Samantha's approval (existing order → pay) ----
  await page.goto(`${BASE}/?order=${encodeURIComponent(id3)}&pay=1`); await page.waitForSelector('#nextBtn');
  await page.waitForTimeout(500);
  await expect(/Pay to confirm/, 'payment link should open the pay screen');
  await shot(page, '15-payment-link', { full: false });
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  await expect(/You’re booked for/, 'payment link should confirm the job');

  // ---- Emails + CSV ----
  const outbox = path.join(DATA_ROOT, 'outbox');
  const files = fs.readdirSync(outbox).filter((f) => f.startsWith(id1));
  for (const kind of ['confirmation', 'reminder', 'eta']) {
    const f = files.find((x) => x.includes(`-${kind}-`)); if (!f) { errors.push('missing email ' + kind); continue; }
    const html = fs.readFileSync(path.join(outbox, f), 'utf8');
    if (!/Pickup details/i.test(html) || !/Special instructions/.test(html)) errors.push(kind + ' email missing pickup details / special instructions');
    if (!/Andrea B/.test(html)) errors.push(kind + ' email missing pickup contact');
    if (!/Gate code 4411/.test(html)) errors.push(kind + ' email missing delivery notes');
  }
  const f2 = fs.readdirSync(outbox).find((x) => x.startsWith(id2) && x.includes('-confirmation-'));
  if (!f2 || !/ACH processing/.test(fs.readFileSync(path.join(outbox, f2), 'utf8'))) errors.push('ACH confirmation email should say ACH processing');
  const csv = fs.readFileSync(path.join(DATA_ROOT, 'data', 'schedule-2026.csv'), 'utf8');
  if (!/Andrea B/.test(csv)) errors.push('CSV missing PU contact name');
  if (!/Loading dock: yes/.test(csv)) errors.push('CSV PU Notes missing loading dock');
  if (!/A few steps \(3 or fewer\) on the way/.test(csv)) errors.push('CSV PU Notes missing steps-with-elevator');
  if (!/2 flights of stairs up · No tight turns on the stairs · Double doors · Fits easily/.test(csv)) errors.push('CSV DE Notes missing stairs + doorway');
  if (!/Elevator, floor 2 · Service elevator: yes · A few steps \(3 or fewer\) on the way · Loading dock: yes/.test(csv)) errors.push('CSV PU Notes missing elevator floor / service elevator / dock');
  if (!/Gate code 4411/.test(csv)) errors.push('CSV DE Notes missing special instructions');
  if (!/customer chose a later delivery date/.test(csv)) errors.push('CSV missing separate later-delivery row');
  if (!/Plaster wall, hardware: CAD brings it/.test(csv)) errors.push('CSV DE Notes missing wall type and hardware');
  if (!/Standard eye level \(59""? center\)/.test(csv)) errors.push('CSV should record default 59" standard hanging height');
  if (!/Parking\/loading restrictions: Loading zone only/.test(csv)) errors.push('CSV PU Notes missing parking restriction');
  if (!/Not sure everything fits/.test(csv)) errors.push('CSV PU Notes missing fit warning');
  if (!/ACH processing/.test(csv)) errors.push('CSV payment status should say ACH processing');
  if (!/type: Painting, Framed: Yes · Frame type: Medium/.test(csv)) errors.push('CSV should show item type, Framed and frame type');
  const conf1 = files.find((x) => x.includes('-confirmation-'));
  if (!conf1 || !/Painting · Framed: Yes · Frame type: Medium/.test(fs.readFileSync(path.join(outbox, conf1), 'utf8'))) errors.push('confirmation email should show item type, Framed and frame type');

  // ---- Admin: shipping quote labeled, Samantha prices it, customer pays, CSV row ----
  await admin.goto(`${BASE}/admin?key=${encodeURIComponent(ADMIN_KEY)}`); await admin.waitForSelector('tr.o');
  await admin.click(`tr.o[data-id="${shipOrder.id}"]`); await admin.waitForSelector('#approveBox'); await admin.waitForTimeout(300);
  if (!(await hasText(admin, /Samantha — price this shipping quote/))) errors.push('admin should label shipping quotes');
  if (!(await hasText(admin, /Shipping details/)) || !(await hasText(admin, /France/))) errors.push('admin should show shipping details');
  await docShot(admin, '26-admin-shipping');
  await admin.fill('#approvePrice', '2400'); await admin.click('#approveBtn');
  await admin.waitForSelector(`tr.o[data-id="${shipOrder.id}"] .pill.awaiting_payment`, { timeout: 5000 }).catch(() => errors.push('shipping approve failed'));
  await page.goto(`${BASE}/?order=${encodeURIComponent(shipOrder.id)}&pay=1`); await page.waitForSelector('#nextBtn'); await page.waitForTimeout(500);
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  const csv2 = fs.readFileSync(path.join(DATA_ROOT, 'data', 'schedule-2026.csv'), 'utf8');
  if (!/SHIPPING/.test(csv2)) errors.push('paid shipping job should write a SHIPPING schedule row');

  // ---- Phase 2 audit fixes (app.js / styles.css) ----
  {
    // P0-16: a refresh after booking shows the same confirmation, never a prefilled form that could book again.
    await page.reload(); await page.waitForTimeout(800);
    if (!(await page.locator('.check').count())) errors.push('refresh after paying should show the confirmation again (P0-16)');
    if (await page.locator('[data-service]').count()) errors.push('refresh after paying must not reopen the order form (P0-16)');
    // P1-34: a refresh mid-booking lands on the same step.
    await startFresh(page);
    await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(200);
    await fill(page, 'items.0.description', 'Resume check'); await fill(page, 'items.0.w', 20); await fill(page, 'items.0.h', 20); await fill(page, 'items.0.d', 2); await fill(page, 'items.0.value', 1000);
    await page.click('[data-itemtype="0"] button[data-v="sculpture"]'); await page.waitForTimeout(200);
    // P1-2: switching to Install only never turns a sculpture into a painting.
    await page.click('[data-service="install_only"]'); await page.waitForTimeout(300);
    { const st = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cad-order')));
      if (st.service !== 'pickup_delivery' || st.items[0].type !== 'sculpture') errors.push('Install only must not silently change a sculpture into a painting (P1-2): ' + JSON.stringify({ s: st.service, t: st.items[0].type }));
      const toast = await page.locator('#uploadToast').textContent().catch(() => '');
      if (!/Install only covers wall pieces/.test(toast || '')) errors.push('Install only switch should explain why (P1-2)'); }
    // P1-21: a failed upload says so.
    await page.route('**/api/upload', (r) => r.fulfill({ status: 500, body: '{}' }));
    await page.setInputFiles('[data-upload="0"]', path.join(__dirname, 'sample-artwork.png')); await page.waitForTimeout(800);
    { const toast = await page.locator('#uploadToast').textContent().catch(() => '');
      if (!/didn’t upload/.test(toast || '')) errors.push('a failed photo upload must show an error (P1-21)'); }
    await page.unroute('**/api/upload');
    // P0-18: an unpriced piece (weight not sure) shows "Priced by CAD", not a fake $75 "regular rate".
    await page.click('[data-weightunsure="0"]').catch(() => {}); await page.waitForTimeout(600);
    { const lbl = (await page.textContent('#estLabel')) || ''; const tot = (await page.textContent('#estTotal')) || '';
      if (!/Priced by CAD/i.test(lbl) || /\$/.test(tot)) errors.push(`unpriced estimate should read Quote / Priced by CAD (P0-18), got ${tot} / ${lbl}`); }
    await page.waitForTimeout(300);
    await page.reload(); await page.waitForTimeout(800);
    if (!(await page.locator('[data-service]').count())) errors.push('refresh on step 1 should stay on step 1');
    // ---- Boundaries in the browser (Chad, Nov 16 second review) ----
    await startFresh(page);
    await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(200);
    await fill(page, 'items.0.description', 'Boundary piece'); await fill(page, 'items.0.w', 20); await fill(page, 'items.0.h', 30); await fill(page, 'items.0.d', 20); await fill(page, 'items.0.value', 1000);
    await page.click('[data-itemtype="0"] button[data-v="sculpture"]'); await page.waitForTimeout(200);
    const photoLine = async () => page.$eval('[data-photoreq="0"]', (el) => (el.hidden ? '' : el.textContent.trim())).catch(() => '');
    await fill(page, 'items.0.weight', 500); await page.waitForTimeout(300);
    if (await photoLine()) errors.push('browser boundary: 500 lb must not require a photo');
    await fill(page, 'items.0.weight', 501); await page.waitForTimeout(300);
    if (!/over 500 lb/.test(await photoLine())) errors.push('browser boundary: 501 lb must require a photo');
    if (!(await isBlocked(page))) errors.push('browser boundary: 501 lb without a photo must block Continue');
    await fill(page, 'items.0.weight', ''); await page.click('[data-weightunsure="0"]'); await page.waitForTimeout(400);
    if ((await photoLine()) !== 'Add a photo so we can plan for the weight.') errors.push('browser boundary: unknown weight must require a photo with the weight helper line, got: ' + (await photoLine()));
    if (!(await isBlocked(page))) errors.push('browser boundary: unknown weight without a photo must block Continue');
    const b = await page.evaluate(() => {
      const stop = (x) => CADAccess.normalize({ ...x });
      const set = (x) => { Object.assign(S.dropoff, { accessMode: '', stairFlights: '', stairDir: '', stairs: 0, elevatorStairs: '', floor: '' }, x); CADAccess.normalize(S.dropoff); };
      const gapsFor = (x) => { set(x); step = STEPS.indexOf('Where'); const m = missingFields(); step = 0; return m.map((g) => g.label).filter((l) => / — Delivery$/.test(l)).map((l) => l.replace(/ — Delivery$/, '')).filter((l) => /How do we get in|How many flights|Total number|Up or down|Tight turns|Photos of|^Floor$|Any stairs|Will everything fit/.test(l)); };
      const out = {};
      S.items = [{ ...S.items[0], type: 'painting', weightUnsure: false, weight: '', photos: ['/x.png'], framed: 'no', w: 20, h: 30, d: 2 }];
      set({ accessMode: 'stairs', stairFlights: '1', stairDir: 'up' });
      out.fit80 = pieceNeedsStairwellFit({ w: 80, h: 30, d: 2 }); out.fit81 = pieceNeedsStairwellFit({ w: 81, h: 30, d: 2 });
      set({ accessMode: 'steps' });
      out.steps150 = pieceNeedsStairwellFit({ w: 81, h: 30, d: 2, weight: 150 }); out.steps151 = pieceNeedsStairwellFit({ w: 81, h: 30, d: 2, weight: 151 });
      out.big150 = CADAccess.firm([{ weight: 150 }]); out.big151 = CADAccess.firm([{ weight: 151 }]);
      out.basement = gapsFor({ accessMode: 'elevator', floor: 'Basement', elevatorStairs: 'no' });
      out.basementSummary = CADAccess.summary(stop({ accessMode: 'elevator', floor: 'Basement', elevatorStairs: 'no' })).join(' · ');
      out.four = gapsFor({ accessMode: 'stairs', stairFlights: '4plus', stairs: '4', stairDir: 'up' });
      out.three = gapsFor({ accessMode: 'stairs', stairFlights: '4plus', stairs: '3', stairDir: 'up' });
      out.elevNone = gapsFor({ accessMode: 'elevator', floor: '30' });
      out.elevNo = gapsFor({ accessMode: 'elevator', floor: '30', elevatorStairs: 'no' });
      out.elevSteps = gapsFor({ accessMode: 'elevator', floor: '30', elevatorStairs: 'steps' });
      out.elevStairs = gapsFor({ accessMode: 'elevator', floor: '30', elevatorStairs: 'stairs' });
      out.elevStairsDone = gapsFor({ accessMode: 'elevator', floor: '30', elevatorStairs: 'stairs', stairFlights: '2', stairDir: 'up' });
      out.elevNotSure = gapsFor({ accessMode: 'elevator', floor: '30', elevatorStairs: 'not_sure' }); out.elevNotSureFlag = S.dropoff.accessReview;
      set({ accessMode: 'ground', fits: 'not_sure' }); out.fitNotSureFlag = S.dropoff.accessReview; out.fitNotSureGaps = gapsFor({ accessMode: 'ground', fits: 'not_sure' });
      return out;
    });
    if (!b.elevNone.length) errors.push('browser boundary: the gap check returned nothing (test is not exercising validation)');
    const want = { fit80: false, fit81: true, steps150: false, steps151: true, big150: false, big151: true, elevNotSureFlag: true, fitNotSureFlag: true };
    for (const [k, v] of Object.entries(want)) if (b[k] !== v) errors.push(`browser boundary: ${k} should be ${v}, got ${b[k]}`);
    const none = (k) => { if (b[k].length) errors.push(`browser boundary: ${k} should have no delivery gaps, got ${b[k].join(', ')}`); };
    ['basement', 'four', 'elevNo', 'elevSteps', 'elevStairsDone', 'elevNotSure', 'fitNotSureGaps'].forEach(none);
    if (!b.three.includes('Total number of flights')) errors.push('browser boundary: 3 in the 4+ field must be rejected: ' + b.three.join(', '));
    if (!b.elevNone.includes('Any stairs on the way?')) errors.push('browser boundary: elevator stairs unanswered must be required: ' + b.elevNone.join(', '));
    if (!b.elevStairs.includes('How many flights?') || !b.elevStairs.includes('Up or down?')) errors.push('browser boundary: elevator + Stairs must ask flights and direction: ' + b.elevStairs.join(', '));
    if (b.basementSummary !== 'Elevator, floor Basement · No stairs on the way') errors.push('browser boundary: Basement summary: ' + b.basementSummary);
    // ---- Dot round 3: Same as me hides the role; narrow screens keep fields above the dock ----
    await startFresh(page);
    await page.setViewportSize({ width: 430, height: 800 });
    await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(200);
    await page.evaluate(() => { step = STEPS.indexOf('Where'); render(); }); await page.waitForTimeout(300);
    const roleVis = () => page.locator('[data-path="dropoff.contactRole"]').isVisible().catch(() => false);
    if (!(await roleVis())) errors.push('round 3: role field should show when the contact is someone else');
    await page.click('[data-same="dropoff"]'); await page.waitForTimeout(250);
    if (await roleVis()) errors.push('round 3: role field must be hidden for Same as me');
    if (await page.evaluate(() => missingFields().some((g) => /contact role/i.test(g.label) && /Delivery/.test(g.label)))) errors.push('round 3: Same as me must not ask for a delivery contact role');
    await page.click('[data-same="dropoff"]'); await page.waitForTimeout(250);
    if (!(await roleVis())) errors.push('round 3: role field must come back when Same as me is turned off');
    await page.click('[data-same="dropoff"]'); await page.waitForTimeout(250);
    await page.type('[data-path="dropoff.contactName"]', 'x'); await page.waitForTimeout(250);
    if (!(await roleVis())) errors.push('round 3: editing the contact name (no longer Same as me) must show the role field');
    // Every field focused under the dock scrolls above it; the last field clears the dock at the bottom of the page.
    const hidden = await page.evaluate(async () => {
      const wait = () => new Promise((r) => setTimeout(r, 60));
      const dockTop = () => document.getElementById('dock').getBoundingClientRect().top;
      const els = [...document.querySelectorAll('.app input:not([type=hidden]):not([type=file]), .app select, .app textarea')].filter((e) => e.offsetParent);
      const bad = []; let tested = 0, skipped = 0;
      for (const e of els) {
        const r0 = e.getBoundingClientRect();
        window.scrollBy(0, r0.bottom - (dockTop() + 20)); await wait(); // put the field's bottom edge under the dock
        if (e.getBoundingClientRect().bottom <= dockTop()) { skipped++; continue; } // page cannot scroll that far
        tested++;
        document.activeElement && document.activeElement.blur(); e.focus({ preventScroll: true }); await wait(); await wait();
        if (e.getBoundingClientRect().bottom > dockTop()) bad.push(e.id || e.dataset.path);
      }
      window.scrollTo(0, document.documentElement.scrollHeight); await wait();
      const last = els[els.length - 1];
      return { bad, n: els.length, tested, skipped, lastClear: last.getBoundingClientRect().bottom <= dockTop(), dockH: getComputedStyle(document.documentElement).getPropertyValue('--dock-h') };
    });
    if (hidden.n < 5 || hidden.tested < 5) errors.push('round 3: dock test exercised too few fields: ' + JSON.stringify({ n: hidden.n, tested: hidden.tested }));
    if (hidden.bad.length) errors.push('round 3 (430px): focused fields stayed under the dock: ' + hidden.bad.join(', '));
    if (!hidden.lastClear) errors.push('round 3 (430px): the last field is hidden under the dock at the bottom of the page');
    // ---- Round 4 (a): typed text survives re-renders and access changes on every step ----
    await startFresh(page);
    await page.setViewportSize({ width: 430, height: 800 });
    await page.click('[data-service="delivery_install"]'); await page.waitForTimeout(200);
    const TEXT_SEL = '.app input[type=text], .app input:not([type]), .app input[type=tel], .app input[type=email], .app input[type=number], .app textarea';
    const tested = new Set();
    const typeSweep = async (label, disturb) => {
      const ids = await page.$$eval(TEXT_SEL, (els) => [...new Set(els.filter((e) => e.offsetParent && e.id && !e.readOnly && !e.disabled && !/\.(state|country)$/.test(e.dataset.path || '')).map((e) => e.id))]);
      for (const id of ids) {
        const sel = `[id="${id}"]`;
        if (!(await page.locator(sel).isVisible().catch(() => false))) continue;
        const info = await page.$eval(sel, (e) => ({ path: e.dataset.path || '', type: e.type, im: e.inputMode || '' }));
        const isPhone = /phone|Phone/.test(info.path) || info.type === 'tel';
        const isNum = info.type === 'number' || /numeric|decimal/.test(info.im) || /\.(qty|w|h|d|value|weight|stairs|narrowestIn|centerHeight)$/.test(info.path);
        const [p1, p2] = /\.zip$/.test(info.path) ? ['902', '10'] : isPhone ? ['310', '555'] : isNum ? ['1', '2'] : info.type === 'email' ? ['ab', '@c.co'] : ['Ab', 'c d'];
        await page.click(sel); await page.fill(sel, ''); await page.keyboard.type(p1, { delay: 10 }); await page.waitForTimeout(80);
        await disturb(info.path); await page.waitForTimeout(150);
        await page.keyboard.type(p2, { delay: 10 }); await page.waitForTimeout(150);
        const st = await page.evaluate((s) => { const el = document.querySelector(s); const p = el && el.dataset.path; return { v: el ? el.value : '<gone>', focus: !!el && document.activeElement === el, stored: p ? String(p.split('.').reduce((o, k) => (o == null ? o : o[k]), S) ?? '') : '' }; }, sel);
        const want = p1 + p2; const digits = (x) => String(x).replace(/\D/g, '');
        const okV = isPhone || isNum || /\.zip$/.test(info.path) ? digits(st.v) === digits(want) && digits(st.stored) === digits(want) : st.v === want && st.stored === want;
        if (!okV) errors.push(`typing (${label}): ${info.path} lost input across a re-render: shows "${st.v}", saved "${st.stored}", typed "${want}"`);
        if (!st.focus) errors.push(`typing (${label}): ${info.path} lost focus across a re-render`);
        tested.add(info.path);
      }
    };
    // What: a re-render mid-typing (what any tap on a chip or toggle does).
    await typeSweep('What', async () => { await page.evaluate(() => render()); });
    // Where: set every access branch that shows a typed field, then tap access answers mid-typing (no focus move, like iOS).
    await page.evaluate(() => { step = STEPS.indexOf('Where'); render(); }); await page.waitForTimeout(300);
    await setAccess(page, 'pickup', { mode: 'elevator', floor: '', elevStairs: 'stairs', flights: '4plus', dir: 'up', turns: 'no', fit: 'not_sure' });
    await setAccess(page, 'dropoff', { mode: 'ground', fit: 'not_sure' });
    let flip = false;
    await typeSweep('Where', async (p) => {
      const other = /^pickup/.test(p) ? 'dropoff' : 'pickup';
      flip = !flip;
      await page.$eval(`[data-seg="${other}.dock"] button[data-v="${flip ? 'yes' : 'no'}"]`, (b) => b.click()).catch(() => {});
      await page.waitForTimeout(80);
      await page.$eval(`[data-seg="${other}.doorway"] button[data-v="${flip ? 'double' : 'single'}"]`, (b) => b.click()).catch(() => {});
    });
    for (const must of ['dropoff.notes', 'pickup.notes', 'pickup.floor', 'pickup.stairs', 'pickup.narrowestIn', 'dropoff.narrowestIn', 'dropoff.contactName', 'dropoff.contactPhone', 'contact.name', 'contact.phone', 'pickup.hours', 'dropoff.street'])
      if (!tested.has(must)) errors.push('typing test did not reach ' + must);
    // Fields hidden by an access change come back with what was typed when the answer is switched back.
    await fill(page, 'pickup.floor', 'Basement'); await fill(page, 'pickup.stairs', '6'); await fill(page, 'pickup.narrowestIn', '28');
    await segClick(page, 'pickup.accessMode', 'ground'); await segClick(page, 'pickup.fits', 'yes');
    await segClick(page, 'pickup.accessMode', 'elevator'); await segClick(page, 'pickup.elevatorStairs', 'stairs'); await segClick(page, 'pickup.stairFlights', '4plus'); await segClick(page, 'pickup.fits', 'not_sure');
    { const v = await page.evaluate(() => ['floor', 'stairs', 'narrowestIn'].map((k) => [document.getElementById(`f-pickup.${k}`)?.value, String(S.pickup[k])]));
      if (JSON.stringify(v) !== JSON.stringify([['Basement', 'Basement'], ['6', '6'], ['28', '28']])) errors.push('access switch away and back should keep Floor / Total number of flights / Narrowest opening: ' + JSON.stringify(v)); }
    // A photo upload finishing while the customer types must not rebuild the field under them.
    await page.click('[id="f-dropoff.notes"]'); await page.fill('[id="f-dropoff.notes"]', ''); await page.keyboard.type('Gate', { delay: 10 });
    await page.evaluate(() => { document.activeElement.__mark = 1; S.dropoff.sitePhotos = [...(S.dropoff.sitePhotos || []), '/uploads/x.png']; persist(); renderWhenIdle(); });
    await page.keyboard.type(' 12', { delay: 10 });
    { const st = await page.evaluate(() => ({ same: document.activeElement.__mark === 1, v: document.activeElement.value, pending: renderPending }));
      if (!st.same || st.v !== 'Gate 12' || !st.pending) errors.push('a finished upload must wait until the customer leaves the field: ' + JSON.stringify(st)); }
    await page.click('h1'); await page.waitForTimeout(200);
    { const st = await page.evaluate(() => ({ pending: renderPending, v: document.getElementById('f-dropoff.notes').value }));
      if (st.pending || st.v !== 'Gate 12') errors.push('the waiting re-render should run after leaving the field and keep the text: ' + JSON.stringify(st)); }
    // When step.
    await page.evaluate(() => { step = STEPS.indexOf('When'); render(); }); await page.waitForTimeout(400);
    await typeSweep('When', async () => { await page.evaluate(() => render()); });
    // ---- Round 4 (c): mobile keyboard (shrunken visualViewport) keeps the focused field visible ----
    await page.evaluate(() => { step = STEPS.indexOf('Where'); render(); }); await page.waitForTimeout(300);
    const kb = await page.evaluate(async () => {
      const wait = () => new Promise((r) => setTimeout(r, 80));
      const out = [];
      const fake = (h) => Object.defineProperty(window, 'visualViewport', { configurable: true, value: { offsetTop: 0, offsetLeft: 0, height: h, width: innerWidth, scale: 1, addEventListener() {}, removeEventListener() {} } });
      for (const id of ['f-pickup.city', 'f-dropoff.contactPhone', 'f-dropoff.notes']) {
        const el = document.getElementById(id); if (!el) { out.push([id, 'missing']); continue; }
        delete window.visualViewport;
        el.scrollIntoView({ block: 'center' }); await wait();
        el.focus({ preventScroll: true }); await wait();
        fake(360); onViewportResize(); await wait(); // keyboard opens after focus
        const r1 = el.getBoundingClientRect();
        document.activeElement.blur(); el.scrollIntoView({ block: 'end' }); await wait();
        el.focus({ preventScroll: true }); await wait(); // focus while the keyboard is already open
        const r2 = el.getBoundingClientRect();
        out.push([id, Math.round(r1.top), Math.round(r1.bottom), Math.round(r2.top), Math.round(r2.bottom)]);
      }
      delete window.visualViewport; onViewportResize();
      return out;
    });
    for (const [id, t1, b1, t2, b2] of kb) if (t1 === 'missing' || !(t1 >= 0 && b1 <= 360 && t2 >= 0 && b2 <= 360)) errors.push(`mobile keyboard: ${id} not kept visible above a 360px visual viewport: ${JSON.stringify([t1, b1, t2, b2])}`);
    // ---- Round 4 (b)+(c): Same as me ↔ someone else, then a new "I am a…", on a Not sure order paid at the base price ----
    await startFresh(page);
    await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(200);
    await fill(page, 'items.0.description', 'Round 4 print'); await fill(page, 'items.0.w', 20); await fill(page, 'items.0.h', 24); await fill(page, 'items.0.d', 2); await fill(page, 'items.0.value', 900);
    await frame(page, 0, 'no');
    await next(page);
    await me(page, 'Dana Booker', 'dana@example.com', '310-555-0142');
    await page.selectOption('[data-path="contact.clientType"]', 'Collector'); await page.waitForTimeout(150);
    await fillSite(page, 'pickup', { street: '8678 Melrose Ave', city: 'West Hollywood', zip: '90069', same: true });
    // Pickup: Same as me → someone else.
    await page.click('[data-same="pickup"]'); await page.waitForTimeout(200);
    await fill(page, 'pickup.contactName', 'Rita Recipient'); await fill(page, 'pickup.contactPhone', '415-555-0102');
    await page.selectOption('[data-path="pickup.contactRole"]', 'Homeowner'); await page.waitForTimeout(200);
    // Delivery: someone else → back to Same as me, with fit Not sure (access review).
    await fillSite(page, 'dropoff', { street: '456 N Rodeo Dr', city: 'Beverly Hills', zip: '90210', contactName: 'Sam Other', contactPhone: '213-555-0111', role: 'Assistant', access: { mode: 'ground', fit: 'not_sure' } });
    await page.click('[data-same="dropoff"]'); await page.waitForTimeout(200);
    if (await page.locator('[data-path="dropoff.contactRole"]').isVisible().catch(() => false)) errors.push('round 4: role field must hide after switching back to Same as me');
    // The booker changes "I am a…" afterwards.
    await page.selectOption('[data-path="contact.clientType"]', 'Gallery'); await page.waitForTimeout(200);
    await next(page); await pickDay(page); await next(page); await page.waitForTimeout(600);
    const payTxt = ((await page.textContent('#nextBtn')) || '').trim();
    if (!/^Pay base price \$\d{1,3}(,\d{3})*(\.\d{2})?$/.test(payTxt)) errors.push('round 4: Not sure order button should read "Pay base price $…", got ' + payTxt);
    const bigTxt = await page.evaluate(() => { const keep = quoteData; quoteData = { ...keep, dueNow: 12345.5, paymentPlan: 'full' }; paintButton(); const t = document.getElementById('nextBtn').textContent; quoteData = keep; paintButton(); return t; });
    if (bigTxt.trim() !== 'Pay base price $12,345.50') errors.push('round 4: large base price should keep the comma format, got ' + bigTxt);
    await expect(/Rita Recipient · [^<]*· Homeowner/, 'round 4: pickup (someone else) should show Rita as Homeowner');
    await expect(/Dana Booker · [^<]*· Gallery/, 'round 4: delivery (Same as me) should show the new “I am a…” (Gallery)');
    await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(600);
    const id4 = (await page.textContent('.done b')).trim();
    const o4 = readOrders().find((o) => o.id === id4);
    if (!o4) errors.push('round 4: order not saved');
    else {
      if (o4.pickup.sameAsMe || o4.pickup.contactName !== 'Rita Recipient' || o4.pickup.contactRole !== 'Homeowner') errors.push('round 4: pickup should be saved as Rita / Homeowner: ' + JSON.stringify([o4.pickup.sameAsMe, o4.pickup.contactName, o4.pickup.contactRole]));
      if (!o4.dropoff.sameAsMe || o4.dropoff.contactName !== 'Dana Booker' || o4.dropoff.contactRole !== 'Gallery' || o4.dropoff.contactRoleOther) errors.push('round 4: delivery should be saved as Dana / Gallery (booker’s new “I am a…”): ' + JSON.stringify([o4.dropoff.sameAsMe, o4.dropoff.contactName, o4.dropoff.contactRole, o4.dropoff.contactRoleOther]));
      if (!o4.accessReview) errors.push('round 4: fit Not sure order should be flagged for access review');
      const ob = path.join(DATA_ROOT, 'outbox');
      const f = fs.readdirSync(ob).find((x) => x.startsWith(id4 + '-') && x.includes('confirmation'));
      const m = f ? fs.readFileSync(path.join(ob, f), 'utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '';
      for (const w of ['Access isn’t confirmed yet. If it needs an added fee, we’ll go over it with you and get your OK before charging it.', 'Estimated total (before access check)', 'Paid today (base price)']) if (!m.includes(w)) errors.push(`round 4: Not sure confirmation email missing "${w}"`);
      if (/paid in full/i.test(m) || / Total \$/.test(m) || /\bfinal\b/i.test(m)) errors.push('round 4: Not sure confirmation email must not say paid in full, a bare Total, or final');
      if (/Sam Other|Assistant/.test(m)) errors.push('round 4: email still shows the old delivery contact');
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // No crating, multiplier or internal zone codes anywhere in the app bundle shown to customers.
    const js = await (await fetch(BASE + '/app.js')).text();
    for (const bad of [/crating not sure/, /Custom crating/, /\+ crating quote/, /Quoted range \(1\.5×/, /Irvine hub/, /Monday is always an LA day/, /one tap/, /No approval step/, /Used for insurance/, /15-minute heads-up/, /\(650\) 460-4296/]) if (bad.test(js)) errors.push('app.js still contains ' + bad);
    const css = await (await fetch(BASE + '/styles.css')).text();
    if (/\.est-total\{[^}]*text-overflow:ellipsis/.test(css) || /\.seg button\{[^}]*text-overflow:ellipsis/.test(css)) errors.push('prices and seg buttons must not truncate with an ellipsis (P1-22/23)');
  }

  await browser.close();
  // API-level regression checks from the Nov 16 audit (routing, validation, idempotency, emails, admin key).
  errors.push(...new Set(pickDayErrors));
  await require('./audit-regression').run(BASE, errors);
  console.log(JSON.stringify({ engine: process.env.E2E_BROWSER || 'chromium', id1, id2, id3, errors }, null, 2));
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
