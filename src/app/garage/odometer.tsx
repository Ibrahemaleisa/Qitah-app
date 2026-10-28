import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { parseKm } from '@/lib/odometer';
import { vehicleLabel } from '@/lib/vehicle';
import { updateOdometer } from '@/services/remote/account';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

export default function OdometerSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, lang } = useI18n();
  const vehicle = useAppStore((st) => st.vehicles.find((v) => v.id === id));
  const [value, setValue] = useState(vehicle?.odometerKm != null ? String(vehicle.odometerKm) : '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!vehicle) return;
    const km = parseKm(value);
    if (km === undefined) {
      setError(s.garage2.odometerInvalid);
      haptic.warning();
      return;
    }
    setSaving(true);
    try {
      await updateOdometer(vehicle.id, km);
      haptic.success();
      toast(s.garage2.odometerSaved, 'check');
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
        header={<ScreenHeader back dismiss="close" inSheet title={s.garage2.updateOdometer} />}
        footer={
          <StickyFooter>
            <Button label={s.common.save} onPress={save} disabled={!vehicle || saving} loading={saving} />
          </StickyFooter>
        }
      >
        <View style={{ gap: space.md, marginTop: space.md }}>
          {vehicle ? (
            <Text variant="callout" color="textSecondary">
              {vehicleLabel(vehicle, lang)}
            </Text>
          ) : null}
          <Input
            label={s.garage2.odometer}
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(undefined);
            }}
            placeholder={s.garage2.odometerPlaceholder}
            keyboardType="number-pad"
            maxLength={9}
            ltr
            autoFocus
            error={error}
            hint={s.garage2.odometerHint}
            icon="trending-up"
            onSubmitEditing={save}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
