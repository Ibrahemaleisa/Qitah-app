import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/brand/Logo';
import { PartArt } from '@/brand/PartArt';
import { useCatalogVersion } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { allCategories } from '@/data/catalog';
import { SampleBadge } from '@/features/badges';
import { orderStatusVisuals } from '@/features/orderVisuals';
import { ProductCard } from '@/features/ProductCard';
import { VehicleCard } from '@/features/VehicleCard';
import type { PartArtKind } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useNow } from '@/lib/use-now';
import { featuredListings, listingsByIds, recommendedFor, type ProductListing } from '@/services/catalog';
import { orderStatus, type OrderStatus } from '@/services/orders';
import { toOrderView } from '@/services/remote/orderView';
import { fetchOrders, useRemoteOrders } from '@/services/remote/orders';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { useSearchStore } from '@/store/search-store';
import { enterUp } from '@/theme/motion';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { HList } from '@/ui/HList';
import { Icon } from '@/ui/Icon';
import { IconButton } from '@/ui/IconButton';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';

export default function Home() {
  const { s, tx } = useI18n();
  const insets = useSafeAreaInsets();
  const vehicle = useSelectedVehicle();
  const user = useAppStore((st) => st.user);
  const recentIds = useAppStore((st) => st.recentlyViewed);
  const orders = useAppStore((st) => st.orders);
  const now = useNow();
  const catalogVersion = useCatalogVersion();
  const categories = allCategories();

  /* eslint-disable react-hooks/exhaustive-deps -- catalogVersion re-runs these after a catalog refresh */
  const recommended = useMemo(() => (vehicle ? recommendedFor(vehicle) : []), [vehicle, catalogVersion]);
  const featured = useMemo(() => featuredListings(vehicle), [vehicle, catalogVersion]);
  const recent = useMemo(() => listingsByIds(recentIds, vehicle), [recentIds, vehicle, catalogVersion]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Remote mode: the active order comes from the server's order list (refreshed when Home is focused).
  const remoteList = useRemoteOrders((st) => st.list);
  useFocusEffect(
    useCallback(() => {
      if (isRemote && user) fetchOrders().catch(() => {});
    }, [user]),
  );
  const activeOrder: { id: string; number: string; art: string | undefined; status: OrderStatus } | undefined = useMemo(() => {
    if (isRemote) {
      const view = remoteList.map((o) => toOrderView(o)).find((o) => !['delivered', 'cancelled', 'expired'].includes(o.status));
      return view ? { id: view.id, number: view.number, art: view.items[0]?.art, status: view.status } : undefined;
    }
    const o = orders.find((x) => {
      const st = orderStatus(x, now);
      return st !== 'delivered' && st !== 'cancelled';
    });
    return o ? { id: o.id, number: o.number, art: o.lines[0]?.art, status: orderStatus(o, now) } : undefined;
  }, [remoteList, orders, now]);

  const openSearch = () => {
    useSearchStore.getState().requestFocus();
    router.navigate('/search');
  };
  const openCategory = (id: (typeof categories)[number]['id']) => {
    const store = useSearchStore.getState();
    store.setQuery('');
    store.patchFilters({ categoryId: id });
    router.navigate('/search');
  };

  return (
    <Screen padded={false} contentStyle={{ paddingTop: insets.top + space.sm }}>
      <View style={{ paddingHorizontal: gutter }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Logo height={24} />
            {isRemote ? null : <SampleBadge />}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton icon="heart" label={s.account.favorites} onPress={() => router.push('/favorites')} />
            <IconButton icon="car" label={s.garage.title} onPress={() => router.push('/garage')} />
          </View>
        </View>

        <Text variant="title2" accessibilityRole="header" style={{ marginTop: space.lg }}>
          {s.home.greeting(user?.name.split(' ')[0])}
        </Text>
        <Text variant="caption" color="textSecondary">
          {s.brand.promise}
        </Text>

        <Pressable
          onPress={openSearch}
          pressScale={0.985}
          accessibilityRole="search"
          accessibilityLabel={s.home.searchPlaceholder}
          style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, height: 56, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
        >
          <Icon name="search" size={20} color="textSecondary" />
          <Text variant="body" color="textTertiary" style={{ flex: 1 }} numberOfLines={1}>
            {s.home.searchPlaceholder}
          </Text>
        </Pressable>

        <View style={{ marginTop: space.md }}>
          <VehicleCard vehicle={vehicle} />
        </View>

        {activeOrder ? (
          <Pressable
            onPress={() => router.push(`/order/${activeOrder.id}`)}
            pressScale={0.985}
            accessibilityLabel={`${s.home.activeOrder} ${activeOrder.number}, ${s.orders.status[activeOrder.status]}`}
            accessibilityHint={s.home.trackOrder}
            style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
          >
            <PartArt kind={(activeOrder.art ?? 'rotor') as PartArtKind} size={44} rounded={radius.sm} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.home.activeOrder} · <Text variant="captionStrong" color="textSecondary" ltr>{activeOrder.number}</Text>
              </Text>
              <Badge label={s.orders.status[activeOrder.status]} {...orderStatusVisuals[activeOrder.status]} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text variant="callout" weight="semibold" color="link">
                {s.home.trackOrder}
              </Text>
              <Icon name="chevron-right" size={16} color="link" />
            </View>
          </Pressable>
        ) : null}

        <Section title={s.home.categories}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {categories.map((c, i) => (
              <Animated.View key={c.id} entering={enterUp(i)} style={{ width: '31%' }}>
                <Pressable
                  onPress={() => openCategory(c.id)}
                  haptics="tap"
                  accessibilityLabel={tx(c.name)}
                  style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: space.sm, paddingHorizontal: space.xs, alignItems: 'center', gap: 2 }}
                >
                  <PartArt kind={c.art} size={52} background={colors.surfaceMuted} rounded={radius.md} />
                  <Text variant="caption" weight="semibold" align="center" numberOfLines={1}>
                    {tx(c.name)}
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </Section>
      </View>

      {vehicle && recommended.length ? <Carousel title={s.home.forYourVehicle} subtitle={s.home.forYourVehicleHint} data={recommended} /> : null}
      <Carousel title={s.home.featured} data={featured} />
      {recent.length ? <Carousel title={s.home.recentlyViewed} data={recent} /> : null}
      <View style={{ paddingHorizontal: gutter, marginTop: space.xxl }}>
        {isRemote ? <Notice tone="info" icon="info" text={s.remote.liveCatalogNote} /> : <Notice tone="sample" text={s.home.sampleBanner} />}
      </View>
    </Screen>
  );
}

function Carousel({ title, subtitle, data }: { title: string; subtitle?: string; data: ProductListing[] }) {
  return (
    <Section title={title} subtitle={subtitle} inset={gutter}>
      <HList
        data={data}
        keyExtractor={(l) => l.product.id}
        renderItem={({ item }) => <ProductCard listing={item} />}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}
      />
    </Section>
  );
}
