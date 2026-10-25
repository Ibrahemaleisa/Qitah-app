import ar from '@/i18n/ar';
import en from '@/i18n/en';

describe('delivery range wording', () => {
  it('never renders a "0–1 days" range', () => {
    expect(ar.common.days(0, 1)).toBe('اليوم أو غداً');
    expect(en.common.days(0, 1)).toBe('Today or tomorrow');
    expect(en.common.days(0, 3)).toBe('1–3 days');
    expect(en.common.deliveryIn(0, 4)).toBe('Arrives in 1–4 days');
  });
});
