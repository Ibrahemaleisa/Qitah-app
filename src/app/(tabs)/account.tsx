import Constants from 'expo-constants';
import { router } from 'expo-router';
import { View } from 'react-native';

import { LogoMark } from '@/brand/Logo';
import { useI18n } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ListGroup, ListRow } from '@/ui/ListRow';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

export default function Account() {
  const { s, lang } = useI18n();
  const user = useAppStore((st) => st.user);
  const vehicles = useAppStore((st) => st.vehicles.length);
  const addresses = useAppStore((st) => st.addresses.length);
  const favorites = useAppStore((st) => st.favorites.length);
  const orders = useAppStore((st) => st.orders.length);
  const signOut = useAppStore((st) => st.signOut);
  const resetDemo = useAppStore((st) => st.resetDemo);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen header={<ScreenHeader title={s.account.title} large />}>
      {user ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.inverse }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="title2" color="textOnAccent">
              {user.name.slice(0, 1)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="headline" color="textInverse">
              {user.name}
            </Text>
            <Text variant="caption" color="textTertiary" ltr>
              {user.phone}
            </Text>
          </View>
        </View>
      ) : (
        <View style={{ padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.inverse, gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <LogoMark size={44} tone="light" />
            <View style={{ flex: 1 }}>
              <Text variant="headline" color="textInverse">
                {s.account.guestTitle}
              </Text>
              <Text variant="caption" color="textTertiary">
                {s.account.guestBody}
              </Text>
            </View>
          </View>
          <Button label={s.common.signIn} size="md" onPress={() => router.push('/sign-in')} />
        </View>
      )}

      <View style={{ marginTop: space.xl, gap: space.lg }}>
        <ListGroup>
          {user ? <ListRow icon="user" title={s.account.profile} onPress={() => router.push('/profile')} /> : null}
          <ListRow icon="truck" title={s.account.vehicles} value={vehicles ? String(vehicles) : undefined} onPress={() => router.push('/garage')} />
          <ListRow icon="map-pin" title={s.account.addresses} value={addresses ? String(addresses) : undefined} onPress={() => router.push('/addresses')} />
          <ListRow icon="heart" title={s.account.favorites} value={favorites ? String(favorites) : undefined} onPress={() => router.push('/favorites')} />
          <ListRow icon="package" title={s.account.orders} value={orders ? String(orders) : undefined} onPress={() => router.navigate('/orders')} last />
        </ListGroup>
        <ListGroup>
          <ListRow icon="globe" title={s.account.language} value={lang === 'ar' ? s.language.ar : s.language.en} onPress={() => router.push('/language')} />
          <ListRow icon="bell" title={s.account.notifications} onPress={() => router.push('/notifications')} />
          <ListRow icon="help-circle" title={s.account.support} onPress={() => router.push('/support')} last />
        </ListGroup>
        <ListGroup>
          <ListRow
            icon="refresh-ccw"
            title={s.account.resetDemo}
            onPress={() =>
              confirmAction(s.account.resetDemoConfirm, s.common.reset, s.common.cancel, () => {
                resetDemo();
                toast(s.common.done);
              })
            }
            last={!user}
          />
          {user ? <ListRow icon="log-out" title={s.auth.signOut} destructive onPress={signOut} last /> : null}
        </ListGroup>
      </View>
      <View style={{ alignItems: 'center', marginTop: space.xxl, gap: space.xs }}>
        <LogoMark size={28} />
        <Text variant="caption" color="textTertiary" align="center">
          {s.account.version(version)}
        </Text>
      </View>
    </Screen>
  );
}
