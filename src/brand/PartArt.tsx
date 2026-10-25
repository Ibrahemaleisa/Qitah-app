import { View, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Polyline, Rect } from 'react-native-svg';

import type { PartArtKind } from '@/domain/types';
import { palette, radius } from '@/theme/tokens';

const INK = palette.ink800;
const MID = palette.ink500;
const SOFT = palette.paper300;
const LIGHT = palette.paper50;
const ACC = palette.orange500;

/**
 * Geometric part illustrations used in place of product photography in this demo build.
 * Real listings will use merchant / catalog imagery through `expo-image`.
 */
function Art({ kind }: { kind: PartArtKind }) {
  switch (kind) {
    case 'rotor':
      return (
        <G>
          <Circle cx={60} cy={62} r={40} fill={INK} />
          <Circle cx={60} cy={62} r={31} fill="none" stroke={MID} strokeWidth={1.5} />
          {[0, 60, 120, 180, 240, 300].map((d) => {
            const r = ((d - 90) * Math.PI) / 180;
            return <Circle key={d} cx={60 + Math.cos(r) * 24} cy={62 + Math.sin(r) * 24} r={3} fill={LIGHT} />;
          })}
          <Circle cx={60} cy={62} r={13} fill={SOFT} />
          <Circle cx={60} cy={62} r={5} fill={INK} />
          <Path d="M 74 22 A 42 42 0 0 1 101 52" stroke={ACC} strokeWidth={13} strokeLinecap="round" fill="none" />
        </G>
      );
    case 'pads':
      return (
        <G>
          <Path d="M 18 46 Q 60 22 102 46 L 98 62 Q 60 42 22 62 Z" fill={INK} />
          <Path d="M 24 60 Q 60 41 96 60 L 93 72 Q 60 56 27 72 Z" fill={MID} />
          <Path d="M 18 72 Q 60 48 102 72 L 98 88 Q 60 68 22 88 Z" fill={INK} />
          <Path d="M 24 86 Q 60 67 96 86 L 93 98 Q 60 82 27 98 Z" fill={MID} />
          <Rect x={54} y={30} width={12} height={6} rx={3} fill={ACC} />
        </G>
      );
    case 'oilFilter':
      return (
        <G>
          <Rect x={32} y={30} width={56} height={70} rx={10} fill={INK} />
          <Rect x={32} y={56} width={56} height={16} fill={ACC} />
          <Ellipse cx={60} cy={30} rx={28} ry={7} fill={MID} />
          <Ellipse cx={60} cy={30} rx={10} ry={3} fill={INK} />
          {[40, 48, 80, 88].map((y) => (
            <Line key={y} x1={36} y1={y} x2={84} y2={y} stroke={MID} strokeWidth={1.2} />
          ))}
        </G>
      );
    case 'airFilter':
      return (
        <G>
          <Rect x={18} y={34} width={84} height={56} rx={8} fill={ACC} />
          <Rect x={25} y={41} width={70} height={42} rx={4} fill={LIGHT} />
          <Polyline points="25,41 30,83 35,41 40,83 45,41 50,83 55,41 60,83 65,41 70,83 75,41 80,83 85,41 90,83 95,41" fill="none" stroke={MID} strokeWidth={1.4} />
        </G>
      );
    case 'sparkPlug':
      return (
        <G transform="rotate(-30 60 60)">
          <Rect x={54} y={10} width={12} height={12} rx={2} fill={MID} />
          <Rect x={50} y={22} width={20} height={34} rx={6} fill={LIGHT} stroke={SOFT} strokeWidth={1.5} />
          {[30, 37, 44].map((y) => (
            <Line key={y} x1={50} y1={y} x2={70} y2={y} stroke={SOFT} strokeWidth={1.5} />
          ))}
          <Rect x={46} y={56} width={28} height={14} rx={2} fill={INK} />
          <Rect x={52} y={70} width={16} height={22} fill={MID} />
          {[74, 79, 84, 89].map((y) => (
            <Line key={y} x1={52} y1={y} x2={68} y2={y + 2} stroke={INK} strokeWidth={1.4} />
          ))}
          <Path d="M 60 92 L 60 100 L 66 100" stroke={ACC} strokeWidth={3.5} fill="none" strokeLinecap="round" />
        </G>
      );
    case 'battery':
      return (
        <G>
          <Rect x={30} y={30} width={14} height={10} rx={2} fill={MID} />
          <Rect x={76} y={30} width={14} height={10} rx={2} fill={MID} />
          <Rect x={18} y={38} width={84} height={58} rx={9} fill={INK} />
          <Rect x={18} y={38} width={84} height={14} rx={9} fill={MID} />
          <Line x1={30} y1={72} x2={44} y2={72} stroke={ACC} strokeWidth={4} strokeLinecap="round" />
          <Line x1={37} y1={65} x2={37} y2={79} stroke={ACC} strokeWidth={4} strokeLinecap="round" />
          <Line x1={76} y1={72} x2={90} y2={72} stroke={LIGHT} strokeWidth={4} strokeLinecap="round" />
        </G>
      );
    case 'shock':
      return (
        <G transform="rotate(-20 60 60)">
          <Rect x={57} y={8} width={6} height={36} fill={MID} />
          <Circle cx={60} cy={10} r={7} fill="none" stroke={INK} strokeWidth={4} />
          <Rect x={48} y={44} width={24} height={56} rx={6} fill={INK} />
          <Circle cx={60} cy={108} r={7} fill="none" stroke={INK} strokeWidth={4} />
          <Polyline points="44,30 76,38 44,46 76,54 44,62 76,70 44,78 76,86" fill="none" stroke={ACC} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        </G>
      );
    case 'headlight':
      return (
        <G>
          <Path d="M 14 44 Q 18 30 40 30 L 100 34 Q 108 36 106 50 L 100 84 Q 98 92 88 92 L 30 90 Q 14 88 14 72 Z" fill={INK} />
          <Circle cx={44} cy={62} r={17} fill={MID} />
          <Circle cx={44} cy={62} r={9} fill={LIGHT} />
          <Circle cx={80} cy={60} r={11} fill={MID} />
          <Circle cx={80} cy={60} r={5} fill={LIGHT} />
          <Path d="M 22 82 Q 60 78 98 76" stroke={ACC} strokeWidth={4} strokeLinecap="round" fill="none" />
        </G>
      );
    case 'radiator':
      return (
        <G>
          <Rect x={16} y={26} width={14} height={72} rx={4} fill={ACC} />
          <Rect x={90} y={26} width={14} height={72} rx={4} fill={ACC} />
          <Rect x={30} y={30} width={60} height={64} fill={INK} />
          {[36, 42, 48, 54, 60, 66, 72, 78, 84, 90].map((y) => (
            <Line key={y} x1={30} y1={y} x2={90} y2={y} stroke={MID} strokeWidth={1.4} />
          ))}
          <Rect x={92} y={18} width={10} height={10} rx={3} fill={MID} />
        </G>
      );
    case 'oil':
      return (
        <G>
          <Path d="M 40 30 L 62 30 L 70 22 L 82 22 L 82 32 L 88 40 L 88 100 Q 88 104 84 104 L 36 104 Q 32 104 32 100 L 32 40 Q 32 30 40 30 Z" fill={INK} />
          <Rect x={38} y={52} width={44} height={34} rx={4} fill={ACC} />
          <Path d="M 60 59 Q 52 70 52 74 A 8 8 0 0 0 68 74 Q 68 70 60 59 Z" fill={LIGHT} />
        </G>
      );
    case 'mirror':
      return (
        <G>
          <Path d="M 20 40 Q 22 26 40 26 L 92 30 Q 104 32 102 48 L 98 78 Q 96 90 82 90 L 34 88 Q 18 86 18 70 Z" fill={INK} />
          <Path d="M 28 44 Q 30 34 42 34 L 88 37 Q 95 38 94 48 L 91 74 Q 90 81 81 81 L 37 80 Q 27 79 27 69 Z" fill={MID} />
          <Path d="M 36 40 L 54 38 L 34 66 Z" fill={LIGHT} opacity={0.35} />
          <Path d="M 80 90 L 74 104 L 92 104 L 96 88" fill={INK} />
          <Path d="M 22 82 Q 50 90 96 84" stroke={ACC} strokeWidth={4} strokeLinecap="round" fill="none" />
        </G>
      );
    case 'belt':
      return (
        <G>
          <Path d="M 34 30 L 86 44 A 18 18 0 0 1 86 80 L 34 92 A 31 31 0 0 1 34 30 Z" fill="none" stroke={ACC} strokeWidth={7} strokeLinejoin="round" />
          <Circle cx={36} cy={61} r={25} fill={INK} />
          <Circle cx={36} cy={61} r={7} fill={MID} />
          <Circle cx={86} cy={62} r={14} fill={INK} />
          <Circle cx={86} cy={62} r={4} fill={MID} />
        </G>
      );
    case 'alternator':
      return (
        <G>
          <Circle cx={60} cy={62} r={38} fill={INK} />
          {[0, 30, 60, 90, 120, 150].map((d) => (
            <Line key={d} x1={60} y1={30} x2={60} y2={94} stroke={MID} strokeWidth={2} transform={`rotate(${d} 60 62)`} />
          ))}
          <Circle cx={60} cy={62} r={18} fill={ACC} />
          <Circle cx={60} cy={62} r={12} fill={INK} />
          <Circle cx={60} cy={62} r={4} fill={SOFT} />
        </G>
      );
    case 'bumper':
      return (
        <G>
          <Path d="M 8 50 Q 60 36 112 50 L 108 82 Q 60 96 12 82 Z" fill={INK} />
          <Rect x={36} y={60} width={48} height={14} rx={7} fill={MID} />
          {[44, 52, 60, 68, 76].map((x) => (
            <Line key={x} x1={x} y1={62} x2={x} y2={72} stroke={INK} strokeWidth={2} />
          ))}
          <Circle cx={22} cy={68} r={5} fill={ACC} />
          <Circle cx={98} cy={68} r={5} fill={ACC} />
        </G>
      );
    case 'pump':
      return (
        <G>
          <Circle cx={60} cy={60} r={40} fill={INK} />
          {[0, 60, 120, 180, 240, 300].map((d) => (
            <Path key={d} d="M 60 60 Q 70 40 60 26 Q 54 42 60 60 Z" fill={ACC} transform={`rotate(${d} 60 60)`} />
          ))}
          <Circle cx={60} cy={60} r={9} fill={SOFT} />
          <Circle cx={60} cy={60} r={3.5} fill={INK} />
        </G>
      );
  }
}

type Props = { kind: PartArtKind; size: number; rounded?: number; style?: ViewStyle; background?: string };

export function PartArt({ kind, size, rounded = radius.md, style, background = palette.paper200 }: Props) {
  return (
    <View style={[{ width: size, height: size, borderRadius: rounded, backgroundColor: background, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      <Svg width={size * 0.82} height={size * 0.82} viewBox="0 0 120 120">
        <Art kind={kind} />
      </Svg>
    </View>
  );
}
