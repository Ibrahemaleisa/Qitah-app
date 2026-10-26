import type { Handling } from '@prisma/client';

export type ParcelGroup = {
  originCity: string;
  destinationCity: string;
  weightGrams: number;
  /** Largest single item dimensions, cm. */
  maxDimsCm: [number, number, number];
  handling: Handling;
  itemCount: number;
};

export type RateQuote = {
  carrierCode: string;
  serviceCode: 'standard' | 'express' | 'sameDay' | 'freight';
  amountHalalas: number;
  etaDaysMin: number;
  etaDaysMax: number;
  sandbox: boolean;
};

export type CreateShipmentInput = {
  shipmentId: string;
  serviceCode: string;
  origin: { name: string; city: string; district: string; street: string; phone: string };
  destination: { name: string; city: string; district: string; street: string; phone: string };
  weightGrams: number;
  reference: string;
};

export type CreatedShipment = { carrierShipmentId: string; trackingNumber: string; labelUrl: string };

export interface CarrierAdapter {
  readonly code: string;
  readonly sandbox: boolean;
  /** Deterministic rates for a parcel group. Returns only services actually available. */
  rates(group: ParcelGroup): RateQuote[];
  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
  schedulePickup(input: { carrierShipmentId: string; windowStart: Date; windowEnd: Date }): Promise<{ confirmationId: string }>;
  cancel(input: { carrierShipmentId: string }): Promise<void>;
}
