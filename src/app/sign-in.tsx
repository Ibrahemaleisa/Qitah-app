import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { LogoSymbol } from '@/brand/Logo';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAppStore } from '@/store/app-store';
import { enterUp } from '@/theme/motion';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Text } from '@/ui/Text';

type Step = 'phone' | 'code' | 'name';

export default function SignIn() {
  const { s } = useI18n();
  const signIn = useAppStore((st) => st.signIn);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const digits = phone.replace(/\D/g, '');
  const submitPhone = () => {
    if (!/^5\d{8}$/.test(digits)) {
      setError(s.auth.invalidPhone);
      haptic.warning();
      return;
    }
    setError(undefined);
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep('code');
    }, 700);
  };
  const submitCode = () => {
    if (!/^\d{4}$/.test(code)) {
      setError(s.auth.invalidCode);
      haptic.warning();
      return;
    }
    setError(undefined);
    setStep('name');
  };
  const finish = () => {
    if (!name.trim()) {
      setError(s.addresses.required);
      return;
    }
    signIn({ name: name.trim(), phone: `+966${digits}` });
    haptic.success();
    router.back();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<ScreenHeader back dismiss="close" inSheet />}>
        <View style={{ gap: space.md, marginTop: space.lg, marginBottom: space.xxl }}>
          <LogoSymbol width={96} />
          <Text variant="title1">{s.auth.title}</Text>
          <Text variant="body" color="textSecondary">
            {s.auth.subtitle}
          </Text>
        </View>

        <Animated.View key={step} entering={enterUp()} style={{ gap: space.lg }}>
          {step === 'phone' ? (
            <>
              <Input label={s.auth.phone} prefix="+966" placeholder={s.auth.phonePlaceholder} keyboardType="phone-pad" value={phone} onChangeText={setPhone} error={error} maxLength={11} ltr autoFocus textContentType="telephoneNumber" />
              <Button label={s.auth.sendCode} onPress={submitPhone} loading={loading} />
            </>
          ) : step === 'code' ? (
            <>
              <Input label={s.auth.code} placeholder="••••" keyboardType="number-pad" value={code} onChangeText={setCode} error={error} hint={s.auth.codeHint} maxLength={4} ltr autoFocus textContentType="oneTimeCode" style={{ letterSpacing: 8, fontSize: 22 }} />
              <Button label={s.auth.verify} onPress={submitCode} />
            </>
          ) : (
            <>
              <Input label={s.auth.name} placeholder={s.auth.namePlaceholder} value={name} onChangeText={setName} error={error} autoFocus textContentType="name" />
              <Button label={s.auth.createAccount} onPress={finish} />
            </>
          )}
          <Button label={s.auth.continueAsGuest} variant="ghost" onPress={() => router.back()} />
          <Notice tone="sample" text={s.auth.simulatedNote} />
        </Animated.View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
