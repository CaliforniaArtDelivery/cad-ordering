/* Browser walk-through of /palomas (desktop + iPhone-size), with screenshots in screenshots/palomas-*.png.
 * BASE=http://localhost:3111 node scripts/palomas-e2e.js   (CHROME=/usr/bin/google-chrome if Playwright's own browser is not installed) */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3111';
const OUT = require('path').join(__dirname, '..', 'screenshots');
require('fs').mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
// The server allows 10 code attempts a minute per IP (behind Render's proxy that is shared), so pace the code entries instead of tripping the limit.
const pinTimes = [];
const pressPin = async (pg) => {
  const now = () => Date.now();
  while (pinTimes.filter((t) => now() - t < 61000).length >= 7) await new Promise((r) => setTimeout(r, 2000));
  pinTimes.push(now());
  await pg.press('#pinInput', 'Enter');
};
const txt = async (page, sel) => ((await page.locator(sel).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  // Header lockup alignment at the sizes that matter: big showroom monitor, laptop, iPhone
  console.log('\n== header alignment ==');
  for (const [w, h, mob] of [[1920, 1000, false], [1440, 900, false], [390, 844, true]]) {
    const hc = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob });
    const hp = await hc.newPage();
    await hp.goto(BASE + '/palomas'); await hp.waitForSelector('.lockup'); await hp.waitForTimeout(600);
    const g = await hp.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { cx: b.x + b.width / 2, top: b.y, h: b.height }; };
      const cols = [...document.querySelectorAll('.lockup > .lk')];
      const marks = [document.querySelector('.logo-p'), document.querySelector('.x'), document.querySelector('.logo-c')].map(r);
      const caps = [cols[0].querySelector('figcaption'), cols[1].querySelector('.collab'), cols[2].querySelector('figcaption')].map(r);
      const imgsOk = [...document.querySelectorAll('.lockup img')].every((i) => i.complete && i.naturalWidth > 0);
      return { marks, caps, sw: document.documentElement.scrollWidth, iw: innerWidth, imgsOk, lockupLeft: cols[0].getBoundingClientRect().left, lockupRight: cols[2].getBoundingClientRect().right }; });
    ok(g.imgsOk, `${w}px: both logos load`);
    ok(g.marks.every((m, i) => Math.abs(m.cx - g.caps[i].cx) <= 2), `${w}px: each caption is centered directly under its mark`);
    ok(Math.abs(g.caps[0].top - g.caps[1].top) <= 1 && Math.abs(g.caps[1].top - g.caps[2].top) <= 1, `${w}px: the three captions sit on one line`);
    ok(Math.abs((g.marks[1].cx - g.marks[0].cx) - (g.marks[2].cx - g.marks[1].cx)) <= 3, `${w}px: columns are evenly spaced`);
    ok(g.caps.every((c) => c.h < 64) && g.sw <= g.iw, `${w}px: captions wrap at most to two lines, no sideways overflow`);
    ok(Math.abs((g.lockupLeft + g.lockupRight) / 2 - g.iw / 2) <= 3, `${w}px: the lockup is centered on the page`);
    await hp.screenshot({ path: `${OUT}/palomas-header-${w}.png`, clip: { x: 0, y: 0, width: w, height: w >= 1400 ? 420 : 400 } });
    await hc.close();
  }
  for (const [name, vp, mobile] of [['desktop', { width: 1280, height: 900 }, false], ['iphone', { width: 390, height: 844 }, true]]) {
    console.log(`\n== ${name} ==`);
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE + '/palomas');
    await page.waitForSelector('.pcard');
    ok(await page.locator('.logo-p').isVisible() && await page.locator('.logo-c').isVisible(), 'both logos show in the header');
    ok(/^in collaboration with$/.test(await txt(page, '.collab')) && /^Paloma's Home Furnishings$/.test(await txt(page, '.lk:nth-child(1) figcaption')) && /^California Art Delivery$/.test(await txt(page, '.lk:nth-child(3) figcaption')), 'header lockup: Paloma\'s caption, "in collaboration with", California Art Delivery caption');
    ok(await page.locator('.collab em').evaluate((e) => getComputedStyle(e).fontStyle) === 'italic', '"in collaboration with" is italic');
    { // 3 even columns, each caption centered directly under its mark, captions aligned on one line
      const g = await page.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { cx: b.x + b.width / 2, top: b.y, bottom: b.y + b.height, h: b.height, w: b.width }; };
        const cols = [...document.querySelectorAll('.lockup > .lk')];
        const marks = [document.querySelector('.logo-p'), document.querySelector('.x'), document.querySelector('.logo-c')].map(r);
        const caps = [cols[0].querySelector('figcaption'), cols[1].querySelector('.collab'), cols[2].querySelector('figcaption')].map(r);
        return { marks, caps, cols: cols.map(r), sw: document.documentElement.scrollWidth, iw: innerWidth }; });
      ok(g.marks.every((m, i) => Math.abs(m.cx - g.caps[i].cx) <= 2), `each caption is centered directly under its mark (offsets ${g.marks.map((m, i) => Math.abs(m.cx - g.caps[i].cx).toFixed(1)).join(', ')} px)`);
      ok(Math.abs(g.caps[0].top - g.caps[1].top) <= 1 && Math.abs(g.caps[1].top - g.caps[2].top) <= 1, 'the three captions sit on the same line');
      ok(Math.abs((g.marks[1].cx - g.marks[0].cx) - (g.marks[2].cx - g.marks[1].cx)) <= 3, 'columns are evenly spaced (symmetric)');
      ok(g.caps[0].h < 60 && g.caps[2].h < 60 && g.sw <= g.iw, 'captions do not wrap awkwardly (two lines at most) and nothing overflows sideways');
      await page.locator('.hero').screenshot({ path: `${OUT}/palomas-${name}-header.png` });
    }
    ok(/Place a delivery order/.test(await txt(page, 'h1')) && /Partnership pricing is applied automatically/.test(await txt(page, '.lede')), '"Place a delivery order" and the partnership pricing line stay below the lockup');
    // pickup: Salinas first + default, exactly one
    const radios = await page.locator('input[name=pickup]').evaluateAll((els) => els.map((e) => ({ v: e.value, c: e.checked })));
    ok(radios[0].v === 'salinas' && radios[0].c && !radios[1].c, 'Salinas warehouse is first and selected by default');
    ok(/329 Rianda St/.test(await txt(page, '#sec-pickup')), 'warehouse address reads 329 Rianda St');
    await page.locator('label.radio').nth(1).click();
    const r2 = await page.locator('input[name=pickup]').evaluateAll((els) => els.map((e) => e.checked));
    ok(!r2[0] && r2[1], 'choosing Carmel unchecks Salinas (one choice only)');
    await page.locator('label.radio').nth(0).click();
    // who
    ok(await page.locator('#otherWrap').isHidden(), 'Other name field hidden at first');
    await page.selectOption('#placedBy', 'Other');
    ok(await page.locator('#otherWrap').isVisible(), 'choosing Other reveals the name field');
    await page.fill('#placedOther', 'Dave Tester');
    // add from catalog
    await page.fill('#search', 'dining table');
    await page.locator('.pcard').first().click();
    await page.fill('#search', 'arco captiva chair');
    await page.locator('.pcard').first().click();
    await page.locator('.pcard').first().click();
    await page.fill('#search', '');
    ok((await page.locator('.irow').count()) === 2, 'two item rows after adding two pieces');
    ok(/^\(3\)$/.test(await txt(page, '#itemCount')), 'item count shows 3 pieces (2nd piece added twice)');
    await page.waitForFunction(() => /partnership pricing/.test(document.querySelector('#sumBody').innerText));
    const sum1 = await txt(page, '#sumBody');
    ok(/Standard|partnership pricing/.test(sum1) && (await page.locator('.sl.partner s').count()) === 1, 'summary shows the struck-through standard price next to partnership pricing');
    ok(/25% off/.test(sum1), 'summary says partnership pricing is 25% off');
    ok(/additional 10% off the whole delivery price/.test(sum1), 'plain-language 10% note is shown');
    // custom item
    await page.click('#customToggle');
    await page.fill('#cName', 'Custom copper bench'); await page.selectOption('#cKind', 'Bench');
    await page.click('#cAdd');
    ok((await page.locator('.irow').count()) === 3 && /custom/.test(await txt(page, '.irow:nth-child(3) .ty')), 'custom item added');
    await page.fill('#search', 'arco captiva sofa'); await page.locator('.pcard').first().click(); await page.fill('#search', '');
    ok((await page.locator('.irow').count()) === 4, 'a sofa added to push the order over $1,000 after partnership pricing');
    // size and handling come from the catalog: no size tier, oversized checkbox or declared value inputs on any item
    ok((await page.locator('[data-f=size], [data-f=oversized], [data-f=value], #cSize, #cValue').count()) === 0, 'items have no Size tier, Oversized checkbox or Declared value field (also none on the custom item form)');
    ok(!/declared value|oversized|size tier|\$/i.test(await txt(page, '#items')), 'item rows show only name, type, dimensions and quantity');
    await page.locator('#sec-items').screenshot({ path: `${OUT}/palomas-${name}-items.png` });
    // delivery
    await page.fill('#dName', 'Pat Client'); await page.fill('#dPhone', '8315550123'); await page.fill('#dEmail', 'pat@example.com');
    await page.fill('#dStreet', '100 Ocean Ave'); await page.fill('#dCity', 'Carmel-by-the-Sea'); await page.fill('#dZip', '93921');
    // client block: name, phone, email in one column; second client is optional behind "+ Add client"
    const yOf = async (sel) => (await page.locator(sel).boundingBox()).y;
    ok((await yOf('#dName')) < (await yOf('#dPhone')) && (await yOf('#dPhone')) < (await yOf('#dEmail')), 'client: name, then phone directly under it, then email under that');
    ok(await page.locator('#client2').isHidden() && /\+ Add client/.test(await txt(page, '#addClient')), 'second client is hidden behind a "+ Add client" button');
    await page.click('#addClient');
    ok(await page.locator('#client2').isVisible() && await page.locator('#c2Name').isVisible() && (await yOf('#c2Name')) < (await yOf('#c2Phone')) && (await yOf('#c2Phone')) < (await yOf('#c2Email')) && (await yOf('#dEmail')) < (await yOf('#c2Name')), '+ Add client shows a grouped second block (name, phone, email) below the first client');
    await page.fill('#c2Name', 'Sam Spouse'); await page.fill('#c2Phone', '8315550199'); await page.fill('#c2Email', 'sam@example.com');
    ok((await page.locator('#dStreet').count()) === 1 && (await page.locator('#c2Street, [id^=c2][id*=City]').count()) === 0, 'one delivery address only');
    await page.selectOption('#aMode', 'stairs');
    ok(await page.locator('#aFlightsWrap').isVisible(), 'stairs asks how many flights');
    ok(await page.locator('#aElevTypeWrap').isHidden() && await page.locator('#aMoreWrap').isVisible(), 'stairs: no elevator questions, but the optional access-hours field appears');
    await page.selectOption('#aMode', 'elevator');
    ok(await page.locator('#aElevTypeWrap').isVisible() && await page.locator('#aElevResWrap').isVisible() && await page.locator('#aFloorWrap').isVisible() && await page.locator('#aFlightsWrap').isHidden(), 'elevator: asks freight or passenger, whether it must be reserved, and the floor (flights question hidden)');
    ok(await page.locator('#aElevStepsWrap').isVisible() && await page.locator('#aElevStepsNWrap').isHidden(), 'elevator: asks "Any steps before or after the elevator?" (Yes / No / Not sure), count hidden at first');
    ok((await page.locator('#aElevSteps option').allInnerTexts()).join('|') === 'Choose…|No|Yes|Not sure', 'the steps question offers No / Yes / Not sure');
    await page.selectOption('#aElevSteps', 'yes');
    ok(await page.locator('#aElevStepsNWrap').isVisible(), 'answering Yes asks how many steps');
    await page.fill('#aElevStepsN', '4');
    await page.selectOption('#aElevSteps', 'no');
    ok(await page.locator('#aElevStepsNWrap').isHidden(), 'answering No hides the count');
    await page.selectOption('#aElevType', 'freight'); await page.fill('#aFloor', '3'); await page.locator('#aElevRes').check();
    await page.fill('#aHours', 'Weekdays 9am-4pm');
    await page.selectOption('#aMode', 'stairs');
    await page.selectOption('#aFlights', '1');
    ok(await page.locator('#aTight').count() === 0 && /anything tight like narrow hallways or doorways/.test(await page.locator('#dNotes').getAttribute('placeholder')) && /gate code, parking, who to call on arrival, where it goes in the home/i.test(await page.locator('#dNotes').getAttribute('placeholder')), 'one notes field; its placeholder covers gate code, parking, who to call, where it goes and anything tight');
    ok(!/stairs can add a fee|we confirm it/i.test(await page.locator('#sec-delivery').innerText()), 'no "stairs can add a fee…" text under the access questions');
    await page.waitForSelector('#datesBox:not([hidden])');
    await page.waitForSelector('#deDays .day'); await page.waitForSelector('#puCtl [data-later]'); await page.waitForSelector('#deCtl [data-later]'); // live latency: the delivery leg loads after the pickup leg
    ok((await page.locator('#puDays .day').count()) > 0 && (await page.locator('#deDays .day').count()) > 0, 'pickup and delivery days appear, earliest pre-selected');
    ok((await page.locator('#puDays .day').count()) <= 6 && (await page.locator('#deDays .day').count()) <= 6, 'the date lists are short: first 6 days only');
    ok((await page.locator('#puCtl [data-later]').count()) === 1 && (await page.locator('#deCtl [data-later]').count()) === 1, 'each list has a "Later date" option');
    if (await page.locator('#puCtl [data-more]').count()) { await page.locator('#puCtl [data-more]').click(); ok((await page.locator('#puDays .day').count()) > 6 && (await page.locator('#puDays .day').count()) <= 14, 'More dates shows up to 14'); }
    const lastPu = await page.locator('#puDays .day').last().getAttribute('data-pu');
    const laterDate = new Date(Date.parse(lastPu + 'T12:00:00Z') + 21 * 864e5).toISOString().slice(0, 10);
    await page.locator('#puCtl [data-later]').fill(laterDate);
    await page.waitForFunction((d) => { const b = document.querySelector('#puDays .day'); return b && b.dataset.pu >= d; }, laterDate);
    ok(true, `"Later date" ${laterDate} loads days from that date`);
    await page.locator('#puCtl [data-back]').click();
    await page.waitForFunction((d) => { const b = document.querySelector('#puDays .day'); return b && b.dataset.pu < d; }, laterDate);
    ok(true, 'Back to earliest dates returns to the short list');
    await page.waitForTimeout(500);
    await page.locator('#sec-delivery').screenshot({ path: `${OUT}/palomas-${name}-client.png` });
    await page.screenshot({ path: `${OUT}/palomas-${name}-form.png`, fullPage: true });
    // per-item pricing: standard struck through next to partnership price, all-in price after the extras
    await page.waitForTimeout(600); await page.waitForSelector('.li .li-all');
    const sumNow = await txt(page, '#sumBody');
    const stairsTxt = await txt(page, '#sumBody');
    ok(/Stairs — Arco Captiva Sofa, delivery \(1 flight × \$100\)/.test(stairsTxt) && !/Piece \d/.test(stairsTxt), 'stairs fee line appears automatically in the summary for the large piece, named after the item (1 flight × $100)');
    ok((await page.locator('.li').count()) === 5 && (await page.locator('.li .li-p s').count()) === 4, 'each line item shows its standard price struck through next to its partnership price');
    ok((await page.locator('.li .li-all').count()) === 5 && /After all discounts/.test(sumNow), 'with the 10% applying, each item also shows its price after all discounts');
    const money = (t) => Number(String(t).replace(/[^0-9.]/g, ''));
    const allIn = async () => (await page.locator('.li .li-all b').allInnerTexts()).map(money);
    const totalNow = async () => money(await page.locator('.sl.big .a').first().evaluate((e) => e.lastChild.textContent));
    const sumCents = (arr) => Math.round(arr.reduce((x, y) => x + y, 0) * 100);
    ok(sumCents(await allIn()) === Math.round((await totalNow()) * 100), `per-item all-in prices add up exactly to the total ($${(await allIn()).join(' + $')} = $${await totalNow()})`);
    ok((await page.locator('.sl.big .a s').count()) === 1, 'the total shows the standard total struck through, then the final total');
    ok(!/protection/i.test(sumNow) && !/Declared value protection/i.test(await page.content()), 'no declared value protection line or terms anywhere');
    ok(!/declared value/i.test(await page.content().then((h) => h.replace(/<script[\s\S]*?<\/script>/g, ''))), 'no declared value field or wording anywhere on the page');
    ok(!/cost less than|that's intended|that’s intended/i.test(sumNow) && /Delivery orders of \$1,000 or more \(after partnership pricing\) get an additional 10% off the whole delivery price\./.test(sumNow), 'the $1,000 note is precise ("after partnership pricing") and has no "that\'s intended" sentence');
    // staff options: collapsed, low key, courtesy checkbox
    ok(await page.locator('#more').getAttribute('aria-label') === 'More' && await page.locator('#more').getAttribute('aria-expanded') === 'false' && (await page.locator('#more').innerText()).trim() === '', 'a small unlabeled chevron: aria-label "More", no visible text, collapsed by default');
    ok((await page.locator('#morePanel').count()) === 0 && (await page.locator('#mc').count()) === 0, 'collapsed: the checkbox is not on the page at all');
    ok(!/courtesy|staff options|your call|discount/i.test(await page.locator('#more').evaluate((e) => e.outerHTML)), 'nothing in or around the arrow hints at a discount');
    ok(!/price sensitive/i.test(await page.evaluate(() => document.body.innerText + document.documentElement.innerHTML)), 'the words "price sensitive" appear nowhere in the client-facing page');
    ok(!/courtesy/i.test(await page.locator('#sumBody').innerText()) && !/courtesy/i.test(await page.locator('#sumBody').innerHTML()), 'nothing about the courtesy is in the summary (text or markup) while it is unchecked and collapsed');
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-checkout-collapsed.png` });
    ok(/Covers the delivery as quoted/.test(sumNow) && !/Paid in full at booking/i.test(sumNow) && (await page.locator('#feeNote').count()) === 0 && !/unexpected stairs|approval before/i.test(sumNow), 'copy under Due today: just "Covers the delivery as quoted", no extra stairs or access-fee text');
    // payment section: client pays now by default; the second option is hidden behind an unlabeled chevron
    ok(await page.locator('input[name=payer][value=client]').isChecked() && /Client pays now/.test(await txt(page, '.payer')) && (await page.locator('input[name=payer][value=palomas]').count()) === 0 && !/Paloma's Pay|Paloma's is paying/.test(await page.locator('#sumBody').innerText()), 'payment: "Client pays now" is the default; Paloma\'s Pay is not on the page while collapsed');
    ok(await page.locator('#payMore').getAttribute('aria-label') === 'More' && await page.locator('#payMore').getAttribute('aria-expanded') === 'false' && (await page.locator('#payMore').innerText()).trim() === '' && !/paloma|pay|courtesy|discount/i.test(await page.locator('#payMore').evaluate((e) => e.outerHTML.replace(/aria-label="More"|id="payMore"/g, ''))), 'second chevron under "Client pays now": aria-label "More", no visible text, collapsed by default');
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-pay-collapsed.png` });
    // staff code: locked prompt on the courtesy chevron
    ok((await page.locator('#pinInput').count()) === 0, 'no code prompt until a chevron is tapped');
    const before = await txt(page, '.sl.big');
    await page.locator('#more').click();
    ok(await page.locator('#pinInput').isVisible() && await page.locator('#pinInput').getAttribute('type') === 'password' && await page.locator('#pinInput').getAttribute('placeholder') === 'Code', 'tapping the arrow shows a small password field with the placeholder "Code"');
    ok((await page.locator('#morePanel').count()) === 0 && await page.locator('#more').getAttribute('aria-expanded') === 'false' && !/courtesy|discount|paloma's pay|manager/i.test(await page.locator('#pinForm').evaluate((e) => e.outerHTML.replace(/Palomas/g, ''))) , 'the prompt is neutral (no mention of courtesy, discount or Paloma\'s Pay) and nothing is revealed yet');
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-pin-locked.png` });
    await page.fill('#pinInput', 'nope'); await pressPin(page);
    await page.waitForFunction(() => document.querySelector('#pinInput') && document.querySelector('#pinInput').classList.contains('bad'));
    ok((await page.locator('#morePanel').count()) === 0 && (await page.locator('#mc').count()) === 0, 'a wrong code reveals nothing');
    await page.fill('#pinInput', 'palomas'); await pressPin(page);
    await page.waitForSelector('#morePanel');
    ok(await page.locator('#more').getAttribute('aria-expanded') === 'true' && await page.locator('#morePanel').isVisible() && (await page.locator('#pinInput').count()) === 0, 'the right code (any capitalization) expands the options and the prompt goes away');
    ok(!/Your call|no approval needed/i.test(await page.content()), 'the "Your call, no approval needed" text is gone everywhere');
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-checkout-expanded.png` });
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-pin-unlocked.png` });
    ok(/Manager's courtesy \(−15%\)/.test(await txt(page, '.mc')), 'the checkbox is labeled "Manager\'s courtesy (−15%)"');
    await page.locator('#mc').check();
    await page.waitForFunction(() => /Manager's courtesy/.test(document.querySelector('#sumBody').innerText) && document.querySelector('.sl.disc + .sl.disc, .sl.disc'));
    await page.waitForFunction(() => [...document.querySelectorAll('.sl.disc span:first-child')].some((e) => e.innerText === "Manager's courtesy"));
    const after = await txt(page, '.sl.big');
    ok(before !== after, `checking Manager's courtesy changes the total (${before} → ${after})`);
    ok(sumCents(await allIn()) === Math.round((await totalNow()) * 100), 'with both extras on, per-item all-in prices still add up exactly to the total');
    await page.locator('#mc').uncheck();
    await page.waitForFunction(() => ![...document.querySelectorAll('.sl.disc span:first-child')].some((e) => e.innerText === "Manager's courtesy"));
    ok(sumCents(await allIn()) === Math.round((await totalNow()) * 100), 'unchecking removes the courtesy line; the lines still add up');
    await page.locator('#mc').check();
    await page.waitForFunction(() => [...document.querySelectorAll('.sl.disc span:first-child')].some((e) => e.innerText === "Manager's courtesy"));
    await page.locator('#more').click();
    ok(await page.locator('#more').getAttribute('aria-expanded') === 'false' && (await page.locator('#mc').count()) === 0, 'staff taps the arrow again to collapse it');
    await page.selectOption('#aFlights', '2'); await page.waitForTimeout(700);
    await page.selectOption('#aFlights', '1'); await page.waitForTimeout(700);
    await page.waitForSelector('.li .li-all');
    ok(await page.locator('#more').getAttribute('aria-expanded') === 'false' && (await page.locator('#mc').count()) === 0, 'the arrow stays collapsed after the price recalculates');
    ok(/Manager's courtesy/.test(await txt(page, '#sumBody')) && !(await page.locator('#mc').isVisible()), "the applied \"Manager's courtesy\" line stays visible in the summary while the option itself stays tucked away");
    await page.locator('#summary').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/palomas-${name}-summary.png`, fullPage: false });
    // header copy: the "pick the pieces…" subtext is gone, the partnership pricing line stays
    ok(!/Pick the pieces|tell us where they go|you're done|you’re done/i.test(await page.content().then((h) => h.replace(/<script[\s\S]*?<\/script>/g, ''))), 'the "Pick the pieces, tell us where they go…" subtext is removed');
    ok(/Partnership pricing is applied automatically/.test(await txt(page, '.lede')), 'header keeps "Partnership pricing is applied automatically."');
    // payment block
    await page.locator('#summary').scrollIntoViewIfNeeded();
    const sumTxt = await txt(page, '#sumBody');
    ok(/Pay & lock in delivery/.test(await txt(page, '#place')), 'primary button reads "Pay & lock in delivery"');
    ok(await page.locator('input[name=payer][value=client]').isChecked(), 'client pays is the default');
    ok(/Payer: Pat Client · pat@example.com/.test(await txt(page, '#payerLine')), 'payer name and email are prefilled from the delivery info');
    ok(/Due today/.test(sumTxt) && (await page.locator('#cardNum').count()) === 1, 'checkout shows the amount due today and the card fields');
    ok(/Client can't pay now\? Email them a payment link\./.test(await txt(page, '#sendLink')) && !/Bill|Nothing to pay online/.test(sumTxt), 'small text link for the payment link; no more "billed to partner"');
    const linkBox = await page.locator('#sendLink').boundingBox(), btnBox = await page.locator('#place').boundingBox();
    ok(linkBox.height < btnBox.height * 0.75 && (await page.locator('#sendLink').evaluate((e) => getComputedStyle(e).textDecorationLine)) === 'underline', 'the payment link is a small underlined text link, not a big button');
    // already unlocked on this page: the payment chevron opens without asking again
    await page.locator('#payMore').click();
    ok((await page.locator('#pinInput').count()) === 0 && await page.locator('#payMore').getAttribute('aria-expanded') === 'true' && (await page.locator('input[name=payer][value=palomas]').count()) === 1, 'once unlocked, the payment chevron opens without asking for the code again (same page session)');
    ok(/Paloma's Pay/.test(await txt(page, '.payer')) && !/Paloma's is paying/.test(await txt(page, '.payer')), 'expanded option reads "Paloma\'s Pay"');
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-pay-expanded.png` });
    await page.locator('input[name=payer][value=palomas]').evaluate((e) => e.click());
    ok(/Payer: Paloma's Home Furnishings · palomas@palomascarmel.com/.test(await txt(page, '#payerLine')), 'choosing Paloma\'s Pay switches the payer to palomas@palomascarmel.com');
    ok((await page.locator('#cardNum').count()) === 1 && (await page.locator('#sendLink').count()) === 0, 'same card checkout stays; the email-a-link option is for the client only');
    await page.locator('input[name=payer][value=client]').evaluate((e) => e.click());
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-checkout.png` });
    // missing field handling
    await page.fill('#dEmail', '');
    await page.click('#place');
    ok(/Still needed/.test(await txt(page, '#sumBody')) && /Client email/.test(await txt(page, '#sumBody')), 'missing client email is flagged, nothing is charged');
    await page.fill('#dEmail', 'pat@example.com');
    await page.fill('#cardNum', '12');
    await page.click('#place');
    await page.waitForFunction(() => /Enter a card number/.test(document.querySelector('#sumBody').innerText));
    ok(true, 'a bad card number is flagged');
    await page.fill('#cardNum', '4242 4242 4242 4242');
    await page.fill('#dNotes', 'e2e ' + Date.now());
    await page.click('#place');
    await page.waitForSelector('.done');
    ok(/Delivery locked in/.test(await txt(page, '.done')) && /CAD-/.test(await txt(page, '.done')), 'path 1: card payment goes through, confirmation screen with order number');
    ok(/Paid today/.test(await txt(page, '.done .box')) && /by Pat Client/.test(await txt(page, '.done .box')), 'confirmation shows what was paid and that the client paid');
    ok(/Dave Tester/.test(await txt(page, '.done .box')), 'confirmation shows the Other name');
    await page.screenshot({ path: `${OUT}/palomas-${name}-done.png` });

    // quick re-fill helper for the other two paths
    const quick = async () => {
      await page.goto(BASE + '/palomas'); await page.waitForSelector('.pcard');
      await page.selectOption('#placedBy', 'Heather');
      await page.fill('#search', 'coffee table'); await page.locator('.pcard').first().click(); await page.fill('#search', '');
      await page.fill('#dName', 'Lee Buyer'); await page.fill('#dPhone', '8315550188'); await page.fill('#dEmail', 'lee@example.com');
      await page.fill('#dStreet', '5 Dolores St'); await page.fill('#dCity', 'Carmel-by-the-Sea'); await page.fill('#dZip', '93921');
      await page.selectOption('#aMode', 'ground');
      await page.fill('#dNotes', name + ' ' + Date.now() + Math.random());
      await page.waitForSelector('#datesBox:not([hidden])');
      await page.waitForFunction(() => /Due today/.test(document.querySelector('#sumBody').innerText));
    };
    const unlock = async (chev) => { await page.locator(chev).click(); await page.fill('#pinInput', 'Palomas'); await pressPin(page); await page.waitForFunction((c) => document.querySelector(c).getAttribute('aria-expanded') === 'true', chev); };
    // path 2: Paloma's Pay (needs the staff code)
    await quick();
    await unlock('#payMore');
    await page.locator('input[name=payer][value=palomas]').evaluate((e) => e.click());
    await page.click('#place');
    await page.waitForSelector('.done');
    ok(/Delivery locked in/.test(await txt(page, '.done')) && /by Paloma's Home Furnishings/.test(await txt(page, '.done .box')), 'path 2: Paloma\'s pays by card in the same checkout, billed to Paloma\'s');
    // path 3: email a payment link (courtesy applied), then the payment page the client opens
    const payPage = async (id) => {
      const p2 = await ctx.newPage();
      await p2.goto(`${BASE}/?order=${id}&pay=1`);
      await p2.waitForFunction(() => /Due today/.test(document.body.innerText), null, { timeout: 20000 });
      const t = await p2.evaluate(() => document.body.innerText);
      await p2.close();
      return t;
    };
    await quick();
    await unlock('#more');
    await page.locator('#mc').check();
    await page.waitForFunction(() => [...document.querySelectorAll('.sl.disc span:first-child')].some((e) => e.innerText === "Manager's courtesy"));
    await page.click('#sendLink');
    await page.waitForSelector('.done');
    const d3 = await txt(page, '.done');
    ok(/Payment link sent/.test(d3) && /lee@example.com/.test(d3) && /Awaiting payment — not scheduled until paid/.test(d3), 'path 3: payment link emailed, order shows "Awaiting payment — not scheduled until paid"');
    ok(!/Paid today/.test(await txt(page, '.done .box')), 'path 3: nothing is shown as paid');
    const id3 = (d3.match(/CAD-[A-Z0-9]+/) || [])[0];
    const pp = await payPage(id3);
    ok(/Manager's courtesy/.test(pp) && /Today.s price covers the delivery as quoted/.test(pp) && !/paid in full at booking/i.test(pp) && !/unexpected stairs|reschedule or adjust/.test(pp), 'payment-link page: the applied "Manager\'s courtesy" line and "Today’s price covers the delivery as quoted." (no "paid in full at booking")');
    ok(!/price sensitive/i.test(pp), 'payment-link page: no "price sensitive" wording');
    // path 3b: link with the courtesy left unchecked
    await quick();
    await page.click('#sendLink');
    await page.waitForSelector('.done');
    const id3b = ((await txt(page, '.done')).match(/CAD-[A-Z0-9]+/) || [])[0];
    const pp2 = await payPage(id3b);
    ok(!/courtesy/i.test(pp2) && /Due today/.test(pp2), 'payment-link page with the courtesy unchecked: no trace of it');
    await page.screenshot({ path: `${OUT}/palomas-${name}-link-sent.png` });
    // the payment chevron is locked on a fresh page too: prompt first, then Paloma's Pay appears
    await quick();
    await page.locator('#payMore').click();
    ok(await page.locator('#pinInput').isVisible() && (await page.locator('input[name=payer][value=palomas]').count()) === 0, "fresh page: tapping the payment chevron asks for the code and shows nothing else");
    await page.locator('#summary .sticky').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.locator('#summary .sticky').screenshot({ path: `${OUT}/palomas-${name}-pay-pin-locked.png` });
    await page.fill('#pinInput', 'Palomas'); await pressPin(page);
    await page.waitForSelector('input[name=payer][value=palomas]', { state: 'attached' });
    ok(await page.locator('input[name=payer][value=client]').isChecked(), "after unlocking, Paloma's Pay is offered but \"Client pays now\" stays selected");
    ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
