import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useNow } from '@/lib/use-now';
import { canCancel } from '@/services/orders';
import { paymentProviders } from '@/services/payments/mock';
import { useAppStore } from '@/store/app-store';
import { colors, gutter, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Notice } from '@/ui/Notice';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

export default function CancelOrderSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, isRTL } = useI18n();
  const order = useAppStore((st) => st.orders.find((o) => o.id === id));
  const cancelOrder = useAppStore((st) => st.cancelOrder);
  const [reason, setReason] = useState<string>();
  const [busy, setBusy] = useState(false);
  const now = useNow(5_000);
  const allowed = order ? canCancel(order, now) : false;

  const confirm = async () => {
    if (!order || !reason) return;
    setBusy(true);
    await paymentProviders[order.payment.methodId].refund(order.payment.reference, order.totals.total);
    cancelOrder(order.id, reason);
    haptic.success();
    toast(s.orders.cancelled, 'x-circle');
    router.back();
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.md }}>
        <Text variant="title2">{s.orders.cancelTitle}</Text>
        <Text variant="callout" color="textSecondary">
          {s.orders.cancelBody}
        </Text>
        {!allowed ? <Notice tone="warning" text={s.orders.cancelBody} /> : null}
        {s.orders.cancelReasons.map((r) => (
          <ChoiceRow key={r} title={r} selected={reason === r} onPress={() => setReason(r)} disabled={!allowed} />
        ))}
        <Button label={s.orders.confirmCancel} variant="danger" onPress={confirm} disabled={!reason || !allowed} loading={busy} style={{ marginTop: space.sm }} />
        <Button label={s.common.close} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}
