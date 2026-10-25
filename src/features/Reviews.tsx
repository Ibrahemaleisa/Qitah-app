import { View } from 'react-native';

import type { RatingSummary, Review } from '@/domain/types';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/Icon';
import { RatingBars, Stars } from '@/ui/Rating';
import { Text } from '@/ui/Text';

export function RatingSummaryCard({ title, hint, rating, emptyLabel }: { title: string; hint: string; rating: RatingSummary | null; emptyLabel: string }) {
  const { s } = useI18n();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.md }}>
      <View>
        <Text variant="headline">{title}</Text>
        <Text variant="caption" color="textSecondary">
          {hint}
        </Text>
      </View>
      {rating ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="display" ltr>
              {rating.average.toFixed(1)}
            </Text>
            <Stars value={rating.average} size={12} />
            <Text variant="micro" color="textTertiary">
              {s.common.reviews(rating.count)}
            </Text>
          </View>
          <RatingBars distribution={rating.distribution} count={rating.count} />
        </View>
      ) : (
        <Text variant="callout" color="textTertiary">
          {emptyLabel}
        </Text>
      )}
      {rating ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="check-square" size={13} color="success" />
          <Text variant="caption" color="textSecondary">
            {s.product.verifiedShare(Math.round(rating.verifiedShare * 100))}
          </Text>
          <Badge label={s.common.sampleData} tone="info" />
        </View>
      ) : null}
    </View>
  );
}

export function ReviewItem({ review }: { review: Review }) {
  const { s, tx } = useI18n();
  return (
    <View style={{ paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.line, gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stars value={review.rating} size={12} />
        <Text variant="micro" color="textTertiary">
          {s.product.sampleReview}
        </Text>
      </View>
      <Text variant="callout">{tx(review.body)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="caption" color="textSecondary" ltr={/^[A-Za-z]/.test(review.author)}>
          {review.author}
        </Text>
        {review.verifiedPurchase ? <Badge label={s.product.verifiedPurchase} tone="success" icon="check" /> : null}
      </View>
    </View>
  );
}
