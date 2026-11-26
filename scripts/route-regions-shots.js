/**
 * 390 px screenshots of the date step (main flow and Paloma's) against a local server running this checkout with a copy of the
 * live CAD SCHEDULE (scripts/fixtures/sheet-days-live-2026-11-25.json). Review aid, not a test.
 *   OUT=/workspace/reviews node scripts/route-regions-shots.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright');
const OUT = process.env.OUT || '/workspace/reviews';
const PORT = 5300 + Math.floor(Math.random() * 80), BASE = `http://127.0.0.1:${PORT}`;
const FIX = path.join(__dirname, 'fixtures', 'sheet-days-live-2026-11-25.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const site = (street, city, zip) => ({ street, city, state: 'CA', zip, country: 'United States', sameAsMe: true, contactName: 'Pat Client', contactPhone: '4155550123', contactRole: '' });
const ITEM = { id: 'pcA', type: 'painting', description: 'Canvas', w: '30', h: '24', d: '2', framed: 'no', value: '1000', photos: [], hangHeight: 'standard', crateStatus: 'not_sure' };
const ORDER = (pu, de) => ({ service: 'pickup_delivery', items: [{ ...ITEM }], pickup: pu, dropoff: de, contact: { name: 'Pat Client', email: 'pat@example.com', phone: '4155550123', company: '', clientType: 'Collector' }, heard: { repeatAnswer: 'yes', repeatClient: true }, payer: 'me', schedule: { date: '', window: '', timePref: 'none', timeNote: '', deliveryLater: false, deliveryDate: '', deliveryTimePref: 'none', deliveryTimeNote: '' } });
const CASES = [
  ['menlo-park', site('1 Santa Cruz Ave', 'Menlo Park', '94025'), site('800 El Camino Real', 'Menlo Park', '94025')],
  ['oakland', site('1 Broadway', 'Oakland', '94607'), site('500 Grand Ave', 'Oakland', '94610')],
  ['san-jose', site('1 S 1st St', 'San Jose', '95113'), site('200 Park Ave', 'San Jose', '95113')],
  ['santa-cruz', site('1 Pacific Ave', 'Santa Cruz', '95060'), site('200 Front St', 'Santa Cruz', '95060')],
  ['los-gatos', site('1 N Santa Cruz Ave', 'Los Gatos', '95030'), site('50 University Ave', 'Los Gatos', '95030')],
  ['no-confirmed-date', site('10 Donner Pass Rd', 'Truckee', '96161'), site('20 Donner Pass Rd', 'Truckee', '96161')],
];
(async () => {
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cad-rr-shots-')), SHEET_DAYS_FIXTURE: FIX, TEST_MODE: '1', SKIP_GEOCODE: '1', BASE_URL: BASE, NODE_ENV: 'development' }, stdio: 'ignore' });
  let browser;
  const made = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/config')).ok) break; } catch {} await sleep(250); }
    browser = await pw.chromium.launch();
    const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const settle = async (page) => { await page.waitForTimeout(600); await page.waitForFunction(() => !document.querySelector('#nextBtn') || !document.querySelector('#nextBtn').classList.contains('is-busy'), null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(700); };
    // ---------- main flow ----------
    for (const [name, pu, de] of CASES) {
      const ctx = await browser.newContext(ctxOpts);
      await ctx.addInitScript((seed) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('cad-order', JSON.stringify(seed)); localStorage.setItem('cad-step', '2'); localStorage.setItem('cad-saved-at', String(Date.now())); } }, ORDER(pu, de));
      const page = await ctx.newPage();
      await page.goto(BASE + '/'); await page.waitForSelector('.date-pair, [data-noroute], .days', { timeout: 15000 }).catch(() => {}); await settle(page);
      const f = `${OUT}/route-regions-v2-main-${name}.png`; await page.screenshot({ path: f, fullPage: true }); made.push(f);
      if (name === 'oakland') {
        const thu = await page.$('[data-date="2026-12-03"]');
        if (thu) { await thu.click(); await settle(page); const f2 = `${OUT}/route-regions-v2-main-oakland-thursday.png`; await page.screenshot({ path: f2, fullPage: true }); made.push(f2); }
        else console.log('no Thursday card for Oakland');
      }
      if (name === 'los-gatos') {
        const sat = await page.$('[data-date="2026-12-05"]');
        if (sat) { await sat.click(); await settle(page); const f2 = `${OUT}/route-regions-v2-main-los-gatos-saturday.png`; await page.screenshot({ path: f2, fullPage: true }); made.push(f2); }
        else console.log('no Saturday card for Los Gatos');
      }
      await ctx.close();
    }
    // ---------- Paloma's ----------
    const PCASES = [
      ['menlo-park', '1 Santa Cruz Ave', 'Menlo Park', '94025'], ['oakland', '1 Broadway', 'Oakland', '94607'], ['san-jose', '1 S 1st St', 'San Jose', '95113'],
      ['santa-cruz', '1 Pacific Ave', 'Santa Cruz', '95060'], ['los-gatos', '1 N Santa Cruz Ave', 'Los Gatos', '95030'], ['no-confirmed-date', '10 Donner Pass Rd', 'Truckee', '96161'],
    ];
    for (const [name, street, city, zip] of PCASES) {
      const ctx = await browser.newContext(ctxOpts);
      const draft = { items: [{ uid: 1, name: 'Egipcia Amber Table Lamp', kind: 'Table Lamp', qty: 1, catalogId: '156', thumb: '156', dims: '', w: '', h: '', value: '400' }], pickup: 'salinas', client2: false, uid: 2, step: 6,
        f: { dName: 'Pat Client', dPhone: '(831) 555-0123', dEmail: 'pat@example.com', dStreet: street, dCity: city, dState: 'CA', dZip: zip, aMode: 'ground' } };
      await ctx.addInitScript((d) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); sessionStorage.setItem('palomas-draft', JSON.stringify(d)); localStorage.setItem('palomasPlacedBy', 'Arnie'); } }, draft);
      const page = await ctx.newPage();
      await page.goto(BASE + '/palomas'); await page.waitForTimeout(2500);
      // walk forward with Next until the dates step shows (the draft resumes at the first step with a gap)
      for (let k = 0; k < 8 && !(await page.$('[data-pu]:visible, [data-noroute]:visible')); k++) { const nb = await page.$('#nextBtn, button:has-text("Next")'); if (!nb) break; await nb.click().catch(() => {}); await page.waitForTimeout(1200); }
      const f = `${OUT}/route-regions-v2-palomas-${name}.png`;
      if (['oakland', 'santa-cruz', 'los-gatos'].includes(name)) {
        // pick the Tuesday pickup so the delivery column shows the later delivery days (Thursday / Friday / Saturday)
        const pu = await page.$('[data-pu="2026-12-01"]:visible');
        if (pu) { await pu.click(); await page.waitForTimeout(1500); } else console.log('no visible Dec 1 pickup card on Paloma\'s');
      }
      await page.screenshot({ path: f, fullPage: true }); made.push(f);
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    child.kill();
    console.log(made.join('\n'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
