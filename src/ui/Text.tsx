import { Text as RNText, useWindowDimensions, type TextProps, type TextStyle } from 'react-native';

import { useI18n } from '@/i18n';
import { colors, fonts, inlineLatinScale, latinFonts, maxFontScale, monoFonts, typeScale, type FontWeightName, type TypeVariant } from '@/theme/tokens';

export type TextColor = keyof typeof colors;

type Props = TextProps & {
  variant?: TypeVariant;
  weight?: FontWeightName;
  color?: TextColor;
  align?: 'start' | 'center' | 'end';
  /** Left-to-right run (numbers, brands, models): IBM Plex Sans, 90% inside Arabic text. */
  ltr?: boolean;
  /** Part numbers and VINs: IBM Plex Mono at 90% (guidelines p.13). Implies `ltr`. */
  mono?: boolean;
  /** Prices: IBM Plex Sans with tabular figures so amounts align (p.13). Implies `ltr`. */
  tabular?: boolean;
};

/** Font family for a weight in the active script: Arabic UI uses Plex Sans Arabic, English Plex Sans. */
export function fontFamilyFor(weight: FontWeightName, lang: 'ar' | 'en', kind: 'text' | 'latin' | 'mono' = 'text') {
  if (kind === 'mono') return monoFonts[weight];
  if (kind === 'latin' || lang === 'en') return latinFonts[weight];
  return fonts[weight];
}

/**
 * All app text goes through this component so typography, colour and
 * text direction stay consistent in both Arabic (RTL) and English (LTR).
 */
export function Text({ variant = 'body', weight, color, align = 'start', ltr: ltrProp, mono, tabular, style, children, ...rest }: Props) {
  const { isRTL, lang } = useI18n();
  const ltr = ltrProp || mono || tabular;
  const { fontScale } = useWindowDimensions();
  const scale = typeScale[variant];
  const isTitle = variant === 'display' || variant === 'title1' || variant === 'title2';
  // Dynamic Type: grow the line height with the font so scaled text never clips or overlaps.
  const maxScale = isTitle ? maxFontScale.title : maxFontScale.body;
  const lineHeight = Math.round(scale.lineHeight * Math.min(Math.max(fontScale, 1), maxScale));
  // Latin and mono runs inside Arabic text are set at 90% so they sit visually level with Arabic.
  const kind = mono ? 'mono' : ltr ? 'latin' : 'text';
  const inlineScale = kind !== 'text' && lang === 'ar' ? inlineLatinScale : mono ? inlineLatinScale : 1;
  // Headings default to Qitah Blue, body text to Ink.
  const resolvedColor: TextColor = color ?? (variant === 'display' || variant === 'title1' || variant === 'title2' ? 'heading' : 'text');
  const textAlign: TextStyle['textAlign'] =
    align === 'center' ? 'center' : (align === 'start') === isRTL ? 'right' : 'left';
  // Isolate LTR runs (part numbers, phone numbers, prices) so the bidi algorithm can't reorder them.
  const content = ltr && isRTL && (typeof children === 'string' || typeof children === 'number') ? `\u2066${children}\u2069` : children;
  return (
    <RNText
      accessibilityRole={variant === 'display' || variant === 'title1' ? 'header' : undefined}
      maxFontSizeMultiplier={maxScale}
      {...rest}
      style={[
        {
          fontFamily: fontFamilyFor(weight ?? scale.weight, lang, kind),
          fontSize: Math.round(scale.fontSize * inlineScale * 10) / 10,
          lineHeight,
          color: colors[resolvedColor],
          fontVariant: tabular ? ['tabular-nums'] : undefined,
          textAlign,
          writingDirection: ltr ? 'ltr' : isRTL ? 'rtl' : 'ltr',
        },
        style,
      ]}
    >
      {content}
    </RNText>
  );
}
