import { Platform, View } from 'react-native';

import type { Lang } from '@/domain/types';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';

export default function Language() {
  const { s, lang } = useI18n();
  const setLang = useAppStore((st) => st.setLang);
  const choose = (l: Lang) => {
    if (l === lang) return;
    setLang(l);
    haptic.success();
  };
  return (
    <Screen header={<ScreenHeader back title={s.language.title} />}>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <ChoiceRow title={s.language.ar} subtitle="Arabic" selected={lang === 'ar'} onPress={() => choose('ar')} />
        <ChoiceRow title={s.language.en} subtitle="الإنجليزية" selected={lang === 'en'} onPress={() => choose('en')} />
        {Platform.OS !== 'web' ? (
          <View style={{ marginTop: space.md }}>
            <Notice tone="info" text={s.language.restartNote} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
