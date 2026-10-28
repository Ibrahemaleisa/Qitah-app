import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ReturnPolicySummary, REFUND_TIMING } from '@/features/trust';
import { useI18n } from '@/i18n';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';

/** Policy sheet: what the fit guarantee (ضمان قطعة) covers, how to claim, and when the refund lands. */
export default function GuaranteeSheet() {
  const { s, isRTL } = useI18n();
  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={24} color="success" />
          </View>
          <Text variant="title2" style={{ flex: 1 }}>
            {s.trust.policyTitle}
          </Text>
        </View>
        <Text variant="callout" color="textSecondary">
          {s.trust.policyIntro}
        </Text>
        <Block title={s.trust.coveredTitle} icon="check-circle" items={s.trust.covered} />
        <Block title={s.trust.notCoveredTitle} icon="x-circle" items={s.trust.notCovered} muted />
        <Block title={s.trust.claimTitle} icon="rotate-ccw" items={s.trust.claimSteps} numbered />
        <View style={{ gap: space.sm }}>
          <Text variant="headline">{s.trust.refundTitle}</Text>
          <Text variant="callout" color="textSecondary">
            {s.trust.refundTiming(REFUND_TIMING.hours, REFUND_TIMING.bankDaysMin, REFUND_TIMING.bankDaysMax)}
          </Text>
        </View>
        <View style={{ gap: space.sm }}>
          <Text variant="headline">{s.trust.returnPolicyTitle}</Text>
          <ReturnPolicySummary />
        </View>
        <Button label={s.common.close} variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

function Block({ title, icon, items, muted, numbered }: { title: string; icon: IconName; items: string[]; muted?: boolean; numbered?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="headline">{title}</Text>
      {items.map((item, i) => (
        <View key={item} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          {numbered ? (
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Text variant="micro" weight="bold">
                {String(i + 1)}
              </Text>
            </View>
          ) : (
            <View style={{ paddingTop: 2 }}>
              <Icon name={icon} size={16} color={muted ? 'textTertiary' : 'success'} />
            </View>
          )}
          <Text variant="callout" color={muted ? 'textSecondary' : 'text'} style={{ flex: 1 }}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}
