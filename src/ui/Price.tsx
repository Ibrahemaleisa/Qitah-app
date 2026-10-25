import { View } from 'react-native';

import { useI18n } from '@/i18n';
import type { TypeVariant } from '@/theme/tokens';

import { Text, type TextColor } from './Text';

type Props = {
  amount: number;
  variant?: TypeVariant;
  color?: TextColor;
  strike?: boolean;
};

/**
 * Price (guidelines p.13, p.21, p.30): IBM Plex Sans Bold with tabular figures so prices align,
 * followed by a smaller grey currency ("ر.س"). Western digits, two decimals.
 */
export function Price({ amount, variant = 'bodyStrong', color = 'heading', strike }: Props) {
  const { number, s, lang } = useI18n();
  const value = (
    <Text key="v" variant={variant} weight={strike ? 'medium' : 'bold'} color={strike ? 'textTertiary' : color} tabular style={strike ? { textDecorationLine: 'line-through' } : undefined}>
      {number(amount)}
    </Text>
  );
  const currency = (
    <Text key="c" variant="micro" weight="medium" color="textSecondary">
      {s.common.sar}
    </Text>
  );
  return (
    <View accessible accessibilityLabel={`${number(amount)} ${s.common.sar}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
      {lang === 'ar' ? [value, currency] : [currency, value]}
    </View>
  );
}
