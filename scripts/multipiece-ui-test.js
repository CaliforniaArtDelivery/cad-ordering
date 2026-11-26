// Browser half of scripts/multipiece-test.js (headless Chromium, iPhone-sized 390×844).
const fs = require('fs');
const path = require('path');
const pw = require('playwright');

exports.uiTests = async (H) => {
  const { ok, hdr, BASE, SHOTS, post, orders, sleep, near } = H;
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  let lastQuote = null;
  page.on('response', async (r) => { if (/\/api\/quote$/.test(r.url()) && r.request().method() === 'POST') { try { lastQuote = { req: JSON.parse(r.request().postData()), res: await r.json() }; } catch {} } });
  const PHOTO = path.join(__dirname, 'sample-artwork.png');
  const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 });

  const settle = () => page.waitForFunction(() => !/Updating estimate/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const blocked = async () => { await settle(); return page.$eval('#nextBtn', (b) => !!(b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('is-wait'))); };
  const next = async () => { await settle(); try { await page.click('#nextBtn:not([disabled]):not([aria-disabled="true"])', { timeout: 8000 }); } catch (e) { throw new Error('Next was blocked on ' + (await panel()) + ': ' + (await page.evaluate(() => { const b = document.querySelector('#nextBtn'); return b.className + ' | ' + (document.querySelector('.dock') || document.body).innerText.slice(0, 300); }))); } await page.waitForTimeout(350); };
  const panel = () => page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? p.dataset.panel : ''; });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
  const fill = (p, v) => page.fill(`[data-path="${p}"]`, String(v));
  const shot = async (name, full) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full, style: full ? '.dock{position:relative!important}' : undefined }); };
  const freshStart = async (service = 'pickup_delivery') => {
    await page.goto(BASE); await page.evaluate(() => (sessionStorage.clear(), localStorage.clear())); await page.goto(BASE);
    await page.waitForSelector('[data-service]'); await page.click(`[data-service="${service}"]`); await settle(); await next();
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // Fill one piece through its three screens; ends on the "Anything else" list.
  async function fillPiece(i, s = {}) {
    if (s.type && s.type !== 'painting') { await page.click(`[data-itemtype="${i}"] [data-v="${s.type}"]`); await page.waitForTimeout(150); }
    await fill(`items.${i}.description`, s.desc || 'Canvas'); await next();
    if ((await panel()) === `p${i}b`) {
      await fill(`items.${i}.w`, s.w ?? 72); await fill(`items.${i}.h`, s.h ?? 60); await fill(`items.${i}.d`, s.d ?? 2);
      if (await page.$(`[data-seg="items.${i}.framed"]`)) await page.click(`[data-seg="items.${i}.framed"] [data-v="no"]`); if (await page.$(`[data-seg="items.${i}.glazing"]`)) await page.click(`[data-seg="items.${i}.glazing"] [data-v="no"]`);
      await next();
    }
    if (s.value !== undefined) await fill(`items.${i}.value`, s.value);
    if (s.unsure) await page.click(`[data-weightunsure="${i}"]`);
    else if (s.weight !== undefined) await fill(`items.${i}.weight`, s.weight);
    if (s.fragile) await page.click(`label.toggle:has([data-path="items.${i}.fragile"])`);
    if (s.photo) { await page.setInputFiles(`[data-upload="${i}"]`, PHOTO); await page.waitForFunction((n) => JSON.parse(localStorage.getItem('cad-order')).items[n].photos.length > 0, i, { timeout: 8000 }); await page.waitForTimeout(300); }
    if (s.fragile && !s.photo) { await page.click('#nextBtn', { force: true }); await page.waitForTimeout(350); } // blocked on purpose: special handling needs a photo
    else await next();
  }
  const rowCount = () => page.locator('[data-piece-row]').count();
  const freshQuoteMatches = async (label) => {
    await settle(); await page.waitForTimeout(200); await settle();
    const body = lastQuote && lastQuote.req; const st = await state();
    const q = (await post('/api/quote', body)).j;
    const est = (await page.textContent('#estTotal')).trim();
    ok(body && body.items.length === st.items.length, `${label}: the last quote request carries all ${st.items.length} pieces`, body && body.items.length);
    ok(est === fmt(q.total), `${label}: the estimate (${est}) equals a fresh server quote (${fmt(q.total)}), nothing stale`, [est, q.total]);
    return q;
  };

  // ---------------- U0: legacy draft in the browser ----------------
  async function toReview(onPanel) {
    const VAL = { 'contact.name': 'Jordan Lee', 'contact.email': 'jordan@example.com', 'contact.phone': '3105550199', 'pickup.street': '8678 Melrose Ave', 'pickup.city': 'West Hollywood', 'pickup.zip': '90069', 'pickup.contactName': 'Andrea B', 'pickup.contactPhone': '3105550101', 'dropoff.street': '1200 Summit Ridge Dr', 'dropoff.city': 'Beverly Hills', 'dropoff.zip': '90210', 'dropoff.contactName': 'Jordan Lee', 'dropoff.contactPhone': '3105550199' };
    await next(); // list -> Where
    for (let n = 0; n < 40 && (await panel()) !== 'review'; n++) {
      if (onPanel) await onPanel(await panel());
      const v = await page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return [...p.querySelectorAll('input,select,textarea,[data-seg]')].filter((e) => e.offsetParent).map((e) => ({ k: e.dataset.path || e.dataset.seg || e.id, t: e.tagName, v: e.value, opts: e.tagName === 'SELECT' ? [...e.options].map((o) => o.value) : undefined })); });
      for (const f of v) {
        if (VAL[f.k] !== undefined && f.t === 'INPUT' && !f.v) await page.fill(`[data-path="${f.k}"]`, VAL[f.k]);
        else if (f.t === 'SELECT' && !f.v && f.opts) await page.selectOption(`[data-path="${f.k}"]`, f.k === 'heard.source' ? 'google' : f.opts[1]);
        else if (f.t === 'DIV' && /^(pickup|dropoff)\./.test(f.k) && !(await page.$(`[data-seg="${f.k}"] button.on`))) { await page.click(`[data-seg="${f.k}"] button >> nth=0`); await page.waitForTimeout(120); }
      }
      if (await page.locator('[data-reqblock="date"] .day:not(.rush):visible').count()) { await page.click('[data-reqblock="date"] .day:not(.rush):visible >> nth=0'); await page.waitForTimeout(250); }
      if (await page.locator('[data-deldate]:not([data-off]):visible').count()) { await page.click('[data-deldate]:not([data-off]):visible >> nth=0'); await page.waitForTimeout(250); }
      await next();
    }
  }

  if (!process.env.UI_LATE_ONLY) {
  hdr('UI 0: an old saved draft with a quantity (refresh never shows one piece as ten)');
  {
    await page.goto(BASE); await page.evaluate(() => (sessionStorage.clear(), localStorage.clear()));
    await page.evaluate(() => { sessionStorage.setItem('cad-order', JSON.stringify({ service: 'pickup_delivery', items: [{ qty: 3, type: 'painting', description: 'Old canvas', w: 40, h: 30, d: 2, framed: 'no', value: '3,000' }, { type: 'painting', description: 'Single', w: 40, h: 30, d: 2, framed: 'no', value: '1,000' }] })); sessionStorage.setItem('cad-step', '0'); sessionStorage.setItem('cad-sub', 'pieces-more'); });
    await page.goto(BASE); await page.waitForSelector('[data-piece-row]');
    const st = await state();
    ok((await rowCount()) === 4, 'draft with qty 3 + 1 loads as 4 separate pieces', await rowCount());
    ok((await page.locator('[data-piece-row] .pc-title').allTextContents()).join('|') === 'Piece 1 — Old canvas|Piece 2 — Old canvas|Piece 3 — Old canvas|Piece 4 — Single', 'labels: Piece 1–3 Old canvas, Piece 4 Single');
    ok(st.items.map((i) => !!i.checkValue).join() === 'false,true,true,false', 'the two expanded copies of the old draft are flagged Check value; the original entry and the single piece are not', st.items.map((i) => i.checkValue));
    const ids = await page.$$eval('[data-piece-id]', (e) => e.map((x) => x.dataset.pieceId));
    await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('cad-order')); sessionStorage.setItem('cad-order', JSON.stringify(o)); });
    ok(new Set(ids).size === 4 && (st.items || []).every((i) => !('qty' in i)), 'unique ids and no qty field in the saved draft', ids);
    await page.reload(); await page.waitForSelector('[data-piece-row]');
    ok((await rowCount()) === 4 && (await page.$$eval('[data-piece-id]', (e) => e.map((x) => x.dataset.pieceId))).join() === ids.join(), 'a second refresh keeps the same 4 pieces and ids (no duplicates)');
    const q = await freshQuoteMatches('legacy draft');
    ok(q.protection && q.protection.pieces.length === 4, 'legacy draft quote has four protected pieces');
  }

  // ---------------- U1: one piece ----------------
  hdr('UI 1: one piece, no quantity box');
  await freshStart();
  ok((await panel()) === 'p0a', 'first screen is Piece 1');
  ok((await page.locator('[data-path$=".qty"]').count()) === 0 && !/\bQty\b/.test(await page.content()), 'there is no quantity control anywhere');
  await shot('01-what-is-it');
  await fillPiece(0, { desc: 'Canvas', value: 12000, fragile: true, photo: true });
  ok((await panel()) === 'pieces-more', 'after the value screen we land on "Anything else to deliver?"');
  {
    const t = await page.textContent('[data-panel="pieces-more"] h1');
    ok(/Anything else to deliver\?/.test(t), 'heading: Anything else to deliver?');
    ok((await page.textContent('[data-piece-row="0"] .pc-title')) === 'Piece 1 — Canvas', 'list row reads "Piece 1 — Canvas"');
    ok(/Painting · 72 × 60 × 2 in · \$12,000 · special handling/.test(await page.textContent('[data-piece-row="0"] .pc-facts')), 'row facts: type, size, value, special handling', await page.textContent('[data-piece-row="0"] .pc-facts'));
    const acts = (await page.textContent('[data-piece-row="0"] .pc-actions')).replace(/\s+/g, ' ').trim();
    ok(/Edit.*Duplicate/.test(acts) && !/Remove/.test(acts), 'one piece: Edit · Duplicate (Remove hidden: an order needs a piece)', acts);
    ok((await page.locator('[data-quick]').count()) === 0, 'Quick edit pieces appears only when there are several pieces');
    await freshQuoteMatches('1 piece');
    ok((await page.textContent('#estTotal')).trim() === '$480', '1 piece 72×60, $12,000: estimate $480 ($200 delivery + $100 oversize + $180 protection)', await page.textContent('#estTotal'));
    await shot('02-piece-list-one-piece');
  }

  // ---------------- U2: duplicate ----------------
  hdr('UI 2: Duplicate asks how many, copies details, flags value, never copies photos silently');
  await page.click('[data-dupopen]'); await page.waitForSelector('[data-dupdialog]');
  {
    const d = (await page.textContent('[data-dupdialog]')).replace(/\s+/g, ' ');
    ok(/How many additional pieces would you like to create\?/.test(d), 'dialog asks: How many additional pieces would you like to create?');
    ok(/We’ll copy the details from this piece\. You can edit each copy before submitting your request\./.test(d), 'dialog note: We’ll copy the details from this piece. You can edit each copy before submitting your request.');
    ok(/Use this piece’s photos on the copies/.test(d), 'the piece has photos, so it offers to reuse them (off by default)');
    ok(!(await page.$eval('#dup-photos', (e) => e.checked)), 'reuse-photos is OFF by default');
    ok((await page.textContent('#dupGo')) === 'Create 1 piece', 'button starts as "Create 1 piece"');
    await page.fill('#dup-n', '3');
    ok((await page.textContent('#dupGo')) === 'Create 3 pieces', 'button updates to "Create 3 pieces"');
    ok((await overflow()) <= 0, 'no sideways scrolling with the dialog open at 390px', await overflow());
    await shot('03-duplicate-dialog');
  }
  await page.click('#dupGo'); await page.waitForTimeout(300);
  {
    const st = await state();
    ok(st.items.length === 4 && (await rowCount()) === 4, 'three copies created: 4 pieces');
    const [a, ...copies] = st.items;
    ok(new Set(st.items.map((i) => i.id)).size === 4, 'all four pieces have different ids');
    ok(copies.every((c) => c.value === '12000' && c.description === 'Canvas' && c.w === '72' && c.fragile === true && c.type === 'painting'), 'copies keep description, size, value and special handling');
    ok(copies.every((c) => c.photos.length === 0) && a.photos.length === 1, 'photos were NOT copied (original keeps its photo)');
    ok(copies.every((c) => c.checkValue === true) && a.checkValue === false, 'copies are flagged check value; the original is not');
    ok((await page.locator('[data-piece-row] [data-checkvalue]').count()) === 3, 'three "Check value" tags on the list');
    ok((await page.locator('[data-piece-row].incomplete').count()) === 3 && /Please add a photo of this piece/.test(await page.textContent('[data-piece-row="1"]')), 'copies with special handling need their own photos: "Needs details" with a link to the missing photo');
    ok(await blocked(), 'Next is blocked while a piece is incomplete');
    await freshQuoteMatches('4 pieces');
    await shot('04-after-duplicate-flags');
    // the fix link goes to that piece's screen
    await page.click('[data-fixpiece="1"]'); await page.waitForTimeout(300);
    ok((await panel()) === 'p1c', 'the "Needs details" link jumps to Piece 2, Value and care', await panel());
    ok(/Piece 2/.test(await page.textContent('[data-panel="p1c"] .piece-tag')) && /Please check its value/.test(await page.textContent('[data-panel="p1c"]')), 'that screen is labeled Piece 2 and asks to check the copied value');
    await shot('05-copy-check-value-and-photo');
    await page.click('[data-panel="p1c"] [data-valok]'); await page.waitForTimeout(200);
    ok((await state()).items[1].checkValue === false && (await state()).items[2].checkValue === true, '"Value is right" clears the flag for this piece only');
    await page.setInputFiles('[data-upload="1"]', PHOTO); await page.waitForFunction(() => JSON.parse(localStorage.getItem('cad-order')).items[1].photos.length > 0); await page.waitForTimeout(300);
    ok((await state()).items[1].photos.length === 1 && (await state()).items[2].photos.length === 0 && (await state()).items[0].photos.length === 1, 'Piece 2\'s photo went to Piece 2 only');
    await page.goBack(); await page.waitForTimeout(400); // browser Back returns to the list
    ok((await panel()) === 'pieces-more' && (await rowCount()) === 4, 'browser Back returns to the list with all 4 pieces');
  }
  // remove the two incomplete copies (with confirmation), then add 28 copies that reuse photos
  hdr('UI 3: remove asks first; labels renumber; recalculates right away');
  {
    const before = (await state()).items.map((i) => i.id);
    await page.click('[data-piece-row="3"] [data-removeask]');
    ok(/Remove Piece 4 — Canvas\?/.test(await page.textContent('[data-piece-row="3"] .pc-confirm')), 'Remove asks: "Remove Piece 4 — Canvas?"');
    await shot('06-remove-confirm');
    await page.click('[data-piece-row="3"] [data-removeno]'); await page.waitForTimeout(150);
    ok((await state()).items.length === 4 && (await page.locator('.pc-confirm').count()) === 0, '"Keep it" removes nothing');
    await page.click('[data-piece-row="3"] [data-removeask]'); await page.click('[data-removeyes]'); await page.waitForTimeout(300);
    let st = await state();
    ok(st.items.length === 3 && st.items.map((i) => i.id).join() === before.slice(0, 3).join(), '"Yes, remove" removes exactly Piece 4; the others keep their ids');
    await freshQuoteMatches('after removing Piece 4');
    await page.click('[data-piece-row="2"] [data-removeask]'); await page.click('[data-removeyes]'); await page.waitForTimeout(300);
    st = await state();
    ok(st.items.length === 2 && !(await blocked()), 'two complete pieces left: Next is allowed again');
  }
  hdr('UI 4: 30 pieces');
  {
    await page.click('[data-piece-row="0"] [data-dupopen]'); await page.waitForSelector('#dup-n');
    ok((await page.getAttribute('#dup-n', 'max')) === '58', 'the count is capped so the order stays within 60 pieces (max 58 more)');
    await page.fill('#dup-n', '28'); await page.click('label.toggle:has(#dup-photos)'); ok((await page.textContent('#dupGo')) === 'Create 28 pieces', 'button: Create 28 pieces');
    await page.click('#dupGo'); await page.waitForTimeout(500);
    const st = await state();
    ok(st.items.length === 30 && (await rowCount()) === 30, '30 pieces on the list', st.items.length);
    ok(new Set(st.items.map((i) => i.id)).size === 30, '30 different ids');
    ok(st.items.slice(1).filter((i, n) => n !== 0).every((i) => i.photos.length === 1) , 'with "use this piece\'s photos" ON the 28 copies carry the photo');
    ok(!(await blocked()), 'all 30 complete: Next allowed');
    const q = await freshQuoteMatches('30 pieces');
    ok(q.total === 10125 && (await page.textContent('#estTotal')).trim() === '$10,125', '30 × 72×60 painting at $12,000 = $10,125 ($1,725 + $3,000 + $5,400)', q.total);
    ok(q.lines.filter((l) => /^Declared value protection — Piece/.test(l.label)).length === 30, 'quote has 30 per-piece protection lines');
    ok((await overflow()) <= 0, 'list of 30 pieces has no sideways scroll at 390px', await overflow());
    await shot('07-thirty-pieces-list');
    // keep the pieces list light: the Quick edit block is collapsed by default
    ok(!(await page.$eval('details[data-quick]', (d) => d.open)), 'Quick edit pieces is collapsed by default');
  }

  hdr('UI 5: Quick edit pieces; editing Piece 7 changes only Piece 7');
  {
    const before = (await state()).items.map((i) => JSON.stringify(i));
    await page.click('details[data-quick] > summary'); await page.waitForTimeout(200);
    ok((await page.locator('details[data-qpiece]').count()) === 30 && (await page.locator('details[data-qpiece][open]').count()) === 0, '30 collapsed rows in Quick edit pieces');
    await page.click('details[data-qpiece]:nth-of-type(7) > summary'); await page.waitForTimeout(200);
    // nth-of-type counts the details siblings inside .qlist
    const row7 = (await page.$$('details[data-qpiece]'))[6];
    ok((await row7.textContent()).includes('Piece 7 — Canvas'), 'row 7 is Piece 7 — Canvas');
    await shot('08-quick-edit-open');
    await page.fill('#q-items\\.6\\.value', '60000');
    await page.fill('#q-items\\.6\\.description', 'Large canvas');
    await page.waitForTimeout(200);
    const st = await state(); const after = st.items.map((i) => JSON.stringify(i));
    const changed = after.map((a, i) => (a !== before[i] ? i : -1)).filter((i) => i >= 0);
    ok(changed.join() === '6', 'only Piece 7 changed (index 6); the other 29 are byte-for-byte the same', changed);
    ok(st.items[6].value === '60000' && st.items[6].description === 'Large canvas' && st.items[6].checkValue === false, 'Piece 7 now: Large canvas, $60,000, check-value cleared by editing');
    ok(st.items[7].value === '12000' && st.items[7].checkValue === true, 'Piece 8 still $12,000 and still flagged');
    const q = await freshQuoteMatches('after editing Piece 7');
    // 1725 + 3000 + 0.75% of $60,000 built into Piece 7 ($450) + 29 × 180
    ok(near(q.total, 1725 + 3000 + 450 + 29 * 180) && near(q.total, 10395), 'total = $10,395 by hand: $1,725 + $3,000 + $450 built into Piece 7 (0.75% of $60,000) + 29 × $180', q.total);
    ok(q.lines.filter((l) => /^Declared value protection/.test(l.label)).length === 29 && !q.lines.some((l) => /Piece 7 .*protection|protection.*Piece 7 /.test(l.label)), 'Piece 7 ($60,000) lost its protection line; 29 remain');
    await page.waitForTimeout(150);
    const t7 = await page.textContent('[data-piece-row="6"] .pc-title');
    ok(t7 === 'Piece 7 — Large canvas', 'list title follows the edit (Piece 7 — Large canvas)', t7);
    ok((await overflow()) <= 0, 'Quick edit open at 390px: no sideways scroll', await overflow());
    // mobile-friendly: inputs inside are at least 40px tall and inside the viewport width
    const geo = await page.$eval('#q-items\\.6\\.value', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right }; });
    ok(geo.h >= 40 && geo.right <= 390 && geo.w > 120, 'Quick edit inputs are finger-sized and fit the 390px width', geo);
    // weight "Not sure" and special handling from Quick edit
    await page.click('details[data-qpiece][open] [data-weightunsure]'); await page.waitForTimeout(250);
    ok((await state()).items[6].weightUnsure === true && (await state()).items[5].weightUnsure === false, 'Not sure (weight) toggles on Piece 7 only');
    ok((await page.$$eval('details[data-qpiece][open]', (e) => e.length)) === 1, 'the open row stays open after a change');
    await page.click('details[data-qpiece][open] [data-weightunsure]'); await page.waitForTimeout(200);
  }

  hdr('UI 6: remove Piece 4 from 30');
  {
    const ids0 = (await state()).items.map((i) => i.id);
    await page.click('details[data-quick] > summary'); await page.waitForTimeout(150);
    await page.click('[data-piece-row="3"] [data-removeask]'); await page.click('[data-removeyes]'); await page.waitForTimeout(400);
    const st = await state(); const ids1 = st.items.map((i) => i.id);
    ok(ids1.length === 29 && ids1.join() === ids0.filter((_, i) => i !== 3).join(), 'Piece 4 removed; every other piece keeps its id');
    ok((await page.textContent('[data-piece-row="3"] .pc-title')) === 'Piece 4 — Canvas' && (await page.getAttribute('[data-piece-row="3"]', 'data-piece-id')) === ids0[4], 'the old Piece 5 is now labeled Piece 4 (labels renumber, ids do not)');
    ok((await page.textContent('[data-piece-row="5"] .pc-title')) === 'Piece 6 — Large canvas', 'the $60,000 piece moved from 7 to 6 and kept its description');
    const q = await freshQuoteMatches('29 pieces after removal');
    // 575 + 22×50 = 1675; 2900 oversize; $450 built into the $60,000 piece; 28 × 180
    ok(near(q.total, 1675 + 2900 + 450 + 28 * 180) && near(q.total, 10065), 'total recalculated right away: $10,065 = $1,675 + $2,900 + $450 + 28 × $180', q.total);
  }

  hdr('UI 7: an incomplete piece blocks the quote and links to the missing field');
  {
    await page.click('details[data-quick] > summary'); await page.waitForTimeout(150);
    await page.click('details[data-qpiece]:nth-of-type(5) > summary');
    await page.fill('#q-items\\.4\\.value', ''); await page.waitForTimeout(150);
    ok(await blocked(), 'blank value on Piece 5: Next is blocked');
    ok((await page.locator('[data-piece-row].incomplete').count()) === 1 && /Needs details/.test(await page.textContent('[data-piece-row="4"]')) && /Please enter the value of this piece/.test(await page.textContent('[data-piece-row="4"]')), 'only Piece 5 shows "Needs details: Please enter the value of this piece"', [await page.locator('[data-piece-row].incomplete').count(), (await page.textContent('[data-piece-row="4"]')).slice(0, 300)]);
    await shot('09-incomplete-piece');
    await page.click('#nextBtn', { force: true }); await page.waitForTimeout(500);
    ok((await panel()) === 'p4c', 'pressing Next jumps to the missing field (Piece 5, Value and care)', await panel());
    ok(/Piece 5/.test(await page.textContent('[data-panel="p4c"] .piece-tag')), 'and that screen says Piece 5');
    await fill('items.4.value', '12000'); await next();
    { const pn = await panel(), bl = await blocked(); ok(pn === 'pieces-more' && !bl, 'filling it unblocks the list', [pn, bl, (await state()).items[4].value]); }
  }

  hdr('UI 8: refresh and back/edit navigation');
  {
    const ids = (await state()).items.map((i) => i.id);
    await page.reload(); await page.waitForSelector('[data-piece-row]');
    const st = await state();
    ok((await rowCount()) === 29 && st.items.map((i) => i.id).join() === ids.join() && new Set(st.items.map((i) => i.id)).size === 29, 'refresh keeps all 29 pieces, same ids, no duplicates');
    ok((await panel()) === 'pieces-more', 'refresh lands on the same screen');
    await freshQuoteMatches('after refresh');
    await page.click('[data-piece-row="2"] .edit'); await page.waitForTimeout(300);
    ok((await panel()) === 'p2a' && (await page.textContent('[data-panel="p2a"] .item-head b')) === 'Piece 3', 'Edit on Piece 3 opens Piece 3');
    await fill('items.2.description', 'Edited third'); await next(); await next(); await next();
    ok((await panel()) === 'pieces-more' && (await page.textContent('[data-piece-row="2"] .pc-title')) === 'Piece 3 — Edited third', 'editing and clicking Next three times returns to the list with the new label');
    await page.click('#backBtn'); await page.waitForTimeout(300);
    ok((await panel()) === 'p28c', 'Back from the list goes to the last piece\'s final screen (Piece 29)', await panel());
    await page.click('#nextBtn'); await page.waitForTimeout(300);
    ok((await state()).items.length === 29, 'forward/back does not change the pieces');
  }

  // ---------------- 8b: Value and care rules (Chad, Nov 19) ----------------
  hdr('UI 8b: Not sure does not block; photos required only for special handling; material notes optional');
  {
    await freshStart();
    await fill(`items.0.description`, 'Care test'); await next();
    await fill(`items.0.w`, 30); await fill(`items.0.h`, 40); await fill(`items.0.d`, 2);
    await page.click('[data-seg="items.0.framed"] [data-v="no"]'); if (await page.$(`[data-seg="items.0.glazing"]`)) await page.click(`[data-seg="items.0.glazing"] [data-v="no"]`); await next();
    ok((await panel()) === 'p0c', 'landed on Value and care');
    ok(await page.isVisible('[data-path="items.0.materialNotes"]'), 'Material or notes (optional) is on the Value and care step');
    ok(/e\.g\. ceramic vase, glass top/.test(await page.getAttribute('[data-path="items.0.materialNotes"]', 'placeholder')), 'material placeholder');
    ok(/Only for pieces outside normal handling/.test(await page.textContent('[data-panel="p0c"]')), 'special handling copy says it is rare');
    ok(!/We’ll confirm the weight|Add a photo so we can plan for the weight/.test(await page.textContent('[data-panel="p0c"]')), 'old weight-confirm / weight-photo copy is gone');
    await fill(`items.0.value`, 5000);
    await settle();
    ok(!(await blocked()), 'with a value and no special handling, Next is enabled even without a photo or weight');
    ok(/\(optional\)/.test(await page.textContent('[data-photolbl="0"]')), 'photos are labeled optional');
    await page.click('[data-weightunsure="0"]'); await page.waitForTimeout(200);
    ok((await state()).items[0].weightUnsure === true, 'Not sure toggles on');
    ok(/No problem, you can skip this/.test(await page.textContent('[data-weight="0"]')), 'Not sure shows the skip line, not a confirm-weight promise');
    await settle();
    ok(!(await blocked()), 'Not sure does not block Next and does not require a photo');
    ok(!(await page.isVisible('[data-photoreq="0"]')), 'no photo requirement for Not sure');
    // Special handling requires a photo and is named in the field counter.
    await page.click('label.toggle:has([data-path="items.0.fragile"])'); await page.waitForTimeout(200);
    await settle();
    ok(await blocked(), 'special handling without a photo blocks Next');
    ok((await page.isVisible('[data-photoreq="0"]')) && /Photo required for special handling/.test(await page.textContent('[data-photoreq="0"]')), 'photo requirement shows only once special handling is on');
    const need = (await page.textContent('#needLine') || '').trim();
    ok(/1 field left: Photos — Piece 1/.test(need), 'field counter: 1 field left is photos, not weight', need);
    await fill(`items.0.materialNotes`, 'ceramic vase, glass top');
    await settle();
    ok(await blocked() && (await state()).items[0].materialNotes === 'ceramic vase, glass top', 'material notes are optional: filling them does not clear the photo requirement');
    await page.setInputFiles('[data-upload="0"]', PHOTO); await page.waitForFunction(() => JSON.parse(localStorage.getItem('cad-order')).items[0].photos.length > 0); await page.waitForTimeout(300);
    await settle();
    ok(!(await blocked()), 'special handling with a photo enables Next');
    await next();
    ok((await panel()) === 'pieces-more', 'continues to the list');
    await page.click('#addItem'); await page.waitForTimeout(250);
    await fillPiece(1, { desc: 'Second, not sure', value: 8000, unsure: true });
    ok((await panel()) === 'pieces-more', 'second piece with Not sure and no photo is complete');
    ok((await state()).items[0].fragile === true && (await state()).items[1].weightUnsure === true && (await state()).items[1].photos.length === 0, 'mixed order: piece 1 special handling + photo, piece 2 Not sure and no photo');
  }

  // ---------------- 9: thresholds and per-piece weight/photo rules in the browser ----------------
  hdr('UI 9: $49,999 / $50,000 / $50,001 and "Not sure" weight, in the browser');
  await freshStart();
  await fillPiece(0, { desc: 'Under', value: 49999 });
  await page.click('#addItem'); await page.waitForTimeout(250);
  ok((await panel()) === 'p1a' && /Piece 2: what is it\?/.test(await page.textContent('[data-panel="p1a"] h1')), 'Add another piece opens "Piece 2: what is it?"');
  await fillPiece(1, { desc: 'Exactly', value: 50000, unsure: true });
  ok((await panel()) === 'pieces-more', 'Not sure weight does not require a photo; Next continues to the list', await panel());
  await page.click('#addItem'); await page.waitForTimeout(250);
  await fillPiece(2, { desc: 'Over', value: 50001 });
  {
    const q = await freshQuoteMatches('three values');
    const p = (q.protection || {}).pieces || [];
    ok(p.map((x) => x.piece).join() === '1,2' && near(p[0].amount, 749.99) && p[1].amount === 750, '$49,999 → $749.99 and $50,000 → $750 protection; $50,001 → none', p);
    ok(q.highValueItems.length === 1 && q.highValueItems[0].index === 2, 'only Piece 3 ($50,001) is a high-value piece');
    ok(!q.notes.some((n) => /50,000/.test(n)) && !q.lines.some((l) => /Piece 3.*protection/i.test(l.label)), 'no over-$50,000 note and no protection line for Piece 3');
    ok(/Piece 1 — Under/.test(await page.textContent('[data-piece-row="0"]')) && !/Needs details/.test(await page.textContent('[data-panel="pieces-more"]')), 'list is complete: three pieces, none incomplete');
    await shot('10-three-pieces-thresholds');
  }

  // ---------------- 10: the whole way to the review, pay once ----------------
  hdr('UI 10: review screen and double-click Pay');
  {
    await toReview();
    ok((await panel()) === 'review', 'reached the final review', await panel());
    const txt = (await page.textContent('[data-panel="review"]')).replace(/\s+/g, ' ');
    ok(txt.includes('Each piece is listed and priced separately. Please check the dimensions, declared value, handling requirements, and photos for every piece.'), 'review shows the check-every-piece sentence');
    ok((await page.locator('[data-review-piece]').count()) === 3 && /Piece 1 — Under/.test(txt) && /Piece 2 — Exactly/.test(txt) && /Piece 3 — Over/.test(txt), 'review lists Piece 1 — Under, Piece 2 — Exactly, Piece 3 — Over on separate rows');
    ok((await page.locator('[data-review-piece] [data-goto]').count()) === 3, 'each piece row has an Edit link');
    ok(/Declared value protection — Piece 1 \(Under\): 1\.5% of \$49,999/.test(txt) && /Piece 2 \(Exactly\): 1\.5% of \$50,000/.test(txt) && !/Piece 3 \(Over\): 1\.5%/.test(txt), 'price lines: protection for Piece 1 and Piece 2, none for Piece 3');
    ok(/Declared value protection applies to pieces valued up to \$50,000\./.test(txt), 'one neutral checkout-terms sentence about the $50,000 limit');
    ok(!/over \$50,000|high-value|no protection|not protected|call us/i.test(txt), 'no over-$50,000 note, no "no protection" wording, no "call us"');
    await shot('11-review-top');
    await shot('12-review-full', true);
    ok((await overflow()) <= 0, 'review has no sideways scroll at 390px', await overflow());
    const before = orders().length;
    const btnText = await page.textContent('#nextBtn');
    await page.dblclick('#nextBtn'); // two fast taps
    await page.waitForFunction(() => /You’re booked|Quote request received|Date request received/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const after = orders();
    ok(/^Pay /.test(btnText), 'button reads Pay $…', btnText);
    ok(after.length === before + 1, 'double-clicking Pay created exactly one order', after.length - before);
    const o = after[0];
    ok(o.items.length === 3 && o.items.map((i) => i.description).join() === 'Under,Exactly,Over' && o.payment && o.payment.status === 'paid', 'one paid order with three separate pieces', o.status);
    await shot('13-confirmation');
    // refresh after booking shows the confirmation, never the draft again
    await page.reload(); await page.waitForTimeout(800);
    ok(orders().length === before + 1 && /You’re booked/.test(await page.textContent('#app')), 'refresh after booking shows the confirmation and books nothing new');
  }

  } // end of the early sections (UI_LATE_ONLY=1 skips them)

  // ---------------- 11: copied values must be confirmed before Pay (Dot) ----------------
  hdr('UI 11: copied values block Pay until confirmed; bulk confirm, per-piece confirm, edit clears the flag');
  {
    await freshStart();
    await fillPiece(0, { desc: 'Master', value: 12000 });
    await page.click('[data-piece-row="0"] [data-dupopen]'); await page.waitForSelector('#dup-n');
    await page.fill('#dup-n', '4'); await page.click('#dupGo'); await page.waitForTimeout(400);
    ok((await rowCount()) === 5 && (await page.locator('[data-checkvalue]').count()) === 4, 'Duplicate x4: five pieces, four flagged Check value');
    ok(!(await blocked()), 'the other steps are not blocked by Check value flags (Next works from the list)');
    ok((await page.locator('[data-checkvalues="list"]').count()) === 1 && /Confirm all 4 values/.test(await page.textContent('[data-checkvalues="list"] [data-valall]')), 'the list shows a "Confirm all 4 values" button');
    ok(/the declared value shown for each of these pieces is correct/.test(await page.textContent('[data-checkvalues="list"]')), 'the wording says what is being confirmed: each piece\'s declared value is correct');
    await page.evaluate(() => { document.querySelectorAll('.upload-toast').forEach((t) => { t.hidden = true; }); }); await shot('14-bulk-confirm-list');
    await toReview();
    ok((await panel()) === 'review', 'customer can go through every other step to the review with values unconfirmed', await panel());
    ok((await page.locator('[data-checkvalues="review"] [data-vc]').count()) === 4 && (await blocked()), 'review lists the 4 unconfirmed values and Pay is blocked');
    ok(/Payment is on hold/.test(await page.textContent('[data-checkvalues="review"]')), 'the card explains payment is on hold');
    const before = orders().length;
    await page.click('#nextBtn', { force: true }); await page.waitForTimeout(500);
    ok((await panel()) === 'review' && orders().length === before, 'pressing Pay does nothing: no order created while a value is unconfirmed', orders().length - before);
    ok(/confirm the declared values? of the 4 copied pieces/i.test(await page.textContent('[data-panel="review"]')), 'and says which fields are missing');
    await shot('15-blocked-pay-review');
    // edit one value: clears that flag
    await page.click('[data-vc] >> nth=0 >> text=Edit value'); await page.waitForTimeout(300);
    ok(/^p\dc$/.test(await panel()), 'Edit value opens that piece\'s value screen', await panel());
    await page.fill('input[data-path$=".value"]:visible', '13000'); await next();
    ok((await panel()) === 'review' && (await page.locator('[data-checkvalues="review"] [data-vc]').count()) === 3, 'editing the value clears its flag and returns to the review (3 left)');
    // per-piece confirm
    await page.click('[data-vc] >> nth=0 >> text=Value is right'); await page.waitForTimeout(250);
    ok((await page.locator('[data-checkvalues="review"] [data-vc]').count()) === 2 && (await blocked()), 'per-piece confirm clears one (2 left), still blocked');
    ok(/Confirm all 2 values/.test(await page.textContent('[data-valall]')), 'bulk button now reads Confirm all 2 values');
    await page.click('[data-valall]'); await page.waitForTimeout(300);
    ok((await page.locator('[data-checkvalues]').count()) === 0 && !(await blocked()), 'Confirm all clears the rest; Pay is available');
    const st = await state();
    ok(st.items.every((i) => !i.checkValue) && st.items[1].value !== undefined, 'no piece is flagged any more in the saved draft');
    await page.click('#nextBtn'); await page.waitForFunction(() => /You’re booked/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {});
    await sleep(400);
    const o = orders()[0]; // newest first
    ok(orders().length === before + 1 && o.items.length === 5 && o.items.every((i) => !i.checkValue) && o.payment && o.payment.status === 'paid', 'Pay now creates one paid order with five pieces and no unconfirmed flags', o && o.items.map((i) => i.checkValue));
    ok(/Your pieces \(5\)/.test(await page.textContent('#app')), 'confirmation page has a "Your pieces (5)" section');
    const det = await page.$('[data-yourpieces]');
    ok(det && !(await det.evaluate((d) => d.open)), 'it is collapsed by default');
    await det.evaluate((d) => { d.open = true; }); await page.waitForTimeout(200);
    const pt = (await page.textContent('[data-yourpieces]')).replace(/\s+/g, ' ');
    ok([1, 2, 3, 4, 5].every((n) => new RegExp(`Piece ${n}\\b`).test(pt)) && /Master/.test(pt) && /72 × 60 × 2/.test(pt) && /\$12,000/.test(pt) && /\$13,000/.test(pt), 'opened, it lists Piece 1–5 with description, dimensions and declared value', pt.slice(0, 400));
    await page.evaluate(() => document.querySelector('[data-yourpieces]').scrollIntoView()); await page.waitForTimeout(200);
    await shot('16-confirmation-your-pieces');
  }

  // ---------------- 12: long lists collapse; sticky footer on a short phone and with the keyboard open ----------------
  hdr('UI 12: long list collapses finished pieces; the bottom bar never covers a control at 375x667 or with the keyboard open');
  {
    await page.setViewportSize({ width: 375, height: 667 });
    await freshStart();
    await fillPiece(0, { desc: 'Master', value: 12000 });
    await page.click('[data-piece-row="0"] [data-dupopen]'); await page.waitForSelector('#dup-n');
    await page.fill('#dup-n', '11'); await page.click('#dupGo'); await page.waitForTimeout(400);
    ok((await rowCount()) === 12 && (await page.locator('[data-piece-row].compact').count()) === 1, '12 pieces: only the master (not flagged) is collapsed; the 11 copies stay open until their value is confirmed', await page.locator('[data-piece-row].compact').count());
    await page.click('[data-valall]'); await page.waitForTimeout(300);
    ok((await page.locator('[data-piece-row].compact').count()) === 12, 'after confirming, all 12 finished pieces collapse to one short row');
    ok(/12 pieces · 12 complete/.test(await page.textContent('[data-pcsummary]')) && /\$144,000 total declared value/.test(await page.textContent('[data-pcsummary]')), 'a summary line says 12 pieces, 12 complete, $144,000 total', await page.textContent('[data-pcsummary]'));
    const h = await page.$eval('[data-piece-row="3"]', (e) => Math.round(e.getBoundingClientRect().height));
    ok(h <= 96, 'a collapsed row is short (<= 96px at 375px wide)', h);
    ok(/Piece 4 — Master/.test(await page.textContent('[data-piece-row="3"] .pc-title')) && (await page.isVisible('[data-piece-row="3"] .edit')), 'it still shows its title, value and Edit');
    ok(!(await page.isVisible('[data-piece-row="3"] .pc-facts')), 'facts are hidden while collapsed');
    await page.click('[data-piece-row="3"] [data-pcopen]'); await page.waitForTimeout(250);
    ok((await page.isVisible('[data-piece-row="3"] .pc-facts')) && (await page.locator('[data-piece-row].compact').count()) === 11, 'Details opens that one piece');
    await page.click('[data-piece-row="3"] [data-pcopen]'); await page.waitForTimeout(150);
    await page.click('details[data-quick] > summary'); await page.click('details[data-qpiece]:nth-of-type(6) > summary');
    await page.fill('#q-items\\.5\\.value', ''); await page.waitForTimeout(250);
    ok(!(await page.$eval('[data-piece-row="5"]', (e) => e.classList.contains('compact'))) && /Needs details/.test(await page.textContent('[data-piece-row="5"]')) && /1 needs details/.test(await page.textContent('[data-pcsummary]')), 'a piece that needs details stays expanded and is counted in the summary');
    await page.fill('#q-items\\.5\\.value', '12000'); await page.waitForTimeout(250);
    await shot('17-long-list-collapsed');

    const lastVsDock = () => page.evaluate(() => { const dock = document.querySelector('.dock').getBoundingClientRect(); const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); const els = [...p.querySelectorAll('input,select,textarea,button,a,summary,label.upload,[data-seg] button')].filter((e) => e.offsetParent && e.getBoundingClientRect().height > 0 && !e.closest('.qlist')); const lastEl = els.reduce((m, e) => (e.getBoundingClientRect().bottom > (m ? m.getBoundingClientRect().bottom : 0) ? e : m), null); return { dockTop: dock.top, last: lastEl ? lastEl.getBoundingClientRect().bottom : 0, el: lastEl && (lastEl.id || lastEl.tagName + ':' + lastEl.textContent.trim().slice(0, 25)), y: scrollY, sh: document.documentElement.scrollHeight, vh: innerHeight }; });
    const dockCheck = async (tag) => {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(150);
      const r2 = await lastVsDock();
      ok(r2.last <= r2.dockTop + 1, `${tag}: scrolled to the bottom, the last control (${Math.round(r2.last)}px) is above the bottom bar (${Math.round(r2.dockTop)}px)`, r2);
      await page.evaluate(() => window.scrollTo(0, 0));
    };
    await dockCheck('375x667 list screen');
    await freshStart();
    await dockCheck('375x667 first screen');
    await fill('items.0.description', 'Canvas'); await next(); await dockCheck('375x667 size screen');
    await fill('items.0.w', 72); await fill('items.0.h', 60); await fill('items.0.d', 2); await page.click('[data-seg="items.0.framed"] [data-v="no"]'); if (await page.$(`[data-seg="items.0.glazing"]`)) await page.click(`[data-seg="items.0.glazing"] [data-v="no"]`); await next(); await dockCheck('375x667 value and care screen');
    await page.setViewportSize({ width: 375, height: 330 }); // keyboard open: the visible area shrinks
    for (const sel of ['[data-path="items.0.value"]', '[data-path="items.0.weight"]']) {
      await page.evaluate(() => window.scrollTo(0, 0)); await page.focus(sel); await page.waitForTimeout(400);
      const r = await page.evaluate(() => { const a = document.activeElement.getBoundingClientRect(); const d = document.querySelector('.dock').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, dockTop: d.top, dockH: d.height }; });
      ok(r.top >= 0 && r.bottom <= r.dockTop, `keyboard open (330px tall): the focused ${sel.includes('value') ? 'value' : 'weight'} field is fully visible above the bottom bar`, r);
      ok(r.dockH <= 100, 'the bottom bar slims down on a short screen (<= 100px)', r.dockH);
    }
    await shot('18-keyboard-open-value');
    await dockCheck('keyboard open');
    await page.setViewportSize({ width: 390, height: 844 });
  }

  ok(pageErrors.length === 0, 'no JavaScript errors in the browser during any of this', pageErrors);
  await browser.close();
};
