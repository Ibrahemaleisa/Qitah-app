import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { sha256 } from '../src/auth/crypto.js';
import { computeServiceStatus, GENERIC_MAINTENANCE_TEMPLATES, matchesComponent } from '../src/lib/maintenance.js';
import { decodeVin, vinCheckDigit } from '../src/lib/vin.js';
import { maintenanceReminders } from '../src/services/maintenance.js';
import { normalizeWorkshopPhone } from '../src/services/mechanicReviews.js';
import { addAddress, Client, customer, fulfil, login, payOnSandboxPage, placeOrder, prisma, resetDatabase, startApp } from './helpers.js';

/** Faster garage (VIN decode, no trim), maintenance schedule/kits/reminders and "send to my mechanic". */

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  await resetDatabase();
  app = await startApp();
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ───────────────────────────── VIN

type VinCase = { name: string; vin: string; now: string; expect: { valid: boolean; make: string | null; manufacturer: string | null; modelYear: number | null; checkDigit: string | null; confidence: string; reasons: string[] } };

test('VIN decode fixtures: check digit, known WMIs and model-year cycles', () => {
  for (const c of fixture<VinCase[]>('vin-decode.json')) {
    const d = decodeVin(c.vin, new Date(c.now));
    assert.deepEqual(
      { valid: d.valid, make: d.make ?? null, manufacturer: d.manufacturer ?? null, modelYear: d.modelYear ?? null, checkDigit: d.checkDigit ?? null, confidence: d.confidence, reasons: d.reasons },
      c.expect,
      c.name,
    );
  }
  // The classic ISO 3779 worked example.
  assert.equal(vinCheckDigit('1HGCM82633A004352'), '3');
  // Never claims a model or engine.
  const d = decodeVin('4T1B11HK8KU123456') as Record<string, unknown>;
  assert.equal(d.model, undefined);
  assert.equal(d.engine, undefined);
});

test('POST /v1/vin/decode returns make + year only, and rejects a bad check digit', async () => {
  const anon = new Client(app);
  const ok = await anon.ok<any>('POST', '/v1/vin/decode', { vin: '4t1b11hk8ku123456' });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.make, { id: 'toyota', name: { ar: 'تويوتا', en: 'Toyota' } });
  assert.equal(ok.modelYear, 2019);
  assert.equal(ok.confidence, 'high');
  assert.ok(ok.reasons.includes('model_engine_required'));
  assert.equal(ok.model, undefined);
  assert.ok(ok.noteAr.length > 0);
  const bad = await anon.ok<any>('POST', '/v1/vin/decode', { vin: '4T1B11HK0KU123456' });
  assert.equal(bad.valid, false);
  assert.deepEqual(bad.reasons, ['check_digit_failed']);
  const honda = await anon.ok<any>('POST', '/v1/vin/decode', { vin: '1HGCM82633A004352' });
  assert.equal(honda.valid, true);
  assert.equal(honda.make, undefined);
  assert.equal(honda.manufacturer, 'Honda');
  assert.equal((await anon.post('/v1/vin/decode', {})).status, 400);
});

// ───────────────────────────── garage

test('add vehicle without trim; engine only required for multi-engine models; odometer editable', async () => {
  const c = await customer(app);
  const v = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4', vin: '4T1B11HK8KU123456' });
  assert.equal(v.trim, undefined);
  assert.equal((await prisma.garageVehicle.findUniqueOrThrow({ where: { id: v.id } })).trim, '');
  const noEngine = await c.post('/v1/me/vehicles', { modelId: 'camry', year: 2022 });
  assert.equal(noEngine.status, 400);
  assert.equal(noEngine.body.error.code, 'ENGINE_REQUIRED');
  const sonata = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'sonata', year: 2021 });
  assert.equal(sonata.engine, '2.5L I4', 'single-engine model defaults its engine');
  assert.equal((await c.post('/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4', trim: 'NOPE' })).status, 400);
  assert.equal((await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4', trim: 'GLE' })).trim, 'GLE');

  const patched = await c.ok<any>('PATCH', `/v1/me/vehicles/${v.id}`, { odometerKm: 61_250 });
  assert.equal(patched.odometerKm, 61_250);
  assert.ok(patched.odometerUpdatedAt);
  assert.equal((await c.req('PATCH', `/v1/me/vehicles/${v.id}`, { odometerKm: -5 })).status, 400);
  const list = await c.ok<any>('GET', '/v1/me/vehicles');
  assert.equal(list.vehicles.find((x: any) => x.id === v.id).odometerKm, 61_250);
  const other = await customer(app);
  assert.equal((await other.req('PATCH', `/v1/me/vehicles/${v.id}`, { odometerKm: 1 })).status, 404, 'scoped to the owner');
});

// ───────────────────────────── maintenance

type StatusCase = { name: string; serviceCode: string; odometerKm: number | null; last: any; now: string; expect: ReturnType<typeof computeServiceStatus> };

test('maintenance status computation (shared fixture with the app)', () => {
  for (const c of fixture<StatusCase[]>('maintenance-status.json')) {
    const t = GENERIC_MAINTENANCE_TEMPLATES.find((x) => x.serviceCode === c.serviceCode)!;
    const r = computeServiceStatus({ intervalKm: t.intervalKm, intervalMonths: t.intervalMonths, variants: t.variants, odometerKm: c.odometerKm, last: c.last, now: new Date(c.now) });
    assert.deepEqual(r, c.expect, c.name);
  }
});

test('templates are generic guidance and kit components match the right products', () => {
  for (const t of GENERIC_MAINTENANCE_TEMPLATES) {
    assert.ok(t.makeId == null && t.modelId == null, 'no manufacturer-specific intervals');
  }
  const oil = GENERIC_MAINTENANCE_TEMPLATES.find((t) => t.serviceCode === 'OIL_CHANGE')!;
  assert.equal(oil.intervalKm, 10_000);
  assert.equal(oil.variants.find((v) => v.code === 'CONVENTIONAL')!.intervalKm, 5_000);
  const [oilC, filterC] = oil.components;
  assert.ok(matchesComponent({ categoryId: 'oils', keywords: ['oil', 'زيت', '0w20'] }, oilC));
  assert.ok(!matchesComponent({ categoryId: 'oils', keywords: ['coolant', 'سائل تبريد'], nameEn: 'Long-life coolant' }, oilC), 'coolant is not engine oil');
  assert.ok(matchesComponent({ categoryId: 'filters', keywords: ['oil filter', 'فلتر'] }, filterC));
  const air = GENERIC_MAINTENANCE_TEMPLATES.find((t) => t.serviceCode === 'AIR_FILTER')!.components[0];
  assert.ok(!matchesComponent({ categoryId: 'filters', keywords: ['cabin filter'], nameEn: 'Cabin air filter' }, air), 'cabin filter is not the engine air filter');
});

test('GET maintenance: statuses from odometer + records, kits respect fitment (catalog first, then by spec)', async () => {
  const c = await customer(app);
  const camry = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4', odometerKm: 52_000 });
  await c.ok('POST', `/v1/me/vehicles/${camry.id}/service-records`, { serviceCode: 'OIL_CHANGE', doneAtKm: 41_000, variant: 'SYNTHETIC', doneAt: new Date(Date.now() - 30 * 86_400_000).toISOString() });
  const m = await c.ok<any>('GET', `/v1/me/vehicles/${camry.id}/maintenance`);
  assert.match(m.disclaimer.ar, /دليل المالك/);
  assert.match(m.disclaimer.en, /owner's manual/);
  const byCode = Object.fromEntries(m.services.map((s: any) => [s.serviceCode, s]));
  assert.deepEqual(Object.keys(byCode).sort(), ['AIR_FILTER', 'BRAKE_PADS', 'CABIN_FILTER', 'COOLANT', 'OIL_CHANGE', 'SPARK_PLUGS']);
  assert.equal(byCode.OIL_CHANGE.status, 'due', '11,000 km since the last synthetic oil change');
  assert.equal(byCode.OIL_CHANGE.remainingKm, -1_000);
  assert.equal(byCode.OIL_CHANGE.lastRecord.doneAtKm, 41_000);
  assert.equal(byCode.CABIN_FILTER.status, 'unknown', 'no record and past the first interval');

  // Oil change kit = cheapest by-spec oil + cheapest catalog-verified oil filter for Camry.
  const kit = byCode.OIL_CHANGE.kit;
  assert.deepEqual(kit.lines.map((l: any) => [l.componentKey, l.productId, l.offerId, l.fit]), [
    ['oil', 'p-oil-0w20-oem', 'o-029', 'universal'],
    ['oilFilter', 'p-oil-filter-kanzen', 'o-017', 'catalog'],
  ]);
  assert.equal(kit.totalHalalas, 12_900 + 2_400);
  assert.deepEqual(kit.missing, []);
  // Spark plugs: catalog fitment is for the 2.5L only.
  assert.equal(byCode.SPARK_PLUGS.kit.lines[0].productId, 'p-spark-iridium');

  const v6 = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '3.5L V6' });
  const mv6 = await c.ok<any>('GET', `/v1/me/vehicles/${v6.id}/maintenance`);
  const sparkV6 = mv6.services.find((s: any) => s.serviceCode === 'SPARK_PLUGS');
  assert.deepEqual(sparkV6.kit.lines, [], 'engine-specific fitment respected');
  assert.equal(sparkV6.kit.missing[0].key, 'sparkPlugs');

  // LX: the Kanzen filter is only seller-reported for LX → never put into a kit.
  const lx = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'lx', year: 2020, engine: '5.7L V8' });
  const mlx = await c.ok<any>('GET', `/v1/me/vehicles/${lx.id}/maintenance`);
  const oilLx = mlx.services.find((s: any) => s.serviceCode === 'OIL_CHANGE').kit;
  assert.deepEqual(oilLx.lines.map((l: any) => l.componentKey), ['oil']);
  assert.deepEqual(oilLx.missing.map((x: any) => x.key), ['oilFilter']);

  // A recorded km reading moves the odometer forward, never backwards.
  await c.ok('POST', `/v1/me/vehicles/${camry.id}/service-records`, { serviceCode: 'CABIN_FILTER', doneAtKm: 53_000 });
  assert.equal((await prisma.garageVehicle.findUniqueOrThrow({ where: { id: camry.id } })).odometerKm, 53_000);
  await c.ok('POST', `/v1/me/vehicles/${camry.id}/service-records`, { serviceCode: 'AIR_FILTER', doneAtKm: 30_000 });
  assert.equal((await prisma.garageVehicle.findUniqueOrThrow({ where: { id: camry.id } })).odometerKm, 53_000);
  assert.equal((await c.post(`/v1/me/vehicles/${camry.id}/service-records`, { serviceCode: 'NOPE' })).status, 400);
  assert.equal((await c.post(`/v1/me/vehicles/${camry.id}/service-records`, { serviceCode: 'OIL_CHANGE', variant: 'NOPE' })).status, 400);
  const other = await customer(app);
  assert.equal((await other.req('GET', `/v1/me/vehicles/${camry.id}/maintenance`)).status, 404);
});

test('a delivered oil order line proposes an ORDER service record', async () => {
  const c = await customer(app);
  const ops = await login(app, 'ops.admin@qitah.test');
  const v = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4' });
  const address = await addAddress(c, 'khobar');
  const { order } = await placeOrder(c, address.id, [{ offerId: 'o-029', quantity: 1 }]);
  await payOnSandboxPage(app, order.payment.redirectUrl);
  await fulfil(app, ops, order.orderId);
  const m = await c.ok<any>('GET', `/v1/me/vehicles/${v.id}/maintenance`);
  assert.equal(m.proposals.length, 1);
  const prop = m.proposals[0];
  assert.equal(prop.serviceCode, 'OIL_CHANGE');
  const rec = await c.ok<any>('POST', `/v1/me/vehicles/${v.id}/service-records`, { serviceCode: 'OIL_CHANGE', orderItemId: prop.orderItemId, doneAtKm: 12_000 });
  assert.equal(rec.source, 'ORDER');
  assert.equal((await c.ok<any>('GET', `/v1/me/vehicles/${v.id}/maintenance`)).proposals.length, 0);
  const dup = await c.post(`/v1/me/vehicles/${v.id}/service-records`, { serviceCode: 'OIL_CHANGE', orderItemId: prop.orderItemId });
  assert.equal(dup.status, 409, 'one record per order line');
  const wrong = await c.post(`/v1/me/vehicles/${v.id}/service-records`, { serviceCode: 'CABIN_FILTER', orderItemId: prop.orderItemId });
  assert.equal(wrong.status, 400);
  const stranger = await customer(app);
  const sv = await stranger.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4' });
  assert.equal((await stranger.post(`/v1/me/vehicles/${sv.id}/service-records`, { serviceCode: 'OIL_CHANGE', orderItemId: prop.orderItemId })).status, 404);
});

test('reminder job: one in-app notification per vehicle, service and due cycle', async () => {
  const c = await customer(app);
  const v = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4', odometerKm: 30_000 });
  await c.ok('POST', `/v1/me/vehicles/${v.id}/service-records`, { serviceCode: 'OIL_CHANGE', doneAtKm: 18_000, doneAt: new Date(Date.now() - 60 * 86_400_000).toISOString() });
  const count = () => prisma.notification.count({ where: { userId: c.userId, type: 'maintenance.due' } });
  await maintenanceReminders();
  assert.equal(await count(), 1, 'oil change due → one reminder');
  const [first, second] = await Promise.all([maintenanceReminders(), maintenanceReminders()]);
  assert.equal(first + second >= 0, true);
  assert.equal(await count(), 1, 'idempotent, also when run concurrently');
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: c.userId, type: 'maintenance.due' } });
  assert.deepEqual(n.data, { vehicleId: v.id, serviceCode: 'OIL_CHANGE' });
  assert.match(n.body, /دليل المالك/);

  // Done → new cycle, not due → nothing. Due again later → exactly one more.
  await c.ok('POST', `/v1/me/vehicles/${v.id}/service-records`, { serviceCode: 'OIL_CHANGE', doneAtKm: 30_000 });
  await maintenanceReminders();
  assert.equal(await count(), 1);
  await c.ok('PATCH', `/v1/me/vehicles/${v.id}`, { odometerKm: 40_500 });
  await maintenanceReminders();
  await maintenanceReminders();
  assert.equal(await count(), 2);
  const inbox = await c.ok<any>('GET', '/v1/me/notifications');
  assert.ok(inbox.notifications.some((x: any) => x.type === 'maintenance.due'));

  // Deleted vehicles get no reminders.
  const gone = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'corolla', year: 2021, engine: '1.6L I4', odometerKm: 9_990 });
  await c.ok('POST', `/v1/me/vehicles/${gone.id}/service-records`, { serviceCode: 'CABIN_FILTER', doneAtKm: 0, doneAt: new Date(Date.now() - 400 * 86_400_000).toISOString() });
  await c.req('DELETE', `/v1/me/vehicles/${gone.id}`);
  await maintenanceReminders();
  assert.equal(await prisma.maintenanceReminder.count({ where: { vehicleId: gone.id } }), 0);
});

// ───────────────────────────── send to my mechanic

async function form(token: string, fields: Record<string, string>) {
  return app.inject({ method: 'POST', url: `/m/${token}`, payload: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}

test('mechanic review: share → public page (escaped, no PII) → suggest/approve → customer sees result', async () => {
  const c = await customer(app);
  await addAddress(c, 'riyadh');
  const v = await c.ok<any>('POST', '/v1/me/vehicles', { modelId: 'camry', year: 2022, engine: '2.5L I4', vin: '4T1B11HK8KU123456' });
  const created = await c.ok<any>('POST', '/v1/me/mechanic-reviews', {
    vehicleId: v.id,
    note: '<script>alert("x")</script> صوت من الأمام',
    lines: [
      { offerId: 'o-001', quantity: 1 },
      { offerId: 'o-017', quantity: 2 },
      { offerId: 'o-029', quantity: 1 },
    ],
  });
  assert.equal(created.status, 'PENDING');
  assert.match(created.url, /^http:\/\/127\.0\.0\.1:4999\/m\/[A-Za-z0-9_-]{43}$/);
  const token = created.url.split('/m/')[1];
  const row = await prisma.mechanicReview.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(row.tokenHash, sha256(token), 'only the token hash is stored');
  assert.ok(!JSON.stringify(row).includes(token));
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 72 * 3600_000) < 60_000, '72h expiry');
  assert.equal(created.lines.find((l: any) => l.offerId === 'o-001').fit, 'catalog');
  assert.equal(created.lines.find((l: any) => l.offerId === 'o-029').fit, 'universal');

  const res = await app.inject({ method: 'GET', url: `/m/${token}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /text\/html/);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  const html = res.body;
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.ok(html.includes('04465-X3301'), 'part number shown');
  assert.ok(html.includes('Toyota Genuine'), 'brand shown');
  assert.ok(html.includes('متوافقة حسب الكتالوج'), 'fitment status shown');
  assert.ok(html.includes('4T1B11HK8KU123456'), 'VIN shown');
  assert.ok(html.includes('كامري'));
  assert.ok(!html.includes('<script>alert'), 'customer note is escaped');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(!html.includes(c.phone) && !html.includes(c.phone.slice(4)), 'no customer phone');
  assert.ok(!html.includes('Test Customer'), 'no customer name');
  assert.ok(!html.includes('شارع تجريبي') && !html.includes('الملقا'), 'no customer address');
  assert.ok(!html.includes('+966500000099'));

  // Invalid form → 400 with the inputs kept, nothing saved.
  const invalid = await form(token, { decision_0: 'approve', decision_1: 'alternative', decision_2: 'approve', workshop_name: 'ورشة <b>النور</b>' });
  assert.equal(invalid.statusCode, 400);
  assert.ok(invalid.body.includes('اكتب البديل المقترح'));
  assert.ok(invalid.body.includes('ورشة &lt;b&gt;النور&lt;/b&gt;'));
  assert.equal((await prisma.mechanicReview.findUniqueOrThrow({ where: { id: created.id } })).status, 'PENDING');
  const badOffer = await form(token, { decision_0: 'approve', decision_1: 'alternative', alt_offer_1: 'o-029', decision_2: 'approve' });
  assert.equal(badOffer.statusCode, 400, 'alternative offer must be for the same product');

  // Line 0 approved, line 1 → another offer of the same product, line 2 → free text + part number.
  const alt = created.lines.find((l: any) => l.offerId === 'o-017').alternatives[0];
  assert.ok(alt, 'same-product alternatives offered');
  const ok = await form(token, {
    decision_0: 'approve',
    decision_1: 'alternative',
    alt_offer_1: alt.offerId,
    decision_2: 'alternative',
    alt_text_2: 'زيت 5W-30 أفضل لهذا المحرك عندنا',
    alt_pn_2: '08880-83322',
    workshop_name: 'ورشة النور',
    workshop_phone: '0551234567',
    mechanic_note: 'جاهزين للتركيب بكرة',
  });
  assert.equal(ok.statusCode, 303);
  const done = await app.inject({ method: 'GET', url: `/m/${token}` });
  assert.equal(done.statusCode, 200);
  assert.ok(done.body.includes('شكراً'));
  assert.equal((await form(token, { decision_0: 'approve', decision_1: 'approve', decision_2: 'approve' })).statusCode, 409, 'cannot resubmit');

  const seen = await c.ok<any>('GET', `/v1/me/mechanic-reviews/${created.id}`);
  assert.equal(seen.status, 'CHANGES_SUGGESTED');
  assert.deepEqual(seen.workshop, { name: 'ورشة النور', phone: '+966551234567' });
  assert.equal(seen.mechanicNote, 'جاهزين للتركيب بكرة');
  assert.equal(seen.lines[2].decision.partNumber, '08880-83322');
  assert.deepEqual(seen.approvedLines, [
    { offerId: 'o-001', quantity: 1 },
    { offerId: alt.offerId, quantity: 2 },
  ]);
  const notes = await c.ok<any>('GET', '/v1/me/notifications');
  const n = notes.notifications.find((x: any) => x.type === 'mechanic_review.responded');
  assert.ok(n);
  assert.equal(n.data.mechanicReviewId, created.id);
  assert.equal((await c.ok<any>('GET', '/v1/me/mechanic-reviews')).reviews[0].id, created.id);

  // Lead data stays on the review; another customer cannot read it.
  const other = await customer(app);
  assert.equal((await other.req('GET', `/v1/me/mechanic-reviews/${created.id}`)).status, 404);
});

test('mechanic review: approve all, expired and invalid tokens rejected, inputs validated', async () => {
  const c = await customer(app);
  const r = await c.ok<any>('POST', '/v1/me/mechanic-reviews', { lines: [{ offerId: 'o-013', quantity: 1 }] });
  const token = r.url.split('/m/')[1];
  assert.equal(r.vehicle, null);
  assert.equal(r.lines[0].fit, 'no_vehicle');
  assert.ok((await app.inject({ method: 'GET', url: `/m/${token}` })).body.includes('لم يحدد العميل السيارة'));
  assert.equal((await form(token, { decision_0: 'approve' })).statusCode, 303);
  const seen = await c.ok<any>('GET', `/v1/me/mechanic-reviews/${r.id}`);
  assert.equal(seen.status, 'APPROVED');
  assert.equal(seen.workshop, null);
  assert.deepEqual(seen.approvedLines, [{ offerId: 'o-013', quantity: 1 }]);

  // Expired link
  const r2 = await c.ok<any>('POST', '/v1/me/mechanic-reviews', { lines: [{ offerId: 'o-013', quantity: 1 }] });
  const t2 = r2.url.split('/m/')[1];
  await prisma.mechanicReview.update({ where: { id: r2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await app.inject({ method: 'GET', url: `/m/${t2}` })).statusCode, 410);
  assert.equal((await form(t2, { decision_0: 'approve' })).statusCode, 410);
  assert.equal((await prisma.mechanicReview.findUniqueOrThrow({ where: { id: r2.id } })).status, 'PENDING');
  assert.equal((await c.ok<any>('GET', `/v1/me/mechanic-reviews/${r2.id}`)).expired, true);

  // Unknown / malformed tokens
  assert.equal((await app.inject({ method: 'GET', url: `/m/${'A'.repeat(43)}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/m/short' })).statusCode, 404);
  assert.equal((await form('A'.repeat(43), { decision_0: 'approve' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/m/${r.id}` })).statusCode, 404, 'the review id is not a token');

  // Create validation
  assert.equal((await c.post('/v1/me/mechanic-reviews', { lines: [] })).status, 400);
  const gone = await c.post('/v1/me/mechanic-reviews', { lines: [{ offerId: 'o-nope', quantity: 1 }] });
  assert.equal(gone.status, 400);
  assert.equal(gone.body.error.code, 'OFFER_UNAVAILABLE');
  const foreignVehicle = await (await customer(app)).ok<any>('POST', '/v1/me/vehicles', { modelId: 'sonata', year: 2021 });
  assert.equal((await c.post('/v1/me/mechanic-reviews', { vehicleId: foreignVehicle.id, lines: [{ offerId: 'o-013', quantity: 1 }] })).status, 404);
  assert.equal((await new Client(app).post('/v1/me/mechanic-reviews', { lines: [{ offerId: 'o-013', quantity: 1 }] })).status, 401);

  assert.equal(normalizeWorkshopPhone('05 5123 4567'), '+966551234567');
  assert.equal(normalizeWorkshopPhone('٠٥٥١٢٣٤٥٦٧'), '+966551234567');
  assert.equal(normalizeWorkshopPhone(''), null);
  assert.throws(() => normalizeWorkshopPhone('call me'));
});
