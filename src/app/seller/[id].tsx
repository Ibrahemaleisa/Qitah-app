import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useCatalogVersion } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { allProducts } from '@/data/catalog';
import { allOffers } from '@/data/offers';
import { reviewsForSeller } from '@/data/reviews';
import { cityLabel } from '@/data/sellers';
import { ProductRow } from '@/features/ProductCard';
import { RatingSummaryCard, ReviewItem } from '@/features/Reviews';
import { getSeller } from '@/domain/pricing';
import { useI18n } from '@/i18n';
import { buildListing } from '@/services/catalog';
import { useSelectedVehicle } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, type IconName } from '@/ui/Icon';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';

export default function SellerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, tx } = useI18n();
  const vehicle = useSelectedVehicle();
  const catalogVersion = useCatalogVersion();
  const seller = getSeller(id ?? '');
  const listings = useMemo(() => {
    const ids = new Set(allOffers().filter((o) => o.sellerId === id).map((o) => o.productId));
    return allProducts().filter((p) => ids.has(p.id)).map((p) => buildListing(p, vehicle));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion re-runs this after a catalog refresh
  }, [id, vehicle, catalogVersion]);

  if (!seller) {
    return (
      <Screen header={<ScreenHeader back />}>
        <EmptyState icon="alert-circle" title={s.errors.notFound} />
      </Screen>
    );
  }
  const reviews = reviewsForSeller(seller.id);

  return (
    <Screen header={<ScreenHeader back />}>
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
        <View style={{ width: 76, height: 76, borderRadius: radius.xl, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="title1" color="textInverse">
            {tx(seller.name).slice(0, 1)}
          </Text>
        </View>
        <Text variant="title1" align="center">
          {tx(seller.name)}
        </Text>
        <Text variant="callout" color="textSecondary" align="center">
          {tx(seller.specialty)} · {tx(cityLabel(seller.city))}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Badge label={seller.verifiedBusiness ? s.seller.verified : s.seller.unverified} tone={seller.verifiedBusiness ? 'success' : 'neutral'} icon={seller.verifiedBusiness ? 'check-circle' : 'clock'} />
          {isRemote ? null : <Badge label={s.common.sampleData} tone="info" icon="flag" />}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>
        <Stat icon="clock" label={s.seller.onTime} value={seller.onTimeRate !== null ? `${Math.round(seller.onTimeRate * 100)}%` : '—'} />
        <Stat icon="message-circle" label={s.seller.responds(seller.responseHours)} value={`${seller.responseHours}h`} />
        <Stat icon="package" label={s.seller.orders} value={seller.fulfilledOrders.toLocaleString('en-US')} />
        <Stat icon="calendar" label={s.seller.since(seller.joinedYear)} value={String(seller.joinedYear)} />
      </View>
      {seller.freeShippingOver ? (
        <View style={{ marginTop: space.md }}>
          <Badge label={s.seller.freeOver(seller.freeShippingOver)} tone="success" icon="truck" />
        </View>
      ) : null}

      <Button label={s.seller.contact} variant="secondary" icon="message-circle" size="md" style={{ marginTop: space.lg }} onPress={() => router.push({ pathname: '/seller-contact', params: { sellerId: seller.id } })} />

      <View style={{ marginTop: space.xl }}>
        <RatingSummaryCard title={s.seller.serviceRating} hint={s.seller.serviceRatingHint} rating={seller.rating} emptyLabel={isRemote ? s.remote.noRatingsYet : s.seller.newSeller} />
        {reviews.map((r) => (
          <ReviewItem key={r.id} review={r} />
        ))}
      </View>

      <Section title={s.seller.products} subtitle={s.common.items(listings.length)}>
        <View style={{ gap: space.md }}>
          {listings.map((l) => (
            <ProductRow key={l.product.id} listing={l} />
          ))}
        </View>
      </Section>
    </Screen>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ width: '48.5%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.md, gap: 4 }}>
      <Icon name={icon} size={16} color="heading" />
      <Text variant="headline" ltr>
        {value}
      </Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
