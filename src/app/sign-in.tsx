import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { LogoSymbol } from '@/brand/Logo';
import { isRemote } from '@/config/env';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { requestOtp, updateProfile, verifyOtp } from '@/services/remote/account';
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
  /**
   * Remote sandbox only: no SMS provider exists yet, so a NON-production API returns the code
   * (`sandboxCode`) and we show it as a hint. A production API never returns it.
   */
  const [sandboxCode, setSandboxCode] = useState<string>();

  const digits = phone.replace(/\D/g, '');
  const codeLength = isRemote ? 6 : 4;

  const submitPhoneRemote = async () => {
    setLoading(true);
    try {
      const res = await requestOtp(`+966${digits}`);
      setSandboxCode(res.sandboxCode);
      setCode('');
      setStep('code');
    } catch (e) {
      setError(apiErrorMessage(s, e));
      haptic.warning();
    } finally {
      setLoading(false);
    }
  };

  const submitCodeRemote = async () => {
    setLoading(true);
    try {
      const user = await verifyOtp(`+966${digits}`, code);
      haptic.success();
      if (user.name) router.back();
      else setStep('name');
    } catch (e) {
      setError(apiErrorMessage(s, e));
      haptic.warning();
    } finally {
      setLoading(false);
    }
  };

  const finishRemote = async () => {
    setLoading(true);
    try {
      await updateProfile({ name: name.trim() });
      haptic.success();
      router.back();
    } catch (e) {
      setError(apiErrorMessage(s, e));
    } finally {
      setLoading(false);
    }
  };

  const submitPhone = () => {
    if (!/^5\d{8}$/.test(digits)) {
      setError(s.auth.invalidPhone);
      haptic.warning();
      return;
    }
    setError(undefined);
    if (isRemote) {
      submitPhoneRemote();
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep('code');
    }, 700);
  };
  const submitCode = () => {
    if (!new RegExp(`^\\d{${codeLength}}$`).test(code)) {
      setError(isRemote ? s.remote.invalidCode : s.auth.invalidCode);
      haptic.warning();
      return;
    }
    setError(undefined);
    if (isRemote) {
      submitCodeRemote();
      return;
    }
    setStep('name');
  };
  const finish = () => {
    if (!name.trim() || name.trim().length < 2) {
      setError(s.addresses.required);
      return;
    }
    if (isRemote) {
      finishRemote();
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
              <Input label={s.auth.code} placeholder={'•'.repeat(codeLength)} keyboardType="number-pad" value={code} onChangeText={setCode} error={error} hint={isRemote ? s.remote.codeHint : s.auth.codeHint} maxLength={codeLength} ltr autoFocus textContentType="oneTimeCode" style={{ letterSpacing: 8, fontSize: 22 }} />
              {sandboxCode ? <Notice tone="info" icon="hash" text={s.remote.sandboxCodeHint(sandboxCode)} /> : null}
              <Button label={s.auth.verify} onPress={submitCode} loading={loading} />
              {isRemote ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label={s.remote.resendCode} variant="secondary" size="sm" style={{ flex: 1 }} onPress={submitPhoneRemote} disabled={loading} />
                  <Button label={s.remote.changePhone} variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => { setError(undefined); setStep('phone'); }} disabled={loading} />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Input label={s.auth.name} placeholder={s.auth.namePlaceholder} value={name} onChangeText={setName} error={error} autoFocus textContentType="name" />
              <Button label={s.auth.createAccount} onPress={finish} loading={loading} />
            </>
          )}
          {step !== 'name' ? <Button label={s.auth.continueAsGuest} variant="ghost" onPress={() => router.back()} /> : null}
          {isRemote ? null : <Notice tone="sample" text={s.auth.simulatedNote} />}
        </Animated.View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
