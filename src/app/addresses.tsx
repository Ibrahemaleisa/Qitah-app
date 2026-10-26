import { router } from 'expo-router';
import { View } from 'react-native';

import { cityLabel } from '@/data/sellers';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { confirmAction } from '@/lib/confirm';
import { removeAddress } from '@/services/remote/account';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { IconButton } from '@/ui/IconButton';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

export default function Addresses() {
  const { s, tx } = useI18n();
  const addresses = useAppStore((st) => st.addresses);
  return (
    <Screen
      header={<ScreenHeader back title={s.addresses.title} />}
      footer={
        addresses.length ? (
          <StickyFooter>
            <Button label={s.addresses.add} icon="plus" variant="dark" onPress={() => router.push('/address/edit')} />
          </StickyFooter>
        ) : undefined
      }
    >
      {addresses.length === 0 ? (
        <EmptyState icon="map-pin" title={s.addresses.empty} body={s.addresses.emptyHint} action={{ label: s.addresses.add, onPress: () => router.push('/address/edit') }} />
      ) : (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          {addresses.map((a) => (
            <Pressable key={a.id} onPress={() => router.push({ pathname: '/address/edit', params: { id: a.id } })} pressScale={0.985} accessibilityLabel={a.label} style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
              <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={a.kind === 'workshop' ? 'tool' : 'home'} size={18} color="heading" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{a.workshopName ?? a.label}</Text>
                <Text variant="caption" color="textSecondary">
                  {tx(cityLabel(a.city))} · {a.district} · {a.street}
                </Text>
                <Badge label={a.kind === 'workshop' ? s.checkout.workshop : s.checkout.home} />
              </View>
              <IconButton icon="trash-2" label={s.common.remove} tone="plain" iconColor="textTertiary" size={36} onPress={() => confirmAction(s.common.remove, s.common.remove, s.common.cancel, () => removeAddress(a.id).catch((e) => toast(apiErrorMessage(s, e), 'alert-circle')))} />
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
