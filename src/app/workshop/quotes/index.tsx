import { router } from 'expo-router';
import { View } from 'react-native';

import { halalasToSar } from '@/api/money';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { QUOTE_TONE, WorkshopGate } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { fetchQuotes, useActiveOrg, useWorkshop } from '@/services/remote/workshop';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';

/** The workshop's quotes to its own customers ("عرض سعر للعميل"), newest first. */
export default function WorkshopQuotes() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.quotes}>
      <Quotes />
    </WorkshopGate>
  );
}

function Quotes() {
  const { s, money, date } = useI18n();
  const active = useActiveOrg();
  const orgId = active?.org.id;
  const quotes = useWorkshop((w) => (orgId ? w.quotes[orgId] : undefined)) ?? [];
  usePollWhileFocused(() => (orgId ? fetchQuotes(orgId) : undefined), 20_000, !!orgId);

  return (
    <Screen
      header={<ScreenHeader back title={s.workshop.quotes} subtitle={active?.org.displayName} />}
      footer={
        orgId ? (
          <StickyFooter>
            <Button label={s.workshop.newQuote} icon="plus" onPress={() => router.push('/workshop/quotes/new')} />
          </StickyFooter>
        ) : undefined
      }
    >
      {!orgId ? (
        <EmptyState icon="store" title={s.workshop.mode} body={s.workshop.retailHint} action={{ label: s.workshop.mode, onPress: () => router.replace('/workshop') }} />
      ) : quotes.length === 0 ? (
        <EmptyState icon="receipt" title={s.workshop.quotesEmpty} body={s.workshop.quotesEmptyHint} />
      ) : (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          {quotes.map((q) => (
            <Pressable
              key={q.id}
              onPress={() => router.push({ pathname: '/workshop/quotes/[id]', params: { id: q.id } })}
              haptics="tap"
              accessibilityLabel={`${q.number}, ${s.workshop.quoteStatus[q.status]}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
            >
              <Icon name="receipt" size={20} color="heading" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {[q.vehicle.model, q.vehicle.year, q.vehicle.plate].filter(Boolean).join(' · ')}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {`${q.number} · ${date(new Date(q.createdAt).getTime())} · ${money(halalasToSar(q.totalHalalas))}`}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  <Badge label={s.workshop.quoteStatus[q.status]} tone={QUOTE_TONE[q.status]} />
                </View>
              </View>
              <Icon name="chevron-right" size={18} color="textTertiary" />
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
