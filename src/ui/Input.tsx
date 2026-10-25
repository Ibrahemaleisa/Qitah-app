import { forwardRef, useState } from 'react';
import { TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { useI18n } from '@/i18n';
import { webNoOutline } from '@/lib/platform-styles';
import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { fontFamilyFor, Text } from './Text';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
  prefix?: string;
  ltr?: boolean;
};

export const Input = forwardRef<TextInputInstance, Props>(function Input({ label, hint, error, icon, prefix, ltr, style, onFocus, onBlur, ...rest }, ref) {
  const { isRTL, lang } = useI18n();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.text : colors.lineStrong;
  const rtlText = isRTL && !ltr;
  return (
    <View style={{ gap: space.xs + 2 }}>
      {label ? (
        <Text variant="captionStrong" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 52,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          borderWidth: focused ? 1.5 : 1,
          borderColor,
          backgroundColor: colors.surface,
        }}
      >
        {icon ? <Icon name={icon} size={18} color="textTertiary" /> : null}
        {prefix ? (
          <Text variant="body" color="textSecondary" ltr>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              minWidth: 0,
              outlineWidth: 0,
              ...webNoOutline,
              fontFamily: fontFamilyFor('regular', lang, ltr ? 'latin' : 'text'),
              fontSize: 16,
              color: colors.text,
              paddingVertical: space.md,
              textAlign: rtlText ? 'right' : 'left',
              writingDirection: rtlText ? 'rtl' : 'ltr',
            },
            style,
          ]}
        />
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
