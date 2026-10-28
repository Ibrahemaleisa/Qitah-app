import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { customerPhotoPrefix, expirePartRequests } from '../src/services/partRequests.js';
import { addAddress, Client, customer, login, payOnSandboxPage, placeOrder, prisma, resetDatabase, startApp } from './helpers.js';

/**
 * Part requests ("اطلب قطعة" / RFQ) end to end: customer request with a photo → two merchants quote →
 * isolation between merchants → accept → private offer → plan + checkout + sandbox payment → merchant order.
 * Plus: private offers never leak into the public catalog or other users' plans, expiry, and access control.
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

// Ford Taurus delivered to Riyadh. Matching rule: riyadh-center + salvage (Riyadh city), eastern (sells parts
// fitting Ford). brake-house (Jeddah, no Ford parts) must not see it.
const TAURUS = { modelId: 'taurus', year: 2021, trim: 'Trend', engine: '1.5L EcoBoost' };

async function merchantClient(slug: string) {
  return login(app, `owner@${slug}.qitah.test`);
}

async function uploadPhoto(c: Client, path: string, purpose: string, body: Record<string, unknown> = {}) {
  const up = await c.ok<any>('POST', path, { purpose, contentType: 'image/png', sizeBytes: 8, fileName: 'part photo.png', ...body });
  const url = new URL(up.uploadUrl);
  const put = await app.inject({ method: 'PUT', url: url.pathname + url.search, payload: Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), headers: { 'content-type': 'image/png' } });
  assert.equal(put.statusCode, 200, put.body);
  return up.key as string;
}

async function newRequest(c: Client, vehicleId: string, addressId: string, extra: Record<string, unknown> = {}) {
  return c.ok<any>('POST', '/v1/me/part-requests', { vehicleId, addressId, description: 'حساس أكسجين خلفي — ما لقيته بالكتالوج', preferredCondition: 'ANY', preferredOrigin: 'ANY', ...extra });
}

test('request → two quotes → isolation → accept → private offer → checkout → merchant order', async () => {
  const anon = new Client(app);
  const c = await customer(app);
  const vehicle = await c.ok<any>('POST', '/v1/me/vehicles', TAURUS);
  const address = await addAddress(c, 'riyadh');

  // Photo uploads are customer-scoped, image-only, signed.
  assert.equal((await c.post('/v1/me/uploads', { purpose: 'part-request', contentType: 'application/pdf', sizeBytes: 9, fileName: 'x.pdf' })).status, 400);
  assert.equal((await anon.post('/v1/me/uploads', { purpose: 'part-request', contentType: 'image/png', sizeBytes: 9, fileName: 'x.png' })).status, 401);
  const photoKey = await uploadPhoto(c, '/v1/me/uploads', 'part-request');
  assert.ok(photoKey.startsWith(customerPhotoPrefix(c.userId)) && !photoKey.includes(c.userId), 'opaque customer folder');
  const forged = await c.post('/v1/me/part-requests', { vehicleId: vehicle.id, addressId: address.id, description: 'x', photoKeys: ['merchants/s-eastern/verification/a.pdf'] });
  assert.equal(forged.status, 400, 'photo keys must belong to the customer');

  const created = await newRequest(c, vehicle.id, address.id, { partNumber: 'DG9Z-9G444-A', photoKeys: [photoKey] });
  assert.equal(created.status, 'OPEN');
  assert.equal(created.city, 'riyadh');
  assert.equal(created.vehicle.modelId, 'taurus');
  assert.equal(created.photos.length, 1);
  assert.match(created.photos[0].url, /\/v1\/uploads\/local\?/);
  assert.equal(created.firstQuotedAt, null);
  const requestId = created.id as string;

  const riyadh = await merchantClient('riyadh-center');
  const salvage = await merchantClient('salvage');
  const eastern = await merchantClient('eastern');
  const brakeHouse = await merchantClient('brake-house');

  // Inbox matching (city or make).
  for (const [m, mid] of [[riyadh, 's-riyadh-center'], [salvage, 's-salvage'], [eastern, 's-eastern']] as const) {
    const inbox = await m.ok<any>('GET', `/v1/merchants/${mid}/part-requests`);
    assert.ok(inbox.items.some((r: any) => r.id === requestId), `${mid} sees the request`);
  }
  const notMine = await brakeHouse.ok<any>('GET', '/v1/merchants/s-brake-house/part-requests');
  assert.ok(!notMine.items.some((r: any) => r.id === requestId), 'non-matching merchant does not see it');
  assert.equal((await brakeHouse.get(`/v1/merchants/s-brake-house/part-requests/${requestId}`)).status, 404);
  assert.equal((await brakeHouse.post(`/v1/merchants/s-brake-house/part-requests/${requestId}/quote`, { condition: 'NEW', priceSar: '10', partName: 'Sensor', brand: 'Bosch', locationId: 'loc-bh-jeddah' })).status, 404);
  assert.equal((await brakeHouse.get(`/v1/merchants/s-salvage/part-requests/${requestId}`)).status, 403, 'cannot act as another merchant');
  assert.ok((await merchantNotifications(salvage, 's-salvage')).some((n: any) => n.type === 'part_request.created'), 'matching merchant notified');

  // Merchant detail: photos as signed URLs, no customer identity.
  const detail = await salvage.ok<any>('GET', `/v1/merchants/s-salvage/part-requests/${requestId}`);
  assert.equal(detail.photos.length, 1);
  const photo = await app.inject({ method: 'GET', url: new URL(detail.photos[0].url).pathname + new URL(detail.photos[0].url).search });
  assert.equal(photo.statusCode, 200);
  assert.equal(photo.headers['cross-origin-resource-policy'], 'cross-origin', 'signed photo URLs can be embedded by the app and portals');
  assert.ok(!JSON.stringify(detail).includes(c.phone) && !JSON.stringify(detail).includes(c.userId), 'customer contact hidden from merchants');

  // Quote 1: riyadh-center links a catalog product, price as SAR string.
  const q1 = await riyadh.ok<any>('POST', `/v1/merchants/s-riyadh-center/part-requests/${requestId}/quote`, {
    productId: 'p-toyota-oil-filter', condition: 'NEW', priceSar: '149.50', warrantyMonths: 6, dispatchDaysMin: 0, dispatchDaysMax: 1, locationId: 'loc-rc-olaya',
  });
  assert.equal(q1.priceHalalas, 14950);
  const afterFirst = await prisma.partRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert.equal(afterFirst.status, 'QUOTED');
  assert.ok(afterFirst.firstQuotedAt, 'firstQuotedAt recorded');
  const dup = await riyadh.post(`/v1/merchants/s-riyadh-center/part-requests/${requestId}/quote`, { productId: 'p-toyota-oil-filter', condition: 'NEW', priceSar: '1', locationId: 'loc-rc-olaya' });
  assert.equal(dup.status, 409, 'one quote per merchant per request');
  assert.equal((await riyadh.post(`/v1/merchants/s-riyadh-center/part-requests/${requestId}/quote`, { condition: 'NEW', priceSar: '1', partName: 'Sensor', locationId: 'loc-sv-riyadh' })).status, 409);

  // Quote 2: salvage, free-text used part with a photo of the actual part; location must be its own.
  const badLoc = await salvage.post(`/v1/merchants/s-salvage/part-requests/${requestId}/quote`, { partName: 'حساس أكسجين', brand: 'Motorcraft', condition: 'USED', priceSar: '80', locationId: 'loc-rc-olaya' });
  assert.equal(badLoc.status, 400);
  const partPhoto = await uploadPhoto(salvage, '/v1/merchants/s-salvage/uploads', 'part-quote');
  const q2 = await salvage.ok<any>('POST', `/v1/merchants/s-salvage/part-requests/${requestId}/quote`, {
    partName: 'حساس أكسجين خلفي', brand: 'Motorcraft', partNumber: 'DG9Z-9G444-A', origin: 'OEM', condition: 'USED', priceSar: '85', warrantyMonths: 1,
    dispatchDaysMin: 0, dispatchDaysMax: 1, locationId: 'loc-sv-riyadh', photoKey: partPhoto, note: 'مفحوص ويعمل', validHours: 24,
  });
  const firstQuotedAt = (await prisma.partRequest.findUniqueOrThrow({ where: { id: requestId } })).firstQuotedAt;
  assert.deepEqual(firstQuotedAt, afterFirst.firstQuotedAt, 'firstQuotedAt is set once');

  // Eastern quotes, edits and withdraws (before acceptance).
  await eastern.ok('POST', `/v1/merchants/s-eastern/part-requests/${requestId}/quote`, { partName: 'Oxygen sensor', brand: 'Bosch', condition: 'NEW', priceHalalas: 30000, locationId: 'loc-ea-dammam' });
  const edited = await eastern.ok<any>('PATCH', `/v1/merchants/s-eastern/part-requests/${requestId}/quote`, { priceSar: '275.5', dispatchDaysMax: 3 });
  assert.equal(edited.priceHalalas, 27550);
  const withdrawn = await eastern.ok<any>('POST', `/v1/merchants/s-eastern/part-requests/${requestId}/quote/withdraw`);
  assert.equal(withdrawn.status, 'WITHDRAWN');
  assert.equal((await eastern.patch(`/v1/merchants/s-eastern/part-requests/${requestId}/quote`, { priceSar: '1' })).status, 409, 'withdrawn quote is locked');

  // Customer sees both active quotes (not the withdrawn one), with merchant, price, condition, photo.
  const seen = await c.ok<any>('GET', `/v1/me/part-requests/${requestId}`);
  assert.equal(seen.status, 'QUOTED');
  assert.deepEqual(seen.quotes.map((q: any) => q.id).sort(), [q1.id, q2.id].sort());
  const sq2 = seen.quotes.find((q: any) => q.id === q2.id);
  assert.equal(sq2.merchant.id, 's-salvage');
  assert.equal(sq2.condition, 'used');
  assert.equal(sq2.part.brand, 'Motorcraft');
  assert.ok(sq2.photoUrl);
  assert.equal(seen.quotes.find((q: any) => q.id === q1.id).part.productId, 'p-toyota-oil-filter');
  assert.ok((await c.ok<any>('GET', '/v1/me/notifications')).notifications.some((n: any) => n.type === 'part_request.quote'), 'customer notified of quotes');
  const list = await c.ok<any>('GET', '/v1/me/part-requests');
  assert.equal(list.requests[0].quoteCount, 2);
  assert.equal(list.requests[0].bestPriceHalalas, 8500);

  // Merchants never see each other's quotes or prices.
  const rView = JSON.stringify(await riyadh.ok<any>('GET', `/v1/merchants/s-riyadh-center/part-requests/${requestId}`));
  const rInbox = JSON.stringify(await riyadh.ok<any>('GET', '/v1/merchants/s-riyadh-center/part-requests'));
  const rQuotes = JSON.stringify(await riyadh.ok<any>('GET', '/v1/merchants/s-riyadh-center/part-quotes'));
  for (const blob of [rView, rInbox, rQuotes]) {
    assert.ok(!blob.includes(q2.id) && !blob.includes('Motorcraft') && !blob.includes('"priceHalalas":8500'), 'no competitor data');
  }

  // Other customers / anonymous cannot read or accept.
  const other = await customer(app);
  assert.equal((await other.get(`/v1/me/part-requests/${requestId}`)).status, 404);
  assert.equal((await other.post(`/v1/me/part-requests/${requestId}/quotes/${q2.id}/accept`)).status, 404);
  assert.equal((await anon.get(`/v1/me/part-requests/${requestId}`)).status, 401);
  assert.equal((await c.get('/v1/ops/part-requests')).status, 403);

  // Accept the free-text quote → private offer + DRAFT product.
  const accepted = await c.ok<any>('POST', `/v1/me/part-requests/${requestId}/quotes/${q2.id}/accept`);
  assert.ok(accepted.offerId);
  assert.equal(accepted.quantity, 1);
  assert.equal(accepted.product.offers[0].id, accepted.offerId);
  assert.equal(accepted.seller.id, 's-salvage');
  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: accepted.offerId }, include: { product: true, inventory: true } });
  assert.equal(offer.visibility, 'PRIVATE');
  assert.equal(offer.privateForUserId, c.userId);
  assert.equal(offer.priceHalalas, 8500);
  assert.equal(offer.condition, 'USED');
  assert.equal(offer.inventory?.onHand, 1);
  assert.equal(offer.product.status, 'DRAFT');
  assert.equal(offer.product.createdByMerchantId, 's-salvage');
  const closed = await c.ok<any>('GET', `/v1/me/part-requests/${requestId}`);
  assert.equal(closed.status, 'ACCEPTED');
  assert.equal((await prisma.partQuote.findUniqueOrThrow({ where: { id: q1.id } })).status, 'DECLINED');
  assert.equal((await c.post(`/v1/me/part-requests/${requestId}/quotes/${q1.id}/accept`)).status, 409, 'only one quote can win');
  assert.equal((await salvage.patch(`/v1/merchants/s-salvage/part-requests/${requestId}/quote`, { priceSar: '999' })).status, 409, 'accepted quote cannot be edited');
  assert.equal((await salvage.patch(`/v1/merchants/s-salvage/offers/${accepted.offerId}`, { priceHalalas: 99900 })).status, 404, 'private offer price is frozen');

  // Private offer + draft product are invisible publicly.
  await assertNotPublic(anon, accepted.offerId, offer.productId, 's-salvage');
  assert.equal((await other.ok<any>('GET', '/v1/me/private-offers')).products.length, 0);
  const otherAddress = await addAddress(other, 'riyadh');
  assert.equal((await other.post('/v1/checkout/plan', { addressId: otherAddress.id, lines: [{ offerId: accepted.offerId, quantity: 1 }] })).status, 404, 'other users cannot plan a private offer');
  const otherCart = await other.ok<any>('PUT', '/v1/me/cart', { lines: [{ offerId: accepted.offerId, qty: 1 }] });
  assert.equal(otherCart.lines.length, 0, 'other users cannot cart a private offer');

  // The owner sees it, plans, checks out and pays through the unchanged flow.
  const mine = await c.ok<any>('GET', '/v1/me/private-offers');
  assert.equal(mine.products[0].offers[0].id, accepted.offerId);
  assert.equal(mine.products[0].offers[0].visibility, 'private');
  assert.equal(mine.sellers[0].id, 's-salvage');
  assert.equal((await c.ok<any>('PUT', '/v1/me/cart', { lines: [{ offerId: accepted.offerId, qty: 1 }] })).lines.length, 1);
  const { option, order } = await placeOrder(c, address.id, [{ offerId: accepted.offerId, quantity: 1 }]);
  assert.equal(option.itemsHalalas, 8500);
  assert.equal(option.groups[0].merchantId, 's-salvage');
  assert.equal(order.status, 'PENDING_PAYMENT');
  await payOnSandboxPage(app, order.payment.redirectUrl);
  const view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'PAID');
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: order.orderId } });
  assert.equal(mo.merchantId, 's-salvage');
  assert.equal(mo.status, 'NEW');
  const merchantOrders = await salvage.ok<any>('GET', '/v1/merchants/s-salvage/orders?status=NEW');
  assert.ok(merchantOrders.items.some((m: any) => m.id === mo.id), 'merchant order created');
  assert.equal((await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: accepted.offerId } })).onHand, 0, 'sold out after payment');

  // Merchant sees which quotes won, linked to the paid order.
  const won = await salvage.ok<any>('GET', '/v1/merchants/s-salvage/part-quotes');
  const wq = won.items.find((q: any) => q.id === q2.id);
  assert.equal(wq.won, true);
  assert.equal(wq.merchantOrders[0].id, mo.id);
  const lost = await riyadh.ok<any>('GET', '/v1/merchants/s-riyadh-center/part-quotes');
  assert.equal(lost.items.find((q: any) => q.id === q1.id).status, 'DECLINED');
  assert.ok((await merchantNotifications(salvage, 's-salvage')).some((n: any) => n.type === 'part_quote.accepted'));

  // Audit trail for created / submitted / accepted.
  const actions = (await prisma.auditEvent.findMany({ where: { entityId: requestId } })).map((a) => a.action);
  for (const a of ['part_request.created', 'part_quote.submitted', 'part_quote.accepted']) assert.ok(actions.includes(a), a);

  // Ops: list with quote count, time to first quote and metrics.
  const ops = await login(app, 'ops.agent@qitah.test');
  const opsList = await ops.ok<any>('GET', '/v1/ops/part-requests');
  const row = opsList.items.find((r: any) => r.id === requestId);
  assert.equal(row.quoteCount, 2);
  assert.ok(row.timeToFirstQuoteSeconds >= 0);
  assert.equal(opsList.metrics.answered >= 1, true);
  assert.equal(opsList.metrics.targetMinutes, 15);
  const opsDetail = await ops.ok<any>('GET', `/v1/ops/part-requests/${requestId}`);
  assert.equal(opsDetail.quotes.length, 3);
});

test('a quote on a catalog product stays private: no leak into product pages or other users’ plans', async () => {
  const anon = new Client(app);
  const c = await customer(app);
  const vehicle = await c.ok<any>('POST', '/v1/me/vehicles', TAURUS);
  const address = await addAddress(c, 'riyadh');
  const r = await newRequest(c, vehicle.id, address.id);
  const riyadh = await merchantClient('riyadh-center');
  // Deliberately cheaper than every public offer for this product, so a leak would be picked as "lowest".
  const q = await riyadh.ok<any>('POST', `/v1/merchants/s-riyadh-center/part-requests/${r.id}/quote`, { productId: 'p-toyota-oil-filter', condition: 'NEW', priceSar: '1.00', locationId: 'loc-rc-olaya', quantity: 1 });
  const accepted = await c.ok<any>('POST', `/v1/me/part-requests/${r.id}/quotes/${q.id}/accept`);
  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: accepted.offerId }, include: { product: true } });
  assert.equal(offer.product.status, 'ACTIVE', 'linked product reused, no draft');

  const detail = await anon.ok<any>('GET', '/v1/catalog/products/p-toyota-oil-filter');
  assert.ok(detail.product.offers.length > 0);
  assert.ok(!detail.product.offers.some((o: any) => o.id === accepted.offerId), 'not on the product page');
  await assertNotPublic(anon, accepted.offerId, null, 's-riyadh-center');

  // Another customer buying the same product never gets the private offer as an alternative.
  const other = await customer(app);
  const otherAddress = await addAddress(other, 'riyadh');
  const publicOffer = detail.product.offers[0];
  const plan = await other.ok<any>('POST', '/v1/checkout/plan', { addressId: otherAddress.id, lines: [{ offerId: publicOffer.id, quantity: 1 }] });
  for (const o of plan.options) for (const g of o.groups) for (const l of g.lines) assert.notEqual(l.offerId, accepted.offerId);

  // The owner can plan it (the "selected" option uses the private 1 SAR offer).
  const own = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: address.id, lines: [{ offerId: accepted.offerId, quantity: 1 }] });
  assert.equal(own.options.find((o: any) => o.strategy === 'selected').itemsHalalas, 100);
});

test('customers can cancel open requests; merchant scope and validation', async () => {
  const c = await customer(app);
  const vehicle = await c.ok<any>('POST', '/v1/me/vehicles', TAURUS);
  const address = await addAddress(c, 'riyadh');
  const empty = await c.post('/v1/me/part-requests', { vehicleId: vehicle.id, addressId: address.id, description: '' });
  assert.equal(empty.status, 400, 'needs a description, part number or photo');
  const byModel = await c.ok<any>('POST', '/v1/me/part-requests', { vehicle: { modelId: 'taurus', year: 2021 }, city: 'riyadh', description: 'مراية جانبية يمين' });
  assert.equal(byModel.vehicle.makeId, 'ford');
  const badYear = await c.post('/v1/me/part-requests', { vehicle: { modelId: 'taurus', year: 2001 }, city: 'riyadh', description: 'x' });
  assert.equal(badYear.status, 400);
  const otherVehicle = await (await customer(app)).ok<any>('POST', '/v1/me/vehicles', TAURUS);
  assert.equal((await c.post('/v1/me/part-requests', { vehicleId: otherVehicle.id, city: 'riyadh', description: 'x' })).status, 404, 'cannot use another customer’s vehicle');

  const cancelled = await c.ok<any>('POST', `/v1/me/part-requests/${byModel.id}/cancel`);
  assert.equal(cancelled.status, 'CANCELLED');
  const salvage = await merchantClient('salvage');
  assert.equal((await salvage.get(`/v1/merchants/s-salvage/part-requests/${byModel.id}`)).status, 404, 'closed requests leave the inbox');
  assert.equal((await c.post(`/v1/me/part-requests/${byModel.id}/cancel`)).status, 409);

  // A merchant awaiting approval cannot answer requests.
  const applicant = await login(app, 'owner@new-applicant.qitah.test');
  const pending = await prisma.merchant.findFirstOrThrow({ where: { status: 'UNDER_REVIEW' } });
  assert.equal((await applicant.get(`/v1/merchants/${pending.id}/part-requests`)).status, 403);
});

test('expiry job: quotes, requests and private offers expire idempotently', async () => {
  const c = await customer(app);
  const vehicle = await c.ok<any>('POST', '/v1/me/vehicles', TAURUS);
  const address = await addAddress(c, 'riyadh');
  const salvage = await merchantClient('salvage');
  const riyadh = await merchantClient('riyadh-center');

  // Request A: one short-lived quote that lapses → back to OPEN, then the request itself expires.
  const a = await newRequest(c, vehicle.id, address.id);
  await salvage.ok('POST', `/v1/merchants/s-salvage/part-requests/${a.id}/quote`, { partName: 'كمبروسر', condition: 'USED', priceSar: '300', locationId: 'loc-sv-riyadh', validHours: 1 });
  // Request B: accepted quote → private offer that lapses with the quote.
  const b = await newRequest(c, vehicle.id, address.id);
  const qb = await riyadh.ok<any>('POST', `/v1/merchants/s-riyadh-center/part-requests/${b.id}/quote`, { partName: 'دينمو', brand: 'Denso', condition: 'NEW', priceSar: '500', locationId: 'loc-rc-olaya', validHours: 2 });
  const accepted = await c.ok<any>('POST', `/v1/me/part-requests/${b.id}/quotes/${qb.id}/accept`);

  const t1 = new Date(Date.now() + 90 * 60_000);
  assert.ok((await expirePartRequests(t1)) >= 2);
  assert.equal((await prisma.partRequest.findUniqueOrThrow({ where: { id: a.id } })).status, 'OPEN', 'no active quote left → reopened');
  assert.equal((await prisma.partQuote.findFirstOrThrow({ where: { requestId: a.id } })).status, 'EXPIRED');
  assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: accepted.offerId } })).status, 'ACTIVE', 'offer still valid at 90 min');

  const t2 = new Date(Date.now() + 3 * 3600_000);
  await expirePartRequests(t2);
  assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: accepted.offerId } })).status, 'ARCHIVED', 'private offer expires with the quote');
  const plan = await c.post('/v1/checkout/plan', { addressId: address.id, lines: [{ offerId: accepted.offerId, quantity: 1 }] });
  assert.ok(plan.status !== 200 || plan.body.options.every((o: any) => o.groups.every((g: any) => g.lines.every((l: any) => l.offerId !== accepted.offerId))), 'expired private offer is not purchasable');
  assert.equal((await c.ok<any>('GET', '/v1/me/private-offers')).products.length, 0);

  const t3 = new Date(Date.now() + 73 * 3600_000);
  await expirePartRequests(t3);
  assert.equal((await prisma.partRequest.findUniqueOrThrow({ where: { id: a.id } })).status, 'EXPIRED');
  assert.equal((await prisma.partRequest.findUniqueOrThrow({ where: { id: b.id } })).status, 'ACCEPTED', 'accepted requests are final');
  assert.ok((await c.ok<any>('GET', '/v1/me/notifications')).notifications.some((n: any) => n.type === 'part_request.expired'));
  assert.equal(await expirePartRequests(t3), 0, 'second run is a no-op');
});

async function merchantNotifications(m: Client, merchantId: string) {
  return (await m.ok<any>('GET', `/v1/merchants/${merchantId}/notifications`)).notifications;
}

async function assertNotPublic(anon: Client, offerId: string, productId: string | null, sellerId: string) {
  const snapshot = JSON.stringify(await anon.ok<any>('GET', '/v1/catalog/snapshot'));
  assert.ok(!snapshot.includes(offerId), 'not in snapshot');
  assert.equal((await anon.ok<any>('GET', `/v1/catalog/offers?ids=${offerId}`)).offers.length, 0, 'not in live offers');
  const seller = JSON.stringify(await anon.ok<any>('GET', `/v1/catalog/sellers/${sellerId}`));
  assert.ok(!seller.includes(offerId), 'not on the seller page');
  const search = JSON.stringify(await anon.ok<any>('GET', `/v1/catalog/products?q=${encodeURIComponent('حساس أكسجين')}`));
  assert.ok(!search.includes(offerId), 'not in search');
  if (productId) {
    assert.ok(!snapshot.includes(productId), 'draft product not in snapshot');
    assert.equal((await anon.get(`/v1/catalog/products/${productId}`)).status, 404, 'draft product not public');
    const byNumber = JSON.stringify(await anon.ok<any>('GET', '/v1/catalog/products?q=DG9Z-9G444-A'));
    assert.ok(!byNumber.includes(productId), 'draft product not searchable');
  }
}
