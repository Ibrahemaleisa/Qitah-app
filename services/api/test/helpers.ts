import './env.js';

import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { buildApp, deliverInProcess } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { prisma } from '../src/db.js';
import { paymentWebhook } from '../src/services/sandboxDelivery.js';

export const PASSWORD = 'Qitah-Sandbox-2026!';
export const config = loadConfig();
export const ctx = createContext(config);

/** Recreates the dedicated *_test database schema, applies migrations and seeds sandbox data. */
export async function resetDatabase() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.endsWith('_test')) throw new Error(`Refusing to reset non-test database ${url.pathname}`);
  const env = { ...process.env };
  const cwd = new URL('..', import.meta.url).pathname;
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe', cwd });
  execSync('npx tsx prisma/seed.ts --force', { env, stdio: 'pipe', cwd });
}

export type Res<T = any> = { status: number; body: T };

export class Client {
  constructor(public app: FastifyInstance, public token?: string) {}
  async req<T = any>(method: string, url: string, body?: unknown): Promise<Res<T>> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.statusCode, body: res.body ? (res.json() as T) : (undefined as T) };
  }
  get = <T = any>(url: string) => this.req<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>('POST', url, body);
  put = <T = any>(url: string, body: unknown) => this.req<T>('PUT', url, body);
  patch = <T = any>(url: string, body: unknown) => this.req<T>('PATCH', url, body);
  /** Asserts a 2xx and returns the body. */
  async ok<T = any>(method: string, url: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, url, body);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export async function startApp() {
  return buildApp(config);
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  const c = new Client(app);
  const s = await c.ok<{ accessToken: string }>('POST', '/v1/auth/login', { email, password });
  return new Client(app, s.accessToken);
}

export async function customer(app: FastifyInstance, phone = `+9665${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`) {
  const c = new Client(app);
  const otp = await c.ok<{ sandboxCode: string }>('POST', '/v1/auth/otp/request', { phone });
  const s = await c.ok<{ accessToken: string; user: { id: string } }>('POST', '/v1/auth/otp/verify', { phone, code: otp.sandboxCode, name: 'Test Customer' });
  const client = new Client(app, s.accessToken);
  return Object.assign(client, { userId: s.user.id, phone });
}

export async function addAddress(c: Client, city = 'riyadh', kind: 'home' | 'workshop' = 'home') {
  return c.ok<{ id: string }>('POST', '/v1/me/addresses', {
    kind, label: 'Test', city, district: 'الملقا', street: 'شارع تجريبي', contactName: 'Test Customer', phone: '+966500000099', ...(kind === 'workshop' ? { workshopName: 'ورشة' } : {}),
  });
}

/** Plans and places an order; returns the order + payment info. */
export async function placeOrder(c: Client, addressId: string, lines: { offerId: string; quantity: number }[], strategy = 'selected', key = randomUUID()) {
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId, lines });
  const option = plan.options.find((o: any) => o.strategy === strategy || o.bestFor.includes(strategy));
  assert.ok(option, `no ${strategy} option: ${JSON.stringify(plan)}`);
  const order = await c.ok<any>('POST', '/v1/checkout', { planId: option.planId, idempotencyKey: key, paymentMethod: 'mada' });
  return { plan, option, order, key };
}

/** Customer pays on the sandbox hosted page (which triggers the signed webhook). */
export async function payOnSandboxPage(app: FastifyInstance, redirectUrl: string, outcome: 'success' | 'fail' = 'success') {
  const path = new URL(redirectUrl).pathname;
  const res = await app.inject({ method: 'POST', url: path, payload: `outcome=${outcome}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.statusCode, 303, res.body);
}

export async function sendPaymentEvent(app: FastifyInstance, event: Record<string, unknown>) {
  return deliverInProcess(app, paymentWebhook(config.PAYMENT_WEBHOOK_SECRET, event));
}

/** Uploads a (tiny) JPEG through the customer's private upload flow and returns its key. */
export async function uploadReturnPhoto(c: Client): Promise<string> {
  const up = await c.ok<{ key: string; uploadUrl: string }>('POST', '/v1/me/uploads', { purpose: 'return', contentType: 'image/jpeg', sizeBytes: 4, fileName: 'damage.jpg' });
  const u = new URL(up.uploadUrl);
  const res = await c.app.inject({ method: 'PUT', url: u.pathname + u.search, payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), headers: { 'content-type': 'image/jpeg' } });
  assert.equal(res.statusCode, 200, res.body);
  return up.key;
}

export async function settleSandboxRefunds(ops: Client) {
  return ops.ok<{ settled: number }>('POST', '/v1/ops/sandbox/refunds/settle');
}

/** Drives every merchant suborder of an order to READY_FOR_PICKUP and every outbound shipment to `final`. */
export async function fulfil(app: FastifyInstance, ops: Client, orderId: string, final: 'PICKED_UP' | 'DELIVERED' = 'DELIVERED') {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { merchantOrders: true } });
  for (const mo of order.merchantOrders) {
    const owner = await prisma.merchantMember.findFirstOrThrow({ where: { merchantId: mo.merchantId, role: 'OWNER' }, include: { user: true } });
    const m = await login(app, owner.user.email!);
    for (const step of ['accept', 'pack', 'ready']) await m.ok('POST', `/v1/merchants/${mo.merchantId}/orders/${mo.id}/${step}`);
  }
  const shipments = await prisma.shipment.findMany({ where: { orderId, direction: 'OUTBOUND', status: 'PENDING' } });
  for (const s of shipments) {
    await ops.ok('POST', `/v1/ops/shipments/${s.id}/label`);
    await ops.ok('POST', `/v1/ops/shipments/${s.id}/pickup`, { windowStart: new Date(Date.now() + 3600_000).toISOString(), windowEnd: new Date(Date.now() + 7200_000).toISOString() });
    const steps = final === 'DELIVERED' ? ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] : ['PICKED_UP'];
    for (const status of steps) {
      const r = await ops.ok<any>('POST', `/v1/ops/shipments/${s.id}/sandbox-event`, { status });
      assert.equal(r.delivered, true, JSON.stringify(r));
    }
  }
}

export { prisma };
