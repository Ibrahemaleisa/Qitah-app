import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { cities, cityIds } from '@/data/sellers';
import type { CityId } from '@/domain/types';
import { normalizeSaudiMobile } from '@/domain/workshop';
import { WorkshopGate, workshopErrorMessage } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { applyForOrg } from '@/services/remote/workshop';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

/** Apply for a workshop account. The applicant becomes the OWNER; Qitah ops reviews the CR. */
export default function ApplyWorkshop() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.applyTitle}>
      <ApplyForm />
    </WorkshopGate>
  );
}

function ApplyForm() {
  const { s, tx } = useI18n();
  const user = useAppStore((st) => st.user);
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [crNumber, setCr] = useState('');
  const [vatNumber, setVat] = useState('');
  const [city, setCity] = useState<CityId>('riyadh');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const mobile = normalizeSaudiMobile(phone);
  const crOk = /^\d{10}$/.test(crNumber.trim());
  const vatOk = !vatNumber.trim() || /^3\d{13}3$/.test(vatNumber.trim());
  const valid = legalName.trim().length >= 2 && displayName.trim().length >= 2 && crOk && vatOk && district.trim().length >= 2 && address.trim().length >= 2 && !!mobile;
  const err = (bad: boolean, msg = s.addresses.required) => (touched && bad ? msg : undefined);

  const submit = async () => {
    setTouched(true);
    if (!valid || !mobile) return;
    setBusy(true);
    try {
      await applyForOrg({
        legalName: legalName.trim(),
        displayName: displayName.trim(),
        crNumber: crNumber.trim(),
        ...(vatNumber.trim() ? { vatNumber: vatNumber.trim() } : {}),
        city,
        district: district.trim(),
        address: address.trim(),
        contactPhone: mobile,
      });
      haptic.success();
      toast(s.workshop.submitted, 'check');
      router.back();
    } catch (e) {
      haptic.warning();
      toast(workshopErrorMessage(s, e), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={<ScreenHeader back title={s.workshop.applyTitle} />}
        footer={
          <StickyFooter>
            <Button label={s.workshop.submit} icon="check" onPress={submit} loading={busy} disabled={busy} />
          </StickyFooter>
        }
      >
        <Text variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
          {s.workshop.applyIntro}
        </Text>
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <Input label={s.workshop.displayName} value={displayName} onChangeText={setDisplayName} maxLength={80} error={err(displayName.trim().length < 2)} />
          <Input label={s.workshop.legalName} value={legalName} onChangeText={setLegalName} maxLength={120} error={err(legalName.trim().length < 2)} />
          <Input label={s.workshop.crNumber} hint={s.workshop.crHint} value={crNumber} onChangeText={setCr} keyboardType="number-pad" maxLength={10} ltr error={err(!crOk, s.workshop.crHint)} />
          <Input label={s.workshop.vatNumber} value={vatNumber} onChangeText={setVat} keyboardType="number-pad" maxLength={15} ltr error={err(!vatOk)} />
          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.workshop.city}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {cityIds.map((c) => (
                <Chip key={c} label={tx(cities[c])} selected={city === c} onPress={() => setCity(c)} />
              ))}
            </View>
          </View>
          <Input label={s.workshop.district} value={district} onChangeText={setDistrict} maxLength={80} error={err(district.trim().length < 2)} />
          <Input label={s.workshop.address} value={address} onChangeText={setAddress} maxLength={200} error={err(address.trim().length < 2)} />
          <Input label={s.workshop.contactPhone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} ltr placeholder="05XXXXXXXX" error={err(!mobile, s.workshop.invalidPhone)} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
