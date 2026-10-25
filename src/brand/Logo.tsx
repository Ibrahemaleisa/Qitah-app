import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { colors, palette } from '@/theme/tokens';
import { Text } from '@/ui/Text';

type MarkProps = {
  size?: number;
  /** `light` for dark backgrounds. */
  tone?: 'dark' | 'light';
  /** Render only one layer — used by the splash animation to spin the rotor under the caliper. */
  layer?: 'all' | 'rotor' | 'caliper';
};

const HOLE_ANGLES = [0, 72, 144, 216, 288];

/**
 * The Qitah mark: a brake rotor reduced to a disc, a hub and five cross-drilled holes,
 * clamped by a single orange caliper arc. Built on a 100-unit grid so it stays crisp
 * from 16px favicons to 1024px App Store artwork.
 */
export function LogoMark({ size = 48, tone = 'dark', layer = 'all' }: MarkProps) {
  const disc = tone === 'dark' ? palette.ink900 : palette.paper50;
  const cut = tone === 'dark' ? palette.paper50 : palette.ink900;
  return (
    <Svg width={size} height={size} viewBox="0 2 100 100">
      {layer !== 'caliper' ? (
        <G>
          <Circle cx={50} cy={52} r={34} fill={disc} />
          <Circle cx={50} cy={52} r={11} fill={cut} />
          <Circle cx={50} cy={52} r={5} fill={disc} />
          {HOLE_ANGLES.map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            return <Circle key={deg} cx={50 + Math.cos(rad) * 22} cy={52 + Math.sin(rad) * 22} r={3.4} fill={cut} />;
          })}
        </G>
      ) : null}
      {/* Caliper: a thick arc gripping the upper-right edge of the disc. */}
      {layer !== 'rotor' ? <Path d={arc(50, 52, 37, -78, 18)} stroke={palette.orange500} strokeWidth={15} strokeLinecap="round" fill="none" /> : null}
    </Svg>
  );
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function Logo({ size = 40, tone = 'dark', showLatin = false }: MarkProps & { showLatin?: boolean }) {
  const textColor = tone === 'dark' ? colors.text : colors.textInverse;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.22 }}>
      <LogoMark size={size} tone={tone} />
      <View>
        <Text weight="bold" style={{ fontSize: size * 0.72, lineHeight: size * 1.02, color: textColor }}>
          قطعة
        </Text>
        {showLatin ? (
          <Text weight="semibold" style={{ fontSize: size * 0.26, lineHeight: size * 0.34, letterSpacing: size * 0.06, color: textColor, opacity: 0.7 }}>
            QITAH
          </Text>
        ) : null}
      </View>
    </View>
  );
}
