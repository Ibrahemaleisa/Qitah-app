import { randomInt } from 'node:crypto';

import { CITIES, type CityId } from '../../lib/cities.js';
import type { CarrierAdapter, ParcelGroup, RateQuote } from './types.js';

/**
 * QITAH SANDBOX CARRIER — deterministic rate table and fake labels for testing only.
 * Tracking numbers are prefixed "SBX" and are never valid with any real carrier.
 */
export const SANDBOX_CARRIER_CODE = 'qitah-sandbox';

const PARCEL_MAX_GRAMS = 30_000;
const SAME_DAY_MAX_GRAMS = 10_000;

function zone(origin: string, dest: string): 'city' | 'region' | 'national' {
  if (origin === dest) return 'city';
  const a = CITIES[origin as CityId]?.region;
  const b = CITIES[dest as CityId]?.region;
  return a && a === b ? 'region' : 'national';
}

/** Billable kg: max(actual, volumetric L*W*H/5000), rounded up. */
export function billableKg(group: ParcelGroup): number {
  const [l, w, h] = group.maxDimsCm;
  const volumetricGrams = Math.ceil((l * w * h * 1000) / 5000) * Math.max(1, Math.min(group.itemCount, 3));
  return Math.max(1, Math.ceil(Math.max(group.weightGrams, volumetricGrams) / 1000));
}

export class SandboxCarrier implements CarrierAdapter {
  readonly code = SANDBOX_CARRIER_CODE;
  readonly sandbox = true;

  constructor(private baseUrl: string) {}

  rates(group: ParcelGroup): RateQuote[] {
    if (!CITIES[group.originCity as CityId] || !CITIES[group.destinationCity as CityId]) return [];
    const z = zone(group.originCity, group.destinationCity);
    const kg = billableKg(group);
    const extraKg = Math.max(0, kg - 1);
    const base = { city: 1500, region: 2200, national: 2900 }[z];
    const eta = { city: [1, 2], region: [2, 3], national: [3, 5] }[z] as [number, number];
    const out: RateQuote[] = [];
    const q = (serviceCode: RateQuote['serviceCode'], amount: number, min: number, max: number) =>
      out.push({ carrierCode: this.code, serviceCode, amountHalalas: amount, etaDaysMin: min, etaDaysMax: max, sandbox: true });

    const needsFreight = group.handling === 'OVERSIZED' || group.weightGrams > PARCEL_MAX_GRAMS;
    if (needsFreight) {
      q('freight', 6000 + base + 100 * kg, eta[0] + 1, eta[1] + 2);
      return out;
    }
    const hazmat = group.handling === 'HAZMAT';
    q('standard', base + 150 * extraKg + (hazmat ? 1000 : 0), eta[0], eta[1]);
    if (hazmat) return out;
    q('express', Math.round(((base + 150 * extraKg) * 16) / 10), Math.max(1, eta[0] - 1), Math.max(1, eta[1] - 1));
    if (z === 'city' && group.weightGrams <= SAME_DAY_MAX_GRAMS && group.handling !== 'FRAGILE') q('sameDay', 3500 + 100 * extraKg, 0, 0);
    return out;
  }

  async createShipment(input: { shipmentId: string }) {
    const trackingNumber = `SBX${randomInt(1_000_000_000, 9_999_999_999)}`;
    return {
      carrierShipmentId: `sbx_shp_${input.shipmentId}`,
      trackingNumber,
      labelUrl: `${this.baseUrl}/sandbox/labels/${input.shipmentId}`,
    };
  }

  async schedulePickup(input: { carrierShipmentId: string }) {
    return { confirmationId: `sbx_pickup_${input.carrierShipmentId.slice(-8)}` };
  }

  async cancel() {}
}
