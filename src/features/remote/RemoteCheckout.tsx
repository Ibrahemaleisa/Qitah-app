import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { toApiError } from '@/api/client';
import { checkoutApi } from '@/api/endpoints';
import { halalasToSar } from '@/api/money';
import type { PlanOption, PlanResponse, RemotePaymentMethod, Strategy } from '@/api/types';
import { getProduct } from '@/data/catalog';
import { getOffer } from '@/data/offers';
import { cityLabel } from '@/data/sellers';
import type { DeliveryDestination } from '@/domain/types';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { makeId } from '@/lib/id';
import { vehicleLabel } from '@/lib/vehicle';
import { paymentMethods } from '@/services/payments/mock';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Segmented } from '@/ui/Segmented';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

import { closePaymentTab, openPaymentPage, preopenPaymentTab } from './paymentWindow';
import { refreshCartOffers } from './useLiveCart';

/** Checkout errors that mean "the plan is stale": re-plan and explain, never fail silently. */
export const REPLAN_CODES = ['PLAN_EXPIRED', 'PRICE_CHANGED', 'OFFER_UNAVAILABLE', 'INSUFFICIENT_STOCK', 'PLAN_USED'] as const;
type ReplanCode = (typeof REPLAN_CODES)[number];

const REMOTE_METHODS: RemotePaymentMethod[] = ['applePay', 'mada', 'card', 'stcPay'];
const methodIcons: Record<RemotePaymentMethod, IconName> = { applePay: 'smartphone', mada: 'credit-card', card: 'credit-card', stcPay: 'smartphone' };
const STRATEGY_ORDER: Strategy[] = ['selected', 'lowest_total', 'fastest', 'fewest_shipments'];

type PlanState = { status: 'idle' | 'loading' | 'ready' | 'error'; data?: PlanResponse; error?: string };

/**
 * Remote checkout ("smart cart"): the server plans up to four ways to fulfil the cart
 * (as chosen / lowest total / fastest / fewest shipments) from live offers and carrier quotes.
 * Every amount shown here is the server's (integer halalas, converted once for display).
 */
export function RemoteCheckout() {
  const { s, tx, money, lang } = useI18n();
  const cart = useAppStore((st) => st.cart);
  const user = useAppStore((st) => st.user);
  const addresses = useAppStore((st) => st.addresses);
  const removeFromCart = useAppStore((st) => st.removeFromCart);
  const vehicle = useSelectedVehicle();

  const [destination, setDestination] = useState<DeliveryDestination>(addresses[0]?.kind ?? 'home');
  const candidates = addresses.filter((a) => a.kind === destination);
  const [addressId, setAddressId] = useState<string | undefined>(candidates[0]?.id);
  const address = candidates.find((a) => a.id === addressId) ?? candidates[0];
  const [plan, setPlan] = useState<PlanState>({ status: 'idle' });
  const [strategy, setStrategy] = useState<Strategy>('selected');
  const [method, setMethod] = useState<RemotePaymentMethod>(Platform.OS === 'ios' ? 'applePay' : 'mada');
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<string>();
  const requestSeq = useRef(0);
  /** Stable idempotency key per checkout attempt (per plan), reused on retries of that attempt. */
  const attempt = useRef<{ planId: string; key: string } | null>(null);

  const cartKey = cart.map((l) => `${l.offerId}:${l.qty}`).join(',');

  const replan = useCallback(async () => {
    if (!user || !address) return;
    const seq = ++requestSeq.current;
    setPlan((p) => ({ status: 'loading', data: p.data }));
    try {
      // Live price/stock first, so the plan request uses what can actually be bought.
      await refreshCartOffers().catch(() => ({}));
      const lines = useAppStore
        .getState()
        .cart.filter((l) => {
          const o = getOffer(l.offerId);
          return o && !o.unavailable && o.stock > 0;
        })
        .map((l) => ({ offerId: l.offerId, quantity: Math.min(l.qty, 20) }));
      if (!lines.length) {
        if (seq === requestSeq.current) setPlan({ status: 'error', error: s.remote.fixCartFirst });
        return;
      }
      const data = await checkoutApi.plan(address.id, lines);
      if (seq !== requestSeq.current) return;
      setPlan({ status: 'ready', data });
      attempt.current = null;
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setPlan({ status: 'error', error: apiErrorMessage(s, e) });
    }
    // cartKey re-plans when quantities change; address.id when the destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, address?.id, cartKey, s]);

  useEffect(() => {
    // Small debounce: quantity taps in quick succession produce one plan request.
    const t = setTimeout(replan, 150);
    return () => clearTimeout(t);
  }, [replan]);

  const options = useMemo(() => {
    const list = plan.data?.options ?? [];
    return [...list].sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
  }, [plan.data]);
  const selectedOption = options.find((o) => o.strategy === strategy || o.bestFor.includes(strategy)) ?? options[0];
  const baseline = options.find((o) => o.strategy === 'selected') ?? options[0];

  const blockers: ('emptyCart' | 'signIn' | 'address')[] = [];
  if (cart.length === 0) blockers.push('emptyCart');
  if (!user) blockers.push('signIn');
  if (!address) blockers.push('address');
  const canPlace = blockers.length === 0 && !!selectedOption && plan.status === 'ready' && !placing;

  const sellerName = (offerId: string, group?: { merchantNameAr: string; merchantNameEn: string }) =>
    group ? tx({ ar: group.merchantNameAr, en: group.merchantNameEn || group.merchantNameAr }) : (getOffer(offerId)?.sellerId ?? '');
  const productName = (productId?: string, ar?: string, en?: string) => (ar ? tx({ ar, en: en || ar }) : productId ? (getProduct(productId) ? tx(getProduct(productId)!.name) : productId) : '');

  const submit = async () => {
    if (!canPlace || !selectedOption) return;
    if (!attempt.current || attempt.current.planId !== selectedOption.planId) {
      attempt.current = { planId: selectedOption.planId, key: makeId('chk') };
    }
    const current = attempt.current;
    // Web: open the tab inside the tap so the browser doesn't block it; it's pointed at the
    // provider page once the order exists.
    const tab = preopenPaymentTab();
    setPlacing(true);
    setNotice(undefined);
    try {
      const res = await checkoutApi.place({
        planId: current.planId,
        idempotencyKey: current.key,
        paymentMethod: method,
        vehicle: vehicle ? { label: vehicleLabel(vehicle, lang), modelId: vehicle.modelId, year: vehicle.year } : undefined,
      });
      let opened = true;
      if (res.payment?.redirectUrl && Platform.OS === 'web') opened = await openPaymentPage(res.payment.redirectUrl, tab);
      else closePaymentTab(tab);
      haptic.success();
      router.replace({ pathname: '/checkout/payment', params: { orderId: res.orderId, method, open: Platform.OS === 'web' ? '0' : '1', blocked: opened ? '0' : '1' } });
    } catch (e) {
      closePaymentTab(tab);
      setPlacing(false);
      const err = toApiError(e);
      haptic.warning();
      if ((REPLAN_CODES as readonly string[]).includes(String(err.code))) {
        attempt.current = null;
        setNotice(s.remote.replanned[err.code as ReplanCode]);
        replan();
        return;
      }
      // Network/timeouts: the same idempotency key is reused on the next tap, so a request that
      // actually reached the server can't create a second order.
      toast(apiErrorMessage(s, err), 'alert-circle');
    }
  };

  if (cart.length === 0 && !placing) {
    return (
      <Screen header={<ScreenHeader back title={s.checkout.title} />}>
        <EmptyState icon="shopping-bag" title={s.cart.empty} action={{ label: s.cart.browse, onPress: () => router.replace('/search') }} />
      </Screen>
    );
  }

  const fixBlocker = (b: 'signIn' | 'address') => {
    if (b === 'signIn') router.push('/sign-in');
    else router.push({ pathname: '/address/edit', params: { kind: destination } });
  };
  const methodName = tx(paymentMethods.find((m) => m.id === method)?.name ?? { ar: method, en: method });
  const total = selectedOption ? halalasToSar(selectedOption.totalHalalas) : undefined;
  const unavailable = plan.data?.unavailable ?? [];

  return (
    <Screen
      header={<ScreenHeader back title={s.checkout.title} subtitle={s.common.items(cart.reduce((a, l) => a + l.qty, 0))} />}
      footer={
        <StickyFooter>
          {blockers.length && !placing ? (
            <View accessibilityRole="summary" style={{ gap: space.xs }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.checkout.blockersTitle}
              </Text>
              {blockers.map((b) => (
                <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Icon name="alert-circle" size={14} color="warning" />
                  <Text variant="caption" style={{ flex: 1 }}>
                    {s.checkout.blockers[b]}
                  </Text>
                  {b !== 'emptyCart' ? <Button label={s.checkout.fixes[b]} variant="secondary" size="sm" onPress={() => fixBlocker(b)} /> : null}
                </View>
              ))}
            </View>
          ) : null}
          <Button
            label={placing ? s.remote.placing : s.checkout.payWith(methodName)}
            trailing={placing || total === undefined ? undefined : money(total)}
            loading={placing}
            disabled={!canPlace}
            onPress={submit}
          />
        </StickyFooter>
      }
    >
      <Notice tone="sample" icon="shield" text={s.remote.sandboxPayment} />

      <Section step={1} title={s.checkout.deliverTo}>
        <Segmented
          value={destination}
          onChange={(d) => {
            setDestination(d);
            setAddressId(addresses.find((a) => a.kind === d)?.id);
          }}
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
              subtitle={`${tx(cityLabel(a.city))} · ${a.district} · ${a.street}`}
            />
          ))}
          {candidates.length === 0 ? <Notice tone="warning" text={s.checkout.noAddress(destination === 'home' ? s.checkout.home : s.checkout.workshop)} /> : null}
          <Button label={s.checkout.addAddress} icon="plus" variant="secondary" size="md" onPress={() => router.push({ pathname: '/address/edit', params: { kind: destination } })} />
        </View>
      </Section>

      <Section step={2} title={s.remote.planTitle} subtitle={options.length > 1 ? s.remote.planHint : undefined}>
        {notice ? (
          <View style={{ marginBottom: space.md }}>
            <Notice tone="warning" icon="refresh-ccw" text={notice} />
          </View>
        ) : null}
        {!user || !address ? null : plan.status === 'loading' && !plan.data ? (
          <View style={{ gap: space.sm }} accessibilityLabel={s.remote.planning}>
            <Skeleton width="100%" height={96} rounded={radius.md} />
            <Skeleton width="100%" height={96} rounded={radius.md} />
            <Text variant="caption" color="textTertiary">
              {s.remote.planning}
            </Text>
          </View>
        ) : plan.status === 'error' ? (
          <View style={{ gap: space.sm }}>
            <Notice tone="danger" text={`${s.remote.planFailed}. ${plan.error ?? ''}`} />
            <Button label={s.common.retry} icon="refresh-ccw" variant="secondary" size="md" onPress={replan} />
          </View>
        ) : unavailable.length ? (
          <View style={{ gap: space.sm }}>
            <Notice tone="danger" text={s.remote.unavailableLines} />
            {unavailable.map((offerId) => {
              const o = getOffer(offerId);
              const p = o ? getProduct(o.productId) : undefined;
              return (
                <Text key={offerId} variant="callout" weight="semibold">
                  • {p ? tx(p.name) : offerId}
                </Text>
              );
            })}
            <Button
              label={s.remote.removeUnavailable}
              icon="trash-2"
              variant="secondary"
              size="md"
              onPress={() => unavailable.forEach((id) => removeFromCart(id))}
            />
          </View>
        ) : (
          <View style={{ gap: space.sm, opacity: plan.status === 'loading' ? 0.6 : 1 }}>
            {options.map((o) => (
              <OptionCard
                key={o.planId}
                option={o}
                baseline={baseline}
                selected={selectedOption?.planId === o.planId}
                onPress={() => setStrategy(o.strategy)}
                productName={productName}
                sellerName={sellerName}
              />
            ))}
            {selectedOption?.sandboxRates ? <Notice tone="sample" icon="truck" text={s.remote.sandboxRates} /> : null}
            {selectedOption ? (
              <Text variant="caption" color="textTertiary">
                {s.remote.pricesHeld}
              </Text>
            ) : null}
          </View>
        )}
      </Section>

      {selectedOption ? (
        <Section title={s.remote.breakdown}>
          <View style={{ gap: space.md }}>
            {selectedOption.groups.map((g, gi) => (
              <View key={`${g.merchantId}-${gi}`} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Badge label={s.checkout.shipmentN(gi + 1)} tone="inverse" />
                  <Text variant="callout" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
                    {sellerName('', g)}
                  </Text>
                  <Text variant="callout" weight="semibold" tabular>
                    {money(halalasToSar(g.shippingHalalas))}
                  </Text>
                </View>
                <Text variant="caption" color="textSecondary">
                  {[s.remote.shipmentFrom(tx(cityLabel(g.originCity))), (s.remote.services as Record<string, string>)[g.serviceCode] ?? g.serviceCode, s.common.deliveryIn(g.etaDaysMin, g.etaDaysMax)].join(' · ')}
                </Text>
                {g.lines.map((l) => (
                  <View key={l.offerId} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                    <Text variant="caption" style={{ flex: 1 }} numberOfLines={2}>
                      {productName(l.productId, l.productNameAr, l.productNameEn)}
                    </Text>
                    <Text variant="caption" color="textSecondary" tabular>
                      {`${l.quantity} × ${money(halalasToSar(l.unitPriceHalalas))}`}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section step={3} title={s.checkout.payment}>
        <View style={{ gap: space.sm }}>
          {REMOTE_METHODS.map((id) => {
            const m = paymentMethods.find((x) => x.id === id)!;
            return (
              <ChoiceRow
                key={id}
                selected={method === id}
                onPress={() => setMethod(id)}
                title={tx(m.name)}
                subtitle={tx(m.description)}
                leading={
                  <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={methodIcons[id]} size={17} />
                  </View>
                }
                trailing={<Badge label={s.remote.liveBadge} tone="info" />}
              />
            );
          })}
        </View>
      </Section>

      {selectedOption ? (
        <Section step={4} title={s.checkout.summary}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
            <SummaryRow label={s.checkout.items} value={money(halalasToSar(selectedOption.itemsHalalas))} />
            <SummaryRow label={s.checkout.shippingFees} value={money(halalasToSar(selectedOption.shippingHalalas))} />
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: space.xs }} />
            <SummaryRow label={s.checkout.total} value={money(halalasToSar(selectedOption.totalHalalas))} strong />
            <Text variant="caption" color="textTertiary">
              {s.checkout.vat(money(halalasToSar(selectedOption.vatHalalas)))}
            </Text>
            {vehicle ? (
              <Text variant="caption" color="textSecondary">
                {s.checkout.vehicleNote(vehicleLabel(vehicle, lang))}
              </Text>
            ) : null}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

function OptionCard({
  option,
  baseline,
  selected,
  onPress,
  productName,
  sellerName,
}: {
  option: PlanOption;
  baseline: PlanOption | undefined;
  selected: boolean;
  onPress: () => void;
  productName: (productId?: string, ar?: string, en?: string) => string;
  sellerName: (offerId: string, group?: { merchantNameAr: string; merchantNameEn: string }) => string;
}) {
  const { s, money } = useI18n();
  const labels = [...new Set([option.strategy, ...option.bestFor])].sort((a, b) => STRATEGY_ORDER.indexOf(a) - STRATEGY_ORDER.indexOf(b));
  const diff = baseline && option.planId !== baseline.planId ? option.totalHalalas - baseline.totalHalalas : 0;
  const switched = option.groups.flatMap((g) => g.lines.filter((l) => l.originalOfferId !== l.offerId).map((l) => ({ l, g })));
  const title = labels.map((k) => s.remote.strategies[k]).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      pressScale={0.985}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${money(halalasToSar(option.totalHalalas))}`}
      style={{ padding: space.lg, borderRadius: radius.md, borderWidth: selected ? 1.5 : 1, borderColor: selected ? colors.primary : colors.line, backgroundColor: colors.surface, gap: space.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: selected ? 0 : 1.5, borderColor: colors.lineStrong, backgroundColor: selected ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surface }} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="textSecondary">
            {s.remote.strategyHints[labels[0]]}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="bodyStrong" tabular>
            {money(halalasToSar(option.totalHalalas))}
          </Text>
          {diff !== 0 ? (
            <Text variant="micro" color={diff < 0 ? 'success' : 'textTertiary'}>
              {diff < 0 ? s.remote.cheaperBy(money(halalasToSar(-diff))) : s.remote.costlierBy(money(halalasToSar(diff)))}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Badge label={s.success.shipments(option.shipmentCount)} icon="package" />
        <Badge label={s.remote.arrivesWithin(option.etaDaysMax)} icon="truck" tone="info" />
        {switched.length ? <Badge label={s.remote.switches(switched.length)} icon="refresh-ccw" tone="warning" /> : null}
      </View>
      {switched.map(({ l, g }) => (
        <Text key={l.offerId} variant="caption" color="textSecondary" numberOfLines={2}>
          {s.remote.switchLine(productName(l.productId, l.productNameAr, l.productNameEn), sellerName(l.offerId, g))}
        </Text>
      ))}
    </Pressable>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={strong ? 'headline' : 'callout'} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'headline' : 'callout'} weight={strong ? 'bold' : 'semibold'} color={strong ? 'heading' : 'text'} tabular>
        {value}
      </Text>
    </View>
  );
}
