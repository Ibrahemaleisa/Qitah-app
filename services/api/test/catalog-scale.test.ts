import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { runAllJobs } from '../src/jobs.js';
import { rebuildAllListings, refreshDueListings, refreshListings } from '../src/services/listings.js';
import { addAddress, Client, ctx, customer, login, payOnSandboxPage, prisma, resetDatabase, startApp } from './helpers.js';

/**
 * Catalog at scale: the ProductListing read model (kept in the same transaction as offer / stock /
 * reservation / merchant / location writes), the endpoints that replace the full snapshot (reference
 * with ETag/304, products?ids, home starter pack, changes feed) and the deprecated, capped snapshot.
 */

let app: Awaited<ReturnType<typeof startApp>>;
let anon: Client;
before(async () => {
  await resetDatabase();
  app = await startApp();
  anon = new Client(app);
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

const listing = (productId: string) => prisma.productListing.findUniqueOrThrow({ where: { productId } });
const raw = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

/** What the listing must say, recomputed from the public product detail (the same publicOfferWhere view). */
async function expectedFromDetail(productId: string) {
  const r = await raw(`/v1/catalog/products/${productId}`);
  const offers = (r.json() as any).product.offers as any[];
  const inStock = offers.filter((o) => o.available > 0);
  const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  return {
    offerCount: offers.length,
    inStockOfferCount: inStock.length,
    totalAvailable: offers.reduce((s, o) => s + o.available, 0),
    minPriceHalalas: min(inStock.map((o) => o.priceHalalas)) ?? min(offers.map((o) => o.priceHalalas)),
    merchantIds: [...new Set(offers.map((o) => o.sellerId))].sort(),
  };
}

async function assertListingMatchesDetail(productId: string, msg: string) {
  const l = await listing(productId);
  const want = await expectedFromDetail(productId);
  assert.deepEqual(
    { offerCount: l.offerCount, inStockOfferCount: l.inStockOfferCount, totalAvailable: l.totalAvailable, minPriceHalalas: l.minPriceHalalas, merchantIds: l.merchantIds },
    want,
    msg,
  );
  return l;
}

test('seed + backfill: every product has a listing that agrees with the public detail; backfill is idempotent', async () => {
  const products = await prisma.product.count();
  assert.equal(await prisma.productListing.count(), products);
  for (const id of ['p-camry-pads-oem', 'p-lc-rotor-slotted', 'p-battery-70', 'p-coolant-1gal']) await assertListingMatchesDetail(id, id);
  const pads = await listing('p-camry-pads-oem');
  assert.equal(pads.listed, true);
  assert.equal(pads.hasCatalogFitment, true);
  assert.equal(pads.universal, false);
  assert.deepEqual(pads.conditions, ['NEW']);
  assert.equal((await listing('p-coolant-1gal')).universal, true);

  // Idempotent: a second full run changes nothing…
  assert.equal((await rebuildAllListings()).changed, 0);
  // …and repairs drift (rows edited or deleted behind the services' back).
  await prisma.productListing.update({ where: { productId: 'p-camry-pads-oem' }, data: { totalAvailable: 9999, offerCount: 0, listed: false } });
  await prisma.productListing.delete({ where: { productId: 'p-battery-70' } });
  const repaired = await rebuildAllListings();
  assert.equal(repaired.changed, 2);
  await assertListingMatchesDetail('p-camry-pads-oem', 'repaired');
  await assertListingMatchesDetail('p-battery-70', 'recreated');
  assert.equal((await rebuildAllListings()).changed, 0);
});

test('offer create / price update / pause keep the listing current in the same request', async () => {
  const m = await login(app, 'owner@brake-house.qitah.test');
  const mid = 's-brake-house';
  const before = await listing('p-oil-5w30');
  assert.ok(!before.merchantIds.includes(mid));
  const loc = (await m.ok<any>('GET', `/v1/merchants/${mid}/locations`)).locations[0];

  const offer = await m.ok<any>('POST', `/v1/merchants/${mid}/offers`, { productId: 'p-oil-5w30', locationId: loc.id, sku: 'RM-OIL-1', priceHalalas: 9900, stock: 4 });
  let l = await assertListingMatchesDetail('p-oil-5w30', 'after create');
  assert.equal(l.minPriceHalalas, 9900);
  assert.ok(l.merchantIds.includes(mid));
  assert.ok(l.updatedAt > before.updatedAt);
  // The new offer is searchable by merchant right away (the seller page reads the read model).
  const seller = await anon.ok<any>('GET', `/v1/catalog/sellers/${mid}`);
  assert.ok(seller.products.some((p: any) => p.id === 'p-oil-5w30'));

  await m.ok('PATCH', `/v1/merchants/${mid}/offers/${offer.id}`, { priceHalalas: 19900 });
  l = await assertListingMatchesDetail('p-oil-5w30', 'after price change');
  assert.equal(l.minPriceHalalas, 14900, 'the cheapest offer is the seeded one again');

  await m.ok('PATCH', `/v1/merchants/${mid}/offers/${offer.id}`, { status: 'PAUSED' });
  l = await assertListingMatchesDetail('p-oil-5w30', 'after pause');
  assert.ok(!l.merchantIds.includes(mid));
  assert.equal(l.offerCount, before.offerCount);
});

test('stock edits, reservations, payment commit and release move totalAvailable exactly', async () => {
  const m = await login(app, 'owner@elite-oils.qitah.test');
  const before = await listing('p-oil-filter-kanzen');
  // o-016 (elite-oils) 180 units, o-017 (quickfix) 12 units.
  await m.ok('PUT', '/v1/merchants/s-elite-oils/offers/o-016/stock', { onHand: 150, reason: 'CORRECTION' });
  let l = await assertListingMatchesDetail('p-oil-filter-kanzen', 'after stock edit');
  assert.equal(l.totalAvailable, before.totalAvailable - 30);

  // Checkout reserves (available drops), payment commits (available unchanged), cancel of an unpaid order releases.
  const c = await customer(app);
  const addr = await addAddress(c);
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-016', quantity: 5 }] });
  const order = await c.ok<any>('POST', '/v1/checkout', { planId: plan.options.find((o: any) => o.strategy === 'selected').planId, idempotencyKey: 'scale-reserve-1', paymentMethod: 'mada' });
  l = await assertListingMatchesDetail('p-oil-filter-kanzen', 'after reservation');
  assert.equal(l.totalAvailable, before.totalAvailable - 35);
  await payOnSandboxPage(app, order.payment.redirectUrl);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status, 'PAID');
  l = await assertListingMatchesDetail('p-oil-filter-kanzen', 'after commit');
  assert.equal(l.totalAvailable, before.totalAvailable - 35);

  const plan2 = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-017', quantity: 12 }] });
  const unpaid = await c.ok<any>('POST', '/v1/checkout', { planId: plan2.options.find((o: any) => o.strategy === 'selected').planId, idempotencyKey: 'scale-reserve-2', paymentMethod: 'mada' });
  l = await assertListingMatchesDetail('p-oil-filter-kanzen', 'quickfix sold out by reservation');
  assert.equal(l.inStockOfferCount, 1);
  assert.equal((l.offers as any[]).find((o) => o.id === 'o-017').a, 0);
  await c.ok('POST', `/v1/orders/${unpaid.orderId}/cancel`, { reason: 'changed my mind' });
  l = await assertListingMatchesDetail('p-oil-filter-kanzen', 'after release');
  assert.equal(l.inStockOfferCount, 2);
});

test('merchant suspension and location deactivation hide offers from the read model and search; reinstating restores them', async () => {
  const ops = await login(app, 'ops.admin@qitah.test');
  const affected = (await prisma.offer.findMany({ where: { merchantId: 's-salvage' }, select: { productId: true }, distinct: ['productId'] })).map((o) => o.productId);
  assert.ok(affected.length > 0);
  await ops.ok('POST', '/v1/ops/merchants/s-salvage/suspend', { reason: 'scale test' });
  for (const id of affected) {
    const l = await assertListingMatchesDetail(id, `suspended ${id}`);
    assert.ok(!l.merchantIds.includes('s-salvage'));
  }
  const used = await anon.ok<any>('GET', '/v1/catalog/search?condition=used&limit=50');
  assert.ok(used.items.every((p: any) => p.offers.some((o: any) => o.condition === 'used' && o.sellerId !== 's-salvage')));
  await ops.ok('POST', '/v1/ops/merchants/s-salvage/reinstate');
  for (const id of affected) assert.ok((await listing(id)).merchantIds.includes('s-salvage'), `reinstated ${id}`);

  // Deactivating a pickup location hides its offers.
  const m = await login(app, 'owner@quickfix.qitah.test');
  const loc = (await m.ok<any>('GET', '/v1/merchants/s-quickfix/locations')).locations[0];
  await m.ok('PATCH', `/v1/merchants/s-quickfix/locations/${loc.id}`, { active: false });
  assert.ok(!(await listing('p-h11-led')).merchantIds.includes('s-quickfix'));
  await m.ok('PATCH', `/v1/merchants/s-quickfix/locations/${loc.id}`, { active: true });
  assert.ok((await listing('p-h11-led')).merchantIds.includes('s-quickfix'));
});

test('a refresh that changes nothing does not bump updatedAt; the worker sweep is a no-op on a consistent catalog', async () => {
  const l1 = await listing('p-camry-pads-oem');
  assert.equal(await refreshListings(prisma, ['p-camry-pads-oem', 'p-camry-pads-oem']), 0);
  assert.deepEqual((await listing('p-camry-pads-oem')).updatedAt, l1.updatedAt);
  const jobs = await runAllJobs(ctx, { deliver: async () => undefined });
  assert.equal(jobs.listingsRepaired, 0);
});

test('reference: strong ETag, long cache headers, 304 on If-None-Match', async () => {
  const r = await raw('/v1/catalog/reference');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'public, max-age=3600, stale-while-revalidate=86400');
  const etag = String(r.headers.etag);
  assert.match(etag, /^"[A-Za-z0-9_-]{20,}"$/);
  assert.ok((r.json() as any).categories.length > 0);
  const again = await raw('/v1/catalog/reference', { 'if-none-match': etag });
  assert.equal(again.statusCode, 304);
  assert.equal(again.body, '');
  assert.equal(again.headers.etag, etag);
  // Weak form (CloudFront may weaken it when compressing) and lists also match; a stale tag does not.
  assert.equal((await raw('/v1/catalog/reference', { 'if-none-match': `"nope", W/${etag}` })).statusCode, 304);
  assert.equal((await raw('/v1/catalog/reference', { 'if-none-match': '"stale"' })).statusCode, 200);
});

test('product detail: ETag + short cache; the ETag changes when the price changes', async () => {
  const r1 = await raw('/v1/catalog/products/p-spark-iridium');
  assert.equal(r1.headers['cache-control'], 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
  const etag = String(r1.headers.etag);
  assert.equal((await raw('/v1/catalog/products/p-spark-iridium', { 'if-none-match': etag })).statusCode, 304);
  const m = await login(app, 'owner@eastern.qitah.test');
  await m.ok('PATCH', '/v1/merchants/s-eastern/offers/o-032', { priceHalalas: 16000 });
  const r2 = await raw('/v1/catalog/products/p-spark-iridium', { 'if-none-match': etag });
  assert.equal(r2.statusCode, 200);
  assert.notEqual(r2.headers.etag, etag);
  assert.equal((await raw('/v1/catalog/products/nope')).statusCode, 404);
});

test('products?ids= batch: requested order, sellers, missing ids, offerIds resolution, bounded at 100', async () => {
  const r = await anon.ok<any>('GET', '/v1/catalog/products?ids=p-battery-70,unknown-id,p-camry-pads-oem,p-battery-70');
  assert.deepEqual(r.products.map((p: any) => p.id), ['p-battery-70', 'p-camry-pads-oem']);
  assert.deepEqual(r.missing, ['unknown-id']);
  const sellerIds = new Set(r.sellers.map((s: any) => s.id));
  assert.ok(r.products.every((p: any) => p.offers.every((o: any) => sellerIds.has(o.sellerId))));
  // Same product shape as the detail endpoint.
  const detail = await anon.ok<any>('GET', '/v1/catalog/products/p-battery-70');
  assert.deepEqual(r.products[0], detail.product);
  // A cart only knows offer ids.
  const byOffers = await anon.ok<any>('GET', '/v1/catalog/products?offerIds=o-013,o-040');
  assert.deepEqual(byOffers.products.map((p: any) => p.id).sort(), ['p-battery-70', 'p-toyota-oil-filter']);
  const res = await raw('/v1/catalog/products?ids=p-battery-70');
  assert.equal(res.headers['cache-control'], 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
  assert.ok(res.headers.etag);
  const tooMany = await anon.get(`/v1/catalog/products?ids=${Array.from({ length: 101 }, (_, i) => `p${i}`).join(',')}`);
  assert.equal(tooMany.status, 400);
  // The legacy list (no ids) still works.
  assert.ok((await anon.ok<any>('GET', '/v1/catalog/products?limit=5')).items.length === 5);
});

test('home starter pack: recommended parts carry catalog fitment for the vehicle; featured are by specification; bounded', async () => {
  const home = await anon.ok<any>('GET', `/v1/catalog/home?modelId=camry&year=2022&engine=${encodeURIComponent('2.5L I4')}`);
  assert.ok(home.recommended.length > 0);
  assert.ok(home.recommended.length + home.featured.length <= 24);
  const byId = new Map(home.products.map((p: any) => [p.id, p]));
  assert.deepEqual([...byId.keys()], [...home.recommended, ...home.featured]);
  for (const id of home.recommended) {
    const p: any = byId.get(id);
    assert.ok(
      p.fitment.some((f: any) => f.source === 'catalog' && f.modelId === 'camry' && f.yearFrom <= 2022 && f.yearTo >= 2022 && (!f.engines || f.engines.includes('2.5L I4'))),
      `${id} must be a catalog-verified fit`,
    );
    assert.ok(p.offers.some((o: any) => o.available > 0), `${id} in stock`);
  }
  for (const id of home.featured) assert.ok((byId.get(id) as any).universal, `${id} fits by specification`);
  assert.ok(!home.recommended.includes('p-lc-rotor-oem'), 'Land Cruiser rotor is not recommended for a Camry');
  // Another vehicle gets another pack; no vehicle → popular products across categories.
  const patrol = await anon.ok<any>('GET', '/v1/catalog/home?vehicle=patrol:2020:4.0L%20V6');
  assert.ok(patrol.recommended.includes('p-patrol-cabin-filter'));
  assert.ok(!patrol.recommended.includes('p-camry-pads-oem'));
  const none = await anon.ok<any>('GET', '/v1/catalog/home');
  assert.equal(none.recommended.length, 0);
  assert.ok(new Set(none.products.map((p: any) => p.categoryId)).size >= 5);
  const res = await raw('/v1/catalog/home?modelId=camry&year=2022');
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  assert.equal((await raw('/v1/catalog/home?limit=200')).statusCode, 400);
});

test('changes feed: only products changed since the cursor, removed ids, then quiet', async () => {
  const t0 = (await anon.ok<any>('GET', `/v1/catalog/changes?since=${new Date().toISOString()}&ids=p-camry-air-filter`)).serverTime;
  const quiet = await anon.ok<any>('GET', `/v1/catalog/changes?since=${encodeURIComponent(t0)}&ids=p-camry-air-filter,p-patrol-air-filter`);
  assert.deepEqual(quiet.products, []);
  const m = await login(app, 'owner@riyadh-center.qitah.test');
  await m.ok('PUT', '/v1/merchants/s-riyadh-center/offers/o-018/stock', { onHand: 3, reason: 'CORRECTION' });
  const changes = await anon.ok<any>('GET', `/v1/catalog/changes?since=${encodeURIComponent(t0)}&ids=p-camry-air-filter,p-patrol-air-filter,gone-product`);
  assert.deepEqual(changes.products.map((p: any) => p.id), ['p-camry-air-filter']);
  assert.equal(changes.products[0].offers.find((o: any) => o.id === 'o-018').available, 3);
  assert.deepEqual(changes.removed, ['gone-product']);
  assert.ok(changes.sellers.some((s: any) => s.id === 's-riyadh-center'));
  const after = await anon.ok<any>('GET', `/v1/catalog/changes?since=${encodeURIComponent(changes.serverTime)}&ids=p-camry-air-filter`);
  assert.deepEqual(after.products, []);
  const res = await raw(`/v1/catalog/changes?since=${encodeURIComponent(t0)}&ids=p-camry-air-filter`);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal((await raw('/v1/catalog/changes?since=yesterday&ids=a')).statusCode, 400);
});

test('snapshot is deprecated, capped and announces its successor', async () => {
  const res = await raw('/v1/catalog/snapshot');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.deprecation, 'true');
  assert.ok(res.headers.sunset);
  assert.match(String(res.headers.link), /\/v1\/catalog\/home/);
  assert.equal(res.headers['x-catalog-truncated'], 'false');
  const body = res.json() as any;
  assert.equal(body.deprecated, true);
  assert.equal(body.truncated, false);
  assert.ok(body.limit >= 1000);
  assert.equal(body.products.length, await prisma.productListing.count({ where: { listed: true } }));
});

test('search: identical results through the read model, including condition + in-stock + merchant filters and price sorts', async () => {
  // Sold-out offer o-010 must not make p-lc-rotor-slotted's in-stock price o-010's.
  const sorted = await anon.ok<any>('GET', '/v1/catalog/search?q=%D9%87%D9%88%D8%A8%D8%A7%D8%AA&sort=priceAsc&inStock=true');
  const prices = sorted.items.map((p: any) => Math.min(...p.offers.filter((o: any) => o.available > 0).map((o: any) => o.priceHalalas)));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const usedNew = await anon.ok<any>('GET', '/v1/catalog/search?condition=used,refurbished&sort=priceDesc&limit=50');
  assert.ok(usedNew.items.length > 0);
  assert.ok(usedNew.items.every((p: any) => p.offers.some((o: any) => o.condition !== 'new')));
  const best = usedNew.items.map((p: any) => Math.min(...p.offers.filter((o: any) => o.condition !== 'new').map((o: any) => o.priceHalalas)));
  assert.deepEqual(best, [...best].sort((a, b) => b - a));
});

test('offer freshness: time alone hides an unconfirmed offer from the read model and search; stale flags refresh; reconfirming restores', async () => {
  const DAY = 86_400_000;
  // p-camry-pads-oem: o-001 389 SAR, o-002 365 SAR (cheapest), o-003 372 SAR.
  const before = await listing('p-camry-pads-oem');
  assert.equal(before.minPriceHalalas, 36500);
  assert.ok(before.nextChangeAt && before.nextChangeAt > new Date(), 'next freshness boundary is in the future');
  const t0 = new Date().toISOString();

  // Time passes with no write: o-002 was last confirmed 22 days ago (past FRESHNESS_HIDE_DAYS), o-003 8 days ago (stale).
  await prisma.offer.update({ where: { id: 'o-002' }, data: { lastConfirmedAt: new Date(Date.now() - 22 * DAY) } });
  await prisma.offer.update({ where: { id: 'o-003' }, data: { lastConfirmedAt: new Date(Date.now() - 8 * DAY) } });
  await prisma.productListing.update({ where: { productId: 'p-camry-pads-oem' }, data: { nextChangeAt: new Date(Date.now() - 1000) } });
  // What the worker's listing job does every minute (runAllJobs → listingSweepThrottled → refreshDueListings).
  assert.equal(await refreshDueListings(), 1);

  const l = await assertListingMatchesDetail('p-camry-pads-oem', 'after the freshness boundary');
  assert.equal(l.minPriceHalalas, 37200, 'the hidden offer no longer sets the price');
  assert.ok(!(l.offers as any[]).some((o) => o.id === 'o-002'));
  assert.ok(l.nextChangeAt! > new Date());
  const search = await anon.ok<any>('GET', `/v1/catalog/search?q=${encodeURIComponent('فحمات')}&sort=priceAsc&limit=50`);
  const hit = search.items.find((p: any) => p.id === 'p-camry-pads-oem');
  assert.ok(hit && !hit.offers.some((o: any) => o.id === 'o-002'));
  assert.equal(hit.offers.find((o: any) => o.id === 'o-003').stale, true);
  // Clients holding the product learn about it from the changes feed.
  const changes = await anon.ok<any>('GET', `/v1/catalog/changes?since=${encodeURIComponent(t0)}&ids=p-camry-pads-oem`);
  assert.deepEqual(changes.products.map((p: any) => p.id), ['p-camry-pads-oem']);

  // The merchant reconfirms ("my stock is accurate"): the offer is public again in the same transaction.
  const m = await login(app, 'owner@brake-house.qitah.test');
  await m.ok('POST', '/v1/merchants/s-brake-house/offers/confirm', { offerIds: ['o-002'] });
  assert.equal((await assertListingMatchesDetail('p-camry-pads-oem', 'after reconfirmation')).minPriceHalalas, 36500);
  const eastern = await login(app, 'owner@eastern.qitah.test');
  await eastern.ok('POST', '/v1/merchants/s-eastern/offers/confirm', {});
  assert.ok(!(await anon.ok<any>('GET', '/v1/catalog/products/p-camry-pads-oem')).product.offers.some((o: any) => o.stale));
});
