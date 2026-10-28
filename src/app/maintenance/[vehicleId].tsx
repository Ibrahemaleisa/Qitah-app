import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { halalasToSar } from '@/api/money';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { formatKm } from '@/lib/odometer';
import { vehicleLabel } from '@/lib/vehicle';
import { dueLine, kitCartLines, refreshMaintenance, statusVisuals, toStatus, useMaintenance, type MaintenanceService } from '@/services/maintenance';
import { useAppStore } from '@/store/app-store';
import { enterUp } from '@/theme/motion';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

export default function MaintenanceScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const { s, tx, lang } = useI18n();
  const vehicle = useAppStore((st) => st.vehicles.find((v) => v.id === vehicleId));
  const { data, state } = useMaintenance(vehicle);

  useFocusEffect(
    useCallback(() => {
      if (vehicle) refreshMaintenance(vehicle).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh per vehicle, not on every odometer change
    }, [vehicle?.id]),
  );

  if (!vehicle) {
    return (
      <Screen header={<ScreenHeader back title={s.maintenance.title} />}>
        <EmptyState icon="car" title={s.maintenance.noVehicle} action={{ label: s.garage.add, onPress: () => router.push('/garage/add') }} />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader back title={s.maintenance.title} subtitle={vehicleLabel(vehicle, lang)} />}>
      <Pressable
        onPress={() => router.push({ pathname: '/garage/odometer', params: { id: vehicle.id } })}
        haptics="tap"
        accessibilityLabel={s.garage2.updateOdometer}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
      >
        <Icon name="trending-up" size={20} color="heading" />
        <View style={{ flex: 1 }}>
          <Text variant="captionStrong" color="textSecondary">
            {s.garage2.odometer}
          </Text>
          <Text variant="bodyStrong">{vehicle.odometerKm != null ? s.garage2.km(formatKm(vehicle.odometerKm)) : s.garage2.noOdometer}</Text>
        </View>
        <Text variant="callout" weight="semibold" color="link">
          {s.garage2.updateOdometer}
        </Text>
      </Pressable>

      <View style={{ marginTop: space.md, gap: space.sm }}>
        <Notice tone="info" icon="info" text={data ? tx(data.disclaimer) : s.maintenance.addOdometer} />
        {vehicle.odometerKm == null ? <Notice tone="warning" text={s.maintenance.addOdometer} /> : null}
      </View>

      {state === 'loading' && !data ? (
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <Skeleton width="100%" height={120} rounded={radius.lg} />
          <Skeleton width="100%" height={120} rounded={radius.lg} />
        </View>
      ) : state === 'error' && !data ? (
        <View style={{ marginTop: space.lg, gap: space.sm }}>
          <Notice tone="warning" text={s.maintenance.loadFailed} />
          <Button label={s.common.retry} variant="secondary" size="sm" icon="refresh-ccw" onPress={() => refreshMaintenance(vehicle).catch(() => {})} />
        </View>
      ) : data ? (
        <>
          {data.proposals.length ? (
            <View style={{ marginTop: space.lg, gap: space.sm }}>
              <Text variant="headline">{s.maintenance.proposalsTitle}</Text>
              {data.proposals.map((p) => (
                <View key={p.orderItemId} style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
                  <Text variant="callout">{s.maintenance.proposal(tx(p.product), tx(p.service))}</Text>
                  <Button
                    label={s.maintenance.confirmProposal}
                    variant="secondary"
                    size="sm"
                    icon="check"
                    onPress={() => router.push({ pathname: '/maintenance/done', params: { vehicleId: vehicle.id, serviceCode: p.serviceCode, orderItemId: p.orderItemId } })}
                  />
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ marginTop: space.lg, gap: space.md }}>
            {data.services.map((svc, i) => (
              <Animated.View key={svc.serviceCode} entering={enterUp(i)}>
                <ServiceCard vehicleId={vehicle.id} service={svc} />
              </Animated.View>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function ServiceCard({ vehicleId, service }: { vehicleId: string; service: MaintenanceService }) {
  const { s, tx, money, date } = useI18n();
  const addToCart = useAppStore((st) => st.addToCart);
  const status = toStatus(service.status);
  const visual = statusVisuals[status];
  const due = dueLine(s, service);
  const kitLines = kitCartLines(service);
  const last = service.lastRecord;

  return (
    <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {tx(service.name)}
        </Text>
        <Badge label={s.maintenance.status[status]} tone={visual.tone} icon={visual.icon} />
      </View>
      {due ? (
        <Text variant="callout" weight="semibold" color={status === 'due' ? 'danger' : status === 'soon' ? 'warning' : 'text'}>
          {due}
        </Text>
      ) : null}
      <Text variant="caption" color="textSecondary">
        {s.maintenance.every(service.intervalKm ? formatKm(service.intervalKm) : null, service.intervalMonths)} · {tx(service.note)}
      </Text>
      <Text variant="caption" color="textTertiary">
        {last ? s.maintenance.lastDone(date(new Date(last.doneAt).getTime()), last.doneAtKm != null ? formatKm(last.doneAtKm) : undefined) : s.maintenance.neverRecorded}
      </Text>

      <View style={{ marginTop: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line, gap: space.sm }}>
        <Text variant="captionStrong" color="textSecondary">
          {s.maintenance.kit}
        </Text>
        {service.kit.lines.length === 0 ? (
          <Text variant="caption" color="textTertiary">
            {s.maintenance.kitEmpty}
          </Text>
        ) : (
          service.kit.lines.map((l) => (
            <Pressable key={l.offerId} onPress={() => router.push(`/product/${l.productId}`)} accessibilityLabel={tx(l.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" weight="semibold" numberOfLines={1}>
                  {tx(l.name)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text variant="caption" color="textSecondary" mono>
                    {l.brand} · {l.partNumber}
                  </Text>
                  <Badge label={l.fit === 'catalog' ? s.maintenance.fitCatalog : s.maintenance.fitUniversal} tone={l.fit === 'catalog' ? 'success' : 'info'} />
                </View>
              </View>
              <Text variant="callout" weight="semibold">
                {money(halalasToSar(l.priceHalalas))}
              </Text>
            </Pressable>
          ))
        )}
        {service.kit.missing.length ? (
          <Text variant="caption" color="warning">
            {s.maintenance.kitMissing(service.kit.missing.map((m) => tx(m.name)).join('، '))}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label={s.maintenance.addKit}
              size="sm"
              icon="shopping-bag"
              disabled={!kitLines.length}
              onPress={() => {
                kitLines.forEach((l) => addToCart(l.offerId, l.qty));
                haptic.success();
                toast(s.maintenance.kitAdded, 'shopping-bag');
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={s.maintenance.markDone}
              variant="secondary"
              size="sm"
              icon="check"
              onPress={() => router.push({ pathname: '/maintenance/done', params: { vehicleId, serviceCode: service.serviceCode } })}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
