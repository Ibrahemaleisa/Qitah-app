import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { StageEvent } from '@/services/orders';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';

/** Vertical status timeline for one shipment. */
export function ShipmentTimeline({ events, cancelled }: { events: StageEvent[]; cancelled?: boolean }) {
  const { s, time, date } = useI18n();
  const lastReached = events.reduce((acc, e, i) => (e.reached ? i : acc), 0);
  return (
    <View>
      {events.map((e, i) => {
        const isCurrent = i === lastReached && !cancelled;
        const color = e.reached ? (isCurrent ? colors.accent : colors.text) : colors.lineStrong;
        return (
          <View key={e.stage} style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: e.reached ? color : colors.surface, borderWidth: e.reached ? 0 : 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
                {e.reached ? <Icon name={isCurrent && e.stage !== 'delivered' ? 'circle' : 'check'} size={isCurrent && e.stage !== 'delivered' ? 8 : 12} color="textInverse" /> : null}
              </View>
              {i < events.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: events[i + 1].reached ? colors.text : colors.line }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md }}>
              <Text variant={isCurrent ? 'bodyStrong' : 'callout'} color={e.reached ? 'text' : 'textTertiary'}>
                {s.orders.stages[e.stage]}
              </Text>
              {e.reached ? (
                <Animated.View entering={FadeIn}>
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
