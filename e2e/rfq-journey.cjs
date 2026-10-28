/**
 * Part request ("اطلب قطعة" / RFQ) journey across the app (remote web build) and the merchant portal.
 *
 *   # 1. API on :4310 (seeded sandbox data, RATE_LIMIT_SCALE=1000, CORS_ORIGINS incl. the app origin)
 *   # 2. App:  EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4310 npx expo export --platform web --output-dir dist-remote
 *   #          node e2e/serve.cjs "$PWD/dist-remote" 8091
 *   # 3. Merchant portal: (cd portals/merchant && npm run build && API_BASE_URL=http://127.0.0.1:4310 COOKIE_SECURE=false npx next start -p 3311)
 *   # 4. node e2e/rfq-journey.cjs        # APP_URL / API_URL / PORTAL_URL / SHOTS override defaults
 *
 * Covers: OTP sign-in → home "request a part" card → request with a photo → merchant inbox (matching
 * rule) → merchant quote with SAR price → customer sees the quote → accepts → private offer in the cart →
 * smart checkout plan → sandbox payment → merchant order for the quoting store.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const APP = process.env.APP_URL || 'http://127.0.0.1:8091';
const API = process.env.API_URL || 'http://127.0.0.1:4310';
const PORTAL = process.env.PORTAL_URL || 'http://127.0.0.1:3311';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots', 'rfq');
const PASSWORD = process.env.SEED_PASSWORD || 'Qitah-Sandbox-2026!';
fs.mkdirSync(SHOTS, { recursive: true });

const localDigits = `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const DESCRIPTION = `حساس أكسجين خلفي توروس ${Date.now() % 100000}`;

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

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

/** A tiny valid PNG (8×8, orange) so the upload path runs end to end. */
function png() {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(8 * (1 + 8 * 3));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) raw.set([0xf5, 0x82, 0x20], y * 25 + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const portalCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-SA' });
  const portal = await portalCtx.newPage();
  const errors = [];
  for (const [name, p] of [['app', page], ['portal', portal]]) {
    p.on('pageerror', (e) => errors.push(`[${name} pageerror] ${e.message}`));
  }
  let n = 0;
  const shot = async (name, target = page) => {
    await target.waitForTimeout(500);
    const file = `${String(n++).padStart(2, '0')}-${name}.png`;
    await target.screenshot({ path: path.join(SHOTS, file), fullPage: target === portal });
    console.log(`shot ${file}`);
  };
  const visible = (loc) => loc.filter({ visible: true }).first();
  const button = (name, opts = {}) => page.getByRole('button', { name, exact: opts.exact ?? false }).filter({ visible: true }).nth(opts.nth ?? 0);
  const tap = async (name, opts = {}) => {
    await button(name, opts).click({ timeout: opts.timeout ?? 10_000 });
    await page.waitForTimeout(opts.wait ?? 600);
  };
  const waitText = (text, timeout = 15_000, target = page) => visible(target.getByText(text)).waitFor({ timeout });

  let failed = false;
  try {
    console.log(`app ${APP} · portal ${PORTAL} · api ${API} · phone +966${localDigits}`);
    await page.goto(APP);
    await tap('التالي', { timeout: 30_000 });
    await tap('التالي');
    await tap('ابدأ التصفح', { wait: 1200 });

    // ── 1. Sign in (OTP sandbox hint), then give the account a Ford Taurus and a Riyadh address.
    await page.getByRole('tab', { name: 'حسابي' }).click();
    await page.waitForTimeout(700);
    await tap('تسجيل الدخول', { exact: true, wait: 900 });
    await page.getByPlaceholder('5X XXX XXXX').fill(localDigits);
    await tap('إرسال رمز التحقق', { wait: 1500 });
    await waitText(/الرمز هو \d{6}/);
    const code = (await visible(page.getByText(/الرمز هو \d{6}/)).innerText()).match(/(\d{6})/)[1];
    await page.getByPlaceholder('••••••').fill(code);
    await tap('تأكيد', { exact: true, wait: 1500 });
    await page.getByPlaceholder('اسمك الكامل').fill('خالد العتيبي');
    await tap('إنشاء حساب', { wait: 1500 });
    await waitText('خالد العتيبي');
    const tokens = await page.evaluate(() => JSON.parse(localStorage.getItem('qitah.auth.tokens.v1') || 'null'));
    assert(tokens && tokens.accessToken, 'customer signed in');
    await api('POST', '/v1/me/vehicles', { modelId: 'taurus', year: 2021, trim: 'Trend', engine: '1.5L EcoBoost' }, tokens.accessToken);
    await api('POST', '/v1/me/addresses', { kind: 'home', label: 'المنزل', city: 'riyadh', district: 'الملقا', street: 'شارع أنس بن مالك 12', contactName: 'خالد العتيبي', phone: `+966${localDigits}` }, tokens.accessToken);
    await page.reload();
    await page.waitForTimeout(2500);

    // ── 2. Home card → request form with a photo
    await page.getByRole('tab', { name: 'الرئيسية' }).click();
    await page.waitForTimeout(800);
    await shot('home-request-card');
    await visible(page.getByRole('button', { name: /ما لقيت القطعة؟ اطلبها/ })).click();
    await page.waitForTimeout(1200);
    await waitText('السيارة');
    assert(await visible(page.getByRole('button', { name: /توروس/ })).isVisible(), 'garage vehicle offered on the request form');
    await visible(page.getByPlaceholder('مثال: مراية جانبية يمين مع إشارة')).fill(DESCRIPTION);
    await visible(page.getByPlaceholder('إن وُجد على القطعة القديمة')).fill('DG9Z-9G444-A');
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await tap('إضافة صورة', { wait: 300 });
    await (await chooser).setFiles({ name: 'old-sensor.png', mimeType: 'image/png', buffer: png() });
    await page.waitForTimeout(800);
    await shot('request-form');
    await tap('أرسل الطلب للتجار', { wait: 2500 });
    await waitText('بانتظار العروض', 20_000);
    await shot('request-waiting');
    const { requests } = await api('GET', '/v1/me/part-requests', null, tokens.accessToken);
    const request = requests.find((r) => r.description === DESCRIPTION);
    assert(request && request.photoCount === 1 && request.city === 'riyadh' && request.vehicle.modelId === 'taurus', 'request stored with photo, vehicle and delivery city');

    // ── 3. Merchant portal: inbox → quote
    await portal.goto(`${PORTAL}/login`);
    await portal.locator('input[name="email"]').fill('owner@salvage.qitah.test');
    await portal.locator('input[name="password"]').fill(PASSWORD);
    await portal.getByRole('button', { name: /دخول/ }).click();
    await portal.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
    await portal.getByRole('link', { name: 'طلبات القطع' }).first().click();
    await waitText(DESCRIPTION, 20_000, portal);
    await waitText(/تظهر لك الطلبات المفتوحة في مدن فروعك/, 5_000, portal);
    await shot('portal-inbox', portal);
    await visible(portal.getByTestId('part-request-card').filter({ hasText: DESCRIPTION })).click();
    await portal.getByTestId('request-photo').first().waitFor({ timeout: 15_000 });
    assert(await portal.getByTestId('request-photo').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'customer photo loads through a signed URL');
    await portal.locator('input[name="partName"]').fill('حساس أكسجين خلفي');
    await portal.locator('input[name="brand"]').fill('Motorcraft');
    await portal.getByTestId('quote-price').fill('85.50');
    await portal.locator('input[name="note"]').fill('مفحوص ويعمل — من سيارة 2021');
    await shot('portal-quote-form', portal);
    await portal.getByTestId('submit-quote').click();
    await portal.getByTestId('my-quote').waitFor({ timeout: 15_000 });
    await shot('portal-quote-sent', portal);

    // ── 4. Customer sees the quote, accepts → cart
    await waitText('اختر هذا العرض', 40_000);
    await shot('request-quote');
    assert(await visible(page.getByText(/Motorcraft/)).isVisible(), 'quote shows the brand');
    await tap('اختر هذا العرض', { wait: 2500 });
    await waitText('حساس أكسجين خلفي', 15_000);
    await shot('cart-with-quote');
    const priv = await api('GET', '/v1/me/private-offers', null, tokens.accessToken);
    const offerId = priv.products[0]?.offers[0]?.id;
    assert(!!offerId, 'accepted quote became a private offer for this customer');
    const snapshot = await api('GET', '/v1/catalog/snapshot');
    assert(!JSON.stringify(snapshot).includes(offerId), 'private offer is absent from the public catalog snapshot');

    // ── 5. Smart checkout → sandbox payment → merchant order
    await tap('إتمام الطلب', { wait: 1500 });
    await waitText('خيارات التوصيل', 20_000);
    await visible(page.getByRole('radio').filter({ hasText: /كما اخترت/ })).waitFor({ timeout: 20_000 });
    await visible(page.getByRole('radio', { name: /بطاقة مدى/ })).click();
    await page.mouse.wheel(0, 1500);
    await shot('checkout');
    const popupPromise = ctx.waitForEvent('page', { timeout: 20_000 });
    await visible(page.getByRole('button', { name: /ادفع عبر/ })).click();
    const popup = await popupPromise;
    await popup.waitForURL(/\/sandbox\/pay\//, { timeout: 20_000 });
    await popup.getByRole('button', { name: /ادفع \(محاكاة نجاح\)/ }).click();
    await popup.waitForLoadState();
    await popup.close();
    await waitText('رقم الطلب', 30_000);
    await shot('confirmation');
    const { orders } = await api('GET', '/v1/orders', null, tokens.accessToken);
    assert(orders[0] && orders[0].status === 'PAID' && orders[0].merchantOrders[0].merchant.id === 's-salvage', 'paid order routed to the quoting merchant');

    await portal.goto(`${PORTAL}/part-requests`);
    await portal.getByTestId('tab-won').click();
    await portal.getByTestId('my-quote-row').first().waitFor({ timeout: 15_000 });
    assert(await portal.getByTestId('my-quote-row').first().getByText(/QT-/).isVisible(), 'merchant sees the won quote linked to the paid order');
    await shot('portal-won', portal);

    const relevant = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
    assert(relevant.length === 0, `no page errors${relevant.length ? `: ${relevant.join(' | ')}` : ''}`);
  } catch (e) {
    failed = true;
    console.error(e);
    await shot('failure').catch(() => {});
    await shot('failure-portal', portal).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(failed ? 'RFQ JOURNEY FAILED' : 'RFQ JOURNEY PASSED');
  process.exit(failed ? 1 : 0);
})();
