/**
 * One-tab bridge (Chad, Nov 25 2026): real server + apps-script/Code.gs in the mock Spreadsheet, seeded from the TEST COPY as of
 * Nov 25 2026 (SCHEDULE 2026 + the old ONLINE ORDERS / TEST ORDERS / RAW LOG tabs). Checks: migration moves the old rows onto
 * SCHEDULE 2026 and deletes the three tabs; a paid order fills its date's empty slot rows; a quote request lands in the PENDING
 * block marked PENDINGJOB / Pending Job; mock-payment orders are marked TEST; retries never duplicate; days counts paid rows once.
 *   node scripts/onetab-bridge-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { startBridge } = require('./mock-bridge');
const FIX = JSON.parse(fs.readFileSync(process.env.ONETAB_FIXTURE || '/workspace/fixtures/schedule-2026-testcopy-nov25.json', 'utf8'));
const PORT = 3990 + Math.floor(Math.random() * 9), BASE = `http://127.0.0.1:${PORT}`;
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log(c ? '  ok  :' : '  FAIL:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const get = async (p) => (await fetch(BASE + p)).json();
const addr = (street, city, zip, x = {}) => ({ street, city, zip, state: 'CA', contactName: 'Pat Contact', contactPhone: '310-555-0110', accessMode: 'ground', fits: 'yes', contactRole: 'Homeowner', ...x });
const order = (date, over = {}) => ({ service: 'pickup_delivery', contact: { name: 'Onetab Test', email: 'client@example.com', phone: '310-555-0100' }, pickup: addr('8678 Melrose Ave', 'West Hollywood', '90069'), dropoff: addr('1200 Summit Ridge Dr', 'Beverly Hills', '90210'), items: [{ qty: 1, type: 'painting', framed: 'no', w: 30, h: 40, d: 2, value: 5000, description: 'Oil on canvas' }], schedule: { date, deliveryDate: date, timePref: 'midday' }, payer: 'me', notes: '', ...over });
(async () => {
  const bridge = await startBridge({ seed: FIX.main });
  bridge.book._mk('ONLINE ORDERS', FIX.online); bridge.book._mk('TEST ORDERS', FIX.test); bridge.book._mk('ONLINE ORDERS RAW LOG', FIX.raw);
  const main = () => bridge.sheet('SCHEDULE 2026');
  const rowsOf = (id) => main().cells.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) => String(r[9] || '').includes(`ONLINE ORDER ${id} `));
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-onetab-'));
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, STORAGE_DIR: storage, TEST_MODE: '1', ADMIN_KEY: 'k-123456', BASE_URL: BASE, NODE_ENV: 'test', SHEETS_PUMP_MS: '250', SHEETS_BACKOFF_SCALE: '0.01', SHEETS_WEBHOOK_URL: bridge.url, SHEETS_WEBHOOK_SECRET: bridge.secret }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await get('/api/config'); break; } catch { await sleep(250); } }
    console.log('\n[1] migration + one tab');
    const a = (await post('/api/availability', { service: 'pickup_delivery', pickup: { street: '1 A St', zip: '90069', city: 'West Hollywood' }, dropoff: { street: '1 B St', zip: '90210', city: 'Beverly Hills' }, items: [{ qty: 1, type: 'painting', framed: 'no', description: 'p' }] })).j;
    const D = a.days[0].date;
    const c = await post('/api/orders', order(D)); const p = await post(`/api/orders/${c.j.id}/pay`, { method: 'card', card: '4242424242424242' });
    ok(p.status === 200, `paid order ${c.j.id} on ${D}`);
    let saved = null; for (let i = 0; i < 40 && !saved; i++) { await sleep(200); const o = (await get('/api/orders/' + c.j.id)).order; if (o.scheduleStatus === 'saved') saved = o; }
    ok(saved, 'scheduleStatus saved after the sheet confirmed');
    ok(bridge.book._sheets.map((s) => s.name).join('|') === 'SCHEDULE 2026', 'only SCHEDULE 2026 is left: ' + bridge.book._sheets.map((s) => s.name).join(', '));
    const oldIds = [...new Set(FIX.test.slice(2).map((r) => (String(r[9]).match(/ONLINE ORDER (\S+) /) || [])[1]).filter(Boolean))];
    ok(oldIds.every((id) => rowsOf(id).length >= 1 && rowsOf(id).every(({ r }) => String(r[9]).startsWith('TEST ORDER (not a real job) · '))), `all ${oldIds.length} old TEST ORDERS orders moved onto SCHEDULE 2026, marked TEST`);
    const r1 = rowsOf(c.j.id);
    ok(r1.length === 2 && r1[0].r[5] === 'PU' && r1[1].r[5] === 'DEL', `paid order rows on SCHEDULE 2026 at ${r1.map((x) => x.n).join(', ')}`);
    ok(r1.every(({ r }) => String(r[9]).startsWith('TEST ORDER (not a real job) · ONLINE ORDER ')), 'mock payment => marked TEST in Update Notes');
    ok(r1.every(({ r, n }) => r[4] && main().cells[n - 2] && main().cells[n - 2][1] !== undefined), 'rows sit inside the date block (route text kept: "' + String(r1[0].r[4]).slice(0, 30) + '")');
    console.log('\n[2] retry never duplicates');
    await post(`/api/orders/${c.j.id}/pay`, { method: 'card', card: '4242424242424242' }); await sleep(800);
    ok(rowsOf(c.j.id).length === 2, 'second pay call writes nothing new');
    console.log('\n[3] quote request => PENDING block');
    const q = await post('/api/orders', order(a.days[1].date, { rush: true, notes: 'rush please' }));
    ok(q.status === 200 && q.j.status === 'pending_approval', 'rush request saved as pending_approval');
    let qr = []; for (let i = 0; i < 40 && !qr.length; i++) { await sleep(200); qr = rowsOf(q.j.id); }
    const firstDivider = main().cells.findIndex((r, i) => i >= 2 && !(r[0] === false || r[0] === true || r[0] === 'FALSE' || r[0] === 'TRUE')) + 1;
    ok(qr.length >= 1 && qr.every(({ r, n }) => r[6] === 'PENDINGJOB' && /PENDING REVIEW/.test(r[9]) && n < firstDivider), `pending rows at ${qr.map((x) => x.n).join(', ')} (above the divider at row ${firstDivider}), PENDINGJOB + PENDING REVIEW`);
    ok(qr.some(({ r }) => r[31] === 'Pending Job'), 'Payment Status "Pending Job"');
    console.log('\n[4] days');
    const days = await (await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ action: 'days', secret: bridge.secret }) })).json();
    ok(days.ok && days.days[D], `days answers for ${D} (jobRows ${days.days[D] && days.days[D].jobRows}, TEST rows not counted)`);
  } finally { child.kill('SIGKILL'); await bridge.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED'); process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
