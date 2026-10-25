import { router } from 'expo-router';
import { View } from 'react-native';

import type { FitStatus } from '@/domain/compatibility';
import type { Product, Vehicle } from '@/domain/types';
import { useI18n } from '@/i18n';
import { vehicleLabel } from '@/lib/vehicle';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';

import { FitMarker, fitVisuals } from './badges';

/**
 * Compatibility indicator (guidelines p.31). Fits → solid card with the full symbol;
 * needs confirmation → dashed card with the car alone; by specification / no vehicle → tinted card.
 */
export function FitPanel({ product, vehicle, status }: { product: Product; vehicle: Vehicle | undefined; status: FitStatus }) {
  const { s, tx, lang } = useI18n();
  const v = fitVisuals[status];
  const pending = status === 'sellerReported' || status === 'noData';
  const tinted = status === 'bySpecification' || status === 'noVehicle';
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
    <View
      accessible={false}
      style={{
        backgroundColor: tinted ? colors.surfaceSunken : colors.surface,
        borderRadius: radius.lg,
        borderWidth: tinted ? 0 : status === 'catalogMatch' ? 1.5 : 1,
        borderStyle: pending ? 'dashed' : 'solid',
        borderColor: status === 'catalogMatch' ? colors.primary : colors.lineStrong,
        padding: space.lg,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <FitMarker status={status} size={44} />
        <View style={{ flex: 1 }}>
          <Text variant="headline" color={v.color === 'heading' ? 'heading' : 'text'} accessibilityRole="header">
            {s.fit[status]}
          </Text>
          {vehicle && status !== 'bySpecification' ? (
            <Text variant="caption" color="textSecondary">
              {vehicleLabel(vehicle, lang)} · <Text variant="caption" color="textSecondary" ltr>{vehicle.engine}</Text>
            </Text>
          ) : null}
        </View>
      </View>
      {detail ? (
        <Text variant="caption" color="textSecondary">
          {detail}
        </Text>
      ) : null}
      {status === 'noVehicle' ? <Button label={s.home.addVehicle} variant="secondary" size="sm" icon="plus" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/garage/add')} /> : null}
      {vehicle && status !== 'bySpecification' ? <Button label={s.home.change} variant="ghost" size="sm" icon="car" style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} onPress={() => router.push('/vehicle-switcher')} /> : null}
    </View>
  );
}
