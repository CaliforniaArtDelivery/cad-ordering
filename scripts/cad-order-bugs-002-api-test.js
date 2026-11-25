#!/usr/bin/env node
// Local API checks for CAD-ORDER-BUGS-002. Nothing is sent to the live sheet.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4300 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-bugs-002-'));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };

const contact = { name: 'QA Tester', email: 'qa@example.com', phone: '4155550199', clientType: 'Artist' };
const site = (over = {}) => ({
  street: '1230 65th St', city: 'Emeryville', state: 'CA', zip: '94608', country: 'United States',
  contactName: 'QA Tester', contactPhone: '4155550199', contactRole: 'Client', sameAsMe: true,
  accessMode: 'ground', fits: 'yes', ...over,
});
const painting = (over = {}) => ({
  type: 'painting', description: 'Test canvas', w: 24, h: 30, d: 2, weight: 12, value: 2500, framed: 'no', ...over,
});

async function api(pathname, body, method = 'POST') {
  const r = await fetch(BASE + pathname, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (_) {}
  return { status: r.status, j };
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try { const r = await fetch(BASE + '/api/config'); if (r.ok) return resolve(); } catch (_) {}
      if (Date.now() - t0 > 15000) return reject(new Error('server start timeout'));
      setTimeout(tick, 150);
    };
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
    tick();
  });
}

(async () => {
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), STORAGE_DIR: storage, TEST_MODE: '1', BASE_URL: BASE, DATE_GUARD: 'legacy', SHEETS_SYNC: '0' },
    stdio: 'ignore',
  });
  try {
    await waitForServer(child);

    const bad = await api('/api/availability', {
      service: 'pickup_delivery',
      pickup: site({ city: 'Danville', zip: '90069', street: '100 Front St' }),
      dropoff: site(),
    });
    ok(bad.status === 400 && bad.j.conflict && /don’t match|don't match|same delivery area|same area/i.test(bad.j.error || ''),
      '1: availability blocks Danville + 90069 and offers no dates', { status: bad.status, error: bad.j.error, days: bad.j.days });

    const good = await api('/api/availability', {
      service: 'pickup_delivery', leg: 'pairs',
      pickup: { ...site({ street: '329 Rianda St', city: 'Salinas', zip: '93901', sameAsMe: false, contactName: 'Warehouse' }) },
      dropoff: site(),
    });
    const puDates = (good.j.days || []).map((d) => d.date);
    ok(good.status === 200 && !puDates.includes('2026-12-05'), '8: pairs availability omits Sat Dec 5 Carmel for an Emeryville delivery', puDates.slice(0, 8));
    ok(!(good.j.days || []).some((d) => d.date >= '2026-12-20' && d.date <= '2027-01-01'), '5: availability omits Dec 20–Jan 1', puDates);

    const typo = await api('/api/orders', {
      service: 'pickup_delivery',
      items: [painting()],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site(),
      contact: { ...contact, email: 'team@calforniaartdelivery.co' },
      schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' },
      payer: 'me',
    });
    ok(typo.status !== 400, '9: typo email is not a hard block at order time (suggestion only)', typo.j);

    const tiny = await api('/api/orders', {
      service: 'pickup_delivery',
      items: [{ type: 'furniture', furnitureKind: 'Sofa', description: 'Tiny sofa', sizeClass: 'medium', w: 1, h: 1, d: 1, value: 800 }],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site(),
      contact, schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' }, payer: 'me',
    });
    ok(tiny.status === 200 && tiny.j.status === 'pending_approval' && /size_check/.test(JSON.stringify(tiny.j.order && tiny.j.order.review || {})),
      '9: 1-inch sofa goes to quote / manual review, not a hard block', tiny.j);

    const holiday = await api('/api/orders', {
      service: 'pickup_delivery',
      items: [painting()],
      pickup: site({ city: 'Los Angeles', zip: '90069', street: '100 Rodeo Dr', sameAsMe: false, contactName: 'Studio' }),
      dropoff: site({ city: 'Los Angeles', zip: '90069', street: '200 Rodeo Dr' }),
      contact, schedule: { date: '2026-12-21', deliveryDate: '2026-12-22' }, payer: 'me',
    });
    ok(holiday.status === 400, '5: an order on a holiday date is refused', holiday.j);

    const palQ = await api('/api/palomas/quote', {
      placedBy: { name: 'Arnie' }, pickupLocation: 'salinas', payer: 'client',
      items: [{ name: 'Paloma Chair', kind: 'Armchair / Accent Chair', qty: 1, catalogId: 'custom-1', custom: true, w: 30, d: 30, h: 36, weight: 40, value: 4000 }],
      delivery: { name: 'Alex Client', phone: '4155550100', email: 'alex@example.com', street: '1230 65th St', city: 'Emeryville', state: 'CA', zip: '94608' },
      access: { mode: 'ground' },
    });
    ok(palQ.status === 200 && palQ.j.protectionAmount > 0 && palQ.j.lines.some((l) => /Declared value protection/.test(l.label)),
      '3: Paloma quote API includes DVP', palQ.j.protectionAmount);

    const palConflict = await api('/api/palomas/availability', {
      pickupLocation: 'salinas',
      items: [{ name: 'Chair', kind: 'Armchair / Accent Chair', qty: 1, catalogId: 'custom-1', custom: true, w: 30, d: 30, h: 36, weight: 40, value: 4000 }],
      delivery: { name: 'A', phone: '4155550100', email: 'a@example.com', street: '100 Front St', city: 'Danville', state: 'CA', zip: '90069' },
    });
    ok(palConflict.status === 400 && palConflict.j.conflict, '1: Paloma availability blocks a city/ZIP conflict', palConflict.j);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(storage, { recursive: true, force: true }); } catch (_) {}
  }
})();
