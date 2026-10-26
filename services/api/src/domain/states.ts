import type { MerchantOrderStatus, ReturnStatus, ShipmentStatus } from '@prisma/client';

import { conflict } from '../lib/errors.js';

export const MERCHANT_ORDER_TRANSITIONS: Record<MerchantOrderStatus, MerchantOrderStatus[]> = {
  PENDING_PAYMENT: ['NEW', 'CANCELLED'],
  NEW: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PACKING', 'REJECTED', 'CANCELLED'],
  PACKING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['HANDED_OVER', 'CANCELLED'],
  HANDED_OVER: ['DELIVERED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: ['LABEL_CREATED', 'CANCELLED'],
  LABEL_CREATED: ['PICKUP_SCHEDULED', 'PICKED_UP', 'CANCELLED'],
  PICKUP_SCHEDULED: ['PICKED_UP', 'PICKUP_FAILED', 'CANCELLED'],
  PICKUP_FAILED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'EXCEPTION'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'RETURNED_TO_SENDER', 'EXCEPTION'],
  EXCEPTION: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED_TO_SENDER', 'PICKUP_SCHEDULED'],
  DELIVERED: [],
  CANCELLED: [],
  RETURNED_TO_SENDER: [],
};

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['IN_TRANSIT', 'RECEIVED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['REFUNDED', 'CLOSED'],
  REFUNDED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};

/** Statuses at or after carrier collection. */
export const COLLECTED: ShipmentStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'EXCEPTION', 'DELIVERED'];
export const TERMINAL_SHIPMENT: ShipmentStatus[] = ['DELIVERED', 'CANCELLED', 'RETURNED_TO_SENDER'];

export function canTransition<S extends string>(map: Record<S, S[]>, from: S, to: S): boolean {
  return map[from]?.includes(to) ?? false;
}

export function assertTransition<S extends string>(map: Record<S, S[]>, from: S, to: S, entity: string) {
  if (!canTransition(map, from, to)) {
    throw conflict('INVALID_TRANSITION', `${entity} cannot move from ${from} to ${to}`, { from, to });
  }
}
