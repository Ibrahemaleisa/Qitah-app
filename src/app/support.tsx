import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';

export default function Support() {
  const { s } = useI18n();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Screen header={<ScreenHeader back title={s.support.title} />}>
      <Section title={s.support.faq} style={{ marginTop: space.sm }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
          {s.support.faqs.map((f, i) => (
            <Pressable key={i} onPress={() => setOpen(open === i ? null : i)} pressScale={0.995} accessibilityLabel={f.q} accessibilityState={{ expanded: open === i }}>
              <View style={{ padding: space.lg, gap: space.sm, borderBottomWidth: i === s.support.faqs.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {f.q}
                  </Text>
                  <Icon name={open === i ? 'minus' : 'plus'} size={18} color="accent" />
                </View>
                {open === i ? (
                  <Animated.View entering={FadeIn.duration(200)}>
                    <Text variant="callout" color="textSecondary">
                      {f.a}
                    </Text>
                  </Animated.View>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={s.support.contact}>
        <Notice tone="info" icon="message-square" text={s.support.contactNote} />
      </Section>
    </Screen>
  );
}
