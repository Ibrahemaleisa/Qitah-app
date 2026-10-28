import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PartArt } from '@/brand/PartArt';
import { useCatalogVersion } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { getCategory } from '@/data/catalog';
import { reviewsForProduct } from '@/data/reviews';
import { cityLabel } from '@/data/sellers';
import { getMake, getModel } from '@/data/vehicles';
import { OriginBadge, SampleBadge } from '@/features/badges';
import { FitPanel } from '@/features/FitPanel';
import { ProductSkeleton } from '@/features/remote/ProductSkeleton';
import { useProduct } from '@/features/remote/useCatalog';
import { ProductSummary } from '@/features/ProductSummary';
import { OfferCard, offerHighlights } from '@/features/OfferCard';
import { RatingSummaryCard, ReviewItem } from '@/features/Reviews';
import { GuaranteeNote, ReturnPolicySummary } from '@/features/trust';
import { bestDeliveredOffer, deliveredPrice, deliveredScores, deliveredTotal } from '@/domain/deliveredPrice';
import { guaranteeState } from '@/domain/guarantee';
import { estimatedTotal, getSeller } from '@/domain/pricing';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { buildListing } from '@/services/catalog';
import { useDeliveryEstimates } from '@/services/remote/deliveryEstimates';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { enterFade } from '@/theme/motion';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { RatingInline } from '@/ui/Rating';
import { Screen, StickyFooter } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';
import { Price } from '@/ui/Price';
import { toast } from '@/ui/Toast';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, tx, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const vehicle = useSelectedVehicle();
  // Remote: fetched on demand when not in the bounded cache (deep link, notification, old favorite).
  const { product, status } = useProduct(id);
  const isFavorite = useAppStore((st) => (product ? st.favorites.includes(product.id) : false));
  const toggleFavorite = useAppStore((st) => st.toggleFavorite);
  const trackView = useAppStore((st) => st.trackView);
  const addToCart = useAppStore((st) => st.addToCart);
  const [specsExpanded, setSpecsExpanded] = useState(false);

  useEffect(() => {
    if (product) trackView(product.id);
  }, [product, trackView]);

  const catalogVersion = useCatalogVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion picks up live price/stock after a refresh
  const listing = useMemo(() => (product ? buildListing(product, vehicle) : undefined), [product, vehicle, catalogVersion]);
  // Remote: delivered price + arrival for the customer's default address city (estimates, "تقديري").
  const { city, estimates } = useDeliveryEstimates(listing?.offers.map((o) => o.id) ?? []);

  if (!product && status === 'loading') return <ProductSkeleton />;
  if (!product || !listing) {
    return (
      <Screen safeTop header={<View style={{ padding: gutter }}><IconButton icon="chevron-left" label={s.common.back} onPress={() => router.back()} /></View>}>
        <EmptyState icon="alert-circle" title={s.errors.notFound} body={s.errors.notFoundHint} action={{ label: s.errors.goHome, onPress: () => router.replace('/') }} />
      </Screen>
    );
  }

  const category = getCategory(product.categoryId);
  const reviews = reviewsForProduct(product.id);
  const hasEstimates = isRemote && listing.offers.some((o) => estimates[o.id]?.cheapest);
  // "Best price" = lowest delivered total once estimates exist, not the lowest item price.
  const totalOf = (o: (typeof listing.offers)[number]) => (hasEstimates ? deliveredTotal(o, estimates) : estimatedTotal(o).total);
  const sortedOffers = [...listing.offers].sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) || totalOf(a) - totalOf(b));
  const highlights = offerHighlights(listing.offers, 'home', city, hasEstimates ? deliveredScores(estimates) : {});
  const best = hasEstimates ? bestDeliveredOffer(listing.offers, estimates) : listing.bestOffer;
  const bestDelivered = best && hasEstimates ? deliveredPrice(best, estimates[best.id]) : null;
  const guarantee = guaranteeState(product, vehicle);
  const guaranteed = guarantee === 'covered';
  const bestInStock = best && best.stock > 0;

  const bestSeller = best ? getSeller(best.sellerId) : undefined;
  const allSpecs = [{ label: { ar: 'رقم القطعة', en: 'Part number' }, value: product.partNumber }, { label: { ar: 'الماركة', en: 'Brand' }, value: product.brand }, ...product.specs];
  const visibleSpecs = specsExpanded ? allSpecs : allSpecs.slice(0, 4);

  const onToggleFavorite = () => {
    toggleFavorite(product.id);
    haptic.impact();
    toast(isFavorite ? s.product.removedFavorite : s.product.savedFavorite, 'heart');
  };

  return (
    <Screen
      padded={false}
      footer={
        <StickyFooter>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="micro" color="textTertiary">
                {bestDelivered ? `${s.trust.deliveredPrice} · ${s.trust.estimated}` : s.product.bestPrice}
              </Text>
              {bestDelivered ? <Price amount={bestDelivered.total} variant="title2" /> : best ? <Price amount={best.price} variant="title2" /> : <Text variant="title2">—</Text>}
              {best && bestSeller ? (
                <Text variant="micro" color="textSecondary" numberOfLines={1}>
                  {s.product.youAreAdding(tx(bestSeller.name), s.condition[best.condition])}
                </Text>
              ) : null}
            </View>
            <Button
              label={bestInStock ? s.product.addToCart : s.product.outOfStock}
              size="md"
              icon={bestInStock ? 'shopping-bag' : undefined}
              disabled={!bestInStock}
              accessibilityHint={best && bestSeller ? s.product.youAreAdding(tx(bestSeller.name), s.condition[best.condition]) : undefined}
              onPress={() => {
                if (!best) return;
                addToCart(best.id);
                haptic.success();
                toast(s.product.added, 'shopping-bag');
              }}
            />
          </View>
        </StickyFooter>
      }
    >
      <Animated.View entering={enterFade}>
        <View style={{ height: 270 + insets.top, paddingTop: insets.top, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <PartArt kind={product.art} size={220} background="transparent" />
        </View>
      </Animated.View>
      <View style={{ position: 'absolute', top: insets.top + space.xs, start: gutter, end: gutter, flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton icon="chevron-left" label={s.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <IconButton icon="share" label={s.product.share} onPress={() => Share.share({ message: `${tx(product.name)} — ${product.partNumber} · ${s.brand.name}` }).catch(() => {})} />
          <IconButton icon="heart" label={isFavorite ? s.product.removedFavorite : s.product.favorite} onPress={onToggleFavorite} filled={isFavorite} iconColor={isFavorite ? 'heading' : undefined} />
        </View>
      </View>

      <View style={{ paddingHorizontal: gutter, marginTop: -space.xxl, backgroundColor: colors.background, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingTop: space.xl }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <OriginBadge origin={product.origin} />
          {category ? <Badge label={tx(category.name)} /> : null}
          {isRemote ? null : <SampleBadge />}
        </View>
        <Text variant="title1" style={{ marginTop: space.sm }}>
          {tx(product.name)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: 2 }}>
          <Text variant="callout" color="textSecondary">
            {product.brand}
          </Text>
          <Text variant="callout" color="textTertiary">
            ·
          </Text>
          <Text variant="callout" color="textSecondary" mono selectable>
            {product.partNumber}
          </Text>
          {product.rating ? <RatingInline average={product.rating.average} count={product.rating.count} /> : null}
        </View>

        <View style={{ marginTop: space.lg }}>
          <ProductSummary offers={listing.offers} estimates={estimates} />
        </View>

        <View style={{ marginTop: space.md }}>
          <FitPanel product={product} vehicle={vehicle} status={listing.fit} />
        </View>
        <View style={{ marginTop: space.sm }}>
          <GuaranteeNote state={guarantee} bySpecification={!!product.universal} />
        </View>

        {best ? (
          <Pressable
            onPress={() => router.push({ pathname: '/mechanic/new', params: { offerId: best.id } })}
            haptics="tap"
            accessibilityLabel={s.mechanic.send}
            accessibilityHint={s.mechanic.sendHint}
            style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
          >
            <Icon name="tool" size={20} color="heading" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{s.mechanic.send}</Text>
              <Text variant="caption" color="textSecondary">
                {s.mechanic.sendHint}
              </Text>
            </View>
            <Icon name="chevron-right" size={18} color="textTertiary" />
          </Pressable>
        ) : null}

        <Section
          title={s.product.offers}
          subtitle={`${s.common.sellers(new Set(listing.offers.map((o) => o.sellerId)).size)} · ${s.common.vatIncluded}`}
          action={listing.offers.length > 2 ? { label: s.common.seeAll, onPress: () => router.push(`/offers/${product.id}`) } : undefined}
        >
          <View style={{ gap: space.md }}>
            {isRemote ? (
              <Text variant="caption" color="textTertiary">
                {city ? s.trust.estimateNote(tx(cityLabel(city))) : s.trust.addAddressForEstimate}
              </Text>
            ) : null}
            {sortedOffers.slice(0, 2).map((o) => (
              <OfferCard key={o.id} offer={o} city={city} highlights={highlights[o.id]} estimate={estimates[o.id]} guaranteed={guaranteed} />
            ))}
            {listing.offers.length > 2 ? <Button label={s.product.compareOffers(listing.offers.length)} variant="secondary" size="md" icon="layers" onPress={() => router.push(`/offers/${product.id}`)} /> : null}
          </View>
        </Section>

        <Section title={s.trust.returnPolicyTitle}>
          <ReturnPolicySummary />
        </Section>

        <Section title={s.product.specs}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
            {visibleSpecs.map((spec, i, arr) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                <Text variant="callout" color="textSecondary">
                  {tx(spec.label)}
                </Text>
                <Text variant="callout" weight="semibold" style={{ flexShrink: 1 }} align="end" ltr={typeof spec.value === 'string'} mono={i === 0}>
                  {typeof spec.value === 'string' ? spec.value : tx(spec.value)}
                </Text>
              </View>
            ))}
          </View>
          {allSpecs.length > 4 ? (
            <Button label={specsExpanded ? s.product.showLessSpecs : s.product.showAllSpecs(allSpecs.length)} variant="ghost" size="sm" icon={specsExpanded ? 'chevron-up' : 'chevron-down'} style={{ alignSelf: 'flex-start', marginTop: space.xs }} onPress={() => setSpecsExpanded((v) => !v)} />
          ) : null}
        </Section>

        <Section title={s.product.description}>
          <Text variant="body" color="textSecondary">
            {tx(product.description)}
          </Text>
          {product.oemReferences.length ? (
            <View style={{ marginTop: space.md, gap: 4 }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.product.oemRefs}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {product.oemReferences.map((r) => (
                  <View key={r} style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: colors.surfaceSunken }}>
                    <Text variant="caption" mono selectable>
                      {r}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </Section>

        {product.fitment.length ? (
          <Section title={s.product.compatibility} subtitle={s.product.fitsVehicles}>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
              {product.fitment.map((f, i) => {
                const model = getModel(f.modelId);
                const make = model ? getMake(model.makeId) : undefined;
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderBottomWidth: i === product.fitment.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="callout" weight="semibold">
                        {make ? tx(make.name) : ''} {model ? tx(model.name) : f.modelId}
                      </Text>
                      <Text variant="caption" color="textSecondary">
                        <Text variant="caption" color="textSecondary" ltr>{`${f.yearFrom}–${f.yearTo}`}</Text> · {f.engines ? f.engines.join(lang === 'ar' ? '، ' : ', ') : s.product.allEngines}
                      </Text>
                    </View>
                    {f.source === 'seller' ? <Badge label={s.product.sellerReportedTag} tone="warning" icon="alert-circle" /> : <Badge label={isRemote ? s.remote.catalogFitment : s.common.sampleData} tone="neutral" />}
                  </View>
                );
              })}
            </View>
          </Section>
        ) : null}

        <Section title={s.seller.reviews}>
          <RatingSummaryCard title={s.product.productRating} hint={s.product.productRatingHint} rating={product.rating} emptyLabel={s.product.noRatings} />
          {reviews.length ? (
            <View style={{ marginTop: space.sm }}>
              {reviews.map((r) => (
                <ReviewItem key={r.id} review={r} />
              ))}
            </View>
          ) : null}
        </Section>
      </View>
    </Screen>
  );
}
