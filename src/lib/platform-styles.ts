import { Platform, type TextStyle } from 'react-native';

/** Removes the browser focus ring on text inputs in the web preview (the input row shows its own focus border). */
export const webNoOutline: TextStyle = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {};
