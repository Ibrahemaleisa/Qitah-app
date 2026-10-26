import { toArt, toCityId, toCondition } from '@/api/adapters';
import { halalasToSar } from '@/api/money';
import type { ApiOrder } from '@/api/types';
import type { CityId, Condition, L10n, PartArtKind, ShipmentStage } from '@/domain/types';
import { shipmentStages, type OrderStatus } from '@/services/orders';

/**
 * Maps the server's customer order view onto the app's existing order/tracking UI.
 *
 * Stage mapping (per shipment group, never ahead of what the server reports):
 *   placed          = order paid
 *   confirmed       = merchant sub-order ACCEPTED
 *   packed          = PACKING / READY_FOR_PICKUP (or a label / pickup booked)
 *   shipped         = carrier PICKED_UP / IN_TRANSIT (or merchant HANDED_OVER)
 *   outForDelivery  = OUT_FOR_DELIVERY
 *   delivered       = DELIVERED
 * Exceptions (PICKUP_FAILED, DELIVERY_FAILED, …) keep the last real stage and are flagged.
 */

export const RETURN_WINDOW_DAYS = 7;

const MO_STAGE: Record<string, ShipmentStage> = {
  ACCEPTED: 'confirmed',
  PACKING: 'packed',
  READY_FOR_PICKUP: 'packed',
  HANDED_OVER: 'shipped',
  DELIVERED: 'delivered',
};

const SHIPMENT_STAGE: Record<string, ShipmentStage> = {
  LABEL_CREATED: 'packed',
  PICKUP_SCHEDULED: 'packed',
  PICKUP_FAILED: 'packed',
  PICKED_UP: 'shipped',
  IN_TRANSIT: 'shipped',
  OUT_FOR_DELIVERY: 'outForDelivery',
  DELIVERY_FAILED: 'outForDelivery',
  DELIVERED: 'delivered',
};

export type ShipmentException = 'PICKUP_FAILED' | 'DELIVERY_FAILED' | 'EXCEPTION' | 'RETURNED_TO_SENDER' | 'CANCELLED';
const EXCEPTIONS: ShipmentException[] = ['PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION', 'RETURNED_TO_SENDER', 'CANCELLED'];

const idx = (s: ShipmentStage) => shipmentStages.indexOf(s);

/** The stage reached by one shipment group, or `null` while the order is not paid yet. */
export function mapShipmentStage(input: { paid: boolean; merchantOrderStatus: string; shipmentStatus?: string | null }): ShipmentStage | null {
  if (!input.paid) return null;
  let stage: ShipmentStage = 'placed';
  const fromMo = MO_STAGE[input.merchantOrderStatus];
  if (fromMo && idx(fromMo) > idx(stage)) stage = fromMo;
  const fromShipment = input.shipmentStatus ? SHIPMENT_STAGE[input.shipmentStatus] : undefined;
  if (fromShipment && idx(fromShipment) > idx(stage)) stage = fromShipment;
  return stage;
}

export function shipmentException(status: string | null | undefined): ShipmentException | undefined {
  return EXCEPTIONS.includes(status as ShipmentException) ? (status as ShipmentException) : undefined;
}

/** Server order status → the app's order status vocabulary (badges, list). */
export function mapOrderStatus(order: Pick<ApiOrder, 'status' | 'payment'>, stages: (ShipmentStage | null)[] = []): OrderStatus {
  switch (order.status) {
    case 'PENDING_PAYMENT':
      return order.payment?.status === 'FAILED' ? 'paymentFailed' : 'pendingPayment';
    case 'PAYMENT_FAILED':
      return 'paymentFailed';
    case 'EXPIRED':
      return 'expired';
    case 'CANCELLED':
      return 'cancelled';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'delivered';
    case 'PARTIALLY_DELIVERED':
      return 'partiallyDelivered';
    case 'SHIPPED':
    case 'PARTIALLY_SHIPPED':
      return 'inTransit';
    default: {
      const active = stages.filter((s): s is ShipmentStage => s !== null);
      if (active.length && active.every((s) => s === 'delivered')) return 'delivered';
      if (active.some((s) => s === 'delivered')) return 'partiallyDelivered';
      if (active.some((s) => idx(s) >= idx('shipped'))) return 'inTransit';
      return 'processing';
    }
  }
}

export function isPaidStatus(status: string): boolean {
  return ['PAID', 'IN_FULFILLMENT', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'COMPLETED'].includes(status);
}

export type OrderItemView = {
  id: string;
  offerId: string;
  productId: string;
  name: L10n;
  partNumber: string;
  condition: Condition;
  art: PartArtKind;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  cancelled: boolean;
  merchantOrderId: string;
  groupId: string;
};

export type StageEventView = { stage: ShipmentStage; reached: boolean; at: number | null };

export type ShipmentView = {
  groupId: string;
  merchantOrderId: string;
  merchantOrderNumber: string;
  merchantOrderStatus: string;
  sellerId: string;
  sellerName: L10n;
  originCity: CityId | string | null;
  serviceCode: string;
  carrierCode: string;
  shippingFee: number;
  etaDays: [number, number];
  stage: ShipmentStage | null;
  stageIndex: number;
  timeline: StageEventView[];
  exception?: ShipmentException;
  /** Merchant cancelled/rejected this part. */
  cancelled: boolean;
  rejected: boolean;
  trackingNumber: string | null;
  sandboxTracking: boolean;
  events: { status: string; description: string | null; location: string | null; at: number }[];
  items: OrderItemView[];
};

export type OrderView = {
  id: string;
  number: string;
  serverStatus: string;
  status: OrderStatus;
  sandbox: boolean;
  createdAt: number;
  paidAt: number | null;
  paymentExpiresAt: number;
  paymentMethod: string;
  totals: { items: number; shipping: number; total: number; vat: number; refunded: number };
  address: { kind: 'home' | 'workshop'; label: string; workshopName?: string; city: string; district: string; street: string; contactName: string; phone: string } | null;
  vehicleLabel?: string;
  cancelReason: string | null;
  payment: { status: string; method: string; sandbox: boolean; redirectUrl: string | null } | null;
  items: OrderItemView[];
  shipments: ShipmentView[];
  returns: { id: string; number: string; status: string; reason: string; refund: number; items: { orderItemId: string; quantity: number }[]; createdAt: number }[];
  refunds: { id: string; amount: number; status: string; reason: string | null; createdAt: number }[];
  canCancel: boolean;
  /** Items that can still be returned, with the maximum returnable quantity. */
  returnable: { itemId: string; maxQty: number }[];
};

const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

function firstEventAt(events: ShipmentView['events'], statuses: string[]): number | null {
  return events.find((e) => statuses.includes(e.status))?.at ?? null;
}

export function toOrderView(o: ApiOrder, now = Date.now()): OrderView {
  const paid = isPaidStatus(o.status) || (!!o.paidAt && o.status !== 'PENDING_PAYMENT');
  const items: OrderItemView[] = (o.items ?? []).map((i) => ({
    id: i.id,
    offerId: i.offerId,
    productId: i.productId,
    name: { ar: i.nameAr, en: i.nameEn || i.nameAr },
    partNumber: i.partNumber,
    condition: toCondition(i.condition),
    art: toArt(i.art),
    qty: i.quantity,
    unitPrice: halalasToSar(i.unitPriceHalalas),
    lineTotal: halalasToSar(i.lineTotalHalalas),
    cancelled: i.status === 'CANCELLED',
    merchantOrderId: i.merchantOrderId,
    groupId: i.fulfillmentGroupId,
  }));
  const mos = new Map((o.merchantOrders ?? []).map((m) => [m.id, m]));

  const shipments: ShipmentView[] = (o.shipmentGroups ?? []).map((g) => {
    const mo = mos.get(g.merchantOrderId);
    const moStatus = mo?.status ?? 'NEW';
    const sh = g.shipment ?? null;
    const events = (sh?.events ?? []).map((e) => ({ status: String(e.status), description: e.description, location: e.location, at: ts(e.occurredAt) ?? 0 }));
    const cancelled = moStatus === 'CANCELLED' || moStatus === 'REJECTED';
    const stage = mapShipmentStage({ paid, merchantOrderStatus: moStatus, shipmentStatus: sh?.status });
    const stageIndex = stage ? idx(stage) : 0;
    const stamps: Record<ShipmentStage, number | null> = {
      placed: ts(o.paidAt) ?? (paid ? ts(o.createdAt) : null),
      confirmed: null,
      packed: firstEventAt(events, ['LABEL_CREATED', 'PICKUP_SCHEDULED']),
      shipped: firstEventAt(events, ['PICKED_UP', 'IN_TRANSIT']),
      outForDelivery: firstEventAt(events, ['OUT_FOR_DELIVERY']),
      delivered: firstEventAt(events, ['DELIVERED']) ?? ts(mo?.deliveredAt),
    };
    const timeline = shipmentStages.map((st) => ({ stage: st, reached: stage !== null && idx(st) <= idx(stage), at: stage !== null && idx(st) <= idx(stage) ? stamps[st] : null }));
    return {
      groupId: g.id,
      merchantOrderId: g.merchantOrderId,
      merchantOrderNumber: mo?.number ?? '',
      merchantOrderStatus: moStatus,
      sellerId: mo?.merchant.id ?? '',
      sellerName: { ar: mo?.merchant.nameAr ?? '', en: mo?.merchant.nameEn || mo?.merchant.nameAr || '' },
      originCity: toCityId(g.originCity) ?? g.originCity ?? null,
      serviceCode: g.serviceCode,
      carrierCode: g.carrierCode,
      shippingFee: halalasToSar(g.shippingHalalas),
      etaDays: [g.etaDaysMin, g.etaDaysMax],
      stage,
      stageIndex,
      timeline,
      exception: shipmentException(sh?.status),
      cancelled,
      rejected: moStatus === 'REJECTED',
      trackingNumber: sh?.trackingNumber ?? null,
      sandboxTracking: !!sh?.trackingNumber && (sh.trackingNumber.startsWith('SBX') || !!sh.sandbox),
      events,
      items: items.filter((i) => i.groupId === g.id),
    };
  });

  const activeMos = (o.merchantOrders ?? []).filter((m) => !['REJECTED', 'CANCELLED'].includes(m.status));
  const canCancel =
    o.status === 'PENDING_PAYMENT' ||
    (['PAID', 'IN_FULFILLMENT'].includes(o.status) && activeMos.length > 0 && activeMos.every((m) => ['NEW', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'].includes(m.status)));

  const returnedQty = new Map<string, number>();
  for (const r of o.returns ?? []) {
    if (r.status === 'REJECTED') continue;
    for (const it of r.items) returnedQty.set(it.orderItemId, (returnedQty.get(it.orderItemId) ?? 0) + it.quantity);
  }
  const cutoff = now - RETURN_WINDOW_DAYS * 86_400_000;
  const returnable = items
    .filter((i) => {
      const mo = mos.get(i.merchantOrderId);
      const deliveredAt = ts(mo?.deliveredAt);
      return !i.cancelled && mo?.status === 'DELIVERED' && deliveredAt !== null && deliveredAt >= cutoff;
    })
    .map((i) => ({ itemId: i.id, maxQty: i.qty - (returnedQty.get(i.id) ?? 0) }))
    .filter((r) => r.maxQty > 0);

  const a = o.address as Record<string, string | null> | null;
  return {
    id: o.id,
    number: o.number,
    serverStatus: o.status,
    status: mapOrderStatus(o, shipments.filter((s) => !s.cancelled).map((s) => s.stage)),
    sandbox: !!o.sandbox,
    createdAt: ts(o.createdAt) ?? now,
    paidAt: ts(o.paidAt),
    paymentExpiresAt: ts(o.paymentExpiresAt) ?? now,
    paymentMethod: o.paymentMethod,
    totals: {
      items: halalasToSar(o.totals?.itemsHalalas),
      shipping: halalasToSar(o.totals?.shippingHalalas),
      total: halalasToSar(o.totals?.totalHalalas),
      vat: halalasToSar(o.totals?.vatHalalas),
      refunded: halalasToSar(o.totals?.refundedHalalas),
    },
    address: a
      ? {
          kind: String(a.kind ?? '').toLowerCase() === 'workshop' ? 'workshop' : 'home',
          label: a.label ?? '',
          workshopName: a.workshopName ?? undefined,
          city: a.city ?? '',
          district: a.district ?? '',
          street: a.street ?? '',
          contactName: a.contactName ?? '',
          phone: a.phone ?? '',
        }
      : null,
    vehicleLabel: o.vehicle?.label,
    cancelReason: o.cancelReason,
    payment: o.payment ? { status: o.payment.status, method: o.payment.method, sandbox: o.payment.sandbox, redirectUrl: o.payment.redirectUrl } : null,
    items,
    shipments,
    returns: (o.returns ?? []).map((r) => ({ id: r.id, number: r.number, status: r.status, reason: r.reason, refund: halalasToSar(r.refundHalalas), items: r.items, createdAt: ts(r.createdAt) ?? now })),
    refunds: (o.refunds ?? []).map((r) => ({ id: r.id, amount: halalasToSar(r.amountHalalas), status: r.status, reason: r.reason, createdAt: ts(r.createdAt) ?? now })),
    canCancel,
    returnable,
  };
}
