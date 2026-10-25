import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useI18n } from '@/i18n';
import { latinFonts, palette, fonts } from '@/theme/tokens';
import { Text } from '@/ui/Text';

import { CAR_PATH, PIECE_PATH, SYMBOL_VIEWBOX } from './symbol';

/**
 * Symbol colourways (guidelines p.8 / p.29):
 * primary (blue car + orange piece, light backgrounds), dark (white car + orange piece, blue or dark
 * backgrounds), mono-black / mono-white (single colour). `pending` and `faint` are the car-only states
 * used by the compatibility indicator (p.31).
 */
export type SymbolTone = 'primary' | 'dark' | 'mono-black' | 'mono-white' | 'pending' | 'faint';

const toneColors: Record<SymbolTone, { car: string; piece: string | null }> = {
  primary: { car: palette.qitahBlue, piece: palette.qitahOrange },
  dark: { car: palette.white, piece: palette.qitahOrange },
  'mono-black': { car: '#000000', piece: '#000000' },
  'mono-white': { car: palette.white, piece: palette.white },
  pending: { car: palette.slate, piece: null },
  faint: { car: palette.lineStrong, piece: null },
};

type SymbolProps = {
  /** Rendered width in points. Minimum 24 (guidelines p.7). */
  width: number;
  tone?: SymbolTone;
  /** Render a single shape (splash animation). */
  layer?: 'all' | 'car' | 'piece';
};

export function LogoSymbol({ width, tone = 'primary', layer = 'all' }: SymbolProps) {
  const c = toneColors[tone];
  const height = (width * SYMBOL_VIEWBOX.height) / SYMBOL_VIEWBOX.width;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${SYMBOL_VIEWBOX.width} ${SYMBOL_VIEWBOX.height}`} accessible={false}>
      {layer !== 'piece' ? <Path d={CAR_PATH} fill={c.car} /> : null}
      {layer !== 'car' && c.piece ? <Path d={PIECE_PATH} fill={c.piece} /> : null}
    </Svg>
  );
}

/** Only the orange piece — the brand's "selected / fits" marker (p.14). Direction never mirrors. */
export function PieceMark({ width }: { width: number }) {
  // The piece occupies x 93.7–395.6, y 73.6–194.9 of the symbol viewBox.
  const vb = { x: 93.7, y: 73.6, w: 301.91, h: 121.27 };
  return (
    <Svg width={width} height={(width * vb.h) / vb.w} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} accessible={false}>
      <Path d={PIECE_PATH} fill={palette.qitahOrange} />
    </Svg>
  );
}

type LogoProps = {
  /** Symbol height in points; the wordmark is sized from it. */
  height?: number;
  tone?: 'primary' | 'dark';
  /** Defaults to the app language: Arabic lockup (symbol right) or Latin lockup (symbol left). */
  lockup?: 'ar' | 'en';
};

/**
 * Horizontal lockups (p.5–6). The symbol precedes the word on the right in Arabic, on the left in
 * English; the lockup itself never mirrors. Wordmarks are set in IBM Plex Sans Arabic / IBM Plex Sans
 * Bold as specified. Minimum logo width 96pt (p.7).
 */
export function Logo({ height = 26, tone = 'primary', lockup }: LogoProps) {
  const { lang } = useI18n();
  const which = lockup ?? lang;
  const width = (height * SYMBOL_VIEWBOX.width) / SYMBOL_VIEWBOX.height;
  const color = tone === 'primary' ? palette.qitahBlue : palette.white;
  const word =
    which === 'ar' ? (
      <Text style={{ fontFamily: fonts.bold, fontSize: height * 1.3, lineHeight: height * 1.7, color }} accessible={false}>
        قطعة
      </Text>
    ) : (
      <Text style={{ fontFamily: latinFonts.bold, fontSize: height * 1.08, lineHeight: height * 1.4, color }} accessible={false}>
        Qitah
      </Text>
    );
  const symbol = <LogoSymbol width={width} tone={tone === 'primary' ? 'primary' : 'dark'} />;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="قطعة · Qitah" style={{ direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: height * 0.42 }}>
      {which === 'ar' ? word : symbol}
      {which === 'ar' ? symbol : word}
    </View>
  );
}
