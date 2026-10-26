import assert from 'node:assert/strict';
import { test } from 'node:test';

import { optimizeCart, type Candidate } from '../src/domain/optimizer.js';
import { allocate, applyBps, vatOfInclusive } from '../src/lib/money.js';
import { SandboxCarrier } from '../src/providers/carrier/sandbox.js';
import { signSandboxPayload, SandboxPaymentProvider } from '../src/providers/payment/sandbox.js';
import { parseCsv, parseSarToHalalas } from '../src/routes/merchant.js';
import { canTransition, MERCHANT_ORDER_TRANSITIONS, SHIPMENT_TRANSITIONS } from '../src/domain/states.js';

const carrier = new SandboxCarrier('http://x');
const rates = carrier.rates.bind(carrier);

const cand = (o: Partial<Candidate> & Pick<Candidate, 'offerId' | 'merchantId' | 'locationId' | 'originCity' | 'priceHalalas'>): Candidate => ({
  available: 10, dispatchDaysMax: 1, weightGrams: 1000, dimsCm: [20, 20, 10], handling: 'STANDARD', ...o,
});

test('money: integer VAT, bps and allocation never drift', () => {
  assert.equal(vatOfInclusive(11500), 1500);
  assert.equal(vatOfInclusive(100), 13);
  assert.equal(applyBps(38900, 1000), 3890);
  assert.equal(applyBps(5, 1000), 1);
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocate(9999, [3, 7, 11]).reduce((a, b) => a + b), 9999);
  assert.throws(() => vatOfInclusive(10.5));
});

test('money: SAR parsing is exact', () => {
  assert.equal(parseSarToHalalas('12.5'), 1250);
  assert.equal(parseSarToHalalas('0.07'), 7);
  assert.equal(parseSarToHalalas('389'), 38900);
  assert.throws(() => parseSarToHalalas('1.234'));
  assert.throws(() => parseSarToHalalas('-1'));
});

test('csv parser handles quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('carrier: same-day only within a city; hazmat ground only; oversized freight only', () => {
  const base = { originCity: 'riyadh', destinationCity: 'riyadh', weightGrams: 2000, maxDimsCm: [20, 20, 10] as [number, number, number], handling: 'STANDARD' as const, itemCount: 1 };
  assert.deepEqual(rates(base).map((r) => r.serviceCode).sort(), ['express', 'sameDay', 'standard']);
  assert.deepEqual(rates({ ...base, destinationCity: 'jeddah' }).map((r) => r.serviceCode).sort(), ['express', 'standard']);
  assert.deepEqual(rates({ ...base, handling: 'HAZMAT' }).map((r) => r.serviceCode), ['standard']);
  assert.deepEqual(rates({ ...base, handling: 'OVERSIZED' }).map((r) => r.serviceCode), ['freight']);
  assert.ok(rates(base).every((r) => r.sandbox && Number.isInteger(r.amountHalalas)));
  assert.deepEqual(rates({ ...base, destinationCity: 'nowhere' }), []);
});

test('optimizer: lowest total accounts for shipping, not just item price', () => {
  // A: cheap items split over two merchants in another region; B: one merchant locally slightly pricier.
  const r = optimizeCart(
    [
      { key: 'l1', quantity: 1, selectedOfferId: 'far1', candidates: [cand({ offerId: 'far1', merchantId: 'm1', locationId: 'L1', originCity: 'jeddah', priceHalalas: 10000 }), cand({ offerId: 'near1', merchantId: 'm3', locationId: 'L3', originCity: 'riyadh', priceHalalas: 10800 })] },
      { key: 'l2', quantity: 1, selectedOfferId: 'far2', candidates: [cand({ offerId: 'far2', merchantId: 'm2', locationId: 'L2', originCity: 'dammam', priceHalalas: 5000 }), cand({ offerId: 'near2', merchantId: 'm3', locationId: 'L3', originCity: 'riyadh', priceHalalas: 5400 })] },
    ],
    'riyadh',
    rates,
  );
  const selected = r.options.find((o) => o.strategy === 'selected')!;
  const lowest = r.options.find((o) => o.bestFor.includes('lowest_total'))!;
  assert.equal(selected.shipmentCount, 2);
  assert.equal(lowest.shipmentCount, 1);
  assert.ok(lowest.totalHalalas < selected.totalHalalas, `${lowest.totalHalalas} < ${selected.totalHalalas}`);
  assert.equal(lowest.totalHalalas, lowest.itemsHalalas + lowest.shippingHalalas);
  assert.ok(lowest.bestFor.includes('fewest_shipments'));
});

test('optimizer: respects stock and same location grouping; isolates hazmat', () => {
  const r = optimizeCart(
    [
      { key: 'a', quantity: 3, candidates: [cand({ offerId: 'x', merchantId: 'm', locationId: 'L', originCity: 'riyadh', priceHalalas: 100, available: 2 })] },
    ],
    'riyadh',
    rates,
  );
  assert.deepEqual(r.unavailable, ['a']);
  const h = optimizeCart(
    [
      { key: 'a', quantity: 1, selectedOfferId: 'bat', candidates: [cand({ offerId: 'bat', merchantId: 'm', locationId: 'L', originCity: 'riyadh', priceHalalas: 30000, handling: 'HAZMAT', weightGrams: 19000 })] },
      { key: 'b', quantity: 1, selectedOfferId: 'oil', candidates: [cand({ offerId: 'oil', merchantId: 'm', locationId: 'L', originCity: 'riyadh', priceHalalas: 9000 })] },
    ],
    'riyadh',
    rates,
  );
  const sel = h.options.find((o) => o.strategy === 'selected')!;
  assert.equal(sel.shipmentCount, 2, 'hazmat battery ships separately from the oil');
  assert.equal(sel.groups.find((g) => g.handling === 'HAZMAT')!.rate.serviceCode, 'standard');
});

test('optimizer: fastest prefers quicker option and is deterministic', () => {
  const input = [
    { key: 'a', quantity: 1, selectedOfferId: 'slow', candidates: [cand({ offerId: 'slow', merchantId: 'm1', locationId: 'L1', originCity: 'jeddah', priceHalalas: 1000, dispatchDaysMax: 3 }), cand({ offerId: 'fast', merchantId: 'm2', locationId: 'L2', originCity: 'riyadh', priceHalalas: 2000, dispatchDaysMax: 0 })] },
  ];
  const a = optimizeCart(input, 'riyadh', rates);
  const b = optimizeCart(input, 'riyadh', rates);
  assert.deepEqual(a, b);
  const fastest = a.options.find((o) => o.bestFor.includes('fastest'))!;
  assert.equal(fastest.groups[0].lines[0].offerId, 'fast');
  assert.equal(fastest.etaDaysMax, 0);
});

test('state machines reject skipping steps', () => {
  assert.equal(canTransition(MERCHANT_ORDER_TRANSITIONS, 'NEW', 'READY_FOR_PICKUP'), false);
  assert.equal(canTransition(MERCHANT_ORDER_TRANSITIONS, 'DELIVERED', 'CANCELLED'), false);
  assert.equal(canTransition(SHIPMENT_TRANSITIONS, 'PENDING', 'DELIVERED'), false);
  assert.equal(canTransition(SHIPMENT_TRANSITIONS, 'PICKUP_FAILED', 'PICKUP_SCHEDULED'), true);
});

test('sandbox payment webhook signature: valid, tampered, stale', () => {
  const p = new SandboxPaymentProvider('http://x', 'secret-secret-123');
  const body = JSON.stringify({ id: 'e1', type: 'payment.captured', providerPaymentId: 'p', amountHalalas: 100 });
  assert.equal(p.verifyWebhook(body, { 'x-qitah-sandbox-signature': signSandboxPayload('secret-secret-123', body) }).id, 'e1');
  assert.throws(() => p.verifyWebhook(body.replace('100', '1'), { 'x-qitah-sandbox-signature': signSandboxPayload('secret-secret-123', body) }));
  assert.throws(() => p.verifyWebhook(body, { 'x-qitah-sandbox-signature': signSandboxPayload('secret-secret-123', body, Math.floor(Date.now() / 1000) - 3600) }));
  assert.throws(() => p.verifyWebhook(body, {}));
});
