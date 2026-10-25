import { View } from 'react-native';

import { colors, space } from '@/theme/tokens';

import { Star } from './Star';
import { Text } from './Text';

/** Compact rating: star, average and optional count, e.g. ★ 4.8 (312). */
export function RatingInline({ average, count, size = 'sm' }: { average: number; count?: number; size?: 'sm' | 'md' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Star size={size === 'sm' ? 12 : 15} color={colors.accent} />
      <Text variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'} ltr>
        {average.toFixed(1)}
      </Text>
      {count !== undefined ? (
        <Text variant="caption" color="textTertiary" ltr>
          ({count.toLocaleString('en-US')})
        </Text>
      ) : null}
    </View>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} color={i <= Math.round(value) ? colors.accent : colors.lineStrong} />
      ))}
    </View>
  );
}

/** Horizontal distribution bars for a rating summary. */
export function RatingBars({ distribution, count }: { distribution: number[]; count: number }) {
  return (
    <View style={{ gap: 4, flex: 1 }}>
      {distribution.map((n, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="micro" color="textTertiary" style={{ width: 10 }} align="center">
            {5 - i}
          </Text>
          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
            <View style={{ width: `${count ? (n / count) * 100 : 0}%`, height: '100%', backgroundColor: colors.text, borderRadius: 3 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
