import type { TextStyle } from 'react-native';
import { healthArtColors, healthHeroGradients } from './health-heroes';
import { createBackgroundTheme, type BackgroundTheme } from './backgrounds';
import { STAGE_COLOR } from '@trainingai/shared/health/hypnogram';
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones';
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors';
import { palettes, type Brand } from './palettes.ts';
import {
  spacing,
  radii,
  sizes,
  icons,
  typography,
  domainTones,
  anatomy,
  sessionTones,
  sessionFills,
  scoreColors,
  weatherColors,
  homeCardColors,
  effortColors,
  progressColors,
  friendColors,
  trainingColors,
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
  scrim: string;
  onSignal: string;
};
export type Theme = {
  backgrounds: BackgroundTheme;
  weatherColors: typeof weatherColors;
  homeCards: typeof homeCardColors;
  scores: typeof scoreColors.light;
  macros: Record<keyof typeof MACRO_COLORS, string>;
  healthArtColors: Record<string, string>;
  healthHeroGradients: typeof healthHeroGradients;
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  sizes: typeof sizes;
  icons: typeof icons;
  typography: Record<TextVariant, TextStyle>;
  tones: Record<Tone, TonePalette>;
  anatomy: typeof anatomy;
  sessions: TonePalette[];
  effort: Record<number, string>;
  sleepStages: typeof STAGE_COLOR;
  hrZoneColors: string[];
  progress: typeof progressColors.light;
  friends: typeof friendColors.light;
  training: Omit<typeof trainingColors.light, 'phases'> & {
    phases: Record<'baseline' | keyof typeof trainingColors.light.phases, string>;
  };
};
export type ThemeOverrides = {
  backgrounds?: Partial<BackgroundTheme>;
  weatherColors?: Partial<typeof weatherColors>;
  homeCards?: Partial<typeof homeCardColors>;
  scores?: Partial<typeof scoreColors.light>;
  macros?: Partial<Record<keyof typeof MACRO_COLORS, string>>;
  healthArtColors?: Record<string, string>;
  healthHeroGradients?: Partial<typeof healthHeroGradients>;
  colors?: Partial<ThemeColors>;
  spacing?: Partial<typeof spacing>;
  radii?: Partial<typeof radii>;
  sizes?: Partial<typeof sizes>;
  icons?: Partial<typeof icons>;
  typography?: Partial<Record<TextVariant, TextStyle>>;
  tones?: Partial<Record<Tone, Partial<TonePalette>>>;
  anatomy?: Partial<typeof anatomy>;
  sessions?: TonePalette[];
  effort?: Record<number, string>;
  sleepStages?: Partial<typeof STAGE_COLOR>;
  hrZoneColors?: string[];
  progress?: Partial<Omit<typeof progressColors.light, 'goals'>> & {
    goals?: Partial<typeof progressColors.light.goals>;
  };
  training?: Partial<Omit<typeof trainingColors.light, 'phases'>> & {
    phases?: Partial<Theme['training']['phases']>;
  };
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
    scrim: '#00000088',
    onSignal: '#000000',
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
    backgrounds: { ...createBackgroundTheme(mode), ...overrides.backgrounds },
    weatherColors: { ...weatherColors, ...overrides.weatherColors },
    homeCards: { ...homeCardColors, ...overrides.homeCards },
    scores: { ...scoreColors[mode], ...overrides.scores },
    macros: { ...MACRO_COLORS, ...overrides.macros },
    healthArtColors: { ...healthArtColors, ...overrides.healthArtColors },
    healthHeroGradients: { ...healthHeroGradients, ...overrides.healthHeroGradients },
    mode,
    colors,
    tones,
    spacing: { ...spacing, ...overrides.spacing },
    radii: { ...radii, ...overrides.radii },
    sizes: { ...sizes, ...overrides.sizes },
    icons: { ...icons, ...overrides.icons },
    anatomy: { ...anatomy, ...overrides.anatomy },
    effort: { ...effortColors, ...overrides.effort },
    sleepStages: { ...STAGE_COLOR, ...overrides.sleepStages },
    hrZoneColors: overrides.hrZoneColors ?? HR_ZONE_META.map((zone) => zone.color),
    friends: friendColors[mode],
    progress: {
      ...progressColors[mode],
      ...overrides.progress,
      goals: { ...progressColors[mode].goals, ...overrides.progress?.goals },
    },
    training: {
      ...trainingColors[mode],
      ...overrides.training,
      phases: {
        baseline: colors.muted,
        ...trainingColors[mode].phases,
        ...overrides.training?.phases,
      },
    },
    sessions:
      overrides.sessions ??
      sessionTones[mode].map((foreground, index) => ({
        foreground,
        background: `${sessionFills[index]}33`,
        border: `${sessionFills[index]}4d`,
      })),
    typography: textStyles,
  };
}
