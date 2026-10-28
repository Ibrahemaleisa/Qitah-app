import { decodeVin, isWellFormedVin, modelYearCandidates, vinCheckDigit } from '@/lib/vin';
import { readRepoFile, readRepoJson } from '@/test-support/repo-files';

/**
 * Parity with the API: the app's offline decoder (demo mode / no network) must answer exactly like
 * POST /v1/vin/decode. Both run the same fixture file, and the two sources must stay identical.
 */
const fixtures = readRepoJson<{
  name: string;
  vin: string;
  now: string;
  expect: { valid: boolean; make: string | null; manufacturer: string | null; modelYear: number | null; checkDigit: string | null; confidence: string; reasons: string[] };
}[]>('services/api/test/fixtures/vin-decode.json');

describe('offline VIN decode (parity with the API)', () => {
  it('the app copy of the decoder is byte-identical to the server source', () => {
    expect(readRepoFile('src/lib/vin.ts')).toBe(readRepoFile('services/api/src/lib/vin.ts'));
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const d = decodeVin(f.vin, new Date(f.now));
    expect({ valid: d.valid, make: d.make ?? null, manufacturer: d.manufacturer ?? null, modelYear: d.modelYear ?? null, checkDigit: d.checkDigit ?? null, confidence: d.confidence, reasons: d.reasons }).toEqual(f.expect);
  });

  it('computes the ISO 3779 check digit and the 30-year model-year cycle', () => {
    expect(vinCheckDigit('1HGCM82633A004352')).toBe('3');
    expect(modelYearCandidates('L')).toEqual([1990, 2020, 2050]);
    expect(modelYearCandidates('U')).toEqual([]);
    expect(isWellFormedVin('jtdbr32e4k0123456')).toBe(true);
    expect(isWellFormedVin('JTDBR32E4K012345I')).toBe(false);
  });

  it('never claims a model or engine', () => {
    const d = decodeVin('4T1B11HK8KU123456') as unknown as Record<string, unknown>;
    expect(d.make).toBe('toyota');
    expect(d.model).toBeUndefined();
    expect(d.engine).toBeUndefined();
  });
});
