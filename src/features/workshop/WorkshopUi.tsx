import { router } from 'expo-router';
import { View } from 'react-native';

import { toApiError } from '@/api/client';
import { halalasToSar } from '@/api/money';
import type { ApiOrgCredit } from '@/api/workshop';
import { isRemote } from '@/config/env';
import type { Strings } from '@/i18n/ar';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';

export const QUOTE_TONE: Record<string, BadgeTone> = { SENT: 'info', APPROVED: 'success', CONVERTED: 'success', DECLINED: 'warning', EXPIRED: 'neutral' };

/** Workshop-specific error codes first, then the app's generic API messages. */
export function workshopErrorMessage(s: Strings, e: unknown): string {
  const code = String(toApiError(e).code);
  return s.workshop.errors[code] ?? apiErrorMessage(s, e);
}

/** Workshop screens need the Qitah server and a signed-in user; renders the right empty state otherwise. */
export function WorkshopGate({ title, children }: { title: string; children: React.ReactNode }) {
  const { s } = useI18n();
  const user = useAppStore((st) => st.user);
  if (!isRemote) {
    return (
      <Screen header={<ScreenHeader back title={title} />}>
        <EmptyState icon="store" title={s.workshop.mode} body={s.workshop.remoteOnly} />
      </Screen>
    );
  }
  if (!user) {
    return (
      <Screen header={<ScreenHeader back title={title} />}>
        <EmptyState icon="store" title={s.workshop.mode} body={s.workshop.signIn} action={{ label: s.common.signIn, onPress: () => router.push('/sign-in') }} />
      </Screen>
    );
  }
  return <>{children}</>;
}

/** Credit used / available on Qitah's internal (sandbox) credit line. */
export function CreditSummary({ credit, overdueHalalas, nextDueAt }: { credit: ApiOrgCredit | null; overdueHalalas?: number; nextDueAt?: string | null }) {
  const { s, money, date } = useI18n();
  if (!credit || credit.status === null) return <Notice tone="info" icon="credit-card" text={s.workshop.noCredit} />;
  const used = credit.limitHalalas ? Math.min(1, credit.outstandingHalalas / credit.limitHalalas) : 0;
  return (
    <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="headline">{s.workshop.credit}</Text>
        {credit.status === 'FROZEN' ? <Badge label={s.workshop.creditFrozen} tone="warning" icon="lock" /> : <Badge label={s.workshop.creditTerms(credit.termsDays)} tone="info" icon="clock" />}
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(used * 100) }}>
        <View style={{ width: `${Math.round(used * 100)}%`, height: 8, backgroundColor: used > 0.9 ? colors.warning : colors.primary }} />
      </View>
      <Row label={s.workshop.creditAvailable} value={money(halalasToSar(credit.availableHalalas))} strong />
      <Row label={s.workshop.creditUsed} value={money(halalasToSar(credit.outstandingHalalas))} />
      <Row label={s.workshop.creditLimit} value={money(halalasToSar(credit.limitHalalas))} />
      {overdueHalalas ? <Notice tone="danger" icon="alert-triangle" text={s.workshop.overdueTotal(money(halalasToSar(overdueHalalas)))} /> : null}
      {nextDueAt ? (
        <Text variant="caption" color="textSecondary">
          {s.workshop.nextDue(date(new Date(nextDueAt).getTime()))}
        </Text>
      ) : null}
      <Text variant="caption" color="textTertiary">
        {s.workshop.creditSandbox}
      </Text>
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Text variant={strong ? 'bodyStrong' : 'callout'} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'callout'} weight="semibold" tabular>
        {value}
      </Text>
    </View>
  );
}
