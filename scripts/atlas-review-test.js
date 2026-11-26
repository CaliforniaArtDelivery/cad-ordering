/**
 * Evidence suite for Atlas's review of the description-step / Value-and-care change.
 * Local only. The sheet half writes to the mock bridge's TEST ORDERS tab and never
 * touches a real Google Sheet or the SCHEDULE 2026 seed.
 *
 *   node scripts/atlas-review-test.js
 */
// Route dates come only from the CAD SCHEDULE digest; this older test runs against the stand-in built from the weekly catalog (never production).
if (!process.env.SHEET_DAYS_FIXTURE) process.env.SHEET_DAYS_FIXTURE = 'catalog';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright');
const { preflight } = require('./post-deploy-guard');
const { startBridge } = require('./mock-bridge');
const schedule = require('../lib/schedule');
const { pieceDetail } = require('../lib/itemtypes');

const ROOT = path.join(__dirname, '..');
const FIXTURE = process.env.SCHEDULE_FIXTURE || '/workspace/fixtures/schedule-2026.json';
const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
const ADMIN = 'atlas-admin-key-123456';
const results = [];
let group = '';
const ok = (c, m, extra) => {
  results.push({ group, ok: !!c, m });
  console.log(c ? '  ok  :' : '  FAIL:', m, !c && extra !== undefined ? JSON.stringify(extra).slice(0, 700) : '');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = (g) => { group = g; console.log('\n[' + g + ']'); };
const J = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const post = async (p, b) => { const r = await fetch(BASE + p, J(b || {})); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const get = async (p, h) => { const r = await fetch(BASE + p, { headers: h || {} }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const adminGet = (p) => get(p, { 'x-admin-key': ADMIN });

const paint = (o = {}) => ({ type: 'painting', description: 'Canvas', w: 30, h: 40, d: 2, framed: 'no', value: 5000, ...o });
const sculpt = (o = {}) => ({ type: 'sculpture', description: 'Bronze', w: 20, h: 30, d: 20, weight: 80, value: 5000, ...o });
const stop = (street, city, zip) => ({ street, city, state: 'CA', zip, contactName: 'Jordan Lee', contactPhone: '(310) 555-0199', contactRole: 'Homeowner', accessMode: 'ground', dock: 'no', doorway: 'single', fits: 'yes' });

let child, availCache;
async function startServer(extraEnv = {}) {
  child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, STORAGE_DIR: STORAGE, TEST_MODE: '1', ADMIN_KEY: ADMIN, BASE_URL: BASE, HELPER_HOLD_ORDERS: '0', NODE_ENV: 'test', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { if (process.env.DEBUG) process.stderr.write(d); });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/config'); if (r.ok) return; } catch {} await sleep(250); }
  throw new Error('server did not start');
}
function killServer() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const c = child; child = null;
    const done = () => resolve();
    c.once('exit', done);
    try { c.kill(); } catch { return done(); }
    setTimeout(() => { try { c.kill('SIGKILL'); } catch {} done(); }, 2000);
  });
}
async function dates() {
  if (availCache) return availCache;
  const a = await post('/api/availability', { service: 'pickup_delivery', items: [paint()], pickup: { street: '8678 Melrose Ave', city: 'West Hollywood', state: 'CA', zip: '90069' }, dropoff: { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', state: 'CA', zip: '90210' } });
  const d = a.j.days[0].date;
  const b = await post('/api/availability', { service: 'pickup_delivery', leg: 'dropoff', items: [paint()], schedule: { date: d }, pickup: { street: '8678 Melrose Ave', city: 'West Hollywood', state: 'CA', zip: '90069' }, dropoff: { street: '1200 Summit Ridge Dr', city: 'Beverly Hills', state: 'CA', zip: '90210' } });
  availCache = { pu: d, del: b.j.days[0].date };
  return availCache;
}
async function orderBody(items, extra = {}) {
  const d = await dates();
  return {
    service: 'pickup_delivery', items,
    pickup: stop('8678 Melrose Ave', 'West Hollywood', '90069'),
    dropoff: stop('1200 Summit Ridge Dr', 'Beverly Hills', '90210'),
    contact: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '(310) 555-0199', clientType: 'Collector' },
    heard: { source: 'google' }, payer: 'me',
    schedule: { date: d.pu, deliveryDate: d.del, timePref: 'none', deliveryTimePref: 'none' },
    notes: 'atlas review', ...extra,
  };
}

async function sectionPhotoRules() {
  hdr('1. Direct API photo rules (bypass the browser)');
  const unsureOff = await post('/api/orders', await orderBody([sculpt({ weight: '', weightUnsure: true, fragile: false, photos: [], description: 'Unknown wt, no photo' })]));
  ok(unsureOff.status === 200, 'API: unknown weight + special handling OFF + no photo is accepted', unsureOff.j);
  const heavyOff = await post('/api/orders', await orderBody([sculpt({ weight: 600, fragile: false, photos: [], description: '600 lb, no photo' })]));
  ok(heavyOff.status === 200, 'API: weight over 500 lb + special handling OFF + no photo is accepted', heavyOff.j);
  const specialNo = await post('/api/orders', await orderBody([paint({ fragile: true, photos: [], description: 'Special, no photo' })]));
  ok(specialNo.status === 400 && /photos \(special handling\)/.test(specialNo.j.error || ''), 'API: special handling ON + no photo is rejected by the server', specialNo.j);
  const specialYes = await post('/api/orders', await orderBody([paint({ fragile: true, photos: ['/uploads/x.png'], description: 'Special, with photo' })]));
  ok(specialYes.status === 200, 'API: special handling ON + photo is accepted', specialYes.j);
}

async function sectionMaterialNotes() {
  hdr('2. materialNotes lifecycle, sheet TEST ORDERS path, formula safety');

  ok(schedule.safeSheetText('') === '', 'safeSheetText: empty / missing is empty');
  ok(schedule.safeSheetText('ceramic vase, glass top') === 'ceramic vase, glass top', 'safeSheetText: commas are kept (one cell, not a CSV split)');
  ok(schedule.safeSheetText('line1\nline2\r\nline3') === 'line1 line2 line3', 'safeSheetText: line breaks collapse to spaces');
  ok(schedule.safeSheetText('=SUM(1+1)') === "'=SUM(1+1)", 'safeSheetText: leading = is prefixed with a single quote');
  ok(schedule.safeSheetText('+1-800') === "'+1-800", 'safeSheetText: leading + is prefixed');
  ok(schedule.safeSheetText('-2 packs') === "'-2 packs", 'safeSheetText: leading - is prefixed');
  ok(schedule.safeSheetText('@SUM(A1)') === "'@SUM(A1)", 'safeSheetText: leading @ is prefixed');
  ok(schedule.COLUMNS.length === 35 && schedule.COLUMNS[12] === 'Item(s) and dimensions, weight, value, etc-', 'sheet column list is unchanged (35 columns; Items still at M)');

  const oldOrder = {
    id: 'CAD-OLD1', service: 'pickup_delivery', status: 'confirmed',
    items: [{ type: 'painting', description: 'Legacy canvas', w: 30, h: 40, d: 2, framed: 'no', value: 5000, photos: [] }],
    pickup: stop('8678 Melrose Ave', 'West Hollywood', '90069'),
    dropoff: stop('1200 Summit Ridge Dr', 'Beverly Hills', '90210'),
    contact: { name: 'Old Client', email: 'old@example.com', phone: '3105550100' },
    schedule: { date: '2026-12-01', deliveryDate: '2026-12-01' },
    quote: { total: 275 }, payment: { status: 'paid', method: 'mock_card', amount: 275, ref: 'mock_old' },
    createdAt: '2026-11-19T00:00:00.000Z',
  };
  let oldOk = false, oldDetail = '', oldItems = '';
  try {
    const rows = schedule.rowsForOrder(oldOrder);
    oldItems = String(rows[0][schedule.COLUMNS.indexOf('Item(s) and dimensions, weight, value, etc-')]);
    oldDetail = pieceDetail(oldOrder.items[0], 0);
    oldOk = rows.length === 2 && rows.every((r) => r.length === schedule.COLUMNS.length) && /Legacy canvas/.test(oldItems) && /Legacy canvas/.test(oldDetail);
  } catch (e) { oldOk = false; oldItems = String(e); }
  ok(oldOk, 'old orders with no materialNotes field still build sheet rows and admin/email detail', { oldItems, oldDetail });

  const a = paint({ description: 'Vase piece', materialNotes: 'ceramic vase, glass top' });
  const b = paint({ description: 'Frame piece', materialNotes: '=SUM(1+1)\n+bonus @home -wrap' });
  const created = await post('/api/orders', await orderBody([a, b]));
  ok(created.status === 200 && created.j.order.items[0].materialNotes === 'ceramic vase, glass top' && created.j.order.items[1].materialNotes === '=SUM(1+1)\n+bonus @home -wrap', 'API: each piece keeps its own raw materialNotes on the order payload', created.j && created.j.order && created.j.order.items.map((i) => i.materialNotes));
  const paid = await post(`/api/orders/${created.j.id}/pay`, { method: 'card', card: '4242424242424242' });
  ok(paid.status === 200 && paid.j.order.status === 'confirmed', 'API: mock payment confirms the two-piece notes order', paid.j);

  const adm = await adminGet('/api/admin/orders');
  const ao = (adm.j.orders || []).find((x) => x.id === created.j.id);
  ok(ao && ao.itemLines.length === 2 && /ceramic vase, glass top/.test(ao.itemLines[0]) && !/=SUM\(1\+1\)/.test(ao.itemLines[0]) && /Vase piece/.test(ao.itemLines[0]), 'admin detail: piece 1 shows its own material notes only', ao && ao.itemLines);
  ok(ao && /Frame piece/.test(ao.itemLines[1]) && /SUM\(1\+1\)/.test(ao.itemLines[1]) && !/ceramic vase/.test(ao.itemLines[1]), 'admin detail: piece 2 shows its own notes only', ao && ao.itemLines);

  const mailFiles = fs.readdirSync(path.join(STORAGE, 'outbox')).filter((f) => f.startsWith(created.j.id + '-'));
  const mail = mailFiles.map((f) => fs.readFileSync(path.join(STORAGE, 'outbox', f), 'utf8')).join('\n').replace(/<[^>]*>/g, ' ');
  ok(mailFiles.length > 0 && /ceramic vase, glass top/.test(mail) && /SUM\(1\+1\)/.test(mail) && /Piece 1 — Vase piece/.test(mail) && /Piece 2 — Frame piece/.test(mail), 'confirmation email includes each piece’s material notes', mail.slice(0, 500));

  const col = schedule.COLUMNS.indexOf('Item(s) and dimensions, weight, value, etc-');
  const sheetLine = schedule.itemsText(paid.j.order.items, paid.j.order);
  ok(/ceramic vase, glass top/.test(sheetLine) && /Piece 1 — Vase piece/.test(sheetLine) && /Piece 2 — Frame piece/.test(sheetLine), 'sheet Items text names both pieces and keeps notes on the right piece', sheetLine);
  ok(/'=SUM\(1\+1\) \+bonus @home -wrap/.test(sheetLine) && !/^\s*=/m.test(sheetLine.split('\n')[1] || ''), 'formula-like notes are neutralized with a leading quote; line breaks flattened', sheetLine);

  // Mock-bridge TEST ORDERS path (no TEST_ONLY_MOCK_AS_LIVE, so mock payments never go to ONLINE ORDERS).
  await killServer(); availCache = null;
  const seed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const bridge = await startBridge({ seed: seed.map((r) => r.slice()) });
  const mainSnap = () => JSON.stringify((bridge.sheet('SCHEDULE 2026').cells || []).map((r) => r.slice()));
  const mainBefore = mainSnap();
  const storage2 = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-br-'));
  await startServer({
    STORAGE_DIR: storage2,
    SHEETS_WEBHOOK_URL: bridge.url,
    SHEETS_WEBHOOK_SECRET: bridge.secret,
    SHEETS_PUMP_MS: '200',
    SHEETS_BACKOFF_SCALE: '0.01',
  });
  const body = await orderBody([
    paint({ description: 'Bridge A', materialNotes: 'silk, watercolor' }),
    paint({ description: 'Bridge B', materialNotes: '=HYPERLINK("http://evil")' }),
  ]);
  const c2 = await post('/api/orders', body);
  const p2 = await post(`/api/orders/${c2.j.id}/pay`, { method: 'card', card: '4242424242424242' });
  ok(p2.status === 200 && p2.j.order.payment && /^mock/.test(String(p2.j.order.payment.method)), 'bridge: mock payment (no live charge)', p2.j && p2.j.order && p2.j.order.payment);
  ok(schedule.isTestOrder(p2.j.order) === true, 'bridge: isTestOrder is true, so the hook writes TEST ORDERS, not ONLINE ORDERS');
  const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
  const testRows = await waitFor(() => {
    const sh = bridge.sheet('TEST ORDERS');
    if (!sh) return null;
    const rows = sh.cells.map((r, i) => ({ r, i: i + 1 })).filter(({ r }) => String(r[9] || '').startsWith(`ONLINE ORDER ${c2.j.id} `));
    return rows.length >= 2 ? rows : null;
  });
  ok(!!testRows, 'bridge: two rows landed on the TEST ORDERS tab only', testRows && testRows.length);
  const live = bridge.sheet('ONLINE ORDERS');
  const liveHits = live ? live.cells.filter((r) => String(r[9] || '').includes(c2.j.id)).length : 0;
  ok(liveHits === 0, 'bridge: nothing written to ONLINE ORDERS');
  ok(mainSnap() === mainBefore, 'bridge: SCHEDULE 2026 tab is unchanged (harness never writes the real sheet)');
  const itemsCell = testRows ? String(testRows[0].r[col] || '') : '';
  ok(/Piece 1 — Bridge A/.test(itemsCell) && /silk, watercolor/.test(itemsCell) && /Piece 2 — Bridge B/.test(itemsCell) && /'=HYPERLINK/.test(itemsCell), 'bridge TEST ORDERS Items line has both notes, formula neutralized', itemsCell);
  ok(!testRows.some(({ r }) => r.some((c) => String(c).startsWith('#FORMULA:'))), 'bridge: no cell was executed as a formula');
  ok(testRows.every(({ r }) => r.length === schedule.COLUMNS.length || r.length >= schedule.COLUMNS.length), 'bridge: column count on TEST ORDERS rows matches COLUMNS');
  await bridge.close();
  await killServer(); availCache = null;
  await startServer();
}

async function sectionLabelsAndUi() {
  hdr('3. Next labels, 375/320 fallback, other steps, zoom / long description; browser photo+notes rules');
  const browser = await pw.chromium.launch();

  const btnOf = (page) => page.$eval('#nextBtn', (b) => b.textContent.trim());
  const panelOf = (page) => page.evaluate(() => { const p = [...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden); return p ? p.dataset.panel : ''; });
  const settle = (page) => page.waitForFunction(() => !/Updating estimate/.test((document.querySelector('#estLabel') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const nextFree = async (page) => {
    await settle(page);
    await page.waitForFunction(() => {
      const b = document.querySelector('#nextBtn');
      return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.classList.contains('is-wait');
    }, null, { timeout: 10000 });
    await page.click('#nextBtn');
    await page.waitForTimeout(300);
  };
  async function openWhat(page, service = 'pickup_delivery') {
    await page.goto(BASE);
    await page.evaluate(() => (sessionStorage.clear(), localStorage.clear()));
    await page.goto(BASE);
    await page.waitForSelector('[data-service]');
    await page.click(`[data-service="${service}"]`);
    await nextFree(page);
    await page.waitForFunction(() => ([...document.querySelectorAll('[data-panel]')].find((x) => !x.hidden) || {}).dataset.panel === 'p0a');
  }

  // Wide viewport: long "size of piece N" / "value of piece N" labels.
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await ctx.newPage();
    await openWhat(page);
    ok((await btnOf(page)) === 'Next: size of piece 1', '1024px, 1 painting: Next is "Next: size of piece 1"', await btnOf(page));
    await page.fill('[data-path="items.0.description"]', 'First');
    await nextFree(page); // size
    ok((await panelOf(page)) === 'p0b' && (await btnOf(page)) === 'Next', 'size step (and other non-description steps) still say "Next"', await btnOf(page));
    await page.fill('[data-path="items.0.w"]', '30'); await page.fill('[data-path="items.0.h"]', '40'); await page.fill('[data-path="items.0.d"]', '2');
    await page.click('[data-seg="items.0.framed"] [data-v="no"]'); await page.click('[data-seg="items.0.glazing"] [data-v="no"]');
    await nextFree(page); // care
    ok((await panelOf(page)) === 'p0c' && (await btnOf(page)) === 'Next', 'Value and care says "Next"');
    await page.fill('[data-path="items.0.value"]', '5000');
    await page.fill('[data-path="items.0.materialNotes"]', 'note A original');
    await nextFree(page); // list
    await page.click('#addItem'); await page.waitForTimeout(250);
    ok((await panelOf(page)) === 'p1a' && (await btnOf(page)) === 'Next: size of piece 2', 'second piece description: "Next: size of piece 2"', await btnOf(page));
    await page.fill('[data-path="items.1.description"]', 'Second');
    await nextFree(page);
    await page.fill('[data-path="items.1.w"]', '20'); await page.fill('[data-path="items.1.h"]', '20'); await page.fill('[data-path="items.1.d"]', '2');
    await page.click('[data-seg="items.1.framed"] [data-v="no"]'); await page.click('[data-seg="items.1.glazing"] [data-v="no"]');
    await nextFree(page);
    await page.fill('[data-path="items.1.value"]', '4000');
    await page.fill('[data-path="items.1.materialNotes"]', 'note B stays');
    await nextFree(page);
    // Back to piece 1 description via Edit, then its care screen, edit notes, confirm piece 2 unchanged.
    await page.click('[data-piece-row="0"] [data-goto]'); await page.waitForTimeout(300);
    // Jump forward to care of piece 1: Next through size.
    if ((await panelOf(page)) === 'p0a') { await nextFree(page); }
    if ((await panelOf(page)) === 'p0b') { await nextFree(page); }
    ok((await panelOf(page)) === 'p0c', 'returned to piece 1 Value and care');
    const before = await page.inputValue('[data-path="items.0.materialNotes"]');
    ok(before === 'note A original', 'navigating back keeps piece 1 notes', before);
    await page.fill('[data-path="items.0.materialNotes"]', 'note A edited');
    await nextFree(page);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cad-order')));
    ok(st.items[0].materialNotes === 'note A edited' && st.items[1].materialNotes === 'note B stays', 'after editing piece 1, each note stays on its own piece', st.items.map((i) => i.materialNotes));
    await ctx.close();
  }

  // Furniture / custom on a wide viewport.
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await ctx.newPage();
    await openWhat(page);
    await page.click('[data-itemtype="0"] [data-v="furniture"]'); await page.waitForTimeout(250);
    const furn = await btnOf(page);
    ok(/^Next: value/.test(furn), 'furniture (no size step): Next starts with "Next: value"', furn);
    await page.click('[data-itemtype="0"] [data-v="custom"]'); await page.waitForTimeout(250);
    const cus = await btnOf(page);
    ok(/^Next: value/.test(cus), 'custom (no size step): Next starts with "Next: value"', cus);
    await ctx.close();
  }

  // 375 / 320 fallback, zoom + long description, special-handling copy, sculpture helper, browser photo rules.
  for (const [w, h, expectBtn] of [[375, 812, 'Next: size'], [320, 568, 'Next: size']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await openWhat(page);
    ok((await btnOf(page)) === expectBtn, `${w}px painting: Next is "${expectBtn}"`, await btnOf(page));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 0, `${w}px description step has no horizontal overflow`, overflow);
    await page.fill('[data-path="items.0.description"]', 'A very long description that a client might type when they are tempted to put the size and the artist and the medium all in one box ' + 'x'.repeat(80));
    await page.waitForTimeout(150);
    const reach = await page.evaluate(() => {
      const check = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, why: 'missing' };
        const r = el.getBoundingClientRect();
        const x = Math.min(innerWidth - 2, Math.max(2, r.left + r.width / 2));
        const y = Math.min(innerHeight - 2, Math.max(2, r.top + r.height / 2));
        const hit = document.elementFromPoint(x, y);
        return { ok: r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !!hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest(sel))), r: { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }, hit: hit && hit.id };
      };
      return { back: check('#backBtn'), next: check('#nextBtn') };
    });
    ok(reach.back.ok && reach.next.ok, `${w}px with a long description: Back and Next stay reachable`, reach);
    if (w === 320) {
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      await page.waitForTimeout(200);
      await page.evaluate(() => { const d = document.querySelector('#dock'); if (d) d.scrollIntoView({ block: 'end' }); });
      const zoomed = await page.evaluate(() => {
        const check = (sel) => {
          const el = document.querySelector(sel);
          const r = el.getBoundingClientRect();
          return r.width > 8 && r.height > 8 && r.right > 0 && r.bottom > 0;
        };
        return { back: check('#backBtn'), next: check('#nextBtn'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      ok(zoomed.back && zoomed.next, '320px at 200% zoom: Back and Next still have a tappable box', zoomed);
      await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    }
    await ctx.close();
  }

  // Browser rules match the server: Not sure does not block; special handling does; sculpture helper; handling copy wraps at 320.
  {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await openWhat(page);
    await page.click('[data-itemtype="0"] [data-v="sculpture"]'); await page.waitForTimeout(200);
    await page.fill('[data-path="items.0.description"]', 'Bronze');
    await nextFree(page); // size (sculpture has size)
    if ((await panelOf(page)) === 'p0b') {
      await page.fill('[data-path="items.0.w"]', '20'); await page.fill('[data-path="items.0.h"]', '30'); await page.fill('[data-path="items.0.d"]', '20');
      await nextFree(page);
    }
    ok((await panelOf(page)) === 'p0c', 'sculpture lands on Value and care');
    const care = await page.textContent('[data-panel="p0c"]');
    ok(/Pick a weight or Not sure; it affects the price/.test(care), 'sculpture/other weight helper is shown');
    ok(await page.isVisible('details.handling summary'), 'special handling starts collapsed');
    await page.click('details.handling summary'); await page.waitForTimeout(150);
    const careOpen = await page.textContent('[data-panel="p0c"]');
    ok(/Only for extremely fragile or awkward pieces, ones that can’t stand upright, or ones that may need custom crating/.test(careOpen), 'special handling copy is on the step once expanded');
    const wrap = await page.evaluate(() => {
      const p = [...document.querySelectorAll('[data-panel="p0c"] .mini')].find((el) => /Only for extremely fragile or awkward pieces/.test(el.textContent));
      if (!p) return { ok: false };
      const r = p.getBoundingClientRect();
      return { ok: p.scrollWidth <= p.clientWidth + 1 && r.right <= innerWidth + 1, sw: p.scrollWidth, cw: p.clientWidth, right: r.right, vw: innerWidth };
    });
    ok(wrap.ok, 'special handling text wraps cleanly at 320px (no horizontal overflow)', wrap);
    await page.fill('[data-path="items.0.value"]', '5000');
    await page.click('[data-weightunsure="0"]'); await page.waitForTimeout(200);
    await settle(page);
    const blockedUnsure = await page.$eval('#nextBtn', (b) => !!(b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('is-wait')));
    ok(!blockedUnsure, 'browser: Not sure + no photo does not block Next (matches the API)');
    await page.click('label.toggle:has([data-path="items.0.fragile"])'); await page.waitForTimeout(200);
    await settle(page);
    const blockedSpecial = await page.$eval('#nextBtn', (b) => !!(b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('is-wait')));
    ok(blockedSpecial, 'browser: special handling ON + no photo blocks Next (matches the API)');
    const need = (await page.textContent('#needLine') || '').trim();
    ok(/Photos — Piece 1/.test(need), 'browser field counter names photos, not weight', need);
    await ctx.close();
  }

  await browser.close();
}

async function sectionPostDeploy() {
  hdr('4. post-deploy-check.js safety (no live charges, no production writes)');
  const live = preflight({ env: { STRIPE_SECRET_KEY: 'sk_live_51Fake' }, base: 'https://cad-ordering-test.onrender.com' });
  ok(!live.ok && /not a test key/.test(live.error), 'preflight refuses a live Stripe key', live);
  const odd = preflight({ env: { STRIPE_SECRET_KEY: 'sk_prod_xxx' }, base: 'https://cad-ordering-test.onrender.com' });
  ok(!odd.ok, 'preflight refuses any sk_ key that is not sk_test_');
  const prod = preflight({ env: {}, base: 'https://californiaartdelivery.com' });
  ok(!prod.ok && /not the test site/.test(prod.error), 'preflight refuses a production host', prod);
  const liveCfg = preflight({ env: {}, base: 'https://cad-ordering-test.onrender.com', config: { livemode: true } });
  ok(!liveCfg.ok && /live mode/.test(liveCfg.error), 'preflight refuses when /api/config reports livemode');
  const okTest = preflight({ env: { STRIPE_SECRET_KEY: 'sk_test_abc' }, base: 'https://cad-ordering-test.onrender.com', config: { livemode: false } });
  ok(okTest.ok, 'preflight allows the test host with a test key and livemode false');

  const run = (env) => new Promise((resolve) => {
    const c = spawn('node', ['scripts/post-deploy-check.js'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { try { c.kill(); } catch {} resolve({ code: 99, out: out + '\n(timeout)' }); }, 8000);
    c.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
  const r1 = await run({ STRIPE_SECRET_KEY: 'sk_live_aaa', BASE: 'https://cad-ordering-test.onrender.com' });
  ok(r1.code === 1 && /not a test key/.test(r1.out), 'script exits nonzero with a live key and does not start a booking', { code: r1.code, out: r1.out.slice(0, 400) });
  const r2 = await run({ STRIPE_SECRET_KEY: 'sk_live_aaa', BASE: 'https://cad-ordering-test.onrender.com' });
  ok(r2.code === 1 && r1.out === r2.out, 'running the live-key refusal twice is harmless and identical', { code: r2.code });
  const r3 = await run({ BASE: 'https://www.californiaartdelivery.com' });
  ok(r3.code === 1 && /not the test site/.test(r3.out), 'script exits nonzero against a production host before any booking', { code: r3.code, out: r3.out.slice(0, 400) });
  const r4 = await run({ BASE, POST_DEPLOY_DRY_RUN: '1' });
  ok(r4.code === 0 && /preflight ok/.test(r4.out), 'dry run against this local TEST_MODE server exits 0 and books nothing', r4.out.slice(0, 400));
  const r5 = await run({ BASE, POST_DEPLOY_DRY_RUN: '1' });
  ok(r5.code === 0 && r4.out === r5.out, 'running the dry-run check twice is harmless and identical');
  const cfg = await get('/api/config');
  ok(cfg.j && cfg.j.livemode === false, 'local /api/config reports livemode: false (server refuses live keys)', cfg.j);
}

(async () => {
  await startServer();
  try {
    await sectionPhotoRules();
    await sectionMaterialNotes(); // restarts the server with a mock bridge at the end
    await sectionLabelsAndUi();
    await sectionPostDeploy();
  } catch (e) {
    ok(false, 'suite crashed: ' + (e && e.stack || e));
  }
  await killServer();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
  fs.writeFileSync('/workspace/atlas_review_results.json', JSON.stringify({ at: new Date().toISOString(), passed: results.length - bad.length, failed: bad.length, results }, null, 2));
  process.exit(bad.length ? 1 : 0);
})();
