import { getProduct } from '@/data/catalog';
import { getFitStatus } from '@/domain/compatibility';
import type { Vehicle } from '@/domain/types';

const camry2022: Vehicle = { id: 'v', makeId: 'toyota', modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', addedAt: 0 };

describe('getFitStatus', () => {
  it('reports a catalog match only when model, year and engine all apply', () => {
    expect(getFitStatus(getProduct('p-camry-pads-oem')!, camry2022)).toBe('catalogMatch');
    expect(getFitStatus(getProduct('p-spark-iridium')!, camry2022)).toBe('catalogMatch');
    expect(getFitStatus(getProduct('p-spark-iridium')!, { ...camry2022, engine: '3.5L V6' })).toBe('noData');
  });

  it('never upgrades seller-reported fitment to a verified match', () => {
    const altima: Vehicle = { ...camry2022, makeId: 'nissan', modelId: 'altima', engine: '2.5L I4' };
    expect(getFitStatus(getProduct('p-camry-pads-ceramic')!, altima)).toBe('sellerReported');
  });

  it('respects year ranges', () => {
    expect(getFitStatus(getProduct('p-camry-headlight')!, { ...camry2022, year: 2019 })).toBe('noData');
  });

  it('treats spec-based parts as fitting by specification, never as verified', () => {
    expect(getFitStatus(getProduct('p-oil-5w30')!, camry2022)).toBe('bySpecification');
    expect(getFitStatus(getProduct('p-oil-5w30')!, undefined)).toBe('bySpecification');
  });

  it('asks for a vehicle when none is selected', () => {
    expect(getFitStatus(getProduct('p-camry-pads-oem')!, undefined)).toBe('noVehicle');
  });
});
