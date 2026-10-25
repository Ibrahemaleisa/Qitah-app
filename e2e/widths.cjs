const { chromium } = require('playwright');
const SHOTS = process.argv[2];
const routes = ['/', '/search', '/product/p-camry-pads-oem', '/offers/p-lc-alternator', '/seller/s-riyadh-center', '/cart', '/orders', '/order/ord-sample', '/account', '/garage/add', '/support', '/checkout'];
(async () => {
  const browser = await chromium.launch();
  for (const width of [320, 375]) {
    for (const lang of ['ar', 'en']) {
      const ctx = await browser.newContext({ viewport: { width, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await ctx.addInitScript((l) => {
        if (!localStorage.getItem('qitah-app-state')) {
          localStorage.setItem('qitah-app-state', JSON.stringify({ state: { lang: l, onboardingDone: true, cart: [{ offerId: 'o-001', qty: 1 }, { offerId: 'o-025', qty: 2 }], vehicles: [{ id: 'v1', makeId: 'toyota', modelId: 'land-cruiser', year: 2019, trim: 'GXR', engine: '4.6L V8', addedAt: 1 }], selectedVehicleId: 'v1' }, version: 1 }));
        }
      }, lang);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      for (const r of routes) {
        await page.goto('http://localhost:8081' + r);
        await page.waitForTimeout(r === '/' ? 2200 : 1700);
        const res = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('div,span').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0) return;
            if (rect.right > window.innerWidth + 1 || rect.left < -1) {
              let p = el.parentElement, inScroller = false;
              while (p) { const cs = getComputedStyle(p); if (['auto', 'scroll', 'hidden'].includes(cs.overflowX)) { inScroller = true; break; } p = p.parentElement; }
              if (!inScroller) out.push(`${Math.round(rect.left)}..${Math.round(rect.right)} "${(el.innerText || '').slice(0, 25).replace(/\n/g, ' ')}"`);
            }
          });
          return out.slice(0, 4);
        });
        if (res.length) console.log(`OVERFLOW w=${width} ${lang} ${r}:`, res);
        if (width === 320) await page.screenshot({ path: `${SHOTS}/w320-${lang}${r.replace(/\//g, '_')}.png` });
      }
      if (errors.length) console.log('errors', width, lang, errors);
      await ctx.close();
    }
  }
  console.log('width check done');
  await browser.close();
})();
