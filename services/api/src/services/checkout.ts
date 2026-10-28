import { Prisma, type Condition } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { DEFAULT_SAME_DAY_CUTOFF_MIN, sameDayEligible } from '../domain/delivery.js';
import { optimizeCart, type Candidate, type LineRequest, type PlanOption } from '../domain/optimizer.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { orderNumber } from '../lib/ids.js';
import { vatOfInclusive } from '../lib/money.js';
import { blendedBps, lineCommission } from '../domain/commission.js';
import { hiddenBefore } from '../domain/freshness.js';
import { loadCommissionRules, orderChannel, resolveLine } from './commission.js';
import { emit } from './events.js';
import { reserve } from './inventory.js';
import { privateOfferWhere } from './partRequests.js';
import { initiatePayment } from './payments.js';
import { buildFitSnapshot, loadVehicleSnapshots, vehicleForLine, type CheckoutVehicleInput } from './trust.js';

const PLAN_TTL_MS = 15 * 60_000;
export const PAYMENT_METHODS = ['mada', 'card', 'applePay', 'stcPay'] as const;

type OfferRow = Prisma.OfferGetPayload<{ include: { location: true; inventory: true; product: true; merchant: true } }>;

function toCandidate(o: OfferRow, now: Date): Candidate {
  return {
    offerId: o.id,
    merchantId: o.merchantId,
    locationId: o.locationId,
    originCity: o.location.city,
    priceHalalas: o.priceHalalas,
    available: o.inventory ? o.inventory.onHand - o.inventory.reserved : 0,
    dispatchDaysMax: o.dispatchDaysMax,
    weightGrams: o.product.weightGrams,
    dimsCm: [o.product.lengthCm, o.product.widthCm, o.product.heightCm],
    handling: o.product.handling,
    sameDayEligible: sameDayEligible(now, o.location.sameDayCutoffMinutes ?? DEFAULT_SAME_DAY_CUTOFF_MIN, o.dispatchDaysMin),
  };
}

/**
 * Offers this user may buy: public offers on active products, plus the user's OWN private offers
 * (accepted part-request quotes, possibly on a DRAFT product) while the quote is still valid.
 * Another user's private offer is never purchasable, plannable or usable as an alternative.
 */
const purchasable = (workshop: boolean, userId: string): Prisma.OfferWhereInput => ({
  status: 'ACTIVE',
  merchant: { status: 'APPROVED', ...(workshop ? { supportsWorkshopDelivery: true } : {}) },
  location: { active: true },
  OR: [
    // Public offers not confirmed for FRESHNESS_HIDE_DAYS are hidden until the merchant reconfirms (merchant economics).
    { visibility: 'PUBLIC', product: { status: 'ACTIVE' }, lastConfirmedAt: { gte: hiddenBefore() } },
    { ...privateOfferWhere(userId), product: { status: { in: ['ACTIVE', 'DRAFT'] } } },
  ],
});

/** Offers a user may reference at all (cart lines, plan inputs): public ones and their own private ones. */
export const visibleTo = (userId: string): Prisma.OfferWhereInput => ({ OR: [{ visibility: 'PUBLIC' }, { visibility: 'PRIVATE', privateForUserId: userId }] });

export type PlanLineInput = { offerId: string; quantity: number };

export async function planCheckout(ctx: Ctx, userId: string, input: { lines: PlanLineInput[]; addressId: string }) {
  if (!input.lines.length) throw badRequest('EMPTY_CART', 'Cart is empty');
  const keys = new Set(input.lines.map((l) => l.offerId));
  if (keys.size !== input.lines.length) throw badRequest('DUPLICATE_LINES', 'Each offer may appear once');
  const address = await prisma.address.findFirst({ where: { id: input.addressId, userId, deletedAt: null } });
  if (!address) throw notFound('Address');
  const workshop = address.kind === 'WORKSHOP';

  const selected = await prisma.offer.findMany({ where: { id: { in: [...keys] }, ...visibleTo(userId) }, include: { product: true } });
  const bySel = new Map(selected.map((o) => [o.id, o]));
  const missing = input.lines.filter((l) => !bySel.has(l.offerId)).map((l) => l.offerId);
  if (missing.length) throw notFound(`Offer ${missing.join(', ')}`);

  // Interchangeable offers = same product + same condition. Never silently swap new for used.
  const pairs = [...new Set(selected.map((o) => `${o.productId}|${o.condition}`))].map((k) => {
    const [productId, condition] = k.split('|');
    return { productId, condition: condition as Condition };
  });
  const pool = await prisma.offer.findMany({
    where: { AND: [purchasable(workshop, userId), { OR: pairs }] },
    include: { location: true, inventory: true, product: true, merchant: true },
  });

  const now = ctx.clock();
  const requests: LineRequest[] = input.lines.map((l) => {
    const sel = bySel.get(l.offerId)!;
    return {
      key: l.offerId,
      quantity: l.quantity,
      selectedOfferId: l.offerId,
      candidates: pool.filter((o) => o.productId === sel.productId && o.condition === sel.condition).map((o) => toCandidate(o, now)),
    };
  });

  // Same-day is only offered when every item in the parcel can still make today's cutoff.
  const result = optimizeCart(requests, address.city, (g) => ctx.carrier.rates(g).filter((r) => r.serviceCode !== 'sameDay' || g.sameDayEligible !== false));
  const merchants = new Map(pool.map((o) => [o.merchantId, o.merchant]));
  const offers = new Map(pool.map((o) => [o.id, o]));
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS);

  const options = [];
  for (const option of result.options) {
    const quoteIds: string[] = [];
    for (const g of option.groups) {
      const q = await prisma.shippingQuote.create({
        data: {
          carrierCode: g.rate.carrierCode,
          serviceCode: g.rate.serviceCode,
          originLocationId: g.locationId,
          destinationCity: address.city,
          weightGrams: g.weightGrams,
          parcels: { handling: g.handling, items: g.lines.length },
          amountHalalas: g.rate.amountHalalas,
          etaDaysMin: g.rate.etaDaysMin,
          etaDaysMax: g.rate.etaDaysMax,
          sandbox: g.rate.sandbox,
          expiresAt,
        },
      });
      quoteIds.push(q.id);
    }
    const sandboxRates = option.groups.some((g) => g.rate.sandbox);
    const plan = await prisma.checkoutPlan.create({
      data: {
        userId,
        addressId: address.id,
        strategy: option.strategy,
        plan: { ...option, quoteIds } as unknown as Prisma.InputJsonValue,
        itemsHalalas: option.itemsHalalas,
        shippingHalalas: option.shippingHalalas,
        totalHalalas: option.totalHalalas,
        sandboxRates,
        expiresAt,
      },
    });
    options.push(presentOption(plan.id, option, expiresAt, sandboxRates, offers, merchants));
  }

  // Line-level availability so the app can explain what is wrong.
  const lineStatus = requests.map((r) => {
    const own = r.candidates.find((c) => c.offerId === r.key);
    return {
      offerId: r.key,
      requested: r.quantity,
      selectedAvailable: own?.available ?? 0,
      alternatives: r.candidates.filter((c) => c.offerId !== r.key && c.available >= r.quantity).length,
    };
  });
  return { options, unavailable: result.unavailable, lines: lineStatus };
}

function presentOption(
  planId: string,
  option: PlanOption,
  expiresAt: Date,
  sandboxRates: boolean,
  offers: Map<string, OfferRow>,
  merchants: Map<string, OfferRow['merchant']>,
) {
  return {
    planId,
    strategy: option.strategy,
    bestFor: option.bestFor,
    itemsHalalas: option.itemsHalalas,
    shippingHalalas: option.shippingHalalas,
    totalHalalas: option.totalHalalas,
    vatHalalas: vatOfInclusive(option.totalHalalas),
    shipmentCount: option.shipmentCount,
    etaDaysMax: option.etaDaysMax,
    sandboxRates,
    expiresAt: expiresAt.toISOString(),
    changes: option.groups.flatMap((g) => g.lines.filter((l) => l.key !== l.offerId).map((l) => ({ fromOfferId: l.key, toOfferId: l.offerId }))),
    groups: option.groups.map((g) => ({
      merchantId: g.merchantId,
      merchantNameAr: merchants.get(g.merchantId)?.displayNameAr ?? '',
      merchantNameEn: merchants.get(g.merchantId)?.displayNameEn ?? '',
      originCity: g.originCity,
      carrierCode: g.rate.carrierCode,
      serviceCode: g.rate.serviceCode,
      shippingHalalas: g.rate.amountHalalas,
      etaDaysMin: g.etaDaysMin,
      etaDaysMax: g.etaDaysMax,
      handling: g.handling,
      lines: g.lines.map((l) => {
        const o = offers.get(l.offerId);
        return {
          offerId: l.offerId,
          originalOfferId: l.key,
          productId: o?.productId,
          productNameAr: o?.product.nameAr,
          productNameEn: o?.product.nameEn,
          quantity: l.quantity,
          unitPriceHalalas: l.unitPriceHalalas,
        };
      }),
    })),
  };
}

type StoredPlan = PlanOption & { quoteIds: string[] };

/** `vehicle` names the customer's own garage vehicle(s); the server re-computes fit per line and never trusts a client fit claim. */
export type CheckoutInput = { planId: string; idempotencyKey: string; paymentMethod: string; vehicle?: CheckoutVehicleInput };

export async function checkout(
  ctx: Ctx,
  userId: string,
  input: CheckoutInput,
) {
  const existing = await prisma.order.findUnique({ where: { customerId_idempotencyKey: { customerId: userId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return finishCheckout(ctx, existing.id, input.paymentMethod);

  for (let attempt = 1; ; attempt++) {
    try {
      const orderId = await withTx((tx) => createOrderFromPlan(ctx, tx, userId, input));
      return finishCheckout(ctx, orderId, input.paymentMethod);
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      // A concurrent duplicate submit won the race on (customerId, idempotencyKey): return its order.
      const winner = await prisma.order.findUnique({ where: { customerId_idempotencyKey: { customerId: userId, idempotencyKey: input.idempotencyKey } } });
      if (winner) return finishCheckout(ctx, winner.id, input.paymentMethod);
      // Otherwise an order/suborder number collided: retry with a fresh number.
      if (attempt >= 3) throw e;
    }
  }
}

async function finishCheckout(ctx: Ctx, orderId: string, method: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const payment = order.status === 'PENDING_PAYMENT' ? await initiatePayment(ctx, orderId, method) : null;
  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    totalHalalas: order.totalHalalas,
    payment: payment && { id: payment.id, redirectUrl: payment.redirectUrl, sandbox: payment.sandbox, status: payment.status },
  };
}

async function createOrderFromPlan(
  ctx: Ctx,
  tx: Tx,
  userId: string,
  input: CheckoutInput,
): Promise<string> {
  // Lock the plan row so it can be used exactly once.
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CheckoutPlan" WHERE id = ${input.planId} AND "userId" = ${userId} FOR UPDATE`;
  if (!locked.length) throw notFound('Checkout plan');
  const planRow = await tx.checkoutPlan.findUniqueOrThrow({ where: { id: input.planId } });
  if (planRow.usedAt) throw conflict('PLAN_USED', 'This checkout option was already used; refresh delivery options');
  if (planRow.expiresAt < new Date()) throw conflict('PLAN_EXPIRED', 'Prices and shipping quotes expired; refresh delivery options');
  const address = await tx.address.findFirst({ where: { id: planRow.addressId, userId, deletedAt: null } });
  if (!address) throw notFound('Address');
  const plan = planRow.plan as unknown as StoredPlan;

  const offerIds = plan.groups.flatMap((g) => g.lines.map((l) => l.offerId));
  const offers = await tx.offer.findMany({ where: { id: { in: offerIds }, ...purchasable(address.kind === 'WORKSHOP', userId) }, include: { product: { include: { fitments: true } }, merchant: true } });
  const byId = new Map(offers.map((o) => [o.id, o]));
  for (const g of plan.groups) {
    for (const l of g.lines) {
      const o = byId.get(l.offerId);
      if (!o) throw conflict('OFFER_UNAVAILABLE', 'An item is no longer available; refresh delivery options', { offerId: l.offerId });
      if (o.priceHalalas !== l.unitPriceHalalas) {
        throw conflict('PRICE_CHANGED', 'A price changed since you reviewed your order; refresh delivery options', { offerId: l.offerId });
      }
    }
  }

  const vehicles = await loadVehicleSnapshots(tx, userId, input.vehicle);
  const orderVehicle = input.vehicle ? (vehicles.get(input.vehicle.garageVehicleId) ?? null) : null;
  const now = new Date();
  const number = orderNumber(now);
  const paymentExpiresAt = new Date(now.getTime() + ctx.config.RESERVATION_MINUTES * 60_000);
  const order = await tx.order.create({
    data: {
      number,
      customerId: userId,
      idempotencyKey: input.idempotencyKey,
      checkoutPlanId: planRow.id,
      addressSnapshot: {
        kind: address.kind,
        label: address.label,
        city: address.city,
        district: address.district,
        street: address.street,
        details: address.details,
        contactName: address.contactName,
        phone: address.phone,
        workshopName: address.workshopName,
      },
      vehicleSnapshot: (orderVehicle ?? undefined) as Prisma.InputJsonValue | undefined,
      paymentMethod: input.paymentMethod,
      itemsHalalas: plan.itemsHalalas,
      shippingHalalas: plan.shippingHalalas,
      totalHalalas: plan.totalHalalas,
      vatHalalas: vatOfInclusive(plan.totalHalalas),
      sandbox: planRow.sandboxRates || ctx.payments.sandbox,
      paymentExpiresAt,
    },
  });

  const merchantIds = [...new Set(plan.groups.map((g) => g.merchantId))].sort();
  // Commission is resolved per LINE (category / origin / condition differ within one merchant order).
  const rules = await loadCommissionRules(tx, merchantIds);
  const channel = orderChannel(order);
  const commissionOf = (offerId: string, lineTotal: number) => {
    const o = byId.get(offerId)!;
    const r = resolveLine(ctx.config.COMMISSION_DEFAULT_BPS, rules, o.merchant, { categoryId: o.product.categoryId, origin: o.product.origin, condition: o.condition }, channel, now);
    return { commissionBps: r.bps, commissionHalalas: lineCommission(lineTotal, r.bps), commissionRuleId: r.ruleId };
  };
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (const [mi, merchantId] of merchantIds.entries()) {
    const groups = plan.groups.map((g, gi) => ({ g, quoteId: plan.quoteIds[gi] })).filter(({ g }) => g.merchantId === merchantId);
    const itemsHalalas = groups.reduce((s, { g }) => s + g.lines.reduce((x, l) => x + l.unitPriceHalalas * l.quantity, 0), 0);
    const commissionHalalas = groups.reduce((s, { g }) => s + g.lines.reduce((x, l) => x + commissionOf(l.offerId, l.unitPriceHalalas * l.quantity).commissionHalalas, 0), 0);
    const mo = await tx.merchantOrder.create({
      data: {
        number: `${number}-${letters[mi]}`,
        orderId: order.id,
        merchantId,
        itemsHalalas,
        shippingHalalas: groups.reduce((s, { g }) => s + g.rate.amountHalalas, 0),
        // Display rate only (Σ line commission / Σ items); ledger and refunds use the per-line rates.
        commissionBps: blendedBps(itemsHalalas, commissionHalalas),
        commissionHalalas,
      },
    });
    for (const { g, quoteId } of groups) {
      const fg = await tx.fulfillmentGroup.create({
        data: {
          orderId: order.id,
          merchantOrderId: mo.id,
          originLocationId: g.locationId,
          carrierCode: g.rate.carrierCode,
          serviceCode: g.rate.serviceCode,
          quoteId,
          quotedHalalas: g.rate.amountHalalas,
          etaDaysMin: g.etaDaysMin,
          etaDaysMax: g.etaDaysMax,
          weightGrams: g.weightGrams,
          handling: g.handling,
        },
      });
      for (const l of g.lines) {
        const o = byId.get(l.offerId)!;
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            merchantOrderId: mo.id,
            fulfillmentGroupId: fg.id,
            offerId: o.id,
            productId: o.productId,
            quantity: l.quantity,
            unitPriceHalalas: l.unitPriceHalalas,
            lineTotalHalalas: l.unitPriceHalalas * l.quantity,
            ...commissionOf(o.id, l.unitPriceHalalas * l.quantity),
            productNameAr: o.product.nameAr,
            productNameEn: o.product.nameEn,
            partNumber: o.product.partNumber,
            condition: o.condition,
            art: o.product.art,
            fitSnapshot: buildFitSnapshot(o.product, vehicleForLine(input.vehicle, vehicles, [l.key, l.offerId]), now) as unknown as Prisma.InputJsonValue,
          },
        });
        await reserve(tx, { offerId: o.id, quantity: l.quantity, orderId: order.id, orderItemId: item.id, expiresAt: paymentExpiresAt });
      }
    }
  }
  await tx.checkoutPlan.update({ where: { id: planRow.id }, data: { usedAt: now } });
  await emit(tx, { type: 'order.created', entityType: 'order', entityId: order.id, orderId: order.id, customerId: userId, payload: { number } });
  return order.id;
}
