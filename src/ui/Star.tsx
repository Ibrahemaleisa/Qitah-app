import Svg, { Path } from 'react-native-svg';

const STAR = 'M12 2.5l2.9 6.06 6.6.86-4.84 4.6 1.22 6.56L12 17.4l-5.88 3.18 1.22-6.56L2.5 9.42l6.6-.86L12 2.5z';

/** Solid star glyph (Feather only ships an outline star). */
export function Star({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={STAR} fill={color} strokeLinejoin="round" />
    </Svg>
  );
}
