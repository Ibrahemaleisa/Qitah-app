import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp } from '../src/app.js';
import { blendedBps, resolveCommissionBps, ruleSpecificity, splitRefundByLine, type CommissionRuleLike } from '../src/domain/commission.js';
import { offerFreshness } from '../src/domain/freshness.js';
import { qualityScore as scoreOf } from '../src/domain/scorecard.js';
import { nextSettlementDate, reserveFor, settlementPeriod } from '../src/domain/settlement.js';
import { slaMonitor } from '../src/jobs.js';
import { applyBps } from '../src/lib/money.js';
import { orderChannel } from '../src/services/commission.js';
import { autoSettlements, reconcileOrder, releaseReserves } from '../src/services/finance.js';
import { staleOfferReminders } from '../src/services/freshness.js';
import { acceptSlaMinutes } from '../src/services/payments.js';
import { refreshQualityScores } from '../src/services/scorecard.js';
import { Client, addAddress, config, ctx, customer, fulfil, login, payOnSandboxPage, prisma, resetDatabase, settleSandboxRefunds, startApp } from './helpers.js';

/** Merchant economics: per-line commission rules, payment fees, automatic settlement + reserve, freshness, scorecard. */
let app: Awaited<ReturnType<typeof startApp>>;
let ops: Client;
let financeUser: Client;
before(async () => {
  await resetDatabase();
  app = await startApp();
  ops = await login(app, 'ops.admin@qitah.test');
  financeUser = await login(app, 'finance@qitah.test');
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

const DAY = 86_400_000;
const ownerOf = async (merchantId: string) => {
  const owner = await prisma.merchantMember.findFirstOrThrow({ where: { merchantId, role: 'OWNER' }, include: { user: true } });
  return login(app, owner.user.email!);
};

/** Plans (selected option unless `pick` chooses), checks out with `method`, pays on the sandbox page. */
async function paidOrder(c: Client, addressId: string, lines: { offerId: string; quantity: number }[], method = 'mada', on: typeof app = app, pick?: (o: any) => boolean) {
  const plan = await new Client(on, c.token).ok<any>('POST', '/v1/checkout/plan', { addressId, lines });
  const option = plan.options.find(pick ?? ((o: any) => o.strategy === 'selected'));
  assert.ok(option, JSON.stringify(plan));
  const order = await new Client(on, c.token).ok<any>('POST', '/v1/checkout', { planId: option.planId, idempotencyKey: randomUUID(), paymentMethod: method });
  await payOnSandboxPage(on, order.payment.redirectUrl);
  return order.orderId as string;
}

const rule = (r: Partial<CommissionRuleLike> & { id: string; bps: number }): CommissionRuleLike => ({
  merchantId: null, categoryId: null, origin: null, condition: null, channel: 'ANY', priority: 0, active: true, validFrom: null, validTo: null, ...r,
});

// ───────────────────────────────────────────── commission

test('resolveCommissionBps precedence: merchant rules > merchant rate > platform tiers (most specific) > default', () => {
  const at = new Date('2026-10-28T10:00:00Z');
  const line: { categoryId: string; origin: 'OEM' | 'AFTERMARKET'; condition: 'NEW' | 'USED' | 'REFURBISHED'; channel: 'B2C' | 'B2B' } = { categoryId: 'brakes', origin: 'AFTERMARKET', condition: 'NEW', channel: 'B2C' };
  const m = { id: 'm1', commissionBps: null };
  const r = (rules: CommissionRuleLike[], merchant: { id: string; commissionBps: number | null } = m, l = line) => resolveCommissionBps({ rules, merchant, line: l, at, defaultBps: 1000 });

  assert.deepEqual(r([]), { bps: 1000, source: 'default', ruleId: null }, 'nothing matches → platform default');
  const tiers = [
    rule({ id: 'b2c-am-new', origin: 'AFTERMARKET', condition: 'NEW', channel: 'B2C', bps: 1000 }),
    rule({ id: 'oem', origin: 'OEM', channel: 'B2C', bps: 700 }),
    rule({ id: 'brakes', categoryId: 'brakes', channel: 'B2C', bps: 1300 }),
    rule({ id: 'b2b', channel: 'B2B', bps: 500 }),
  ];
  assert.equal(r(tiers).ruleId, 'brakes', 'category (8+1) beats origin+condition+channel (4+2+1)');
  assert.equal(r(tiers, m, { ...line, categoryId: 'filters' }).ruleId, 'b2c-am-new');
  assert.equal(r(tiers, m, { ...line, categoryId: 'filters', origin: 'OEM' }).bps, 700);
  assert.equal(r(tiers, m, { ...line, categoryId: 'filters', origin: 'OEM', channel: 'B2B' }).ruleId, 'b2b', 'B2B lines never take B2C tiers');

  // Merchant negotiated rate beats platform tiers (B2C only) but not the merchant's own rules.
  const negotiated = { id: 'm1', commissionBps: 850 };
  assert.deepEqual(r(tiers, negotiated), { bps: 850, source: 'merchant', ruleId: null });
  assert.equal(r(tiers, negotiated, { ...line, channel: 'B2B' }).bps, 500, 'negotiated B2C rate does not apply to B2B');
  const merchantOnly = rule({ id: 'm1-all', merchantId: 'm1', bps: 900 });
  const merchantBrakes = rule({ id: 'm1-brakes', merchantId: 'm1', categoryId: 'brakes', bps: 600 });
  assert.equal(r([...tiers, merchantOnly], negotiated).ruleId, 'm1-all', 'an explicit merchant-only rule beats the merchant rate');
  assert.equal(r([...tiers, merchantOnly, merchantBrakes], negotiated).ruleId, 'm1-brakes', 'merchant + category is the most specific');
  assert.equal(r([rule({ id: 'other', merchantId: 'm2', bps: 1 })]).source, 'default', "another merchant's rule never applies");

  // Activity window, active flag, priority and recency.
  assert.equal(r([rule({ id: 'off', categoryId: 'brakes', bps: 1, active: false })]).source, 'default');
  assert.equal(r([rule({ id: 'expired', categoryId: 'brakes', bps: 1, validTo: new Date('2026-10-01') })]).source, 'default');
  assert.equal(r([rule({ id: 'future', categoryId: 'brakes', bps: 1, validFrom: new Date('2026-11-01') })]).source, 'default');
  assert.equal(r([rule({ id: 'a', categoryId: 'brakes', bps: 1 }), rule({ id: 'b', categoryId: 'brakes', bps: 2, priority: 5 })]).ruleId, 'b', 'priority breaks specificity ties');
  assert.equal(
    r([rule({ id: 'old', categoryId: 'brakes', bps: 1, validFrom: new Date('2026-01-01') }), rule({ id: 'promo', categoryId: 'brakes', bps: 2, validFrom: new Date('2026-10-01') })]).ruleId,
    'promo',
    'then the most recent validFrom',
  );
  assert.equal(ruleSpecificity(rule({ id: 'x', merchantId: 'm', bps: 0 })), 16);
  assert.ok(ruleSpecificity(rule({ id: 'x', merchantId: 'm', bps: 0 })) > ruleSpecificity(rule({ id: 'y', categoryId: 'c', origin: 'OEM', condition: 'NEW', channel: 'B2C', bps: 0 })));

  // Refund split: each share reversed at its own line rate, capped at what the line still holds.
  const lines = [
    { orderItemId: 'i1', valueHalalas: 10000, commissionBps: 700, commissionHalalas: 700 },
    { orderItemId: 'i2', valueHalalas: 10000, commissionBps: 1300, commissionHalalas: 1300 },
  ];
  assert.deepEqual(splitRefundByLine(lines, 20000), { commission: 2000, lines: [{ orderItemId: 'i1', items: 10000, commission: 700 }, { orderItemId: 'i2', items: 10000, commission: 1300 }] });
  assert.equal(splitRefundByLine(lines, 5000).commission, applyBps(2500, 700) + applyBps(2500, 1300));
  assert.equal(splitRefundByLine(lines, 20000, new Map([['i1', 700]])).commission, 1300, 'never reverses more than charged');
  assert.equal(blendedBps(20000, 2000), 1000);
  assert.equal(orderChannel({ id: 'o' }), 'B2C', 'every order is B2C until workshop orgs land');
});

test('commission is computed per order line in a mixed-category order and posted per suborder', async () => {
  // Merchant-scoped category rule for cooling (ops API), on top of the seeded tiers.
  const created = await ops.ok<any>('POST', '/v1/ops/commission-rules', { name: 'تبريد — النخبة', merchantId: 's-elite-oils', categoryId: 'cooling', bps: 1300 });
  const bad = await ops.post('/v1/ops/commission-rules', { name: 'x', categoryId: 'nope', bps: 100 });
  assert.equal(bad.status, 400);
  const preview = await ops.ok<any>('GET', '/v1/ops/commission-rules/preview?merchantId=s-elite-oils&categoryId=oils&origin=OEM');
  assert.deepEqual([preview.bps, preview.ruleId], [700, 'cr-default-oem']);

  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  // Same merchant (s-elite-oils): oils OEM, oils aftermarket new, cooling aftermarket.
  const orderId = await paidOrder(c, addr.id, [
    { offerId: 'o-029', quantity: 1 },
    { offerId: 'o-025', quantity: 2 },
    { offerId: 'o-030', quantity: 1 },
  ]);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId }, include: { items: true } });
  const byOffer = (id: string) => mo.items.find((i) => i.offerId === id)!;
  assert.deepEqual([byOffer('o-029').commissionBps, byOffer('o-029').commissionRuleId], [700, 'cr-default-oem']);
  assert.deepEqual([byOffer('o-025').commissionBps, byOffer('o-025').commissionRuleId], [1000, 'cr-default-aftermarket-new']);
  assert.deepEqual([byOffer('o-030').commissionBps, byOffer('o-030').commissionRuleId], [1300, created.id]);
  for (const i of mo.items) assert.equal(i.commissionHalalas, applyBps(i.lineTotalHalalas, i.commissionBps));
  const sum = mo.items.reduce((s, i) => s + i.commissionHalalas, 0);
  assert.equal(mo.commissionHalalas, sum, 'suborder commission = Σ lines');
  assert.equal(mo.commissionBps, blendedBps(mo.itemsHalalas, sum), 'suborder rate is the blended display rate');
  const ledger = await prisma.ledgerEntry.groupBy({ by: ['account'], where: { merchantOrderId: mo.id }, _sum: { amountHalalas: true } });
  const acct = (a: string) => ledger.find((x) => x.account === a)?._sum.amountHalalas ?? 0;
  assert.equal(acct('PLATFORM_COMMISSION'), -sum);
  assert.equal(acct('MERCHANT_PAYABLE'), -(mo.itemsHalalas - sum));
  assert.equal((await reconcileOrder(orderId)).reconciled, true);

  // The merchant sees its effective rates per category.
  const m = await ownerOf('s-elite-oils');
  const rates = await m.ok<any>('GET', '/v1/merchants/s-elite-oils/commission-rates');
  const cell = (cat: string, origin: string, condition: string) => rates.categories.find((x: any) => x.categoryId === cat).rates.find((r: any) => r.origin === origin && r.condition === condition);
  assert.equal(cell('cooling', 'AFTERMARKET', 'NEW').b2c.bps, 1300);
  assert.equal(cell('oils', 'OEM', 'NEW').b2c.bps, 700);
  assert.equal(cell('oils', 'AFTERMARKET', 'USED').b2c.bps, 1200);
  assert.equal(cell('oils', 'AFTERMARKET', 'NEW').b2b.bps, 500);
  const salvage = await (await ownerOf('s-salvage')).ok<any>('GET', '/v1/merchants/s-salvage/commission-rates');
  assert.equal(salvage.categories[0].rates[0].b2c.source, 'merchant', 'negotiated 12% for the salvage yard');
});

test('refunds reverse commission at each line’s own rate (return + goodwill), and the ledger reconciles', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const orderId = await paidOrder(c, addr.id, [
    { offerId: 'o-029', quantity: 1 }, // 700 bps
    { offerId: 'o-030', quantity: 2 }, // 1300 bps (merchant cooling rule from the previous test)
  ]);
  await fulfil(app, ops, orderId);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId }, include: { items: true } });
  const oem = mo.items.find((i) => i.offerId === 'o-029')!;
  const cooling = mo.items.find((i) => i.offerId === 'o-030')!;
  assert.notEqual(oem.commissionBps, cooling.commissionBps);

  // Return the OEM line only: its 7% is reversed, not the suborder's blended rate.
  const view = await c.ok<any>('POST', `/v1/orders/${orderId}/returns`, { items: [{ orderItemId: oem.id, quantity: 1 }], reason: 'notAsDescribed' });
  const rc = view.returns[0];
  const m = await ownerOf('s-elite-oils');
  await m.ok('POST', `/v1/merchants/s-elite-oils/returns/${rc.id}/approve`, {});
  await m.ok('POST', `/v1/merchants/s-elite-oils/returns/${rc.id}/receive`);
  await m.ok('POST', `/v1/merchants/s-elite-oils/returns/${rc.id}/inspect`, { accept: true, restock: true });
  await settleSandboxRefunds(ops);
  const refund = await prisma.refund.findFirstOrThrow({ where: { returnCaseId: rc.id } });
  const alloc = (refund.allocation as any[])[0];
  assert.equal(alloc.commission, oem.commissionHalalas, 'line rate (700 bps), full line');
  assert.notEqual(alloc.commission, applyBps(oem.lineTotalHalalas, mo.commissionBps), 'not the blended rate');
  assert.deepEqual(alloc.lines, [{ orderItemId: oem.id, items: oem.lineTotalHalalas, commission: oem.commissionHalalas }]);

  // Goodwill on the rest of the suborder is split over its lines by value at their own rates (capped per line).
  const goodwill = 1000;
  await financeUser.ok('POST', `/v1/ops/orders/${orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: goodwill, reason: 'تعويض تأخير', idempotencyKey: randomUUID() });
  await settleSandboxRefunds(ops);
  const gw = await prisma.refund.findFirstOrThrow({ where: { orderId, reason: { startsWith: 'OPS:' } } });
  const gwAlloc = (gw.allocation as any[])[0];
  const expected = splitRefundByLine(
    [oem, cooling].map((i) => ({ orderItemId: i.id, valueHalalas: i.lineTotalHalalas, commissionBps: i.commissionBps, commissionHalalas: i.commissionHalalas })),
    goodwill,
    new Map([[oem.id, oem.commissionHalalas]]),
  );
  assert.equal(gwAlloc.commission, expected.commission);
  assert.equal(gwAlloc.lines.find((l: any) => l.orderItemId === oem.id).commission, 0, 'the returned line has no commission left to reverse');

  const ledger = await prisma.ledgerEntry.groupBy({ by: ['account'], where: { merchantOrderId: mo.id }, _sum: { amountHalalas: true } });
  const acct = (a: string) => ledger.find((x) => x.account === a)?._sum.amountHalalas ?? 0;
  assert.equal(acct('PLATFORM_COMMISSION'), -(cooling.commissionHalalas - gwAlloc.commission));
  const rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
});

// ───────────────────────────────────────────── payment fees

test('payment-provider fees are booked at capture as platform cost; reconciliation and margin account for them', async () => {
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const orderId = await paidOrder(c, addr.id, [{ offerId: 'o-016', quantity: 3 }], 'stcPay');
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, merchantOrders: true } });
  const payment = order.payments.find((p) => p.status === 'CAPTURED')!;
  assert.equal(payment.feeBps, config.PAYMENT_FEE_BPS_STC_PAY);
  assert.equal(payment.feeHalalas, applyBps(order.totalHalalas, 150));
  assert.equal(payment.feeEstimated, true, 'sandbox fees are labelled estimates');
  const fee = await prisma.ledgerEntry.findMany({ where: { refId: payment.id, postingType: 'PAYMENT_FEE' } });
  assert.deepEqual(fee.map((l) => [l.account, l.amountHalalas]).sort(), [['CUSTOMER_CLEARING', -payment.feeHalalas], ['PAYMENT_FEES', payment.feeHalalas]].sort());
  // The fee never touches what the merchant is owed.
  const mo = order.merchantOrders[0];
  const payable = await prisma.ledgerEntry.aggregate({ where: { merchantOrderId: mo.id, account: 'MERCHANT_PAYABLE' }, _sum: { amountHalalas: true } });
  assert.equal(payable._sum.amountHalalas, -(mo.itemsHalalas - mo.commissionHalalas));

  let rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
  assert.equal(rec.paymentFeesHalalas, payment.feeHalalas);
  assert.equal(rec.ledger.CUSTOMER_CLEARING, order.totalHalalas - payment.feeHalalas, 'clearing = captured − refunded − fees');

  // Merchant rejects → full refund to the customer; the fee stays a platform cost and the order still reconciles.
  const m = await ownerOf(mo.merchantId);
  await m.ok('POST', `/v1/merchants/${mo.merchantId}/orders/${mo.id}/reject`, { reason: 'OUT_OF_STOCK' });
  await settleSandboxRefunds(ops);
  rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
  assert.equal(rec.refundedHalalas, order.totalHalalas, 'customer gets everything back');
  assert.equal(rec.ledger.CUSTOMER_CLEARING, -payment.feeHalalas);
  assert.equal(rec.margin.contributionHalalas, -payment.feeHalalas, 'a rejected order costs the platform its payment fee');

  // A mada order: margin = commission + shipping margin − fees − guarantee.
  const madaId = await paidOrder(c, addr.id, [{ offerId: 'o-016', quantity: 1 }], 'mada');
  const margins = await financeUser.ok<any>('GET', '/v1/ops/finance/margins?limit=10');
  const row = margins.items.find((i: any) => i.orderId === madaId);
  const madaOrder = await prisma.order.findUniqueOrThrow({ where: { id: madaId }, include: { merchantOrders: true, payments: true } });
  assert.equal(row.paymentFeesHalalas, applyBps(madaOrder.totalHalalas, config.PAYMENT_FEE_BPS_MADA));
  assert.equal(row.commissionHalalas, madaOrder.merchantOrders[0].commissionHalalas);
  assert.equal(row.contributionHalalas, row.commissionHalalas + row.shippingMarginHalalas - row.paymentFeesHalalas - row.guaranteeExpenseHalalas);
  assert.equal(row.feesEstimated, true);
  assert.ok(margins.totals.contributionHalalas <= margins.totals.commissionHalalas + margins.totals.shippingMarginHalalas);
  const total = await prisma.ledgerEntry.aggregate({ _sum: { amountHalalas: true } });
  assert.equal(total._sum.amountHalalas, 0, 'global ledger balances');
});

// ───────────────────────────────────────────── freshness

test('stale offers are flagged and ranked lower, hidden after M days, and a one-click reconfirm restores them', async () => {
  const anon = new Client(app);
  const detail = async () => (await anon.ok<any>('GET', '/v1/catalog/products/p-oil-5w30')).product.offers as any[];
  const before = await detail();
  assert.equal(before[0].id, 'o-025', 'cheapest fresh offer first');
  assert.ok(before.every((o) => o.stale === false));

  // 8 days without confirmation → stale: flagged, still purchasable, ranked below fresh offers despite the lowest price.
  await prisma.offer.update({ where: { id: 'o-025' }, data: { lastConfirmedAt: new Date(Date.now() - 8 * DAY) } });
  const stale = await detail();
  assert.deepEqual(stale.map((o) => o.id), ['o-026', 'o-027', 'o-025']);
  assert.equal(stale[2].stale, true);
  assert.equal((await anon.ok<any>('GET', '/v1/catalog/offers?ids=o-025')).offers[0].purchasable, true);

  // Reminder job: one notification per merchant per day.
  assert.ok((await staleOfferReminders()) >= 1);
  assert.equal(await staleOfferReminders(), 0, 'idempotent within the day');
  const notes = await prisma.notification.findMany({ where: { merchantId: 's-elite-oils', type: 'offers.stale_reminder' } });
  assert.equal(notes.length, 1);

  // 22 days → hidden from public listing and purchase.
  await prisma.offer.update({ where: { id: 'o-025' }, data: { lastConfirmedAt: new Date(Date.now() - 22 * DAY) } });
  assert.equal(offerFreshness(new Date(Date.now() - 22 * DAY)), 'hidden');
  assert.ok(!(await detail()).some((o) => o.id === 'o-025'), 'not on the product page');
  assert.equal((await anon.ok<any>('GET', '/v1/catalog/offers?ids=o-025')).offers[0].purchasable, false);
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-025', quantity: 1 }] });
  assert.ok(plan.options.every((o: any) => o.groups.every((g: any) => g.lines.every((l: any) => l.offerId !== 'o-025'))), 'never planned');
  assert.equal(plan.lines[0].selectedAvailable, 0);

  // Hidden between planning and checkout → refused at checkout.
  await prisma.offer.update({ where: { id: 'o-016' }, data: { lastConfirmedAt: new Date() } });
  const p2 = await c.ok<any>('POST', '/v1/checkout/plan', { addressId: addr.id, lines: [{ offerId: 'o-016', quantity: 1 }] });
  const sel = p2.options.find((o: any) => o.strategy === 'selected');
  await prisma.offer.update({ where: { id: 'o-016' }, data: { lastConfirmedAt: new Date(Date.now() - 30 * DAY) } });
  const refused = await c.post('/v1/checkout', { planId: sel.planId, idempotencyKey: randomUUID(), paymentMethod: 'mada' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'OFFER_UNAVAILABLE');

  // The merchant sees the problem and confirms everything with one click.
  const m = await ownerOf('s-elite-oils');
  const summary = await m.ok<any>('GET', '/v1/merchants/s-elite-oils/offers/freshness');
  assert.equal(summary.hidden, 2);
  const list = await m.ok<any>('GET', '/v1/merchants/s-elite-oils/offers?limit=100');
  assert.equal(list.items.find((o: any) => o.id === 'o-025').freshness, 'hidden');
  const confirmed = await m.ok<any>('POST', '/v1/merchants/s-elite-oils/offers/confirm', {});
  assert.ok(confirmed.confirmed >= 2);
  const restored = await detail();
  assert.equal(restored[0].id, 'o-025', 'back on top: fresh and cheapest');
  assert.equal(restored[0].stale, false);
  assert.equal((await m.ok<any>('GET', '/v1/merchants/s-elite-oils/offers/freshness')).hidden, 0);

  // Any stock update also confirms.
  await prisma.offer.update({ where: { id: 'o-026' }, data: { lastConfirmedAt: new Date(Date.now() - 9 * DAY) } });
  const eastern = await ownerOf('s-eastern');
  await eastern.ok('PUT', '/v1/merchants/s-eastern/offers/o-026/stock', { onHand: 60, reason: 'CORRECTION' });
  assert.equal((await detail()).find((o) => o.id === 'o-026').stale, false);
});

// ───────────────────────────────────────────── fast acceptance SLA

test('same-day orders get the fast acceptance SLA and the SLA monitor flags a breach', async () => {
  assert.equal(acceptSlaMinutes(60, ['sameDay'], 15), 15);
  assert.equal(acceptSlaMinutes(10, ['sameDay'], 15), 10, "never longer than the merchant's own SLA");
  assert.equal(acceptSlaMinutes(60, ['standard'], 15), 60);

  const early = await buildApp(config, { clock: () => new Date('2026-10-28T08:00:00Z') }); // 11:00 Riyadh, before cutoff
  try {
    const c = await customer(early);
    const addr = await addAddress(c, 'riyadh');
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: 's-riyadh-center' } });
    const sameDayId = await paidOrder(c, addr.id, [{ offerId: 'o-001', quantity: 1 }], 'mada', early, (o) => o.groups.every((g: any) => g.serviceCode === 'sameDay'));
    const fast = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: sameDayId }, include: { order: true, groups: true } });
    assert.equal(fast.groups[0].serviceCode, 'sameDay');
    const fastMinutes = (fast.acceptBy!.getTime() - fast.order.paidAt!.getTime()) / 60_000;
    assert.ok(Math.abs(fastMinutes - config.SLA_SAME_DAY_ACCEPT_MINUTES) < 0.1, `same-day accept SLA ${fastMinutes} min`);

    const standardId = await paidOrder(c, addr.id, [{ offerId: 'o-001', quantity: 1 }], 'mada', early, (o) => o.groups.every((g: any) => g.serviceCode !== 'sameDay'));
    const slow = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: standardId }, include: { order: true } });
    assert.ok(Math.abs((slow.acceptBy!.getTime() - slow.order.paidAt!.getTime()) / 60_000 - merchant.slaAcceptMinutes) < 0.1, 'other services keep the merchant SLA');

    // 16 minutes later the same-day order is breached, the standard one is not.
    await slaMonitor(new Date(fast.order.paidAt!.getTime() + 16 * 60_000));
    assert.equal((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: fast.id } })).slaBreached, true);
    assert.equal((await prisma.merchantOrder.findUniqueOrThrow({ where: { id: slow.id } })).slaBreached, false);
  } finally {
    await early.close();
  }
});

// ───────────────────────────────────────────── scorecard

test('scorecard metrics on a seeded scenario; quality score formula, warnings, endpoints and offer tiebreak', async () => {
  const M = 's-quickfix';
  const m = await ownerOf(M);
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const line = [{ offerId: 'o-050', quantity: 1 }];
  // #1 accepted, ready on time, delivered
  const o1 = await paidOrder(c, addr.id, line);
  await fulfil(app, ops, o1);
  // #2 rejected: out of stock
  const o2 = await paidOrder(c, addr.id, line);
  const mo2 = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: o2 } });
  await m.ok('POST', `/v1/merchants/${M}/orders/${mo2.id}/reject`, { reason: 'OUT_OF_STOCK', note: 'نفد' });
  // #3 accepted, but ready after its readyBy
  const o3 = await paidOrder(c, addr.id, line);
  const mo3 = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: o3 } });
  await m.ok('POST', `/v1/merchants/${M}/orders/${mo3.id}/accept`);
  await prisma.merchantOrder.update({ where: { id: mo3.id }, data: { readyBy: new Date(Date.now() - 60_000) } });
  await m.ok('POST', `/v1/merchants/${M}/orders/${mo3.id}/pack`);
  await m.ok('POST', `/v1/merchants/${M}/orders/${mo3.id}/ready`);
  // #4 delivered, then returned as not-as-described
  const o4 = await paidOrder(c, addr.id, line);
  await fulfil(app, ops, o4);
  const item4 = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o4 } });
  await c.ok('POST', `/v1/orders/${o4}/returns`, { items: [{ orderItemId: item4.id, quantity: 1 }], reason: 'notAsDescribed' });
  // One stale offer out of the merchant's active ones.
  await prisma.offer.update({ where: { id: 'o-022' }, data: { lastConfirmedAt: new Date(Date.now() - 10 * DAY) } });
  const activeOffers = await prisma.offer.count({ where: { merchantId: M, status: 'ACTIVE', visibility: 'PUBLIC' } });

  const card = await m.ok<any>('GET', `/v1/merchants/${M}/scorecard`);
  const d = card.d30;
  assert.deepEqual(
    [d.received, d.accepted, d.rejected, d.outOfStockRejected, d.ready, d.readyOnTime, d.delivered, d.badReturns],
    [4, 3, 1, 1, 3, 2, 2, 1],
  );
  assert.equal(d.acceptanceRate, 0.75);
  assert.equal(d.outOfStockRate, 0.25);
  assert.equal(d.cancellationRate, 0.25);
  assert.ok(Math.abs(d.onTimeReadyRate - 2 / 3) < 1e-9);
  assert.equal(d.badReturnRate, 0.5);
  assert.ok(d.avgAcceptMinutes !== null && d.avgAcceptMinutes <= 1);
  assert.deepEqual(card.d90.received, 4);
  assert.equal(card.offers.active, activeOffers);
  assert.equal(card.offers.stale, 1);
  assert.ok(Math.abs(card.offers.freshnessRate - (activeOffers - 1) / activeOffers) < 1e-9);
  assert.equal(card.qualityScore, scoreOf(card.d90, card.offers.freshnessRate));
  // Hand-computed formula for this scenario: components shrunk toward 0.8 with weight 5.
  const f = card.offers.freshnessRate;
  const manual = Math.round(30 * ((4 * 0 + 4) / 9) + 20 * f + 15 * ((4 * 0.75 + 4) / 9) + 15 * ((3 * (2 / 3) + 4) / 8) + 10 * ((2 * 0 + 4) / 7) + 10 * ((3 * 1 + 4) / 8));
  assert.equal(card.qualityScore, manual);
  assert.ok(card.warnings.includes('OUT_OF_STOCK_HIGH'), 'out-of-stock rejection > 3%');
  if (f < 0.9) assert.ok(card.warnings.includes('FRESHNESS_LOW'));
  assert.ok(card.warnings.includes('BAD_RETURNS_HIGH'));

  // Scoped: another merchant cannot read it; ops sees everyone, worst first.
  assert.equal((await (await ownerOf('s-eastern')).get(`/v1/merchants/${M}/scorecard`)).status, 403);
  const perf = await ops.ok<any>('GET', '/v1/ops/merchants/performance');
  const row = perf.items.find((x: any) => x.merchant.id === M);
  assert.equal(row.qualityScore, card.qualityScore);
  assert.ok(perf.items.every((x: any, i: number) => i === 0 || perf.items[i - 1].qualityScore <= x.qualityScore));
  const fresh = perf.items.find((x: any) => x.merchant.id === 's-salvage');
  assert.equal(fresh.d30.received, 0);
  assert.equal(fresh.qualityScore, scoreOf(fresh.d90, fresh.offers.freshnessRate), 'no orders → neutral prior on order metrics');

  // Cached score is exposed on offers and sellers, and breaks price ties in offer comparison.
  assert.ok((await refreshQualityScores()) >= 1);
  assert.equal((await prisma.merchant.findUniqueOrThrow({ where: { id: M } })).qualityScore, card.qualityScore);
  await prisma.offer.updateMany({ where: { id: { in: ['o-004', 'o-005'] } }, data: { priceHalalas: 20000 } });
  await prisma.merchant.update({ where: { id: 's-brake-house' }, data: { qualityScore: 95 } });
  await prisma.merchant.update({ where: { id: 's-eastern' }, data: { qualityScore: 60 } });
  const pd = await new Client(app).ok<any>('GET', '/v1/catalog/products/p-camry-pads-ceramic');
  const tied = pd.product.offers.filter((o: any) => o.priceHalalas === 20000).map((o: any) => [o.id, o.qualityScore]);
  assert.deepEqual(tied, [['o-004', 95], ['o-005', 60]], 'higher quality wins the tie');
  assert.equal(pd.sellers.find((s: any) => s.id === 's-brake-house').qualityScore, 95);
  await prisma.merchant.update({ where: { id: 's-brake-house' }, data: { qualityScore: 50 } });
  const pd2 = await new Client(app).ok<any>('GET', '/v1/catalog/products/p-camry-pads-ceramic');
  assert.deepEqual(pd2.product.offers.filter((o: any) => o.priceHalalas === 20000).map((o: any) => o.id), ['o-005', 'o-004']);
});

// ───────────────────────────────────────────── automatic settlement

test('settlement scheduling helpers', () => {
  // 2026-10-28 is a Wednesday (Riyadh). Weekly runs on Sunday (0).
  const wed = new Date('2026-10-28T10:00:00Z');
  assert.deepEqual(settlementPeriod('WEEKLY', 0, wed), { key: 'W:2026-10-25', startDate: '2026-10-25' });
  assert.deepEqual(settlementPeriod('DAILY', 0, wed), { key: 'D:2026-10-28', startDate: '2026-10-28' });
  assert.equal(settlementPeriod('DAILY', 0, new Date('2026-10-28T22:00:00Z')).key, 'D:2026-10-29', 'Riyadh day rolls over at 21:00 UTC');
  assert.equal(nextSettlementDate('WEEKLY', 0, wed, true), '2026-11-01');
  assert.equal(nextSettlementDate('WEEKLY', 0, wed, false), '2026-10-28', 'overdue period runs today');
  assert.equal(nextSettlementDate('DAILY', 0, wed, true), '2026-10-29');
  assert.equal(reserveFor(10602, 1000), 1060);
  assert.equal(reserveFor(-50, 1000), 0);
});

test('automatic weekly settlement job drafts once per period and is idempotent (also under concurrency)', async () => {
  const M = 's-brake-house';
  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const orderId = await paidOrder(c, addr.id, [{ offerId: 'o-011', quantity: 1 }]);
  await fulfil(app, ops, orderId);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });

  // Return window still open: the run for this week records its mark but drafts nothing for this merchant.
  await autoSettlements(ctx, new Date());
  assert.equal(await prisma.settlement.count({ where: { merchantId: M } }), 0);

  // Next week (window closed): exactly one DRAFT, even with concurrent workers and reruns.
  const later = new Date(Date.now() + 8 * DAY);
  await Promise.all([autoSettlements(ctx, later), autoSettlements(ctx, later)]);
  await autoSettlements(ctx, new Date(later.getTime() + 3600_000));
  const settlements = await prisma.settlement.findMany({ where: { merchantId: M }, include: { lines: true } });
  assert.equal(settlements.length, 1);
  const s = settlements[0];
  assert.deepEqual([s.status, s.automatic, s.reserveHeldHalalas], ['DRAFT', true, 0]);
  const line = s.lines.find((l) => l.merchantOrderId === mo.id)!;
  assert.equal(line.kind, 'SALE');
  assert.equal(line.netHalalas, mo.itemsHalalas - mo.commissionHalalas);
  const mark = await prisma.jobRunMark.findUniqueOrThrow({ where: { key: `settlement:${M}:${settlementPeriod('WEEKLY', config.SETTLEMENT_WEEKDAY, later).key}` } });
  assert.equal((mark.result as any).settlementId, s.id);
  assert.ok(await prisma.notification.findFirst({ where: { merchantId: M, type: 'settlement.draft' } }));

  // Approval and payout stay manual, with finance roles only.
  const agent = await ops.post(`/v1/ops/settlements/${s.id}/approve`);
  assert.equal(agent.status, 200, 'ops admin may approve');
  const m = await ownerOf(M);
  assert.equal((await m.post(`/v1/ops/settlements/${s.id}/paid`, { payoutReference: 'X-1' })).status, 403);
  await financeUser.ok('POST', `/v1/ops/settlements/${s.id}/paid`, { payoutReference: 'SANDBOX-WEEKLY-1' });
  const view = await m.ok<any>('GET', `/v1/merchants/${M}/settlements`);
  assert.equal(view.balance.payableHalalas, 0);
  assert.equal(view.payout.cadence, 'WEEKLY');
  assert.equal(view.payout.earlyPayout, false);
  assert.match(view.payout.nextSettlementDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(view.settlements[0].lines[0].kind, 'SALE');
});

test('DAILY trusted merchant: early payout right after delivery with a reserve, released after the window (net of later refunds)', async () => {
  const M = 's-riyadh-center';
  const forbidden = await (await ownerOf(M)).patch(`/v1/ops/merchants/${M}/economics`, { settlementCadence: 'DAILY' });
  assert.equal(forbidden.status, 403);
  await financeUser.ok('PATCH', `/v1/ops/merchants/${M}/economics`, { settlementCadence: 'DAILY', trustedForEarlyPayout: true });

  const c = await customer(app);
  const addr = await addAddress(c, 'riyadh');
  const orderId = await paidOrder(c, addr.id, [{ offerId: 'o-013', quantity: 3 }]);
  await fulfil(app, ops, orderId);
  const mo = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId } });
  const payable = mo.itemsHalalas - mo.commissionHalalas;
  const reserve = applyBps(payable, config.SETTLEMENT_RESERVE_BPS);

  const now = new Date();
  await autoSettlements(ctx, now);
  await autoSettlements(ctx, now);
  const early = await prisma.settlement.findMany({ where: { merchantId: M }, include: { lines: true } });
  assert.equal(early.length, 1, 'one draft per day');
  const sale = early[0].lines.find((l) => l.merchantOrderId === mo.id)!;
  assert.deepEqual([sale.kind, sale.reserveHalalas, sale.netHalalas], ['SALE', reserve, payable - reserve], 'paid before the window closes, minus the reserve');
  assert.equal(early[0].reserveHeldHalalas, reserve);
  const moAcct = async (a: string) => (await prisma.ledgerEntry.aggregate({ where: { merchantOrderId: mo.id, account: a as 'MERCHANT_RESERVE' }, _sum: { amountHalalas: true } }))._sum.amountHalalas ?? 0;
  assert.equal(await moAcct('MERCHANT_RESERVE'), -reserve);
  const m = await ownerOf(M);
  let view = await m.ok<any>('GET', `/v1/merchants/${M}/settlements`);
  assert.equal(view.payout.earlyPayout, true);
  assert.equal(view.payout.reserveHeldHalalas, reserve);
  assert.equal(view.payout.inReviewHalalas, payable - reserve);
  await financeUser.ok('POST', `/v1/ops/settlements/${early[0].id}/approve`);
  await financeUser.ok('POST', `/v1/ops/settlements/${early[0].id}/paid`, { payoutReference: 'SANDBOX-DAILY-1' });

  // While the window is open the reserve stays held.
  assert.equal(await releaseReserves(ctx, now), 0);
  // A goodwill refund after the early payout is charged against the reserve.
  const goodwill = 500;
  await financeUser.ok('POST', `/v1/ops/orders/${orderId}/refunds`, { merchantOrderId: mo.id, amountHalalas: goodwill, reason: 'تعويض', idempotencyKey: randomUUID() });
  await settleSandboxRefunds(ops);
  const gw = await prisma.refund.findFirstOrThrow({ where: { orderId, reason: { startsWith: 'OPS:' } } });
  const refundNet = goodwill - (gw.allocation as any[])[0].commission;

  const later = new Date(Date.now() + 8 * DAY);
  assert.equal(await releaseReserves(ctx, later), 1);
  assert.equal(await releaseReserves(ctx, later), 0, 'released once');
  assert.equal(await moAcct('MERCHANT_RESERVE'), 0);
  await autoSettlements(ctx, later);
  await autoSettlements(ctx, later);
  const all = await prisma.settlement.findMany({ where: { merchantId: M }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
  assert.equal(all.length, 2);
  const release = all[1].lines.find((l) => l.merchantOrderId === mo.id)!;
  assert.deepEqual([release.kind, release.reserveHalalas, release.netHalalas, release.refundsHalalas], ['RESERVE_RELEASE', reserve, reserve - refundNet, refundNet]);
  assert.equal(all[1].reserveReleasedHalalas, reserve);
  await financeUser.ok('POST', `/v1/ops/settlements/${all[1].id}/approve`);
  await financeUser.ok('POST', `/v1/ops/settlements/${all[1].id}/paid`, { payoutReference: 'SANDBOX-DAILY-2' });

  // In total the merchant received exactly what the order earned after the refund; everything balances.
  view = await m.ok<any>('GET', `/v1/merchants/${M}/settlements`);
  assert.equal(view.balance.reserveHeldHalalas, 0);
  const paid = all.reduce((s, x) => s + x.lines.filter((l) => l.merchantOrderId === mo.id).reduce((a, l) => a + l.netHalalas, 0), 0);
  assert.equal(paid, payable - refundNet);
  const rec = await reconcileOrder(orderId);
  assert.equal(rec.reconciled, true, JSON.stringify(rec.issues));
  const total = await prisma.ledgerEntry.aggregate({ _sum: { amountHalalas: true } });
  assert.equal(total._sum.amountHalalas, 0);
});
