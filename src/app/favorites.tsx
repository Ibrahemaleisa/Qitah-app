import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useCatalogVersion } from '@/catalog/remote-catalog';
import { ProductRow } from '@/features/ProductCard';
import { useProducts } from '@/features/remote/useCatalog';
import { useI18n } from '@/i18n';
import { listingsByIds } from '@/services/catalog';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { radius, space } from '@/theme/tokens';
import { EmptyState } from '@/ui/EmptyState';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';

export default function Favorites() {
  const { s } = useI18n();
  const ids = useAppStore((st) => st.favorites);
  const vehicle = useSelectedVehicle();
  // Remote: favorites may not be in the bounded cache: fetch them (one batched request) and re-render.
  const { loading } = useProducts(ids);
  const catalogVersion = useCatalogVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion: products arrived
  const listings = useMemo(() => listingsByIds(ids, vehicle), [ids, vehicle, catalogVersion]);
  return (
    <Screen header={<ScreenHeader back title={s.favorites.title} subtitle={listings.length ? s.common.items(listings.length) : undefined} />}>
      {listings.length === 0 && loading ? (
        <View accessibilityRole="progressbar" style={{ gap: space.md, marginTop: space.sm }}>
          {ids.slice(0, 4).map((id) => (
            <Skeleton key={id} width="100%" height={96} rounded={radius.lg} />
          ))}
        </View>
      ) : listings.length === 0 ? (
        <EmptyState icon="heart" title={s.favorites.empty} body={s.favorites.emptyHint} action={{ label: s.cart.browse, onPress: () => router.navigate('/search') }} />
      ) : (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          {listings.map((l) => (
            <ProductRow key={l.product.id} listing={l} />
          ))}
        </View>
      )}
    </Screen>
  );
}
