import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { PartArt } from '@/brand/PartArt';
import type { ReturnReason } from '@/domain/types';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { RETURN_WINDOW_DAYS } from '@/services/remote/orderView';
import { cancelOrder, requestReturn, useRemoteOrder } from '@/services/remote/orders';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Stepper } from '@/ui/Stepper';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

const REASONS: ReturnReason[] = ['wrongPart', 'damaged', 'notAsDescribed', 'changedMind'];

/** Remote cancel: `POST /v1/orders/:id/cancel`. Refunds (if paid) are issued by the server. */
export function RemoteCancelSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, isRTL } = useI18n();
  const { order } = useRemoteOrder(id);
  const [reason, setReason] = useState<string>();
  const [busy, setBusy] = useState(false);
  const allowed = !!order?.canCancel;

  const confirm = async () => {
    if (!order || !reason) return;
    setBusy(true);
    try {
      await cancelOrder(order.id, reason);
      haptic.success();
      toast(s.orders.cancelled, 'x-circle');
      router.back();
    } catch (e) {
      setBusy(false);
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
    }
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.md }}>
        <Text variant="title2">{s.orders.cancelTitle}</Text>
        <Text variant="callout" color="textSecondary">
          {s.remote.cancelBody}
        </Text>
        {order && !allowed ? <Notice tone="warning" text={s.remote.errors.NOT_CANCELLABLE} /> : null}
        {s.orders.cancelReasons.map((r) => (
          <ChoiceRow key={r} title={r} selected={reason === r} onPress={() => setReason(r)} disabled={!allowed} />
        ))}
        <Button label={s.orders.confirmCancel} variant="danger" onPress={confirm} disabled={!reason || !allowed} loading={busy} style={{ marginTop: space.sm }} />
        <Button label={s.common.close} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

/** Remote return: choose items + quantities, a reason and an optional note → `POST /v1/orders/:id/returns`. */
export function RemoteReturnSheet() {
  const { id, shipmentId } = useLocalSearchParams<{ id: string; shipmentId?: string }>();
  const { s, tx, isRTL } = useI18n();
  const { order } = useRemoteOrder(id);
  const shipment = order?.shipments.find((sh) => sh.groupId === shipmentId);
  const eligible = (order?.returnable ?? []).filter((r) => !shipment || shipment.items.some((i) => i.id === r.itemId));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // With a single returnable item, start at quantity 1 so the sheet is one tap shorter.
  const qtyOf = (itemId: string) => qty[itemId] ?? (eligible.length === 1 ? 1 : 0);
  const selected = eligible.filter((r) => qtyOf(r.itemId) > 0);

  const submit = async () => {
    if (!order || !reason || !selected.length) return;
    setBusy(true);
    try {
      await requestReturn(order.id, {
        items: selected.map((r) => ({ orderItemId: r.itemId, quantity: Math.min(qtyOf(r.itemId), r.maxQty) })),
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      haptic.success();
      toast(s.orders.returnRequested, 'rotate-ccw');
      router.back();
    } catch (e) {
      setBusy(false);
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
    }
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="title2">{s.orders.returnTitle}</Text>
        <Text variant="callout" color="textSecondary">
          {s.orders.returnBody(RETURN_WINDOW_DAYS)}
        </Text>
        {order && !eligible.length ? <Notice tone="info" text={s.remote.noReturnable} /> : null}
        {eligible.length ? (
          <Text variant="headline" style={{ marginTop: space.sm }}>
            {s.orders.selectItem}
          </Text>
        ) : null}
        {eligible.map((r) => {
          const item = order?.items.find((i) => i.id === r.itemId);
          if (!item) return null;
          const value = qtyOf(r.itemId);
          return (
            <View key={r.itemId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: value > 0 ? 1.5 : 1, borderColor: value > 0 ? colors.primary : colors.line, backgroundColor: colors.surface }}>
              <PartArt kind={item.art} size={40} rounded={radius.xs} />
              <View style={{ flex: 1 }}>
                <Text variant="callout" weight="semibold" numberOfLines={2}>
                  {tx(item.name)}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {s.remote.returnQty}: {value} / {r.maxQty}
                </Text>
              </View>
              <Stepper value={value} min={0} max={r.maxQty} onChange={(v) => setQty((q) => ({ ...q, [r.itemId]: Math.max(0, Math.min(v, r.maxQty)) }))} />
            </View>
          );
        })}
        {eligible.length ? (
          <>
            <Text variant="headline" style={{ marginTop: space.sm }}>
              {s.orders.selectReason}
            </Text>
            {REASONS.map((r) => (
              <ChoiceRow key={r} title={s.orders.returnReasons[r]} selected={reason === r} onPress={() => setReason(r)} />
            ))}
            <Input label={`${s.remote.returnNote} (${s.common.optional})`} accessibilityLabel={s.remote.returnNote} value={note} onChangeText={setNote} maxLength={500} multiline />
            <Button label={s.orders.submitReturn} onPress={submit} disabled={!selected.length || !reason} loading={busy} style={{ marginTop: space.sm }} />
          </>
        ) : null}
        <Button label={s.common.close} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}
