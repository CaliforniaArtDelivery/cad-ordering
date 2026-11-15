// Headless screenshots of the Type of décor dropdown at mobile widths 320–430px.
const pw = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.SHOT_DIR || '/workspace/decor-dropdown';
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = (process.env.WIDTHS || '320,375,390,430').split(',').map(Number);

async function openDecor(page) {
  await page.goto(BASE);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE);
  await page.waitForSelector('[data-service="pickup_delivery"]');
  await page.click('[data-service="pickup_delivery"]');
  await page.waitForTimeout(300);
  await page.click('[data-itemtype="0"] button[data-v="decor"]');
  await page.waitForTimeout(250);
  await page.waitForSelector('[data-path="items.0.furnitureKind"]');
}

function menuCss() {
  return `
    .shot-menu {
      margin: -6px 0 16px;
      background: #fff;
      border: 1.5px solid #1c2a4a;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 24px rgba(20,28,45,.16);
    }
    .shot-menu .g {
      font-size: 11px;
      font-weight: 650;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: #6b7280;
      padding: 10px 14px 4px;
      background: #f6f4ef;
    }
    .shot-menu button {
      display: block;
      width: 100%;
      text-align: left;
      border: 0;
      background: #fff;
      font: inherit;
      font-size: 16px;
      padding: 10px 14px;
      color: #1c2a4a;
      white-space: nowrap;
    }
    .shot-menu button[aria-selected="true"] { background: #eef2ff; font-weight: 600; }
  `;
}

async function showOpenMenu(page) {
  await page.evaluate((css) => {
    if (!document.getElementById('shot-menu-css')) {
      const s = document.createElement('style');
      s.id = 'shot-menu-css';
      s.textContent = css;
      document.head.appendChild(s);
    }
    document.querySelectorAll('.shot-menu').forEach((n) => n.remove());
    const sel = document.querySelector('[data-path="items.0.furnitureKind"]');
    if (!sel) return;
    const box = document.createElement('div');
    box.className = 'shot-menu';
    box.setAttribute('data-open-menu', '1');
    let group = null;
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') {
        const g = document.createElement('div');
        g.className = 'g';
        g.textContent = node.label;
        box.appendChild(g);
        for (const opt of node.children) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = opt.textContent;
          if (opt.selected) b.setAttribute('aria-selected', 'true');
          box.appendChild(b);
        }
      }
    }
    sel.closest('.field').after(box);
    sel.scrollIntoView({ block: 'start' });
  }, menuCss());
  await page.waitForTimeout(150);
}

async function cardShot(page, name) {
  const card = page.locator('.card').first();
  await card.screenshot({ path: path.join(OUT, name + '.png') });
}

(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  const summary = { widths: {}, options: null, size3: null, size5: null };

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();
    await openDecor(page);

    const options = await page.$eval('[data-path="items.0.furnitureKind"]', (sel) => {
      const out = [];
      for (const node of sel.children) {
        if (node.tagName === 'OPTGROUP') {
          out.push({ group: node.label, items: [...node.children].map((o) => o.value) });
        } else {
          out.push({ value: node.value, label: node.textContent });
        }
      }
      return out;
    });
    const size3 = await page.$eval('[data-path="items.0.sizeClass"]', (sel) => [...sel.options].map((o) => [o.value, o.textContent]));
    summary.options = options;
    summary.size3 = size3;
    summary.widths[width] = { defaultKind: await page.inputValue('[data-path="items.0.furnitureKind"]') };

    await page.screenshot({ path: path.join(OUT, `${width}-default.png`), fullPage: true });
    await cardShot(page, `${width}-default-card`);

    await showOpenMenu(page);
    await page.screenshot({ path: path.join(OUT, `${width}-open.png`), fullPage: true });
    await cardShot(page, `${width}-open-card`);

    await page.selectOption('[data-path="items.0.furnitureKind"]', 'Figurines');
    await page.waitForTimeout(300);
    const size5 = await page.$eval('[data-path="items.0.sizeClass"]', (sel) => [...sel.options].map((o) => [o.value, o.textContent]));
    summary.size5 = size5;
    await page.screenshot({ path: path.join(OUT, `${width}-figurines.png`), fullPage: true });
    await cardShot(page, `${width}-figurines-card`);

    await showOpenMenu(page);
    await page.screenshot({ path: path.join(OUT, `${width}-figurines-open.png`), fullPage: true });

    await page.selectOption('[data-path="items.0.furnitureKind"]', 'Other (describe)');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${width}-other.png`), fullPage: true });
    await cardShot(page, `${width}-other-card`);

    await context.close();
    console.log('done', width);
  }

  fs.writeFileSync(path.join(OUT, 'options.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  console.log('wrote', OUT);
})().catch((err) => { console.error(err); process.exit(1); });
