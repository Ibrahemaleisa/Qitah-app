import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { PartArt } from '@/brand/PartArt';
import { cityLabel } from '@/data/sellers';
import type { ReturnReason } from '@/domain/types';
import { ConditionBadge } from '@/features/badges';
import { orderStatusVisuals } from '@/features/orderVisuals';
import { ShipmentTimeline } from '@/features/ShipmentTimeline';
import { useI18n } from '@/i18n';
import { paymentMethods } from '@/services/payments/mock';
import { useRemoteOrder } from '@/services/remote/orders';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { usePollWhileFocused } from './usePolling';

const RETURN_REASONS: ReturnReason[] = ['wrongPart', 'damaged', 'notAsDescribed', 'changedMind'];

/** Remote order detail: per-merchant sub-orders, per-shipment tracking from real events, returns and refunds. */
export function RemoteOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, tx, money, date, time } = useI18n();
  const { order, state, error, refresh } = useRemoteOrder(id);
  // Tracking stays live while the screen is focused (plain refetch every 15s).
  usePollWhileFocused(refresh, 15_000, !!id);

  if (!order) {
    return (
      <Screen header={<ScreenHeader back />}>
        {state === 'error' ? (
          <EmptyState icon="alert-circle" title={error?.code === 'NOT_FOUND' ? s.errors.notFound : s.remote.loadFailed} action={{ label: s.common.retry, onPress: refresh }} />
        ) : (
          <View style={{ gap: space.md, marginTop: space.lg }}>
            <Skeleton width="60%" height={28} />
            <Skeleton width="100%" height={220} rounded={radius.lg} />
            <Skeleton width="100%" height={120} rounded={radius.lg} />
          </View>
        )}
      </Screen>
    );
  }

  const visual = orderStatusVisuals[order.status];
  const method = paymentMethods.find((m) => m.id === (order.payment?.method ?? order.paymentMethod));
  const returnableIds = new Set(order.returnable.map((r) => r.itemId));
  const unpaid = order.status === 'pendingPayment' || order.status === 'paymentFailed';
  const itemName = (itemId: string) => {
    const it = order.items.find((x) => x.id === itemId);
    return it ? tx(it.name) : itemId;
  };

  return (
    <Screen header={<ScreenHeader back title={order.number} subtitle={`${s.orders.placedOn} ${date(order.createdAt)}`} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Badge label={s.orders.status[order.status]} tone={visual.tone} icon={visual.icon} />
        {order.sandbox ? <Badge label={s.remote.liveBadge} tone="info" icon="flag" /> : null}
        <Text variant="caption" color="textTertiary">
          {s.remote.autoRefresh}
        </Text>
      </View>

      {error && state === 'ready' ? (
        <View style={{ marginTop: space.md }}>
          <Notice tone="warning" text={s.remote.errors.NETWORK} />
        </View>
      ) : null}

      {unpaid ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <Notice tone={order.status === 'paymentFailed' ? 'danger' : 'warning'} icon="credit-card" text={order.status === 'paymentFailed' ? s.remote.paymentFailedBody(time(order.paymentExpiresAt)) : s.remote.awaitingPayment} />
          <Button label={s.remote.completePayment} icon="lock" size="md" onPress={() => router.push({ pathname: '/checkout/payment', params: { orderId: order.id, method: order.paymentMethod } })} />
        </View>
      ) : null}
      {order.status === 'expired' ? (
        <View style={{ marginTop: space.md }}>
          <Notice tone="danger" text={s.remote.paymentExpired} />
        </View>
      ) : null}
      {order.status === 'cancelled' ? (
        <View style={{ marginTop: space.md }}>
          <Notice tone="danger" text={`${s.orders.cancelled}${order.cancelReason ? ` — ${order.cancelReason}` : ''}`} />
        </View>
      ) : null}

      {order.shipments.map((sh, i) => {
        const returnableHere = sh.items.some((it) => returnableIds.has(it.id));
        return (
          <Section key={sh.groupId} title={s.orders.shipment(i + 1, order.shipments.length)} subtitle={`${tx(sh.sellerName)} · ${s.remote.subOrder(sh.merchantOrderNumber)}`}>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.lg }}>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="micro" color="textTertiary">
                    {s.orders.carrier}
                  </Text>
                  <Text variant="callout" weight="semibold">
                    {(s.remote.services as Record<string, string>)[sh.serviceCode] ?? sh.serviceCode}
                  </Text>
                  {sh.originCity ? (
                    <Text variant="caption" color="textSecondary">
                      {s.remote.shipmentFrom(tx(cityLabel(sh.originCity)))}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="micro" color="textTertiary">
                    {s.orders.tracking}
                  </Text>
                  {sh.trackingNumber ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text variant="callout" weight="semibold" ltr selectable>
                        {sh.trackingNumber}
                      </Text>
                      {sh.sandboxTracking ? <Badge label={s.remote.sandboxTracking} tone="info" /> : null}
                    </View>
                  ) : (
                    <Text variant="callout" color="textTertiary">
                      {s.remote.trackingPending}
                    </Text>
                  )}
                </View>
              </View>

              {sh.stage && sh.stage !== 'delivered' && !sh.cancelled && order.status !== 'cancelled' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, padding: space.md }}>
                  <Icon name="truck" size={16} color="heading" />
                  <Text variant="caption" color="heading">
                    {s.orders.eta}: {s.common.deliveryIn(sh.etaDays[0], sh.etaDays[1])}
                  </Text>
                </View>
              ) : null}
              {sh.exception ? <Notice tone={sh.exception === 'CANCELLED' ? 'warning' : 'danger'} text={s.remote.exceptions[sh.exception]} /> : null}
              {sh.rejected ? <Notice tone="warning" text={s.remote.merchantRejected} /> : null}

              {sh.stage ? <ShipmentTimeline events={sh.timeline} cancelled={sh.cancelled || order.status === 'cancelled'} /> : null}

              {sh.events.length ? (
                <View style={{ gap: space.xs }}>
                  <Text variant="captionStrong" color="textSecondary">
                    {s.remote.carrierEvents}
                  </Text>
                  {[...sh.events].reverse().map((e, k) => (
                    <View key={`${e.status}-${k}`} style={{ flexDirection: 'row', gap: space.sm }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: k === 0 ? colors.accent : colors.lineStrong }} />
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" color={k === 0 ? 'text' : 'textSecondary'}>
                          {[e.description ?? e.status, e.location].filter(Boolean).join(' · ')}
                        </Text>
                        <Text variant="micro" color="textTertiary">
                          {date(e.at)} · {time(e.at)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ gap: space.md }}>
                {sh.items.map((l) => (
                  <Pressable key={l.id} onPress={() => router.push(`/product/${l.productId}`)} pressScale={0.99} accessibilityLabel={tx(l.name)} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', opacity: l.cancelled ? 0.6 : 1 }}>
                    <PartArt kind={l.art} size={52} rounded={radius.sm} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="callout" weight="semibold" numberOfLines={2}>
                        {tx(l.name)}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <ConditionBadge condition={l.condition} />
                        <Text variant="caption" color="textSecondary">
                          {`${l.qty} × ${money(l.unitPrice)}`}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label={s.orders.contactSeller} icon="message-circle" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/seller-contact', params: { sellerId: sh.sellerId, orderNumber: order.number } })} />
                {returnableHere ? (
                  <Button label={s.orders.requestReturn} icon="rotate-ccw" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/order/return', params: { id: order.id, shipmentId: sh.groupId } })} />
                ) : null}
              </View>
            </View>
          </Section>
        );
      })}

      {order.returns.length ? (
        <Section title={s.remote.returns}>
          <View style={{ gap: space.sm }}>
            {order.returns.map((r) => (
              <View key={r.id} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                  <Text variant="bodyStrong" ltr>
                    {r.number}
                  </Text>
                  <Badge label={s.remote.returnStatus[r.status] ?? r.status} tone={r.status === 'REJECTED' ? 'danger' : r.status === 'REFUNDED' ? 'success' : 'info'} icon="rotate-ccw" />
                </View>
                <Text variant="caption" color="textSecondary">
                  {RETURN_REASONS.includes(r.reason as ReturnReason) ? s.orders.returnReasons[r.reason as ReturnReason] : r.reason} · {date(r.createdAt)}
                </Text>
                {r.items.map((it) => (
                  <Text key={it.orderItemId} variant="caption">
                    {`${itemName(it.orderItemId)} × ${it.quantity}`}
                  </Text>
                ))}
                {r.refund > 0 ? (
                  <Text variant="captionStrong" color="success">
                    {s.remote.refundedTotal(money(r.refund))}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {order.refunds.length ? (
        <Section title={s.remote.refunds}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
            {order.refunds.map((r) => (
              <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md }}>
                <Text variant="callout">{money(r.amount)}</Text>
                <Badge label={s.remote.refundStatus[r.status] ?? r.status} tone={r.status === 'SUCCEEDED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'warning'} />
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {order.address ? (
        <Section title={s.orders.deliveryAddress}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name={order.address.kind === 'workshop' ? 'tool' : 'home'} size={16} color="heading" />
              <Text variant="bodyStrong">{order.address.workshopName ?? order.address.label}</Text>
            </View>
            <Text variant="callout" color="textSecondary">
              {tx(cityLabel(order.address.city))} · {order.address.district} · {order.address.street}
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
      ) : null}

      <Section title={s.orders.payment}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <Text variant="callout" weight="semibold" style={{ flex: 1 }}>
              {s.remote.paidWith(method ? tx(method.name) : order.paymentMethod)}
            </Text>
            {order.payment ? <Badge label={s.remote.paymentStatus[order.payment.status] ?? order.payment.status} tone={order.payment.status === 'CAPTURED' ? 'success' : order.payment.status === 'FAILED' ? 'danger' : 'neutral'} /> : null}
          </View>
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: space.xs }} />
          <Row label={s.checkout.items} value={money(order.totals.items)} />
          <Row label={s.checkout.shippingFees} value={money(order.totals.shipping)} />
          <Row label={s.checkout.total} value={money(order.totals.total)} strong />
          <Text variant="caption" color="textTertiary">
            {s.checkout.vat(money(order.totals.vat))}
          </Text>
          {order.totals.refunded > 0 ? (
            <Text variant="captionStrong" color="success">
              {s.remote.refundedTotal(money(order.totals.refunded))}
            </Text>
          ) : null}
        </View>
      </Section>

      {order.canCancel ? (
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
