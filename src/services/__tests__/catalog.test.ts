import { defaultFilters, searchProducts } from '@/services/catalog';
import type { Vehicle } from '@/domain/types';

const camry: Vehicle = { id: 'v', makeId: 'toyota', modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', addedAt: 0 };
const ids = (q: string, extra: Partial<typeof defaultFilters> = {}, vehicle?: Vehicle) =>
  searchProducts({ query: q, filters: { ...defaultFilters, ...extra }, sort: 'relevance', vehicle }).map((l) => l.product.id);

describe('searchProducts', () => {
  it('matches Arabic text regardless of hamza / ta marbuta spelling', () => {
    expect(ids('فحمات')).toContain('p-camry-pads-oem');
    expect(ids('بطاريه')).toContain('p-battery-70');
  });

  it('matches English names', () => {
    expect(ids('oil filter')).toEqual(expect.arrayContaining(['p-toyota-oil-filter', 'p-oil-filter-kanzen']));
  });

  it('matches part numbers without separators, including OEM cross references', () => {
    const results = ids('04465x3301');
    expect(results[0]).toBe('p-camry-pads-oem');
    expect(results).toContain('p-camry-pads-ceramic');
  });

  it('ranks catalog-verified fitment first for the selected vehicle', () => {
    const results = searchProducts({ query: 'brake', filters: { ...defaultFilters }, sort: 'relevance', vehicle: camry });
    expect(results[0].fit).toBe('catalogMatch');
  });

  it('filters by condition and origin', () => {
    const used = searchProducts({ query: '', filters: { ...defaultFilters, conditions: ['used'] }, sort: 'relevance' });
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((l) => l.offers.every((o) => o.condition === 'used'))).toBe(true);
    expect(ids('', { origins: ['oem'] }).every((id) => !['p-oil-5w30', 'p-camry-pads-ceramic'].includes(id))).toBe(true);
  });

  it('hides out-of-stock offers when requested', () => {
    const rotor = searchProducts({ query: 'slotted', filters: { ...defaultFilters, inStockOnly: true }, sort: 'relevance' })[0];
    expect(rotor.offers.every((o) => o.stock > 0)).toBe(true);
  });
});
