/**
 * Creates SANDBOX customer orders at every lifecycle stage by driving the real API routes in-process
 * (checkout → signed sandbox payment webhook → merchant actions → sandbox carrier scans → returns/refunds).
 * Run after seeding:  npx tsx scripts/demo-orders.ts      (refused in production)
 */
import { randomUUID } from 'node:crypto';

import { buildApp, deliverInProcess } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db.js';
import { pendingSandboxRefundWebhooks } from '../src/services/sandboxDelivery.js';

const config = loadConfig({ ...process.env, RATE_LIMIT_SCALE: '1000' });
if (config.NODE_ENV === 'production') throw new Error('Refusing to create demo orders in production');
const app = await buildApp(config);

async function call<T = any>(method: string, url: string, token?: string, body?: unknown): Promise<T> {
  const res = await app.inject({ method: method as 'GET', url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, payload: body ? JSON.stringify(body) : undefined });
  if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}
const login = async (email: string) => (await call<any>('POST', '/v1/auth/login', undefined, { email, password: process.env.SEED_PASSWORD ?? 'Qitah-Sandbox-2026!' })).accessToken as string;

const ops = await login('ops.admin@qitah.test');
const owners = new Map<string, string>();
const ownerToken = async (merchantId: string) => {
  if (!owners.has(merchantId)) {
    const m = await prisma.merchantMember.findFirstOrThrow({ where: { merchantId, role: 'OWNER' }, include: { user: true } });
    owners.set(merchantId, await login(m.user.email!));
  }
  return owners.get(merchantId)!;
};

async function customerToken(phone: string, name: string) {
  const otp = await call<any>('POST', '/v1/auth/otp/request', undefined, { phone });
  return (await call<any>('POST', '/v1/auth/otp/verify', undefined, { phone, code: otp.sandboxCode, name })).accessToken as string;
}

type Stage = 'pending' | 'paid' | 'fulfilling' | 'shipped' | 'delivered' | 'returned' | 'rejected';

async function order(label: string, phone: string, city: string, lines: { offerId: string; quantity: number }[], stage: Stage) {
  const t = await customerToken(phone, label);
  const addresses = await call<any>('GET', '/v1/me/addresses', t);
  const addr = addresses.addresses.find((a: any) => a.city === city) ?? (await call<any>('POST', '/v1/me/addresses', t, { kind: 'home', label: 'المنزل', city, district: 'حي تجريبي', street: 'شارع تجريبي', contactName: label, phone }));
  const plan = await call<any>('POST', '/v1/checkout/plan', t, { addressId: addr.id, lines });
  const option = plan.options.find((o: any) => o.bestFor.includes('lowest_total')) ?? plan.options[0];
  const o = await call<any>('POST', '/v1/checkout', t, { planId: option.planId, idempotencyKey: randomUUID(), paymentMethod: 'mada' });
  if (stage === 'pending') return o.number;
  await app.inject({ method: 'POST', url: new URL(o.payment.redirectUrl).pathname, payload: 'outcome=success', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const mos = await prisma.merchantOrder.findMany({ where: { orderId: o.orderId } });
  if (stage === 'paid') return o.number;
  if (stage === 'rejected') {
    await call('POST', `/v1/merchants/${mos[0].merchantId}/orders/${mos[0].id}/reject`, await ownerToken(mos[0].merchantId), { reason: 'OUT_OF_STOCK' });
    return o.number;
  }
  for (const mo of mos) for (const s of ['accept', 'pack', 'ready']) await call('POST', `/v1/merchants/${mo.merchantId}/orders/${mo.id}/${s}`, await ownerToken(mo.merchantId));
  if (stage === 'fulfilling') return o.number;
  const shipments = await prisma.shipment.findMany({ where: { orderId: o.orderId, status: 'PENDING' } });
  for (const sh of shipments) {
    await call('POST', `/v1/ops/shipments/${sh.id}/label`, ops);
    await call('POST', `/v1/ops/shipments/${sh.id}/pickup`, ops, { windowStart: new Date(Date.now() + 3600e3).toISOString(), windowEnd: new Date(Date.now() + 3 * 3600e3).toISOString() });
    for (const status of stage === 'shipped' ? ['PICKED_UP', 'IN_TRANSIT'] : ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await call('POST', `/v1/ops/shipments/${sh.id}/sandbox-event`, ops, { status });
    }
  }
  if (stage !== 'returned') return o.number;
  const view = await call<any>('GET', `/v1/orders/${o.orderId}`, t);
  await call('POST', `/v1/orders/${o.orderId}/returns`, t, { items: [{ orderItemId: view.items[0].id, quantity: 1 }], reason: 'wrongPart', note: 'لا تناسب السيارة' });
  const rc = await prisma.returnCase.findFirstOrThrow({ where: { orderId: o.orderId } });
  const mt = await ownerToken(rc.merchantId);
  await call('POST', `/v1/merchants/${rc.merchantId}/returns/${rc.id}/approve`, mt, {});
  await call('POST', `/v1/merchants/${rc.merchantId}/returns/${rc.id}/receive`, mt);
  await call('POST', `/v1/merchants/${rc.merchantId}/returns/${rc.id}/inspect`, mt, { accept: true, restock: true });
  return o.number;
}

const created = [
  await order('سارة (تجريبي)', '+966500000011', 'riyadh', [{ offerId: 'o-001', quantity: 1 }], 'pending'),
  await order('خالد (تجريبي)', '+966500000012', 'riyadh', [{ offerId: 'o-014', quantity: 2 }, { offerId: 'o-001', quantity: 1 }], 'paid'),
  await order('نورة (تجريبي)', '+966500000013', 'jeddah', [{ offerId: 'o-004', quantity: 1 }], 'fulfilling'),
  await order('فهد (تجريبي)', '+966500000014', 'dammam', [{ offerId: 'o-107', quantity: 2 }, { offerId: 'o-102', quantity: 1 }], 'shipped'),
  await order('ريم (تجريبي)', '+966500000015', 'riyadh', [{ offerId: 'o-001', quantity: 1 }, { offerId: 'o-108', quantity: 1 }], 'delivered'),
  await order('عبدالله (تجريبي)', '+966500000016', 'khobar', [{ offerId: 'o-106', quantity: 1 }], 'returned'),
  await order('منى (تجريبي)', '+966500000017', 'madinah', [{ offerId: 'o-103', quantity: 1 }], 'rejected'),
];
for (const d of await pendingSandboxRefundWebhooks(config.PAYMENT_WEBHOOK_SECRET)) await deliverInProcess(app, d);
console.log('Demo orders created (SANDBOX):', created.join(', '));
await app.close();
await prisma.$disconnect();
