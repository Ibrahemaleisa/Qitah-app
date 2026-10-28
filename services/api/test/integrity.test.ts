import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../src/app.js';
import { SandboxCarrier } from '../src/providers/carrier/sandbox.js';
import { expireUnpaidOrders } from '../src/services/payments.js';
import { Client, addAddress, config, customer, login, payOnSandboxPage, placeOrder, prisma, resetDatabase, sendPaymentEvent, settleSandboxRefunds, startApp } from './helpers.js';

/** Concurrency regressions found by the technical-readiness review. */
let app: Awaited<ReturnType<typeof startApp>>;
let ops: Client;
before(async () => {
  await resetDatabase();
  app = await startApp();
  ops = await login(app, 'ops.admin@qitah.test');
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test('capture racing expiry never yields a paid order without stock', async () => {
  for (let i = 0; i < 6; i++) {
    const c = await customer(app);
    const addr = await addAddress(c);
    const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-001', quantity: 1 }]);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    await prisma.order.update({ where: { id: order.orderId }, data: { paymentExpiresAt: new Date(Date.now() - 1000) } });
    await Promise.all([
      expireUnpaidOrders(),
      sendPaymentEvent(app, { type: 'payment.captured', providerPaymentId: payment.providerPaymentId, amountHalalas: payment.amountHalalas }),
    ]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, include: { reservations: true } });
    if (o.status === 'PAID') assert.ok(o.reservations.every((r) => r.status === 'COMMITTED'), `paid order ${i} must hold committed stock`);
    else {
      assert.equal(o.status, 'EXPIRED');
      assert.ok(o.reservations.every((r) => r.status === 'RELEASED'));
      assert.equal(await prisma.refund.count({ where: { orderId: o.id } }), 1, 'late capture is refunded');
    }
  }
  await settleSandboxRefunds(ops);
});

test('order numbers are long enough not to collide', async () => {
  const o = await prisma.order.findFirstOrThrow();
  assert.match(o.number, /^QT-\d{6}-[2-9A-Z]{8}$/);
});

test('parallel refunds cannot exceed the captured amount', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-001', quantity: 2 }]);
  await payOnSandboxPage(app, order.payment.redirectUrl);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: order.orderId } });
  const fin = await login(app, 'finance@qitah.test');
  const amount = Math.floor(mo.itemsHalalas * 0.6);
  const rs = await Promise.all(
    ['par-key-000001', 'par-key-000002'].map((k) => fin.post(`/v1/ops/orders/${order.orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: amount, reason: 'parallel', idempotencyKey: k })),
  );
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await prisma.refund.count({ where: { orderId: order.orderId } }), 1);
});

test('return inspection restocks exactly once under double submit', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-001', quantity: 1 }]);
  await payOnSandboxPage(app, order.payment.redirectUrl);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: order.orderId } });
  // Shortcut fulfilment: mark delivered directly (fulfilment itself is covered elsewhere).
  await prisma.merchantOrder.update({ where: { id: mo.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } });
  await c.ok('POST', `/v1/orders/${order.orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged' });
  const rc = await prisma.returnCase.findFirstOrThrow({ where: { orderId: order.orderId } });
  const m = await login(app, 'owner@riyadh-center.qitah.test');
  await m.ok('POST', `/v1/merchants/${mo.merchantId}/returns/${rc.id}/approve`, {});
  await m.ok('POST', `/v1/merchants/${mo.merchantId}/returns/${rc.id}/receive`);
  const before = (await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-001' } })).onHand;
  const rs = await Promise.all([1, 2].map(() => m.post(`/v1/merchants/${mo.merchantId}/returns/${rc.id}/inspect`, { accept: true, restock: true })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-001' } })).onHand, before + 1);
  // Duplicate return request for the same unit is refused.
  const again = await c.post(`/v1/orders/${order.orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged' });
  assert.equal(again.status, 409);
});

test('parallel OTP guesses cannot exceed the attempt cap', async () => {
  const anon = new Client(app);
  const phone = '+966512345670';
  const { sandboxCode } = await anon.ok<any>('POST', '/v1/auth/otp/request', { phone });
  const wrong = sandboxCode === '000000' ? '111111' : '000000';
  await Promise.all(Array.from({ length: 12 }, () => anon.post('/v1/auth/otp/verify', { phone, code: wrong })));
  const ch = await prisma.otpChallenge.findFirstOrThrow({ where: { phone }, orderBy: { createdAt: 'desc' } });
  assert.ok(ch.attempts <= 5, `attempts ${ch.attempts}`);
  assert.equal((await anon.post('/v1/auth/otp/verify', { phone, code: sandboxCode })).status, 401, 'locked after the cap');
});

test('a double click buys one carrier label', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-001', quantity: 1 }]);
  await payOnSandboxPage(app, order.payment.redirectUrl);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: order.orderId } });
  const m = await login(app, 'owner@riyadh-center.qitah.test');
  for (const s of ['accept', 'pack', 'ready']) await m.ok('POST', `/v1/merchants/${mo.merchantId}/orders/${mo.id}/${s}`);
  const sh = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.orderId } });
  // Count real carrier purchases (a slow carrier widens the race window).
  let bought = 0;
  const carrier = new SandboxCarrier(config.PUBLIC_BASE_URL);
  const original = carrier.createShipment.bind(carrier);
  carrier.createShipment = async (input) => {
    bought++;
    await new Promise((r) => setTimeout(r, 100));
    return original(input);
  };
  const spyApp = await buildApp(config, { carrier });
  const spyOps = await login(spyApp, 'ops.admin@qitah.test');
  const rs = await Promise.all([1, 2, 3].map(() => spyOps.post(`/v1/ops/shipments/${sh.id}/label`)));
  await spyApp.close();
  assert.equal(bought, 1, 'carrier label bought exactly once');
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => [r.status, r.body?.error?.code])));
  const events = await prisma.shipmentEvent.count({ where: { shipmentId: sh.id, status: 'LABEL_CREATED' } });
  assert.equal(events, 1);
});
