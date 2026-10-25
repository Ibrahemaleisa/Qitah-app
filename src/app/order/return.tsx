import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { PartArt } from '@/brand/PartArt';
import type { ReturnReason } from '@/domain/types';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useNow } from '@/lib/use-now';
import { RETURN_WINDOW_DAYS, returnableLineIds } from '@/services/orders';
import { useAppStore } from '@/store/app-store';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

const reasons: ReturnReason[] = ['wrongPart', 'damaged', 'notAsDescribed', 'changedMind'];

export default function ReturnSheet() {
  const { id, shipmentId } = useLocalSearchParams<{ id: string; shipmentId?: string }>();
  const { s, tx, isRTL } = useI18n();
  const order = useAppStore((st) => st.orders.find((o) => o.id === id));
  const requestReturn = useAppStore((st) => st.requestReturn);
  const now = useNow(5_000);
  const shipment = order?.shipments.find((sh) => sh.id === shipmentId);
  const eligible = order ? returnableLineIds(order, now).filter((lid) => !shipment || shipment.lineIds.includes(lid)) : [];
  const lines = order?.lines.filter((l) => eligible.includes(l.id)) ?? [];
  const [lineId, setLineId] = useState<string | undefined>(lines[0]?.id);
  const [reason, setReason] = useState<ReturnReason>();

  const submit = () => {
    if (!order || !lineId || !reason) return;
    requestReturn(order.id, lineId, reason);
    haptic.success();
    toast(s.orders.returnRequested, 'rotate-ccw');
    router.back();
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.md }}>
        <Text variant="title2">{s.orders.returnTitle}</Text>
        <Text variant="callout" color="textSecondary">
          {s.orders.returnBody(RETURN_WINDOW_DAYS)}
        </Text>
        <Text variant="headline" style={{ marginTop: space.sm }}>
          {s.orders.selectItem}
        </Text>
        {lines.map((l) => (
          <ChoiceRow key={l.id} title={tx(l.productName)} subtitle={`× ${l.qty}`} selected={lineId === l.id} onPress={() => setLineId(l.id)} leading={<PartArt kind={l.art} size={40} rounded={radius.xs} />} />
        ))}
        <Text variant="headline" style={{ marginTop: space.sm }}>
          {s.orders.selectReason}
        </Text>
        {reasons.map((r) => (
          <ChoiceRow key={r} title={s.orders.returnReasons[r]} selected={reason === r} onPress={() => setReason(r)} />
        ))}
        <Button label={s.orders.submitReturn} onPress={submit} disabled={!lineId || !reason} style={{ marginTop: space.sm }} />
      </ScrollView>
    </View>
  );
}
