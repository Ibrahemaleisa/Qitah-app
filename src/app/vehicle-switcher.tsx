import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { VehicleRow } from '@/features/VehicleRow';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAppStore } from '@/store/app-store';
import { colors, gutter, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';

export default function VehicleSwitcher() {
  const { s, isRTL } = useI18n();
  const vehicles = useAppStore((st) => st.vehicles);
  const selectedId = useAppStore((st) => st.selectedVehicleId);
  const selectVehicle = useAppStore((st) => st.selectVehicle);
  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title2">{s.garage.title}</Text>
        <Button
          label={s.common.edit}
          variant="ghost"
          size="sm"
          onPress={() => {
            router.back();
            router.push('/garage');
          }}
        />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md, paddingBottom: space.xxl }}>
        {vehicles.map((v) => (
          <VehicleRow
            key={v.id}
            vehicle={v}
            selected={v.id === selectedId}
            onSelect={() => {
              selectVehicle(v.id);
              haptic.success();
              router.back();
            }}
          />
        ))}
        <Button
          label={s.garage.add}
          icon="plus"
          variant="secondary"
          onPress={() => {
            router.back();
            router.push('/garage/add');
          }}
        />
      </ScrollView>
    </View>
  );
}
