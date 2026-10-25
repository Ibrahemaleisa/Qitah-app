import { router } from 'expo-router';
import { View } from 'react-native';

import { LogoSymbol } from '@/brand/Logo';
import type { Vehicle } from '@/domain/types';
import { useI18n } from '@/i18n';
import { vehicleLabel, vehicleSpec } from '@/lib/vehicle';
import { colors, radius, space } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

/** The selected-vehicle bar (guidelines p.21: blue bar, car icon, "change"). */
export function VehicleCard({ vehicle }: { vehicle: Vehicle | undefined }) {
  const { s, lang } = useI18n();
  if (!vehicle) {
    // Empty state mirrors the "needs confirmation" indicator: dashed outline, car without its piece.
    return (
      <Pressable
        onPress={() => router.push('/garage/add')}
        haptics="impact"
        accessibilityLabel={s.home.addVehicle}
        accessibilityHint={s.home.addVehicleHint}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary }}
      >
        <LogoSymbol width={52} tone="pending" />
        <View style={{ flex: 1 }}>
          <Text variant="headline" color="heading">
            {s.home.addVehicle}
          </Text>
          <Text variant="caption" color="textSecondary">
            {s.home.addVehicleHint}
          </Text>
        </View>
        <Icon name="plus" size={22} color="heading" />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={() => router.push('/vehicle-switcher')}
      haptics="tap"
      accessibilityLabel={`${s.home.yourVehicle}: ${vehicleLabel(vehicle, lang)}, ${vehicleSpec(vehicle)}`}
      accessibilityHint={s.home.change}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.inverse }}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.inverseMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="car" size={22} color="textInverse" />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="micro" color="textInverseTertiary">
          {s.home.yourVehicle}
        </Text>
        <Text variant="headline" color="textInverse" numberOfLines={1}>
          {vehicleLabel(vehicle, lang)}
        </Text>
        <Text variant="caption" color="textInverseSecondary" numberOfLines={1} ltr>
          {vehicleSpec(vehicle)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.inverseBorder }}>
        <Text variant="captionStrong" color="textInverse">
          {s.home.change}
        </Text>
        <Icon name="chevron-down" size={14} color="textInverse" />
      </View>
    </Pressable>
  );
}
