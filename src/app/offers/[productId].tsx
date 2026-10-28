import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PartArt } from '@/brand/PartArt';
import { useCatalogVersion } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { getProduct } from '@/data/catalog';
import { offersForProduct } from '@/data/offers';
import { OriginBadge } from '@/features/badges';
import { OfferCard, offerHighlights } from '@/features/OfferCard';
import { cityLabel } from '@/data/sellers';
import { arrivalDays, arrivesToday, deliveredScores, deliveredTotal } from '@/domain/deliveredPrice';
import { guaranteeState } from '@/domain/guarantee';
import { deliveryWindow, estimatedTotal, fastestDelivery, getSeller } from '@/domain/pricing';
import type { Condition, DeliveryDestination, Offer } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useDeliveryEstimates } from '@/services/remote/deliveryEstimates';
import { useSelectedVehicle } from '@/store/app-store';
import { enterUp, layoutMove } from '@/theme/motion';
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
  const vehicle = useSelectedVehicle();
  const [destination, setDestination] = useState<DeliveryDestination>('home');
  const [sort, setSort] = useState<SortKey>('total');
  const [condition, setCondition] = useState<Condition | 'all'>('all');
  const [todayOnly, setTodayOnly] = useState(false);

  const catalogVersion = useCatalogVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion picks up live price/stock after a refresh
  const all = useMemo(() => offersForProduct(productId ?? ''), [productId, catalogVersion]);
  const conditions = [...new Set(all.map((o) => o.condition))];
  // Remote: server estimates for the default address city. Delivered price only applies to home delivery.
  const { city, estimates } = useDeliveryEstimates(all.map((o) => o.id));
  const useDelivered = isRemote && destination === 'home' && all.some((o) => estimates[o.id]?.cheapest);
  const anySameDay = useDelivered && all.some((o) => o.stock > 0 && arrivesToday(estimates[o.id]));

  const offers = useMemo(() => {
    const filtered = all.filter((o) => (condition === 'all' || o.condition === condition) && (!todayOnly || !useDelivered || arrivesToday(estimates[o.id])));
    const speed = (o: Offer) => {
      if (useDelivered) return arrivalDays(o, estimates);
      const f = fastestDelivery(o, destination, city);
      return f ? deliveryWindow(o, f)[1] : 99;
    };
    // "Best price" = lowest delivered total (item + estimated delivery) whenever estimates exist.
    const total = (o: Offer) => (useDelivered ? deliveredTotal(o, estimates) : estimatedTotal(o, destination, city).total);
    const key = (o: Offer) => (sort === 'total' ? total(o) : sort === 'rating' ? -(getSeller(o.sellerId)?.rating?.average ?? 0) : speed(o));
    return filtered.sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) || key(a) - key(b) || total(a) - total(b));
  }, [all, condition, sort, destination, city, todayOnly, useDelivered, estimates]);

  const highlights = useMemo(() => offerHighlights(offers, destination, city, useDelivered ? deliveredScores(estimates) : {}), [offers, destination, city, useDelivered, estimates]);
  const guaranteed = product ? guaranteeState(product, vehicle) === 'covered' : false;

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
          <Text variant="caption" color="textSecondary" mono>
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
            {/* Remote mode has no seller ratings yet, so sorting by rating would be meaningless. */}
            {((isRemote ? ['total', 'delivery'] : ['total', 'rating', 'delivery']) as SortKey[]).map((k) => (
              <Chip key={k} label={isRemote && k === 'total' ? (useDelivered ? s.trust.sortDelivered : s.product.partPrice) : s.offers.sort[k]} selected={sort === k} onPress={() => setSort(k)} />
            ))}
            {useDelivered ? <Chip label={s.trust.sameDayFilter} selected={todayOnly} onPress={() => setTodayOnly((v) => !v)} /> : null}
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
          {isRemote ? (useDelivered && city ? s.trust.estimateNote(tx(cityLabel(city))) : city ? s.remote.liveCatalogNote : s.trust.addAddressForEstimate) : `${s.product.estTotalHint} · ${s.common.vatIncluded}`}
        </Text>
        {todayOnly && useDelivered && !anySameDay ? <Notice tone="info" icon="clock" text={s.trust.noSameDay} /> : null}
      </View>

      <View style={{ marginTop: space.lg, gap: space.md }}>
        {offers.map((o, i) => (
          <Animated.View key={o.id} entering={enterUp(i)} layout={layoutMove}>
            <OfferCard offer={o} destination={destination} city={city} highlights={highlights[o.id]} estimate={estimates[o.id]} guaranteed={guaranteed} />
          </Animated.View>
        ))}
      </View>
      <View style={{ marginTop: space.lg }}>
        {isRemote ? null : <Notice tone="sample" text={s.home.sampleBanner} />}
      </View>
    </Screen>
  );
}
