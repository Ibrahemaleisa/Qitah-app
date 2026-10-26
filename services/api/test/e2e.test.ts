import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Client, customer, addAddress, login, payOnSandboxPage, prisma, resetDatabase, sendPaymentEvent, settleSandboxRefunds, startApp } from './helpers.js';

/**
 * The Phase 1 acceptance journey, end to end through the HTTP API against PostgreSQL:
 * merchant onboarding → catalog → customer purchase (multi-merchant, sandbox payment) → fulfilment →
 * sandbox carrier tracking → delivery → return → partial refund → settlement → reconciliation.
 */
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  await resetDatabase();
  app = await startApp();
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test('full marketplace lifecycle is persisted and traceable', async () => {
  const anon = new Client(app);
  const ops = await login(app, 'ops.admin@qitah.test');
  const finance = await login(app, 'finance@qitah.test');

  // 1. Register a merchant
  const reg = await anon.ok<any>('POST', '/v1/merchant-applications', {
    business: { legalName: 'Test Spares Est.', displayNameAr: 'قطع الاختبار', displayNameEn: 'Test Spares', crNumber: '1010123456', city: 'riyadh', contactPhone: '+966511111111', contactEmail: 'shop@test-spares.qitah.test' },
    owner: { name: 'Owner', email: 'owner@test-spares.qitah.test', password: 'a-very-strong-password' },
    location: { name: 'Main', city: 'riyadh', district: 'الصناعية', street: 'شارع 1', contactPhone: '+966511111112' },
  });
  assert.equal(reg.status, 'UNDER_REVIEW');
  const merchant = new Client(app, reg.session.accessToken);
  const mid = reg.merchantId as string;

  // Not approved yet → cannot publish offers
  const loc = (await merchant.ok<any>('GET', `/v1/merchants/${mid}/locations`)).locations[0];
  const early = await merchant.post(`/v1/merchants/${mid}/offers`, { productId: 'p-camry-pads-oem', locationId: loc.id, sku: 'X1', priceHalalas: 30000, stock: 5 });
  assert.equal(early.status, 403);

  // 2. Approve the merchant
  await ops.ok('POST', `/v1/ops/merchants/${mid}/approve`, { commissionBps: 900 });

  // 3. Create a product + offer with inventory, and an offer on an existing product
  const product = await merchant.ok<any>('POST', `/v1/merchants/${mid}/catalog/products`, {
    nameAr: 'فحمات خلفية — كامري', nameEn: 'Rear brake pads — Camry', categoryId: 'brakes', brand: 'TestBrand', origin: 'AFTERMARKET', partNumber: 'TB-REAR-001',
    oemReferences: ['04466-33200'], weightGrams: 1800, lengthCm: 20, widthCm: 15, heightCm: 6,
    fitment: [{ modelId: 'camry', yearFrom: 2018, yearTo: 2025, engines: [] }],
  });
  assert.equal(product.fitments[0].source, 'SELLER');
  const newOffer = await merchant.ok<any>('POST', `/v1/merchants/${mid}/offers`, { productId: product.id, locationId: loc.id, sku: 'TB-1', priceHalalas: 15000, stock: 6, dispatchDaysMax: 1 });
  const camryPads = await merchant.ok<any>('POST', `/v1/merchants/${mid}/offers`, { productId: 'p-camry-pads-oem', locationId: loc.id, sku: 'TB-2', priceHalalas: 37900, stock: 3 });
  assert.equal(newOffer.inventory.onHand, 6);

  // 4. Customer signs in and selects a vehicle
  const c = await customer(app);
  const vehicle = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4' });
  const incompatible = await c.post('/v1/me/vehicles', { modelId: 'camry', year: 2010, trim: 'GLE', engine: '2.5L I4' });
  assert.equal(incompatible.status, 400);
  const address = await addAddress(c, 'riyadh');

  // 5. Search compatible parts (vehicle-aware) — the new product appears; a Patrol-only part does not
  const results = await c.ok<any>('GET', `/v1/catalog/products?q=${encodeURIComponent('فحمات')}&fitsOnly=true&modelId=camry&year=2022&engine=${encodeURIComponent('2.5L I4')}`);
  const ids = results.items.map((p: any) => p.id);
  assert.ok(ids.includes(product.id), 'new merchant product is searchable');
  assert.ok(ids.includes('p-camry-pads-oem'));
  const patrolOnly = await c.ok<any>('GET', `/v1/catalog/products?q=radiator&fitsOnly=true&modelId=camry&year=2022`);
  assert.ok(!patrolOnly.items.some((p: any) => p.id === 'p-patrol-radiator'), 'incompatible part excluded');
  const byPartNumber = await c.ok<any>('GET', `/v1/catalog/products?q=04466-33200`);
  assert.equal(byPartNumber.items[0].id, product.id, 'OEM cross-reference search');

  // 6. Compare merchants for one product
  const detail = await c.ok<any>('GET', '/v1/catalog/products/p-camry-pads-oem');
  assert.ok(detail.product.offers.length >= 3);
  assert.ok(detail.sellers.some((s: any) => s.id === mid));
  assert.equal(detail.product.rating, null, 'no invented ratings');

  // 7–8. Multi-merchant cart + shipping-aware plan
  const lines = [
    { offerId: newOffer.id, quantity: 2 }, // Test Spares, Riyadh
    { offerId: 'o-014', quantity: 1 }, // existing merchant
  ];
  await c.ok('PUT', '/v1/me/cart', { lines: lines.map((l) => ({ offerId: l.offerId, qty: l.quantity })) });
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: address.id, lines });
  const selected = plan.options.find((o: any) => o.strategy === 'selected');
  assert.ok(selected, JSON.stringify(plan));
  assert.ok(selected.sandboxRates, 'quotes are labelled sandbox');
  assert.equal(selected.totalHalalas, selected.itemsHalalas + selected.shippingHalalas);
  assert.ok(selected.groups.length >= 2, 'two merchants → at least two shipping groups');
  for (const o of plan.options) assert.ok(o.bestFor.length >= 1);

  // 9. Checkout + sandbox payment (verified webhook only)
  const order = await c.ok<any>('POST', '/v1/checkout', { planId: selected.planId, idempotencyKey: 'e2e-order-0001', paymentMethod: 'mada' });
  assert.equal(order.status, 'PENDING_PAYMENT');
  assert.ok(order.payment.redirectUrl.includes('/sandbox/pay/'));
  const replay = await c.ok<any>('POST', '/v1/checkout', { planId: selected.planId, idempotencyKey: 'e2e-order-0001', paymentMethod: 'mada' });
  assert.equal(replay.orderId, order.orderId, 'checkout is idempotent');
  const reserved = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: newOffer.id } });
  assert.equal(reserved.reserved, 2);

  await payOnSandboxPage(app, order.payment.redirectUrl);
  let view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'PAID');
  const level = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: newOffer.id } });
  assert.deepEqual([level.onHand, level.reserved], [4, 0], 'stock committed on verified payment');

  // Duplicate provider webhook (same event id) is ignored
  const evt = await prisma.paymentEvent.findFirstOrThrow({ where: { type: 'payment.captured' } });
  const dup = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/sandbox',
    payload: JSON.stringify(evt.payload),
    headers: { 'content-type': 'application/json', 'x-qitah-sandbox-signature': (await import('../src/providers/payment/sandbox.js')).signSandboxPayload(process.env.PAYMENT_WEBHOOK_SECRET!, JSON.stringify(evt.payload)) },
  });
  assert.equal(dup.json().outcome, 'duplicate');
  assert.equal(await prisma.ledgerPosting.count({ where: { type: 'PAYMENT_CAPTURED' } }), 1);

  // 10. Merchant suborders generated; merchants see only their own
  const mos = await prisma.merchantOrder.findMany({ where: { orderId: order.orderId } });
  assert.equal(mos.length, 2);
  const mine = await merchant.ok<any>('GET', `/v1/merchants/${mid}/orders?status=NEW`);
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].order.addressSnapshot.street, undefined, 'full address hidden before acceptance');
  const myMo = mine.items[0];

  // 11. Prepare shipments (both merchants)
  for (const step of ['accept', 'pack', 'ready']) await merchant.ok('POST', `/v1/merchants/${mid}/orders/${myMo.id}/${step}`);
  const otherMo = mos.find((m) => m.merchantId !== mid)!;
  const otherOwner = await prisma.merchantMember.findFirstOrThrow({ where: { merchantId: otherMo.merchantId, role: 'OWNER' }, include: { user: true } });
  const other = await login(app, otherOwner.user.email!);
  for (const step of ['accept', 'pack', 'ready']) await other.ok('POST', `/v1/merchants/${otherMo.merchantId}/orders/${otherMo.id}/${step}`);
  view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'IN_FULFILLMENT');

  // 12–15. Sandbox labels → pickup → tracking → delivery
  const queue = await ops.ok<any>('GET', '/v1/ops/shipments?status=PENDING');
  const shipments = queue.items.filter((s: any) => s.order.id === order.orderId);
  assert.equal(shipments.length, selected.groups.length);
  for (const s of shipments) {
    const labelled = await ops.ok<any>('POST', `/v1/ops/shipments/${s.id}/label`);
    assert.match(labelled.trackingNumber, /^SBX\d{10}$/);
    const label = await app.inject({ method: 'GET', url: new URL(labelled.labelUrl).pathname });
    assert.ok(label.body.includes('SANDBOX LABEL'));
    await ops.ok('POST', `/v1/ops/shipments/${s.id}/pickup`, { windowStart: new Date(Date.now() + 3600e3).toISOString(), windowEnd: new Date(Date.now() + 7200e3).toISOString() });
    for (const status of ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']) await ops.ok('POST', `/v1/ops/shipments/${s.id}/sandbox-event`, { status });
  }
  view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'SHIPPED');
  for (const s of shipments) await ops.ok('POST', `/v1/ops/shipments/${s.id}/sandbox-event`, { status: 'DELIVERED' });
  view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'DELIVERED');
  assert.ok(view.shipmentGroups.every((g: any) => g.shipment.events.map((e: any) => e.status).join('>') === 'LABEL_CREATED>PICKUP_SCHEDULED>PICKED_UP>IN_TRANSIT>OUT_FOR_DELIVERY>DELIVERED'));
  const notes = await c.ok<any>('GET', '/v1/me/notifications');
  assert.ok(notes.notifications.some((n: any) => n.type === 'shipment.status'));

  // 16. Customer initiates a return of one unit of the new product
  const item = view.items.find((i: any) => i.offerId === newOffer.id);
  view = await c.ok<any>('POST', `/v1/orders/${order.orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged', note: 'cracked' });
  const rc = view.returns[0];
  assert.equal(rc.status, 'REQUESTED');
  await merchant.ok('POST', `/v1/merchants/${mid}/returns/${rc.id}/approve`, {});
  const returnShipment = await prisma.shipment.findFirstOrThrow({ where: { returnCaseId: rc.id } });
  assert.equal(returnShipment.direction, 'RETURN');
  await ops.ok('POST', `/v1/ops/shipments/${returnShipment.id}/label`);
  await ops.ok('POST', `/v1/ops/shipments/${returnShipment.id}/pickup`, { windowStart: new Date(Date.now() + 3600e3).toISOString(), windowEnd: new Date(Date.now() + 7200e3).toISOString() });
  await ops.ok('POST', `/v1/ops/shipments/${returnShipment.id}/sandbox-event`, { status: 'PICKED_UP' });
  assert.equal((await prisma.returnCase.findUniqueOrThrow({ where: { id: rc.id } })).status, 'IN_TRANSIT');
  await ops.ok('POST', `/v1/ops/shipments/${returnShipment.id}/sandbox-event`, { status: 'DELIVERED' });
  assert.equal((await prisma.returnCase.findUniqueOrThrow({ where: { id: rc.id } })).status, 'RECEIVED');

  // 17. Inspection → partial refund (restocking) → sandbox refund settles via signed webhook
  const inspected = await merchant.ok<any>('POST', `/v1/merchants/${mid}/returns/${rc.id}/inspect`, { accept: true, restock: true, refundHalalas: 12000, note: 'minor wear' });
  assert.equal(inspected.refunds[0].status, 'PENDING');
  assert.equal((await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: newOffer.id } })).onHand, 5, 'restocked');
  const settled = await settleSandboxRefunds(ops);
  assert.equal(settled.settled, 1);
  view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.returns[0].status, 'REFUNDED');
  assert.equal(view.totals.refundedHalalas, 12000);
  assert.equal(view.refunds[0].status, 'SUCCEEDED');

  // 18. Reconcile + settlement ledger
  const trace = await ops.ok<any>('GET', `/v1/ops/orders/${order.orderId}`);
  assert.equal(trace.reconciliation.reconciled, true, JSON.stringify(trace.reconciliation.issues));
  assert.equal(trace.reconciliation.netCollectedHalalas, view.totals.totalHalalas - 12000);
  assert.ok(trace.auditTrail.some((a: any) => a.action === 'payment.captured'));
  assert.ok(trace.auditTrail.some((a: any) => a.action === 'return.inspection_accepted'));

  const s = await finance.ok<any>('POST', '/v1/ops/settlements/generate', { merchantId: mid, asOf: new Date(Date.now() + 8 * 86400e3).toISOString() });
  const mo = await prisma.merchantOrder.findUniqueOrThrow({ where: { id: myMo.id } });
  const commissionAfterRefund = mo.commissionHalalas - Math.floor((12000 * 900 + 5000) / 10000);
  assert.equal(s.grossHalalas, 30000);
  assert.equal(s.commissionHalalas, commissionAfterRefund);
  assert.equal(s.netHalalas, 30000 - 12000 - commissionAfterRefund);
  await finance.ok('POST', `/v1/ops/settlements/${s.id}/approve`);
  await finance.ok('POST', `/v1/ops/settlements/${s.id}/paid`, { payoutReference: 'SANDBOX-TRANSFER-1' });
  const balance = await merchant.ok<any>('GET', `/v1/merchants/${mid}/settlements`);
  assert.equal(balance.balance.payableHalalas, 0);
  assert.equal(balance.balance.paidOutHalalas, s.netHalalas);

  // Global ledger balances to zero
  const total = await prisma.ledgerEntry.aggregate({ _sum: { amountHalalas: true } });
  assert.equal(total._sum.amountHalalas, 0);
  void vehicle;
  void camryPads;
  void sendPaymentEvent;
});
