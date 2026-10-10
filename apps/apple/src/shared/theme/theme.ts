import type { TextStyle } from 'react-native';
import { palettes, type Brand } from './palettes.ts';
import {
  spacing,
  radii,
  sizes,
  icons,
  typography,
  domainTones,
  type TextVariant,
} from './tokens.ts';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Tone = 'neutral' | 'brand' | keyof typeof domainTones.light;
export type TonePalette = { foreground: string; background: string; border: string };
export type ThemeColors = {
  background: string;
  surface: string;
  raised: string;
  brand: string;
  brandText: string;
  onBrand: string;
  brandSurface: string;
  brandBorder: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
  disabled: string;
};
export type Theme = {
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  sizes: typeof sizes;
  icons: typeof icons;
  typography: Record<TextVariant, TextStyle>;
  tones: Record<Tone, TonePalette>;
};
export type ThemeOverrides = {
  colors?: Partial<ThemeColors>;
  spacing?: Partial<typeof spacing>;
  radii?: Partial<typeof radii>;
  sizes?: Partial<typeof sizes>;
  icons?: Partial<typeof icons>;
  typography?: Partial<Record<TextVariant, TextStyle>>;
  tones?: Partial<Record<Tone, Partial<TonePalette>>>;
};

export function createTheme(
  mode: 'light' | 'dark',
  brand: Brand,
  overrides: ThemeOverrides = {},
): Theme {
  const colors = {
    ...palettes[brand][mode],
    text: mode === 'dark' ? '#fafafa' : '#121212',
    muted: mode === 'dark' ? '#b2b8b3' : '#666666',
    border: mode === 'dark' ? '#ffffff18' : '#e8e8e8',
    danger: mode === 'dark' ? '#ff8d86' : '#c62828',
    disabled: mode === 'dark' ? '#809084' : '#717a73',
    ...overrides.colors,
  };
  const tones = {
    ...domainTones[mode],
    brand: {
      foreground: colors.brandText,
      background: colors.brandSurface,
      border: colors.brandBorder,
    },
    neutral: { foreground: colors.muted, background: colors.raised, border: colors.border },
  };
  for (const key of Object.keys(overrides.tones ?? {}) as Tone[]) {
    tones[key] = { ...tones[key], ...overrides.tones?.[key] };
  }
  const textStyles: Record<TextVariant, TextStyle> = { ...typography };
  for (const key of Object.keys(overrides.typography ?? {}) as TextVariant[]) {
    textStyles[key] = { ...typography[key], ...overrides.typography?.[key] };
  }
  return {
    mode,
    colors,
    tones,
    spacing: { ...spacing, ...overrides.spacing },
    radii: { ...radii, ...overrides.radii },
    sizes: { ...sizes, ...overrides.sizes },
    icons: { ...icons, ...overrides.icons },
    typography: textStyles,
  };
}
