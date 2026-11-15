// Layout QA for the Crating & Shipping path (incl. international destination) at iPhone sizes.
const pw = require('playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const engine = pw[process.env.E2E_BROWSER || 'chromium'];
(async () => {
  const browser = await engine.launch();
  const problems = [];
  for (const [w, h] of [[320, 568], [390, 844]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true })).newPage();
    const fill = (p, v) => page.fill(`[data-path="${p}"]`, String(v));
    const check = async (label) => {
      const r = await page.evaluate(() => ({ sx: document.documentElement.scrollWidth, vw: innerWidth, y: scrollY, h1: document.querySelector('h1') && document.querySelector('h1').getBoundingClientRect().top, top: document.querySelector('#top').getBoundingClientRect().bottom }));
      if (r.sx > r.vw + 1) problems.push(`${w}px ${label}: horizontal overflow ${r.sx}>${r.vw}`);
      if (r.y !== 0) problems.push(`${w}px ${label}: scrollY ${r.y}`);
      if (r.h1 < r.top) problems.push(`${w}px ${label}: heading under header`);
    };
    const next = async () => { await page.click('#nextBtn:not([disabled])'); await page.waitForTimeout(500); };
    await page.goto(BASE); await page.evaluate(() => sessionStorage.clear()); await page.goto(BASE); await page.waitForSelector('[data-service]');
    await page.click('[data-service="crating_shipping"]'); await page.waitForTimeout(300);
    await fill('items.0.description', 'Oil on linen'); await fill('items.0.w', 60); await fill('items.0.h', 48); await fill('items.0.weight', 35); await fill('items.0.value', 20000); await page.click('[data-seg="items.0.framed"] [data-v="no"]'); await page.waitForTimeout(150);
    await page.evaluate(() => scrollTo(0, 0)); await check('what');
    await next(); await check('where');
    await fill('contact.name', 'A B'); await fill('contact.email', 'a@b.co'); await fill('contact.phone', '3105550100');
    await fill('pickup.street', '1 Main St'); await fill('pickup.city', 'Los Angeles'); await fill('pickup.zip', '90069'); await fill('pickup.contactName', 'A'); await fill('pickup.contactPhone', '1');
    await fill('dropoff.country', 'Japan'); await page.press('[data-path="dropoff.country"]', 'Tab'); await page.waitForTimeout(400);
    await fill('dropoff.street', '1-1 Ginza, Chuo-ku 104-0061'); await fill('dropoff.city', 'Tokyo'); await fill('dropoff.contactName', 'K'); await fill('dropoff.contactPhone', '+81 3 0000 0000');
    const r = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (r > 1) problems.push(`${w}px where (intl): overflow ${r}`);
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'v-next', `qa-ship-where-${w}.png`), fullPage: true });
    await next(); await check('shipping details');
    await page.click('[data-level="curbside"]'); await page.click('label.toggle:has([data-path="shipping.flexible"])'); await page.waitForTimeout(300);
    await next(); await check('review');
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'v-next', `qa-ship-review-${w}.png`) });
  }
  await browser.close();
  console.log(JSON.stringify({ engine: process.env.E2E_BROWSER || 'chromium', problems }, null, 2));
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
