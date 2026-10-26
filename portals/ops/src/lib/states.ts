import type { MerchantOrderStatus, ReturnStatus, ShipmentStatus } from './types';

/** Mirrors services/api/src/domain/states.ts — the UI only offers transitions the API will accept. */
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

/** Carrier scans the sandbox simulator may send (the carrier webhook accepts these). */
const SANDBOX_SCANS: ShipmentStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION'];

/**
 * Manual ops events: any valid transition except those that have dedicated actions
 * (label → POST /label, pickup booking → POST /pickup) or that would orphan the suborder (CANCELLED).
 */
const MANUAL_EXCLUDED: ShipmentStatus[] = ['LABEL_CREATED', 'PICKUP_SCHEDULED', 'CANCELLED'];

export const sandboxScansFrom = (s: ShipmentStatus) => SHIPMENT_TRANSITIONS[s].filter((t) => SANDBOX_SCANS.includes(t));
export const manualEventsFrom = (s: ShipmentStatus) => SHIPMENT_TRANSITIONS[s].filter((t) => !MANUAL_EXCLUDED.includes(t));
/** POST /pickup is accepted only from these (services/api shipping.schedulePickup). */
export const canSchedulePickup = (s: ShipmentStatus) => s === 'LABEL_CREATED' || s === 'PICKUP_FAILED';
export const canCreateLabel = (s: ShipmentStatus) => s === 'PENDING';

export const EXCEPTION_STATUSES: ShipmentStatus[] = ['PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION'];
export const IN_TRANSIT_STATUSES: ShipmentStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'];

/** Ops acting on the merchant's behalf: which action is next for a suborder. */
export type MoAction = 'accept' | 'pack' | 'ready' | 'reject';
export function merchantOrderActions(s: MerchantOrderStatus): MoAction[] {
  switch (s) {
    case 'NEW':
      return ['accept', 'reject'];
    case 'ACCEPTED':
      return ['pack', 'reject'];
    case 'PACKING':
      return ['ready'];
    default:
      return [];
  }
}
export const MO_ACTION_LABEL: Record<MoAction, string> = { accept: 'قبول', pack: 'بدء التغليف', ready: 'تعليم كجاهز', reject: 'رفض' };

export const ACTIVE_MO: MerchantOrderStatus[] = ['NEW', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'];

export type ReturnAction = 'approve' | 'reject' | 'receive' | 'inspect';
export function returnActions(s: ReturnStatus): ReturnAction[] {
  switch (s) {
    case 'REQUESTED':
      return ['approve', 'reject'];
    case 'APPROVED':
    case 'IN_TRANSIT':
      return ['receive'];
    case 'RECEIVED':
      return ['inspect'];
    default:
      return [];
  }
}
