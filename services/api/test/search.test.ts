import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { refreshSearchText } from '../src/services/catalog.js';
import { Client, prisma, resetDatabase, startApp } from './helpers.js';

/** GET /v1/catalog/search against PostgreSQL with the seeded sandbox catalog. */

let app: Awaited<ReturnType<typeof startApp>>;
let c: Client;
before(async () => {
  await resetDatabase();
  app = await startApp();
  c = new Client(app);
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

const search = (params: Record<string, string | number | boolean | undefined>) =>
  c.ok<any>('GET', `/v1/catalog/search?${Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`);
const ids = (r: any) => r.items.map((p: any) => p.id as string);
const CAMRY = { modelId: 'camry', year: 2022, engine: '2.5L I4' };

test('colloquial queries find the right seeded parts', async () => {
  const expected: Record<string, string[]> = {
    هوبات: ['p-lc-rotor-oem', 'p-lc-rotor-slotted'],
    ديسكات: ['p-lc-rotor-oem', 'p-lc-rotor-slotted'],
    طنابير: ['p-lc-rotor-oem', 'p-lc-rotor-slotted'],
    قربة: ['p-patrol-radiator'],
    راديتر: ['p-patrol-radiator'],
    بوجيهات: ['p-spark-iridium'],
    فحمة: ['p-camry-pads-ceramic', 'p-camry-pads-oem', 'p-elantra-pads-ceramic', 'p-tahoe-pads-rear'],
    بريك: ['p-camry-pads-ceramic', 'p-camry-pads-oem', 'p-elantra-pads-ceramic', 'p-tahoe-pads-rear'],
    مساعدات: ['p-elantra-strut-oem', 'p-hilux-shock', 'p-hilux-shock-rear'],
    سيور: ['p-f150-belt'],
    دعامية: ['p-hilux-bumper'],
    دينمو: ['p-lc-alternator'],
    'فلتر مكيف': ['p-cabin-filter-hk', 'p-patrol-cabin-filter'],
    'ماء رديتر': ['p-coolant', 'p-coolant-1gal'],
    لمبات: ['p-camry-headlight', 'p-h11-led'],
    زيوت: ['p-oil-0w20-oem', 'p-oil-5w30'],
    'الفحمات الامامية': ['p-camry-pads-ceramic', 'p-camry-pads-oem'],
  };
  for (const [q, want] of Object.entries(expected)) {
    const r = await search({ q });
    assert.deepEqual(ids(r).sort(), want, q);
    assert.equal(r.total, want.length, q);
  }
});

test('parts Qitah does not carry are recognised, not a dead end', async () => {
  for (const [q, concept] of [['كفرات', 'tires'], ['اطارات', 'tires'], ['كلتش', 'clutch'], ['قير', 'transmission'], ['كمبروسر', 'acCompressor'], ['سلف', 'starter']]) {
    const r = await search({ q });
    assert.equal(r.total, 0, q);
    assert.deepEqual(r.interpretation.unsupported.map((u: any) => u.id), [concept], q);
    assert.equal(r.fallback, null, `${q}: no fuzzy junk results for a part we don't sell`);
  }
});

test('"فلتر زيت كامري 2022" → oil filters that fit a 2022 Camry, with an interpretation chip', async () => {
  const r = await search({ q: 'فلتر زيت كامري 2022', fitsOnly: true });
  assert.deepEqual(r.interpretation.concepts.map((x: any) => x.id), ['oilFilter']);
  assert.equal(r.interpretation.vehicle.modelId, 'camry');
  assert.equal(r.interpretation.vehicle.year, 2022);
  assert.equal(r.interpretation.vehicle.scope, 'vehicle');
  assert.deepEqual(r.interpretation.vehicle.label, { ar: 'كامري 2022', en: 'Camry 2022' });
  assert.equal(r.interpretation.withoutVehicle, 'فلتر زيت');
  assert.deepEqual(ids(r).sort(), ['p-oil-filter-kanzen', 'p-toyota-oil-filter']);
  assert.ok(r.items.every((p: any) => p.match.fit === 'catalogMatch'));
  // Same product shape as /v1/catalog/products/:id
  const detail = await c.ok<any>('GET', `/v1/catalog/products/${r.items[0].id}`);
  const { match, ...product } = r.items[0];
  assert.deepEqual(product, detail.product);
  assert.ok(match);
  // "زيت كامري" without a year: model scope — engine oils fit by specification, nothing claims "fits your car".
  const oil = await search({ q: 'زيت كامري' });
  assert.equal(oil.interpretation.vehicle.scope, 'model');
  assert.deepEqual(ids(oil).sort(), ['p-oil-0w20-oem', 'p-oil-5w30']);
  assert.ok(oil.items.every((p: any) => p.match.fit === 'bySpecification'));
});

test('ranking: exact part number first (MPN, then OEM reference), ahead of concept matches', async () => {
  const r = await search({ q: '04465X3301' });
  assert.deepEqual(ids(r), ['p-camry-pads-oem', 'p-camry-pads-ceramic']);
  assert.ok(r.items.every((p: any) => p.match.partNumber));
  // A part number inside a phrase still ranks first; the concept matches follow.
  const mixed = await search({ q: 'فحمات 43512-X6040' });
  assert.deepEqual(ids(mixed).slice(0, 2), ['p-lc-rotor-oem', 'p-lc-rotor-slotted']);
  assert.ok(ids(mixed).slice(2).every((id: string) => id.includes('pads')));
  // Prefix of a part number (served by the text_pattern_ops index)
  assert.equal(ids(await search({ q: 'KZ-IR4' }))[0], 'p-spark-iridium');
});

test('fitsOnly with a vehicle: only parts that fit, others counted (for the "show all" toggle) and ranked below', async () => {
  const fits = await search({ q: 'فحمات', ...CAMRY, fitsOnly: true });
  assert.deepEqual(ids(fits).sort(), ['p-camry-pads-ceramic', 'p-camry-pads-oem']);
  assert.deepEqual(fits.counts, { fits: 2, other: 2, hidden: 2 });
  assert.equal(fits.total, 2);
  const all = await search({ q: 'فحمات', ...CAMRY, fitsOnly: false });
  assert.equal(all.total, 4);
  assert.deepEqual(all.items.map((p: any) => p.match.group), ['fits', 'fits', 'other', 'other']);
  assert.deepEqual(all.items.slice(2).map((p: any) => p.match.fit), ['noData', 'noData']);
  // The compact vehicle parameter is equivalent.
  const compact = await search({ q: 'فحمات', vehicle: 'camry:2022:2.5L I4', fitsOnly: true });
  assert.deepEqual(ids(compact), ids(fits));
  // A typed part number is never hidden by the fit filter: it is shown, flagged as not confirmed.
  const pn = await search({ q: '43512-X6040', ...CAMRY, fitsOnly: true });
  assert.deepEqual(ids(pn), ['p-lc-rotor-oem', 'p-lc-rotor-slotted']);
  assert.deepEqual(pn.items.map((p: any) => p.match.group), ['other', 'other']);
  assert.equal(pn.total, 2);
  assert.equal(pn.counts.hidden, 0);
});

test('fitment tiers are conservative: catalog > seller > by specification; unknown engine is not a fit', async () => {
  const plugs = (engine?: string) => search({ q: 'بواجي', modelId: 'camry', year: 2022, ...(engine ? { engine } : {}) });
  assert.equal((await plugs('2.5L I4')).items[0].match.fit, 'catalogMatch');
  assert.equal((await plugs('3.5L V6')).items[0].match.fit, 'noData');
  assert.equal((await plugs()).items[0].match.fit, 'noData', 'engine-specific fitment needs the engine');
  const altima = await search({ q: 'فحمات', modelId: 'altima', year: 2021, fitsOnly: true });
  assert.deepEqual(altima.items.map((p: any) => [p.id, p.match.fit]), [['p-camry-pads-ceramic', 'sellerReported']]);
  const battery = await search({ q: 'بطارية', ...CAMRY, fitsOnly: true });
  assert.ok(battery.items.length > 0 && battery.items.every((p: any) => p.match.fit === 'bySpecification'));
  // Typed vehicle overrides the selected one, and loses the selected engine.
  const patrol = await search({ q: 'قربة باترول 2020', ...CAMRY, fitsOnly: true });
  assert.equal(patrol.interpretation.vehicle.modelId, 'patrol');
  assert.equal(patrol.interpretation.vehicle.engine, undefined);
  assert.equal(patrol.total, 0, 'the V8-only radiator is not claimed for a Patrol of unknown engine');
  assert.equal(patrol.counts.other, 1);
});

test('keyset paging walks every result exactly once in a stable order', async () => {
  for (const params of [{}, { ...CAMRY }, { sort: 'priceAsc' }, { q: 'فلتر' }]) {
    const full = await search({ ...params, limit: 50 });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: any = await search({ ...params, limit: 4, ...(cursor ? { cursor } : {}) });
      seen.push(...ids(page));
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages < 20);
    } while (cursor);
    assert.deepEqual(seen, ids(full), JSON.stringify(params));
    assert.equal(new Set(seen).size, full.total);
  }
  const bad = await c.get('/v1/catalog/search?cursor=nonsense');
  assert.equal(bad.status, 400);
});

test('filters and sorting: category, origin, condition, in stock, price', async () => {
  const brakes = await search({ categoryId: 'brakes', limit: 50 });
  assert.ok(brakes.items.length > 0 && brakes.items.every((p: any) => p.categoryId === 'brakes'));
  const oem = await search({ q: 'فحمات', origin: 'oem' });
  assert.deepEqual(ids(oem), ['p-camry-pads-oem']);
  const used = await search({ condition: 'used', limit: 50 });
  assert.ok(used.items.every((p: any) => p.offers.some((o: any) => o.condition === 'used')));
  const byPrice = await search({ q: 'فلتر', sort: 'priceAsc', limit: 50 });
  const minPrice = (p: any) => Math.min(...p.offers.map((o: any) => o.priceHalalas));
  const prices = byPrice.items.map(minPrice);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test('no exact match: spelling correction, then relaxed, then trigram similarity', async () => {
  const typo = await search({ q: 'فحمت' });
  assert.deepEqual(typo.fallback, { mode: 'corrected', query: 'فحمات' });
  assert.equal(typo.didYouMean, 'فحمات');
  assert.equal(typo.total, 4);
  const relaxed = await search({ q: 'فحمات zzzz' });
  assert.equal(relaxed.fallback.mode, 'relaxed');
  const fuzzy = await search({ q: 'bremboo' });
  assert.equal(fuzzy.fallback.mode, 'similar');
  assert.deepEqual(ids(fuzzy), ['p-elantra-pads-ceramic']);
});

test('legacy /v1/catalog/products delegates to the ranked search and keeps { total, items } + offset paging', async () => {
  const r = await c.ok<any>('GET', `/v1/catalog/products?q=${encodeURIComponent('هوبات')}`);
  assert.equal(r.total, 2);
  const p1 = await c.ok<any>('GET', '/v1/catalog/products?limit=5&offset=0');
  const p2 = await c.ok<any>('GET', '/v1/catalog/products?limit=5&offset=5');
  assert.equal(p1.items.length, 5);
  assert.ok(!p2.items.some((x: any) => p1.items.some((y: any) => y.id === x.id)));
  const seller = await c.ok<any>('GET', '/v1/catalog/sellers/s-brake-house');
  assert.ok(seller.products.length > 0);
});

test('seed and refreshSearchText agree, and searchText carries concept tokens for colloquial terms', async () => {
  const products = await prisma.product.findMany({ select: { id: true, searchText: true } });
  for (const p of products) assert.equal(await refreshSearchText(prisma, p.id), false, `${p.id} searchText out of sync with buildSearchText`);
  const rotor = products.find((p) => p.id === 'p-lc-rotor-oem')!;
  assert.ok(rotor.searchText.includes('{brakerotors}') && rotor.searchText.includes('هوبات') && rotor.searchText.includes('طنابير'));
});

test('EXPLAIN: the trigram and part-number prefix indexes are usable', async () => {
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    const text = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN SELECT id FROM "Product" WHERE "searchText" LIKE '%{brakepads}%'`);
    const prefix = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN SELECT "productId" FROM "ProductIdentifier" WHERE normalized LIKE '04465%'`);
    return { text: text.map((r) => r['QUERY PLAN']).join('\n'), prefix: prefix.map((r) => r['QUERY PLAN']).join('\n') };
  });
  assert.match(plan.text, /Product_searchText_trgm_idx/);
  assert.match(plan.prefix, /ProductIdentifier_normalized_pattern_idx/);
});
