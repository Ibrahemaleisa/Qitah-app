import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { LogoSymbol } from '@/brand/Logo';
import type { StageEvent } from '@/services/orders';
import { useI18n } from '@/i18n';
import { enterFade } from '@/theme/motion';
import { colors, space } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';

const DOT = 24;

/**
 * Shipment timeline (guidelines p.31): completed stages are blue circles with a check, the current
 * stage carries the full symbol, upcoming stages are empty circles. Text is always shown.
 * Laid out vertically on mobile to fit six stages with timestamps.
 */
export function ShipmentTimeline({ events, cancelled }: { events: StageEvent[]; cancelled?: boolean }) {
  const { s, time, date } = useI18n();
  const lastReached = events.reduce((acc, e, i) => (e.reached ? i : acc), 0);
  return (
    <View>
      {events.map((e, i) => {
        const isCurrent = i === lastReached && !cancelled;
        return (
          <View key={e.stage} style={{ flexDirection: 'row', gap: space.md }} accessible accessibilityLabel={`${s.orders.stages[e.stage]}${e.reached ? `، ${date(e.at)} ${time(e.at)}` : ''}`}>
            <View style={{ alignItems: 'center', width: 34 }}>
              <View style={{ height: DOT, justifyContent: 'center', alignItems: 'center' }}>
                {isCurrent ? (
                  <LogoSymbol width={32} />
                ) : e.reached ? (
                  <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={13} color="textInverse" />
                  </View>
                ) : (
                  <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5, borderColor: colors.lineStrong, backgroundColor: colors.surface }} />
                )}
              </View>
              {i < events.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 20, backgroundColor: events[i + 1].reached ? colors.primary : colors.line }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md }}>
              <Text variant={isCurrent ? 'bodyStrong' : 'callout'} color={isCurrent ? 'heading' : e.reached ? 'text' : 'textTertiary'}>
                {s.orders.stages[e.stage]}
              </Text>
              {e.reached ? (
                <Animated.View entering={enterFade}>
                  <Text variant="caption" color="textTertiary">
                    {date(e.at)} · {time(e.at)}
                  </Text>
                </Animated.View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Compact per-seller progress used on order cards: completed in blue, the current step in orange. */
export function ShipmentProgress({ sellerName, stageIndex, stageLabel, cancelled }: { sellerName: string; stageIndex: number; stageLabel: string; cancelled?: boolean }) {
  const total = 5;
  return (
    <View accessible accessibilityLabel={`${sellerName}: ${stageLabel}`} style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Text variant="caption" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
          {sellerName}
        </Text>
        <Text variant="caption" color={cancelled ? 'danger' : stageIndex >= total ? 'success' : 'heading'}>
          {stageLabel}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: total }, (_, i) => {
          const done = i < stageIndex;
          const current = i === stageIndex - 1 && stageIndex < total;
          return <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: cancelled ? colors.line : current ? colors.accent : done ? colors.primary : colors.line }} />;
        })}
      </View>
    </View>
  );
}
