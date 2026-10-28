import { categorySuggestions, defaultFilters, searchProducts, searchWithFallback } from '@/services/catalog';
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

describe('searchWithFallback', () => {
  const run = (query: string) => searchWithFallback({ query, filters: { ...defaultFilters }, sort: 'relevance' });

  it('keeps exact mode when the query matches', () => {
    expect(run('battery').mode).toBe('exact');
  });

  it('corrects a one-letter typo of a known part term', () => {
    const outcome = run('battrey');
    expect(outcome.mode).toBe('corrected');
    expect(outcome.correctedQuery).toBe('battery');
    expect(outcome.results.map((l) => l.product.id)).toContain('p-battery-70');
  });

  it('tolerates a typo in other words and labels the results as similar', () => {
    const outcome = run('slottd');
    expect(outcome.mode).toBe('similar');
    expect(outcome.results.map((l) => l.product.id)).toContain('p-lc-rotor-slotted');
  });

  it('matches partial multi-word queries forgivingly', () => {
    const outcome = run('فحمات تويوتا كروزر');
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  it('does not fuzz part numbers', () => {
    const outcome = run('04465x9999');
    expect(outcome.partNumberQuery).toBe(true);
    expect(outcome.results).toHaveLength(0);
  });
});

describe('categorySuggestions', () => {
  it('suggests categories by Arabic or English name', () => {
    expect(categorySuggestions('فرامل').map((c) => c.id)).toEqual(['brakes']);
    expect(categorySuggestions('filt').map((c) => c.id)).toEqual(['filters']);
  });
});

describe('colloquial, vehicle-aware search (demo mode, shared lexicon)', () => {
  const run = (query: string, vehicle?: Vehicle, extra: Partial<typeof defaultFilters> = {}) =>
    searchWithFallback({ query, filters: { ...defaultFilters, ...extra }, sort: 'relevance', vehicle });
  const found = (query: string) =>
    run(query)
      .results.map((l) => l.product.id)
      .sort();

  it.each([
    ['هوبات', ['p-lc-rotor-oem', 'p-lc-rotor-slotted']],
    ['ديسكات', ['p-lc-rotor-oem', 'p-lc-rotor-slotted']],
    ['طنابير', ['p-lc-rotor-oem', 'p-lc-rotor-slotted']],
    ['قربة', ['p-patrol-radiator']],
    ['راديتر', ['p-patrol-radiator']],
    ['بوجيهات', ['p-spark-iridium']],
    ['بريك', ['p-camry-pads-ceramic', 'p-camry-pads-oem', 'p-tahoe-pads-rear']],
    ['مساعدات', ['p-elantra-strut-oem', 'p-hilux-shock']],
    ['سيور', ['p-f150-belt']],
    ['دعامية', ['p-hilux-bumper']],
    ['دينمو', ['p-lc-alternator']],
    ['ماء رديتر', ['p-coolant']],
    ['مرايه', ['p-sonata-mirror']],
    ['لمبات', ['p-camry-headlight', 'p-h11-led']],
  ])('%s finds the right parts', (query, ids) => {
    expect(found(query)).toEqual(ids);
  });

  it.each(['كفرات', 'اطارات', 'كلتش', 'قير', 'كمبروسر', 'سلف'])('%s is recognised as a part we do not list yet', (query) => {
    const outcome = run(query);
    expect(outcome.results).toHaveLength(0);
    expect(outcome.mode).toBe('exact');
    expect(outcome.interpretation.unsupported).toHaveLength(1);
  });

  it('"فلتر زيت كامري 2022" filters to oil filters that fit a 2022 Camry and explains it', () => {
    const outcome = run('فلتر زيت كامري 2022');
    expect(outcome.interpretation.concepts.map((c) => c.id)).toEqual(['oilFilter']);
    expect(outcome.interpretation.vehicle).toMatchObject({ modelId: 'camry', year: 2022, source: 'query', scope: 'vehicle', label: { ar: 'كامري 2022', en: 'Camry 2022' } });
    expect(outcome.interpretation.withoutVehicle).toBe('فلتر زيت');
    expect(outcome.results.map((l) => l.product.id).sort()).toEqual(['p-oil-filter-kanzen', 'p-toyota-oil-filter']);
    expect(outcome.results.every((l) => l.fit === 'catalogMatch')).toBe(true);
  });

  it('"fits my car" is on by default: incompatible parts are hidden and counted, or shown under a divider', () => {
    expect(defaultFilters.fitsVehicleOnly).toBe(true);
    const on = run('فحمات', camry);
    expect(on.fits.map((l) => l.product.id).sort()).toEqual(['p-camry-pads-ceramic', 'p-camry-pads-oem']);
    expect(on.others).toHaveLength(0);
    expect(on.hiddenOthers).toBe(1);
    const off = run('فحمات', camry, { fitsVehicleOnly: false });
    expect(off.others.map((l) => l.product.id)).toEqual(['p-tahoe-pads-rear']);
    expect(off.results.map((l) => l.group)).toEqual(['fits', 'fits', 'other']);
  });

  it('a typed part number is never hidden by the fit filter', () => {
    const outcome = run('43512-X6040', camry);
    expect(outcome.others.map((l) => l.product.id)).toEqual(expect.arrayContaining(['p-lc-rotor-oem']));
    expect(outcome.hiddenOthers).toBe(0);
  });

  it('a different model typed in the query overrides the selected car without inventing its engine', () => {
    const outcome = run('رديتر باترول 2020', camry);
    expect(outcome.interpretation.vehicle).toMatchObject({ modelId: 'patrol', year: 2020 });
    expect(outcome.interpretation.vehicle?.engine).toBeUndefined();
    // The radiator is listed only for the V8: with no engine known it is not claimed as a fit.
    expect(outcome.fits).toHaveLength(0);
    expect(outcome.hiddenOthers).toBe(1);
  });

  it('a model without a year never claims "fits your car"', () => {
    const outcome = run('زيت كامري');
    expect(outcome.interpretation.vehicle?.scope).toBe('model');
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.every((l) => l.fit === 'bySpecification' || l.fit === 'noVehicle')).toBe(true);
  });
});
