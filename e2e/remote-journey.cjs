/**
 * Remote-mode end-to-end journey against the real Qitah API (web build).
 *
 *   # 1. API on :4103 (see services/api/README.md), with RATE_LIMIT_SCALE=1000 for repeated runs
 *   # 2. Build + serve the app in remote mode:
 *   EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4103 npx expo export --platform web --output-dir dist-remote
 *   node e2e/serve.cjs "$PWD/dist-remote" 8081
 *   # 3. Run:
 *   node e2e/remote-journey.cjs            # APP_URL / API_URL / SHOTS env vars override defaults
 *
 * Covers: OTP sign-in → add vehicle → search a compatible part → compare offers → add two items from
 * different merchants → checkout plan options → pay on the sandbox provider page → confirmation with
 * the server's order number → fulfilment advanced through the merchant + ops APIs → delivered → return.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://127.0.0.1:8081';
const API = process.env.API_URL || 'http://127.0.0.1:4103';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots', 'remote');
const PASSWORD = process.env.SEED_PASSWORD || 'Qitah-Sandbox-2026!';
fs.mkdirSync(SHOTS, { recursive: true });

// A fresh customer per run keeps runs independent (OTP limits are per phone).
const localDigits = `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

async function api(method, p, body, token) {
  const res = await fetch(API + p, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 200)}`);
  return data;
}
const login = async (email) => (await api('POST', '/v1/auth/login', { email, password: PASSWORD })).accessToken;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  let n = 0;
  const shot = async (name, target = page) => {
    await target.waitForTimeout(500);
    const file = `${String(n++).padStart(2, '0')}-${name}.png`;
    await target.screenshot({ path: path.join(SHOTS, file) });
    console.log(`shot ${file}`);
  };
  // Screens stay mounted in the stack on web, so always target the visible element.
  const visible = (loc) => loc.filter({ visible: true }).first();
  const button = (name, opts = {}) => page.getByRole('button', { name, exact: opts.exact ?? false }).filter({ visible: true }).nth(opts.nth ?? 0);
  const tap = async (name, opts = {}) => {
    await button(name, opts).click({ timeout: opts.timeout ?? 10_000 });
    await page.waitForTimeout(opts.wait ?? 600);
  };
  const waitText = (text, timeout = 15_000) => visible(page.getByText(text)).waitFor({ timeout });

  let failed = false;
  let orderId;
  try {
    console.log(`app ${APP} · api ${API} · phone +966${localDigits}`);
    await page.goto(APP);
    await tap('التالي', { timeout: 30_000 });
    await tap('التالي');
    await tap('ابدأ التصفح', { wait: 1200 });
    await shot('home-remote');
    assert(!(await page.getByText('تجريبي', { exact: true }).count()), 'home shows no "sample" badge in remote mode');

    // ── 1. Sign in with OTP (sandbox code shown as a dev hint)
    await page.getByRole('tab', { name: 'حسابي' }).click();
    await page.waitForTimeout(700);
    await tap('تسجيل الدخول', { exact: true, wait: 900 });
    await page.getByPlaceholder('5X XXX XXXX').fill(localDigits);
    await tap('إرسال رمز التحقق', { wait: 1500 });
    await waitText(/الرمز هو \d{6}/);
    const hint = await visible(page.getByText(/الرمز هو \d{6}/)).innerText();
    const code = hint.match(/(\d{6})/)[1];
    await shot('otp-sandbox-hint');
    await page.getByPlaceholder('••••••').fill(code);
    await tap('تأكيد', { exact: true, wait: 1500 });
    await page.getByPlaceholder('اسمك الكامل').fill('سارة أحمد');
    await tap('إنشاء حساب', { wait: 1500 });
    await waitText('سارة أحمد');
    await shot('account-signed-in');
    const tokens = await page.evaluate(() => JSON.parse(localStorage.getItem('qitah.auth.tokens.v1') || 'null'));
    assert(tokens && tokens.accessToken && tokens.refreshToken, 'tokens stored after OTP verify');
    const me = await api('GET', '/v1/me', null, tokens.accessToken);
    assert(me.name === 'سارة أحمد', 'profile name saved on the server via PATCH /v1/me');

    // ── 2. Add a vehicle (synced to the account)
    await page.getByRole('tab', { name: 'الرئيسية' }).click();
    await page.waitForTimeout(700);
    await tap('أضف سيارتك', { wait: 900 });
    // VIN-first flow: choose manual entry. Trim is no longer asked (fitment does not use it).
    await tap('اختر يدوياً');
    await tap('تويوتا');
    await tap('كامري');
    await visible(page.getByText('2022', { exact: true })).click();
    await page.waitForTimeout(400);
    await tap('2.5L I4');
    await tap('حفظ السيارة', { wait: 1500 });
    await shot('home-with-vehicle');
    const { vehicles } = await api('GET', '/v1/me/vehicles', null, tokens.accessToken);
    assert(vehicles.length === 1 && vehicles[0].modelId === 'camry' && vehicles[0].year === 2022, 'vehicle saved to /v1/me/vehicles');

    // ── 3. Find a compatible part and compare merchant offers
    await page.getByRole('tab', { name: 'البحث' }).click();
    await page.waitForTimeout(700);
    const searchBox = visible(page.getByPlaceholder('اسم القطعة، رقم القطعة، أو الماركة'));
    await searchBox.fill('فحمات');
    await page.waitForTimeout(800);
    await shot('search-results');
    await visible(page.getByRole('button', { name: /فحمات فرامل أمامية — كامري/ })).click();
    await page.waitForTimeout(1200);
    await waitText('تركب على سيارتك');
    await shot('product-fits');
    assert(!(await page.getByText('مراجعة تجريبية').count()), 'no sample reviews on a live product');
    await tap(/قارن \d+ عروض/, { wait: 1200 });
    await shot('offers-compare');
    assert(await visible(page.getByText('يُحسب عند الدفع')).isVisible(), 'offer cards defer shipping to checkout (no client-side fee)');
    await tap('أضف للسلة', { wait: 900 }); // cheapest pads offer
    await page.goBack();
    await page.waitForTimeout(600);
    await page.goBack();
    await page.waitForTimeout(600);

    // Second item from a different merchant: no brake-pad seller stocks coolant, so every
    // delivery option keeps two merchants (two sub-orders, two shipments).
    await searchBox.fill('سائل تبريد');
    await page.waitForTimeout(800);
    await visible(page.getByRole('button', { name: /سائل تبريد طويل العمر/ })).click();
    await page.waitForTimeout(1200);
    await tap('أضف للسلة', { wait: 900 });
    await page.goBack();
    await page.waitForTimeout(600);

    // ── 4. Cart (live stock/price refresh) → checkout
    await page.getByRole('tab', { name: 'السلة' }).click();
    await page.waitForTimeout(2000);
    await shot('cart');
    assert(await visible(page.getByText(/طلبك من 2 بائعين/)).isVisible(), 'cart holds items from two merchants');
    await tap('إتمام الطلب', { wait: 1200 });

    // Address (saved to the account), then the server's delivery plans
    await tap('إضافة عنوان', { wait: 1000 });
    await page.getByPlaceholder('مثال: النرجس').fill('النرجس');
    await page.getByPlaceholder('اسم الشارع ورقم المبنى').fill('شارع أنس بن مالك 12');
    await tap('حفظ', { exact: true, wait: 1500 });
    await waitText('خيارات التوصيل');
    await visible(page.getByRole('radio').filter({ hasText: /كما اخترت/ })).waitFor({ timeout: 20_000 });
    await shot('checkout-plans');
    assert(await visible(page.getByText('أسعار شحن تجريبية / sandbox rates')).isVisible(), 'sandbox shipping-rate note is shown');
    // Choose an option other than "as you chose" when the server offers one.
    const options = page.getByRole('radio').filter({ hasText: /الأسرع وصولاً|أقل عدد شحنات|الأقل تكلفة/ }).filter({ visible: true });
    const chosen = (await options.count()) ? options.first() : visible(page.getByRole('radio').filter({ hasText: /كما اخترت/ }));
    const optionLabel = (await chosen.innerText()).split('\n')[0];
    const optionTotal = (await chosen.innerText()).match(/([\d,]+\.\d{2})/)[1];
    await chosen.click();
    await page.waitForTimeout(600);
    console.log(`  chose option: ${optionLabel} (${optionTotal} SAR)`);
    await page.mouse.wheel(0, 900);
    await shot('checkout-breakdown');
    await visible(page.getByRole('radio', { name: /بطاقة مدى/ })).click();
    await page.mouse.wheel(0, 1500);
    await shot('checkout-summary');
    assert(!(await page.getByText('تابي').count()) && !(await page.getByText('تمارا').count()), 'BNPL methods are hidden in remote mode');

    // ── 5. Pay on the sandbox provider page (new tab), app polls until the SERVER says paid
    const popupPromise = ctx.waitForEvent('page', { timeout: 20_000 });
    await visible(page.getByRole('button', { name: /ادفع عبر/ })).click();
    const popup = await popupPromise;
    await popup.waitForURL(/\/sandbox\/pay\//, { timeout: 20_000 });
    await popup.waitForLoadState();
    await shot('sandbox-payment-page', popup);
    await shot('waiting-for-payment');
    await popup.getByRole('button', { name: /ادفع \(محاكاة نجاح\)/ }).click();
    await popup.waitForLoadState();
    await shot('sandbox-payment-done', popup);
    await popup.close();

    await waitText('رقم الطلب', 30_000);
    // `ltr` text is wrapped in Unicode bidi isolates (U+2066…U+2069); strip them.
    const number = (await visible(page.getByText(/QT-\d{6}-[A-Z0-9]+/)).innerText()).replace(/[\u2066-\u2069]/g, '').trim();
    await shot('confirmation');
    const { orders } = await api('GET', '/v1/orders', null, tokens.accessToken);
    const order = orders.find((o) => o.number === number);
    assert(!!order, `confirmation shows the server order number ${number}`);
    assert(['PAID', 'IN_FULFILLMENT'].includes(order.status), `server status is ${order.status} (paid by webhook, not by the client)`);
    assert((order.totals.totalHalalas / 100).toFixed(2) === optionTotal.replace(/,/g, ''), `order total ${optionTotal} = the chosen option's server total`);
    assert(order.merchantOrders.length === 2, 'order split into 2 merchant sub-orders');
    orderId = order.id;
    const cart = await api('GET', '/v1/me/cart', null, tokens.accessToken);
    assert(cart.lines.length === 0, 'cart cleared (locally and on the server) after confirmed payment');

    // ── 6. Advance fulfilment through the merchant + ops APIs
    await tap('تتبع الطلب', { wait: 1500 });
    await shot('order-detail-paid');
    const ops = await login('ops.admin@qitah.test');
    for (const mo of order.merchantOrders) {
      const merchantToken = await login(`owner@${mo.merchant.id.replace(/^s-/, '')}.qitah.test`);
      for (const step of ['accept', 'pack', 'ready']) await api('POST', `/v1/merchants/${mo.merchant.id}/orders/${mo.id}/${step}`, undefined, merchantToken);
    }
    let full = await api('GET', `/v1/orders/${orderId}`, null, tokens.accessToken);
    const shipments = full.shipmentGroups.map((g) => g.shipment.id);
    for (const [i, sid] of shipments.entries()) {
      await api('POST', `/v1/ops/shipments/${sid}/label`, undefined, ops);
      const now = Date.now();
      await api('POST', `/v1/ops/shipments/${sid}/pickup`, { windowStart: new Date(now + 3600e3).toISOString(), windowEnd: new Date(now + 7200e3).toISOString() }, ops);
      await api('POST', `/v1/ops/shipments/${sid}/sandbox-event`, { status: 'PICKED_UP' }, ops);
      await api('POST', `/v1/ops/shipments/${sid}/sandbox-event`, { status: 'IN_TRANSIT', location: 'الرياض' }, ops);
      if (i === 0) {
        await page.reload();
        await waitText('سجل التتبع', 20_000);
        await shot('order-detail-in-transit');
      }
      await api('POST', `/v1/ops/shipments/${sid}/sandbox-event`, { status: 'OUT_FOR_DELIVERY' }, ops);
      await api('POST', `/v1/ops/shipments/${sid}/sandbox-event`, { status: 'DELIVERED' }, ops);
    }
    full = await api('GET', `/v1/orders/${orderId}`, null, tokens.accessToken);
    assert(full.status === 'DELIVERED', 'server order is DELIVERED');

    // The detail screen refetches every 15s while focused; wait for it rather than reloading.
    // The return button only appears once the server reports the items delivered.
    await button('طلب إرجاع').waitFor({ timeout: 30_000 });
    await shot('order-detail-delivered');
    assert(await visible(page.getByText(/SBX\d+/)).isVisible(), 'sandbox tracking number is displayed');
    await page.mouse.wheel(0, 900);
    await shot('order-detail-delivered-2');
    await page.mouse.wheel(0, -3000);

    // ── 7. Request a return
    await tap('طلب إرجاع', { wait: 1200 });
    await shot('return-sheet');
    // 'damaged' now requires a photo (covered by API tests); use 'not as described' here.
    await visible(page.getByRole('radio', { name: 'مختلفة عن الوصف' })).click();
    await visible(page.getByLabel(/ملاحظة للبائع/)).fill('العلبة وصلت مكسورة');
    await tap('إرسال طلب الإرجاع', { wait: 1500 });
    await waitText('المرتجعات', 15_000);
    await visible(page.getByText('المرتجعات')).scrollIntoViewIfNeeded();
    await shot('order-detail-return');
    full = await api('GET', `/v1/orders/${orderId}`, null, tokens.accessToken);
    assert(full.returns.length === 1 && full.returns[0].status === 'REQUESTED' && full.returns[0].reason === 'notAsDescribed', 'return case REQUESTED on the server');

    // ── 8. Orders list + notifications
    await page.getByRole('tab', { name: 'الطلبات' }).click().catch(() => page.goto(`${APP}/orders`));
    await page.waitForTimeout(2000);
    await shot('orders-list');
    await page.goto(`${APP}/notifications`);
    await waitText('آخر الإشعارات', 20_000);
    await page.waitForTimeout(1500);
    await shot('notifications');
  } catch (e) {
    failed = true;
    console.log('REMOTE JOURNEY FAILED:', e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(SHOTS, 'zz-failure.png') }).catch(() => {});
  }
  const relevant = [...new Set(errors)].filter((e) => !/favicon|DevTools/.test(e));
  console.log(`--- console errors (${relevant.length}) ---\n${relevant.join('\n')}`);
  console.log(failed ? 'RESULT: FAILED' : `RESULT: PASSED (order ${orderId})`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
