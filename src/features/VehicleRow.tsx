import { View } from 'react-native';

import type { Vehicle } from '@/domain/types';
import { useI18n } from '@/i18n';
import { formatVin, vehicleLabel, vehicleSpec } from '@/lib/vehicle';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/Icon';
import { IconButton } from '@/ui/IconButton';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

type Props = { vehicle: Vehicle; selected: boolean; onSelect: () => void; onRemove?: () => void };

export function VehicleRow({ vehicle, selected, onSelect, onRemove }: Props) {
  const { s, lang } = useI18n();
  return (
    <Pressable
      onPress={onSelect}
      haptics="tap"
      pressScale={0.985}
      accessibilityState={{ selected }}
      accessibilityLabel={vehicleLabel(vehicle, lang)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: selected ? 1.5 : 1, borderColor: selected ? colors.text : colors.line }}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: selected ? colors.primary : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="car" size={20} color={selected ? 'textOnAccent' : 'text'} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{vehicleLabel(vehicle, lang)}</Text>
        <Text variant="caption" color="textSecondary" ltr>
          {vehicleSpec(vehicle)}
        </Text>
        {vehicle.vin ? (
          <Text variant="micro" color="textTertiary">
            {s.garage.vinLabel}{' '}
            <Text variant="micro" color="textSecondary" mono numberOfLines={1}>
              {formatVin(vehicle.vin)}
            </Text>
          </Text>
        ) : null}
        {selected ? <Badge label={s.garage.selected} tone="info" icon="check" /> : null}
      </View>
      {onRemove ? <IconButton icon="trash-2" label={s.common.remove} tone="plain" iconColor="textTertiary" size={36} onPress={onRemove} /> : null}
    </Pressable>
  );
}
