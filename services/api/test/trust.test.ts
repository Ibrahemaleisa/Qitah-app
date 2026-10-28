import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp } from '../src/app.js';
import { estimateDelivery, riyadhDate, riyadhMinutes, sameDayEligible } from '../src/domain/delivery.js';
import { evaluateFit, type FitmentRow } from '../src/domain/fit.js';
import { reconcileOrder } from '../src/services/finance.js';
import { outboundShippingShare, returnShippingPayer } from '../src/services/trust.js';
import { Client, addAddress, config, customer, fulfil, login, payOnSandboxPage, prisma, resetDatabase, settleSandboxRefunds, startApp, uploadReturnPhoto } from './helpers.js';

/** Trust layer: fit guarantee (ضمان قطعة), delivered price + same-day promise, fair returns. */
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

// 11:00 and 15:00 Riyadh time (UTC+3) on the same day.
const BEFORE_CUTOFF = new Date('2026-10-28T08:00:00Z');
const AFTER_CUTOFF = new Date('2026-10-28T12:00:00Z');

async function placeWithVehicle(c: Client, addressId: string, lines: { offerId: string; quantity: number }[], vehicle?: unknown) {
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId, lines });
  const option = plan.options.find((o: any) => o.strategy === 'selected');
  assert.ok(option, JSON.stringify(plan));
  const order = await c.ok<any>('POST', '/v1/checkout', { planId: option.planId, idempotencyKey: randomUUID(), paymentMethod: 'mada', ...(vehicle ? { vehicle } : {}) });
  await payOnSandboxPage(app, order.payment.redirectUrl);
  return order.orderId as string;
}

async function runReturnShipment(returnCaseId: string) {
  const sh = await prisma.shipment.findFirstOrThrow({ where: { returnCaseId, direction: 'RETURN' } });
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/label`);
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/pickup`, { windowStart: new Date(Date.now() + 3600e3).toISOString(), windowEnd: new Date(Date.now() + 7200e3).toISOString() });
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/sandbox-event`, { status: 'PICKED_UP' });
  await ops.ok('POST', `/v1/ops/shipments/${sh.id}/sandbox-event`, { status: 'DELIVERED' });
  return prisma.shipment.findUniqueOrThrow({ where: { id: sh.id } });
}

const ownerOf = async (merchantId: string) => {
  const owner = await prisma.merchantMember.findFirstOrThrow({ where: { merchantId, role: 'OWNER' }, include: { user: true } });
  return login(app, owner.user.email!);
};

test('guarantee eligibility: catalog fitment vs seller fitment vs no vehicle vs by-spec', () => {
  const catalog: FitmentRow = { id: 'f1', modelId: 'camry', yearFrom: 2018, yearTo: 2025, engines: [], source: 'CATALOG' };
  const seller: FitmentRow = { id: 'f2', modelId: 'hilux', yearFrom: 2016, yearTo: 2025, engines: [], source: 'SELLER' };
  const engineOnly: FitmentRow = { id: 'f3', modelId: 'camry', yearFrom: 2018, yearTo: 2025, engines: ['3.5L V6'], source: 'CATALOG' };
  const camry = { modelId: 'camry', year: 2022, engine: '2.5L I4' };
  assert.deepEqual(evaluateFit({ universalNoteAr: null, fitments: [catalog] }, camry), { status: 'catalogMatch', guaranteed: true, fitmentIds: ['f1'] });
  assert.deepEqual(evaluateFit({ universalNoteAr: null, fitments: [seller] }, { modelId: 'hilux', year: 2020, engine: '2.7L I4' }), { status: 'sellerReported', guaranteed: false, fitmentIds: ['f2'] });
  assert.deepEqual(evaluateFit({ universalNoteAr: null, fitments: [catalog] }, null), { status: 'noData', guaranteed: false, fitmentIds: [] });
  assert.equal(evaluateFit({ universalNoteAr: null, fitments: [engineOnly] }, camry).status, 'noData', 'engine-specific fitment must match the engine');
  assert.equal(evaluateFit({ universalNoteAr: null, fitments: [catalog] }, { ...camry, year: 2016 }).guaranteed, false, 'year outside range');
  assert.deepEqual(evaluateFit({ universalNoteAr: 'by spec', fitments: [] }, null), { status: 'bySpecification', guaranteed: true, fitmentIds: [] });
  // Return-shipping payer rules
  assert.equal(returnShippingPayer('wrongPart', true, ['catalogMatch']), 'PLATFORM');
  assert.equal(returnShippingPayer('wrongPart', false, ['sellerReported']), 'MERCHANT');
  assert.equal(returnShippingPayer('wrongPart', false, ['noData']), 'CUSTOMER');
  assert.equal(returnShippingPayer('damaged', false, []), 'MERCHANT');
  assert.equal(returnShippingPayer('changedMind', true, ['catalogMatch']), 'CUSTOMER');
  // Outbound share by value, pro-rated by quantity
  const group = { quotedHalalas: 1500, items: [{ id: 'a', lineTotalHalalas: 2000 }, { id: 'b', lineTotalHalalas: 1000 }] };
  assert.equal(outboundShippingShare(group, 'a', 2, 2), 1000);
  assert.equal(outboundShippingShare(group, 'a', 1, 2), 500);
  assert.equal(outboundShippingShare(group, 'b', 1, 1), 500);
});

test('fitSnapshot is computed server-side per line and ignores client fit claims', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const patrol = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'patrol', year: 2020, trim: 'LE', engine: '4.0L V6', vin: 'JN8AY2NY1L9123456' });
  const hilux = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'hilux', year: 2020, trim: 'GL', engine: '2.7L I4' });

  // Someone else's vehicle can't be used.
  const other = await customer(app);
  const foreign = await other.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4' });
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-101', quantity: 1 }] });
  const bad = await c.post('/v1/checkout', { planId: plan.options[0].planId, idempotencyKey: randomUUID(), paymentMethod: 'mada', vehicle: { garageVehicleId: foreign.id } });
  assert.equal(bad.status, 404);

  const orderId = await placeWithVehicle(
    c,
    addr.id,
    [
      { offerId: 'o-101', quantity: 1 }, // Patrol cabin filter: CATALOG fitment
      { offerId: 'o-106', quantity: 1 }, // Hilux rear shock: SELLER fitment
      { offerId: 'o-107', quantity: 1 }, // Coolant: by specification
      { offerId: 'o-001', quantity: 1 }, // Camry pads: no fitment for a Patrol
    ],
    {
      garageVehicleId: patrol.id,
      lines: [{ offerId: 'o-106', garageVehicleId: hilux.id }],
      // Client claims are not part of the contract and must be ignored.
      status: 'catalogMatch',
      guaranteed: true,
    },
  );
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  const fit = (offerId: string) => items.find((i) => i.offerId === offerId)!.fitSnapshot as any;
  assert.equal(fit('o-101').status, 'catalogMatch');
  assert.equal(fit('o-101').guaranteed, true);
  assert.equal(fit('o-101').vin, 'JN8AY2NY1L9123456');
  assert.equal(fit('o-101').vehicle.garageVehicleId, patrol.id);
  assert.equal(fit('o-101').fitmentIds.length, 1);
  assert.equal(fit('o-106').status, 'sellerReported');
  assert.equal(fit('o-106').guaranteed, false);
  assert.equal(fit('o-106').vehicle.modelId, 'hilux', 'per-line vehicle override');
  assert.equal(fit('o-107').status, 'bySpecification');
  assert.equal(fit('o-107').guaranteed, true);
  assert.equal(fit('o-001').status, 'noData');
  assert.equal(fit('o-001').guaranteed, false);

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal((order.vehicleSnapshot as any).modelId, 'patrol');
  assert.equal((order.vehicleSnapshot as any).vin, 'JN8AY2NY1L9123456');

  // Customer view exposes the guarantee; merchant view shows vehicle + VIN and flags unverified fits.
  const view = await c.ok<any>('GET', `/v1/orders/${orderId}`);
  assert.equal(view.items.find((i: any) => i.offerId === 'o-101').fit.guaranteed, true);
  const shockMo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId, merchantId: 's-eastern' } });
  const m = await ownerOf('s-eastern');
  const moView = await m.ok<any>('GET', `/v1/merchants/s-eastern/orders/${shockMo.id}`);
  assert.equal(moView.vehicle.vin, 'JN8AY2NY1L9123456');
  assert.equal(moView.fitNeedsConfirmation, true);
  assert.equal(moView.items[0].fit.status, 'sellerReported');

  // No vehicle at all: nothing vehicle-specific is guaranteed.
  const c2 = await customer(app);
  const a2 = await addAddress(c2, 'riyadh');
  const o2 = await placeWithVehicle(c2, a2.id, [{ offerId: 'o-101', quantity: 1 }]);
  const it2 = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o2 } });
  assert.deepEqual([(it2.fitSnapshot as any).status, (it2.fitSnapshot as any).guaranteed, (it2.fitSnapshot as any).vehicle], ['noData', false, null]);
});

test('wrongPart on a guaranteed line: auto-approved, Qitah pays return shipping, full refund incl. delivery, ledger reconciles', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const patrol = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'patrol', year: 2020, trim: 'LE', engine: '4.0L V6' });
  const orderId = await placeWithVehicle(c, addr.id, [{ offerId: 'o-101', quantity: 2 }], { garageVehicleId: patrol.id });
  await fulfil(app, ops, orderId);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  const group = await prisma.fulfillmentGroup.findUniqueOrThrow({ where: { id: item.fulfillmentGroupId } });

  const view = await c.ok<any>('POST', `/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 2 }], reason: 'wrongPart', note: 'لا تركب' });
  const r = view.returns[0];
  assert.equal(r.status, 'APPROVED', 'auto-approved without merchant decision');
  assert.equal(r.guaranteed, true);
  assert.equal(r.autoApproved, true);
  assert.equal(r.returnShipping.paidBy, 'PLATFORM');
  assert.ok(r.returnShipping.costHalalas > 0, 'real sandbox-quoted return cost');

  const shipment = await runReturnShipment(r.id);
  assert.equal((await prisma.returnCase.findUniqueOrThrow({ where: { id: r.id } })).status, 'RECEIVED');
  const labelPosting = await prisma.ledgerEntry.findMany({ where: { refId: shipment.id, postingType: 'RETURN_SHIPPING' } });
  assert.deepEqual(labelPosting.map((l) => [l.account, l.amountHalalas]).sort(), [['GUARANTEE_EXPENSE', shipment.costHalalas], ['SHIPPING_PAYABLE', -shipment.costHalalas]].sort());

  const mo = await prisma.merchantOrder.findUniqueOrThrow({ where: { id: item.merchantOrderId } });
  const m = await ownerOf(mo.merchantId);
  const partial = await m.post(`/v1/merchants/${mo.merchantId}/returns/${r.id}/inspect`, { accept: true, restock: true, refundHalalas: 100 });
  assert.equal(partial.status, 409, 'guarantee refunds are always full');
  assert.equal(partial.body.error.code, 'GUARANTEE_FULL_REFUND');
  // The failed inspect must not have consumed the one-time inspection.
  await m.ok('POST', `/v1/merchants/${mo.merchantId}/returns/${r.id}/inspect`, { accept: true, restock: true });
  await settleSandboxRefunds(ops);

  const refund = await prisma.refund.findFirstOrThrow({ where: { returnCaseId: r.id } });
  assert.equal(refund.status, 'SUCCEEDED');
  assert.equal(refund.amountHalalas, item.lineTotalHalalas + group.quotedHalalas, 'item value + full outbound shipping (only line in its group)');
  const after = await c.ok<any>('GET', `/v1/orders/${orderId}`);
  assert.equal(after.returns[0].status, 'REFUNDED');
  assert.equal(after.totals.refundedHalalas, refund.amountHalalas);

  const rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
  assert.equal(rec.guaranteeExpenseHalalas, group.quotedHalalas + shipment.costHalalas, 'guarantee cost = refunded delivery + return label');
  // Item value stays merchant-funded: merchant payable reversed by items − commission, commission reversed normally.
  const moLedger = await prisma.ledgerEntry.groupBy({ by: ['account'], where: { merchantOrderId: mo.id }, _sum: { amountHalalas: true } });
  const acct = (a: string) => moLedger.find((x) => x.account === a)?._sum.amountHalalas ?? 0;
  assert.equal(acct('MERCHANT_PAYABLE'), 0, 'fully returned suborder owes the merchant nothing');
  assert.equal(acct('PLATFORM_COMMISSION'), 0);
  const total = await prisma.ledgerEntry.aggregate({ _sum: { amountHalalas: true } });
  assert.equal(total._sum.amountHalalas, 0, 'global ledger balances');
});

test('wrongPart on a seller-reported fit follows the normal flow with merchant-paid return shipping', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const hilux = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'hilux', year: 2020, trim: 'GL', engine: '2.7L I4' });
  const orderId = await placeWithVehicle(c, addr.id, [{ offerId: 'o-106', quantity: 1 }], { garageVehicleId: hilux.id });
  await fulfil(app, ops, orderId);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  const view = await c.ok<any>('POST', `/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'wrongPart' });
  assert.equal(view.returns[0].status, 'REQUESTED');
  assert.equal(view.returns[0].guaranteed, false);
  const m = await ownerOf('s-eastern');
  await m.ok('POST', `/v1/merchants/s-eastern/returns/${view.returns[0].id}/approve`, {});
  const sh = await prisma.shipment.findFirstOrThrow({ where: { returnCaseId: view.returns[0].id } });
  assert.equal(sh.paidBy, 'MERCHANT');
  const done = await runReturnShipment(view.returns[0].id);
  const posting = await prisma.ledgerEntry.findMany({ where: { refId: done.id, postingType: 'RETURN_SHIPPING' } });
  assert.ok(posting.some((l) => l.account === 'MERCHANT_PAYABLE' && l.amountHalalas === done.costHalalas));
  await m.ok('POST', `/v1/merchants/s-eastern/returns/${view.returns[0].id}/inspect`, { accept: true, restock: false });
  await settleSandboxRefunds(ops);
  const refund = await prisma.refund.findFirstOrThrow({ where: { returnCaseId: view.returns[0].id } });
  assert.equal(refund.amountHalalas, item.lineTotalHalalas, 'item value only');
  const rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
});

test('damaged returns require at least one of the customer\'s own photos', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const orderId = await placeWithVehicle(c, addr.id, [{ offerId: 'o-001', quantity: 1 }]);
  await fulfil(app, ops, orderId);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  const none = await c.post(`/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged' });
  assert.equal(none.status, 400);
  assert.equal(none.body.error.code, 'PHOTO_REQUIRED');
  const other = await customer(app);
  const foreignKey = await uploadReturnPhoto(other);
  const stolen = await c.post(`/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged', photoKeys: [foreignKey] });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.error.code, 'INVALID_PHOTO');
  assert.equal((await c.get(`/v1/me/uploads?key=${encodeURIComponent(foreignKey)}`)).status, 404, "cannot read another customer's upload");
  const key = await uploadReturnPhoto(c);
  const ok = await c.ok<any>('POST', `/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged', photoKeys: [key] });
  assert.equal(ok.returns[0].photoCount, 1);
  const opsReturns = await ops.ok<any>('GET', '/v1/ops/returns?status=REQUESTED');
  const mine = opsReturns.items.find((x: any) => x.id === ok.returns[0].id);
  assert.equal(mine.photos.length, 1);
  const photo = await app.inject({ method: 'GET', url: new URL(mine.photos[0].url).pathname + new URL(mine.photos[0].url).search });
  assert.equal(photo.statusCode, 200, 'signed URL serves the photo');
});

test('changedMind: unopened only, and the customer pays the return label out of the refund', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const orderId = await placeWithVehicle(c, addr.id, [{ offerId: 'o-001', quantity: 1 }]);
  await fulfil(app, ops, orderId);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  const opened = await c.post(`/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'changedMind' });
  assert.equal(opened.status, 400);
  assert.equal(opened.body.error.code, 'UNOPENED_REQUIRED');
  const view = await c.ok<any>('POST', `/v1/orders/${orderId}/returns`, { items: [{ orderItemId: item.id, quantity: 1 }], reason: 'changedMind', unopened: true });
  const rc = view.returns[0];
  const mo = await prisma.merchantOrder.findUniqueOrThrow({ where: { id: item.merchantOrderId } });
  const m = await ownerOf(mo.merchantId);
  await m.ok('POST', `/v1/merchants/${mo.merchantId}/returns/${rc.id}/approve`, {});
  const sh = await runReturnShipment(rc.id);
  assert.equal(sh.paidBy, 'CUSTOMER');
  assert.ok(sh.costHalalas > 0);
  await m.ok('POST', `/v1/merchants/${mo.merchantId}/returns/${rc.id}/inspect`, { accept: true, restock: true });
  await settleSandboxRefunds(ops);
  const refund = await prisma.refund.findFirstOrThrow({ where: { returnCaseId: rc.id } });
  assert.equal(refund.amountHalalas, item.lineTotalHalalas - sh.costHalalas, 'return shipping deducted');
  const rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
  // The deducted amount is now owed to the carrier, and no guarantee cost was booked.
  const ledger = await prisma.ledgerEntry.findMany({ where: { refId: refund.id } });
  assert.ok(ledger.some((l) => l.account === 'SHIPPING_PAYABLE' && l.amountHalalas === -sh.costHalalas));
  assert.equal(rec.guaranteeExpenseHalalas, 0);
});

test('delivery estimates: same-city same-day before cutoff, not after, never cross-region', async () => {
  const at = (now: Date) => buildApp(config, { clock: () => now });
  assert.equal(riyadhMinutes(BEFORE_CUTOFF), 11 * 60);
  assert.equal(riyadhDate(new Date('2026-10-28T22:00:00Z')), '2026-10-29', 'Riyadh date rolls over at 21:00 UTC');
  assert.equal(sameDayEligible(BEFORE_CUTOFF, 840, 1), false, 'merchant must be able to dispatch today');

  const early = await at(BEFORE_CUTOFF);
  const anon = new Client(early);
  const r1 = await anon.ok<any>('GET', '/v1/catalog/delivery-estimates?offerIds=o-001,o-107,missing&city=riyadh');
  assert.equal(r1.estimates.length, 2, 'unknown offers are skipped');
  const e1 = r1.estimates.find((e: any) => e.offerId === 'o-001');
  assert.equal(e1.sameDayAvailable, true);
  assert.equal(e1.cutoffLocal, '14:00');
  assert.equal(e1.fastest.service, 'sameDay');
  assert.equal(e1.fastest.arrivesBy, '2026-10-28');
  assert.equal(e1.cheapest.service, 'standard');
  assert.equal(e1.cheapest.amountHalalas, 1500 + 150 * 2, 'pads billed at 3 kg volumetric-or-actual');
  assert.equal(e1.estimate, true);
  // The checkout plan offers same-day too.
  const c = await customer(early);
  const addr = await addAddress(c, 'riyadh');
  const planEarly = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-001', quantity: 1 }] });
  assert.ok(planEarly.options.some((o: any) => o.groups.some((g: any) => g.serviceCode === 'sameDay')));
  await early.close();

  const late = await at(AFTER_CUTOFF);
  const r2 = await new Client(late).ok<any>('GET', '/v1/catalog/delivery-estimates?offerIds=o-001&city=riyadh');
  assert.equal(r2.estimates[0].sameDayAvailable, false);
  assert.notEqual(r2.estimates[0].fastest.service, 'sameDay');
  const c2 = await customer(late);
  const addr2 = await addAddress(c2, 'riyadh');
  const planLate = await c2.ok<any>('POST', '/v1/checkout/plan', { addressId: addr2.id, lines: [{ offerId: 'o-001', quantity: 1 }] });
  assert.ok(planLate.options.every((o: any) => o.groups.every((g: any) => g.serviceCode !== 'sameDay')), 'no same-day promise after cutoff');

  // A later per-location cutoff (20:00) keeps same-day open at 15:00.
  const o001 = await prisma.offer.findUniqueOrThrow({ where: { id: 'o-001' } });
  const m = await ownerOf(o001.merchantId);
  await m.ok('PATCH', `/v1/merchants/${o001.merchantId}/locations/${o001.locationId}`, { sameDayCutoffMinutes: 20 * 60 });
  const r3 = await new Client(late).ok<any>('GET', '/v1/catalog/delivery-estimates?offerIds=o-001&city=riyadh');
  assert.equal(r3.estimates[0].sameDayAvailable, true);
  assert.equal(r3.estimates[0].cutoffLocal, '20:00');
  await m.ok('PATCH', `/v1/merchants/${o001.merchantId}/locations/${o001.locationId}`, { sameDayCutoffMinutes: 14 * 60 });

  // Cross-region (Riyadh → Jeddah): no same-day; days include dispatch.
  const r4 = await new Client(late).ok<any>('GET', '/v1/catalog/delivery-estimates?offerIds=o-001&city=jeddah');
  const e4 = r4.estimates[0];
  assert.equal(e4.sameDayAvailable, false);
  assert.deepEqual([e4.cheapest.service, e4.cheapest.etaDaysMin, e4.cheapest.etaDaysMax], ['standard', 0 + 3, 1 + 5]);
  assert.equal(e4.cheapest.arrivesBy, '2026-11-03');
  assert.deepEqual([e4.fastest.service, e4.fastest.etaDaysMax], ['express', 1 + 4]);
  await late.close();

  // Pure estimator: invalid city is a 400, not a guess.
  assert.equal((await new Client(app).get('/v1/catalog/delivery-estimates?offerIds=o-001&city=tabuk')).status, 400);
  assert.equal(estimateDelivery({ rates: [], dispatchDaysMin: 0, dispatchDaysMax: 1, cutoffMinutes: 840, now: BEFORE_CUTOFF }).cheapest, null);
});

test('return policy is published before purchase', async () => {
  const p = await new Client(app).ok<any>('GET', '/v1/catalog/return-policy');
  assert.equal(p.windowDays, config.RETURN_WINDOW_DAYS);
  assert.equal(p.reasons.wrongPart.guaranteed.shippingPaidBy, 'PLATFORM');
  assert.equal(p.reasons.changedMind.unopenedOnly, true);
  assert.equal(p.reasons.damaged.photosRequired, 1);
});
