import { router } from 'expo-router';
import { View } from 'react-native';

import type { FitStatus } from '@/domain/compatibility';
import type { Product, Vehicle } from '@/domain/types';
import { useI18n } from '@/i18n';
import { vehicleLabel } from '@/lib/vehicle';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';

import { fitVisuals } from './badges';

const toneColors = {
  success: { bg: colors.successSoft, fg: 'success' },
  warning: { bg: colors.warningSoft, fg: 'warning' },
  info: { bg: colors.infoSoft, fg: 'info' },
  neutral: { bg: colors.surfaceSunken, fg: 'textSecondary' },
} as const;

/** Prominent, honest compatibility statement for the selected vehicle. */
export function FitPanel({ product, vehicle, status }: { product: Product; vehicle: Vehicle | undefined; status: FitStatus }) {
  const { s, tx, lang } = useI18n();
  const v = fitVisuals[status];
  const tone = toneColors[(v.tone in toneColors ? v.tone : 'neutral') as keyof typeof toneColors];
  const detail =
    status === 'catalogMatch'
      ? s.fit.catalogMatchDetail
      : status === 'sellerReported'
        ? s.fit.sellerReportedDetail
        : status === 'bySpecification'
          ? product.universal
            ? tx(product.universal.note)
            : ''
          : status === 'noData'
            ? s.fit.noDataDetail
            : s.fit.noVehicleDetail;
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: radius.lg, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={v.icon} size={20} color={tone.fg} />
        <Text variant="headline" color={tone.fg} style={{ flex: 1 }}>
          {s.fit[status]}
        </Text>
      </View>
      {vehicle && status !== 'bySpecification' ? (
        <Text variant="callout" weight="semibold">
          {vehicleLabel(vehicle, lang)} · <Text variant="callout" ltr>{vehicle.engine}</Text>
        </Text>
      ) : null}
      <Text variant="caption" color="textSecondary">
        {detail}
      </Text>
      {status === 'noVehicle' ? <Button label={s.home.addVehicle} variant="dark" size="sm" icon="plus" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/garage/add')} /> : null}
      {vehicle && status !== 'bySpecification' ? <Button label={s.home.change} variant="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/vehicle-switcher')} /> : null}
    </View>
  );
}
