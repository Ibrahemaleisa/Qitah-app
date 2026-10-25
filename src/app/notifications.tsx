import { View } from 'react-native';

import { useI18n } from '@/i18n';
import { useAppStore, type NotificationPrefs } from '@/store/app-store';
import { colors, space } from '@/theme/tokens';
import { ListGroup } from '@/ui/ListRow';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';

export default function Notifications() {
  const { s } = useI18n();
  const prefs = useAppStore((st) => st.notificationPrefs);
  const setPref = useAppStore((st) => st.setNotificationPref);
  const rows: { key: keyof NotificationPrefs; title: string; hint: string }[] = [
    { key: 'orderUpdates', title: s.notifications.orderUpdates, hint: s.notifications.orderUpdatesHint },
    { key: 'priceDrops', title: s.notifications.priceDrops, hint: s.notifications.priceDropsHint },
    { key: 'offers', title: s.notifications.offers, hint: s.notifications.offersHint },
  ];
  return (
    <Screen header={<ScreenHeader back title={s.notifications.title} />}>
      <View style={{ marginTop: space.sm, gap: space.lg }}>
        <ListGroup>
          {rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" weight="medium">
                  {r.title}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {r.hint}
                </Text>
              </View>
              <Toggle value={prefs[r.key]} onChange={(v) => setPref(r.key, v)} label={r.title} />
            </View>
          ))}
        </ListGroup>
        <Notice tone="info" text={s.notifications.note} />
      </View>
    </Screen>
  );
}
