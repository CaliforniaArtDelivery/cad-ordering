// Chad, Nov 23 2026: a remote-area (Palm Springs) booking goes straight to payment, booking copy only, no overlapping dock.
// BASE=<site> SHOTS=<dir> PAY=1 node scripts/booking-nov23-check.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
const OUT = process.env.SHOTS || '/workspace/cad_qa/nov23_booking';
const TAG = process.env.TAG || 'local';
const stop = (street, city, zip, x = {}) => ({ street, city, state: 'CA', zip, country: 'United States', contactName: 'Jordan Lee', contactPhone: '3105550199', sameAsMe: true, accessMode: 'ground', pathPick: 'ground', fits: 'yes', ...x });
const piece = (x = {}) => ({ id: 'pcA' + Math.random().toString(36).slice(2, 6), type: 'painting', description: 'Oil on canvas', w: '40', h: '30', d: '2', framed: 'yes', glazing: 'no', frameType: '', value: '3000', weight: '', photos: [], hangHeight: 'standard', qty: 1, ...x });
const state = () => ({ service: 'pickup_delivery', items: [piece()], contact: { name: 'QA Botschild Test', email: process.env.EMAIL || 'qa-test@example.com', phone: '3105550199', company: '', clientType: 'Collector' }, heard: { source: 'google' }, payer: 'me',
  pickup: stop('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: stop('100 N Palm Canyon Dr', 'Palm Springs', '92262'), schedule: { date: '', deliveryDate: '', timePref: 'none', deliveryTimePref: 'none' } });
const BAD = /(?<!TEST MODE · )(?:nothing is charged)|(?<!Other )request|(?<!custom )quote|loading dock|same-day|not guaranteed|ESTIMATE|estimat|penciled|pencilled|confirm(s)? (it )?within|business day|no payment|samantha|remove protection|separate regional|final price|call us|date to be confirmed/i;
(async () => {
  const browser = await chromium.launch();
  const problems = []; const shots = [];
  for (const [vw, vh] of (process.env.SIZES ? JSON.parse(process.env.SIZES) : [[393, 852], [320, 640], [430, 932], [1440, 1000]])) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vw < 500 ? 2 : 1, isMobile: vw < 500, hasTouch: vw < 500 });
    const page = await ctx.newPage();
    const jsErr = []; page.on('pageerror', (e) => jsErr.push(e.message));
    await page.goto(BASE + '/cad-logo.jpg');
    await page.evaluate((s) => { sessionStorage.clear(); sessionStorage.setItem('cad-order', JSON.stringify(s)); sessionStorage.setItem('cad-step', '0'); sessionStorage.setItem('cad-sub', ''); }, state());
    await page.goto(BASE + '/?qa=' + Date.now()); await page.waitForTimeout(1800);
    const pickDates = async () => {
      await page.waitForSelector('[data-date]', { timeout: 20000 });
      await page.click('[data-reqblock="date"] [data-date]:not([data-off]) >> nth=0'); await page.waitForTimeout(700);
      if (await page.$('[data-reqblock="deldate"] [data-deldate]:not([data-off])')) { await page.click('[data-reqblock="deldate"] [data-deldate]:not([data-off]) >> nth=0').catch(() => {}); await page.waitForTimeout(700); }
    };
    const dock = async (label) => {
      const r = await page.evaluate(() => {
        const q = (s) => document.querySelector(s); const R = (e) => e.getBoundingClientRect();
        const est = q('.estimate'), act = q('.dock-actions'), lbl = q('#estLabel'), tot = q('#estTotal'), nb = q('#nextBtn'), bb = q('#backBtn');
        return { estRight: R(est).right, actLeft: R(act).left, lblClip: lbl.scrollWidth > lbl.clientWidth + 1, totClip: tot.scrollWidth > tot.clientWidth + 1, nbClip: nb.scrollWidth > nb.clientWidth + 1,
          over: document.documentElement.scrollWidth > document.documentElement.clientWidth, lbl: lbl.textContent, tot: tot.textContent, btn: nb.textContent, back: !bb.hidden && getComputedStyle(bb).display !== 'none' ? R(bb).right <= R(nb).left : true, text: document.body.innerText };
      });
      if (r.estRight > r.actLeft + 0.5) problems.push(`${vw} ${label}: price block overlaps buttons (${r.estRight} > ${r.actLeft})`);
      if (r.lblClip || r.totClip || r.nbClip) problems.push(`${vw} ${label}: text cut off (label ${r.lblClip} "${r.lbl}", total ${r.totClip}, button ${r.nbClip} "${r.btn}")`);
      if (r.over) problems.push(`${vw} ${label}: page scrolls sideways`);
      if (!r.back) problems.push(`${vw} ${label}: Back overlaps main button`);
      const m = r.text.match(BAD); if (m) problems.push(`${vw} ${label}: banned word "${m[0]}" near "${r.text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\n/g, ' | ')}"`);
      if (vw === 393) require('fs').appendFileSync(`${OUT}/${TAG}_texts.txt`, `\n===== ${label}\n` + (await page.innerText('#app')));
      const f = `${OUT}/${TAG}_${vw}_${label}.png`; await page.screenshot({ path: f, fullPage: vw >= 1000 }); shots.push(f);
      return r;
    };
    let r = await dock('start');
    for (let i = 0; i < 30; i++) {
      const before = await page.evaluate(() => sessionStorage.getItem('cad-step') + '/' + sessionStorage.getItem('cad-sub'));
      if (/^3\/review/.test(before)) break;
      if (/^2\/date/.test(before) || await page.$('[data-reqblock="date"] [data-date]')) { if (!(await page.evaluate(() => JSON.parse(sessionStorage.getItem('cad-order')).schedule.date))) await pickDates(); }
      await page.click('#nextBtn'); await page.waitForTimeout(1300);
      const after = await page.evaluate(() => sessionStorage.getItem('cad-step') + '/' + sessionStorage.getItem('cad-sub'));
      r = await dock(after.replace('/', '-'));
      if (after === before) { problems.push(`${vw}: stuck at ${after}: ${(await page.textContent('#dockErr').catch(() => '')) || ''} ${(await page.textContent('#needLine').catch(() => ''))}`); break; }
    }
    const rev = await page.evaluate(() => document.body.innerText);
    if (!/Review & pay/.test(rev)) problems.push(`${vw}: review heading missing`);
    if (!/^Pay \$245( and book)?$/.test(r.btn)) problems.push(`${vw}: main button is "${r.btn}"`);
    if (/Declared value protection applies to pieces valued/.test(rev)) problems.push(`${vw}: repeated protection line still there`);
    if (vw === 1440) await page.screenshot({ path: `${OUT}/${TAG}_1440_review_full.png`, fullPage: true });
    if (process.env.PAY === '1' && vw === 393) {
      await page.click('#nextBtn'); await page.waitForTimeout(4000);
      const done = await page.evaluate(() => ({ url: location.href, text: document.body.innerText }));
      const f = `${OUT}/${TAG}_390_after_pay.png`; await page.screenshot({ path: f, fullPage: true }); shots.push(f);
      console.log('AFTER PAY URL', done.url); console.log('AFTER PAY TEXT', done.text.slice(0, 900).replace(/\n+/g, ' | '));
      const m = done.text.match(BAD); if (m) problems.push(`after pay: banned word "${m[0]}"`);
    }
    if (jsErr.length) problems.push(`${vw}: JS errors ${jsErr.join('; ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(shots.length + ' shots'); console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS');
})().catch((e) => { console.error(e); process.exit(1); });
