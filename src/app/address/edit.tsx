import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { cities, cityIds } from '@/data/sellers';
import type { CityId, DeliveryDestination } from '@/domain/types';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { saveAddress } from '@/services/remote/account';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

export default function EditAddress() {
  const params = useLocalSearchParams<{ id?: string; kind?: DeliveryDestination }>();
  const { s, tx } = useI18n();
  const user = useAppStore((st) => st.user);
  const existing = useAppStore((st) => st.addresses.find((a) => a.id === params.id));
  const [saving, setSaving] = useState(false);

  const [kind, setKind] = useState<DeliveryDestination>(existing?.kind ?? params.kind ?? 'home');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [workshopName, setWorkshopName] = useState(existing?.workshopName ?? '');
  const [city, setCity] = useState<CityId>(existing?.city ?? 'riyadh');
  const [district, setDistrict] = useState(existing?.district ?? '');
  const [street, setStreet] = useState(existing?.street ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [contactName, setContactName] = useState(existing?.contactName ?? user?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone?.replace('+966', '') ?? user?.phone?.replace('+966', '') ?? '');
  const [submitted, setSubmitted] = useState(false);

  const required = (v: string) => (submitted && !v.trim() ? s.addresses.required : undefined);
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneError = submitted && !/^5\d{8}$/.test(phoneDigits) ? s.auth.invalidPhone : undefined;

  const save = async () => {
    setSubmitted(true);
    const missing = !district.trim() || !street.trim() || !contactName.trim() || (kind === 'workshop' && !workshopName.trim()) || !/^5\d{8}$/.test(phoneDigits);
    if (missing) {
      haptic.warning();
      return;
    }
    setSaving(true);
    try {
      // Remote + signed in: saved to the account (POST/PUT /v1/me/addresses).
      await saveAddress({
      id: existing?.id,
      kind,
      label: label.trim() || (kind === 'home' ? s.checkout.home : workshopName.trim()),
      workshopName: kind === 'workshop' ? workshopName.trim() : undefined,
      city,
      district: district.trim(),
      street: street.trim(),
      details: details.trim() || undefined,
      contactName: contactName.trim(),
      phone: `+966${phoneDigits}`,
      });
    } catch (e) {
      setSaving(false);
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
      return;
    }
    setSaving(false);
    haptic.success();
    router.back();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={<ScreenHeader back dismiss="close" inSheet title={existing ? s.common.edit : s.addresses.add} />}
        footer={
          <StickyFooter>
            <Button label={s.common.save} onPress={save} loading={saving} />
          </StickyFooter>
        }
      >
        <View style={{ gap: space.lg, marginTop: space.md }}>
          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.addresses.kind}
            </Text>
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: 'home', label: s.checkout.home, icon: 'home' },
                { value: 'workshop', label: s.checkout.workshop, icon: 'tool' },
              ]}
            />
          </View>
          {kind === 'workshop' ? (
            <Input label={s.addresses.workshopName} placeholder={s.addresses.workshopPlaceholder} value={workshopName} onChangeText={setWorkshopName} error={required(workshopName)} />
          ) : (
            <Input label={`${s.addresses.label} (${s.common.optional})`} placeholder={s.addresses.labelPlaceholder} value={label} onChangeText={setLabel} />
          )}
          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.addresses.city}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {cityIds.map((c) => (
                <Chip key={c} label={tx(cities[c])} selected={city === c} onPress={() => setCity(c)} />
              ))}
            </View>
          </View>
          <Input label={s.addresses.district} placeholder={s.addresses.districtPlaceholder} value={district} onChangeText={setDistrict} error={required(district)} />
          <Input label={s.addresses.street} placeholder={s.addresses.streetPlaceholder} value={street} onChangeText={setStreet} error={required(street)} />
          <Input label={`${s.addresses.details} (${s.common.optional})`} placeholder={s.addresses.detailsPlaceholder} value={details} onChangeText={setDetails} />
          <Input label={s.addresses.contact} value={contactName} onChangeText={setContactName} error={required(contactName)} textContentType="name" />
          <Input label={s.addresses.phone} prefix="+966" placeholder={s.auth.phonePlaceholder} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={11} ltr error={phoneError} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
