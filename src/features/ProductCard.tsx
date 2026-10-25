import { router } from 'expo-router';
import { View } from 'react-native';

import { PartArt } from '@/brand/PartArt';
import { useI18n } from '@/i18n';
import type { ProductListing } from '@/services/catalog';
import { colors, radius, space } from '@/theme/tokens';
import { Pressable } from '@/ui/Pressable';
import { RatingInline } from '@/ui/Rating';
import { Text } from '@/ui/Text';
import { Price } from '@/ui/Price';

import { FitBadge, OriginBadge } from './badges';

/** One sentence a screen reader can announce for a listing: what, origin, fit, price, offers. */
function useListingLabel(listing: ProductListing): string {
  const { tx, money, s } = useI18n();
  const { product, bestOffer, offerCount, fit } = listing;
  return [
    tx(product.name),
    product.brand,
    s.origin[product.origin],
    fit !== 'noVehicle' ? s.fit[fit] : null,
    bestOffer ? `${s.common.from} ${money(bestOffer.price)}` : null,
    offerCount > 0 ? s.common.offers(offerCount) : s.product.outOfStock,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Vertical card for horizontal carousels on Home. */
export function ProductCard({ listing, width = 168 }: { listing: ProductListing; width?: number }) {
  const { tx, s } = useI18n();
  const { product, bestOffer, offerCount, fit } = listing;
  const a11yLabel = useListingLabel(listing);
  return (
    <Pressable
      onPress={() => router.push(`/product/${product.id}`)}
      pressScale={0.97}
      accessibilityLabel={a11yLabel}
      style={{ width, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}
    >
      <PartArt kind={product.art} size={width} rounded={0} />
      <View style={{ position: 'absolute', top: space.sm, start: space.sm }}>
        <OriginBadge origin={product.origin} short />
      </View>
      <View style={{ padding: space.md, gap: 4 }}>
        <Text variant="callout" weight="semibold" numberOfLines={2} style={{ minHeight: 44 }}>
          {tx(product.name)}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {product.brand}
        </Text>
        {fit !== 'noVehicle' && fit !== 'bySpecification' ? <FitBadge status={fit} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          {bestOffer ? <Price amount={bestOffer.price} /> : null}
          {product.rating ? <RatingInline average={product.rating.average} /> : null}
        </View>
        <Text variant="micro" color="textSecondary">
          {s.common.offers(offerCount)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Horizontal row used in search results and lists. */
export function ProductRow({ listing }: { listing: ProductListing }) {
  const { tx, s } = useI18n();
  const { product, bestOffer, offerCount, fit, conditions, matchedPartNumber } = listing;
  const a11yLabel = useListingLabel(listing);
  return (
    <Pressable
      onPress={() => router.push(`/product/${product.id}`)}
      pressScale={0.985}
      accessibilityLabel={a11yLabel}
      style={{ flexDirection: 'row', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.md }}
    >
      <PartArt kind={product.art} size={96} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          <OriginBadge origin={product.origin} short />
          {conditions.filter((c) => c !== 'new').map((c) => (
            <View key={c} style={{ paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: c === 'used' ? colors.usedSoft : colors.refurbishedSoft }}>
              <Text variant="micro" color={c === 'used' ? 'used' : 'refurbished'}>
                {s.condition[c]}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="callout" weight="semibold" numberOfLines={2}>
          {tx(product.name)}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {product.brand} · <Text variant="caption" color={matchedPartNumber ? 'link' : 'textTertiary'} mono>{product.partNumber}</Text>
        </Text>
        {fit !== 'noVehicle' ? <FitBadge status={fit} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            {offerCount > 1 ? (
              <Text variant="micro" color="textSecondary">
                {s.common.from}
              </Text>
            ) : null}
            {bestOffer ? <Price amount={bestOffer.price} /> : null}
          </View>
          <Text variant="micro" color="textSecondary">
            {offerCount > 0 ? s.common.offers(offerCount) : s.product.outOfStock}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
