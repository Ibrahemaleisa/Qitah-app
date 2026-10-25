import { colors } from '@/theme/tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text/background pairs the UI actually uses must meet WCAG AA (4.5:1) — guidelines p.11, p.34. */
const pairs: [string, string, string][] = [
  ['text on surface', colors.text, colors.surface],
  ['heading on background', colors.heading, colors.background],
  ['secondary on background', colors.textSecondary, colors.background],
  ['tertiary on background', colors.textTertiary, colors.background],
  ['white on primary', colors.textInverse, colors.primary],
  ['inverse secondary on blue', colors.textInverseSecondary, colors.inverse],
  ['inverse tertiary on blue', colors.textInverseTertiary, colors.inverse],
  ['accent text on surface', colors.accentText, colors.surface],
  ['accent text on accent soft', colors.accentText, colors.accentSoft],
  ['info on info soft', colors.info, colors.infoSoft],
  ['success on success soft', colors.success, colors.successSoft],
  ['warning on warning soft', colors.warning, colors.warningSoft],
  ['danger on danger soft', colors.danger, colors.dangerSoft],
  ['used on used soft', colors.used, colors.usedSoft],
  ['refurbished on refurbished soft', colors.refurbished, colors.refurbishedSoft],
];

describe('brand colour contrast', () => {
  it.each(pairs)('%s ≥ 4.5:1', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('never uses orange as text on white', () => {
    expect(contrast(colors.accent, colors.surface)).toBeLessThan(4.5);
    expect(colors.accentText).not.toBe(colors.accent);
  });
});
