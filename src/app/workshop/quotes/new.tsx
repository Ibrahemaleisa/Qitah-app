import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Share, View } from 'react-native';

import { halalasToSar, sarToHalalas } from '@/api/money';
import { getProduct } from '@/data/catalog';
import { cityLabel } from '@/data/sellers';
import { getOffer } from '@/data/offers';
import { normalizeSaudiMobile, quoteTotals, sarInputToHalalas } from '@/domain/workshop';
import { Row, WorkshopGate, workshopErrorMessage } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { createQuote, useActiveOrg } from '@/services/remote/workshop';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { EmptyState } from '@/ui/EmptyState';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

/**
 * Build a quote for the workshop's customer: parts from the cart (Qitah prices), labour and the workshop's fee as
 * separate lines, then share an Arabic WhatsApp-friendly link. The server prices the parts; this preview is indicative.
 */
export default function NewWorkshopQuote() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.newQuote}>
      <QuoteForm />
    </WorkshopGate>
  );
}

function QuoteForm() {
  const { s, tx, money } = useI18n();
  const active = useActiveOrg();
  const cart = useAppStore((st) => st.cart);
  const addresses = useAppStore((st) => st.addresses);
  const workshopAddresses = addresses.filter((a) => a.kind === 'workshop');
  const [addressId, setAddressId] = useState<string | undefined>(workshopAddresses[0]?.id);
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [vin, setVin] = useState('');
  const [labor, setLabor] = useState('');
  const [markup, setMarkup] = useState('');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = useMemo(
    () =>
      cart
        .map((l) => ({ l, offer: getOffer(l.offerId) }))
        .filter(({ offer }) => offer && !offer.unavailable)
        .map(({ l, offer }) => ({ offerId: l.offerId, quantity: Math.min(l.qty, 20), unitPriceHalalas: sarToHalalas(offer!.price), productId: offer!.productId })),
    [cart],
  );
  const laborH = sarInputToHalalas(labor);
  const markupH = sarInputToHalalas(markup);
  const yearN = year.trim() ? Number(year) : undefined;
  const yearOk = yearN === undefined || (Number.isInteger(yearN) && yearN >= 1980 && yearN <= 2035);
  const vinOk = !vin.trim() || /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim());
  const customerPhone = phone.trim() ? normalizeSaudiMobile(phone) : undefined;
  const phoneOk = customerPhone !== null;
  const totals = quoteTotals(lines, laborH ?? 0, markupH ?? 0);
  const address = workshopAddresses.find((a) => a.id === addressId) ?? workshopAddresses[0];
  const valid = !!active && lines.length > 0 && !!address && model.trim().length >= 2 && laborH !== null && markupH !== null && yearOk && vinOk && phoneOk;

  if (!active) {
    return (
      <Screen header={<ScreenHeader back title={s.workshop.newQuote} />}>
        <EmptyState icon="store" title={s.workshop.mode} body={s.workshop.retailHint} action={{ label: s.workshop.mode, onPress: () => router.replace('/workshop') }} />
      </Screen>
    );
  }

  const submit = async () => {
    if (!valid || !address) return;
    setBusy(true);
    try {
      const q = await createQuote(active.org.id, {
        addressId: address.id,
        vehicle: { model: model.trim(), ...(yearN ? { year: yearN } : {}), ...(plate.trim() ? { plate: plate.trim() } : {}), ...(vin.trim() ? { vin: vin.trim().toUpperCase() } : {}) },
        lines: lines.map((l) => ({ offerId: l.offerId, quantity: l.quantity })),
        laborHalalas: laborH ?? 0,
        markupHalalas: markupH ?? 0,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(customerPhone ? { customerPhone } : {}),
      });
      haptic.success();
      toast(s.workshop.quoteCreated, 'check');
      // Arabic share text from the server (the workshop's customer reads Arabic whatever the app language is).
      if (q.share) await Share.share({ message: q.share.text }).catch(() => {});
      router.replace({ pathname: '/workshop/quotes/[id]', params: { id: q.id } });
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
        header={<ScreenHeader back title={s.workshop.newQuote} subtitle={active.org.displayName} />}
        footer={
          <StickyFooter>
            <Button label={s.workshop.send} icon="share" trailing={money(halalasToSar(totals.totalHalalas))} onPress={submit} loading={busy} disabled={!valid || busy} />
          </StickyFooter>
        }
      >
        <Text variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
          {s.workshop.quoteIntro}
        </Text>

        <Section title={s.workshop.quoteParts}>
          {lines.length === 0 ? (
            <View style={{ gap: space.sm }}>
              <Notice tone="warning" text={s.workshop.quoteNoParts} />
              <Button label={s.cart.browse} variant="secondary" size="md" icon="search" onPress={() => router.navigate('/search')} />
            </View>
          ) : (
            <View style={{ borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
              {lines.map((l, i) => {
                const p = getProduct(l.productId);
                return (
                  <View key={l.offerId} style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
                    <Text variant="callout" style={{ flex: 1 }} numberOfLines={2}>
                      {p ? tx(p.name) : l.offerId} <Text variant="caption" color="textSecondary">× {l.quantity}</Text>
                    </Text>
                    <Text variant="callout" tabular>
                      {money(halalasToSar(l.unitPriceHalalas * l.quantity))}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Section>

        <Section title={s.mechanic.vehicle}>
          <View style={{ gap: space.md }}>
            <Input label={s.workshop.vehicleModel} value={model} onChangeText={setModel} maxLength={80} placeholder="كامري" />
            <Input label={s.workshop.vehicleYear} value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} ltr error={yearOk ? undefined : s.workshop.invalidAmount} />
            <Input label={s.workshop.plate} value={plate} onChangeText={setPlate} maxLength={20} />
            <Input label={s.workshop.vin} value={vin} onChangeText={setVin} maxLength={17} autoCapitalize="characters" ltr error={vinOk ? undefined : s.workshop.invalidAmount} />
          </View>
        </Section>

        <Section title={s.workshop.total}>
          <View style={{ gap: space.md }}>
            <Input label={s.workshop.labor} value={labor} onChangeText={setLabor} keyboardType="decimal-pad" ltr error={laborH === null ? s.workshop.invalidAmount : undefined} />
            <Input label={s.workshop.markup} hint={s.workshop.markupHint} value={markup} onChangeText={setMarkup} keyboardType="decimal-pad" ltr error={markupH === null ? s.workshop.invalidAmount : undefined} />
            <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
              <Row label={s.workshop.partsTotal} value={money(halalasToSar(totals.partsHalalas))} />
              <Row label={s.workshop.laborLine} value={money(halalasToSar(totals.laborHalalas))} />
              <Row label={s.workshop.markupLine} value={money(halalasToSar(totals.markupHalalas))} />
              <Row label={s.workshop.total} value={money(halalasToSar(totals.totalHalalas))} strong />
            </View>
            <Input label={s.workshop.quoteNote} value={note} onChangeText={setNote} maxLength={500} multiline />
            <Input label={s.workshop.customerPhone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} ltr placeholder="05XXXXXXXX" error={phoneOk ? undefined : s.workshop.invalidPhone} />
          </View>
        </Section>

        <Section title={s.workshop.deliverTo}>
          <View style={{ gap: space.sm }}>
            {workshopAddresses.map((a) => (
              <ChoiceRow key={a.id} selected={address?.id === a.id} onPress={() => setAddressId(a.id)} title={a.workshopName || a.label} subtitle={`${tx(cityLabel(a.city))} · ${a.district}`} />
            ))}
            {workshopAddresses.length === 0 ? <Notice tone="warning" text={s.workshop.noWorkshopAddress} /> : null}
            <Button label={s.workshop.addWorkshopAddress} icon="plus" variant="secondary" size="md" onPress={() => router.push({ pathname: '/address/edit', params: { kind: 'workshop', workshopName: active.org.displayName } })} />
          </View>
        </Section>
      </Screen>
    </KeyboardAvoidingView>
  );
}
