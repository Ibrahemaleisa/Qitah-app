import ar from '@/i18n/ar';
import en from '@/i18n/en';

/** Every key (deeply) in one dictionary must exist in the other, with the same kind of value. */
function shape(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  return [`${prefix}:${typeof value}`];
}

describe('i18n dictionaries', () => {
  it('ar and en have identical keys', () => {
    expect(shape(en).sort()).toEqual(shape(ar).sort());
  });
});
