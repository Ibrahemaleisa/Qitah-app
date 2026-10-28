import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Share, View } from 'react-native';

import { getProduct } from '@/data/catalog';
import { getOffer } from '@/data/offers';
import { getFitStatus } from '@/domain/compatibility';
import ar from '@/i18n/ar';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { vehicleLabel } from '@/lib/vehicle';
import { createReview, requiresSignIn, shareMessage } from '@/services/mechanic';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

const FIT_TONE = { catalogMatch: 'success', sellerReported: 'warning', bySpecification: 'info', noData: 'neutral', noVehicle: 'neutral' } as const;
const FIT_KEY = { catalogMatch: 'catalog', sellerReported: 'seller', bySpecification: 'universal', noData: 'unverified', noVehicle: 'no_vehicle' } as const;

/** "أرسل لميكانيكي": pick what to send (one offer from a product page, or the whole cart), add a note, share. */
export default function SendToMechanic() {
  const { offerId } = useLocalSearchParams<{ offerId?: string }>();
  const { s, tx, lang } = useI18n();
  const cart = useAppStore((st) => st.cart);
  const user = useAppStore((st) => st.user);
  const vehicle = useSelectedVehicle();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = useMemo(() => (offerId ? [{ offerId, qty: 1 }] : cart.map((l) => ({ offerId: l.offerId, qty: l.qty }))), [offerId, cart]);
  const needsSignIn = requiresSignIn() && !user;

  const submit = async () => {
    if (!lines.length) return;
    setBusy(true);
    try {
      const review = await createReview({ lines, vehicle, note });
      haptic.success();
      toast(s.mechanic.created, 'check');
      // WhatsApp-friendly Arabic message: the mechanic reads Arabic whatever the app language is.
      if (review.url) await Share.share({ message: shareMessage(ar, review, review.url) }).catch(() => {});
      router.replace({ pathname: '/mechanic/[id]', params: { id: review.id } });
    } catch (e) {
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={<ScreenHeader back dismiss="close" inSheet title={s.mechanic.title} />}
        footer={
          <StickyFooter>
            {needsSignIn ? (
              <Button label={s.common.signIn} icon="user" onPress={() => router.push('/sign-in')} />
            ) : (
              <Button label={s.mechanic.create} icon="share" onPress={submit} disabled={!lines.length || busy} loading={busy} />
            )}
          </StickyFooter>
        }
      >
        <Text variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
          {s.mechanic.subtitle}
        </Text>
        {needsSignIn ? (
          <View style={{ marginTop: space.md }}>
            <Notice tone="info" icon="user" text={s.mechanic.signIn} />
          </View>
        ) : null}

        <Text variant="headline" style={{ marginTop: space.xl, marginBottom: space.sm }}>
          {s.mechanic.vehicle}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
          <Icon name="car" size={20} color="heading" />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {vehicle ? vehicleLabel(vehicle, lang) : s.mechanic.noVehicle}
          </Text>
          {vehicle?.vin ? <Badge label={s.garage.vinLabel} tone="info" icon="check" /> : null}
        </View>

        <Text variant="headline" style={{ marginTop: space.xl, marginBottom: space.sm }}>
          {s.mechanic.parts}
        </Text>
        <View style={{ borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
          {lines.map((l, i) => {
            const offer = getOffer(l.offerId);
            const product = offer ? getProduct(offer.productId) : undefined;
            if (!offer || !product) return null;
            const fit = getFitStatus(product, vehicle);
            return (
              <View key={l.offerId} style={{ padding: space.lg, gap: 4, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
                <Text variant="callout" weight="semibold">
                  {tx(product.name)} <Text variant="caption" color="textSecondary">× {l.qty}</Text>
                </Text>
                <Text variant="caption" color="textSecondary" mono>
                  {product.brand} · {product.partNumber}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Badge label={s.condition[offer.condition]} />
                  <Badge label={s.mechanic.fit[FIT_KEY[fit]]} tone={FIT_TONE[fit]} />
                </View>
              </View>
            );
          })}
        </View>

        <View style={{ marginTop: space.xl, gap: space.md }}>
          <Input label={s.mechanic.note} value={note} onChangeText={setNote} placeholder={s.mechanic.notePlaceholder} maxLength={500} multiline />
          <Notice tone="info" icon="lock" text={s.mechanic.privacy} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
