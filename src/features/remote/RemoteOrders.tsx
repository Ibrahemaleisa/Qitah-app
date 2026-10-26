import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PartArt } from '@/brand/PartArt';
import { orderStatusVisuals } from '@/features/orderVisuals';
import { ShipmentProgress } from '@/features/ShipmentTimeline';
import { useI18n } from '@/i18n';
import { toOrderView, type OrderView, type ShipmentView } from '@/services/remote/orderView';
import { fetchOrders, useRemoteOrders } from '@/services/remote/orders';
import { useAppStore } from '@/store/app-store';
import { enterUp } from '@/theme/motion';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Price } from '@/ui/Price';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { usePollWhileFocused } from './usePolling';

/** Label for a shipment's current position, honest about exceptions and unpaid orders. */
export function useShipmentLabel() {
  const { s } = useI18n();
  return (order: OrderView, sh: ShipmentView) => {
    if (sh.cancelled || order.status === 'cancelled') return s.orders.status.cancelled;
    if (!sh.stage) return s.orders.status[order.status];
    if (sh.exception) return s.remote.exceptionShort[sh.exception];
    return s.orders.stages[sh.stage];
  };
}

export function RemoteOrders() {
  const { s, tx, money, date } = useI18n();
  const user = useAppStore((st) => st.user);
  const list = useRemoteOrders((st) => st.list);
  const listState = useRemoteOrders((st) => st.listState);
  const orders = useMemo(() => list.map((o) => toOrderView(o)).sort((a, b) => b.createdAt - a.createdAt), [list]);
  const label = useShipmentLabel();
  usePollWhileFocused(() => (user ? fetchOrders() : undefined), 15_000, !!user);

  if (!user) {
    return (
      <Screen header={<ScreenHeader title={s.orders.title} large />}>
        <EmptyState icon="package" title={s.orders.title} body={s.remote.signInForOrders} action={{ label: s.common.signIn, onPress: () => router.push('/sign-in') }} />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader title={s.orders.title} subtitle={orders.length ? s.remote.autoRefresh : undefined} large />}>
      {listState === 'loading' && !orders.length ? (
        <View style={{ gap: space.md }} accessibilityLabel={s.remote.loadingCatalog}>
          {[0, 1].map((i) => (
            <Skeleton key={i} width="100%" height={180} rounded={radius.lg} />
          ))}
        </View>
      ) : listState === 'error' && !orders.length ? (
        <View style={{ gap: space.md }}>
          <Notice tone="danger" text={s.remote.loadFailed} />
          <Button label={s.common.retry} icon="refresh-ccw" variant="secondary" onPress={() => fetchOrders().catch(() => {})} />
        </View>
      ) : orders.length === 0 ? (
        <EmptyState icon="package" title={s.orders.empty} body={s.orders.emptyHint} action={{ label: s.cart.browse, onPress: () => router.navigate('/search') }} />
      ) : (
        <View style={{ gap: space.md }}>
          {orders.map((order, i) => {
            const visual = orderStatusVisuals[order.status];
            return (
              <Animated.View key={order.id} entering={enterUp(i)}>
                <Pressable
                  onPress={() => router.push(`/order/${order.id}`)}
                  pressScale={0.985}
                  accessibilityLabel={`${order.number}, ${s.orders.status[order.status]}, ${money(order.totals.total)}`}
                  style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.md }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View>
                      <Text variant="bodyStrong" ltr>
                        {order.number}
                      </Text>
                      <Text variant="caption" color="textTertiary">
                        {date(order.createdAt)}
                      </Text>
                    </View>
                    <Badge label={s.orders.status[order.status]} tone={visual.tone} icon={visual.icon} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {order.items.slice(0, 4).map((l) => (
                      <PartArt key={l.id} kind={l.art} size={52} rounded={radius.sm} />
                    ))}
                    {order.items.length > 4 ? (
                      <View style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                        <Text variant="captionStrong">+{order.items.length - 4}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="callout" numberOfLines={1} color="textSecondary">
                    {order.items.map((l) => tx(l.name)).join(' · ')}
                  </Text>
                  {order.status !== 'pendingPayment' && order.status !== 'paymentFailed' && order.status !== 'expired' ? (
                    <View style={{ gap: space.sm }}>
                      {order.shipments.map((sh) => (
                        <ShipmentProgress key={sh.groupId} sellerName={tx(sh.sellerName)} stageIndex={sh.stageIndex} stageLabel={label(order, sh)} cancelled={sh.cancelled || order.status === 'cancelled'} />
                      ))}
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Badge label={s.success.shipments(order.shipments.length)} icon="truck" />
                      {order.returns.length ? <Badge label={s.remote.returns} tone="info" icon="rotate-ccw" /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Price amount={order.totals.total} />
                      <Icon name="chevron-right" size={16} color="textTertiary" />
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
