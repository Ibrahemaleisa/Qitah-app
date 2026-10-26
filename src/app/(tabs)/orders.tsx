import { router } from 'expo-router';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PartArt } from '@/brand/PartArt';
import { isRemote } from '@/config/env';
import { RemoteOrders } from '@/features/remote/RemoteOrders';
import { orderStatusVisuals } from '@/features/orderVisuals';
import { useI18n } from '@/i18n';
import { useNow } from '@/lib/use-now';
import { currentStage, orderStatus, shipmentStages } from '@/services/orders';
import { getSeller } from '@/domain/pricing';
import { ShipmentProgress } from '@/features/ShipmentTimeline';
import { useAppStore } from '@/store/app-store';
import { enterUp } from '@/theme/motion';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Price } from '@/ui/Price';

/** Remote mode lists the customer's server orders; demo mode the simulated local ones. */
export default function Orders() {
  return isRemote ? <RemoteOrders /> : <DemoOrders />;
}

function DemoOrders() {
  const { s, tx, money, date } = useI18n();
  const orders = useAppStore((st) => st.orders);
  const now = useNow();
  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Screen header={<ScreenHeader title={s.orders.title} large />}>
      {sorted.length === 0 ? (
        <EmptyState icon="package" title={s.orders.empty} body={s.orders.emptyHint} action={{ label: s.cart.browse, onPress: () => router.navigate('/search') }} />
      ) : (
        <View style={{ gap: space.md }}>
          {sorted.map((order, i) => {
            const status = orderStatus(order, now);
            const visual = orderStatusVisuals[status];
            return (
              <Animated.View key={order.id} entering={enterUp(i)}>
                <Pressable
                  onPress={() => router.push(`/order/${order.id}`)}
                  pressScale={0.985}
                  accessibilityLabel={`${order.number}, ${s.orders.status[status]}, ${money(order.totals.total)}`}
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
                    <Badge label={s.orders.status[status]} tone={visual.tone} icon={visual.icon} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {order.lines.slice(0, 4).map((l) => (
                      <PartArt key={l.id} kind={l.art} size={52} rounded={radius.sm} />
                    ))}
                    {order.lines.length > 4 ? (
                      <View style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                        <Text variant="captionStrong">+{order.lines.length - 4}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="callout" numberOfLines={1} color="textSecondary">
                    {order.lines.map((l) => tx(l.productName)).join(' · ')}
                  </Text>
                  <View style={{ gap: space.sm }}>
                    {order.shipments.map((sh) => {
                      const stage = currentStage(order, sh, now);
                      const seller = getSeller(sh.sellerId);
                      return (
                        <ShipmentProgress
                          key={sh.id}
                          sellerName={seller ? tx(seller.name) : ''}
                          stageIndex={shipmentStages.indexOf(stage)}
                          stageLabel={order.cancellation ? s.orders.status.cancelled : s.orders.stages[stage]}
                          cancelled={!!order.cancellation}
                        />
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Badge label={s.success.shipments(order.shipments.length)} icon="truck" />
                      {order.isSample ? <Badge label={s.orders.sampleOrder} tone="info" icon="flag" /> : null}
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
