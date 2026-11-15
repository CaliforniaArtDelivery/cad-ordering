// End-to-end test + screenshots for the 4-step flow. Usage: npm run e2e (server must be running on :3000)
// E2E_BROWSER=webkit to run in WebKit (if host deps are installed); default Chromium with iPhone emulation.
const pw = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots', 'v-next');
fs.mkdirSync(SHOTS, { recursive: true });
const engine = pw[process.env.E2E_BROWSER || 'chromium'];

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
const startFresh = async (page) => { await page.goto(BASE); await page.evaluate(() => sessionStorage.clear()); await page.goto(BASE); await page.waitForSelector('[data-service]'); };
const me = async (page, name, email, phone) => {
  await fill(page, 'contact.name', name); await fill(page, 'contact.email', email); await fill(page, 'contact.phone', phone);
  if (await page.$('[data-path="heard.source"]')) {
    const v = await page.inputValue('[data-path="heard.source"]');
    if (!v) await page.selectOption('[data-path="heard.source"]', 'google');
  }
};
const fillSite = async (page, key, { street, city, zip, business, contactName, contactPhone, same, floor, hours, notes, role, roleOther, installLocation }) => {
  await fill(page, `${key}.street`, street); await fill(page, `${key}.city`, city); await fill(page, `${key}.zip`, zip);
  if (business) await fill(page, `${key}.business`, business);
  if (same) { await page.click(`[data-same="${key}"]`); await page.waitForTimeout(200); }
  else {
    await fill(page, `${key}.contactName`, contactName); await fill(page, `${key}.contactPhone`, contactPhone);
    await page.selectOption(`[data-path="${key}.contactRole"]`, role || 'Homeowner');
    if ((role || 'Homeowner') === 'Other' && roleOther) await fill(page, `${key}.contactRoleOther`, roleOther);
  }
  if (role && same && await page.$(`[data-path="${key}.contactRole"]`)) await page.selectOption(`[data-path="${key}.contactRole"]`, role);
  if (floor) await fill(page, `${key}.floor`, floor);
  if (hours) await fill(page, `${key}.hours`, hours);
  if (notes) await fill(page, `${key}.notes`, notes);
  if (await page.$(`[data-path="${key}.installLocation"]`)) await page.selectOption(`[data-path="${key}.installLocation"]`, installLocation || 'standard');
};
const pickDay = async (page, opts = {}) => {
  const delivery = (opts && typeof opts === 'object') ? opts.delivery : undefined;
  await page.waitForSelector('[data-reqblock="date"] .day:not(.rush)');
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
const readOrders = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'orders.json'), 'utf8'));

(async () => {
  const browser = await engine.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: process.env.E2E_BROWSER !== 'firefox' && process.env.E2E_BROWSER !== 'webkit' ? true : undefined, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const expect = async (re, msg, neg = false) => { const ok = await hasText(page, re); if (neg ? ok : !ok) errors.push(msg); };

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
  await page.click('label.toggle:has([data-path="pickup.loadingDock"])');
  await page.click('label.toggle:has([data-path="pickup.elevator"])'); await page.waitForTimeout(200);
  if (!(await page.locator('[data-stairs="pickup"]').count())) errors.push('stairs question must still show when there is an elevator');
  await page.click('[data-stairs="pickup"] button[data-v="steps"]');
  await fillSite(page, 'dropoff', { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', zip: '90210', same: true, floor: '2', hours: 'After 10am. Gate closes at 7pm.', notes: 'Gate code 4411. Hang in living room, 57" on center.' });
  if ((await page.inputValue('[data-path="dropoff.contactName"]')) !== 'Jordan Lee') errors.push('"Same as me" did not fill the on-site contact');
  await page.click('[data-stairs="dropoff"] button[data-v="2"]'); await page.waitForTimeout(200);
  if (await hasText(page, /COI required|coiRequired/)) errors.push('COI fields should not exist');
  if (!(await page.locator('[data-seg="items.0.hangHeight"]').count())) errors.push('install job should ask hanging height per piece');
  if (await page.locator('[data-path="dropoff.centerHeight"], [data-path="pickup.centerHeight"]').count()) errors.push('hanging height should be per piece, not on the address');
  if (await page.locator('[data-seg="items.1.hangHeight"]').count()) errors.push('sculpture should not ask hanging height');
  await page.selectOption('[data-path="dropoff.wallType"]', 'Plaster');
  await page.click('[data-seg="dropoff.hardware"] button[data-v="CAD brings it"]'); await page.waitForTimeout(150);
  await page.click('[data-seg="pickup.fits"] button[data-v="not_sure"]'); await page.waitForTimeout(150);
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
  await expect(/Pickup special instructions/i, 'review missing pickup special instructions');
  await expect(/Delivery special instructions/i, 'review missing delivery special instructions');
  await expect(/Andrea B/, 'review missing pickup on-site contact');
  await expect(/Loading dock/i, 'review missing loading dock');
  await expect(/2 flights of stairs/i, 'review missing delivery stairs');
  await expect(/3 steps or fewer/i, 'review missing pickup steps (with elevator)');
  await expect(/Gate code 4411/, 'review missing delivery notes');
  await expect(/confirmed the moment you pay/i, 'review missing auto-confirm copy');
  await expect(/Apple Pay/, 'review missing Apple Pay');
  await expect(/Google Pay/, 'review missing Google Pay');
  await expect(/Bank \(ACH\)/, 'review missing ACH option');
  await expect(/Save for next time/i, 'review missing save-method option');
  await expect(/Declared value protection/i, 'review missing protection choice');
  await expect(/change or cancel/i, 'review missing cancellation note');
  await expect(/Bill my account/i, 'Bill my account must not appear', true);
  const promise = await page.textContent('.promise b');
  if (!/Pickup [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+ · Delivery /.test(promise)) errors.push('review promise should show pickup + delivery, got: ' + promise);
  await expect(/Plaster/, 'review missing wall type');
  await expect(/Standard eye level \(59" center\)/, 'review missing default 59" center height');
  await expect(/Loading zone only/, 'review missing parking restriction');
  if (!/^Pay \$/.test(await page.textContent('#nextBtn'))) errors.push('review button should be "Pay $…"');
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
  await fill(page, 'items.0.qty', 3); await fill(page, 'items.0.description', 'Bronze sculpture + marble pedestal'); await fill(page, 'items.0.h', 80); await fill(page, 'items.0.weight', 226); await fill(page, 'items.0.value', 45000);
  await next(page);
  await me(page, 'Cyd G.', 'cyd@example.com', '805-555-0144');
  await page.selectOption('[data-path="contact.clientType"]', 'Interior designer');
  await fillSite(page, 'pickup', { street: '1153 Camino Dos Rios', city: 'Thousand Oaks', zip: '91360', same: true });
  await fillSite(page, 'dropoff', { street: '850 Sanitarium Rd', city: 'Deer Park', zip: '94576', same: true });
  await page.click('label.toggle:has([data-path="dropoff.elevator"])'); await page.waitForTimeout(200);
  await next(page); await pickDay(page);
  await expect(/different regions, so delivery is usually 1–2 weeks later/, 'cross-region job should explain the later delivery day');
  if (await page.locator('[data-path="schedule.deliveryLater"]').count()) errors.push('later-delivery toggle should be gone on cross-region jobs');
  if (!(await page.locator('[data-deldate]').count())) errors.push('cross-region job should still let the customer pick a delivery date');
  await next(page); await page.waitForTimeout(500);
  await expect(/data-path="declaredValueProtection"/, 'in-CA jobs must not offer an optional protection toggle', true);
  await expect(/Declared value protection \(1\.5%\) on \$135,000/, 'mandatory protection line missing (pieces at $50K or less)');
  await expect(/split 50\/50/i, 'over-$3k review missing 50/50 split');
  await expect(/Balance due at pickup/i, 'over-$3k review missing balance due at pickup');
  await page.click('[data-pay-method] button[data-v="ach"]'); await page.waitForTimeout(200);
  await expect(/ACH processing/, 'ACH copy should mention “ACH processing”');
  await shot(page, '06-review-split-ach');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(600);
  await expect(/ACH processing/, 'ACH confirmation should show “ACH processing”');
  await expect(/is confirmed/i, 'ACH job must confirm immediately');
  await shot(page, '07-confirmation-ach');
  const id2 = (await page.textContent('.done b')).trim();
  const o2 = readOrders().find((o) => o.id === id2);
  if (!o2 || o2.status !== 'confirmed') errors.push('ACH order should be confirmed on submit');
  if (!o2 || o2.payment.status !== 'ach_processing') errors.push('ACH payment status should be ach_processing, got ' + (o2 && o2.payment.status));
  if (!o2 || !o2.declaredValueProtection) errors.push('mandatory protection not recorded on order 2');

  // ---- Order 3: rush / dedicated quote request ----
  await page.click('#newOrder'); await page.waitForSelector('[data-service]');
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="wallart"]'); await page.waitForTimeout(200);
  await expect(/Mixed media, wall sculpture, etc\./, 'Other wall art helper text missing');
  await fill(page, 'items.0.description', 'Photograph, rushed for an opening'); await fill(page, 'items.0.w', 30); await fill(page, 'items.0.h', 40); await frame(page, 0, 'yes', 'no');
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
  await expect(/Quoted range/i, 'rush review missing quoted range');
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
  await fill(page, 'items.0.qty', 8); await fill(page, 'items.0.description', 'A group of works on canvas'); await fill(page, 'items.0.value', 1000); await frame(page, 0, 'no');
  await next(page); await laTrip(page, 'Morgan Chen', 'morgan@example.com');
  await expect(/additional 10% off/i, 'paintings review shows 10% off line', true);
  await expect(/\$1,195/, 'paintings review should total $1,075 + $120 protection = $1,195');
  await page.click('[data-goto="1"]'); await page.waitForTimeout(300);
  await page.click('label.toggle:has([data-path="member"])'); await page.waitForTimeout(200);
  await expect(/Not a member\? CAD Membership is \$200\/month/, 'membership pitch missing');
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
  await expect(/Need custom crating/, 'install-only should not offer crating', true);
  await fill(page, 'items.0.description', 'Large abstract on canvas'); await fill(page, 'items.0.w', 40); await fill(page, 'items.0.h', 50); await frame(page, 0, 'no'); await fill(page, 'items.0.value', 8000);
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

  // ---- Order 8: custom crating → quote request, no instant pay ----
  await startFresh(page);
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await fill(page, 'items.0.description', 'Fragile mixed-media piece'); await fill(page, 'items.0.value', 3000); await frame(page, 0, 'yes', 'yes');
  await page.click('label.toggle:has([data-path="crating"])'); await page.waitForTimeout(300);
  await next(page); await laTrip(page, 'Lee Park', 'lee@example.com');
  await expect(/data-wallet/, 'crating job must not show payment buttons', true);
  await expect(/Custom crating/, 'crating quote should list crating as quoted by CAD');
  if ((await page.textContent('#nextBtn')).trim() !== 'Request a quote') errors.push('crating button should read Request a quote');
  await shot(page, '17-review-crating-quote');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  await expect(/Quote request received/, 'crating should end at Quote request received');

  const IMG = path.join(__dirname, 'sample-artwork.png');
  const toggleOn = (p) => page.click(`label.toggle:has([data-path="${p}"])`);
  const nextDisabled = async () => isBlocked(page);

  // ---- Order 9: Shipping, international destination, technical carry photos ----
  await startFresh(page);
  await page.click('[data-service="crating_shipping"]'); await page.waitForTimeout(300);
  await expect(/Out-of-state shipping by air or ground/, 'shipping card subtitle missing');
  await expect(/Within California we always provide white-glove delivery/, 'shipping card should say California jobs are always white-glove');
  await expect(/Custom quote/, 'shipping card should say Custom quote');
  await fill(page, 'items.0.description', 'Large abstract, oil on linen'); await frame(page, 0, 'no');
  await fill(page, 'items.0.w', 60); await fill(page, 'items.0.h', 48); await fill(page, 'items.0.d', 3); await fill(page, 'items.0.weight', 35); await fill(page, 'items.0.value', 20000);
  await page.click('[data-seg="items.0.crateStatus"] [data-v="needs"]'); await page.waitForTimeout(200);
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
  if ((await page.textContent('#nextBtn')).trim() !== 'Request a shipping quote') errors.push('shipping button should read Request a shipping quote');
  if (process.env.DBG) { console.log(await page.evaluate(() => document.querySelector('#app').innerText.slice(-900))); console.log(await page.evaluate(() => sessionStorage.getItem('cad-order').slice(0, 600))); }
  await expect(/Fully insured through our shipping partners/, 'shipping review should say fully insured through shipping partners');
  await expect(/data-path="declaredValueProtection"|High-value handling/, 'shipping must not offer protection or high-value markup', true);
  await shot(page, '23-shipping-review');
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  await expect(/Shipping quote request received/, 'shipping should end at Shipping quote request received');
  await shot(page, '24-shipping-done', { full: false });
  const shipOrder = readOrders()[0];
  if (shipOrder.service !== 'crating_shipping' || shipOrder.status !== 'pending_approval' || shipOrder.schedule.date) errors.push('shipping order should be a pending crating_shipping quote with no route date');
  if (shipOrder.dropoff.country !== 'France' || shipOrder.shipping.serviceLevel !== 'inside' || shipOrder.items[0].crateStatus !== 'needs' || shipOrder.declaredValueProtection || Number(shipOrder.items[0].value) !== 20000) errors.push('shipping order: country / service level / crating / value wrong, or protection set');
  const shipMail = fs.readdirSync(path.join(ROOT, 'outbox')).find((x) => x.startsWith(shipOrder.id) && x.includes('quote_received'));
  const shipHtml = shipMail ? fs.readFileSync(path.join(ROOT, 'outbox', shipMail), 'utf8') : '';
  if (!/Shipping quote request received/.test(shipHtml) || !/France/.test(shipHtml) || !/Inside delivery/.test(shipHtml)) errors.push('shipping quote email should be labeled shipping and list destination + service level');

  // ---- Order 10: Pickup + Delivery to Nevada → automatically a Shipping quote; special handling does not require photos ----
  await startFresh(page);
  await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="decor"]'); await page.waitForTimeout(200);
  if (await page.$('[data-seg="items.0.framed"]')) errors.push('décor must not ask Framed?');
  await fill(page, 'items.0.description', 'Blown-glass vessel'); await fill(page, 'items.0.value', 2500);
  if (!(await page.$('[data-path="items.0.weight"]')) && !(await page.$('[data-weight="0"]'))) errors.push('décor should offer an optional weight field');
  await toggleOn('items.0.fragile'); await page.waitForTimeout(300);
  await expect(/Special handling needed/, 'should rename the toggle to Special handling needed');
  await expect(/Standard paintings, framed art and solid bronze sculpture don't need this/, 'should show the short special-handling guidance');
  await expect(/Add a photo if you have one, or send it later/, 'special handling photos should be optional with a send-later note');
  await expect(/Photos required: uniquely fragile pieces/, 'special handling must not require photos', true);
  if (await nextDisabled()) errors.push('special handling without photos must not block Continue');
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

  // ---- Photo rules via API ----
  const post = async (body) => fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const baseOrder = { service: 'pickup_delivery', contact: { name: 'T', email: 't@x.com', phone: '3105550100' }, pickup: { street: '1 A St', city: 'Los Angeles', zip: '90069', contactName: 'T', contactPhone: '1' }, dropoff: { street: '2 B St', city: 'Los Angeles', zip: '90210', contactName: 'T', contactPhone: '1' }, schedule: { date: '2026-12-07', deliveryDate: '2026-12-07', timePref: 'none' } };
  const mid = await post({ ...baseOrder, items: [{ qty: 1, type: 'sculpture', weight: 350, value: 2000, description: 'Granite' }] });
  if (mid.status === 400) errors.push('350 lb piece without photos should be accepted (threshold is over 500 lb)');
  const heavy = await post({ ...baseOrder, items: [{ qty: 1, type: 'sculpture', weight: 501, value: 2000, description: 'Granite' }] });
  if (heavy.status !== 400) errors.push('piece over 500 lb without photos should be rejected');
  const other = await post({ ...baseOrder, items: [{ qty: 1, type: 'other', weight: 40, value: 1000, description: 'Antique clock' }] });
  if (other.status !== 400) errors.push('Other-type piece without photos should be rejected');
  const handling = await post({ ...baseOrder, items: [{ qty: 1, type: 'decor', furnitureKind: 'Wall Decor', sizeClass: 'medium', fragile: true, value: 1000, description: 'Glass bowl' }] });
  if (handling.status === 400) errors.push('special handling without photos should be accepted');
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

  // ---- Admin ----
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await admin.goto(`${BASE}/admin?key=cad-admin`); await admin.waitForSelector('tr.o');
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
  const outbox = path.join(ROOT, 'outbox');
  const files = fs.readdirSync(outbox).filter((f) => f.startsWith(id1));
  for (const kind of ['confirmation', 'reminder', 'eta']) {
    const f = files.find((x) => x.includes(`-${kind}-`)); if (!f) { errors.push('missing email ' + kind); continue; }
    const html = fs.readFileSync(path.join(outbox, f), 'utf8');
    if (!/Pickup special instructions/i.test(html)) errors.push(kind + ' email missing pickup special instructions');
    if (!/Andrea B/.test(html)) errors.push(kind + ' email missing pickup contact');
    if (!/Gate code 4411/.test(html)) errors.push(kind + ' email missing delivery notes');
  }
  const f2 = fs.readdirSync(outbox).find((x) => x.startsWith(id2) && x.includes('-confirmation-'));
  if (!f2 || !/ACH processing/.test(fs.readFileSync(path.join(outbox, f2), 'utf8'))) errors.push('ACH confirmation email should say ACH processing');
  const csv = fs.readFileSync(path.join(ROOT, 'data', 'schedule-2026.csv'), 'utf8');
  if (!/Andrea B/.test(csv)) errors.push('CSV missing PU contact name');
  if (!/Loading dock: yes/.test(csv)) errors.push('CSV PU Notes missing loading dock');
  if (!/a few steps/.test(csv)) errors.push('CSV PU Notes missing steps-with-elevator');
  if (!/2 flight\(s\) of stairs/.test(csv)) errors.push('CSV DE Notes missing stairs');
  if (!/Floor 2/.test(csv)) errors.push('CSV DE Notes missing floor');
  if (!/Gate code 4411/.test(csv)) errors.push('CSV DE Notes missing special instructions');
  if (!/customer chose a later delivery date/.test(csv)) errors.push('CSV missing separate later-delivery row');
  if (!/Plaster wall, hardware: CAD brings it/.test(csv)) errors.push('CSV DE Notes missing wall type and hardware');
  if (!/Standard eye level \(59""? center\)/.test(csv)) errors.push('CSV should record default 59" standard hanging height');
  if (!/Parking\/loading restrictions: Loading zone only/.test(csv)) errors.push('CSV PU Notes missing parking restriction');
  if (!/Not sure it fits/.test(csv)) errors.push('CSV PU Notes missing fit warning');
  if (!/ACH processing/.test(csv)) errors.push('CSV payment status should say ACH processing');
  if (!/type: Painting, Framed: Yes · Frame type: Medium/.test(csv)) errors.push('CSV should show item type, Framed and frame type');
  const conf1 = files.find((x) => x.includes('-confirmation-'));
  if (!conf1 || !/Painting · Framed: Yes · Frame type: Medium/.test(fs.readFileSync(path.join(outbox, conf1), 'utf8'))) errors.push('confirmation email should show item type, Framed and frame type');

  // ---- Admin: shipping quote labeled, Samantha prices it, customer pays, CSV row ----
  await admin.goto(`${BASE}/admin?key=cad-admin`); await admin.waitForSelector('tr.o');
  await admin.click(`tr.o[data-id="${shipOrder.id}"]`); await admin.waitForSelector('#approveBox'); await admin.waitForTimeout(300);
  if (!(await hasText(admin, /Samantha — price this shipping quote/))) errors.push('admin should label shipping quotes');
  if (!(await hasText(admin, /Shipping details/)) || !(await hasText(admin, /France/))) errors.push('admin should show shipping details');
  await docShot(admin, '26-admin-shipping');
  await admin.fill('#approvePrice', '2400'); await admin.click('#approveBtn');
  await admin.waitForSelector(`tr.o[data-id="${shipOrder.id}"] .pill.awaiting_payment`, { timeout: 5000 }).catch(() => errors.push('shipping approve failed'));
  await page.goto(`${BASE}/?order=${encodeURIComponent(shipOrder.id)}&pay=1`); await page.waitForSelector('#nextBtn'); await page.waitForTimeout(500);
  await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(400);
  const csv2 = fs.readFileSync(path.join(ROOT, 'data', 'schedule-2026.csv'), 'utf8');
  if (!/SHIPPING/.test(csv2)) errors.push('paid shipping job should write a SHIPPING schedule row');

  await browser.close();
  console.log(JSON.stringify({ engine: process.env.E2E_BROWSER || 'chromium', id1, id2, id3, errors }, null, 2));
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
