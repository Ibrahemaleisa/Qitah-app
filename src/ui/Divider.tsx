import { View } from 'react-native';

import { colors, space } from '@/theme/tokens';

export function Divider({ spacing = space.lg }: { spacing?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing }} />;
}
