import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { reconcileOrder } from '../src/services/finance.js';
import { Client, addAddress, customer, login, payOnSandboxPage, placeOrder, prisma, resetDatabase, startApp } from './helpers.js';

/**
 * "قطعة للورش": workshop organisations, NET_TERMS credit (Qitah internal sandbox ledger), repayments,
 * credit refunds, workshop→customer quotes, and proof that retail checkout is unaffected.
 */
let app: Awaited<ReturnType<typeof startApp>>;
let ops: Client;
let finance: Client;
before(async () => {
  await resetDatabase();
  app = await startApp();
  ops = await login(app, 'ops.admin@qitah.test');
  finance = await login(app, 'finance@qitah.test');
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

type Customer = Awaited<ReturnType<typeof customer>>;
let crSeq = 1010000000;
const phone = () => `+9665${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

async function stockedOffers(n: number) {
  const rows = await prisma.offer.findMany({
    where: {
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      merchant: { status: 'APPROVED', supportsWorkshopDelivery: true },
      location: { active: true },
      product: { status: 'ACTIVE' },
      inventory: { onHand: { gte: 20 } },
    },
    orderBy: { priceHalalas: 'asc' },
    take: n,
  });
  assert.equal(rows.length, n, 'seed has enough stocked offers');
  return rows;
}

/** Applies as `owner`, approves via ops, optionally sets a credit line. Returns the org id. */
async function approvedWorkshop(owner: Customer, credit?: { limitHalalas: number; termsDays?: number }) {
  const applied = await owner.ok<any>('POST', '/v1/orgs', {
    legalName: 'مؤسسة ورشة الاختبار', displayName: 'ورشة الاختبار', crNumber: String(crSeq++), city: 'riyadh', district: 'الصناعية', address: 'شارع 10', contactPhone: owner.phone,
  });
  const orgId = applied.org.id as string;
  await ops.ok('POST', `/v1/ops/organizations/${orgId}/approve`);
  if (credit) await ops.ok('PUT', `/v1/ops/organizations/${orgId}/credit`, { limitHalalas: credit.limitHalalas, termsDays: credit.termsDays ?? 30, status: 'ACTIVE' });
  return orgId;
}

async function planFor(c: Client, addressId: string, lines: { offerId: string; quantity: number }[]) {
  const plan = await c.ok<any>('POST', '/v1/checkout/plan', { addressId, lines });
  const option = plan.options.find((o: any) => o.strategy === 'selected');
  assert.ok(option, JSON.stringify(plan));
  return option as { planId: string; totalHalalas: number };
}

const checkoutRaw = (c: Client, body: Record<string, unknown>) => c.post<any>('/v1/checkout', { idempotencyKey: randomUUID(), ...body });

async function assertBalancedLedger() {
  const postings = await prisma.ledgerEntry.groupBy({ by: ['postingId'], _sum: { amountHalalas: true } });
  assert.ok(postings.every((p) => p._sum.amountHalalas === 0), 'every posting balances');
}

test('org apply → ops approve → owner invites by phone → invitee linked on OTP sign-in; roles enforced', async () => {
  const owner = await customer(app);
  const anon = new Client(app);
  const bad = await owner.post('/v1/orgs', { legalName: 'x y', displayName: 'ورشة', crNumber: '12', city: 'riyadh', district: 'حي', address: 'شارع', contactPhone: owner.phone });
  assert.equal(bad.status, 400, 'CR number (10 digits) is required');
  assert.equal((await anon.post('/v1/orgs', {})).status, 401);

  const applied = await owner.ok<any>('POST', '/v1/orgs', {
    legalName: 'مؤسسة ورشة النخبة', displayName: 'ورشة النخبة', crNumber: '1010999001', city: 'riyadh', district: 'السلي', address: 'شارع الصناعة 3', contactPhone: owner.phone,
  });
  assert.equal(applied.org.status, 'APPLIED');
  assert.equal(applied.role, 'OWNER');
  const orgId = applied.org.id as string;
  const dupe = await (await customer(app)).post('/v1/orgs', { legalName: 'أخرى', displayName: 'أخرى', crNumber: '1010999001', city: 'riyadh', district: 'حي', address: 'شارع', contactPhone: owner.phone });
  assert.equal(dupe.status, 409, 'one live organisation per CR number');

  // Only Qitah ops decides; the applicant cannot approve itself or set its own credit.
  assert.equal((await owner.post(`/v1/ops/organizations/${orgId}/approve`)).status, 403);
  assert.equal((await owner.put(`/v1/ops/organizations/${orgId}/credit`, { limitHalalas: 1 })).status, 403);
  const pending = await ops.ok<any>('GET', '/v1/ops/organizations?status=APPLIED');
  assert.ok(pending.items.some((o: any) => o.id === orgId));
  // Credit cannot be activated before approval.
  assert.equal((await ops.put(`/v1/ops/organizations/${orgId}/credit`, { limitHalalas: 100_000, status: 'ACTIVE' })).status, 409);
  const approved = await ops.ok<any>('POST', `/v1/ops/organizations/${orgId}/approve`);
  assert.equal(approved.status, 'APPROVED');
  assert.equal((await ops.post(`/v1/ops/organizations/${orgId}/approve`)).status, 409, 'no double approval');
  const credit = await ops.ok<any>('PUT', `/v1/ops/organizations/${orgId}/credit`, { limitHalalas: 500_000, termsDays: 30, status: 'ACTIVE' });
  assert.equal(credit.provider, 'qitah-internal-sandbox');
  assert.equal(credit.availableHalalas, 500_000);

  // Invite a buyer (not yet a Qitah user) and a technician by phone.
  const buyerPhone = phone();
  const techPhone = phone();
  await owner.ok('POST', `/v1/orgs/${orgId}/members`, { phone: buyerPhone, role: 'BUYER' });
  await owner.ok('POST', `/v1/orgs/${orgId}/members`, { phone: techPhone, role: 'TECHNICIAN' });
  const dupInvite = await owner.post(`/v1/orgs/${orgId}/members`, { phone: buyerPhone, role: 'BUYER' });
  assert.equal(dupInvite.status, 200, 're-inviting a pending phone just updates the invite');
  const members = await owner.ok<any>('GET', `/v1/orgs/${orgId}/members`);
  assert.deepEqual(members.members.map((m: any) => m.status).sort(), ['ACTIVE', 'INVITED', 'INVITED']);

  // The invitee signs in with OTP → linked as BUYER.
  const buyer = await customer(app, buyerPhone);
  const mine = await buyer.ok<any>('GET', '/v1/me/orgs');
  assert.equal(mine.orgs.length, 1);
  assert.equal(mine.orgs[0].role, 'BUYER');
  assert.equal(mine.orgs[0].credit.netTermsEligible, true);
  const tech = await customer(app, techPhone);
  const techOrgs = await tech.ok<any>('GET', '/v1/me/orgs');
  assert.equal(techOrgs.orgs[0].role, 'TECHNICIAN');
  assert.equal(techOrgs.orgs[0].credit, null, 'technicians do not see credit');

  // Role and membership enforcement.
  const outsider = await customer(app);
  assert.equal((await outsider.get(`/v1/orgs/${orgId}`)).status, 403);
  assert.equal((await outsider.get(`/v1/orgs/${orgId}/statement`)).status, 403);
  assert.equal((await outsider.get(`/v1/orders?orgId=${orgId}`)).status, 403);
  assert.equal((await outsider.get('/v1/orgs/does-not-exist')).status, 403, 'same answer for unknown orgs (no probing)');
  assert.equal((await tech.get(`/v1/orgs/${orgId}/statement`)).status, 403, 'statement is BUYER+');
  assert.equal((await tech.post(`/v1/orgs/${orgId}/quotes`, {})).status, 403, 'technicians cannot quote/buy');
  assert.equal((await buyer.post(`/v1/orgs/${orgId}/members`, { phone: phone(), role: 'BUYER' })).status, 403, 'only the OWNER invites');
  assert.equal((await tech.get(`/v1/orders?orgId=${orgId}`)).status, 200, 'technicians see the org orders');

  // A technician / outsider cannot buy for the org, even by forging buyerOrgId.
  const [offer] = await stockedOffers(1);
  const techAddr = await addAddress(tech, 'riyadh', 'workshop');
  const tplan = await planFor(tech, techAddr.id, [{ offerId: offer.id, quantity: 1 }]);
  const forged = await checkoutRaw(tech, { planId: tplan.planId, paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  assert.equal(forged.status, 403);
  const oAddr = await addAddress(outsider, 'riyadh', 'workshop');
  const oplan = await planFor(outsider, oAddr.id, [{ offerId: offer.id, quantity: 1 }]);
  assert.equal((await checkoutRaw(outsider, { planId: oplan.planId, paymentMethod: 'card', buyerOrgId: orgId })).status, 403);
  assert.equal((await checkoutRaw(outsider, { planId: oplan.planId, paymentMethod: 'NET_TERMS' })).status, 400, 'NET_TERMS needs a workshop account');

  // Removing a member revokes access immediately (principal is resolved from the DB on every request).
  const buyerRow = members.members.find((m: any) => m.phone === buyerPhone);
  await owner.ok('DELETE', `/v1/orgs/${orgId}/members/${buyerRow.id}`);
  assert.equal((await buyer.get(`/v1/orgs/${orgId}`)).status, 403);
  // Suspension blocks buying.
  await ops.ok('POST', `/v1/ops/organizations/${orgId}/suspend`, { reason: 'test' });
  const ownerAddr = await addAddress(owner, 'riyadh', 'workshop');
  const splan = await planFor(owner, ownerAddr.id, [{ offerId: offer.id, quantity: 1 }]);
  const suspended = await checkoutRaw(owner, { planId: splan.planId, paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  assert.equal(suspended.status, 409);
  assert.equal(suspended.body.error.code, 'ORG_NOT_APPROVED');
});

test('NET_TERMS: within limit is confirmed immediately; over limit and concurrent over-limit are refused; ledger balances', async () => {
  const owner = await customer(app);
  const [a, b] = await stockedOffers(2);
  const address = await addAddress(owner, 'riyadh', 'workshop');
  // Size the limit from a real plan: room for exactly one order of `a` ×1.
  const probe = await planFor(owner, address.id, [{ offerId: a.id, quantity: 1 }]);
  const orgId = await approvedWorkshop(owner, { limitHalalas: Math.floor(probe.totalHalalas * 1.5), termsDays: 30 });

  const before = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: a.id } });
  const res = await owner.ok<any>('POST', '/v1/checkout', { planId: probe.planId, idempotencyKey: randomUUID(), paymentMethod: 'NET_TERMS', buyerOrgId: orgId, workOrderRef: 'JOB-1001 / أ ب ج 1234' });
  assert.equal(res.status, 'PAID', 'confirmed without the payment provider');
  assert.equal(res.payment.method, 'NET_TERMS');
  assert.equal(res.payment.status, 'CAPTURED');
  assert.ok(res.creditDueAt);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { payments: true, merchantOrders: true } });
  assert.equal(order.buyerOrgId, orgId);
  assert.equal(order.workOrderRef, 'JOB-1001 / أ ب ج 1234');
  assert.equal(order.payments.length, 1);
  assert.equal(order.payments[0].provider, 'credit');
  assert.equal(order.payments[0].providerPaymentId, null, 'never sent to a payment provider');
  assert.ok(order.merchantOrders.every((m) => m.status === 'NEW'), 'merchants get the order right away');
  const days = Math.round((order.creditDueAt!.getTime() - order.paidAt!.getTime()) / 86_400_000);
  assert.equal(days, 30);
  const after = await prisma.inventoryLevel.findUniqueOrThrow({ where: { offerId: a.id } });
  assert.deepEqual([after.onHand, after.reserved], [before.onHand - 1, before.reserved], 'stock committed');

  // Ledger: receivable instead of clearing; merchant payable identical to a card order.
  const lines = await prisma.ledgerEntry.findMany({ where: { orderId: order.id } });
  const sumOf = (acct: string) => lines.filter((l) => l.account === acct).reduce((s, l) => s + l.amountHalalas, 0);
  assert.equal(sumOf('CUSTOMER_RECEIVABLE'), order.totalHalalas);
  assert.equal(sumOf('CUSTOMER_CLEARING'), 0);
  const mo = order.merchantOrders[0];
  assert.equal(sumOf('MERCHANT_PAYABLE'), -(mo.itemsHalalas - mo.commissionHalalas), 'merchant is owed by Qitah regardless');
  await assertBalancedLedger();
  const rec = await reconcileOrder(order.id);
  assert.equal(rec.reconciled, true, rec.issues.join('; '));
  assert.equal(rec.creditOrder, true);

  // Visible in workshop mode, hidden from the retail list.
  const orgOrders = await owner.ok<any>('GET', `/v1/orders?orgId=${orgId}`);
  assert.deepEqual(orgOrders.orders.map((o: any) => o.id), [order.id]);
  assert.equal(orgOrders.orders[0].workOrderRef, 'JOB-1001 / أ ب ج 1234');
  assert.equal((await owner.ok<any>('GET', '/v1/orders')).orders.length, 0);

  // Over the limit: a second identical order no longer fits.
  const second = await planFor(owner, address.id, [{ offerId: a.id, quantity: 1 }]);
  const over = await checkoutRaw(owner, { planId: second.planId, paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'CREDIT_LIMIT_EXCEEDED');
  // The refused checkout left nothing behind: plan still usable by card.
  const byCard = await owner.ok<any>('POST', '/v1/checkout', { planId: second.planId, idempotencyKey: randomUUID(), paymentMethod: 'card', buyerOrgId: orgId });
  assert.equal(byCard.status, 'PENDING_PAYMENT', 'card payments for org orders still go through the sandbox provider');
  assert.ok(byCard.payment.redirectUrl.includes('/sandbox/pay/'));
  await payOnSandboxPage(app, byCard.payment.redirectUrl);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: byCard.orderId } })).status, 'PAID');
  assert.equal((await reconcileOrder(byCard.orderId)).reconciled, true);

  // Concurrent over-limit: a fresh org with room for ONE order, two checkouts in parallel → exactly one wins.
  const owner2 = await customer(app);
  const addr2 = await addAddress(owner2, 'riyadh', 'workshop');
  const p1 = await planFor(owner2, addr2.id, [{ offerId: b.id, quantity: 1 }]);
  const p2 = await planFor(owner2, addr2.id, [{ offerId: b.id, quantity: 1 }]);
  const org2 = await approvedWorkshop(owner2, { limitHalalas: Math.floor(p1.totalHalalas * 1.5) });
  const results = await Promise.all([
    checkoutRaw(owner2, { planId: p1.planId, paymentMethod: 'NET_TERMS', buyerOrgId: org2 }),
    checkoutRaw(owner2, { planId: p2.planId, paymentMethod: 'NET_TERMS', buyerOrgId: org2 }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal(results.find((r) => r.status === 409)!.body.error.code, 'CREDIT_LIMIT_EXCEEDED');
  const st2 = await owner2.ok<any>('GET', `/v1/orgs/${org2}/statement`);
  assert.equal(st2.credit.outstandingHalalas, p1.totalHalalas);
  assert.ok(st2.credit.outstandingHalalas <= st2.credit.limitHalalas);

  // Frozen credit refuses NET_TERMS.
  await ops.ok('PUT', `/v1/ops/organizations/${org2}/credit`, { status: 'FROZEN', limitHalalas: 100_000_000 });
  const p3 = await planFor(owner2, addr2.id, [{ offerId: b.id, quantity: 1 }]);
  const frozen = await checkoutRaw(owner2, { planId: p3.planId, paymentMethod: 'NET_TERMS', buyerOrgId: org2 });
  assert.equal(frozen.body.error.code, 'CREDIT_FROZEN');
  await assertBalancedLedger();
});

test('repayment reduces outstanding (idempotent, oldest first); a credit refund reduces the receivable; reconcile stays clean', async () => {
  const owner = await customer(app);
  const [a, b] = await stockedOffers(2);
  const address = await addAddress(owner, 'riyadh', 'workshop');
  const orgId = await approvedWorkshop(owner, { limitHalalas: 10_000_000, termsDays: 15 });
  const o1 = await owner.ok<any>('POST', '/v1/checkout', { planId: (await planFor(owner, address.id, [{ offerId: a.id, quantity: 2 }])).planId, idempotencyKey: randomUUID(), paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  const o2 = await owner.ok<any>('POST', '/v1/checkout', { planId: (await planFor(owner, address.id, [{ offerId: b.id, quantity: 1 }])).planId, idempotencyKey: randomUUID(), paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  const total = o1.totalHalalas + o2.totalHalalas;
  let st = await owner.ok<any>('GET', `/v1/orgs/${orgId}/statement`);
  assert.equal(st.credit.outstandingHalalas, total);
  assert.equal(st.credit.availableHalalas, 10_000_000 - total);
  assert.equal(st.orders.length, 2);
  assert.ok(st.orders.every((o: any) => o.creditDueAt && o.outstandingHalalas > 0 && !o.overdue));

  // Only finance records repayments.
  assert.equal((await owner.post(`/v1/ops/organizations/${orgId}/repayments`, { amountHalalas: 100, idempotencyKey: 'rp-owner-0001' })).status, 403);
  const tooMuch = await finance.post(`/v1/ops/organizations/${orgId}/repayments`, { amountHalalas: total + 1, idempotencyKey: 'rp-too-much-1' });
  assert.equal(tooMuch.status, 409);
  // Pay the first order in full plus 1 halala of the second (oldest due first).
  const amount = o1.totalHalalas + 1;
  const rp = await finance.ok<any>('POST', `/v1/ops/organizations/${orgId}/repayments`, { amountHalalas: amount, idempotencyKey: 'rp-bank-0001', reference: 'BANK-TRX-1' });
  assert.equal(rp.credit.outstandingHalalas, total - amount);
  assert.deepEqual(rp.repayment.allocation, [{ orderId: o1.orderId, amountHalalas: o1.totalHalalas }, { orderId: o2.orderId, amountHalalas: 1 }]);
  const replay = await finance.ok<any>('POST', `/v1/ops/organizations/${orgId}/repayments`, { amountHalalas: amount, idempotencyKey: 'rp-bank-0001', reference: 'BANK-TRX-1' });
  assert.equal(replay.repayment.id, rp.repayment.id, 'idempotent');
  assert.equal(replay.credit.outstandingHalalas, total - amount);
  for (const id of [o1.orderId, o2.orderId]) {
    const rec = await reconcileOrder(id);
    assert.equal(rec.reconciled, true, rec.issues.join('; '));
  }
  assert.equal((await reconcileOrder(o1.orderId)).receivableHalalas, 0);

  // Refund on the (unpaid) second credit order: ops goodwill refund → settles at once, reduces the receivable.
  const mo2 = await prisma.merchantOrder.findFirstOrThrow({ where: { orderId: o2.orderId } });
  const refundAmount = 500;
  await finance.ok('POST', `/v1/ops/orders/${o2.orderId}/refunds`, { merchantOrderId: mo2.id, amountHalalas: refundAmount, reason: 'damaged box', idempotencyKey: 'credit-refund-1' });
  const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: o2.orderId } });
  assert.equal(refund.status, 'SUCCEEDED', 'no provider round-trip for credit refunds');
  st = await owner.ok<any>('GET', `/v1/orgs/${orgId}/statement`);
  assert.equal(st.credit.outstandingHalalas, total - amount - refundAmount);
  const rec2 = await reconcileOrder(o2.orderId);
  assert.equal(rec2.reconciled, true, rec2.issues.join('; '));
  assert.equal(rec2.receivableHalalas, o2.totalHalalas - 1 - refundAmount);

  // Cancelling a whole credit order (before shipping) refunds it in full: its receivable goes to zero.
  const o4 = await owner.ok<any>('POST', '/v1/checkout', { planId: (await planFor(owner, address.id, [{ offerId: b.id, quantity: 1 }])).planId, idempotencyKey: randomUUID(), paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  await owner.ok('POST', `/v1/orders/${o4.orderId}/cancel`, { reason: 'job cancelled' });
  const rec3 = await reconcileOrder(o4.orderId);
  assert.equal(rec3.reconciled, true, rec3.issues.join('; '));
  assert.equal(rec3.status, 'CANCELLED');
  assert.equal(rec3.receivableHalalas, 0);
  st = await owner.ok<any>('GET', `/v1/orgs/${orgId}/statement`);
  assert.equal(st.credit.outstandingHalalas, total - amount - refundAmount);
  assert.equal(st.repayments.length, 1);
  assert.ok(st.members.length >= 1 && st.activity.some((a: any) => a.action === 'organization.repayment_recorded'));
  await assertBalancedLedger();

  // Overdue view: push the (fully paid) first order and a new one past due.
  const o3 = await owner.ok<any>('POST', '/v1/checkout', { planId: (await planFor(owner, address.id, [{ offerId: a.id, quantity: 1 }])).planId, idempotencyKey: randomUUID(), paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  await prisma.order.updateMany({ where: { id: { in: [o1.orderId, o3.orderId] } }, data: { creditDueAt: new Date(Date.now() - 3 * 86_400_000) } });
  const overdue = await finance.ok<any>('GET', '/v1/ops/receivables/overdue');
  assert.deepEqual(overdue.items.filter((i: any) => i.org.id === orgId).map((i: any) => i.orderId), [o3.orderId], 'only unpaid balances are overdue');
  assert.equal(overdue.items.find((i: any) => i.orderId === o3.orderId).daysOverdue, 3);
});

test('workshop quote: escaped public page, expired token rejected, approve → workshop order with attribution', async () => {
  const owner = await customer(app);
  const [a, b] = await stockedOffers(2);
  const address = await addAddress(owner, 'riyadh', 'workshop');
  const orgId = await approvedWorkshop(owner, { limitHalalas: 10_000_000 });
  const evil = '<script>alert(1)</script>';
  const quote = await owner.ok<any>('POST', `/v1/orgs/${orgId}/quotes`, {
    addressId: address.id,
    vehicle: { model: `كامري ${evil}`, year: 2020, plate: 'أ ب ج 1234' },
    lines: [{ offerId: a.id, quantity: 2 }, { offerId: b.id, quantity: 1 }],
    laborHalalas: 15000,
    markupHalalas: 5000,
    note: `تغيير فحمات ${evil}`,
    customerPhone: '+966512345678',
  });
  assert.equal(quote.status, 'SENT');
  assert.equal(quote.partsHalalas, a.priceHalalas * 2 + b.priceHalalas, 'parts at the Qitah price');
  assert.equal(quote.totalHalalas, quote.partsHalalas + 15000 + 5000);
  assert.match(quote.url, /\/q\/[A-Za-z0-9_-]{40,}$/);
  assert.ok(quote.share.text.includes(quote.url));
  assert.ok(quote.share.whatsappUrl.startsWith('https://wa.me/966512345678?text='));
  const path = new URL(quote.url).pathname;

  const page = await app.inject({ method: 'GET', url: path });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['x-robots-tag'] as string, /noindex/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.ok(!page.body.includes(evil), 'workshop input is escaped');
  assert.ok(page.body.includes('&lt;script&gt;'));
  assert.ok(page.body.includes('ورشة الاختبار'));
  assert.ok(!page.body.includes('512345678'), 'customer phone is never shown');
  assert.ok(page.body.includes('رسوم الورشة') && page.body.includes('أجرة اليد'));
  assert.equal((await app.inject({ method: 'GET', url: '/q/not-a-real-token-but-long-enough-xyz' })).statusCode, 404);

  // Expired link → 410, and cannot be approved.
  const stale = await owner.ok<any>('POST', `/v1/orgs/${orgId}/quotes`, { addressId: address.id, vehicle: { model: 'يارس' }, lines: [{ offerId: a.id, quantity: 1 }] });
  await prisma.workshopQuote.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const stalePath = new URL(stale.url).pathname;
  assert.equal((await app.inject({ method: 'GET', url: stalePath })).statusCode, 410);
  const staleApprove = await app.inject({ method: 'POST', url: stalePath, payload: 'decision=approve', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(staleApprove.statusCode, 410);
  assert.equal((await prisma.workshopQuote.findUniqueOrThrow({ where: { id: stale.id } })).status, 'EXPIRED');

  // Missing decision → 400 with the form again.
  assert.equal((await app.inject({ method: 'POST', url: path, payload: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode, 400);

  // Customer approves → converted into a NET_TERMS workshop order at Qitah prices.
  const approve = await app.inject({ method: 'POST', url: path, payload: 'decision=approve', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(approve.statusCode, 303);
  const after = await owner.ok<any>('GET', `/v1/orgs/${orgId}/quotes/${quote.id}`);
  assert.equal(after.status, 'CONVERTED', JSON.stringify(after));
  const order = await prisma.order.findUniqueOrThrow({ where: { id: after.orderId }, include: { payments: true } });
  assert.equal(order.workshopQuoteId, quote.id, 'attribution');
  assert.equal(order.buyerOrgId, orgId);
  assert.equal(order.customerId, owner.userId);
  assert.equal(order.itemsHalalas, quote.partsHalalas, 'the workshop buys at Qitah prices; labour/margin are not charged by Qitah');
  assert.equal(order.status, 'PAID');
  assert.equal(order.payments[0].method, 'NET_TERMS');
  assert.ok(order.workOrderRef?.includes(quote.number));
  assert.equal((await reconcileOrder(order.id)).reconciled, true);
  const done = await app.inject({ method: 'GET', url: path });
  assert.ok(done.body.includes('تم اعتماد العرض'));
  const again = await app.inject({ method: 'POST', url: path, payload: 'decision=decline', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(again.statusCode, 409, 'a decision is final');
  // Converting again is idempotent.
  const reconvert = await owner.ok<any>('POST', `/v1/orgs/${orgId}/quotes/${quote.id}/convert`);
  assert.equal(reconvert.orderId, order.id);
  assert.equal(await prisma.order.count({ where: { workshopQuoteId: quote.id } }), 1);

  // Decline path.
  const q2 = await owner.ok<any>('POST', `/v1/orgs/${orgId}/quotes`, { addressId: address.id, vehicle: { model: 'هايلكس' }, lines: [{ offerId: b.id, quantity: 1 }], laborHalalas: 1000 });
  const p2 = new URL(q2.url).pathname;
  assert.equal((await app.inject({ method: 'POST', url: p2, payload: 'decision=decline', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode, 303);
  assert.equal((await owner.ok<any>('GET', `/v1/orgs/${orgId}/quotes/${q2.id}`)).status, 'DECLINED');
  assert.equal((await owner.post(`/v1/orgs/${orgId}/quotes/${q2.id}/convert`)).status, 409);

  // Quotes of another org are not reachable.
  const other = await customer(app);
  const otherOrg = await approvedWorkshop(other);
  assert.equal((await other.get(`/v1/orgs/${otherOrg}/quotes/${quote.id}`)).status, 404);
  assert.equal((await other.get(`/v1/orgs/${orgId}/quotes/${quote.id}`)).status, 403);

  // Workshop leads come from mechanic reviews.
  await prisma.mechanicReview.create({ data: { userId: owner.userId, tokenHash: randomUUID(), snapshot: { vehicle: null, lines: [] }, workshopName: 'ورشة الأمل', workshopPhone: '+966511122233', status: 'APPROVED', respondedAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) } });
  const leads = await ops.ok<any>('GET', '/v1/ops/workshop-leads');
  const lead = leads.items.find((l: any) => l.phone === '+966511122233');
  assert.equal(lead.workshopName, 'ورشة الأمل');
  assert.equal(lead.organization, null);
});

test('retail checkout is unaffected by workshop accounts', async () => {
  const c = await customer(app);
  const [a] = await stockedOffers(1);
  const address = await addAddress(c, 'riyadh');
  const { order } = await placeOrder(c, address.id, [{ offerId: a.id, quantity: 1 }]);
  assert.equal(order.status, 'PENDING_PAYMENT');
  assert.equal(order.buyerOrgId, null);
  assert.equal(order.payment.method, 'mada');
  await payOnSandboxPage(app, order.payment.redirectUrl);
  const view = await c.ok<any>('GET', `/v1/orders/${order.orderId}`);
  assert.equal(view.status, 'PAID');
  assert.equal(view.buyerOrgId, null);
  assert.equal(view.creditDueAt, null);
  const list = await c.ok<any>('GET', '/v1/orders');
  assert.deepEqual(list.orders.map((o: any) => o.id), [order.orderId]);
  const rec = await reconcileOrder(order.orderId);
  assert.equal(rec.reconciled, true, rec.issues.join('; '));
  assert.equal(rec.creditOrder, false);
  assert.equal(rec.receivableHalalas, 0);
  // A retail customer cannot pick NET_TERMS for the "pay again" endpoint either.
  assert.equal((await c.post(`/v1/orders/${order.orderId}/payment`, { method: 'NET_TERMS' })).status, 400);
  assert.equal((await c.ok<any>('GET', '/v1/me/orgs')).orgs.length, 0);
});

test('workshop orders use B2B commission; NET_TERMS has no PSP fee; card org orders pay fees; both reconcile', async () => {
  const owner = await customer(app, phone());
  const orgId = await approvedWorkshop(owner, { limitHalalas: 5_000_000 });
  const addr = await addAddress(owner, 'riyadh', 'workshop');
  const [offer] = await stockedOffers(1);
  const b2bRule = await prisma.commissionRule.findFirstOrThrow({ where: { channel: 'B2B', merchantId: null, active: true } });

  // NET_TERMS workshop order
  const p1 = await planFor(owner, addr.id, [{ offerId: offer.id, quantity: 1 }]);
  const r1 = await checkoutRaw(owner, { planId: p1.planId, paymentMethod: 'NET_TERMS', buyerOrgId: orgId });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const item1 = await prisma.orderItem.findFirstOrThrow({ where: { orderId: r1.body.orderId } });
  assert.equal(item1.commissionBps, b2bRule.bps, 'org order resolves the B2B tier');
  const pay1 = await prisma.payment.findFirstOrThrow({ where: { orderId: r1.body.orderId } });
  assert.equal(pay1.feeHalalas ?? 0, 0, 'no payment-provider fee on credit');
  const rec1 = await ops.ok<any>('GET', `/v1/ops/orders/${r1.body.orderId}/reconcile`);
  assert.equal(rec1.reconciled, true, JSON.stringify(rec1.issues));

  // Card-paid workshop order: B2B commission + provider fee
  const p2 = await planFor(owner, addr.id, [{ offerId: offer.id, quantity: 1 }]);
  const r2 = await checkoutRaw(owner, { planId: p2.planId, paymentMethod: 'mada', buyerOrgId: orgId });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  await payOnSandboxPage(app, r2.body.payment.redirectUrl);
  const item2 = await prisma.orderItem.findFirstOrThrow({ where: { orderId: r2.body.orderId } });
  assert.equal(item2.commissionBps, b2bRule.bps);
  const pay2 = await prisma.payment.findFirstOrThrow({ where: { orderId: r2.body.orderId, status: 'CAPTURED' } });
  assert.ok((pay2.feeHalalas ?? 0) > 0, 'card capture records a fee');
  const rec2 = await ops.ok<any>('GET', `/v1/ops/orders/${r2.body.orderId}/reconcile`);
  assert.equal(rec2.reconciled, true, JSON.stringify(rec2.issues));

  // Retail order of the same offer stays on the B2C tier
  const retail = await customer(app, phone());
  const raddr = await addAddress(retail);
  const p3 = await planFor(retail, raddr.id, [{ offerId: offer.id, quantity: 1 }]);
  const r3 = await checkoutRaw(retail, { planId: p3.planId, paymentMethod: 'mada' });
  const item3 = await prisma.orderItem.findFirstOrThrow({ where: { orderId: r3.body.orderId } });
  assert.notEqual(item3.commissionBps, b2bRule.bps, 'retail is not B2B');
  await assertBalancedLedger();
});
