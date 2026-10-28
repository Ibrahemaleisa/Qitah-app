import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, View } from 'react-native';

import { halalasToSar } from '@/api/money';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { QUOTE_TONE, Row, WorkshopGate, workshopErrorMessage } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { convertQuote, fetchQuote, useActiveOrg, useWorkshop } from '@/services/remote/workshop';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

/** One customer quote: status (sent → approved → order), lines, re-share, and the resulting workshop order. */
export default function WorkshopQuoteScreen() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.newQuote}>
      <QuoteDetail />
    </WorkshopGate>
  );
}

function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, tx, money, date, time } = useI18n();
  const active = useActiveOrg();
  const orgId = active?.org.id;
  const quote = useWorkshop((w) => (orgId ? w.quotes[orgId]?.find((q) => q.id === id) : undefined));
  const shareText = useWorkshop((w) => (id ? w.quoteShares[id] : undefined));
  const [busy, setBusy] = useState(false);
  usePollWhileFocused(() => (orgId && id ? fetchQuote(orgId, id) : undefined), 10_000, !!orgId && !!id);

  if (!quote || !orgId) {
    return (
      <Screen header={<ScreenHeader back title={s.workshop.newQuote} />}>
        <View style={{ gap: space.md, marginTop: space.lg }}>
          <Skeleton width="100%" height={80} rounded={radius.lg} />
          <Skeleton width="100%" height={160} rounded={radius.lg} />
        </View>
      </Screen>
    );
  }

  const retryConvert = async () => {
    setBusy(true);
    try {
      const res = await convertQuote(orgId, quote.id);
      haptic.success();
      router.push(`/order/${res.orderId}`);
    } catch (e) {
      toast(workshopErrorMessage(s, e), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };
  const exp = new Date(quote.expiresAt).getTime();

  return (
    <Screen
      header={<ScreenHeader back title={quote.number} subtitle={[quote.vehicle.model, quote.vehicle.year, quote.vehicle.plate].filter(Boolean).join(' · ')} />}
      footer={
        quote.orderId ? (
          <StickyFooter>
            <Button label={s.workshop.viewOrder} icon="package" onPress={() => router.push(`/order/${quote.orderId}`)} />
          </StickyFooter>
        ) : quote.status === 'APPROVED' ? (
          <StickyFooter>
            <Button label={s.workshop.convert} icon="refresh-ccw" onPress={retryConvert} loading={busy} disabled={busy} />
          </StickyFooter>
        ) : quote.status === 'SENT' && shareText ? (
          <StickyFooter>
            <Button label={s.workshop.share} icon="share" variant="secondary" onPress={() => Share.share({ message: shareText }).catch(() => {})} />
            {quote.customerPhone ? (
              <Button label={s.workshop.whatsapp} icon="message-circle" onPress={() => Linking.openURL(`https://wa.me/${quote.customerPhone!.replace(/\D/g, '')}?text=${encodeURIComponent(shareText)}`).catch(() => {})} />
            ) : null}
          </StickyFooter>
        ) : undefined
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
        <Badge label={s.workshop.quoteStatus[quote.status]} tone={QUOTE_TONE[quote.status]} />
        {quote.status === 'SENT' ? (
          <Text variant="caption" color="textTertiary">
            {s.workshop.validUntil(`${date(exp)} ${time(exp)}`)}
          </Text>
        ) : null}
      </View>
      {quote.status === 'APPROVED' && quote.convertError ? (
        <View style={{ marginTop: space.md }}>
          <Notice tone="warning" text={s.workshop.convertFailed} />
        </View>
      ) : null}

      <View style={{ marginTop: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
        {quote.lines.map((l, i) => (
          <View key={l.offerId} style={{ padding: space.lg, gap: 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Text variant="callout" weight="semibold" style={{ flex: 1 }}>
                {tx({ ar: l.nameAr, en: l.nameEn || l.nameAr })} <Text variant="caption" color="textSecondary">× {l.quantity}</Text>
              </Text>
              <Text variant="callout" tabular>
                {money(halalasToSar(l.lineTotalHalalas))}
              </Text>
            </View>
            <Text variant="caption" color="textSecondary" mono>
              {l.brand} · {l.partNumber}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
        <Row label={s.workshop.partsTotal} value={money(halalasToSar(quote.partsHalalas))} />
        <Row label={s.workshop.laborLine} value={money(halalasToSar(quote.laborHalalas))} />
        <Row label={s.workshop.markupLine} value={money(halalasToSar(quote.markupHalalas))} />
        <Row label={s.workshop.total} value={money(halalasToSar(quote.totalHalalas))} strong />
      </View>
      {quote.note ? (
        <Text variant="callout" color="textSecondary" style={{ marginTop: space.md }}>
          {quote.note}
        </Text>
      ) : null}
    </Screen>
  );
}
