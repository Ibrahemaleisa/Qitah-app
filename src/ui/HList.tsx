import { Children, type ReactNode } from 'react';
import { FlatList, I18nManager, Platform, ScrollView, View, type FlatListProps, type StyleProp, type ViewStyle } from 'react-native';

import { useI18n } from '@/i18n';

/**
 * Native horizontal scroll views follow the *native* layout direction (I18nManager), which only
 * changes after an app restart. When the in-app language direction differs from it, we mirror
 * the scroller and un-mirror each item so lists still start from the reading edge.
 */
function useDirectionMismatch() {
  const { isRTL } = useI18n();
  return { mismatch: Platform.OS !== 'web' && isRTL !== I18nManager.isRTL, isRTL };
}

const flip: ViewStyle = { transform: [{ scaleX: -1 }] };

export function HList<T>(props: Omit<FlatListProps<T>, 'horizontal' | 'inverted'>) {
  const { mismatch, isRTL } = useDirectionMismatch();
  const { renderItem, style, ...rest } = props;
  return (
    <FlatList
      {...rest}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[style, mismatch ? [flip, { direction: I18nManager.isRTL ? 'rtl' : 'ltr' }] : null]}
      renderItem={(info) => (
        <View style={[{ direction: isRTL ? 'rtl' : 'ltr' }, mismatch ? flip : null]}>{renderItem?.(info)}</View>
      )}
    />
  );
}

export function HScroll({ children, gap = 8, contentPadding = 0, style }: { children: ReactNode; gap?: number; contentPadding?: number; style?: StyleProp<ViewStyle> }) {
  const { mismatch, isRTL } = useDirectionMismatch();
  const items = Children.toArray(children);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[style, mismatch ? [flip, { direction: I18nManager.isRTL ? 'rtl' : 'ltr' }] : null]}
      contentContainerStyle={{ paddingHorizontal: contentPadding, gap, alignItems: 'center' }}
    >
      {items.map((child, i) => (
        <View key={i} style={[{ direction: isRTL ? 'rtl' : 'ltr' }, mismatch ? flip : null]}>
          {child}
        </View>
      ))}
    </ScrollView>
  );
}
