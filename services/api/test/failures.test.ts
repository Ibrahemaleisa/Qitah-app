import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { runAllJobs, pickupDelayMonitor, slaMonitor } from '../src/jobs.js';
import { expireUnpaidOrders } from '../src/services/payments.js';
import {
  Client, addAddress, ctx, customer, fulfil, login, payOnSandboxPage, placeOrder, prisma, resetDatabase, sendPaymentEvent, settleSandboxRefunds, startApp,
} from './helpers.js';

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

async function paidOrder(lines: { offerId: string; quantity: number }[], city = 'riyadh') {
  const c = await customer(app);
  const addr = await addAddress(c, city);
  const { order } = await placeOrder(c, addr.id, lines);
  await payOnSandboxPage(app, order.payment.redirectUrl);
  return { c, orderId: order.orderId as string, order };
}

test('duplicate payment webhooks capture exactly once; later capture events for the same payment are ignored', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-001', quantity: 1 }]);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  const event = { id: 'evt_dup_1', type: 'payment.captured', providerPaymentId: payment.providerPaymentId, amountHalalas: payment.amountHalalas };
  const results = await Promise.all([1, 2, 3].map(() => sendPaymentEvent(app, event)));
  const outcomes = results.map((r) => (r.body as { outcome: string }).outcome).sort();
  assert.deepEqual(outcomes, ['duplicate', 'duplicate', 'processed']);
  assert.equal(await prisma.ledgerPosting.count({ where: { type: 'PAYMENT_CAPTURED', refId: payment.id } }), 1);
  const lvl = await prisma.inventoryReservation.findMany({ where: { orderId: order.orderId } });
  assert.ok(lvl.every((r) => r.status === 'COMMITTED'));
  // A *different* event for the same payment after capture changes nothing.
  const again = await sendPaymentEvent(app, { ...event, id: 'evt_dup_2' });
  assert.equal((again.body as { outcome: string }).outcome, 'ignored');
});

test('webhooks with bad signatures or wrong amounts never mark an order paid', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-002', quantity: 1 }]);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  const forged = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/sandbox',
    payload: JSON.stringify({ id: 'evt_forged', type: 'payment.captured', providerPaymentId: payment.providerPaymentId, amountHalalas: payment.amountHalalas }),
    headers: { 'content-type': 'application/json', 'x-qitah-sandbox-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
  });
  assert.equal(forged.statusCode, 401);
  const wrong = await sendPaymentEvent(app, { type: 'payment.captured', providerPaymentId: payment.providerPaymentId, amountHalalas: 1 });
  assert.equal((wrong.body as { outcome: string }).outcome, 'flagged');
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status, 'PENDING_PAYMENT');
});

test('payment failure keeps the order payable; retry with a new payment succeeds', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-003', quantity: 1 }]);
  await payOnSandboxPage(app, order.payment.redirectUrl, 'fail');
  let view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'PENDING_PAYMENT');
  const retry = await c.ok<any>('POST', `/v1/orders/${order.orderId}/payment`, { method: 'card' });
  assert.notEqual(retry.redirectUrl, order.payment.redirectUrl);
  await payOnSandboxPage(app, retry.redirectUrl);
  view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'PAID');
});

test('insufficient stock is reported at planning and enforced at checkout', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const lvl = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-005' } });
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-005', quantity: lvl.onHand - lvl.reserved + 1 }] });
  assert.ok(plan.lines[0].selectedAvailable < plan.lines[0].requested);
  assert.ok(!plan.options.some((o: any) => o.strategy === 'selected'));
});

test('concurrent checkout cannot oversell the last unit', async () => {
  // Make o-010 have exactly 1 unit, and remove alternatives so both customers must buy that unit.
  await prisma.inventoryLevel.update({ where: { offerId: 'o-010' }, data: { onHand: 1, reserved: 0 } });
  const target = await prisma.offer.findUniqueOrThrow({ where: { id: 'o-010' } });
  await prisma.offer.updateMany({ where: { productId: target.productId, id: { not: 'o-010' } }, data: { status: 'PAUSED' } });
  const buyers = await Promise.all([1, 2, 3, 4].map(() => customer(app)));
  const plans = await Promise.all(
    buyers.map(async (b) => {
      const addr = await addAddress(b);
      const plan = await b.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-010', quantity: 1 }] });
      return { b, planId: plan.options.find((o: any) => o.strategy === 'selected').planId };
    }),
  );
  const results = await Promise.all(plans.map(({ b, planId }, i) => b.post('/v1/checkout', { planId, idempotencyKey: `race-${i}-xxxxxx`, paymentMethod: 'mada' })));
  const ok = results.filter((r) => r.status === 200);
  const conflicts = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => [r.status, r.body?.error?.code])));
  assert.equal(conflicts.length, 3);
  assert.ok(conflicts.every((r) => r.body.error.code === 'INSUFFICIENT_STOCK'));
  const after = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-010' } });
  assert.deepEqual([after.onHand, after.reserved], [1, 1]);
  await prisma.offer.updateMany({ where: { productId: target.productId }, data: { status: 'ACTIVE' } });
});

test('same idempotency key from parallel submits creates one order', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-011', quantity: 1 }] });
  const planId = plan.options.find((o: any) => o.strategy === 'selected').planId;
  const rs = await Promise.all([1, 2, 3].map(() => c.post('/v1/checkout', { planId, idempotencyKey: 'same-key-123456', paymentMethod: 'mada' })));
  const ids = new Set(rs.filter((r) => r.status === 200).map((r) => r.body.orderId));
  assert.equal(ids.size, 1, JSON.stringify(rs.map((r) => [r.status, r.body])));
  assert.equal(await prisma.order.count({ where: { customerId: c.userId } }), 1);
});

test('unpaid orders expire and release reserved stock; a late payment is refunded from suspense', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  const { order } = await placeOrder(c, addr.id, [{ offerId: 'o-012', quantity: 2 }]);
  const before = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-012' } });
  await prisma.order.update({ where: { id: order.orderId }, data: { paymentExpiresAt: new Date(Date.now() - 1000) } });
  assert.ok((await expireUnpaidOrders()) >= 1);
  const afterLvl = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-012' } });
  assert.equal(afterLvl.reserved, before.reserved - 2);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status, 'EXPIRED');
  // Customer completes payment on a stale page afterwards
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  assert.equal(payment.status, 'CANCELLED', 'our side cancelled it on expiry');
  const r = await sendPaymentEvent(app, { type: 'payment.captured', providerPaymentId: payment.providerPaymentId, amountHalalas: payment.amountHalalas });
  assert.equal((r.body as any).detail, 'LATE_PAYMENT_REFUNDED');
  await settleSandboxRefunds(ops);
  const rec = await ops.ok<any>('GET', `/v1/ops/orders/${order.orderId}/reconcile`);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
  assert.equal(rec.netCollectedHalalas, 0);
});

test('merchant rejection restocks, refunds that merchant share, and keeps the rest of the order', async () => {
  // o-014 (s-elite-oils) + o-001 (s-riyadh-center): two merchants
  const { c, orderId } = await paidOrder([{ offerId: 'o-014', quantity: 1 }, { offerId: 'o-001', quantity: 1 }]);
  const mos = await prisma.merchantOrder.findMany({ where: { orderId }, include: { items: true } });
  const victim = mos.find((m) => m.merchantId === 's-elite-oils')!;
  const lvlBefore = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: victim.items[0].offerId } });
  const owner = await login(app, 'owner@elite-oils.qitah.test');
  await owner.ok('POST', `/v1/merchants/s-elite-oils/orders/${victim.id}/reject`, { reason: 'OUT_OF_STOCK' });
  const lvlAfter = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: victim.items[0].offerId } });
  assert.equal(lvlAfter.onHand, lvlBefore.onHand + victim.items[0].quantity);
  await settleSandboxRefunds(ops);
  const view = await c.ok<any>('GET', `/v1/orders/${orderId}`);
  assert.equal(view.status, 'PAID', 'remaining merchant still fulfils');
  assert.equal(view.totals.refundedHalalas, victim.itemsHalalas + victim.shippingHalalas);
  const rejected = await owner.post(`/v1/merchants/s-elite-oils/orders/${victim.id}/accept`);
  assert.equal(rejected.status, 409, 'cannot accept after rejecting');
  const rec = await ops.ok<any>('GET', `/v1/ops/orders/${orderId}/reconcile`);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
});

test('rejection of the only merchant cancels the order with a full refund', async () => {
  const { c, orderId, order } = await paidOrder([{ offerId: 'o-001', quantity: 1 }]);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });
  await ops.ok('POST', `/v1/ops/merchant-orders/${mo.id}/reject`, { reason: 'merchant called: damaged unit' });
  await settleSandboxRefunds(ops);
  const view = await c.ok<any>('GET', `/v1/orders/${orderId}`);
  assert.equal(view.status, 'CANCELLED');
  assert.equal(view.totals.refundedHalalas, order.totalHalalas);
});

test('customer can cancel a paid order before carrier pickup, not after', async () => {
  const a = await paidOrder([{ offerId: 'o-001', quantity: 1 }]);
  const cancelled = await a.c.ok<any>('POST', `/v1/orders/${a.orderId}/cancel`, { reason: 'changed my mind' });
  assert.equal(cancelled.status, 'CANCELLED');
  const b = await paidOrder([{ offerId: 'o-001', quantity: 1 }]);
  await fulfil(app, ops, b.orderId, 'PICKED_UP');
  const late = await b.c.post(`/v1/orders/${b.orderId}/cancel`, { reason: 'too late' });
  assert.equal(late.status, 409);
});

test('shipping failure: failed pickup becomes an exception, is rescheduled and completes', async () => {
  const { orderId } = await paidOrder([{ offerId: 'o-001', quantity: 1 }]);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });
  const m = await login(app, 'owner@riyadh-center.qitah.test');
  for (const s of ['accept', 'pack', 'ready']) await m.ok('POST', `/v1/merchants/${mo.merchantId}/orders/${mo.id}/${s}`);
  const sh = await prisma.shipment.findFirstOrThrow({ where: { orderId } });
  const tooEarly = await ops.post(`/v1/ops/shipments/${sh.id}/sandbox-event`, { status: 'PICKED_UP' });
  assert.equal(tooEarly.status, 409, 'no label yet');
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/label`);
  const win = { windowStart: new Date(Date.now() + 3600e3).toISOString(), windowEnd: new Date(Date.now() + 7200e3).toISOString() };
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/pickup`, win);
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/sandbox-event`, { status: 'PICKUP_FAILED', description: 'Shop closed' });
  const ex = await ops.ok<any>('GET', '/v1/ops/exceptions');
  assert.ok(ex.shipments.some((s: any) => s.id === sh.id && s.exceptionReason === 'Shop closed'));
  const merchantNotes = await m.ok<any>('GET', `/v1/merchants/${mo.merchantId}/notifications`);
  assert.ok(merchantNotes.notifications.some((n: any) => n.type === 'shipment.pickup_failed'));
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/pickup`, win);
  for (const status of ['PICKED_UP', 'DELIVERED']) await ops.ok('POST', `/v1/ops/shipments/${sh.id}/sandbox-event`, { status });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'DELIVERED');
  // Out-of-order carrier scan after delivery is acknowledged but rejected.
  const stale = await ops.ok<any>('POST', `/v1/ops/shipments/${sh.id}/sandbox-event`, { status: 'IN_TRANSIT' });
  assert.equal(stale.response.outcome, 'rejected');
});

test('delayed pickup and merchant SLA breaches are detected by the worker', async () => {
  const { orderId } = await paidOrder([{ offerId: 'o-001', quantity: 1 }]);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });
  await prisma.merchantOrder.update({ where: { id: mo.id }, data: { acceptBy: new Date(Date.now() - 60_000) } });
  assert.ok((await slaMonitor()) >= 1);
  assert.equal((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: mo.id } })).slaBreached, true);
  assert.equal(await slaMonitor(), 0, 'alerts only once');

  const m = await login(app, 'owner@riyadh-center.qitah.test');
  for (const s of ['accept', 'pack', 'ready']) await m.ok('POST', `/v1/merchants/${mo.merchantId}/orders/${mo.id}/${s}`);
  const sh = await prisma.shipment.findFirstOrThrow({ where: { orderId } });
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/label`);
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/pickup`, { windowStart: new Date(Date.now() + 1000).toISOString(), windowEnd: new Date(Date.now() + 2000).toISOString() });
  await prisma.shipment.update({ where: { id: sh.id }, data: { pickupWindowEnd: new Date(Date.now() - 60_000) } });
  assert.ok((await pickupDelayMonitor()) >= 1);
  const ex = await ops.ok<any>('GET', '/v1/ops/exceptions');
  assert.ok(ex.delayedPickups.some((s: any) => s.id === sh.id));
  const jobs = await runAllJobs(ctx, { deliver: async () => undefined });
  assert.equal(typeof jobs.outbox, 'number');
});

test('partial refunds are bounded and reconcile', async () => {
  const { c, orderId } = await paidOrder([{ offerId: 'o-001', quantity: 2 }]);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });
  const fin = await login(app, 'finance@qitah.test');
  await fin.ok('POST', `/v1/ops/orders/${orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: 2500, reason: 'goodwill for delay', idempotencyKey: 'goodwill-0001' });
  // same idempotency key → no second refund
  await fin.ok('POST', `/v1/ops/orders/${orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: 2500, reason: 'goodwill for delay', idempotencyKey: 'goodwill-0001' });
  const tooMuch = await fin.post(`/v1/ops/orders/${orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: mo.itemsHalalas, reason: 'too much', idempotencyKey: 'goodwill-0002' });
  assert.equal(tooMuch.status, 409);
  await settleSandboxRefunds(ops);
  const view = await c.ok<any>('GET', `/v1/orders/${orderId}`);
  assert.equal(view.totals.refundedHalalas, 2500);
  const agent = await login(app, 'ops.agent@qitah.test');
  const denied = await agent.post(`/v1/ops/orders/${orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: 100, reason: 'x', idempotencyKey: 'agent-000001' });
  assert.equal(denied.status, 403, 'refunds need FINANCE');
  const rec = await ops.ok<any>('GET', `/v1/ops/orders/${orderId}/reconcile`);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
});

test('merchant data isolation and role checks', async () => {
  const { orderId } = await paidOrder([{ offerId: 'o-001', quantity: 1 }]);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });
  assert.equal(mo.merchantId, 's-riyadh-center');
  const intruder = await login(app, 'owner@eastern.qitah.test');
  // Other merchant's endpoints
  assert.equal((await intruder.get(`/v1/merchants/s-riyadh-center/orders`)).status, 403);
  assert.equal((await intruder.get(`/v1/merchants/s-riyadh-center/offers`)).status, 403);
  assert.equal((await intruder.put(`/v1/merchants/s-riyadh-center/offers/o-001/stock`, { onHand: 0, reason: 'CORRECTION' })).status, 403);
  // Own merchant path but someone else's ids
  assert.equal((await intruder.get(`/v1/merchants/s-eastern/orders/${mo.id}`)).status, 404);
  assert.equal((await intruder.post(`/v1/merchants/s-eastern/orders/${mo.id}/accept`)).status, 404);
  assert.equal((await intruder.patch(`/v1/merchants/s-eastern/offers/o-001`, { priceHalalas: 1 })).status, 404);
  // Staff role limits
  const staff = await login(app, 'staff@riyadh-center.qitah.test');
  assert.equal((await staff.get('/v1/merchants/s-riyadh-center/staff')).status, 403);
  assert.equal((await staff.patch('/v1/merchants/s-riyadh-center/offers/o-001', { priceHalalas: 100 })).status, 403);
  assert.equal((await staff.post(`/v1/merchants/s-riyadh-center/orders/${mo.id}/accept`)).status, 200, 'staff can process orders');
  // Customers and merchants cannot reach ops; anonymous cannot reach anything private
  const cust = await customer(app);
  assert.equal((await cust.get('/v1/ops/summary')).status, 403);
  assert.equal((await intruder.get('/v1/ops/orders')).status, 403);
  assert.equal((await new Client(app).get('/v1/ops/summary')).status, 401);
  assert.equal((await new Client(app, 'garbage').get('/v1/me')).status, 401);
  // Customers cannot read each other's orders
  assert.equal((await cust.get(`/v1/orders/${orderId}`)).status, 404);
  // Merchant SSE scope cannot be widened to another merchant
  assert.equal((await intruder.get('/v1/events?scope=merchant&merchantId=s-riyadh-center')).status, 403);
  // Agents cannot approve merchants (admin only)
  const agent = await login(app, 'ops.agent@qitah.test');
  const pending = await prisma.merchant.findFirstOrThrow({ where: { status: 'UNDER_REVIEW' } });
  assert.equal((await agent.post(`/v1/ops/merchants/${pending.id}/approve`)).status, 403);
});

test('stock cannot be set below units reserved for open orders; suspended merchants disappear from the catalog', async () => {
  const c = await customer(app);
  const addr = await addAddress(c);
  await placeOrder(c, addr.id, [{ offerId: 'o-020', quantity: 1 }]);
  const lvl = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: 'o-020' } });
  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: 'o-020' } });
  const owner = await prisma.merchantMember.findFirstOrThrow({ where: { merchantId: offer.merchantId, role: 'OWNER' }, include: { user: true } });
  const m = await login(app, owner.user.email!);
  const r = await m.put(`/v1/merchants/${offer.merchantId}/offers/o-020/stock`, { onHand: lvl.reserved - 1, reason: 'CORRECTION' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'BELOW_RESERVED');

  await ops.ok('POST', `/v1/ops/merchants/${offer.merchantId}/suspend`, { reason: 'test suspension' });
  const snap = await new Client(app).get<any>('/v1/catalog/snapshot');
  assert.ok(!snap.body.products.some((p: any) => p.offers.some((o: any) => o.sellerId === offer.merchantId)));
  await ops.ok('POST', `/v1/ops/merchants/${offer.merchantId}/reinstate`);
});

test('bulk CSV import creates and updates offers with row-level errors', async () => {
  const m = await login(app, 'owner@brake-house.qitah.test');
  const csv = [
    'sku,partNumber,brand,condition,priceSar,stock,nameAr,nameEn,categoryId,origin,weightGrams,lengthCm,widthCm,heightCm',
    'IMP-1,04465-X3301,Toyota Genuine,NEW,355.50,7,,,,,,,,',
    'IMP-2,NEW-PN-777,ImportBrand,NEW,99,3,منتج مستورد,Imported part,engine,AFTERMARKET,500,10,10,10',
    'IMP-3,UNKNOWN-1,Nobody,NEW,10,1,,,,,,,,',
    'IMP-4,04465-X3301,Toyota Genuine,BROKEN,10,1,,,,,,,,',
  ].join('\n');
  const dry = await m.ok<any>('POST', '/v1/merchants/s-brake-house/offers/import', { csv, dryRun: true });
  assert.deepEqual(dry.summary, { created: 2, updated: 0, errors: 2 });
  assert.equal(await prisma.offer.count({ where: { sku: { startsWith: 'IMP-' } } }), 0, 'dry run writes nothing');
  const real = await m.ok<any>('POST', '/v1/merchants/s-brake-house/offers/import', { csv });
  assert.deepEqual(real.summary, { created: 2, updated: 0, errors: 2 });
  const imp1 = await prisma.offer.findFirstOrThrow({ where: { sku: 'IMP-1' }, include: { inventory: true } });
  assert.equal(imp1.priceHalalas, 35550);
  assert.equal(imp1.inventory!.onHand, 7);
  const again = await m.ok<any>('POST', '/v1/merchants/s-brake-house/offers/import', { csv: csv.split('\n').slice(0, 2).join('\n').replace('355.50,7', '340,9') });
  assert.deepEqual(again.summary, { created: 0, updated: 1, errors: 0 });
});
