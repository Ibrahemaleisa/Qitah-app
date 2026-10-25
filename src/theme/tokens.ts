/**
 * Qitah design tokens.
 *
 * PROVISIONAL IDENTITY — the brand is being redesigned. Only `palette` and `fonts` hold
 * brand-specific values; everything else in the app consumes the semantic roles below
 * (`colors`, `typeScale`, …). Rebranding means editing those two objects (plus the assets in
 * `src/brand`), not touching screens. See docs/brand-integration.md.
 */

/** Raw provisional brand palette. Do not import outside `src/theme` and `src/brand`. */
export const palette = {
  ink900: '#121316',
  ink800: '#1C1E22',
  ink700: '#2A2D33',
  ink500: '#5E5A54',
  ink400: '#8A857C',
  ink300: '#B4AEA4',
  paper50: '#FBF9F6',
  paper100: '#F5F2ED',
  paper200: '#ECE7DF',
  paper300: '#DFD8CD',
  white: '#FFFFFF',
  orange500: '#FF5A1F',
  orange600: '#E8470D',
  orange100: '#FFE9DF',
  orange50: '#FFF4EE',
  green600: '#13875A',
  green50: '#E6F5EE',
  amber600: '#B7791F',
  amber50: '#FBF1DF',
  red600: '#CC3326',
  red50: '#FCE9E7',
  blue600: '#2A62D9',
  blue50: '#E8EFFC',
  violet600: '#6B4FD8',
  violet50: '#EFEBFC',
} as const;

export const colors = {
  background: palette.paper100,
  surface: palette.white,
  surfaceMuted: palette.paper50,
  surfaceSunken: palette.paper200,
  inverse: palette.ink900,
  inverseMuted: palette.ink800,
  inverseBorder: palette.ink700,

  text: palette.ink900,
  textSecondary: palette.ink500,
  textTertiary: palette.ink400,
  textInverse: palette.paper50,
  textInverseSecondary: palette.ink300,
  textInverseTertiary: palette.ink400,
  textOnAccent: palette.white,

  line: palette.paper200,
  lineStrong: palette.paper300,

  accent: palette.orange500,
  accentPressed: palette.orange600,
  accentSoft: palette.orange100,
  accentWash: palette.orange50,

  success: palette.green600,
  successSoft: palette.green50,
  warning: palette.amber600,
  warningSoft: palette.amber50,
  danger: palette.red600,
  dangerSoft: palette.red50,
  info: palette.blue600,
  infoSoft: palette.blue50,

  /** Part origin colours: kept distinct so OEM / aftermarket / used never blur together. */
  oem: palette.ink900,
  oemSoft: palette.paper200,
  aftermarket: palette.blue600,
  aftermarketSoft: palette.blue50,
  used: palette.amber600,
  usedSoft: palette.amber50,
  refurbished: palette.violet600,
  refurbishedSoft: palette.violet50,

  scrim: 'rgba(18,19,22,0.45)',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Horizontal page gutter used by every screen. */
export const gutter = space.xl;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: '#2A1A0E',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#2A1A0E',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export type FontWeightName = keyof typeof fonts;

/** Arabic glyphs need generous line heights; these are tuned for IBM Plex Sans Arabic. */
export const typeScale = {
  display: { fontSize: 30, lineHeight: 42, weight: 'bold' },
  title1: { fontSize: 24, lineHeight: 34, weight: 'bold' },
  title2: { fontSize: 20, lineHeight: 30, weight: 'semibold' },
  headline: { fontSize: 17, lineHeight: 26, weight: 'semibold' },
  body: { fontSize: 15, lineHeight: 24, weight: 'regular' },
  bodyStrong: { fontSize: 15, lineHeight: 24, weight: 'semibold' },
  callout: { fontSize: 14, lineHeight: 22, weight: 'regular' },
  caption: { fontSize: 12, lineHeight: 18, weight: 'regular' },
  captionStrong: { fontSize: 12, lineHeight: 18, weight: 'semibold' },
  micro: { fontSize: 11, lineHeight: 16, weight: 'medium' },
} as const satisfies Record<string, { fontSize: number; lineHeight: number; weight: FontWeightName }>;

export type TypeVariant = keyof typeof typeScale;

/** Minimum interactive size (Apple HIG). */
export const touchTarget = 44;

/**
 * Dynamic Type limits: body text may grow substantially, large titles less so, so layouts
 * remain usable at the largest accessibility sizes.
 */
export const maxFontScale = { body: 1.8, title: 1.4 } as const;

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
  spring: { damping: 18, stiffness: 220, mass: 0.8 },
} as const;
