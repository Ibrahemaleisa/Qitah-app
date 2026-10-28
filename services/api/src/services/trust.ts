import type { Handling, ShipmentPayer } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, type Db } from '../db.js';
import { DEFAULT_SAME_DAY_CUTOFF_MIN, estimateDelivery, type DeliveryEstimate } from '../domain/delivery.js';
import { evaluateFit, readFitSnapshot, type FitProduct, type FitSnapshot, type VehicleSnapshot } from '../domain/fit.js';
import { notFound } from '../lib/errors.js';
import { allocate } from '../lib/money.js';
import { publicOfferWhere } from './catalog.js';

/**
 * Trust layer: fit guarantee (ضمان قطعة), delivered-price estimates and the return policy.
 * Everything here is computed on the server from catalog data; client claims are never trusted.
 */

// ───────────────────────────────────────────── fit guarantee

export type CheckoutVehicleInput = { garageVehicleId: string; lines?: { offerId: string; garageVehicleId: string }[] };

/** Loads the customer's own garage vehicles referenced by a checkout and snapshots them. Unknown/foreign ids → 404. */
export async function loadVehicleSnapshots(db: Db, userId: string, input: CheckoutVehicleInput | undefined): Promise<Map<string, VehicleSnapshot>> {
  const ids = input ? [...new Set([input.garageVehicleId, ...(input.lines ?? []).map((l) => l.garageVehicleId)])] : [];
  if (!ids.length) return new Map();
  const rows = await db.garageVehicle.findMany({ where: { id: { in: ids }, userId, deletedAt: null }, include: { model: { include: { make: true } } } });
  if (rows.length !== ids.length) throw notFound('Vehicle');
  return new Map(
    rows.map((v) => {
      const labelAr = `${v.model.make.nameAr} ${v.model.nameAr} ${v.year}`;
      const labelEn = `${v.model.make.nameEn} ${v.model.nameEn} ${v.year}`;
      return [v.id, { garageVehicleId: v.id, makeId: v.model.makeId, modelId: v.modelId, year: v.year, trim: v.trim, engine: v.engine, vin: v.vin, label: labelAr, labelAr, labelEn }];
    }),
  );
}

/** Vehicle that applies to a cart line: a per-line override (matched on the original or the planned offer), else the order vehicle. */
export function vehicleForLine(input: CheckoutVehicleInput | undefined, vehicles: Map<string, VehicleSnapshot>, keys: string[]): VehicleSnapshot | null {
  if (!input) return null;
  const override = input.lines?.find((l) => keys.includes(l.offerId));
  return vehicles.get(override?.garageVehicleId ?? input.garageVehicleId) ?? null;
}

export function buildFitSnapshot(product: FitProduct, vehicle: VehicleSnapshot | null, now: Date): FitSnapshot {
  const fit = evaluateFit(product, vehicle);
  return { ...fit, vehicle, vin: vehicle?.vin ?? null, evaluatedAt: now.toISOString() };
}

export const isGuaranteed = (json: unknown) => readFitSnapshot(json)?.guaranteed === true;

// ───────────────────────────────────────────── delivered price + ETA

export type OfferDeliveryEstimate = DeliveryEstimate & { offerId: string; originCity: string; estimate: true };

/** Cheapest + fastest carrier service per offer, pickup location → city, including dispatch days and the same-day cutoff. */
export async function deliveryEstimates(ctx: Ctx, offerIds: string[], city: string): Promise<OfferDeliveryEstimate[]> {
  const offers = await prisma.offer.findMany({ where: { id: { in: offerIds }, ...publicOfferWhere }, include: { location: true, product: true } });
  const now = ctx.clock();
  return offerIds
    .map((id) => offers.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => {
      const rates = ctx.carrier.rates({
        originCity: o.location.city,
        destinationCity: city,
        weightGrams: o.product.weightGrams,
        maxDimsCm: [o.product.lengthCm, o.product.widthCm, o.product.heightCm].sort((a, b) => b - a) as [number, number, number],
        handling: o.product.handling,
        itemCount: 1,
      });
      const est = estimateDelivery({
        rates,
        dispatchDaysMin: o.dispatchDaysMin,
        dispatchDaysMax: o.dispatchDaysMax,
        cutoffMinutes: o.location.sameDayCutoffMinutes ?? DEFAULT_SAME_DAY_CUTOFF_MIN,
        now,
      });
      return { offerId: o.id, originCity: o.location.city, estimate: true as const, ...est };
    });
}

// ───────────────────────────────────────────── returns policy

export type ReturnReason = 'wrongPart' | 'damaged' | 'notAsDescribed' | 'changedMind';

/**
 * Who pays the return shipping:
 * - wrongPart on a guaranteed line → Qitah (fit guarantee), auto-approved, full refund incl. outbound shipping share.
 * - wrongPart where the seller claimed the fit → the merchant; with no fit claim at all → the customer.
 * - damaged / notAsDescribed → the merchant.
 * - changedMind → the customer (unopened items only), deducted from the refund.
 */
export function returnShippingPayer(reason: string, guaranteed: boolean, fitStatuses: string[]): ShipmentPayer {
  if (reason === 'wrongPart') {
    if (guaranteed) return 'PLATFORM';
    return fitStatuses.includes('sellerReported') ? 'MERCHANT' : 'CUSTOMER';
  }
  if (reason === 'changedMind') return 'CUSTOMER';
  return 'MERCHANT';
}

export function returnPolicy(windowDays: number) {
  return {
    windowDays,
    refundTiming: { afterInspectionHours: 48, bankDaysMin: 3, bankDaysMax: 7 },
    reasons: {
      wrongPart: { guaranteed: { shippingPaidBy: 'PLATFORM', autoApproved: true, refund: 'FULL_WITH_DELIVERY' }, notGuaranteed: { shippingPaidBy: 'MERCHANT_IF_SELLER_CLAIMED_FIT_ELSE_CUSTOMER', autoApproved: false, refund: 'ITEM_VALUE' } },
      damaged: { shippingPaidBy: 'MERCHANT', autoApproved: false, photosRequired: 1, refund: 'ITEM_VALUE' },
      notAsDescribed: { shippingPaidBy: 'MERCHANT', autoApproved: false, refund: 'ITEM_VALUE' },
      changedMind: { shippingPaidBy: 'CUSTOMER', autoApproved: false, unopenedOnly: true, refund: 'ITEM_VALUE_MINUS_RETURN_SHIPPING' },
    },
  } as const;
}

type ReturnLine = { quantity: number; orderItem: { quantity: number; lineTotalHalalas: number; fulfillmentGroupId: string; offer: { product: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; handling: Handling } } } };

/** Sandbox-quoted reverse shipment (customer city → pickup location city), cheapest service. */
export function quoteReturn(ctx: Ctx, input: { customerCity: string; originCity: string; lines: ReturnLine[] }) {
  const products = input.lines.map((l) => l.orderItem.offer.product);
  const dims = products
    .map((p) => [p.lengthCm, p.widthCm, p.heightCm].sort((a, b) => b - a) as [number, number, number])
    .reduce((m, d) => (d[0] * d[1] * d[2] > m[0] * m[1] * m[2] ? d : m));
  const handling: Handling = products.find((p) => p.handling !== 'STANDARD')?.handling ?? 'STANDARD';
  const rates = ctx.carrier.rates({
    originCity: input.customerCity,
    destinationCity: input.originCity,
    weightGrams: input.lines.reduce((s, l) => s + l.orderItem.offer.product.weightGrams * l.quantity, 0),
    maxDimsCm: dims,
    handling,
    itemCount: input.lines.reduce((s, l) => s + l.quantity, 0),
    sameDayEligible: false,
  });
  const cheapest = [...rates].sort((a, b) => a.amountHalalas - b.amountHalalas)[0];
  return cheapest ? { serviceCode: cheapest.serviceCode, costHalalas: cheapest.amountHalalas } : { serviceCode: 'standard', costHalalas: 0 };
}

/** A returned line's share of its shipping group's outbound fee (by item value), pro-rated by the returned quantity. */
export function outboundShippingShare(
  group: { quotedHalalas: number; items: { id: string; lineTotalHalalas: number }[] },
  itemId: string,
  quantity: number,
  itemQuantity: number,
): number {
  const shares = allocate(group.quotedHalalas, group.items.map((i) => i.lineTotalHalalas));
  const idx = group.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return 0;
  return Math.floor((shares[idx] * quantity) / itemQuantity);
}

export function presentFit(json: unknown) {
  const snap = readFitSnapshot(json);
  if (!snap) return null;
  return { status: snap.status, guaranteed: snap.guaranteed, vehicle: snap.vehicle, vin: snap.vin };
}
