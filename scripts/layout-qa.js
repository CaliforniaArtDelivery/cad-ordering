// Mobile layout QA: every step at iPhone sizes. Usage: node scripts/layout-qa.js  (E2E_BROWSER=webkit|chromium, BASE_URL=…)
// Checks per step: heading fully visible below the header at scroll-top, nothing covered by the bottom dock
// (every control is tappable when scrolled into view), no horizontal overflow, no scroll snap-back / scroll fighting.
const pw = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const engineName = process.env.E2E_BROWSER || 'chromium';
const SIZES = [[390, 844], [375, 667], [430, 932], [320, 568]];
const fill = (p, k, v) => p.fill(`[data-path="${k}"]`, String(v));

async function checkStep(page, label, problems, freshStep = false) {
  if (freshStep) {
    // Right after load / Continue, without touching scroll: must be at the very top with header + heading visible.
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => ({ y: window.scrollY, hb: document.querySelector('#top').getBoundingClientRect().bottom, ht: document.querySelector('#top').getBoundingClientRect().top, h1: document.querySelector('#app h1').getBoundingClientRect().top }));
    if (s.y !== 0) problems.push(`${label}: page not at top after load/Continue (scrollY=${s.y})`);
    if (s.ht < 0) problems.push(`${label}: app header pushed off the top (${s.ht})`);
    if (!(s.h1 > s.hb)) problems.push(`${label}: heading not below header after load/Continue (${s.h1} <= ${s.hb})`);
  }
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(450);
  const r = await page.evaluate(() => {
    const top = document.querySelector('#top').getBoundingClientRect();
    const h1 = document.querySelector('#app h1'); const hr = h1.getBoundingClientRect();
    const sub = document.querySelector('#app .sub'); const sr = sub ? sub.getBoundingClientRect() : null;
    const dock = document.querySelector('#dock'); const dr = dock.classList.contains('hide') ? null : dock.getBoundingClientRect();
    const hitH1 = document.elementFromPoint(hr.left + 4, hr.top + hr.height / 2);
    const hitH1Top = document.elementFromPoint(hr.left + 4, hr.top + 2);
    return {
      headerBottom: top.bottom, h1Top: hr.top, h1Bottom: hr.bottom, subBottom: sr && sr.bottom, dockTop: dr && dr.top,
      h1Hit: !!hitH1 && (hitH1 === h1 || h1.contains(hitH1)), h1TopHit: !!hitH1Top && (hitH1Top === h1 || h1.contains(hitH1Top)),
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bodySw: document.body.scrollWidth,
      labelFits: (() => { const l = document.querySelector('#stepsLabel'); return l.scrollWidth <= l.clientWidth + 0.5; })(), brandRight: document.querySelector('.brand').getBoundingClientRect().right, labelLeft: document.querySelector('#stepsLabel').getBoundingClientRect().left,
      vh: innerHeight, sh: document.documentElement.scrollHeight,
    };
  });
  if (r.h1Top < r.headerBottom - 0.5) problems.push(`${label}: heading starts under header (${r.h1Top} < ${r.headerBottom})`);
  if (!r.labelFits || r.brandRight > r.labelLeft) problems.push(`${label}: step label truncated or overlapping`);
  if (r.h1Top < 0) problems.push(`${label}: heading above viewport`);
  if (!r.h1Hit || !r.h1TopHit) problems.push(`${label}: heading is covered by another element`);
  if (r.subBottom && r.dockTop && r.subBottom > r.dockTop) problems.push(`${label}: intro line runs under the dock`);
  if (r.sw > r.cw || r.bodySw > r.cw) problems.push(`${label}: horizontal overflow (${r.sw}/${r.bodySw} > ${r.cw})`);

  // Every control reachable and not under the dock / header when scrolled into view (same as iOS focus scrolling).
  const covered = await page.evaluate(async () => {
    const out = [];
    const els = [...document.querySelectorAll('#app button, #app input:not([type=file]):not([type=checkbox]), #app select, #app textarea, #app label.toggle, #app h2, #app .card, #app p')];
    const dock = document.querySelector('#dock');
    for (const el of els) {
      el.scrollIntoView({ block: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.height > innerHeight - dock.getBoundingClientRect().height - 32) continue; // taller than the visible area: its parts are checked individually
      const pts = [[b.left + Math.min(8, b.width / 2), b.top + Math.min(6, b.height / 2)], [b.left + b.width / 2, b.bottom - Math.min(6, b.height / 2)]];
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit) || hit.contains(el) || (el.tagName === 'LABEL' && el.contains(hit)))) {
          if (hit && dock.contains(hit)) { out.push((el.id || el.dataset.path || el.className || el.tagName) + ' under dock'); break; }
          if (hit && document.querySelector('#top').contains(hit)) { out.push((el.id || el.dataset.path || el.className || el.tagName) + ' under header'); break; }
        }
      }
    }
    return out;
  });
  covered.forEach((c) => problems.push(`${label}: ${c}`));

  // Last element clears the dock at max scroll.
  const end = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => setTimeout(r, 250));
    const view = document.querySelector('#app .view'); const last = view.lastElementChild;
    const dock = document.querySelector('#dock');
    return { lastBottom: last.getBoundingClientRect().bottom, dockTop: dock.classList.contains('hide') ? innerHeight : dock.getBoundingClientRect().top };
  });
  if (end.lastBottom > end.dockTop + 0.5) problems.push(`${label}: last element hidden under dock at bottom (${end.lastBottom} > ${end.dockTop})`);

  // Snap-back: park mid-page; nothing should move it.
  const sb = await page.evaluate(async () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const target = Math.max(0, Math.min(240, max));
    window.scrollTo(0, target); await new Promise((r) => setTimeout(r, 900));
    return { target, now: window.scrollY, max };
  });
  if (Math.abs(sb.now - sb.target) > 1) problems.push(`${label}: scroll snapped from ${sb.target} to ${sb.now}`);
  // Overscroll at top then release: page should rest at 0 with heading visible (tested above at 0).
  return r;
}

async function inStepToggleKeepsScroll(page, selector, label, problems) {
  const loc = page.locator(selector).first(); if (!(await loc.count())) return;
  await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  const before = await page.evaluate(() => scrollY);
  await loc.click(); await page.waitForTimeout(700);
  const after = await page.evaluate(() => scrollY);
  if (Math.abs(after - before) > 2) problems.push(`${label}: tapping ${selector} jumped scroll ${before}→${after}`);
}

(async () => {
  const browser = await pw[engineName].launch();
  const problems = [];
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, ...(engineName === 'chromium' ? { isMobile: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${w}x${h}: pageerror ${e.message}`));
    const L = (s) => `${w}x${h} ${s}`;
    await page.goto(BASE); await page.evaluate(() => sessionStorage.clear()); await page.goto(BASE); await page.waitForSelector('[data-service]');
    await checkStep(page, L('1 What (empty)'), problems, true);
    // Real CAD logo: exact site file, loaded, 72–96px wide, square corners, no filters, horizontally centered, no duplicate text.
    const logo = await page.evaluate(() => { const i = document.querySelector('.brand img.logo'); if (!i) return null; const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return { ok: i.complete && i.naturalWidth === 1023 && i.naturalHeight === 928, w: r.width, h: r.height, cx: r.left + r.width / 2, vw: document.documentElement.clientWidth, right: r.right, alt: i.alt, radius: cs.borderRadius, filter: cs.filter, text: document.querySelector('.brand').textContent.trim() }; });
    if (!logo) problems.push(L('logo missing'));
    else {
      if (!logo.ok) problems.push(L('logo is not the original 1023×928 site file'));
      if (logo.w < 72 || logo.w > 96) problems.push(L(`logo width ${logo.w}px (want 72–96)`));
      if (Math.abs(logo.w / logo.h - 1023 / 928) > 0.01) problems.push(L('logo aspect ratio changed'));
      if (Math.abs(logo.cx - logo.vw / 2) > 1) problems.push(L(`logo off-center by ${(logo.cx - logo.vw / 2).toFixed(1)}px`));
      if (logo.radius !== '0px' || logo.filter !== 'none') problems.push(L('logo must have square corners and no filters'));
      if (logo.alt !== 'California Art Delivery') problems.push(L('logo alt text wrong'));
      if (logo.text) problems.push(L('duplicate brand text next to logo'));
      if (logo.right > w) problems.push(L('logo overflows'));
    }
    // Simulated top overlay (in-app browser toolbar / notch reported as safe-area-inset-top = 60px): header content must sit below it.
    const ov = await page.evaluate(() => { window.scrollTo(0, 0); document.documentElement.style.setProperty('--sat', '60px'); const r = document.querySelector('.brand').getBoundingClientRect().top; document.documentElement.style.removeProperty('--sat'); return r; });
    if (ov < 60) problems.push(L(`header content not below a 60px top inset (${ov})`));
    await page.click('[data-service="pickup_delivery"]'); await page.waitForTimeout(700);
    await fill(page, 'items.0.description', 'Oil on canvas'); await fill(page, 'items.0.value', 5000); await page.click('[data-seg="items.0.framed"] [data-v="yes"]'); await page.waitForTimeout(150); await page.click('[data-dup="0"]'); await page.waitForTimeout(200);
    await page.click('[data-itemtype="1"] button[data-v="sculpture"]'); await page.waitForTimeout(200);
    await inStepToggleKeepsScroll(page, '[data-itemtype="1"] button[data-v="furniture"]', L('1 What'), problems);
    await checkStep(page, L('1 What (items)'), problems);
    await page.click('#nextBtn'); await page.waitForTimeout(500);
    await checkStep(page, L('2 Where (after Continue)'), problems, true);
    await fill(page, 'contact.name', 'Jordan Lee'); await fill(page, 'contact.email', 'j@example.com'); await fill(page, 'contact.phone', '3105550199');
    for (const k of ['pickup', 'dropoff']) { await fill(page, `${k}.street`, '8678 Melrose Ave'); await fill(page, `${k}.city`, 'West Hollywood'); await fill(page, `${k}.zip`, '90069'); }
    await inStepToggleKeepsScroll(page, '[data-same="dropoff"]', L('2 Where'), problems);
    await inStepToggleKeepsScroll(page, '[data-same="pickup"]', L('2 Where'), problems);
    await inStepToggleKeepsScroll(page, 'label.toggle:has([data-path="dropoff.elevator"])', L('2 Where'), problems);
    await inStepToggleKeepsScroll(page, '[data-stairs="dropoff"] button[data-v="2"]', L('2 Where'), problems);
    await inStepToggleKeepsScroll(page, 'label.toggle:has([data-path="referral"])', L('2 Where'), problems);
    await inStepToggleKeepsScroll(page, 'label.toggle:has([data-path="pickup.parkingRestricted"])', L('2 Where'), problems);
    await inStepToggleKeepsScroll(page, '[data-seg="dropoff.fits"] button[data-v="not_sure"]', L('2 Where'), problems);
    await checkStep(page, L('2 Where'), problems);
    await page.click('#nextBtn'); await page.waitForSelector('.day');
    await checkStep(page, L('3 When (after Continue)'), problems, true);
    await page.click('.day:not(.rush)');
    await inStepToggleKeepsScroll(page, '[data-chips] .chip >> nth=1', L('3 When'), problems);
    await inStepToggleKeepsScroll(page, 'label.toggle:has([data-path="schedule.deliveryLater"])', L('3 When'), problems);
    await page.waitForSelector('[data-deldate]'); await inStepToggleKeepsScroll(page, '[data-deldate]', L('3 When'), problems);
    await checkStep(page, L('3 When'), problems);
    await page.click('#nextBtn'); await page.waitForTimeout(800);
    await checkStep(page, L('4 Pay (after Continue)'), problems, true);
    await inStepToggleKeepsScroll(page, '[data-pay-method] button[data-v="ach"]', L('4 Pay'), problems);
    await checkStep(page, L('4 Review & pay'), problems);
    await page.click('#nextBtn'); await page.waitForSelector('.check'); await page.waitForTimeout(500);
    await checkStep(page, L('Done'), problems, true);
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify({ engine: engineName, sizes: SIZES.map((s) => s.join('x')), problems }, null, 2));
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
