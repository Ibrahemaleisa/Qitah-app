import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { ProductRow } from '@/features/ProductCard';
import { useI18n } from '@/i18n';
import { listingsByIds } from '@/services/catalog';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { EmptyState } from '@/ui/EmptyState';
import { Screen, ScreenHeader } from '@/ui/Screen';

export default function Favorites() {
  const { s } = useI18n();
  const ids = useAppStore((st) => st.favorites);
  const vehicle = useSelectedVehicle();
  const listings = useMemo(() => listingsByIds(ids, vehicle), [ids, vehicle]);
  return (
    <Screen header={<ScreenHeader back title={s.favorites.title} subtitle={listings.length ? s.common.items(listings.length) : undefined} />}>
      {listings.length === 0 ? (
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
