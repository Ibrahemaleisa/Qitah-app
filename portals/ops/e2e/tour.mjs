// Exploratory tour: exercises the remaining workflows through the UI and screenshots every page
// for each role and at tablet / phone widths. Run after `node e2e/demo-orders.mjs`.
//   node e2e/tour.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3102';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Qitah-Sandbox-2026!';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'tour');
mkdirSync(SHOTS, { recursive: true });
const errors = [];

async function session(browser, email, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar-SA' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) errors.push(`${email} console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${PORTAL}/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${PORTAL}/`);
  return { ctx, page };
}
// (networkidle never fires: the live SSE stream stays open)
const settle = (page) => page.waitForLoadState('load').then(() => page.waitForTimeout(1500));
async function visit(page, path, name) {
  await page.goto(`${PORTAL}${path}`);
  await settle(page);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  console.log(`  · ${name}`);
}
async function submitDialog(page) {
  await page.click('dialog[open] button[type=submit]');
  await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  await settle(page);
}

const browser = await chromium.launch();
try {
  console.log('Ops admin — every page');
  const { ctx, page } = await session(browser, 'ops.admin@qitah.test');
  for (const [p, n] of [
    ['/', 'admin-overview'],
    ['/tower', 'admin-tower-board'],
    ['/tower/queue', 'admin-tower-queue'],
    ['/exceptions', 'admin-exceptions'],
    ['/orders', 'admin-orders'],
    ['/merchants', 'admin-merchants'],
    ['/merchants/s-riyadh-center', 'admin-merchant-detail'],
    ['/returns', 'admin-returns'],
    ['/finance', 'admin-finance'],
    ['/audit', 'admin-audit'],
    ['/staff', 'admin-staff'],
  ])
    await visit(page, p, n);

  console.log('Workflows');
  // Bulk labels for all ready
  await page.goto(`${PORTAL}/tower`);
  await settle(page);
  if (await page.locator('[data-testid=bulk-labels]').count()) {
    await page.click('[data-testid=bulk-labels]');
    await page.waitForTimeout(2500);
    console.log('  ✓ bulk labels');
  }
  // Reschedule a failed pickup from the exceptions view
  await page.goto(`${PORTAL}/exceptions`);
  await settle(page);
  const resched = page.locator('#shipments [data-testid=schedule-pickup]').first();
  if (await resched.count()) {
    await resched.click();
    await page.screenshot({ path: join(SHOTS, 'exceptions-reschedule-dialog.png') });
    await submitDialog(page);
    console.log('  ✓ failed pickup rescheduled');
  }
  // Returns: approve the requested one, inspect is exercised via receive → inspect on the approved one
  await page.goto(`${PORTAL}/returns`);
  await settle(page);
  const approve = page.getByRole('button', { name: 'موافقة', exact: true }).first();
  if (await approve.count()) {
    await approve.click();
    await submitDialog(page);
    console.log('  ✓ return approved');
  }
  const receive = page.getByRole('button', { name: 'تأكيد الاستلام' }).first();
  if (await receive.count()) {
    await receive.click();
    await submitDialog(page);
    console.log('  ✓ return received');
  }
  const inspect = page.getByRole('button', { name: 'نتيجة الفحص' }).first();
  if (await inspect.count()) {
    await inspect.click();
    await page.fill('dialog[open] input[inputmode=decimal]', '20.50');
    await page.screenshot({ path: join(SHOTS, 'returns-inspect-dialog.png') });
    await submitDialog(page);
    console.log('  ✓ return inspected with partial refund 20.50 SAR');
  }
  await visit(page, '/returns?f=ALL', 'admin-returns-after');

  // Finance: settle sandbox refunds, generate (asOf simulated), approve, mark paid
  await page.goto(`${PORTAL}/finance`);
  await settle(page);
  await page.click('[data-testid=settle-sandbox-refunds]');
  await submitDialog(page);
  const gen = page.getByRole('button', { name: 'إنشاء تسوية' }).first();
  await gen.click();
  await page.check('[data-testid=simulate-asof]');
  await page.screenshot({ path: join(SHOTS, 'finance-generate-dialog.png') });
  await submitDialog(page);
  const approveS = page.getByRole('button', { name: 'اعتماد', exact: true }).first();
  if (await approveS.count()) {
    await approveS.click();
    await submitDialog(page);
    await page.getByRole('button', { name: 'تسجيل التحويل' }).first().click();
    await page.fill('dialog[open] input[required]', 'BANK-TRX-2026-0001');
    await submitDialog(page);
    console.log('  ✓ settlement generated (asOf) → approved → paid');
  }
  await visit(page, '/finance', 'admin-finance-after');

  // Goodwill refund on the most recent delivered order
  await page.goto(`${PORTAL}/orders?status=DELIVERED`);
  await settle(page);
  await page.locator('table.t tbody tr a').first().click();
  await page.locator('[data-testid=open-refund]').waitFor();
  await page.click('[data-testid=open-refund]');
  await page.fill('dialog[open] input[name=amount]', '15');
  await page.fill('dialog[open] textarea[name=reason]', 'تعويض عن تأخر التوصيل');
  await page.screenshot({ path: join(SHOTS, 'order-refund-dialog.png') });
  await submitDialog(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, 'order-trace-after-refund.png'), fullPage: true });
  console.log('  ✓ goodwill refund 15.00 SAR');

  // Staff
  await page.goto(`${PORTAL}/staff`);
  await settle(page);
  await page.fill('input[name=name]', 'موظف جديد');
  await page.fill('input[name=email]', `agent.${Date.now()}@qitah.test`);
  await page.fill('input[name=password]', 'Very-Long-Password-1');
  await page.click('form button[type=submit]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, 'admin-staff-after.png'), fullPage: true });
  console.log('  ✓ staff user created');
  await ctx.close();

  console.log('Ops agent');
  const agent = await session(browser, 'ops.agent@qitah.test');
  await visit(agent.page, '/merchants/s-riyadh-center', 'agent-merchant-detail');
  await visit(agent.page, '/finance', 'agent-finance-forbidden');
  await agent.ctx.close();

  console.log('Finance');
  const fin = await session(browser, 'finance@qitah.test');
  await visit(fin.page, '/tower', 'finance-tower-readonly');
  await visit(fin.page, '/finance', 'finance-finance');
  await fin.ctx.close();

  console.log('Tablet + phone');
  const tab = await session(browser, 'ops.admin@qitah.test', { width: 820, height: 1180 });
  await visit(tab.page, '/tower', 'tablet-tower');
  await visit(tab.page, '/tower/queue', 'tablet-queue');
  await tab.ctx.close();
  const phone = await session(browser, 'ops.admin@qitah.test', { width: 390, height: 844 });
  await visit(phone.page, '/', 'phone-overview');
  await visit(phone.page, '/tower', 'phone-tower');
  const firstOrder = await phone.page.goto(`${PORTAL}/orders`).then(() => settle(phone.page)).then(() => phone.page.locator('table.t tbody tr a').first().getAttribute('href'));
  await visit(phone.page, firstOrder, 'phone-order-trace');
  const sw = await phone.page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`  phone scrollWidth=${sw} (viewport 390)`);
  await phone.page.click('.menu-btn');
  await phone.page.waitForTimeout(500);
  await phone.page.screenshot({ path: join(SHOTS, 'phone-menu.png') });
  await phone.ctx.close();
} finally {
  await browser.close();
  console.log(errors.length ? `\nBrowser errors:\n${[...new Set(errors)].join('\n')}` : '\nNo browser errors.');
}
