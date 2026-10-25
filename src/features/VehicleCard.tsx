import { router } from 'expo-router';
import { View } from 'react-native';

import type { Vehicle } from '@/domain/types';
import { useI18n } from '@/i18n';
import { vehicleLabel, vehicleSpec } from '@/lib/vehicle';
import { colors, radius, space } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

/** The selected-vehicle card: the anchor of the whole shopping experience. */
export function VehicleCard({ vehicle }: { vehicle: Vehicle | undefined }) {
  const { s, lang } = useI18n();
  if (!vehicle) {
    return (
      <Pressable
        onPress={() => router.push('/garage/add')}
        haptics="impact"
        accessibilityLabel={s.home.addVehicle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.accent }}
      >
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={24} color="textOnAccent" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline" color="textOnAccent">
            {s.home.addVehicle}
          </Text>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {s.home.addVehicleHint}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color="textOnAccent" />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={() => router.push('/vehicle-switcher')}
      haptics="tap"
      accessibilityLabel={`${s.home.yourVehicle}: ${vehicleLabel(vehicle, lang)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.inverse, overflow: 'hidden' }}
    >
      <View style={{ position: 'absolute', end: -30, top: -30, width: 120, height: 120, borderRadius: 60, borderWidth: 18, borderColor: colors.inverseMuted }} />
      <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="truck" size={22} color="textOnAccent" />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="micro" style={{ color: colors.textInverseTertiary }}>
          {s.home.yourVehicle}
        </Text>
        <Text variant="headline" color="textInverse" numberOfLines={1}>
          {vehicleLabel(vehicle, lang)}
        </Text>
        <Text variant="caption" style={{ color: colors.textInverseSecondary }} numberOfLines={1}>
          {vehicleSpec(vehicle)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, height: 32, borderRadius: radius.pill, backgroundColor: colors.inverseMuted }}>
        <Text variant="captionStrong" color="textInverse">
          {s.home.change}
        </Text>
        <Icon name="chevron-down" size={14} color="textInverse" />
      </View>
    </Pressable>
  );
}
