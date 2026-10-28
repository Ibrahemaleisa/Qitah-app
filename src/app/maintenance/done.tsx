import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { parseKm } from '@/lib/odometer';
import { markServiceDone, useMaintenance } from '@/services/maintenance';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

const WHEN = { today: 0, weekAgo: 7, monthAgo: 30, threeMonthsAgo: 91 } as const;
type When = keyof typeof WHEN;

/** "Mark as done": kilometres at the service, when, and the variant (e.g. synthetic vs conventional oil). */
export default function MarkServiceDone() {
  const params = useLocalSearchParams<{ vehicleId: string; serviceCode: string; orderItemId?: string }>();
  const { s, tx } = useI18n();
  const vehicle = useAppStore((st) => st.vehicles.find((v) => v.id === params.vehicleId));
  const { data } = useMaintenance(vehicle);
  const service = data?.services.find((x) => x.serviceCode === params.serviceCode);
  const [km, setKm] = useState(vehicle?.odometerKm != null ? String(vehicle.odometerKm) : '');
  const [kmError, setKmError] = useState<string>();
  const [when, setWhen] = useState<When>('today');
  const [variant, setVariant] = useState<string | undefined>(service?.variants[0]?.code);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!vehicle || !params.serviceCode) return;
    const doneAtKm = km.trim() ? parseKm(km) : undefined;
    if (km.trim() && doneAtKm === undefined) {
      setKmError(s.garage2.odometerInvalid);
      haptic.warning();
      return;
    }
    setSaving(true);
    try {
      await markServiceDone(vehicle, {
        serviceCode: params.serviceCode,
        ...(doneAtKm !== undefined ? { doneAtKm } : {}),
        doneAt: new Date(Date.now() - WHEN[when] * 86_400_000).toISOString(),
        ...(variant && service?.variants.length ? { variant } : {}),
        ...(params.orderItemId ? { orderItemId: params.orderItemId } : {}),
      });
      haptic.success();
      toast(s.maintenance.saved, 'check');
      router.back();
    } catch (e) {
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={<ScreenHeader back dismiss="close" inSheet title={s.maintenance.doneTitle(service ? tx(service.name) : '')} />}
        footer={
          <StickyFooter>
            <Button label={s.common.save} onPress={save} disabled={!vehicle || saving} loading={saving} />
          </StickyFooter>
        }
      >
        <View style={{ gap: space.lg, marginTop: space.md }}>
          <Input
            label={s.maintenance.doneKm}
            value={km}
            onChangeText={(v) => {
              setKm(v);
              setKmError(undefined);
            }}
            placeholder={s.garage2.odometerPlaceholder}
            keyboardType="number-pad"
            maxLength={9}
            ltr
            error={kmError}
            icon="trending-up"
          />
          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.maintenance.doneWhen}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {(Object.keys(WHEN) as When[]).map((w) => (
                <Chip key={w} label={s.maintenance.when[w]} selected={when === w} onPress={() => setWhen(w)} />
              ))}
            </View>
          </View>
          {service?.variants.length ? (
            <View style={{ gap: space.sm }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.maintenance.variant}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {service.variants.map((v) => (
                  <Chip key={v.code} label={tx(v.name)} selected={variant === v.code} onPress={() => setVariant(v.code)} />
                ))}
              </View>
            </View>
          ) : null}
          {data ? (
            <Text variant="caption" color="textTertiary">
              {tx(data.disclaimer)}
            </Text>
          ) : null}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
