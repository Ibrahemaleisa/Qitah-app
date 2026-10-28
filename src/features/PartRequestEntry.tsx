import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { isRemote } from '@/config/env';
import { useI18n } from '@/i18n';
import { fetchPartRequests, usePartRequests } from '@/services/remote/partRequests';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

/**
 * Entry points to "اطلب قطعة" (part requests). Remote mode only: the request goes to real merchants,
 * so the bundled demo data hides these instead of leading to a dead end.
 */

/** Shown under the search "no results" state, carrying the typed query into the request. */
export function PartRequestSearchCta({ query }: { query: string }) {
  const { s } = useI18n();
  if (!isRemote) return null;
  const q = query.trim();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary, padding: space.lg, gap: space.sm, marginBottom: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="message-square" size={20} color="heading" />
        <Text variant="headline" style={{ flex: 1 }}>
          {s.partRequest.searchTitle}
        </Text>
      </View>
      <Text variant="callout" color="textSecondary">
        {s.partRequest.searchBody}
      </Text>
      <Button label={s.partRequest.searchCta} icon="message-square" size="md" onPress={() => router.push(q ? { pathname: '/part-requests/new', params: { q } } : '/part-requests/new')} />
    </View>
  );
}

/** Home card: request a part, with a shortcut to the customer's requests once there are some. */
export function PartRequestHomeCard() {
  const { s } = useI18n();
  const count = usePartRequests((st) => st.list.length);
  const user = useAppStore((st) => st.user);
  useFocusEffect(
    useCallback(() => {
      if (isRemote && user) fetchPartRequests().catch(() => {});
    }, [user]),
  );
  if (!isRemote) return null;
  return (
    <View style={{ marginTop: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
      <Pressable onPress={() => router.push('/part-requests/new')} pressScale={0.985} accessibilityRole="button" accessibilityLabel={`${s.partRequest.homeTitle}. ${s.partRequest.homeBody}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="message-square" size={22} color="accentText" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{s.partRequest.homeTitle}</Text>
          <Text variant="caption" color="textSecondary">
            {s.partRequest.homeBody}
          </Text>
        </View>
        <Icon name="chevron-right" size={16} color="textTertiary" />
      </Pressable>
      {count ? (
        <Pressable onPress={() => router.push('/part-requests')} accessibilityRole="link" style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
          <Text variant="captionStrong" color="link">
            {s.partRequest.myRequests} ({count})
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
