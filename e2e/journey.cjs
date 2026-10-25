const { chromium } = require('playwright');
const SHOTS = process.argv[2];
const W = Number(process.argv[3] || 393);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  let n = 0;
  const shot = async (name) => {
    await page.waitForTimeout(450);
    const overflow = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('div').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
          // ignore elements inside horizontal scrollers
          let p = el.parentElement, scroller = false;
          while (p) { const cs = getComputedStyle(p); if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') { scroller = true; break; } p = p.parentElement; }
          if (!scroller) out.push(`${Math.round(r.left)}..${Math.round(r.right)} ${el.innerText?.slice(0, 30).replace(/\n/g, ' ')}`);
        }
      });
      return { docScroll: document.documentElement.scrollWidth > window.innerWidth, items: out.slice(0, 5) };
    });
    const file = `${String(n++).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: `${SHOTS}/${file}` });
    console.log(`shot ${file}${overflow.docScroll || overflow.items.length ? ' OVERFLOW ' + JSON.stringify(overflow) : ''}`);
  };
  const tap = async (name, opts = {}) => {
    const loc = page.getByRole('button', { name, exact: opts.exact ?? false }).nth(opts.nth ?? 0);
    await loc.click({ timeout: 8000 });
    await page.waitForTimeout(opts.wait ?? 500);
  };
  const tapText = async (text, nth = 0) => {
    await page.getByText(text, { exact: true }).nth(nth).click({ timeout: 8000 });
    await page.waitForTimeout(500);
  };
  try {
    await page.goto('http://localhost:8081/');
    await page.waitForTimeout(2600);
    await tap('التالي'); await tap('التالي');
    await shot('onboarding-3');
    await tap('ابدأ التصفح', { wait: 900 });
    await shot('home-empty');
    await page.mouse.wheel(0, 900); await shot('home-scrolled');
    await page.mouse.wheel(0, -2000);
    // Add vehicle
    await tap('أضف سيارتك', { wait: 900 });
    await shot('garage-add-make');
    await tap('تويوتا'); await shot('garage-add-model');
    await tap('كامري'); await tapText('2022'); await tapText('GLE');
    await shot('garage-add-engine');
    await tap('2.5L I4'); await shot('garage-add-vin');
    await page.getByPlaceholder('17 حرفاً ورقماً').fill('JTNB11HK0N3012345');
    await tap('حفظ السيارة', { wait: 900 });
    await shot('home-with-vehicle');
    await page.mouse.wheel(0, 1100); await shot('home-recommended');
    await page.mouse.wheel(0, -3000);
    // Search
    await page.getByRole('tab', { name: 'البحث' }).click(); await page.waitForTimeout(800);
    await shot('search-browse');
    await page.getByPlaceholder('اسم القطعة، رقم القطعة، أو الماركة').fill('فحمات');
    await page.waitForTimeout(600);
    await shot('search-results');
    await page.getByPlaceholder('اسم القطعة، رقم القطعة، أو الماركة').fill('04465x3301');
    await page.waitForTimeout(600);
    await shot('search-partnumber');
    await tap('الفلاتر', { wait: 900 }); await shot('filters-sheet');
    await page.goBack(); await page.waitForTimeout(600);
    // Product
    await page.getByPlaceholder('اسم القطعة، رقم القطعة، أو الماركة').fill('فحمات');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'فحمات فرامل أمامية — كامري' }).first().click();
    await page.waitForTimeout(900);
    await shot('product-top');
    await page.mouse.wheel(0, 700); await shot('product-offers');
    await page.mouse.wheel(0, 1200); await shot('product-specs');
    await page.mouse.wheel(0, 1200); await shot('product-reviews');
    await page.mouse.wheel(0, -4000);
    await tap('قارن 3 عروض', { wait: 900 });
    await shot('offers-compare');
    await tap('أضف للسلة', { wait: 700 });
    await shot('offers-added-toast');
    await page.goBack(); await page.waitForTimeout(500);
    await page.goBack(); await page.waitForTimeout(500);
    // Second seller item: oil
    await page.getByPlaceholder('اسم القطعة، رقم القطعة، أو الماركة').fill('زيت');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /زيت محرك صناعي/ }).first().click();
    await page.waitForTimeout(900);
    await tap('أضف للسلة', { nth: 0, wait: 700 });
    await page.goBack(); await page.waitForTimeout(500);
    // Cart
    await page.getByRole('tab', { name: 'السلة' }).click(); await page.waitForTimeout(800);
    await shot('cart');
    await tap('إتمام الطلب', { wait: 900 });
    await shot('checkout-top');
    await tap('سجّل الدخول لإتمام الطلب', { wait: 900 });
    await shot('sign-in');
    await page.getByPlaceholder('5X XXX XXXX').fill('512345678');
    await tap('إرسال رمز التحقق', { wait: 1200 });
    await page.getByPlaceholder('••••').fill('1234');
    await tap('تأكيد', { exact: true, wait: 600 });
    await page.getByPlaceholder('اسمك الكامل').fill('سارة أحمد');
    await tap('إنشاء حساب', { wait: 900 });
    // Workshop address
    await tap('الورشة', { exact: false, wait: 500 });
    await tap('إضافة عنوان', { wait: 900 });
    await shot('address-form');
    await page.getByPlaceholder('مثال: ورشة الأمانة').fill('ورشة الأمانة');
    await page.getByPlaceholder('مثال: النرجس').fill('النرجس');
    await page.getByPlaceholder('اسم الشارع ورقم المبنى').fill('شارع أنس بن مالك 12');
    await page.getByPlaceholder('5X XXX XXXX').fill('512345678');
    await tap('حفظ', { exact: true, wait: 900 });
    await shot('checkout-workshop');
    await page.mouse.wheel(0, 900); await shot('checkout-shipping');
    await page.mouse.wheel(0, 900); await shot('checkout-payment');
    await page.mouse.wheel(0, 1400); await shot('checkout-summary');
    await page.getByRole('button', { name: /ادفع عبر/ }).click();
    await page.waitForTimeout(400);
    await shot('checkout-processing');
    await page.waitForTimeout(2200);
    await shot('success');
    await tap('تتبع الطلب', { wait: 900 });
    await shot('order-detail');
    await page.mouse.wheel(0, 900); await shot('order-detail-2');
    await page.mouse.wheel(0, -3000);
    await tap('طلب إلغاء', { wait: 900 }).catch(() => console.log('no cancel button visible yet'));
    await shot('cancel-sheet');
    await page.goBack(); await page.waitForTimeout(600);
    // Orders tab
    await page.goto('http://localhost:8081/orders'); await page.waitForTimeout(2500);
    await shot('orders');
    await page.getByRole('button', { name: 'QT-DEMO01' }).click(); await page.waitForTimeout(800);
    await shot('sample-order');
    await page.mouse.wheel(0, 700); await shot('sample-order-2');
    await tap('طلب إرجاع', { wait: 900 }).catch(() => console.log('no return button'));
    await shot('return-sheet');
    // Account + English
    await page.goto('http://localhost:8081/account'); await page.waitForTimeout(2500);
    await shot('account');
    await tap('اللغة', { wait: 700 });
    await page.getByRole('radio', { name: 'English' }).click(); await page.waitForTimeout(900);
    await shot('language-en');
    await page.goto('http://localhost:8081/'); await page.waitForTimeout(2500);
    await shot('home-en');
    await page.goto('http://localhost:8081/product/p-lc-alternator'); await page.waitForTimeout(2500);
    await shot('product-en');
    await page.mouse.wheel(0, 800); await shot('product-en-offers');
    await page.goto('http://localhost:8081/seller/s-salvage'); await page.waitForTimeout(2500);
    await shot('seller-en');
    await page.goto('http://localhost:8081/search'); await page.waitForTimeout(2500);
    await page.getByPlaceholder('Part name, part number or brand').fill('battery');
    await page.waitForTimeout(600);
    await shot('search-en');
    await page.goto('http://localhost:8081/cart'); await page.waitForTimeout(2500);
    await shot('cart-empty-en');
    await page.goto('http://localhost:8081/orders'); await page.waitForTimeout(2500);
    await shot('orders-en');
  } catch (e) {
    console.log('JOURNEY FAILED:', e.message.split('\n')[0]);
    await page.screenshot({ path: `${SHOTS}/zz-failure.png` });
  }
  console.log('--- errors ---\n' + [...new Set(errors)].join('\n'));
  await browser.close();
})();
