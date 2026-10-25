import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { PartArt } from '@/brand/PartArt';
import { getProduct } from '@/data/catalog';
import { offersForProduct } from '@/data/offers';
import { OriginBadge } from '@/features/badges';
import { OfferCard, offerHighlights } from '@/features/OfferCard';
import { deliveryWindow, estimatedTotal, fastestDelivery, getSeller } from '@/domain/pricing';
import type { Condition, DeliveryDestination, Offer } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { HScroll } from '@/ui/HList';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';

type SortKey = 'total' | 'rating' | 'delivery';

export default function OffersScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { s, tx } = useI18n();
  const product = getProduct(productId ?? '');
  const city = useAppStore((st) => st.addresses[0]?.city);
  const [destination, setDestination] = useState<DeliveryDestination>('home');
  const [sort, setSort] = useState<SortKey>('total');
  const [condition, setCondition] = useState<Condition | 'all'>('all');

  const all = useMemo(() => offersForProduct(productId ?? ''), [productId]);
  const conditions = [...new Set(all.map((o) => o.condition))];

  const offers = useMemo(() => {
    const filtered = all.filter((o) => condition === 'all' || o.condition === condition);
    const speed = (o: Offer) => {
      const f = fastestDelivery(o, destination, city);
      return f ? deliveryWindow(o, f)[1] : 99;
    };
    const key = (o: Offer) =>
      sort === 'total' ? estimatedTotal(o, destination, city).total : sort === 'rating' ? -(getSeller(o.sellerId)?.rating?.average ?? 0) : speed(o);
    return filtered.sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) || key(a) - key(b));
  }, [all, condition, sort, destination, city]);

  const highlights = useMemo(() => offerHighlights(offers, destination, city), [offers, destination, city]);

  if (!product) {
    return (
      <Screen header={<ScreenHeader back title={s.offers.title} />}>
        <EmptyState icon="alert-circle" title={s.errors.notFound} />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader back title={s.offers.title} subtitle={s.common.offers(all.length)} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
        <PartArt kind={product.art} size={60} rounded={radius.sm} />
        <View style={{ flex: 1, gap: 2 }}>
          <OriginBadge origin={product.origin} short />
          <Text variant="callout" weight="semibold" numberOfLines={2}>
            {tx(product.name)}
          </Text>
          <Text variant="caption" color="textTertiary" ltr>
            {product.partNumber}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: space.lg, gap: space.md }}>
        <Segmented
          value={destination}
          onChange={setDestination}
          options={[
            { value: 'home', label: s.checkout.home, icon: 'home' },
            { value: 'workshop', label: s.checkout.workshop, icon: 'tool' },
          ]}
        />
        <View style={{ gap: space.xs }}>
          <Text variant="captionStrong" color="textSecondary">
            {s.offers.sortBy}
          </Text>
          <HScroll gap={space.sm}>
            {(['total', 'rating', 'delivery'] as SortKey[]).map((k) => (
              <Chip key={k} label={s.offers.sort[k]} selected={sort === k} onPress={() => setSort(k)} />
            ))}
          </HScroll>
        </View>
        {conditions.length > 1 ? (
          <View style={{ gap: space.xs }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.offers.conditionFilter}
            </Text>
            <HScroll gap={space.sm}>
              <Chip label={s.offers.all} selected={condition === 'all'} onPress={() => setCondition('all')} />
              {conditions.map((c) => (
                <Chip key={c} label={s.condition[c]} selected={condition === c} onPress={() => setCondition(c)} />
              ))}
            </HScroll>
          </View>
        ) : null}
        <Text variant="caption" color="textTertiary">
          {s.product.estTotalHint} · {s.common.vatIncluded}
        </Text>
      </View>

      <View style={{ marginTop: space.lg, gap: space.md }}>
        {offers.map((o, i) => (
          <Animated.View key={o.id} entering={FadeInDown.delay(i * 40).duration(260)} layout={LinearTransition.springify().damping(18)}>
            <OfferCard offer={o} destination={destination} city={city} highlights={highlights[o.id]} />
          </Animated.View>
        ))}
      </View>
      <View style={{ marginTop: space.lg }}>
        <Notice tone="sample" text={s.home.sampleBanner} />
      </View>
    </Screen>
  );
}
