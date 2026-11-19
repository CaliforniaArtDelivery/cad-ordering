// One post-deploy booking against the live TEST site (payment test mode). node scripts/post-deploy-check.js
const path = require('path');
const pw = require('playwright');
const BASE = process.env.BASE || 'https://cad-ordering-test.onrender.com';
const SHOTS = '/workspace/postdeploy_shots';
const res = [];
const ok = (c, m, extra) => { res.push([!!c, m]); console.log(c ? '  PASS:' : '  FAIL:', m, !c && extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); };
(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const quoteReqs = []; page.on('requestfinished', () => {});
  const settle = () => page.waitForFunction(() => !/Updating estimate/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const panel = () => page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? p.dataset.panel : ''; });
  const blocked = async () => { await settle(); return page.$eval('#nextBtn', (b) => !!(b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('is-wait'))); };
  const next = async () => { await settle(); await page.click('#nextBtn:not([disabled]):not([aria-disabled="true"])', { timeout: 15000 }); await page.waitForTimeout(450); };
  const fill = (p, v) => page.fill(`[data-path="${p}"]`, String(v));
  const shot = async (n) => { await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.upload-toast').forEach((t) => { t.hidden = true; }); }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const piece = async (i, desc, value) => { await fill(`items.${i}.description`, desc); await next(); if ((await panel()) === `p${i}b`) { await fill(`items.${i}.w`, 72); await fill(`items.${i}.h`, 60); await fill(`items.${i}.d`, 2); if (await page.$(`[data-seg="items.${i}.framed"]`)) await page.click(`[data-seg="items.${i}.framed"] [data-v="no"]`); await next(); } await fill(`items.${i}.value`, value); await next(); };
  try {
    await page.goto(BASE); await page.evaluate(() => sessionStorage.clear()); await page.goto(BASE);
    await page.waitForSelector('[data-service]'); await page.click('[data-service="pickup_delivery"]'); await next();
    await piece(0, 'ZZ TEST post-deploy A', 12000);
    ok((await panel()) === 'pieces-more', 'piece 1 added, list screen shown');
    await page.click('[data-piece-row="0"] [data-dupopen]'); await page.waitForSelector('#dup-n'); await page.fill('#dup-n', '1'); await page.click('#dupGo'); await page.waitForTimeout(400);
    ok((await page.locator('[data-piece-row]').count()) === 2 && (await page.locator('[data-checkvalue]').count()) === 1, 'Duplicate x1: two pieces, the copy is flagged Check value');
    await page.click('#addItem'); await page.waitForTimeout(300);
    await piece(2, 'ZZ TEST post-deploy Master', 75000);
    ok((await panel()) === 'pieces-more' && (await page.locator('[data-piece-row]').count()) === 3, 'third piece ($75,000 painting) added: three pieces');
    ok(!(await blocked()), 'values not yet confirmed, but Next is not blocked on the list (other steps stay open)');
    await page.evaluate(() => document.querySelector('[data-pclist]').scrollIntoView()); await shot('01-list-three-pieces');
    await next();
    const VAL = { 'contact.name': 'ZZ TEST Post-Deploy 5a3033e', 'contact.email': 'test+postdeploy@example.com', 'contact.phone': '3105550199', 'pickup.street': '8678 Melrose Ave', 'pickup.city': 'West Hollywood', 'pickup.zip': '90069', 'pickup.contactName': 'Test Pickup', 'pickup.contactPhone': '3105550101', 'dropoff.street': '1200 Summit Ridge Dr', 'dropoff.city': 'Beverly Hills', 'dropoff.zip': '90210', 'dropoff.contactName': 'Test Dropoff', 'dropoff.contactPhone': '3105550199' };
    for (let n = 0; n < 40 && (await panel()) !== 'review'; n++) {
      const v = await page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return [...p.querySelectorAll('input,select,textarea,[data-seg]')].filter((e) => e.offsetParent).map((e) => ({ k: e.dataset.path || e.dataset.seg || e.id, t: e.tagName, v: e.value, opts: e.tagName === 'SELECT' ? [...e.options].map((o) => o.value) : undefined })); });
      for (const f of v) {
        if (VAL[f.k] !== undefined && f.t === 'INPUT' && !f.v) await page.fill(`[data-path="${f.k}"]`, VAL[f.k]);
        else if (f.t === 'SELECT' && !f.v && f.opts) await page.selectOption(`[data-path="${f.k}"]`, f.k === 'heard.source' ? 'google' : f.opts[1]);
        else if (f.t === 'DIV' && /^(pickup|dropoff)\./.test(f.k) && !(await page.$(`[data-seg="${f.k}"] button.on`))) { await page.click(`[data-seg="${f.k}"] button >> nth=0`); await page.waitForTimeout(120); }
      }
      if (await page.locator('[data-reqblock="date"] .day:not(.rush):visible').count()) { await page.click('[data-reqblock="date"] .day:not(.rush):visible >> nth=0'); await page.waitForTimeout(250); }
      if (await page.locator('[data-deldate]:visible').count()) { await page.click('[data-deldate]:visible >> nth=0'); await page.waitForTimeout(250); }
      await next();
    }
    ok((await panel()) === 'review', 'reached the final review through all other steps with the value unconfirmed', await panel());
    ok((await page.locator('[data-checkvalues="review"] [data-vc]').count()) === 1 && (await blocked()), 'review shows the unconfirmed copy and Pay is blocked');
    const t1 = (await page.textContent('[data-panel="review"]')).replace(/\s+/g, ' ');
    ok(/Payment is on hold/.test(t1), 'review says payment is on hold until the value is confirmed');
    await page.click('#nextBtn', { force: true }); await page.waitForTimeout(800);
    ok((await panel()) === 'review' && !/You’re booked/.test(await page.textContent('#app')), 'pressing Pay while blocked books nothing');
    await shot('02-blocked-pay');
    // price lines
    const rev = (await page.textContent('[data-panel="review"]')).replace(/\s+/g, ' ');
    ok(/Piece 3 — Painting delivery/.test(rev), 'review price: the $75,000 painting has its own line "Piece 3 — Painting delivery"', rev.slice(0, 600));
    ok(/Painting delivery × 2 \(Pieces 1[–-]2\)/.test(rev) || /Painting delivery × 2/.test(rev), 'the two ordinary paintings stay grouped (× 2)');
    ok(!/Piece 3[^$]{0,60}protection|0\.75|high-value/i.test(rev) && /Required declared value protection/.test(rev), 'no protection/0.75% wording for Piece 3; protection lines are for the $12,000 paintings');
    await page.click('[data-vc] >> text=Value is right'); await page.waitForTimeout(400);
    ok((await page.locator('[data-checkvalues]').count()) === 0 && !(await blocked()), 'after "Value is right", the card goes away and Pay is available');
    const btn = (await page.textContent('#nextBtn')).trim();
    ok(/^Pay \$/.test(btn), 'button reads: ' + btn);
    await shot('03-review-after-confirm');
    await page.click('#nextBtn');
    await page.waitForFunction(() => /You’re booked/.test(document.body.textContent), null, { timeout: 30000 }).catch(() => {});
    ok(/You’re booked/.test(await page.textContent('#app')), 'booking confirmed (test payment)');
    const app = (await page.textContent('#app')).replace(/\s+/g, ' ');
    ok(/Paid \$[\d,.]+ · Card \(test\)/.test(app), 'payment line says Card (test): no live charge', (app.match(/Paid[^·]*·[^O]{0,30}/) || [''])[0]);
    ok(/Your pieces \(3\)/.test(app), 'confirmation shows "Your pieces (3)"');
    const det = await page.$('[data-yourpieces]'); ok(det && !(await det.evaluate((d) => d.open)), 'collapsed by default');
    await det.evaluate((d) => { d.open = true; }); await page.waitForTimeout(200);
    const yp = (await page.textContent('[data-yourpieces]')).replace(/\s+/g, ' ');
    ok(/Piece 1.*A.*\$12,000.*Piece 2.*A.*\$12,000.*Piece 3.*Master.*\$75,000/.test(yp), 'opened: Piece 1–3 with descriptions, sizes and declared values', yp);
    await page.evaluate(() => document.querySelector('[data-yourpieces]').scrollIntoView()); await shot('04-confirmation-your-pieces');
    const id = (app.match(/Order (CAD-[A-Z0-9]+)/) || [])[1];
    console.log('ORDER_ID', id);
    const r = await fetch(`${BASE}/api/orders/${id}`); const j = (await r.json()).order || {};
    ok(j.status === 'confirmed' && j.items.length === 3 && j.items.every((i) => !i.checkValue) && /^mock/.test(String((j.payment || {}).method)) && /^mock/.test(String((j.payment || {}).ref || 'mock')), 'server record: confirmed, 3 pieces, no unconfirmed flags, mock payment method', { status: j.status, method: (j.payment || {}).method });
    ok(!!j.quote && j.quote.lines.some((l) => l.label === 'Piece 3 — Painting delivery'), 'server quote has the own line for Piece 3');
    ok(errs.length === 0, 'no JavaScript errors in the browser', errs);
  } catch (e) { ok(false, 'crashed: ' + String(e).slice(0, 300)); await shot('crash').catch(() => {}); }
  await browser.close();
  console.log(`\n${res.filter((r) => r[0]).length} passed, ${res.filter((r) => !r[0]).length} failed`);
})();
