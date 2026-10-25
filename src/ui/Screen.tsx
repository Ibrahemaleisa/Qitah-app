import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { colors, gutter, space } from '@/theme/tokens';

import { IconButton } from './IconButton';
import { Text } from './Text';

type ScreenProps = {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  /** Applies the standard horizontal gutter to scroll content. */
  padded?: boolean;
  background?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** Set for screens without a header that should still clear the status bar. */
  safeTop?: boolean;
  scrollProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle'>;
};

/**
 * Root container for every screen. Applies the layout direction for the active language,
 * so Arabic screens lay out right-to-left regardless of the device locale.
 */
export function Screen({ children, header, footer, scroll = true, padded = true, background = colors.background, contentStyle, safeTop, scrollProps }: ScreenProps) {
  const { isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      {...scrollProps}
      contentContainerStyle={[{ paddingHorizontal: padded ? gutter : 0, paddingBottom: space.huge }, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: padded ? gutter : 0 }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: background, direction: isRTL ? 'rtl' : 'ltr', paddingTop: safeTop ? insets.top : 0 }}>
      {header}
      {content}
      {footer}
    </View>
  );
}

type HeaderProps = {
  title?: string;
  subtitle?: string;
  back?: boolean;
  /** `close` renders an X for modal / sheet presentations. */
  dismiss?: 'back' | 'close';
  right?: ReactNode;
  large?: boolean;
  /** Sheets are presented below the status bar and don't need the top inset. */
  inSheet?: boolean;
  transparent?: boolean;
};

export function ScreenHeader({ title, subtitle, back, dismiss = 'back', right, large, inSheet, transparent }: HeaderProps) {
  const { s } = useI18n();
  const insets = useSafeAreaInsets();
  const showBack = back ?? false;
  return (
    <View
      style={{
        paddingTop: inSheet ? space.lg : insets.top + space.xs,
        paddingHorizontal: gutter,
        paddingBottom: large ? space.md : space.sm,
        backgroundColor: transparent ? 'transparent' : colors.background,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: space.md }}>
        {showBack ? (
          <IconButton
            icon={dismiss === 'close' ? 'x' : 'chevron-left'}
            label={dismiss === 'close' ? s.common.close : s.common.back}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        ) : null}
        <View style={{ flex: 1 }}>
          {title && !large ? (
            <Text variant="headline" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {subtitle && !large ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={{ flexDirection: 'row', gap: space.sm }}>{right}</View> : null}
      </View>
      {large && title ? (
        <View style={{ marginTop: space.xs }}>
          <Text variant="display">{title}</Text>
          {subtitle ? (
            <Text variant="callout" color="textSecondary">
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Sticky bottom action area that respects the home indicator. */
export function StickyFooter({ children, inTabs }: { children: ReactNode; inTabs?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: gutter,
        paddingTop: space.md,
        paddingBottom: inTabs ? space.md : Math.max(insets.bottom, space.lg),
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        gap: space.sm,
      }}
    >
      {children}
    </View>
  );
}
