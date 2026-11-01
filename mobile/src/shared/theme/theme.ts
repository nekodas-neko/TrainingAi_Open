import type { TextStyle } from 'react-native';
import { healthArtColors, healthHeroGradients, healthPageGradients } from './health-heroes';
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
  anatomyColors,
  statusColors,
  macroColorsLight,
  hrZoneColorsLight,
  sessionTones,
  sessionFills,
  scoreColors,
  weatherColors,
  homeCardColors,
  effortColors,
  progressColors,
  friendColors,
  rewardColors,
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
  /** The current app's default button: --primary / --primary-foreground, a neutral that flips with the theme. */
  primary: string;
  onPrimary: string;
  brandSurface: string;
  brandBorder: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
  disabled: string;
  scrim: string;
  onSignal: string;
  /** The empty part of a progress bar. */
  track: string;
  /** Chart gridlines and axes. */
  grid: string;
  /** Translucent glass over the Home wallpaper (the Energy hero's frame and band). */
  glass: string;
  /** The glass's hairline edge. */
  glassBorder: string;
  /** A gauge's empty track drawn over the wallpaper. */
  glassTrack: string;
};
export type Theme = {
  backgrounds: BackgroundTheme;
  weatherColors: typeof weatherColors.dark;
  homeCards: typeof homeCardColors;
  scores: typeof scoreColors.light;
  macros: Record<keyof typeof MACRO_COLORS, string>;
  healthArtColors: Record<string, string>;
  healthHeroGradients: typeof healthHeroGradients;
  healthPageGradients: typeof healthPageGradients;
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  sizes: typeof sizes;
  icons: typeof icons;
  typography: Record<TextVariant, TextStyle>;
  tones: Record<Tone, TonePalette>;
  anatomy: typeof anatomyColors.dark & { high: string };
  status: typeof statusColors.dark;
  coachFab: { background: string; foreground: string };
  sessions: TonePalette[];
  effort: Record<number, string>;
  sleepStages: typeof STAGE_COLOR;
  hrZoneColors: string[];
  progress: typeof progressColors.light;
  friends: typeof friendColors.light;
  rewards: typeof rewardColors.light;
  training: Omit<typeof trainingColors.light, 'phases'> & {
    phases: Record<'baseline' | keyof typeof trainingColors.light.phases, string>;
  };
};
export type ThemeOverrides = {
  backgrounds?: Partial<BackgroundTheme>;
  weatherColors?: Partial<typeof weatherColors.dark>;
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
  anatomy?: Partial<Theme['anatomy']>;
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
  const base = {
    ...palettes[brand][mode],
    text: mode === 'dark' ? '#fafafa' : '#121212',
    // app/globals.css: oklch(0.922 0 0) on dark, oklch(0.205 0 0) on light, and the foreground the other way.
    primary: mode === 'dark' ? '#e5e5e5' : '#171717',
    onPrimary: mode === 'dark' ? '#171717' : '#fafafa',
    muted: mode === 'dark' ? '#b2b8b3' : '#666666',
    border: mode === 'dark' ? '#ffffff18' : '#e8e8e8',
    danger: statusColors[mode].danger,
    disabled: mode === 'dark' ? '#809084' : '#717a73',
    scrim: '#00000088',
    onSignal: '#000000',
    grid: mode === 'dark' ? '#ffffff18' : '#d0d5d1',
    // The mockups' dark glass (12,14,20 at 42%) and, in light, white at 75%. D7 drew 70%, which
    // left the muted sub-text at 4.48:1 on a deep-night sky; 75% keeps it above 4.5:1 on every sky.
    glass: mode === 'dark' ? '#0c0e146b' : '#ffffffbf',
    glassBorder: mode === 'dark' ? '#ffffff24' : '#e8e8e8',
    glassTrack: mode === 'dark' ? '#ffffff1c' : '#dfe3e0',
    ...overrides.colors,
  };
  // Dark keeps the track it always had (the brand surface, whatever accent is chosen).
  const colors: ThemeColors = {
    ...base,
    track: overrides.colors?.track ?? (mode === 'dark' ? base.brandSurface : '#dfe3e0'),
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
    weatherColors: { ...weatherColors[mode], ...overrides.weatherColors },
    homeCards: { ...homeCardColors, ...overrides.homeCards },
    scores: { ...scoreColors[mode], ...overrides.scores },
    macros: { ...(mode === 'dark' ? MACRO_COLORS : macroColorsLight), ...overrides.macros },
    healthArtColors: { ...healthArtColors, ...overrides.healthArtColors },
    healthHeroGradients: { ...healthHeroGradients, ...overrides.healthHeroGradients },
    healthPageGradients,
    mode,
    colors,
    tones,
    spacing: { ...spacing, ...overrides.spacing },
    radii: { ...radii, ...overrides.radii },
    sizes: { ...sizes, ...overrides.sizes },
    icons: { ...icons, ...overrides.icons },
    anatomy: {
      ...anatomyColors[mode],
      high: mode === 'dark' ? colors.brand : statusColors.light.info,
      ...overrides.anatomy,
    },
    status: statusColors[mode],
    coachFab:
      mode === 'dark'
        ? { background: colors.text, foreground: colors.background }
        : { background: colors.brand, foreground: colors.onBrand },
    effort: { ...effortColors, ...overrides.effort },
    sleepStages: { ...STAGE_COLOR, ...overrides.sleepStages },
    hrZoneColors:
      overrides.hrZoneColors ??
      (mode === 'dark' ? HR_ZONE_META.map((zone) => zone.color) : hrZoneColorsLight),
    friends: friendColors[mode],
    rewards: rewardColors[mode],
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
