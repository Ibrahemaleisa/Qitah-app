import { halalasToSar, optionalHalalasToSar, sarToHalalas } from '@/api/money';

describe('halala ↔ SAR conversion', () => {
  it('converts integer halalas to SAR with exact two-decimal values', () => {
    expect(halalasToSar(38900)).toBe(389);
    expect(halalasToSar(1999)).toBe(19.99);
    expect(halalasToSar(5)).toBe(0.05);
    expect(halalasToSar(0)).toBe(0);
  });

  it('is safe on missing or invalid input', () => {
    expect(halalasToSar(null)).toBe(0);
    expect(halalasToSar(undefined)).toBe(0);
    expect(halalasToSar(Number.NaN)).toBe(0);
    expect(optionalHalalasToSar(null)).toBeUndefined();
    expect(optionalHalalasToSar(41000)).toBe(410);
  });

  it('round-trips without float drift', () => {
    for (const h of [1, 10, 99, 1999, 74450, 9711, 123456789]) {
      expect(sarToHalalas(halalasToSar(h))).toBe(h);
    }
    expect(sarToHalalas(0.1 + 0.2)).toBe(30);
  });
});
