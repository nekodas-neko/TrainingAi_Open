import type { TextStyle } from 'react-native';

// Geist is the current app's typeface. The six faces are embedded in the APK by the expo-font
// plugin in app.json, and each registers under its file name. Android picks no weight from one
// family name, so every weight maps to its own face here and the weight itself is dropped, which
// keeps Android from drawing faux bold over a face that is already bold.
export const geistFaces = {
  '400': 'Geist_400Regular',
  '500': 'Geist_500Medium',
  '600': 'Geist_600SemiBold',
  '700': 'Geist_700Bold',
  '800': 'Geist_800ExtraBold',
  '900': 'Geist_900Black',
} as const;

export type GeistWeight = keyof typeof geistFaces;

export function geistFace(weight: TextStyle['fontWeight']): string | undefined {
  if (weight === undefined || weight === 'normal') return geistFaces['400'];
  if (weight === 'bold') return geistFaces['700'];
  return geistFaces[String(weight) as GeistWeight];
}

// The style a Text or TextInput should draw, given an already flattened style: its family follows the final weight, so an inline
// override such as `fontWeight: '600'` lands on the right face. A weight with no face is kept
// as is, so the test below catches it instead of the screen quietly using the system font.
export function withGeist(style: TextStyle): TextStyle {
  const { fontWeight, ...rest } = style;
  const fontFamily = rest.fontFamily ?? geistFace(fontWeight);
  return fontFamily ? { ...rest, fontFamily } : { ...rest, fontWeight };
}
