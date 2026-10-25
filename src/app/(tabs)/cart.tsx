import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { PartArt } from '@/brand/PartArt';
import { getProduct } from '@/data/catalog';
import { ConditionBadge } from '@/features/badges';
import { groupCartBySeller } from '@/domain/pricing';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { layoutMove } from '@/theme/motion';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Stepper } from '@/ui/Stepper';
import { Text } from '@/ui/Text';
import { Price } from '@/ui/Price';

export default function Cart() {
  const { s, tx } = useI18n();
  const cart = useAppStore((st) => st.cart);
  const setQty = useAppStore((st) => st.setQty);
  const groups = useMemo(() => groupCartBySeller(cart, 'home', undefined), [cart]);
  const subtotal = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const count = cart.reduce((sum, l) => sum + l.qty, 0);

  if (cart.length === 0) {
    return (
      <Screen header={<ScreenHeader title={s.cart.title} large />}>
        <EmptyState icon="shopping-bag" title={s.cart.empty} body={s.cart.emptyHint} action={{ label: s.cart.browse, onPress: () => router.navigate('/search') }} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<ScreenHeader title={s.cart.title} subtitle={s.common.items(count)} large />}
      footer={
        <StickyFooter inTabs>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text variant="callout" color="textSecondary">
              {s.cart.subtotal}
            </Text>
            <Price amount={subtotal} variant="title2" />
          </View>
          <Text variant="caption" color="textTertiary">
            {s.cart.shippingCalculated} · {s.common.vatIncluded}
          </Text>
          <Button label={s.cart.checkout} icon="lock" onPress={() => router.push('/checkout')} />
        </StickyFooter>
      }
    >
      {groups.length > 1 ? (
        <View style={{ marginBottom: space.md }}>
          <Notice tone="info" icon="package" text={s.cart.multiSeller(groups.length)} />
        </View>
      ) : null}
      <View style={{ gap: space.lg }}>
        {groups.map((group) => (
          <Animated.View key={group.seller.id} layout={layoutMove} exiting={FadeOut} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
            <Pressable onPress={() => router.push(`/seller/${group.seller.id}`)} pressScale={0.99} accessibilityLabel={tx(group.seller.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Icon name="package" size={16} color="heading" />
              <Text variant="caption" color="textSecondary">
                {s.cart.shipmentFrom}
              </Text>
              <Text variant="captionStrong" style={{ flex: 1 }} numberOfLines={1}>
                {tx(group.seller.name)}
              </Text>
              <Icon name="chevron-right" size={14} color="textTertiary" />
            </Pressable>
            {group.lines.map(({ line, offer }, i) => {
              const product = getProduct(offer.productId);
              if (!product) return null;
              return (
                <Animated.View key={offer.id} layout={layoutMove} exiting={FadeOut.duration(160)} style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
                  <Pressable onPress={() => router.push(`/product/${product.id}`)} accessibilityLabel={tx(product.name)}>
                    <PartArt kind={product.art} size={72} rounded={radius.sm} />
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="callout" weight="semibold" numberOfLines={2}>
                      {tx(product.name)}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <ConditionBadge condition={offer.condition} />
                      <Text variant="caption" color="textSecondary" mono>
                        {product.partNumber}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <Price amount={offer.price * line.qty} />
                      <Stepper value={line.qty} max={Math.min(offer.stock, 10)} onChange={(q) => setQty(offer.id, q)} />
                    </View>
                  </View>
                </Animated.View>
              );
            })}
          </Animated.View>
        ))}
      </View>
    </Screen>
  );
}
