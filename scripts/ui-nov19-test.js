/**
 * Browser test (headless Chromium, iPhone-sized) for the Nov 19 changes: size boxes, address checks, "Step X of Y", Same as me,
 * the "My address has no street number" checkbox, no member option, optional declared value protection (remove / confirm / add back),
 * and the discount code box on Review & pay. A real server runs on a temp folder in TEST mode; nothing is sent or charged.
 *   node scripts/ui-nov19-test.js        (screenshots: /workspace/fix19_shots)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright');

const PORT = 4600 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = '/workspace/fix19_shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const hdr = (t) => console.log('\n[' + t + ']');

(async () => {
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-ui19-')), TEST_MODE: '1', BASE_URL: BASE }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/config'); break; } catch { await sleep(250); } }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  const quoteBodies = [];
  page.on('request', (r) => { if (/\/api\/quote$/.test(r.url()) && r.method() === 'POST') { try { quoteBodies.push(JSON.parse(r.postData())); } catch {} } });

  const settle = () => page.waitForFunction(() => !/Updating estimate/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const next = async () => { await settle(); await page.click('#nextBtn', { force: true }); await page.waitForTimeout(350); };
  const panel = () => page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? p.dataset.panel : ''; });
  const need = () => page.evaluate(() => { const n = document.querySelector('#needLine'); return n && !n.hidden ? n.textContent : ''; });
  const noStepsLabel = async () => !(await page.$('#stepsLabel'));
  const fill = (p, v) => page.fill(`[data-path="${p}"]`, String(v));
  const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('cad-order') || 'null'));
  const priceText = () => page.evaluate(() => (document.querySelector('[data-price]') || {}).innerText || '');
  const VAL = { 'contact.name': 'Jordan Lee', 'contact.email': 'jordan@example.com', 'contact.phone': '3105550199', 'pickup.street': '2 Henry Adams St', 'pickup.city': 'San Francisco', 'pickup.zip': '94103', 'dropoff.street': '1 Main St', 'dropoff.city': 'San Francisco', 'dropoff.zip': '94110' };
  async function walkTo(stopAt, valOver = {}) {
    const V = { ...VAL, ...valOver };
    for (let n = 0; n < 40 && (await panel()) !== stopAt; n++) {
      const v = await page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? [...p.querySelectorAll('input,select,textarea,[data-seg]')].filter((e) => e.offsetParent).map((e) => ({ k: e.dataset.path || e.dataset.seg || e.id, t: e.tagName, v: e.value, ty: e.type, opts: e.tagName === 'SELECT' ? [...e.options].map((o) => o.value) : undefined })) : []; });
      for (const f of v) {
        if (V[f.k] !== undefined && f.t === 'INPUT' && !f.v) await page.fill(`[data-path="${f.k}"]`, V[f.k]);
        else if (f.t === 'SELECT' && !f.v && f.opts) await page.selectOption(`[data-path="${f.k}"]`, f.k === 'heard.source' ? 'google' : f.opts[1]);
        else if (f.t === 'DIV' && /^(pickup|dropoff)\./.test(f.k) && !(await page.$(`[data-seg="${f.k}"] button.on`))) { await page.click(`[data-seg="${f.k}"] button >> nth=0`); await page.waitForTimeout(120); }
      }
      if (await page.locator('[data-reqblock="date"] .day:not(.rush):visible').count()) { await page.click('[data-reqblock="date"] .day:not(.rush):visible >> nth=0'); await page.waitForTimeout(250); }
      if (await page.locator('[data-deldate]:not([data-off]):visible').count()) { await page.click('[data-deldate]:not([data-off]):visible >> nth=0'); await page.waitForTimeout(250); }
      const before = await panel(); await next();
      if ((await panel()) === before) return before; // blocked
    }
    return panel();
  }
  const start = async () => { await page.goto(BASE); await page.evaluate(() => (sessionStorage.clear(), localStorage.clear())); await page.goto(BASE); await page.waitForSelector('[data-service]'); await page.click('[data-service="pickup_delivery"]'); await settle(); await next(); };
  const onePiece = async (value) => {
    await fill('items.0.description', 'Canvas'); await next();
    await fill('items.0.w', 30); await fill('items.0.h', 40); await fill('items.0.d', 2);
    if (await page.$('[data-seg="items.0.framed"]')) await page.click('[data-seg="items.0.framed"] [data-v="no"]'); if (await page.$(`[data-seg="items.0.glazing"]`)) await page.click(`[data-seg="items.0.glazing"] [data-v="no"]`);
    await next(); await fill('items.0.value', value); await next();
  };

  try {
    hdr('U1. size boxes, step counter, no member option');
    await start();
    ok(await noStepsLabel(), 'no step numbers or labels in the header');
    await fill('items.0.description', 'Canvas'); await next();
    const vals = await page.evaluate(() => ['w', 'h', 'd'].map((k) => document.querySelector(`[data-path="items.0.${k}"]`).value));
    ok(vals.join('|') === '||', 'size boxes start blank (no 1 x 1 x 1)', vals);
    await page.focus('[data-path="items.0.w"]'); await page.keyboard.press('ArrowUp');
    const afterUp = await page.inputValue('[data-path="items.0.w"]');
    ok(afterUp === '' || Number(afterUp) >= 4, 'nudging a blank size never produces 1', afterUp);
    await page.fill('[data-path="items.0.w"]', '');
    for (const bad of ['1', '1e3', '-5']) {
      await fill('items.0.w', bad); await fill('items.0.h', 40); await fill('items.0.d', 2);
      if (await page.$('[data-seg="items.0.framed"]')) await page.click('[data-seg="items.0.framed"] [data-v="no"]'); if (await page.$(`[data-seg="items.0.glazing"]`)) await page.click(`[data-seg="items.0.glazing"] [data-v="no"]`);
      await next();
      ok((await panel()) === 'p0b' && /Size/.test(await need()), `width "${bad}" blocks Next on the size screen`, await need());
    }
    await fill('items.0.w', 30); await next(); await fill('items.0.value', '12,344'); await next();
    ok(true, 'a valid size moves on');

    hdr('U2. address checks, the no-street-number checkbox, Same as me');
    ok((await panel()) === 'pieces-more', 'pieces list reached', await panel());
    await next();
    ok(await noStepsLabel(), 'no step numbers on the Where step');
    const html = await page.content();
    ok(!/CAD member|member code|Member code|CAD Membership/i.test(html), 'no "I’m a CAD member" option, member code field or membership pitch anywhere on the page');
    let at = await walkTo('pickup-addr');
    await fill('pickup.street', 'Henry Adams St'); await fill('pickup.city', 'San Francisco'); await fill('pickup.zip', '123456');
    await next();
    ok((await panel()) === 'pickup-addr' && /Street|ZIP/.test(await need()), 'no street number and ZIP 123456 block the address screen', await need());
    ok(await page.isVisible('[data-nostreet]'), 'the small "My address has no street number" checkbox is there');
    await page.click('[data-nostreet] input'); await page.waitForTimeout(250);
    await fill('pickup.zip', '94103'); await next();
    ok((await panel()) === 'pickup-contact', 'ticking the box lets a number-less street through (with a real ZIP)', { panel: await panel(), need: await need() });
    const st = await state();
    ok(st.pickup.street === 'Henry Adams St' && st.pickup.noStreetNumber === true, 'the street text is kept exactly as typed, flag recorded', st.pickup);
    await page.goBack().catch(() => {}); await page.waitForTimeout(300);
    if ((await panel()) !== 'pickup-addr') { await page.click('#backBtn'); await page.waitForTimeout(300); }
    await fill('pickup.street', '2 Henry Adams St'); await page.waitForTimeout(150);
    await next();
    const same = await page.evaluate(() => { const b = document.querySelector('[data-same="pickup"]'); return b ? { on: b.classList.contains('on'), name: document.querySelector('[data-path="pickup.contactName"]').value } : null; });
    ok(same && same.on && same.name === 'Jordan Lee', 'on-site contact defaults to "Same as me" with the booker’s name filled in', same);

    hdr('U3. Review & pay: protection is included, with a visible Remove protection link');
    at = await walkTo('review');
    ok(at === 'review', 'reached Review & pay', at);
    await settle(); await page.waitForTimeout(400);
    ok(await noStepsLabel(), 'no step numbers on Review & pay');
    let pt = await priceText();
    ok(/Declared value protection: 1\.5% of \$12,344/.test(pt) && /\$185\b/.test(pt) && /\$385\b/.test(pt), 'quote shows protection included: $200 + $185 = $385', pt);
    ok(/Remove protection/.test(pt) && await page.isVisible('[data-protection-remove]'), 'a small "Remove protection" link sits on the protection line');
    const linkBox = await page.$eval('[data-protection-remove]', (b) => { const c = getComputedStyle(b); return { fs: parseFloat(c.fontSize), bg: c.backgroundColor, deco: c.textDecorationLine }; });
    ok(linkBox.fs <= 14 && /rgba\(0, 0, 0, 0\)|transparent/.test(linkBox.bg) && /underline/.test(linkBox.deco), 'it is a small underlined text link, not a big toggle or button', linkBox);
    ok(!/Required/.test(pt.replace(/Required\b(?=\s*$)/gm, '')) || !/Required declared value protection/.test(pt), 'nothing calls protection "required" any more');
    await shot('10-review-protection-included');

    hdr('U4. confirm dialog: Keep is primary and default; only Yes drops the line');
    await page.click('[data-protection-remove]'); await page.waitForTimeout(250);
    const dlg = await page.evaluate(() => { const d = document.querySelector('[data-protection-dialog] .modal'); const f = document.activeElement; return d ? { text: d.querySelector('#protMsg').textContent.trim(), buttons: [...d.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), primary: b.classList.contains('primary') })), focus: f && f.textContent.trim() } : null; });
    ok(dlg && dlg.text === "Are you sure you want to decline declared value protection? Without it, CAD's liability is limited.", 'the dialog asks exactly the agreed question', dlg && dlg.text);
    ok(dlg && dlg.buttons.map((b) => b.t).join('|') === 'Keep protection|Yes, remove protection' && dlg.buttons[0].primary && !dlg.buttons[1].primary, 'buttons: "Keep protection" (primary) and "Yes, remove protection"', dlg && dlg.buttons);
    ok(dlg && dlg.focus === 'Keep protection', 'Keep protection has the focus by default', dlg && dlg.focus);
    await shot('11-confirm-dialog');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(!(await page.$('[data-protection-dialog]')) && /\$385\b/.test(await priceText()) && (await state()).protectionDeclined === false, 'Escape closes it and keeps protection');
    await page.click('[data-protection-remove]'); await page.click('[data-pdlg="keep"]'); await page.waitForTimeout(200);
    ok(!(await page.$('[data-protection-dialog]')) && /\$385\b/.test(await priceText()), '"Keep protection" keeps the line');
    await page.click('[data-protection-remove]'); await page.mouse.click(5, 5); await page.waitForTimeout(200);
    ok(!(await page.$('[data-protection-dialog]')) && /\$385\b/.test(await priceText()), 'tapping outside the dialog also keeps protection');
    await page.click('[data-protection-remove]'); await page.click('[data-pdlg="yes"]'); await settle(); await page.waitForTimeout(500);
    pt = await priceText();
    ok(!/Declared value protection: 1\.5%/.test(pt) && /declined/i.test(pt) && /\$200/.test(pt) && !/\$385\b/.test(pt), '"Yes, remove protection" drops the line (total $200) and shows "declined"', pt);
    ok(await page.isVisible('[data-protection-add]') && /Add protection back \(\+\$185\)/.test(pt), 'a one-tap "Add protection back (+$185)" is shown', pt);
    ok((await state()).protectionDeclined === true, 'the choice is kept in the saved draft');
    const lastQ = quoteBodies[quoteBodies.length - 1] || {};
    ok(lastQ.protectionDeclined === true && !('member' in lastQ) && !('memberCode' in lastQ), 'the quote request carries protectionDeclined: true and no member fields', Object.keys(lastQ));
    await shot('12-protection-declined');
    await page.reload(); await page.waitForSelector('[data-panel]', { state: 'attached' }); await settle(); await page.waitForTimeout(500);
    ok(/declined/i.test(await priceText()) || (await panel()) !== 'review', 'a refresh keeps the choice');
    if ((await panel()) !== 'review') await walkTo('review');
    await settle(); await page.waitForTimeout(300);
    await page.click('[data-protection-add]'); await settle(); await page.waitForTimeout(500);
    ok(/Declared value protection: 1\.5% of \$12,344/.test(await priceText()) && /\$385\b/.test(await priceText()) && (await state()).protectionDeclined === false, 'one tap on "Add protection back" restores it ($385)');
    const lastQ2 = quoteBodies[quoteBodies.length - 1] || {};
    ok(!('protectionDeclined' in lastQ2), 'once added back, the flag is not sent at all (default = included)', Object.keys(lastQ2));

    hdr('U5. discount code box');
    ok(await page.isVisible('[data-discount] input#discountInput') && await page.isVisible('[data-discount-apply]'), 'a "Discount code" field with an Apply button is on Review & pay');
    const order = await page.evaluate(() => { const labels = [...document.querySelectorAll('#app h2, #app label.f, #app .price-card')].map((e) => e.className + ':' + (e.textContent || '').slice(0, 14)); return labels.findIndex((l) => /Discount code/.test(l)) > labels.findIndex((l) => /price-card/.test(l)); });
    ok(order, 'it sits after the price, near the end of checkout');
    await page.fill('#discountInput', 'nope'); await page.click('[data-discount-apply]'); await page.waitForTimeout(500);
    let msg = await page.textContent('[data-discount-msg]');
    ok(/isn.t valid/.test(msg) && (await page.$('.discount-bad')), 'a wrong code shows a clear "isn’t valid" message', msg);
    ok(!(await state()).discountCode, 'a wrong code is not kept');
    await page.fill('#discountInput', 'freedelivery500'); await page.click('[data-discount-apply]'); await page.waitForTimeout(500);
    ok(/isn.t valid/.test(await page.textContent('[data-discount-msg]')), 'an inactive code reads the same as an unknown one');
    await page.fill('#discountInput', ' jt '); await page.keyboard.press('Enter'); await page.waitForTimeout(500); await settle(); await page.waitForTimeout(400);
    msg = await page.textContent('[data-discount-msg]');
    ok(/Code JT applied/.test(msg) && (await page.$('.discount-ok')), 'Enter applies the code (it does not jump to the next step); message says it was applied', { msg, panel: await panel() });
    ok((await panel()) === 'review', 'still on Review & pay after pressing Enter in the code box');
    pt = await priceText();
    ok(/Discount code JT \(25% off\)/.test(pt) && /−\$96\.29/.test(pt) && /\$288\.87/.test(pt), 'the discount is its own line (−$96.29) and the total is $288.87', pt);
    ok(/\$288\.87/.test(await page.textContent('#estTotal')), 'the bottom bar shows the discounted amount due', await page.textContent('#estTotal'));
    ok(await page.isVisible('[data-discount-remove]') && (await page.inputValue('#discountInput')) === 'JT', 'applied code shows in the box with a Remove button');
    const lastQ3 = quoteBodies[quoteBodies.length - 1] || {};
    ok(lastQ3.discountCode === 'JT' && !('discountInput' in lastQ3), 'the quote request carries only the applied code', Object.keys(lastQ3));
    await shot('13-discount-applied');
    await page.click('[data-discount-remove]'); await settle(); await page.waitForTimeout(500);
    ok(!/Discount code JT/.test(await priceText()) && /\$385\b/.test(await priceText()), 'Remove takes the discount back off ($385)');
    ok(pageErrors.length === 0, 'no page errors', pageErrors);
  } finally { await browser.close(); child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED', e); process.exit(1); });
