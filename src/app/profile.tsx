import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { isRemote } from '@/config/env';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { updateProfile } from '@/services/remote/account';
import { haptic } from '@/lib/haptics';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Input } from '@/ui/Input';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { toast } from '@/ui/Toast';

export default function Profile() {
  const { s } = useI18n();
  const user = useAppStore((st) => st.user);
  const updateUser = useAppStore((st) => st.updateUser);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const emailError = email && !/^\S+@\S+\.\S+$/.test(email) ? s.profile.invalidEmail : undefined;

  const save = async () => {
    const patch = { name: name.trim(), email: email.trim() || undefined };
    if (isRemote) {
      // Server is the source of truth for the profile (PATCH /v1/me).
      setSaving(true);
      try {
        await updateProfile(patch);
      } catch (e) {
        setSaving(false);
        toast(apiErrorMessage(s, e), 'alert-circle');
        return;
      }
      setSaving(false);
    } else {
      updateUser(patch);
    }
    haptic.success();
    toast(s.profile.saved);
    router.back();
  };

  if (!user) {
    return (
      <Screen header={<ScreenHeader back title={s.account.profile} />}>
        <EmptyState icon="user" title={s.account.guestTitle} body={s.account.guestBody} action={{ label: s.common.signIn, onPress: () => router.push('/sign-in') }} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<ScreenHeader back title={s.account.profile} />}
      footer={
        <StickyFooter>
          <Button
            label={s.common.save}
            disabled={name.trim().length < 2 || !!emailError}
            loading={saving}
            onPress={save}
          />
        </StickyFooter>
      }
    >
      <View style={{ gap: space.lg, marginTop: space.md }}>
        <Input label={s.profile.name} value={name} onChangeText={setName} textContentType="name" />
        <Input label={s.profile.phone} value={user.phone} editable={false} ltr />
        <Input label={`${s.profile.email} (${s.common.optional})`} value={email} onChangeText={setEmail} placeholder={s.profile.emailPlaceholder} keyboardType="email-address" autoCapitalize="none" ltr error={emailError} />
      </View>
    </Screen>
  );
}
