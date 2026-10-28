import { Image } from 'expo-image';
import { View } from 'react-native';

import type { PartQuote } from '@/api/partRequests';
import { PieceMark } from '@/brand/Logo';
import { cityLabel } from '@/data/sellers';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Price } from '@/ui/Price';
import { Text } from '@/ui/Text';

import { ConditionBadge, OriginBadge } from './badges';

type Props = {
  quote: PartQuote;
  /** Lowest price among the live quotes (orange piece mark, like the best offer on OfferCard). */
  cheapest?: boolean;
  canAccept: boolean;
  accepting?: boolean;
  onAccept?: () => void;
  now: number;
};

/**
 * One seller's answer to a part request, in the OfferCard look: seller row, facts (condition,
 * origin, warranty, dispatch), the price on its own line, the seller's note and an optional photo
 * of the actual part. Shipping is quoted live at checkout, like every remote offer.
 */
export function QuoteCard({ quote, cheapest, canAccept, accepting, onAccept, now }: Props) {
  const { s, tx, isRTL } = useI18n();
  const chosen = quote.status === 'accepted';
  const hoursLeft = Math.max(0, Math.floor((quote.validUntil - now) / 3_600_000));
  const highlight = chosen || (cheapest && canAccept);
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: highlight ? 1.5 : 1,
        borderColor: highlight ? colors.primary : colors.line,
        padding: space.lg,
        gap: space.md,
        opacity: quote.expired && !chosen ? 0.7 : 1,
      }}
    >
      {highlight ? (
        <View style={[{ position: 'absolute', top: space.lg }, isRTL ? { left: space.lg } : { right: space.lg }]} accessible={false}>
          <PieceMark width={34} />
        </View>
      ) : null}
      {chosen ? (
        <View style={{ flexDirection: 'row' }}>
          <Badge label={s.partRequest.chosen} tone="success" icon="check-circle" />
        </View>
      ) : cheapest && canAccept ? (
        <View style={{ flexDirection: 'row' }}>
          <Badge label={s.product.cheapest} tone="accent" icon="tag" />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="bodyStrong">{tx(quote.sellerName).slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="callout" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {tx(quote.sellerName)}
            </Text>
            {quote.verifiedSeller ? <Icon name="check-circle" size={13} color="success" /> : null}
          </View>
          {quote.sellerCity ? (
            <Text variant="caption" color="textTertiary">
              {tx(cityLabel(quote.sellerCity))}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong">{tx(quote.partName)}</Text>
        {quote.brand || quote.partNumber ? (
          <Text variant="caption" color="textSecondary" ltr>
            {[quote.brand, quote.partNumber].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {quote.productId ? (
          <Text variant="caption" color="textTertiary">
            {s.partRequest.catalogPart}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <ConditionBadge condition={quote.condition} />
        {quote.origin ? <OriginBadge origin={quote.origin} short /> : null}
        <Fact icon="shield" text={s.product.warrantyMonths(quote.warrantyMonths)} />
        <Fact icon="package" text={s.product.dispatchDays(quote.dispatchDays[0], quote.dispatchDays[1])} />
        {quote.originCity ? <Fact icon="map-pin" text={s.remote.shipsFrom(tx(cityLabel(quote.originCity)))} /> : null}
        {quote.quantity > 1 ? <Fact icon="layers" text={s.partRequest.quantityShort(quote.quantity)} /> : null}
      </View>

      <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: 6 }}>
        <Line label={s.product.partPrice}>
          <Price amount={quote.price} variant="headline" />
        </Line>
        <Line label={s.product.deliveryFee}>
          <Text variant="callout" weight="semibold" color="textSecondary">
            {s.remote.shippingAtCheckout}
          </Text>
        </Line>
      </View>

      {quote.note ? (
        <Text variant="caption" color="textSecondary">
          {s.partRequest.sellerNote}: {quote.note}
        </Text>
      ) : null}

      {quote.photoUrl ? (
        <View style={{ gap: 4 }}>
          <Text variant="captionStrong" color="textSecondary">
            {s.partRequest.partPhoto}
          </Text>
          <Image source={{ uri: quote.photoUrl }} style={{ width: 120, height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }} contentFit="cover" accessibilityLabel={s.partRequest.partPhoto} />
        </View>
      ) : null}

      {!chosen ? (
        <Text variant="caption" color={quote.expired ? 'danger' : 'textTertiary'}>
          {quote.expired ? s.partRequest.expiredQuote : s.partRequest.expiresIn(hoursLeft)}
        </Text>
      ) : null}

      {canAccept && onAccept ? (
        <Button label={s.partRequest.accept} icon="check" variant={cheapest ? 'primary' : 'secondary'} size="md" loading={accepting} accessibilityHint={s.partRequest.acceptHint} onPress={onAccept} />
      ) : null}
    </View>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
      {children}
    </View>
  );
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={13} color="textSecondary" />
      <Text variant="caption" color="textSecondary">
        {text}
      </Text>
    </View>
  );
}
