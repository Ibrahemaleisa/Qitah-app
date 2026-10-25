import { router } from 'expo-router';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { VehicleRow } from '@/features/VehicleRow';
import { useI18n } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { useAppStore } from '@/store/app-store';
import { enterUp, layoutMove } from '@/theme/motion';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';

export default function Garage() {
  const { s } = useI18n();
  const vehicles = useAppStore((st) => st.vehicles);
  const selectedId = useAppStore((st) => st.selectedVehicleId);
  const selectVehicle = useAppStore((st) => st.selectVehicle);
  const removeVehicle = useAppStore((st) => st.removeVehicle);

  return (
    <Screen
      header={<ScreenHeader back title={s.garage.title} />}
      footer={
        vehicles.length ? (
          <StickyFooter>
            <Button label={s.garage.add} icon="plus" variant="dark" onPress={() => router.push('/garage/add')} />
          </StickyFooter>
        ) : undefined
      }
    >
      <Text variant="callout" color="textSecondary" style={{ marginBottom: space.lg }}>
        {s.garage.subtitle}
      </Text>
      {vehicles.length === 0 ? (
        <EmptyState icon="car" title={s.garage.empty} body={s.garage.emptyHint} action={{ label: s.garage.add, onPress: () => router.push('/garage/add') }} />
      ) : (
        <View style={{ gap: space.md }}>
          {vehicles.map((v, i) => (
            <Animated.View key={v.id} entering={enterUp(i)} layout={layoutMove}>
              <VehicleRow
                vehicle={v}
                selected={v.id === selectedId}
                onSelect={() => selectVehicle(v.id)}
                onRemove={() => confirmAction(s.garage.removeConfirm, s.common.remove, s.common.cancel, () => removeVehicle(v.id))}
              />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}
