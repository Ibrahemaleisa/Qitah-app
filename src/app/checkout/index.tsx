import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { cities } from '@/data/sellers';
import { groupCartBySeller, shippingFeeFor, vatIncluded } from '@/domain/pricing';
import type { DeliveryDestination, DeliveryOptionId, PaymentMethodId } from '@/domain/types';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { vehicleLabel } from '@/lib/vehicle';
import { createOrder } from '@/services/orders';
import { paymentMethods, paymentProviders } from '@/services/payments/mock';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';

const methodIcons: Record<PaymentMethodId, IconName> = {
  applePay: 'smartphone',
  mada: 'credit-card',
  card: 'credit-card',
  stcPay: 'smartphone',
  tabby: 'calendar',
  tamara: 'calendar',
};

export default function Checkout() {
  const { s, tx, money, lang } = useI18n();
  const cart = useAppStore((st) => st.cart);
  const user = useAppStore((st) => st.user);
  const addresses = useAppStore((st) => st.addresses);
  const placeOrder = useAppStore((st) => st.placeOrder);
  const vehicle = useSelectedVehicle();

  const [destination, setDestination] = useState<DeliveryDestination>('home');
  const candidates = addresses.filter((a) => a.kind === destination);
  const [addressId, setAddressId] = useState<string | undefined>(candidates[0]?.id);
  const address = candidates.find((a) => a.id === addressId) ?? candidates[0];
  const [shippingChoice, setShippingChoice] = useState<Record<string, DeliveryOptionId>>({});
  const [method, setMethod] = useState<PaymentMethodId>(Platform.OS === 'ios' ? 'applePay' : 'mada');
  const [processing, setProcessing] = useState(false);

  const groups = useMemo(() => groupCartBySeller(cart, destination, address?.city), [cart, destination, address?.city]);

  const shipmentFees = groups.map((g) => {
    const chosen = g.deliveryOptions.find((o) => o.id === shippingChoice[g.seller.id]) ?? g.deliveryOptions[0];
    return chosen ? shippingFeeFor(g, chosen) : 0;
  });
  const items = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const shipping = shipmentFees.reduce((a, b) => a + b, 0);
  const total = items + shipping;
  const blocked = groups.some((g) => g.deliveryOptions.length === 0);
  const eligibility = paymentProviders[method].checkEligibility(total);
  const canPlace = !!user && !!address && !blocked && eligibility.eligible && cart.length > 0 && !processing;

  if (cart.length === 0 && !processing) {
    return (
      <Screen header={<ScreenHeader back title={s.checkout.title} />}>
        <EmptyState icon="shopping-bag" title={s.cart.empty} action={{ label: s.cart.browse, onPress: () => router.replace('/search') }} />
      </Screen>
    );
  }

  const submit = async () => {
    if (!address || !canPlace) return;
    setProcessing(true);
    const reference = String(Date.now()).slice(-7);
    const result = await paymentProviders[method].authorize({ orderReference: reference, amount: total, currency: 'SAR' });
    if (result.status !== 'authorized') {
      setProcessing(false);
      haptic.warning();
      return;
    }
    const choice: Record<string, DeliveryOptionId> = {};
    groups.forEach((g) => {
      choice[g.seller.id] = (g.deliveryOptions.find((o) => o.id === shippingChoice[g.seller.id]) ?? g.deliveryOptions[0]).id;
    });
    const order = createOrder({ lines: cart, address, shippingChoice: choice, paymentMethodId: method, paymentReference: result.reference, vehicleLabel: vehicle ? vehicleLabel(vehicle, lang) : undefined });
    placeOrder(order);
    haptic.success();
    router.replace({ pathname: '/checkout/success', params: { orderId: order.id } });
  };

  const methodName = tx(paymentMethods.find((m) => m.id === method)?.name ?? { ar: '', en: '' });

  return (
    <Screen
      header={<ScreenHeader back title={s.checkout.title} subtitle={s.common.items(cart.reduce((a, l) => a + l.qty, 0))} />}
      footer={
        <StickyFooter>
          {!user ? <Button label={s.checkout.signInRequired} variant="dark" icon="user" onPress={() => router.push('/sign-in')} /> : null}
          <Button label={processing ? s.checkout.processing : s.checkout.payWith(methodName)} trailing={processing ? undefined : money(total)} loading={processing} disabled={!canPlace} onPress={submit} />
        </StickyFooter>
      }
    >
      <Notice tone="sample" icon="shield" text={s.checkout.simulatedPaymentNote} />

      <Section title={s.checkout.deliverTo}>
        <Segmented
          value={destination}
          onChange={setDestination}
          options={[
            { value: 'home', label: s.checkout.home, hint: s.checkout.homeHint, icon: 'home' },
            { value: 'workshop', label: s.checkout.workshop, hint: s.checkout.workshopHint, icon: 'tool' },
          ]}
        />
        <View style={{ marginTop: space.md, gap: space.sm }}>
          {candidates.map((a) => (
            <ChoiceRow
              key={a.id}
              selected={address?.id === a.id}
              onPress={() => setAddressId(a.id)}
              title={a.kind === 'workshop' && a.workshopName ? a.workshopName : a.label}
              subtitle={`${tx(cities[a.city])} · ${a.district} · ${a.street}`}
            />
          ))}
          {candidates.length === 0 ? <Notice tone="warning" text={s.checkout.noAddress(destination === 'home' ? s.checkout.home : s.checkout.workshop)} /> : null}
          <Button label={s.checkout.addAddress} icon="plus" variant="secondary" size="md" onPress={() => router.push({ pathname: '/address/edit', params: { kind: destination } })} />
        </View>
      </Section>

      <Section title={s.checkout.shipping}>
        <View style={{ gap: space.lg }}>
          {groups.map((g, gi) => {
            const chosenId = shippingChoice[g.seller.id] ?? g.deliveryOptions[0]?.id;
            return (
              <View key={g.seller.id} style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Badge label={s.checkout.shipmentN(gi + 1)} tone="inverse" />
                  <Text variant="callout" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
                    {tx(g.seller.name)}
                  </Text>
                  <Text variant="caption" color="textTertiary">
                    {s.common.items(g.lines.reduce((a, l) => a + l.line.qty, 0))}
                  </Text>
                </View>
                {g.deliveryOptions.length === 0 ? <Notice tone="danger" text={s.checkout.workshopUnsupported} /> : null}
                {g.deliveryOptions.map((o) => {
                  const fee = shippingFeeFor(g, o);
                  const dispatchMax = Math.max(...g.lines.map((l) => l.offer.dispatchDays[1]));
                  const dispatchMin = Math.min(...g.lines.map((l) => l.offer.dispatchDays[0]));
                  return (
                    <ChoiceRow
                      key={o.id}
                      selected={chosenId === o.id}
                      onPress={() => setShippingChoice((c) => ({ ...c, [g.seller.id]: o.id }))}
                      title={tx(o.name)}
                      subtitle={`${s.common.deliveryIn(dispatchMin + o.etaDays[0], dispatchMax + o.etaDays[1])} · ${tx(o.carrier)}`}
                      trailing={
                        <Text variant="bodyStrong" color={fee === 0 ? 'success' : 'text'}>
                          {fee === 0 ? s.product.freeShipping : money(fee)}
                        </Text>
                      }
                    />
                  );
                })}
              </View>
            );
          })}
        </View>
      </Section>

      <Section title={s.checkout.payment}>
        <View style={{ gap: space.sm }}>
          {paymentMethods.map((m) => {
            const elig = paymentProviders[m.id].checkEligibility(total);
            const subtitle = !elig.eligible ? tx(elig.reason) : m.kind === 'bnpl' ? s.checkout.bnplInstallment(money(Math.ceil((total / 4) * 100) / 100)) : tx(m.description);
            return (
              <ChoiceRow
                key={m.id}
                selected={method === m.id}
                disabled={!elig.eligible}
                onPress={() => setMethod(m.id)}
                title={tx(m.name)}
                subtitle={subtitle}
                leading={
                  <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={methodIcons[m.id]} size={17} />
                  </View>
                }
                trailing={<Badge label={s.common.simulated} tone="accent" />}
              />
            );
          })}
        </View>
      </Section>

      <Section title={s.checkout.summary}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
          <SummaryRow label={s.checkout.items} value={money(items)} />
          <SummaryRow label={s.checkout.shippingFees} value={shipping === 0 ? s.product.freeShipping : money(shipping)} />
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: space.xs }} />
          <SummaryRow label={s.checkout.total} value={money(total)} strong />
          <Text variant="caption" color="textTertiary">
            {s.checkout.vat(money(vatIncluded(total)))}
          </Text>
          {vehicle ? (
            <Text variant="caption" color="textSecondary">
              {s.checkout.vehicleNote(vehicleLabel(vehicle, lang))}
            </Text>
          ) : null}
        </View>
      </Section>
    </Screen>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={strong ? 'headline' : 'callout'} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'headline' : 'callout'} weight={strong ? 'bold' : 'semibold'}>
        {value}
      </Text>
    </View>
  );
}
