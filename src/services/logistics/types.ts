import type { Address, CityId, DeliveryOptionId } from '@/domain/types';

/**
 * Logistics provider contract. Each carrier integration (national parcel networks,
 * same-day couriers, freight for bulky parts) becomes one adapter; the order service
 * chooses adapters per shipment. Merchants never integrate carriers directly.
 */

export type ParcelSpec = { weightKg: number; lengthCm: number; widthCm: number; heightCm: number; bulky?: boolean };

export type RateRequest = {
  originCity: CityId;
  destination: Pick<Address, 'city' | 'kind'>;
  parcels: ParcelSpec[];
};

export type RateQuote = {
  providerId: string;
  serviceId: DeliveryOptionId;
  fee: number;
  etaDays: [number, number];
  supportsWorkshop: boolean;
};

export type ShipmentRequest = {
  orderId: string;
  sellerId: string;
  serviceId: DeliveryOptionId;
  pickup: { city: CityId; address: string; contactPhone: string };
  dropoff: Address;
  parcels: ParcelSpec[];
};

export type TrackingEvent = { code: string; at: number; location?: string };

export interface LogisticsProvider {
  readonly id: string;
  quote(request: RateRequest): Promise<RateQuote[]>;
  createShipment(request: ShipmentRequest): Promise<{ trackingNumber: string; labelUrl?: string }>;
  track(trackingNumber: string): Promise<TrackingEvent[]>;
  schedulePickup(trackingNumber: string, window: { from: number; to: number }): Promise<{ confirmed: boolean }>;
  createReturn(trackingNumber: string, reason: string): Promise<{ returnTrackingNumber: string }>;
}
