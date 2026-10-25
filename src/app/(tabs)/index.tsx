import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/brand/Logo';
import { PartArt } from '@/brand/PartArt';
import { categories } from '@/data/catalog';
import { orderStatusVisuals } from '@/features/orderVisuals';
import { ProductCard } from '@/features/ProductCard';
import { VehicleCard } from '@/features/VehicleCard';
import { useI18n } from '@/i18n';
import { useNow } from '@/lib/use-now';
import { featuredListings, listingsByIds, recommendedFor, type ProductListing } from '@/services/catalog';
import { orderStatus } from '@/services/orders';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { useSearchStore } from '@/store/search-store';
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

  const recommended = useMemo(() => (vehicle ? recommendedFor(vehicle) : []), [vehicle]);
  const featured = useMemo(() => featuredListings(vehicle), [vehicle]);
  const recent = useMemo(() => listingsByIds(recentIds, vehicle), [recentIds, vehicle]);
  const activeOrder = orders.find((o) => {
    const st = orderStatus(o, now);
    return st !== 'delivered' && st !== 'cancelled';
  });

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
          <Logo size={34} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton icon="heart" label={s.account.favorites} onPress={() => router.push('/favorites')} />
            <IconButton icon="truck" label={s.garage.title} onPress={() => router.push('/garage')} />
          </View>
        </View>

        <Text variant="title1" style={{ marginTop: space.lg }}>
          {s.home.greeting(user?.name.split(' ')[0])}
        </Text>
        <Text variant="callout" color="textSecondary">
          {s.brand.promise}
        </Text>

        <Pressable
          onPress={openSearch}
          pressScale={0.985}
          accessibilityRole="search"
          accessibilityLabel={s.home.searchPlaceholder}
          style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, height: 56, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
        >
          <Icon name="search" size={20} color="accent" />
          <Text variant="body" color="textTertiary" style={{ flex: 1 }} numberOfLines={1}>
            {s.home.searchPlaceholder}
          </Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: colors.surfaceSunken }}>
            <Text variant="micro" color="textSecondary" ltr>
              04465-…
            </Text>
          </View>
        </Pressable>

        <View style={{ marginTop: space.md }}>
          <VehicleCard vehicle={vehicle} />
        </View>

        {activeOrder ? (
          <Pressable
            onPress={() => router.push(`/order/${activeOrder.id}`)}
            pressScale={0.985}
            accessibilityLabel={s.home.activeOrder}
            style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
          >
            <PartArt kind={activeOrder.lines[0]?.art ?? 'rotor'} size={44} rounded={radius.sm} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.home.activeOrder} · <Text variant="captionStrong" color="textSecondary" ltr>{activeOrder.number}</Text>
              </Text>
              <Badge label={s.orders.status[orderStatus(activeOrder, now)]} {...orderStatusVisuals[orderStatus(activeOrder, now)]} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text variant="callout" weight="semibold" color="accentPressed">
                {s.home.trackOrder}
              </Text>
              <Icon name="chevron-right" size={16} color="accentPressed" />
            </View>
          </Pressable>
        ) : null}

        <View style={{ marginTop: space.lg }}>
          <Notice tone="sample" text={s.home.sampleBanner} />
        </View>

        <Section title={s.home.categories}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {categories.map((c, i) => (
              <Animated.View key={c.id} entering={FadeInDown.delay(i * 30).duration(280)} style={{ width: '31%' }}>
                <Pressable
                  onPress={() => openCategory(c.id)}
                  haptics="tap"
                  accessibilityLabel={tx(c.name)}
                  style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.sm, alignItems: 'center', gap: space.xs }}
                >
                  <PartArt kind={c.art} size={64} background={colors.surfaceMuted} rounded={radius.md} />
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
