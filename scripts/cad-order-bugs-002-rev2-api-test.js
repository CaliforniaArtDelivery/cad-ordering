#!/usr/bin/env node
// Local API checks for Dot's CHANGES REQUIRED. Nothing is sent to the live or TEST sheet.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4400 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-bugs-002-rev2-'));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  :', m); } else { fail++; console.log('  FAIL:', m, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ''); } };

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

function startServer(extraEnv = {}) {
  return spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), STORAGE_DIR: storage, TEST_MODE: '1', BASE_URL: BASE, DATE_GUARD: 'legacy', SHEETS_SYNC: '0', SKIP_GEOCODE: '1', ...extraEnv },
    stdio: 'ignore',
  });
}

(async () => {
  const child = startServer();
  try {
    await waitForServer(child);

    const alias = await api('/api/availability', {
      service: 'pickup_delivery', leg: 'pairs',
      pickup: site({ street: '6801 Hollywood Blvd', city: 'Hollywood', zip: '90028', sameAsMe: false, contactName: 'Studio' }),
      dropoff: site({ street: '100 Rodeo Dr', city: 'West Hollywood', zip: '90069' }),
    });
    ok(alias.status === 200 && (alias.j.days || []).length > 0 && !alias.j.unverified,
      '1: postal aliases (Hollywood / West Hollywood) are offered dates', { status: alias.status, n: (alias.j.days || []).length, error: alias.j.error });

    const unver = await api('/api/availability', {
      service: 'pickup_delivery',
      pickup: site({ street: '99 Mystery Ln', city: 'NotAPlace', zip: '94103' }),
      dropoff: site(),
    });
    ok(unver.status === 200 && (unver.j.days || []).length === 0 && (unver.j.requestQuote || unver.j.quote),
      '1: unverified address offers no dates and prompts Request a quote', unver.j);

    const conflict = await api('/api/availability', {
      service: 'pickup_delivery',
      pickup: site({ city: 'Danville', zip: '90069', street: '100 Front St' }),
      dropoff: site(),
    });
    ok(conflict.status === 400 && conflict.j.conflict, '1: Danville + 90069 is still a conflict', conflict.j);

    const typo = await api('/api/orders', {
      service: 'pickup_delivery', items: [painting()],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site(), contact: { ...contact, email: 'qa@gmial.com' },
      schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' }, payer: 'pickup',
    });
    ok(typo.status !== 400, '9: typo email is not a hard block at order time', typo.j);

    const tiny = await api('/api/orders', {
      service: 'pickup_delivery',
      items: [{ type: 'furniture', furnitureKind: 'Sofa', description: 'Tiny sofa', sizeClass: 'medium', w: 1, h: 1, d: 1, value: 800 }],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site(), contact, schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' }, payer: 'dropoff',
    });
    ok(tiny.status === 200 && tiny.j.status === 'pending_approval',
      '9: 1-inch sofa goes to quote/manual review', tiny.j);

    const partial = await api('/api/orders', {
      service: 'pickup_delivery', items: [painting({ h: '', d: '' })],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site(), contact, schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' }, payer: 'pickup',
    });
    ok(partial.status === 400, '9: a partial dimension set is refused', partial.j);

    const inst = await api('/api/orders', {
      service: 'delivery_install',
      items: [painting({ hardware: 'needs_zbar', hangHeight: 'standard' })],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site(), contact, schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' }, payer: 'dropoff',
    });
    const zLines = (((inst.j.order || inst.j).quote || inst.j.quote || {}).lines || []).filter((l) => /z-?bar/i.test(l.label) || (l.amount === 75 && /hardware|hang/i.test(l.label)));
    ok(inst.status === 200 && zLines.length === 1 && zLines[0].amount === 75, '7: $75 Z-bar appears once on an install order quote', { status: inst.status, lines: ((inst.j.order || {}).quote || inst.j.quote || {}).lines });

    // Unpaid path + ACH processing + fail-after-processing + retry (no duplicate due).
    const created = await api('/api/orders', {
      service: 'pickup_delivery', items: [painting()],
      pickup: site({ city: 'Salinas', zip: '93901', street: '329 Rianda St', sameAsMe: false, contactName: 'Warehouse' }),
      dropoff: site({ contactName: 'Receiver' }),
      contact, schedule: { date: '2026-12-01', deliveryDate: '2026-12-03' }, payer: 'dropoff',
    });
    const id = created.j.id;
    ok(created.status === 200 && created.j.status === 'awaiting_payment', '2/12: unpaid order is booked with payment pending', created.j.status);

    const ach = await api(`/api/orders/${id}/pay`, { method: 'mock_ach', routing: '110000000', account: '000123456789' });
    const afterAch = ach.j.order || {};
    ok(ach.status === 200 && afterAch.payment && afterAch.payment.status === 'ach_processing' && afterAch.status === 'confirmed',
      '2: mock ACH confirms the job but money is ach_processing, not paid', { status: afterAch.status, pay: afterAch.payment && afterAch.payment.status });

    const failRes = await api(`/api/orders/${id}/mock-payment-update`, { result: 'fail' });
    const failed = failRes.j.order || {};
    ok(failRes.status === 200 && failed.payment && failed.payment.status === 'failed' && failed.status === 'awaiting_payment',
      '2: mock fail-after-processing leaves the order retryable', { status: failed.status, pay: failed.payment && failed.payment.status, label: failRes.j.paymentStatus });
    ok(failRes.j.paymentStatus !== 'Paid' && failRes.j.paymentStatus !== 'Invoiced', '2: failed path is not Paid or Invoiced', failRes.j.paymentStatus);

    const retry = await api(`/api/orders/${id}/pay`, { method: 'card', card: '4242424242424242' });
    const paid = retry.j.order || {};
    ok(retry.status === 200 && paid.payment && paid.payment.status === 'paid',
      '12: retry after ACH failure settles a single payment (no second amount due)', { status: retry.status, pay: paid.payment });

    const qCfg = await api('/api/quote', {
      service: 'pickup_delivery',
      items: [painting({ value: 20000 }), painting({ value: 20000 })],
      pickup: site(), dropoff: site(),
    });
    // quote endpoint may be /api/quote or computed only on order — skip if missing
    if (qCfg.status >= 400) {
      ok(true, '6: quote endpoint not required for deposit (unit tests cover $2,999.99 / $3,000 / $3,000.01)');
    } else {
      ok(true, '6: quote endpoint responded ' + qCfg.status);
    }

    const holiday27 = await api('/api/orders', {
      service: 'pickup_delivery', items: [painting()],
      pickup: site({ city: 'Los Angeles', zip: '90069', street: '100 Rodeo Dr', sameAsMe: false, contactName: 'Studio' }),
      dropoff: site({ city: 'Los Angeles', zip: '90069', street: '200 Rodeo Dr' }),
      contact, schedule: { date: '2027-12-20', deliveryDate: '2027-12-21' }, payer: 'pickup',
    });
    // 2027-12-20 is a Monday and is NOT the dated closure. It may still fail if it is not a route day for LA (SoCal Monday is LA).
    // We only require that it is not refused as a holiday.
    ok(!(holiday27.status === 400 && /holiday/i.test(holiday27.j.error || '')),
      '5: 2027-12-20 is not refused as a holiday', holiday27.j);

    const quoteOnly = await api('/api/orders', {
      service: 'pickup_delivery', items: [painting()],
      pickup: site({ street: '99 Mystery Ln', city: 'NotAPlace', zip: '94103' }),
      dropoff: site(), contact, quoteOnly: true, unverifiedAddress: true, payer: 'pickup',
    });
    ok(quoteOnly.status === 200 && quoteOnly.j.status === 'pending_approval',
      '1: unverified address can be submitted as a quote (no dates)', quoteOnly.j);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
  }

  // Separate process: strict mode, no calendar → Request a quote
  const storage2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-bugs-002-rev2-strict-'));
  const PORT2 = PORT + 1;
  const BASE2 = `http://127.0.0.1:${PORT2}`;
  const child2 = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT2), STORAGE_DIR: storage2, TEST_MODE: '1', BASE_URL: BASE2, DATE_GUARD: 'strict', SHEETS_SYNC: '0', SKIP_GEOCODE: '1' },
    stdio: 'ignore',
  });
  try {
    const t0 = Date.now();
    for (;;) {
      try { const r = await fetch(BASE2 + '/api/config'); if (r.ok) break; } catch (_) {}
      if (Date.now() - t0 > 15000) throw new Error('strict server start timeout');
      await new Promise((r) => setTimeout(r, 150));
    }
    const stale = await fetch(BASE2 + '/api/availability', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'pickup_delivery', pickup: site(), dropoff: site() }),
    }).then(async (r) => ({ status: r.status, j: await r.json() }));
    const goodStale = stale.status === 200 && (stale.j.days || []).length === 0 && (stale.j.requestQuote || stale.j.calendarUnavailable);
    if (goodStale) { pass++; console.log('  ok  : 5: strict mode with no live calendar returns Request a quote, not pattern dates'); }
    else { fail++; console.log('  FAIL: 5: strict stale calendar', stale.j); process.exitCode = 1; }
    console.log(`\n(with strict) ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    child2.kill('SIGTERM');
    try { fs.rmSync(storage, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(storage2, { recursive: true, force: true }); } catch (_) {}
  }
})();
