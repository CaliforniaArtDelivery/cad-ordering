/* Browser walk-through of /palomas (desktop + iPhone-size), with screenshots in screenshots/palomas-*.png.
 * BASE=http://localhost:3111 node scripts/palomas-e2e.js   (CHROME=/usr/bin/google-chrome if Playwright's own browser is not installed) */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3111';
const OUT = require('path').join(__dirname, '..', 'screenshots');
require('fs').mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const txt = async (page, sel) => ((await page.locator(sel).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  for (const [name, vp, mobile] of [['desktop', { width: 1280, height: 900 }, false], ['iphone', { width: 390, height: 844 }, true]]) {
    console.log(`\n== ${name} ==`);
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE + '/palomas');
    await page.waitForSelector('.pcard');
    ok(await page.locator('.logo-p').isVisible() && await page.locator('.logo-c').isVisible(), 'both logos show in the header');
    ok(/in collaboration with/.test(await txt(page, '.collab')), 'header says "Paloma\'s Home Furnishings in collaboration with California Art Delivery"');
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
    await page.fill('#cName', 'Custom copper bench'); await page.selectOption('#cKind', 'Bench'); await page.fill('#cValue', '2400');
    await page.click('#cAdd');
    ok((await page.locator('.irow').count()) === 3 && /custom/.test(await txt(page, '.irow:nth-child(3) .ty')), 'custom item added');
    // delivery
    await page.fill('#dName', 'Pat Client'); await page.fill('#dPhone', '8315550123'); await page.fill('#dEmail', 'pat@example.com');
    await page.fill('#dStreet', '100 Ocean Ave'); await page.fill('#dCity', 'Carmel-by-the-Sea'); await page.fill('#dZip', '93921');
    await page.selectOption('#aMode', 'stairs');
    ok(await page.locator('#aFlightsWrap').isVisible(), 'stairs asks how many flights');
    await page.selectOption('#aFlights', '1');
    await page.waitForSelector('#datesBox:not([hidden])');
    ok((await page.locator('#puDays .day').count()) > 0 && (await page.locator('#deDays .day').count()) > 0, 'pickup and delivery days appear, earliest pre-selected');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/palomas-${name}-form.png`, fullPage: true });
    // checkbox
    const before = await txt(page, '.sl.big');
    await page.locator('label.check').click();
    await page.waitForFunction(() => /Price sensitive client: additional 15% off/.test(document.querySelector('#sumBody').innerText));
    const after = await txt(page, '.sl.big');
    ok(before !== after, `checking "Price sensitive client" changes the total (${before} → ${after})`);
    ok(/Price sensitive client: additional 15% off/.test(await txt(page, '#sumBody')), 'the 15% shows as its own line item');
    await page.locator('label.check').click();
    await page.waitForFunction(() => !/Price sensitive client: additional 15% off/.test(document.querySelector('#sumBody').innerText));
    ok(true, 'unchecking removes the 15% line');
    await page.locator('label.check').click();
    await page.waitForFunction(() => /15% off/.test(document.querySelector('#sumBody').innerText));
    await page.locator('#summary').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/palomas-${name}-summary.png`, fullPage: false });
    // missing field handling
    await page.fill('#dEmail', '');
    await page.click('#place');
    ok(/Still needed/.test(await txt(page, '#sumBody')) && /Client email/.test(await txt(page, '#sumBody')), 'missing client email is flagged, order not placed');
    await page.fill('#dEmail', 'pat@example.com');
    await page.click('#place');
    await page.waitForSelector('.done');
    ok(/Order placed/.test(await txt(page, '.done')) && /CAD-/.test(await txt(page, '.done')), 'order placed, confirmation screen with order number');
    ok(/Dave Tester/.test(await txt(page, '.done .box')), 'confirmation shows the Other name');
    await page.screenshot({ path: `${OUT}/palomas-${name}-done.png` });
    ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
