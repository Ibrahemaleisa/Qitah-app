import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { PartArt } from '@/brand/PartArt';
import { isRemote } from '@/config/env';
import { RemoteOrderDetail } from '@/features/remote/RemoteOrderDetail';
import { cities, deliveryOptions } from '@/data/sellers';
import { ConditionBadge } from '@/features/badges';
import { orderStatusVisuals } from '@/features/orderVisuals';
import { ShipmentTimeline } from '@/features/ShipmentTimeline';
import { getSeller } from '@/domain/pricing';
import { useI18n } from '@/i18n';
import { useNow } from '@/lib/use-now';
import { canCancel, currentStage, orderStatus, returnableLineIds, shipmentTimeline } from '@/services/orders';
import { paymentMethods } from '@/services/payments/mock';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';

export default function OrderDetails() {
  return isRemote ? <RemoteOrderDetail /> : <DemoOrderDetails />;
}

function DemoOrderDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, tx, money, date, time } = useI18n();
  const order = useAppStore((st) => st.orders.find((o) => o.id === id));
  const now = useNow(10_000);

  if (!order) {
    return (
      <Screen header={<ScreenHeader back />}>
        <EmptyState icon="package" title={s.errors.notFound} action={{ label: s.errors.goHome, onPress: () => router.replace('/') }} />
      </Screen>
    );
  }

  const status = orderStatus(order, now);
  const visual = orderStatusVisuals[status];
  const returnable = returnableLineIds(order, now);
  const method = paymentMethods.find((m) => m.id === order.payment.methodId);

  return (
    <Screen header={<ScreenHeader back title={order.number} subtitle={`${s.orders.placedOn} ${date(order.createdAt)}`} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Badge label={s.orders.status[status]} tone={visual.tone} icon={visual.icon} />
        {order.isSample ? <Badge label={s.orders.sampleOrder} tone="info" icon="flag" /> : null}
      </View>

      {order.cancellation ? (
        <View style={{ marginTop: space.md }}>
          <Notice tone="danger" text={`${s.orders.cancelledNote} — ${order.cancellation.reason}`} />
        </View>
      ) : (
        <View style={{ marginTop: space.md }}>
          <Notice tone="sample" icon="clock" text={s.orders.simulatedTimeline} />
        </View>
      )}

      {order.shipments.map((shipment, i) => {
        const seller = getSeller(shipment.sellerId);
        const option = deliveryOptions[shipment.deliveryOptionId];
        const events = shipmentTimeline(order, shipment, now);
        const stage = currentStage(order, shipment, now);
        const lines = order.lines.filter((l) => shipment.lineIds.includes(l.id));
        const delivered = events[events.length - 1];
        return (
          <Section key={shipment.id} title={s.orders.shipment(i + 1, order.shipments.length)} subtitle={seller ? tx(seller.name) : undefined}>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.lg }}>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="micro" color="textTertiary">
                    {s.orders.carrier}
                  </Text>
                  <Text variant="callout" weight="semibold">
                    {tx(option.carrier)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="micro" color="textTertiary">
                    {s.orders.tracking}
                  </Text>
                  <Text variant="callout" weight="semibold" ltr selectable>
                    {shipment.trackingNumber}
                  </Text>
                </View>
              </View>
              {!order.cancellation && stage !== 'delivered' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, padding: space.md }}>
                  <Icon name="truck" size={16} color="heading" />
                  <Text variant="caption" color="heading">
                    {s.orders.eta}: {date(delivered.at)} · {time(delivered.at)}
                  </Text>
                </View>
              ) : null}
              <ShipmentTimeline events={events} cancelled={!!order.cancellation} />
              <View style={{ gap: space.md }}>
                {lines.map((l) => {
                  const returned = order.returns.find((r) => r.lineId === l.id);
                  return (
                    <Pressable key={l.id} onPress={() => router.push(`/product/${l.productId}`)} pressScale={0.99} accessibilityLabel={tx(l.productName)} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                      <PartArt kind={l.art} size={52} rounded={radius.sm} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="callout" weight="semibold" numberOfLines={2}>
                          {tx(l.productName)}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <ConditionBadge condition={l.condition} />
                          <Text variant="caption" color="textSecondary">
                            {`${l.qty} × ${money(l.unitPrice)}`}
                          </Text>
                        </View>
                        {returned ? <Badge label={`${s.orders.returnRequested} · ${s.orders.returnReasons[returned.reason]}`} tone="info" icon="rotate-ccw" /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label={s.orders.contactSeller} icon="message-circle" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/seller-contact', params: { sellerId: shipment.sellerId, orderNumber: order.number } })} />
                {lines.some((l) => returnable.includes(l.id)) ? (
                  <Button label={s.orders.requestReturn} icon="rotate-ccw" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/order/return', params: { id: order.id, shipmentId: shipment.id } })} />
                ) : null}
              </View>
            </View>
          </Section>
        );
      })}

      <Section title={s.orders.deliveryAddress}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name={order.address.kind === 'workshop' ? 'tool' : 'home'} size={16} color="heading" />
            <Text variant="bodyStrong">{order.address.workshopName ?? order.address.label}</Text>
          </View>
          <Text variant="callout" color="textSecondary">
            {tx(cities[order.address.city])} · {order.address.district} · {order.address.street}
          </Text>
          <Text variant="caption" color="textTertiary">
            {order.address.contactName} · <Text variant="caption" color="textTertiary" ltr>{order.address.phone}</Text>
          </Text>
          {order.vehicleLabel ? (
            <Text variant="caption" color="textSecondary">
              {s.checkout.vehicleNote(order.vehicleLabel)}
            </Text>
          ) : null}
        </View>
      </Section>

      <Section title={s.orders.payment}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
          <Text variant="callout" weight="semibold">
            {s.orders.paidSimulated(method ? tx(method.name) : order.payment.methodId)}
          </Text>
          <Text variant="caption" color="textTertiary" ltr>
            {order.payment.reference}
          </Text>
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: space.xs }} />
          <Row label={s.checkout.items} value={money(order.totals.items)} />
          <Row label={s.checkout.shippingFees} value={order.totals.shipping === 0 ? s.product.freeShipping : money(order.totals.shipping)} />
          <Row label={s.checkout.total} value={money(order.totals.total)} strong />
          <Text variant="caption" color="textTertiary">
            {s.checkout.vat(money(order.totals.vat))}
          </Text>
        </View>
      </Section>

      {canCancel(order, now) ? (
        <Button label={s.orders.cancelOrder} variant="danger" icon="x-circle" size="md" style={{ marginTop: space.xl }} onPress={() => router.push({ pathname: '/order/cancel', params: { id: order.id } })} />
      ) : null}
      <Button label={s.orders.needHelp} variant="ghost" icon="help-circle" size="md" style={{ marginTop: space.sm }} onPress={() => router.push('/support')} />
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={strong ? 'bodyStrong' : 'callout'} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'callout'} weight={strong ? 'bold' : 'medium'}>
        {value}
      </Text>
    </View>
  );
}
