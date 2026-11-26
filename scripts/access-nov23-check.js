// Chad, Nov 23 2026 access/time changes at 393px. BASE=<site> node scripts/access-nov23-check.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
const OUT = process.env.SHOTS || '/workspace/cad_qa/nov23_booking';
const TAG = process.env.TAG || 'local';
const stop = (street, city, zip, x = {}) => ({ street, city, state: 'CA', zip, country: 'United States', contactName: 'Jordan Lee', contactPhone: '3105550199', sameAsMe: true, ...x });
const st = { service: 'pickup_delivery', items: [{ id: 'pcAx1', type: 'sculpture', description: 'Bronze figure', w: '30', h: '60', d: '30', value: '9000', weight: '250', photos: [], qty: 1 }],
  contact: { name: 'QA Botschild Test', email: 'qa-test@example.com', phone: '3105550199', clientType: 'Collector' }, heard: { source: 'google' }, payer: 'me',
  pickup: stop('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: stop('2 Henry Adams St', 'San Francisco', '94103'), schedule: { date: '', deliveryDate: '', timePref: 'none', deliveryTimePref: 'none' } };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const log = (...a) => console.log(...a);
  await p.goto(BASE + '/cad-logo.jpg');
  await p.evaluate((s) => { (sessionStorage.clear(), localStorage.clear()); sessionStorage.setItem('cad-order', JSON.stringify(s)); sessionStorage.setItem('cad-step', '1'); sessionStorage.setItem('cad-sub', 'pickup-access'); }, st);
  await p.goto(BASE + '/?qa=' + Date.now()); await p.waitForTimeout(1500);
  await p.click('[data-seg="pickup.pathPick"] [data-v="stairs2"]'); await p.waitForTimeout(400);
  log('flights select options:', await p.$$eval('select[data-path="pickup.stairFlights"] option', (o) => o.map((x) => x.textContent).join('|')));
  await p.$eval('#nextBtn', (x) => x.click()); await p.waitForTimeout(500); log('blocked without count:', await p.textContent('#needLine').catch(() => ''), '| sub', await p.evaluate(() => localStorage.getItem('cad-sub')));
  await p.selectOption('select[data-path="pickup.stairFlights"]', '5'); await p.waitForTimeout(1200);
  log('dock after 5 flights:', await p.textContent('#estTotal'));
  await p.screenshot({ path: `${OUT}/${TAG}_393_stairs5.png` });
  await p.$eval('#nextBtn', (x) => x.click()); await p.waitForTimeout(800); log('now', await p.evaluate(() => localStorage.getItem('cad-sub')));
  await p.click('[data-seg="pickup.fits"] [data-v="tight"]'); await p.waitForTimeout(400);
  log('doors text:', (await p.innerText('#app')).replace(/\n+/g, ' | '));
  await p.$eval('#nextBtn', (x) => x.click()); await p.waitForTimeout(500); log('blocked (stair photo needed):', await p.textContent('#needLine').catch(() => ''));
  await p.screenshot({ path: `${OUT}/${TAG}_393_doors_tight.png`, fullPage: true });
  // delivery: elevator
  await p.evaluate(() => { sessionStorage.setItem('cad-sub', 'dropoff-access'); }); await p.reload(); await p.waitForTimeout(1500);
  await p.click('[data-seg="dropoff.pathPick"] [data-v="elevator"]'); await p.waitForTimeout(400);
  await p.click('[data-seg="dropoff.elevatorType"] [data-v="service"]'); await p.click('[data-seg="dropoff.elevatorFit"] [data-v="not_sure"]'); await p.waitForTimeout(400);
  await p.$eval('#nextBtn', (x) => x.click()); await p.waitForTimeout(500); log('blocked without ack:', await p.textContent('#needLine').catch(() => ''), '|', await p.evaluate(() => localStorage.getItem('cad-sub')));
  await p.screenshot({ path: `${OUT}/${TAG}_393_elevator.png`, fullPage: true });
  await p.click('[data-reqblock="dropoff-elevatorAck"] .sw'); await p.waitForTimeout(800);
  log('dock with elevator:', await p.textContent('#estTotal'));
  await p.$eval('#nextBtn', (x) => x.click()); await p.waitForTimeout(800); log('after ack now', await p.evaluate(() => localStorage.getItem('cad-sub')));
  // time prefs
  await p.evaluate(() => { sessionStorage.setItem('cad-step', '2'); sessionStorage.setItem('cad-sub', 'date'); }); await p.reload(); await p.waitForTimeout(2000);
  await p.click('[data-reqblock="date"] [data-date]:not([data-off]) >> nth=0'); await p.waitForTimeout(800);
  await p.click('[data-chips="schedule.timePref"] [data-v="morning"]'); await p.click('[data-chips="schedule.timePref"] [data-v="midday"]'); await p.waitForTimeout(300);
  log('timePref after 2:', await p.evaluate(() => JSON.parse(localStorage.getItem('cad-order')).schedule.timePref));
  await p.screenshot({ path: `${OUT}/${TAG}_393_timeprefs.png`, fullPage: true });
  await p.click('[data-chips="schedule.timePref"] [data-v="none"]'); await p.waitForTimeout(300);
  log('timePref after none:', await p.evaluate(() => JSON.parse(localStorage.getItem('cad-order')).schedule.timePref));
  log('date text:', (await p.innerText('#app')).replace(/\n+/g, ' | ').slice(-900));
  log('JS errors:', errs.join('; ') || 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
