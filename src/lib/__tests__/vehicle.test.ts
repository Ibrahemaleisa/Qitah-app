import { formatVin, isValidVin } from '@/lib/vehicle';

describe('VIN helpers', () => {
  it('splits a VIN 9 + 8 with a non-breaking space (guidelines p.30)', () => {
    expect(formatVin('jtnb11hk0n3012345')).toBe('JTNB11HK0\u00A0N3012345');
  });

  it('validates ISO 3779 VINs', () => {
    expect(isValidVin('JTNB11HK0N3012345')).toBe(true);
    expect(isValidVin('JTNB11HK0N301234O')).toBe(false);
  });
});
