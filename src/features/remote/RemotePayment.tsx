import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';

import { halalasToSar } from '@/api/money';
import type { RemotePaymentMethod } from '@/api/types';
import { LogoSymbol } from '@/brand/Logo';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { useNow } from '@/lib/use-now';
import { paymentMethods } from '@/services/payments/mock';
import { pushCart } from '@/services/remote/account';
import { isPaidStatus } from '@/services/remote/orderView';
import { fetchOrder, retryPayment, useRemoteOrders } from '@/services/remote/orders';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

import { closePaymentTab, openPaymentPage, preopenPaymentTab } from './paymentWindow';

const POLL_MS = 2000;
const METHODS: RemotePaymentMethod[] = ['applePay', 'mada', 'card', 'stcPay'];

/**
 * Waits for the SERVER to confirm payment. The client never marks an order paid: success is shown
 * only when `GET /v1/orders/:id` reports PAID (or later). While the order is PENDING_PAYMENT and the
 * last payment FAILED, the customer can retry before `paymentExpiresAt`.
 */
export function RemotePayment() {
  const params = useLocalSearchParams<{ orderId: string; method?: string; open?: string; blocked?: string }>();
  const orderId = params.orderId ?? '';
  const { s, tx, money, time } = useI18n();
  const order = useRemoteOrders((st) => st.byId[orderId]);
  const now = useNow(5_000);
  const [method, setMethod] = useState<RemotePaymentMethod>((params.method as RemotePaymentMethod) ?? 'mada');
  const [busy, setBusy] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(params.blocked === '1');
  const [loadError, setLoadError] = useState<string>();
  const openedOnce = useRef(false);
  const done = useRef(false);

  const status = order?.status;
  const paymentStatus = order?.payment?.status;
  const paid = !!status && isPaidStatus(status);
  const failed = status === 'PENDING_PAYMENT' && paymentStatus === 'FAILED';
  const expired = status === 'EXPIRED' || status === 'CANCELLED' || status === 'PAYMENT_FAILED' || (status === 'PENDING_PAYMENT' && !!order && new Date(order.paymentExpiresAt).getTime() < now);
  const waiting = !order || (status === 'PENDING_PAYMENT' && !failed && !expired);

  const refresh = useCallback(async () => {
    if (!orderId) return;
    try {
      await fetchOrder(orderId);
      setLoadError(undefined);
    } catch (e) {
      setLoadError(apiErrorMessage(s, e));
    }
  }, [orderId, s]);

  // Poll while we wait for the provider's webhook to reach the server.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    if (!waiting) return () => clearTimeout(first);
    const t = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => {
      clearTimeout(first);
      clearInterval(t);
      sub.remove();
    };
  }, [refresh, waiting]);

  // Native: open the provider page once the order is known (web opened it from the tap already).
  useEffect(() => {
    if (openedOnce.current || params.open !== '1' || !order?.payment?.redirectUrl || order.status !== 'PENDING_PAYMENT') return;
    openedOnce.current = true;
    openPaymentPage(order.payment.redirectUrl).then(() => refresh());
  }, [order, params.open, refresh]);

  // Server says paid → clear the cart and show the confirmation with the real order number.
  useEffect(() => {
    if (!paid || done.current || !order) return;
    done.current = true;
    useAppStore.getState().setCart([]);
    pushCart([]).catch(() => {});
    haptic.success();
    router.replace({ pathname: '/checkout/success', params: { orderId: order.id } });
  }, [paid, order]);

  const openAgain = async () => {
    if (!order?.payment?.redirectUrl) return;
    const ok = await openPaymentPage(order.payment.redirectUrl);
    setPopupBlocked(!ok);
    if (Platform.OS !== 'web') refresh();
  };

  const retry = async () => {
    const tab = preopenPaymentTab();
    setBusy(true);
    try {
      const p = await retryPayment(orderId, method);
      if (p.redirectUrl) setPopupBlocked(!(await openPaymentPage(p.redirectUrl, tab)));
      else closePaymentTab(tab);
      await refresh();
    } catch (e) {
      closePaymentTab(tab);
      toast(apiErrorMessage(s, e), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  const total = order ? halalasToSar(order.totals.totalHalalas) : undefined;

  return (
    <Screen
      header={<ScreenHeader back title={s.remote.paymentTitle} subtitle={order?.number} />}
      footer={
        <StickyFooter>
          {failed && !expired ? (
            <Button label={s.remote.retryPayment} icon="refresh-ccw" loading={busy} onPress={retry} trailing={total !== undefined ? money(total) : undefined} />
          ) : expired ? (
            <Button label={s.remote.backToCart} onPress={() => router.replace('/cart')} />
          ) : (
            <>
              {order?.payment?.redirectUrl ? <Button label={s.remote.openPaymentPage} icon="lock" variant={popupBlocked ? 'primary' : 'secondary'} onPress={openAgain} /> : null}
              <Button label={s.remote.checkAgain} variant="ghost" icon="refresh-ccw" onPress={refresh} />
            </>
          )}
        </StickyFooter>
      }
    >
      <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
        <LogoSymbol width={110} tone={failed || expired ? 'faint' : 'primary'} />
        {total !== undefined ? <Text variant="display" ltr>{money(total)}</Text> : null}
        <Text variant="title2" align="center" accessibilityLiveRegion="polite">
          {expired ? s.orders.status.expired : failed ? s.remote.paymentFailedTitle : paid ? s.remote.paidConfirmed : s.remote.waitingPayment}
        </Text>
        {waiting ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      {loadError ? <Notice tone="warning" text={loadError} /> : null}
      {waiting ? <Notice tone="info" icon="clock" text={s.remote.waitingPaymentHint} /> : null}
      {expired ? <Notice tone="danger" text={s.remote.paymentExpired} /> : null}
      {failed && !expired && order ? (
        <View style={{ gap: space.md }}>
          <Notice tone="danger" text={s.remote.paymentFailedBody(time(new Date(order.paymentExpiresAt).getTime()))} />
          <View style={{ gap: space.sm }}>
            {METHODS.map((id) => {
              const m = paymentMethods.find((x) => x.id === id)!;
              return <ChoiceRow key={id} selected={method === id} onPress={() => setMethod(id)} title={tx(m.name)} subtitle={tx(m.description)} />;
            })}
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
        <Text variant="caption" color="textSecondary">
          {s.remote.sandboxPayment}
        </Text>
      </View>
    </Screen>
  );
}
