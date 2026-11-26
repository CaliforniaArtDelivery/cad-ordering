/* Kaila's two Paloma's fixes, in a real browser at 1280 and 390 wide (Nov 19 2026):
 *   - every item has a clearly visible "Remove" button (tap target 44px+, totals update at once, Undo, last item handled)
 *   - the staff / employee discount code is a visible, labeled field in the order summary
 * Never places an order and never touches payment. Safe against the deployed test site.
 *   BASE=https://cad-ordering-test.onrender.com SHOTS=/workspace/palomas-fix-nov19 CHROME=/usr/bin/google-chrome node scripts/palomas-fixes-nov19-ui.js */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3111';
const SHOTS = process.env.SHOTS || '/tmp/palomas-fix-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const stepOf = (p) => p.evaluate(() => { const el = [...document.querySelectorAll('[data-step]')].find((x) => !x.hidden); return el ? el.dataset.step : ''; });
const nextTo = async (p, id) => { for (let n = 0; n < 10; n++) { if ((await stepOf(p)) === id) return; await p.locator('#nextBtn').click(); await p.waitForTimeout(300); } throw new Error('no step ' + id + ' at ' + (await stepOf(p))); };
const settle = (p) => p.waitForFunction(() => { const b = document.querySelector('#barTotal'); return b && !/Updating|—/.test(b.textContent); }, null, { timeout: 20000 });
const total = (p) => p.locator('#barTotal').innerText();
const shot = async (p, name, loc) => { const f = `${SHOTS}/${name}.png`; if (loc) await loc.screenshot({ path: f }); else await p.screenshot({ path: f }); console.log('   shot', f); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  for (const [label, w, h, mob] of [['1280', 1280, 900, false], ['390', 390, 844, true]]) {
    console.log(`\n== ${label}px wide ==`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/palomas'); await page.waitForSelector('#placedBy');
    await page.selectOption('#placedBy', 'Arnie');
    await nextTo(page, 'items'); await page.waitForSelector('.pcard');
    // add three catalog pieces
    for (const q of ['coffee table', 'lamp', 'mirror']) { await page.fill('#search', q); await page.locator('.pcard').first().click(); }
    await page.fill('#search', '');
    await page.waitForSelector('.irow'); await settle(page);
    const rows = page.locator('.irow'); const n = await rows.count();
    ok(n === 3, `three different items added (${n} rows)`);
    const btns = page.locator('.irow .rm');
    let allOk = true;
    for (let i = 0; i < n; i++) { const b = btns.nth(i); const bb = await b.boundingBox(); const t = (await b.innerText()).replace(/\s+/g, ' ').trim(); if (!(bb && bb.height >= 44 && bb.width >= 44 && /Remove/.test(t) && /✕/.test(t) && (await b.isVisible()))) allOk = false; }
    ok(allOk, 'every item row has a visible "✕ Remove" button, at least 44 x 44 px');
    ok(await btns.first().evaluate((e) => getComputedStyle(e).borderTopWidth !== '0px' && getComputedStyle(e).color !== 'rgb(91, 100, 114)'), 'the Remove button has a visible border and its own colour (not a faint grey ×)');
    await rows.first().scrollIntoViewIfNeeded();
    await shot(page, `palomas-fix-${label}-items-remove-buttons`, page.locator('#sec-items'));
    const t3 = await total(page);
    const lastName = (await rows.nth(2).locator('.nm').innerText()).trim();
    await btns.nth(2).click();
    await settle(page);
    ok((await page.locator('.irow').count()) === 2 && !(await page.locator('#items').innerText()).includes('Remove ' + lastName) , `removing "${lastName}" takes it off the list`);
    const t2 = await total(page);
    ok(t2 !== t3, `the total updates right away (${t3} → ${t2})`);
    ok(await page.locator('.undo').isVisible() && /Removed/.test(await page.locator('.undo').innerText()), 'a "Removed … Undo" line appears');
    await shot(page, `palomas-fix-${label}-item-removed-undo`, page.locator('#sec-items'));
    await page.locator('[data-undo]').click(); await settle(page);
    ok((await page.locator('.irow').count()) === 3 && (await total(page)) === t3, `Undo puts the item back (${await total(page)} again)`);
    // remove everything: handled sensibly
    for (let i = 0; i < 3; i++) { await page.locator('.irow .rm').first().click(); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    ok((await page.locator('.irow').count()) === 0 && /Nothing added yet/.test(await page.locator('#items').innerText()), 'removing the last item leaves a clear empty list, not a broken one');
    await page.locator('#nextBtn').click(); await page.waitForTimeout(400);
    ok((await stepOf(page)) === 'items' && /at least one item/i.test(await page.locator('#sec-items').innerText()), 'Next is blocked with "add at least one item" until something is added');
    await page.locator('[data-undo]').click(); await settle(page);
    ok((await page.locator('.irow').count()) === 1, 'Undo after removing the last item brings it back');
    // add the other two again so the order has items to price
    for (const q of ['coffee table', 'lamp']) { await page.fill('#search', q); await page.locator('.pcard').first().click(); }
    await page.fill('#search', ''); await settle(page);
    // item added then removed again (the mistake case)
    const before = await page.locator('.irow').count(); const tBefore = await total(page);
    await page.fill('#search', 'chandelier'); await page.locator('.pcard').first().click(); await page.fill('#search', ''); await settle(page);
    ok((await page.locator('.irow').count()) === before + 1, 'an item added by mistake…');
    await page.locator('.irow .rm').last().click(); await settle(page);
    ok((await page.locator('.irow').count()) === before && (await total(page)) === tBefore, `…is removed again and the total goes back (${tBefore})`);
    // two clients
    await nextTo(page, 'client');
    await page.fill('#dName', 'Pat Client'); await page.fill('#dPhone', '8315550123'); await page.fill('#dEmail', 'pat@example.com');
    await page.click('#addClient'); await page.fill('#c2Name', 'Sam Client'); await page.fill('#c2Phone', '8315550199'); await page.fill('#c2Email', 'sam@example.com');
    ok(await page.locator('#client2').isVisible(), 'two clients added (they share the one delivery address)');
    await shot(page, `palomas-fix-${label}-two-clients`, page.locator('#sec-delivery'));
    await nextTo(page, 'address');
    await page.fill('#dStreet', '100 Ocean Ave'); await page.fill('#dCity', 'Carmel-by-the-Sea'); await page.fill('#dZip', '93921');
    await nextTo(page, 'access'); await page.selectOption('#aMode', 'ground');
    await nextTo(page, 'dates');
    await page.waitForSelector('#datesPair .date-pair');
    await nextTo(page, 'review');
    await page.waitForFunction(() => /Due today/.test((document.querySelector('#sumBody') || {}).textContent || '')); await settle(page);
    // staff discount field
    const lab = page.locator('label[for=staffCode]');
    await lab.scrollIntoViewIfNeeded();
    ok(await lab.isVisible() && /Staff \/ employee discount code/.test(await lab.innerText()), 'the field is visible and labeled "Staff / employee discount code"');
    const box = await page.locator('#staffCode').boundingBox(); const bar = await page.locator('#bar').boundingBox();
    ok(box.height >= 44 && (await page.locator('#staffApply').boundingBox()).height >= 44, 'field and Apply button are at least 44px tall');
    await page.locator('#staffCode').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    const b2 = await page.locator('#staffApply').boundingBox();
    ok(b2.y + b2.height <= bar.y + 1 || b2.y >= bar.y + bar.height, 'the Apply button is not hidden behind the bottom bar');
    await shot(page, `palomas-fix-${label}-discount-field`, page.locator('#sumBody'));
    const tot0 = await total(page);
    await page.fill('#staffCode', 'wrong'); await page.click('#staffApply');
    await page.waitForFunction(() => /isn.t valid/.test(document.querySelector('.sc-msg').innerText));
    ok((await total(page)) === tot0, 'a wrong code shows "That code isn\'t valid" and changes nothing');
    await page.fill('#staffCode', 'Palomas'); await page.click('#staffApply');
    await page.waitForSelector('#staffBox'); await page.waitForFunction(() => [...document.querySelectorAll('.sl.disc span:first-child')].some((e) => e.innerText === "Manager's courtesy")); await settle(page);
    const tot1 = await total(page);
    ok(/Code accepted/.test(await page.locator('#staffBox').innerText()) && tot1 !== tot0, `the code is accepted and Manager's courtesy (−15%) applies (${tot0} → ${tot1})`);
    await page.locator('#staffBox').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    await shot(page, `palomas-fix-${label}-discount-applied`, page.locator('#sumBody'));
    await shot(page, `palomas-fix-${label}-review-full`);
    ok(!/call us|speak with|\(\d{3}\) \d{3}-\d{4}/i.test(await page.evaluate(() => document.body.innerText)), 'no phone numbers or "call us" text on the page');
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('   (stopped before payment: nothing was submitted)');
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
