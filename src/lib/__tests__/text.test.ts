import { looksLikePartNumber, normalizePartNumber, normalizeText, withinOneEdit } from '@/lib/text';

describe('text helpers', () => {
  it('normalises Arabic letter variants, diacritics and bidi isolates', () => {
    expect(normalizeText('أَحْمَد')).toBe('احمد');
    expect(normalizeText('بطارية')).toBe(normalizeText('بطاريه'));
    expect(normalizeText('⁦5W-30⁩')).toBe('5w-30');
  });

  it('compares part numbers without separators', () => {
    expect(normalizePartNumber('04465-X3301')).toBe(normalizePartNumber('04465 x3301'));
    expect(looksLikePartNumber('04465x3301')).toBe(true);
    expect(looksLikePartNumber('brake pads')).toBe(false);
  });

  it('detects single edits', () => {
    expect(withinOneEdit('battery', 'batery')).toBe(true);
    expect(withinOneEdit('battery', 'battrey')).toBe(true); // adjacent swap
    expect(withinOneEdit('battery', 'baterry')).toBe(false); // two edits
    expect(withinOneEdit('filter', 'filtar')).toBe(true);
  });
});

