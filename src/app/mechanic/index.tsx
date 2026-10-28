import { router } from 'expo-router';
import { View } from 'react-native';

import { isRemote } from '@/config/env';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { useI18n } from '@/i18n';
import { fetchReviews, useMechanicReviews } from '@/services/mechanic';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';

const STATUS_TONE: Record<string, BadgeTone> = { PENDING: 'info', APPROVED: 'success', CHANGES_SUGGESTED: 'warning', EXPIRED: 'neutral' };

/** The customer's "send to my mechanic" reviews, newest first. */
export default function MechanicReviews() {
  const { s, lang, date } = useI18n();
  const user = useAppStore((st) => st.user);
  const order = useMechanicReviews((st) => st.order);
  const byId = useMechanicReviews((st) => st.byId);
  usePollWhileFocused(fetchReviews, 30_000, isRemote && !!user);
  const reviews = order.map((id) => byId[id]).filter(Boolean);

  return (
    <Screen header={<ScreenHeader back title={s.mechanic.reviews} />}>
      {reviews.length === 0 ? (
        <EmptyState icon="tool" title={s.mechanic.empty} body={s.mechanic.emptyHint} />
      ) : (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          {reviews.map((r) => {
            const key = r.expired ? 'EXPIRED' : r.status;
            const title = r.vehicle ? `${lang === 'ar' ? r.vehicle.makeAr : r.vehicle.makeEn} ${lang === 'ar' ? r.vehicle.modelAr : r.vehicle.modelEn} ${r.vehicle.year}` : s.mechanic.noVehicle;
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push({ pathname: '/mechanic/[id]', params: { id: r.id } })}
                haptics="tap"
                accessibilityLabel={`${title}, ${s.mechanic.status[key]}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
              >
                <Icon name="tool" size={20} color="heading" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {title}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {s.common.items(r.lines.reduce((n, l) => n + l.quantity, 0))} · {date(new Date(r.createdAt).getTime())}
                  </Text>
                  <View style={{ flexDirection: 'row' }}>
                    <Badge label={s.mechanic.status[key]} tone={STATUS_TONE[key]} />
                  </View>
                </View>
                <Icon name="chevron-right" size={18} color="textTertiary" />
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
