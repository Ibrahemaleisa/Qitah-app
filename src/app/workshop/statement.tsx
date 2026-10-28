import { router } from 'expo-router';
import { View } from 'react-native';

import { halalasToSar } from '@/api/money';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { CreditSummary, Row, WorkshopGate } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { mapOrderStatus } from '@/services/remote/orderView';
import { fetchStatement, useActiveOrg, useWorkshop } from '@/services/remote/workshop';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

/** Workshop statement: credit used/available, orders with due dates, repayments, team and activity. */
export default function WorkshopStatement() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.statement}>
      <Statement />
    </WorkshopGate>
  );
}

function Statement() {
  const { s, money, date } = useI18n();
  const active = useActiveOrg();
  const orgId = active?.org.id;
  const st = useWorkshop((w) => (orgId ? w.statements[orgId] : undefined));
  usePollWhileFocused(() => (orgId ? fetchStatement(orgId) : undefined), 30_000, !!orgId);

  if (!active) {
    return (
      <Screen header={<ScreenHeader back title={s.workshop.statement} />}>
        <EmptyState icon="store" title={s.workshop.mode} body={s.workshop.retailHint} action={{ label: s.workshop.mode, onPress: () => router.replace('/workshop') }} />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader back title={s.workshop.statement} subtitle={active.org.displayName} />}>
      {!st ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <Skeleton width="100%" height={160} rounded={radius.lg} />
          <Skeleton width="100%" height={220} rounded={radius.lg} />
        </View>
      ) : (
        <>
          <View style={{ marginTop: space.sm }}>
            <CreditSummary credit={st.credit} overdueHalalas={st.credit.overdueHalalas} nextDueAt={st.credit.nextDueAt} />
          </View>

          <Section title={s.workshop.orders} subtitle={`${s.workshop.ordersCount(st.totals.orders)} · ${s.workshop.spend} ${money(halalasToSar(st.totals.spendHalalas))}`}>
            {st.orders.length === 0 ? (
              <Text variant="callout" color="textSecondary">
                {s.workshop.statementEmpty}
              </Text>
            ) : (
              <View style={{ borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
                {st.orders.map((o, i) => (
                  <Pressable
                    key={o.id}
                    onPress={() => router.push(`/order/${o.id}`)}
                    accessibilityLabel={`${o.number}, ${money(halalasToSar(o.totalHalalas))}`}
                    style={{ padding: space.lg, gap: 4, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text variant="callout" weight="semibold" ltr style={{ flex: 1 }}>
                        {o.number}
                      </Text>
                      <Text variant="callout" weight="semibold" tabular>
                        {money(halalasToSar(o.totalHalalas))}
                      </Text>
                    </View>
                    <Text variant="caption" color="textSecondary">
                      {[date(new Date(o.createdAt).getTime()), o.buyerName, o.workOrderRef ? s.workshop.workOrder(o.workOrderRef) : null].filter(Boolean).join(' · ')}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <Badge label={s.orders.status[mapOrderStatus({ status: o.status, payment: null })]} />
                      {o.paymentMethod === 'NET_TERMS' ? <Badge label={s.workshop.netTerms} tone="info" icon="credit-card" /> : null}
                      {o.outstandingHalalas > 0 ? <Badge label={`${s.workshop.outstanding} ${money(halalasToSar(o.outstandingHalalas))}`} tone={o.overdue ? 'danger' : 'warning'} /> : null}
                      {o.overdue ? <Badge label={s.workshop.overdue} tone="danger" icon="alert-triangle" /> : o.outstandingHalalas > 0 && o.creditDueAt ? <Badge label={s.workshop.dueOn(date(new Date(o.creditDueAt).getTime()))} icon="clock" /> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </Section>

          <Section title={s.workshop.repayments}>
            {st.repayments.length === 0 ? (
              <Text variant="callout" color="textSecondary">
                {s.workshop.noRepayments}
              </Text>
            ) : (
              <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
                {st.repayments.map((r) => (
                  <Row key={r.id} label={`${date(new Date(r.createdAt).getTime())}${r.reference ? ` · ${r.reference}` : ''}`} value={money(halalasToSar(r.amountHalalas))} />
                ))}
              </View>
            )}
          </Section>

          <Section title={s.workshop.members}>
            <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
              {st.members.map((m) => (
                <Row key={m.id} label={m.name ?? m.phone ?? '—'} value={m.status === 'INVITED' ? `${s.workshop.role[m.role]} · ${s.workshop.invited}` : s.workshop.role[m.role]} />
              ))}
            </View>
          </Section>

          <Section title={s.workshop.activity}>
            <View style={{ gap: space.xs }}>
              {st.activity.slice(0, 20).map((a) => (
                <Text key={a.id} variant="caption" color="textSecondary">
                  {`${date(new Date(a.createdAt).getTime())} · ${s.workshop.activityLabel[a.action] ?? a.action}`}
                </Text>
              ))}
            </View>
          </Section>
        </>
      )}
    </Screen>
  );
}
