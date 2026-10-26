// Ops portal smoke test against a live API + portal.
//
//   API on API_BASE_URL (default http://127.0.0.1:4102, freshly seeded, RATE_LIMIT_SCALE=1000)
//   portal on PORTAL_URL (default http://127.0.0.1:3102)
//   node e2e/smoke.mjs
//
// Flow: login as ops admin → approve the pending merchant "نجد لقطع الغيار" → (API) customer places + pays an
// order and the merchant marks it ready → control tower: create label → schedule pickup → simulate
// PICKED_UP → IN_TRANSIT → DELIVERED → order trace shows DELIVERED, ledger entries and reconciled = true.
// Also: a merchant user gets the no-access screen, and the BFF proxy refuses non-allowlisted paths.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPaidOrder, merchantAdvance } from './lib/flows.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3102';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Qitah-Sandbox-2026!';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

let step = 0;
const results = [];
function ok(name, detail = '') {
  results.push({ name, pass: true });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function assert(cond, name, detail = '') {
  if (!cond) throw new Error(`Assertion failed: ${name}${detail ? ` (${detail})` : ''}`);
  ok(name, detail);
}
async function shot(page, name) {
  step += 1;
  await page.screenshot({ path: join(SHOTS, `${String(step).padStart(2, '0')}-${name}.png`), fullPage: true });
}

/** fetch() from inside the page, so the browser's own (httpOnly, possibly Secure) cookies are used. */
const browserFetch = (page, path, init = {}) => page.evaluate(async ([p, i]) => (await fetch(p, i)).status, [path, init]);

async function login(page, email, nextPath = '/') {
  await page.goto(`${PORTAL}${nextPath}`);
  await page.waitForURL(/\/login/);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
}

/** Waits until the board card for `orderNumber` shows `status`, then returns it. */
async function boardCard(page, orderNumber, status, timeout = 20_000) {
  const card = page.locator(`article.ship-card[data-order="${orderNumber}"]`);
  await card.and(page.locator(`[data-status="${status}"]`)).first().waitFor({ timeout });
  return card.first();
}

const browser = await chromium.launch();
try {
  // ── 1. Ops admin login (unauthenticated → redirected to /login?next=…)
  console.log('Ops admin');
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA' });
  const page = await admin.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await login(page, 'ops.admin@qitah.test', '/tower');
  await page.waitForURL(`${PORTAL}/tower`);
  await page.locator('[data-testid=board]').waitFor();
  assert((await page.getAttribute('html', 'dir')) === 'rtl' && (await page.getAttribute('html', 'lang')) === 'ar', 'Arabic RTL document');
  ok('login redirects back to the requested page', '/tower');

  // Overview
  await page.goto(`${PORTAL}/`);
  await page.locator('[data-testid=metrics]').waitFor();
  await shot(page, 'overview');

  // ── 2. Approve the pending merchant
  await page.goto(`${PORTAL}/merchants?status=PENDING`);
  await page.getByRole('link', { name: 'نجد لقطع الغيار' }).click();
  await page.locator('[data-testid=approve-merchant]').waitFor();
  await shot(page, 'merchant-pending');
  await page.click('[data-testid=approve-merchant]');
  await page.fill('dialog[open] input[name=commissionBps]', '900');
  await page.click('dialog[open] button[type=submit]');
  await page.locator('.page-head .chip[data-status="APPROVED"]').waitFor({ timeout: 10_000 });
  assert(true, 'merchant "نجد لقطع الغيار" approved', 'commission 900 bps');
  await shot(page, 'merchant-approved');

  // ── 3. Customer order + merchant readiness via the API, while the control tower is open
  console.log('API flows + realtime');
  await page.goto(`${PORTAL}/tower`);
  await page.locator('.live.on').waitFor({ timeout: 15_000 });
  ok('live SSE stream connected (indicator "مباشر")');
  const order = await createPaidOrder({ lines: [{ offerId: 'o-001', quantity: 1 }] });
  await merchantAdvance(order.orderId, 'ready');
  ok('paid order created and marked ready by the merchant', order.number);

  // ── 4. Control tower: label → pickup → carrier simulation
  console.log('Control tower');
  // No reload: the new shipment must arrive through the SSE-driven refresh (polling fallback is 20 s).
  let card = await boardCard(page, order.number, 'PENDING', 12_000);
  ok('new shipment appeared on the board without a reload (< 12 s)');
  await shot(page, 'tower-pending');
  await card.locator('[data-testid=create-label]').click();
  card = await boardCard(page, order.number, 'LABEL_CREATED');
  const tracking = (await card.locator('.mono').first().textContent())?.trim();
  assert(/^SBX\d+$/.test(tracking ?? ''), 'label created with a sandbox tracking number', tracking);
  const labelHref = await card.locator('[data-testid=open-label]').getAttribute('href');
  const label = await page.request.get(labelHref);
  assert(label.ok() && (await label.text()).includes(tracking), 'label URL opens the label', labelHref);

  await card.locator('[data-testid=schedule-pickup]').click();
  await page.locator('dialog[open] input[name=pickupDate]').waitFor();
  await shot(page, 'pickup-dialog');
  await page.click('dialog[open] button[type=submit]');
  card = await boardCard(page, order.number, 'PICKUP_SCHEDULED');
  ok('pickup scheduled');
  await shot(page, 'tower-scheduled');

  for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']) {
    await card.locator(`[data-testid=sim-${status}]`).click();
    card = await boardCard(page, order.number, status);
    ok(`sandbox carrier scan → ${status}`);
  }
  await shot(page, 'tower-delivered');

  // ── 5. Order trace
  console.log('Order trace');
  await page.goto(`${PORTAL}/orders/${order.orderId}`);
  await page.locator('[data-testid=reconciled]').waitFor();
  const headStatus = await page.locator('.page-head .chip').first().getAttribute('data-status');
  assert(headStatus === 'DELIVERED', 'order trace shows DELIVERED', headStatus);
  const postings = await page.locator('[data-testid=ledger] .posting').count();
  const ledgerRows = await page.locator('[data-testid=ledger] tbody tr').count();
  assert(postings >= 1 && ledgerRows >= 3, 'ledger entries shown', `${postings} posting(s), ${ledgerRows} lines`);
  assert((await page.getAttribute('[data-testid=reconciled]', 'data-reconciled')) === 'true', 'reconciliation = مطابق (reconciled: true)');
  const events = await page.locator('#shipping .timeline li').count();
  assert(events >= 5, 'shipment tracking timeline shown', `${events} events`);
  await shot(page, 'order-trace');

  // ── 6. BFF proxy allowlist + CSRF
  console.log('BFF proxy');
  const refused = await browserFetch(page, '/api/proxy/v1/merchants/s-riyadh-center');
  assert(refused === 404, 'proxy refuses /v1/merchants/... (404)', String(refused));
  const refusedCustomer = await browserFetch(page, '/api/proxy/v1/me/addresses');
  assert(refusedCustomer === 404, 'proxy refuses /v1/me/addresses (404)');
  const allowed = await browserFetch(page, '/api/proxy/v1/ops/summary');
  assert(allowed === 200, 'proxy allows /v1/ops/summary (same session)');
  // A browser cannot forge Origin, so the cross-site request is simulated from the test runner.
  const csrf = await page.request.post(`${PORTAL}/api/proxy/v1/ops/sandbox/refunds/settle`, { headers: { origin: 'https://evil.example' }, data: {} });
  assert(csrf.status() === 403, 'cross-origin mutation rejected (CSRF)', String(csrf.status()));
  const cookies = await admin.cookies();
  const at = cookies.find((c) => c.name === 'qops_at');
  assert(at?.httpOnly && at.sameSite === 'Strict', 'session cookie is httpOnly + SameSite=Strict', `secure=${at?.secure}`);
  await admin.close();

  // ── 7. Merchant user → no-access screen
  console.log('Merchant user');
  const merchant = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' });
  const mpage = await merchant.newPage();
  await login(mpage, 'owner@riyadh-center.qitah.test');
  await mpage.locator('[data-testid=no-access]').waitFor({ timeout: 15_000 });
  assert(true, 'merchant owner sees the no-access screen');
  const mRefused = await browserFetch(mpage, '/api/proxy/v1/merchants/s-riyadh-center/orders');
  assert(mRefused === 404, 'proxy refuses merchant API even for a merchant session');
  await shot(mpage, 'no-access-mobile');
  await merchant.close();

  // ── 8. Unauthenticated page request → /login
  const anon = await browser.newContext();
  const apage = await anon.newPage();
  await apage.goto(`${PORTAL}/finance`);
  assert(apage.url().startsWith(`${PORTAL}/login`), 'unauthenticated visitors are redirected to /login', apage.url().replace(PORTAL, ''));
  await anon.close();

  console.log(`\nPASS — ${results.length} checks. Screenshots: ${SHOTS}`);
} catch (e) {
  console.error(`\nFAIL — ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
