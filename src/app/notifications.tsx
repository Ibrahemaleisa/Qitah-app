import { router } from 'expo-router';
import { View } from 'react-native';

import { isRemote } from '@/config/env';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { meApi } from '@/api/endpoints';
import { fetchNotifications, useRemoteOrders } from '@/services/remote/orders';
import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
import { Skeleton } from '@/ui/Skeleton';

import { useI18n } from '@/i18n';
import { useAppStore, type NotificationPrefs } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { ListGroup } from '@/ui/ListRow';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';

export default function Notifications() {
  const { s } = useI18n();
  const prefs = useAppStore((st) => st.notificationPrefs);
  const setPref = useAppStore((st) => st.setNotificationPref);
  const rows: { key: keyof NotificationPrefs; title: string; hint: string }[] = [
    { key: 'orderUpdates', title: s.notifications.orderUpdates, hint: s.notifications.orderUpdatesHint },
    { key: 'priceDrops', title: s.notifications.priceDrops, hint: s.notifications.priceDropsHint },
    { key: 'offers', title: s.notifications.offers, hint: s.notifications.offersHint },
  ];
  return (
    <Screen header={<ScreenHeader back title={s.notifications.title} />}>
      {isRemote ? <RemoteInbox /> : null}
      <View style={{ marginTop: space.sm, gap: space.lg }}>
        <ListGroup>
          {rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" weight="medium">
                  {r.title}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {r.hint}
                </Text>
              </View>
              <Toggle value={prefs[r.key]} onChange={(v) => setPref(r.key, v)} label={r.title} />
            </View>
          ))}
        </ListGroup>
        {isRemote ? null : <Notice tone="info" text={s.notifications.note} />}
      </View>
    </Screen>
  );
}

/** Remote mode: the customer's notifications from `GET /v1/me/notifications` (marked read on view). */
function RemoteInbox() {
  const { s, date, time } = useI18n();
  const user = useAppStore((st) => st.user);
  const items = useRemoteOrders((st) => st.notifications);
  const state = useRemoteOrders((st) => st.notificationsState);
  usePollWhileFocused(
    async () => {
      if (!user) return;
      await fetchNotifications();
      meApi.markNotificationsRead().catch(() => {});
    },
    30_000,
    !!user,
  );

  if (!user) {
    return (
      <View style={{ marginVertical: space.md, gap: space.sm }}>
        <Notice tone="info" icon="bell" text={s.remote.signInForNotifications} />
        <Button label={s.common.signIn} size="md" onPress={() => router.push('/sign-in')} />
      </View>
    );
  }
  return (
    <View style={{ marginTop: space.sm, marginBottom: space.lg, gap: space.sm }}>
      <Text variant="headline">{s.remote.inbox}</Text>
      {state === 'loading' && !items.length ? (
        <>
          <Skeleton width="100%" height={64} rounded={radius.md} />
          <Skeleton width="100%" height={64} rounded={radius.md} />
        </>
      ) : state === 'error' && !items.length ? (
        <View style={{ gap: space.sm }}>
          <Notice tone="warning" text={s.remote.loadFailed} />
          <Button label={s.common.retry} variant="secondary" size="sm" icon="refresh-ccw" onPress={() => fetchNotifications().catch(() => {})} />
        </View>
      ) : items.length === 0 ? (
        <Text variant="callout" color="textTertiary">
          {s.remote.noNotifications}
        </Text>
      ) : (
        <ListGroup>
          {items.map((n, i) => {
            const orderId = typeof n.data?.orderId === 'string' ? n.data.orderId : undefined;
            const reviewId = typeof n.data?.mechanicReviewId === 'string' ? n.data.mechanicReviewId : undefined;
            const vehicleId = typeof n.data?.vehicleId === 'string' ? n.data.vehicleId : undefined;
            const open = orderId
              ? () => router.push(`/order/${orderId}`)
              : reviewId
                ? () => router.push({ pathname: '/mechanic/[id]', params: { id: reviewId } })
                : vehicleId
                  ? () => router.push({ pathname: '/maintenance/[vehicleId]', params: { vehicleId } })
                  : undefined;
            const at = new Date(n.createdAt).getTime();
            return (
              <Pressable
                key={n.id}
                onPress={open}
                disabled={!open}
                accessibilityLabel={`${n.title}. ${n.body}`}
                style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: colors.line }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.readAt ? 'transparent' : colors.accent }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout" weight="semibold">
                    {n.title}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {n.body}
                  </Text>
                  <Text variant="micro" color="textTertiary">
                    {date(at)} · {time(at)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ListGroup>
      )}
    </View>
  );
}
