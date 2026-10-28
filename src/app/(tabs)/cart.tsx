import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { PartArt } from '@/brand/PartArt';
import { useCatalogVersion } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { getProduct } from '@/data/catalog';
import { ConditionBadge } from '@/features/badges';
import { lineIssues, useLiveCart } from '@/features/remote/useLiveCart';
import { GuaranteeBadge } from '@/features/trust';
import { guaranteeState } from '@/domain/guarantee';
import { groupCartBySeller } from '@/domain/pricing';
import { useI18n } from '@/i18n';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
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
  const { s, tx, money } = useI18n();
  const cart = useAppStore((st) => st.cart);
  const setQty = useAppStore((st) => st.setQty);
  const removeFromCart = useAppStore((st) => st.removeFromCart);
  const acknowledgePrice = useAppStore((st) => st.acknowledgePrice);
  const vehicle = useSelectedVehicle();
  const catalogVersion = useCatalogVersion();
  // Remote: live price/stock refresh whenever the cart is opened.
  const live = useLiveCart();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion: live prices/stock changed
  const groups = useMemo(() => groupCartBySeller(cart, 'home', undefined), [cart, catalogVersion]);
  const blocked = isRemote && cart.some((l) => lineIssues(l, live.reduced).some((i) => i.kind === 'unavailable'));
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
          <Text variant="caption" color={blocked ? 'danger' : 'textTertiary'}>
            {blocked ? s.remote.fixCartFirst : `${s.cart.shippingCalculated} · ${s.common.vatIncluded}`}
          </Text>
          <Button label={s.cart.checkout} icon="lock" disabled={blocked || live.state === 'refreshing'} loading={live.state === 'refreshing'} onPress={() => router.push('/checkout')} />
        </StickyFooter>
      }
    >
      {live.state === 'refreshing' ? (
        <View style={{ marginBottom: space.md }}>
          <Notice tone="info" icon="refresh-ccw" text={s.remote.refreshing} />
        </View>
      ) : live.state === 'error' ? (
        <View style={{ marginBottom: space.md, gap: space.sm }}>
          <Notice tone="warning" text={s.remote.errors.NETWORK} />
          <Button label={s.common.retry} variant="secondary" size="sm" icon="refresh-ccw" onPress={live.refresh} />
        </View>
      ) : null}
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
              const issues = isRemote ? lineIssues(line, live.reduced) : [];
              const unavailable = issues.some((x) => x.kind === 'unavailable');
              return (
                <Animated.View key={offer.id} layout={layoutMove} exiting={FadeOut.duration(160)} style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
                  <Pressable onPress={() => router.push(`/product/${product.id}`)} accessibilityLabel={tx(product.name)}>
                    <PartArt kind={product.art} size={72} rounded={radius.sm} />
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="callout" weight="semibold" numberOfLines={2}>
                      {tx(product.name)}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <ConditionBadge condition={offer.condition} />
                      <Text variant="caption" color="textSecondary" mono>
                        {product.partNumber}
                      </Text>
                    </View>
                    {guaranteeState(product, vehicle) === 'covered' ? (
                      <Pressable onPress={() => router.push('/guarantee')} accessibilityRole="link" accessibilityLabel={`${s.trust.guaranteeBadge}. ${product.universal ? s.trust.guaranteeLineSpec : s.trust.guaranteeLine}`} style={{ alignSelf: 'flex-start' }}>
                        <GuaranteeBadge />
                      </Pressable>
                    ) : null}
                    {unavailable ? (
                      <View style={{ marginTop: 4, gap: space.sm }}>
                        <Notice tone="danger" text={s.remote.outOfStockLine} />
                        <Button label={s.common.remove} icon="trash-2" variant="secondary" size="sm" onPress={() => removeFromCart(offer.id)} />
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                        <Price amount={offer.price * line.qty} />
                        <Stepper value={line.qty} max={Math.min(offer.stock, 10)} onChange={(q) => setQty(offer.id, q)} />
                      </View>
                    )}
                    {issues.map((issue) =>
                      issue.kind === 'priceChanged' ? (
                        <View key="price" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 }}>
                          <Icon name="tag" size={14} color="warning" />
                          <Text variant="caption" color="warning" style={{ flex: 1 }}>
                            {s.remote.priceChanged(money(issue.from), money(issue.to))}
                          </Text>
                          <Button label={s.remote.acknowledge} variant="secondary" size="sm" onPress={() => acknowledgePrice(offer.id)} />
                        </View>
                      ) : issue.kind === 'reduced' ? (
                        <Text key="qty" variant="caption" color="info" style={{ marginTop: 4 }}>
                          {s.remote.qtyReduced(issue.to)}
                        </Text>
                      ) : null,
                    )}
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
