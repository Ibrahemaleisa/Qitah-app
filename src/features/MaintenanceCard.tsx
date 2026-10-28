import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import type { Vehicle } from '@/domain/types';
import { useI18n } from '@/i18n';
import { dueLine, nextService, refreshMaintenance, statusVisuals, toStatus, useMaintenance } from '@/services/maintenance';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

/** Home: "صيانتك القادمة" for the selected vehicle — the most urgent service, or a nudge to add the odometer. */
export function MaintenanceCard({ vehicle }: { vehicle: Vehicle }) {
  const { s, tx } = useI18n();
  const { data } = useMaintenance(vehicle);

  useFocusEffect(
    useCallback(() => {
      refreshMaintenance(vehicle).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when the selected vehicle changes
    }, [vehicle.id, vehicle.odometerKm]),
  );

  const next = data ? nextService(data.services) : undefined;
  const status = next ? toStatus(next.status) : undefined;
  const visual = status ? statusVisuals[status] : undefined;
  const title = next ? tx(next.name) : vehicle.odometerKm == null ? s.maintenance.homeAddOdometer : s.maintenance.homeTrackHint;
  const detail = next ? dueLine(s, next) : null;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/maintenance/[vehicleId]', params: { vehicleId: vehicle.id } })}
      pressScale={0.985}
      accessibilityLabel={`${s.maintenance.upcoming}: ${title}${detail ? `, ${detail}` : ''}`}
      style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="tool" size={20} color="heading" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="captionStrong" color="textSecondary">
          {s.maintenance.upcoming}
        </Text>
        <Text variant="callout" weight="semibold" numberOfLines={2}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" color={status === 'due' ? 'danger' : status === 'soon' ? 'warning' : 'textSecondary'}>
            {detail}
          </Text>
        ) : null}
      </View>
      {status && visual ? <Badge label={s.maintenance.status[status]} tone={visual.tone} icon={visual.icon} /> : <Icon name="chevron-right" size={16} color="link" />}
    </Pressable>
  );
}
