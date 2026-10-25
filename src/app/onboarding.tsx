import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoMark } from '@/brand/Logo';
import { PartArt } from '@/brand/PartArt';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { colors, gutter, palette, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

export default function Onboarding() {
  const { s, isRTL, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const setLang = useAppStore((st) => st.setLang);
  const completeOnboarding = useAppStore((st) => st.completeOnboarding);
  const [index, setIndex] = useState(0);
  const slides = s.onboarding.slides;
  const last = index === slides.length - 1;

  const finish = () => {
    completeOnboarding();
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.ink900, direction: isRTL ? 'rtl' : 'ltr' }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <LogoMark size={34} tone="light" />
          <Text variant="title2" weight="bold" color="textInverse">
            {s.brand.name}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Pressable onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')} haptics="tap" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.ink700 }} accessibilityLabel={s.onboarding.language}>
            <Icon name="globe" size={14} color={palette.paper300} />
            <Text variant="caption" weight="medium" style={{ color: palette.paper300 }}>
              {s.onboarding.language}
            </Text>
          </Pressable>
          {!last ? (
            <Pressable onPress={finish} haptics="tap" style={{ paddingHorizontal: space.md, height: 34, justifyContent: 'center' }} accessibilityLabel={s.onboarding.skip}>
              <Text variant="callout" weight="medium" style={{ color: palette.paper300 }}>
                {s.onboarding.skip}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: gutter }}>
        <Animated.View key={`art-${index}`} entering={FadeIn.duration(380)} exiting={FadeOut.duration(150)} style={{ width: '100%', alignItems: 'center' }}>
          {index === 0 ? <VehicleVignette /> : index === 1 ? <CompareVignette /> : <DeliveryVignette />}
        </Animated.View>
      </View>

      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingHorizontal: gutter, paddingTop: space.xxl, paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }}>
        <Animated.View key={`txt-${index}-${lang}`} entering={FadeInDown.duration(320)} style={{ minHeight: 132, gap: space.sm }}>
          <Text variant="title1">{slides[index].title}</Text>
          <Text variant="body" color="textSecondary">
            {slides[index].body}
          </Text>
        </Animated.View>
        <View style={{ flexDirection: 'row', gap: 6, marginVertical: space.lg }}>
          {slides.map((_, i) => (
            <Pressable key={i} onPress={() => setIndex(i)} hitSlop={8} accessibilityLabel={`${i + 1}`}>
              <View style={{ width: i === index ? 26 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? colors.accent : colors.lineStrong }} />
            </Pressable>
          ))}
        </View>
        <Button label={last ? s.onboarding.start : s.onboarding.next} icon={last ? undefined : undefined} onPress={() => (last ? finish() : setIndex(index + 1))} />
        <Text variant="caption" color="textTertiary" align="center" style={{ marginTop: space.md }}>
          {s.onboarding.noAccountNeeded}
        </Text>
      </View>
    </View>
  );
}

function VignetteCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[{ backgroundColor: palette.ink800, borderRadius: radius.xl, borderWidth: 1, borderColor: palette.ink700, padding: space.lg }, style]}>{children}</View>;
}

function VehicleVignette() {
  const { lang } = useI18n();
  return (
    <View style={{ width: '100%', maxWidth: 340, gap: space.md }}>
      <VignetteCard style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: palette.orange500, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="truck" size={22} color="textOnAccent" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline" color="textInverse">
            {lang === 'ar' ? 'تويوتا كامري 2022' : 'Toyota Camry 2022'}
          </Text>
          <Text variant="caption" style={{ color: palette.ink400 }} ltr>
            GLE · 2.5L I4
          </Text>
        </View>
      </VignetteCard>
      {(['pads', 'oilFilter'] as const).map((art, i) => (
        <VignetteCard key={art} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginStart: (i + 1) * 18 }}>
          <PartArt kind={art} size={44} background={palette.ink700} rounded={radius.sm} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 8, width: '70%', borderRadius: 4, backgroundColor: palette.ink700 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="check-circle" size={12} color={palette.green600} />
              <View style={{ height: 6, width: 60, borderRadius: 3, backgroundColor: palette.green600, opacity: 0.6 }} />
            </View>
          </View>
        </VignetteCard>
      ))}
    </View>
  );
}

function CompareVignette() {
  const rows = [
    { w: '62%', price: '219', best: true },
    { w: '48%', price: '236', best: false },
    { w: '55%', price: '248', best: false },
  ];
  return (
    <View style={{ width: '100%', maxWidth: 340, gap: space.sm }}>
      <View style={{ alignItems: 'center', marginBottom: space.md }}>
        <PartArt kind="rotor" size={120} background={palette.ink800} rounded={radius.xl} />
      </View>
      {rows.map((r, i) => (
        <VignetteCard key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderColor: r.best ? palette.orange500 : palette.ink700 }}>
          <View style={{ width: 30, height: 30, borderRadius: radius.sm, backgroundColor: palette.ink700 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 8, width: r.w as `${number}%`, borderRadius: 4, backgroundColor: palette.ink700 }} />
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {[0, 1, 2, 3, 4].map((st) => (
                <Icon key={st} name="star" size={9} color={st < 4 - i * 0.5 ? palette.orange500 : palette.ink700} />
              ))}
            </View>
          </View>
          <Text variant="bodyStrong" style={{ color: r.best ? palette.orange500 : palette.paper300 }} ltr>
            {r.price}
          </Text>
        </VignetteCard>
      ))}
    </View>
  );
}

function DeliveryVignette() {
  const node = (icon: IconName, accent?: boolean) => (
    <View style={{ width: 72, height: 72, borderRadius: radius.xl, backgroundColor: accent ? palette.orange500 : palette.ink800, borderWidth: 1, borderColor: accent ? palette.orange500 : palette.ink700, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={28} color={accent ? 'textOnAccent' : palette.paper300} />
    </View>
  );
  const dash = <View style={{ flex: 1, height: 2, borderTopWidth: 2, borderStyle: 'dashed', borderColor: palette.ink700, marginHorizontal: space.sm }} />;
  return (
    <View style={{ width: '100%', maxWidth: 340, gap: space.xxl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {node('package')}
        {dash}
        {node('truck', true)}
        {dash}
        {node('home')}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
        <View style={{ width: 120, height: 2, borderTopWidth: 2, borderStyle: 'dashed', borderColor: palette.ink700, marginHorizontal: space.sm }} />
        {node('tool')}
      </View>
      <VignetteCard style={{ gap: space.sm }}>
        {[1, 1, 1, 0].map((done, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: done ? palette.orange500 : palette.ink700 }} />
            <View style={{ height: 7, width: `${70 - i * 12}%`, borderRadius: 4, backgroundColor: palette.ink700 }} />
          </View>
        ))}
      </VignetteCard>
    </View>
  );
}
