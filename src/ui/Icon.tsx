import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Feather>['name'];

const DIRECTIONAL = new Set<IconName>(['chevron-right', 'chevron-left', 'arrow-right', 'arrow-left', 'chevrons-right', 'chevrons-left', 'corner-down-right', 'log-out', 'send']);

type Props = {
  name: IconName;
  size?: number;
  color?: keyof typeof colors | string;
};

/** Feather line icons. Direction-sensitive glyphs (chevrons, arrows) mirror automatically in RTL. */
export function Icon({ name, size = 20, color = 'text' }: Props) {
  const { isRTL } = useI18n();
  const resolved = color in colors ? colors[color as keyof typeof colors] : color;
  const flip = isRTL && DIRECTIONAL.has(name);
  return <Feather name={name} size={size} color={resolved} style={flip ? { transform: [{ scaleX: -1 }] } : undefined} />;
}
