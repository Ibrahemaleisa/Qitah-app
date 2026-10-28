import { router } from 'expo-router';
import { View } from 'react-native';

import type { GuaranteeState } from '@/domain/guarantee';
import { useI18n } from '@/i18n';
import { RETURN_WINDOW_DAYS } from '@/services/remote/orderView';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

export { arrivalText } from './arrival';

/** Refund timing published with the policy (mirrors `GET /v1/catalog/return-policy`). */
export const REFUND_TIMING = { hours: 48, bankDaysMin: 3, bankDaysMax: 7 } as const;

/** Compact "ضمان قطعة" badge for product, offer and cart lines. */
export function GuaranteeBadge() {
  const { s } = useI18n();
  return <Badge label={s.trust.guaranteeBadge} tone="success" icon="shield" />;
}

/**
 * Guarantee status with a one-line explanation and a link to the policy sheet. Shown under the fit
 * panel. Purely advisory: the server re-computes fit at checkout and that decides the claim.
 */
export function GuaranteeNote({ state, bySpecification }: { state: GuaranteeState; bySpecification?: boolean }) {
  const { s } = useI18n();
  const covered = state === 'covered';
  const text = covered ? (bySpecification ? s.trust.guaranteeLineSpec : s.trust.guaranteeLine) : state === 'needsVehicle' ? s.trust.guaranteeNeedsVehicle : s.trust.guaranteeNotCovered;
  return (
    <Pressable
      onPress={() => router.push('/guarantee')}
      pressScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={`${covered ? s.trust.guaranteeBadge : ''} ${text}`}
      accessibilityHint={s.trust.learnMore}
      style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md, borderRadius: radius.lg, backgroundColor: covered ? colors.successSoft : colors.surfaceSunken }}
    >
      <Icon name={covered ? 'shield' : 'info'} size={20} color={covered ? 'success' : 'textSecondary'} />
      <View style={{ flex: 1, gap: 2 }}>
        {covered ? (
          <Text variant="captionStrong" color="success">
            {s.trust.guaranteeBadge}
          </Text>
        ) : null}
        <Text variant="caption" color={covered ? 'text' : 'textSecondary'}>
          {text}
        </Text>
      </View>
      <Text variant="captionStrong" color="heading">
        {s.trust.learnMore}
      </Text>
    </Pressable>
  );
}

/** Return policy before purchase: window, who pays return shipping per reason, refund timing. */
export function ReturnPolicySummary() {
  const { s } = useI18n();
  const rows: { rule: string; payer: string }[] = [
    { rule: s.trust.rules.wrongPartGuaranteed, payer: s.trust.payer.qitah },
    { rule: s.trust.rules.damaged, payer: s.trust.payer.seller },
    { rule: s.trust.rules.notAsDescribed, payer: s.trust.payer.seller },
    { rule: s.trust.rules.changedMind, payer: s.trust.payer.customer },
  ];
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="rotate-ccw" size={16} color="heading" />
        <Text variant="callout" weight="semibold" style={{ flex: 1 }}>
          {s.trust.returnWindow(RETURN_WINDOW_DAYS)}
        </Text>
      </View>
      <Text variant="micro" color="textTertiary">
        {s.trust.whoPays}
      </Text>
      {rows.map((r) => (
        <View key={r.rule} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
          <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
            {r.rule}
          </Text>
          <Text variant="captionStrong">{r.payer}</Text>
        </View>
      ))}
      <Text variant="caption" color="textSecondary">
        {s.trust.refundTiming(REFUND_TIMING.hours, REFUND_TIMING.bankDaysMin, REFUND_TIMING.bankDaysMax)}
      </Text>
      <Pressable onPress={() => router.push('/guarantee')} accessibilityRole="link" style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
        <Text variant="captionStrong" color="heading">
          {s.trust.policyTitle}
        </Text>
      </Pressable>
    </View>
  );
}
