import { deliveryOptions } from '@/data/sellers';

import type { LogisticsProvider, RateQuote, RateRequest, TrackingEvent } from './types';

/** SIMULATED carrier: deterministic quotes from sample delivery options, no network calls. */
export const mockLogisticsProvider: LogisticsProvider = {
  id: 'mock-carrier',
  async quote(request: RateRequest): Promise<RateQuote[]> {
    const bulky = request.parcels.some((p) => p.bulky);
    return Object.values(deliveryOptions)
      .filter((o) => (bulky ? o.id === 'freight' : o.id !== 'freight'))
      .filter((o) => !o.sameCityOnly || request.originCity === request.destination.city)
      .map((o) => ({ providerId: 'mock-carrier', serviceId: o.id, fee: o.fee, etaDays: o.etaDays, supportsWorkshop: true }));
  },
  async createShipment() {
    return { trackingNumber: `SIM${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}` };
  },
  async track(): Promise<TrackingEvent[]> {
    return [];
  },
  async schedulePickup() {
    return { confirmed: true };
  },
  async createReturn(trackingNumber: string) {
    return { returnTrackingNumber: `RT-${trackingNumber}` };
  },
};
