/**
 * Qitah design tokens — Brand Guidelines v3.0 (2026).
 *
 * `palette` holds the official brand values (guidelines p.10). A few UI tints that the
 * guidelines don't specify are marked PROPOSED; see docs/brand-integration.md.
 * Everything else in the app consumes the semantic roles in `colors`, `typeScale`, etc.
 */

/** Official palette. Do not import outside `src/theme` and `src/brand`. */
export const palette = {
  // Primary
  qitahBlue: '#022B74',
  qitahOrange: '#FE680E',
  white: '#FFFFFF',
  // Secondary
  blue600: '#0B3A94',
  blue50: '#E8EEF8',
  mist: '#F5F7FA',
  slate: '#566179',
  ink: '#0A1633',
  // Functional (product only)
  success: '#1E7A46',
  warning: '#D97706',
  error: '#C42B2B',
  orangeText: '#C2410C',
  // From charts / ID system (p.18, p.32)
  gray: '#8A94A8',
  teal: '#0F7A78',
  // Photography background (p.24)
  productBackdrop: '#ECEAE6',

  // PROPOSED UI tints (not in the guidelines)
  line: '#E3E8F0',
  lineStrong: '#CBD3E1',
  textTertiary: '#667089',
  successSoft: '#E6F2EB',
  warningSoft: '#FCF0E0',
  warningText: '#A2540A',
  errorSoft: '#FAE8E8',
  orangeSoft: '#FFEFE4',
  tealSoft: '#ECF6F5',
  onBlueSecondary: '#C8D3E8',
  onBlueTertiary: '#94A6CC',
  blueBorder: '#1C4594',
} as const;

export const colors = {
  background: palette.mist,
  surface: palette.white,
  surfaceMuted: palette.mist,
  surfaceSunken: palette.blue50,
  productBackdrop: palette.productBackdrop,

  /** Brand blue surfaces: vehicle bar, headers on blue, primary buttons. */
  inverse: palette.qitahBlue,
  inverseMuted: palette.blue600,
  inverseBorder: palette.blueBorder,

  primary: palette.qitahBlue,
  primaryPressed: palette.blue600,

  text: palette.ink,
  heading: palette.qitahBlue,
  textSecondary: palette.slate,
  textTertiary: palette.textTertiary,
  textInverse: palette.white,
  textInverseSecondary: palette.onBlueSecondary,
  textInverseTertiary: palette.onBlueTertiary,
  textOnAccent: palette.white,
  link: palette.qitahBlue,

  line: palette.line,
  lineStrong: palette.lineStrong,

  /**
   * The orange "piece": the brand signal, used sparingly (~3%): the logo piece, the selected /
   * best offer, the active tab icon. Never for errors, never as text on white (use accentText).
   */
  accent: palette.qitahOrange,
  accentText: palette.orangeText,
  accentSoft: palette.orangeSoft,
  /** Kept for compatibility with older call sites; same as accentText. */
  accentPressed: palette.orangeText,
  accentWash: palette.orangeSoft,

  success: palette.success,
  successSoft: palette.successSoft,
  warning: palette.warningText,
  warningIcon: palette.warning,
  warningSoft: palette.warningSoft,
  danger: palette.error,
  dangerSoft: palette.errorSoft,
  info: palette.blue600,
  infoSoft: palette.blue50,

  /** Part origin / condition roles — distinct so OEM, aftermarket, used and refurbished never blur. */
  oem: palette.qitahBlue,
  oemSoft: palette.blue50,
  aftermarket: palette.blue600,
  aftermarketSoft: palette.blue50,
  used: palette.warningText,
  usedSoft: palette.warningSoft,
  refurbished: palette.teal,
  refurbishedSoft: palette.tealSoft,

  scrim: 'rgba(10,22,51,0.45)',
} as const;

/** 4px spacing scale (guidelines p.23): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

/** Mobile page margin (guidelines p.23: 4 columns, 16px margin, 8px gutter). */
export const gutter = 16;

/** Corner radii (guidelines p.23): 6 badges · 12 elements · 16 cards · full chips. */
export const radius = {
  xs: 6,
  sm: 12,
  md: 12,
  lg: 16,
  xl: 16,
  /** PROPOSED: bottom sheets and the product hero sheet. */
  xxl: 24,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: palette.ink,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  raised: {
    shadowColor: palette.ink,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

/**
 * One family, three tools (p.12): IBM Plex Sans Arabic (Arabic UI), IBM Plex Sans (Latin UI,
 * brands, models, prices with tabular figures), IBM Plex Mono (part numbers and VINs).
 */
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const latinFonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
} as const;

export const monoFonts = {
  regular: 'IBMPlexMono_400Regular',
  medium: 'IBMPlexMono_500Medium',
  semibold: 'IBMPlexMono_500Medium',
  bold: 'IBMPlexMono_500Medium',
} as const;

export type FontWeightName = keyof typeof fonts;

/** Latin runs inside Arabic are set at 90%; part numbers in Mono at 90% (p.13, p.30). */
export const inlineLatinScale = 0.9;

/**
 * Mobile type scale adapted from the guidelines' scale (p.13, designed for print/web):
 * same weights and Arabic line-height ratios (≈1.3 headings, ≈1.7 body); sizes reduced for phones.
 */
export const typeScale = {
  display: { fontSize: 30, lineHeight: 40, weight: 'bold' },
  title1: { fontSize: 24, lineHeight: 32, weight: 'bold' },
  title2: { fontSize: 20, lineHeight: 28, weight: 'semibold' },
  headline: { fontSize: 17, lineHeight: 26, weight: 'semibold' },
  body: { fontSize: 16, lineHeight: 27, weight: 'regular' },
  bodyStrong: { fontSize: 16, lineHeight: 27, weight: 'semibold' },
  callout: { fontSize: 15, lineHeight: 25, weight: 'regular' },
  caption: { fontSize: 13, lineHeight: 21, weight: 'medium' },
  captionStrong: { fontSize: 13, lineHeight: 21, weight: 'semibold' },
  micro: { fontSize: 12, lineHeight: 18, weight: 'semibold' },
} as const satisfies Record<string, { fontSize: number; lineHeight: number; weight: FontWeightName }>;

export type TypeVariant = keyof typeof typeScale;

/** Minimum interactive size (Apple HIG). */
export const touchTarget = 44;

/** Dynamic Type limits so layouts stay usable at the largest accessibility sizes. */
export const maxFontScale = { body: 1.8, title: 1.4 } as const;

/** Motion (p.25): 150–250ms for elements, ≤300ms for sheets; strong ease-out, never ease-in. */
export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
  sheet: 300,
  /** cubic-bezier(0.23, 1, 0.32, 1) */
  bezier: [0.23, 1, 0.32, 1] as const,
  /** Scale animations start at 0.95, never from zero. */
  enterScale: 0.95,
  spring: { damping: 20, stiffness: 260, mass: 0.8 },
} as const;
