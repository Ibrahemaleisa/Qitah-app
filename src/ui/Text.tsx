import { Text as RNText, useWindowDimensions, type TextProps, type TextStyle } from 'react-native';

import { useI18n } from '@/i18n';
import { colors, fonts, maxFontScale, typeScale, type FontWeightName, type TypeVariant } from '@/theme/tokens';

export type TextColor = keyof typeof colors;

type Props = TextProps & {
  variant?: TypeVariant;
  weight?: FontWeightName;
  color?: TextColor;
  align?: 'start' | 'center' | 'end';
  /** Render numbers/part numbers left-to-right even inside Arabic layouts. */
  ltr?: boolean;
};

/**
 * All app text goes through this component so typography, colour and
 * text direction stay consistent in both Arabic (RTL) and English (LTR).
 */
export function Text({ variant = 'body', weight, color = 'text', align = 'start', ltr, style, children, ...rest }: Props) {
  const { isRTL } = useI18n();
  const { fontScale } = useWindowDimensions();
  const scale = typeScale[variant];
  const isTitle = variant === 'display' || variant === 'title1' || variant === 'title2';
  // Dynamic Type: grow the line height with the font so scaled text never clips or overlaps.
  const maxScale = isTitle ? maxFontScale.title : maxFontScale.body;
  const lineHeight = Math.round(scale.lineHeight * Math.min(Math.max(fontScale, 1), maxScale));
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
          fontFamily: fonts[weight ?? scale.weight],
          fontSize: scale.fontSize,
          lineHeight,
          color: colors[color],
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
