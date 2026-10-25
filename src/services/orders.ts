import { getProduct } from '@/data/catalog';
import { getOffer } from '@/data/offers';
import { deliveryOptions } from '@/data/sellers';
import { groupCartBySeller, shippingFeeFor, vatIncluded } from '@/domain/pricing';
import type {
  Address,
  CartLine,
  DeliveryOptionId,
  Order,
  OrderLine,
  PaymentMethodId,
  Shipment,
  ShipmentStage,
} from '@/domain/types';
import { makeId } from '@/lib/id';

/**
 * Order creation and SIMULATED fulfilment. In production, stages arrive from merchant
 * actions and carrier webhooks. Here each shipment advances on a compressed demo clock
 * (minutes instead of days) so the full tracking experience can be explored.
 */

export const shipmentStages: ShipmentStage[] = ['placed', 'confirmed', 'packed', 'shipped', 'outForDelivery', 'delivered'];

const MIN = 60_000;

function demoOffsets(option: DeliveryOptionId, dispatchMax: number): Shipment['stageOffsetsMin'] {
  const speed = option === 'sameDay' ? 0.5 : option === 'express' ? 0.8 : option === 'freight' ? 1.6 : 1;
  const d = 1 + dispatchMax * 0.5;
  return {
    confirmed: Math.round(1 * speed),
    packed: Math.round(2.5 * d * speed),
    shipped: Math.round(4 * d * speed),
    outForDelivery: Math.round(7 * d * speed),
    delivered: Math.round(10 * d * speed),
  };
}

function trackingNumber() {
  return `SIM${Math.floor(100000000 + Math.random() * 899999999)}`;
}

export type CreateOrderInput = {
  lines: CartLine[];
  address: Address;
  shippingChoice: Record<string, DeliveryOptionId>;
  paymentMethodId: PaymentMethodId;
  paymentReference: string;
  vehicleLabel?: string;
};

export function createOrder(input: CreateOrderInput): Order {
  const groups = groupCartBySeller(input.lines, input.address.kind, input.address.city);
  const orderLines: OrderLine[] = [];
  const shipments: Shipment[] = [];
  let shipping = 0;

  for (const group of groups) {
    const lineIds: string[] = [];
    let dispatchMax = 0;
    for (const { line, offer } of group.lines) {
      const product = getProduct(offer.productId);
      if (!product) continue;
      const id = makeId('ln');
      lineIds.push(id);
      dispatchMax = Math.max(dispatchMax, offer.dispatchDays[1]);
      orderLines.push({
        id,
        offerId: offer.id,
        productId: product.id,
        sellerId: offer.sellerId,
        qty: line.qty,
        unitPrice: offer.price,
        condition: offer.condition,
        productName: product.name,
        art: product.art,
      });
    }
    const optionId = input.shippingChoice[group.seller.id] ?? group.deliveryOptions[0]?.id ?? 'standard';
    const fee = shippingFeeFor(group, deliveryOptions[optionId]);
    shipping += fee;
    shipments.push({
      id: makeId('sh'),
      sellerId: group.seller.id,
      lineIds,
      deliveryOptionId: optionId,
      fee,
      trackingNumber: trackingNumber(),
      stageOffsetsMin: demoOffsets(optionId, dispatchMax),
    });
  }

  const items = orderLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const total = items + shipping;
  const createdAt = Date.now();
  return {
    id: makeId('ord'),
    number: `QT-${String(createdAt).slice(-7)}`,
    createdAt,
    lines: orderLines,
    shipments,
    address: input.address,
    vehicleLabel: input.vehicleLabel,
    payment: { methodId: input.paymentMethodId, simulated: true, reference: input.paymentReference },
    totals: { items, shipping, total, vat: vatIncluded(total) },
    returns: [],
  };
}

export type StageEvent = { stage: ShipmentStage; at: number; reached: boolean };

export function shipmentTimeline(order: Order, shipment: Shipment, now: number): StageEvent[] {
  const cutoff = order.cancellation ? order.cancellation.requestedAt : Number.POSITIVE_INFINITY;
  return shipmentStages.map((stage) => {
    const at = stage === 'placed' ? order.createdAt : order.createdAt + shipment.stageOffsetsMin[stage] * MIN;
    return { stage, at, reached: at <= now && at <= cutoff };
  });
}

export function currentStage(order: Order, shipment: Shipment, now: number): ShipmentStage {
  const reached = shipmentTimeline(order, shipment, now).filter((e) => e.reached);
  return reached[reached.length - 1]?.stage ?? 'placed';
}

export type OrderStatus = 'processing' | 'inTransit' | 'partiallyDelivered' | 'delivered' | 'cancelled';

export function orderStatus(order: Order, now: number): OrderStatus {
  if (order.cancellation) return 'cancelled';
  const stages = order.shipments.map((s) => shipmentStages.indexOf(currentStage(order, s, now)));
  const deliveredIdx = shipmentStages.indexOf('delivered');
  const shippedIdx = shipmentStages.indexOf('shipped');
  if (stages.every((i) => i === deliveredIdx)) return 'delivered';
  if (stages.some((i) => i === deliveredIdx)) return 'partiallyDelivered';
  if (stages.some((i) => i >= shippedIdx)) return 'inTransit';
  return 'processing';
}

/** Cancellation is possible until any shipment has been handed to a carrier. */
export function canCancel(order: Order, now: number): boolean {
  if (order.cancellation) return false;
  const shippedIdx = shipmentStages.indexOf('shipped');
  return order.shipments.every((s) => shipmentStages.indexOf(currentStage(order, s, now)) < shippedIdx);
}

export const RETURN_WINDOW_DAYS = 7;

export function returnableLineIds(order: Order, now: number): string[] {
  if (order.cancellation) return [];
  const ids: string[] = [];
  for (const shipment of order.shipments) {
    const timeline = shipmentTimeline(order, shipment, now);
    const delivered = timeline[timeline.length - 1];
    if (!delivered.reached) continue;
    if (now - delivered.at > RETURN_WINDOW_DAYS * 24 * 60 * MIN) continue;
    for (const id of shipment.lineIds) {
      if (!order.returns.some((r) => r.lineId === id)) ids.push(id);
    }
  }
  return ids;
}

/** The pre-seeded SAMPLE order: two sellers, one shipment delivered and one still moving. */
export function buildSampleOrder(): Order {
  const now = Date.now();
  const createdAt = now - 46 * 60 * MIN;
  const lineA = makeId('ln');
  const lineB = makeId('ln');
  const offerA = getOffer('o-014');
  const offerB = getOffer('o-004');
  const productA = getProduct(offerA?.productId ?? '');
  const productB = getProduct(offerB?.productId ?? '');
  const lines: OrderLine[] = [];
  if (offerA && productA) {
    lines.push({ id: lineA, offerId: offerA.id, productId: productA.id, sellerId: offerA.sellerId, qty: 2, unitPrice: offerA.price, condition: offerA.condition, productName: productA.name, art: productA.art });
  }
  if (offerB && productB) {
    lines.push({ id: lineB, offerId: offerB.id, productId: productB.id, sellerId: offerB.sellerId, qty: 1, unitPrice: offerB.price, condition: offerB.condition, productName: productB.name, art: productB.art });
  }
  const items = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const shipping = 0;
  const minutesSince = (now - createdAt) / MIN;
  return {
    id: 'ord-sample',
    number: 'QT-DEMO01',
    createdAt,
    isSample: true,
    lines,
    shipments: [
      {
        id: 'sh-sample-a',
        sellerId: offerA?.sellerId ?? 's-elite-oils',
        lineIds: [lineA],
        deliveryOptionId: 'express',
        fee: 0,
        trackingNumber: 'SIM482019334',
        stageOffsetsMin: { confirmed: 30, packed: 240, shipped: 600, outForDelivery: 1500, delivered: 1700 },
      },
      {
        id: 'sh-sample-b',
        sellerId: offerB?.sellerId ?? 's-elite-oils',
        lineIds: [lineB],
        deliveryOptionId: 'standard',
        fee: 0,
        trackingNumber: 'SIM482019871',
        stageOffsetsMin: { confirmed: 60, packed: 900, shipped: 2400, outForDelivery: Math.round(minutesSince + 90), delivered: Math.round(minutesSince + 240) },
      },
    ],
    address: {
      id: 'addr-sample',
      kind: 'workshop',
      label: 'ورشة النخبة',
      workshopName: 'ورشة النخبة لصيانة السيارات',
      city: 'riyadh',
      district: 'العليا',
      street: 'طريق الملك فهد',
      contactName: 'عميل تجريبي',
      phone: '+966500000000',
    },
    vehicleLabel: undefined,
    payment: { methodId: 'applePay', simulated: true, reference: 'SIM-DEMO01' },
    totals: { items, shipping, total: items + shipping, vat: vatIncluded(items + shipping) },
    returns: [],
  };
}
