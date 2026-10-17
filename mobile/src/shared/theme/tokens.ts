import type { TextStyle } from 'react-native';
import { TREND_COLOR } from '@trainingai/shared/health/strength-progress';

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};
export const radii = { small: 8, control: 12, card: 16, pill: 999 };
export const icons = { strokeWidth: 2 };
export const sizes = {
  touchTarget: 44,
  button: 48,
  icon: 24,
  iconSmall: 20,
  emphasizedIcon: 28,
  avatar: 48,
  profileAvatar: 96,
  navigation: 80,
  workoutButton: 56,
  loggingControl: 64,
  setProgressCard: 144,
  workoutLift: 24,
  contentWidth: 680,
  timerRing: 180,
  scoreRing: 128,
  scoreChip: 114,
  recommendationCard: 200,
  weekDay: 32,
  weightSparkline: 110,
  stepsSparkline: 40,
  nutritionRing: 104,
  mealLabel: 189,
  foodThumbnail: 32,
  healthHero: 260,
  wheelRow: 64,
  demonstration: 64,
  summaryWidth: 320,
  chartHeight: 96,
  miniChart: 48,
  metricValue: 48,
  compactMetricWidth: 104,
  actionTile: 112,
  weekVolumeChart: 128,
  timelineTime: 56,
  timelineMarker: 28,
  timelineRow: 72,
};
export const typography = {
  score: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  hero: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18 },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
  metric: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  tab: { fontSize: 10, lineHeight: 14, fontWeight: '500' },
  pageTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  micro: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  display: { fontSize: 48, lineHeight: 56, fontWeight: '800' },
  wheelValue: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
} satisfies Record<string, TextStyle>;
export type Space = keyof typeof spacing;
export type TextVariant = keyof typeof typography;
export const anatomy = {
  main: '#22c55e',
  secondary: '#f59e0b',
  injured: '#ef4444',
  untrained: '#3f3f3f',
  head: '#bebebe',
  outline: 'rgba(128,128,128,0.3)',
};
export const effortColors: Record<number, string> = {
  5: '#22c55e',
  6: '#84cc16',
  7: '#eab308',
  8: '#f59e0b',
  9: '#f97316',
  10: '#ef4444',
};
export const sessionTones = {
  light: ['#b45309', '#15803d', '#4338ca', '#1d4ed8', '#7e22ce', '#b91c1c'],
  dark: ['#fbbf24', '#4ade80', '#818cf8', '#60a5fa', '#c084fc', '#f87171'],
};
export const sessionFills = [
  '#f59e0b',
  '#22c55e',
  '#6366f1',
  '#3b82f6',
  '#a855f7',
  '#ef4444',
];
export const scoreColors = {
  light: {
    readiness: '#2563eb',
    heart: '#dc2626',
    sleep: '#7c3aed',
    activity: '#c2410c',
  },
  dark: { readiness: '#60a5fa', heart: '#f87171', sleep: '#a78bfa', activity: '#f97316' },
};
export const weatherColors = {
  uvLow: '#22c55e',
  uvModerate: '#eab308',
  uvHigh: '#f97316',
  uvVeryHigh: '#ef4444',
  uvExtreme: '#8b5cf6',
};
export const homeCardColors = {
  weightSparkline: '#00d4ff',
  nutritionDonut: '#bf5fff',
  sleepWidget: '#8b5cf6',
  stepsWidget: '#2dd4bf',
  moodWidget: '#fbbf24',
  streakLeft: '#f97316',
  streakRight: '#22c55e',
  recommendedToday: '#06b6d4',
  acwrWidget: '#f59e0b',
  muscleStatusWidget: '#22c55e',
  hrChartWidget: 'transparent',
  energyBalanceWidget: '#22c55e',
};
export const domainTones = {
  light: {
    checkin: { foreground: '#a16207', background: '#fffbeb', border: '#fcd34d' },
    sleep: {
      foreground: '#7e54e0',
      background: '#f7f4fe',
      border: '#e1d5fd',
    },
    heart: {
      foreground: '#cb3a3a',
      background: '#fef2f2',
      border: '#fbcece',
    },
    activity: {
      foreground: '#1b8175',
      background: '#f0fcfb',
      border: '#c8f4ee',
    },
    nutrition: {
      foreground: '#994ccc',
      background: '#fbf4ff',
      border: '#eed5ff',
    },
    recovery: {
      foreground: '#047c90',
      background: '#eefafc',
      border: '#beecf4',
    },
  },
  dark: {
    checkin: { foreground: '#fbbf24', background: '#282519', border: '#675520' },
    sleep: {
      foreground: '#9e76f7',
      background: '#252539',
      border: '#3f3369',
    },
    heart: {
      foreground: '#f15959',
      background: '#36211a',
      border: '#652a25',
    },
    activity: {
      foreground: '#2dd4bf',
      background: '#153a2f',
      border: '#1b6154',
    },
    nutrition: {
      foreground: '#c265ff',
      background: '#2e263a',
      border: '#52346c',
    },
    recovery: {
      foreground: '#06b6d4',
      background: '#0e3533',
      border: '#0c555c',
    },
  },
};
// Friends feed and leaderboard glyphs: a gold trophy and a purple trending arrow. Dark values are
// the current app's (Tailwind yellow-400, purple-400); the light ones are darker steps, each at
// least 4.5:1 on #ffffff.
export const friendColors = {
  light: { gold: '#a16207', purple: '#7e22ce' },
  dark: { gold: '#facc15', purple: '#c084fc' },
};
// Health > Progress. Dark values are the current app's; the light ones are darker steps that keep
// 10 px text and thin fills readable on a white card (each at least 4.5:1 on #ffffff).
export const progressColors = {
  light: {
    strength: '#7e22ce',
    trendUp: '#166534',
    trendDown: '#b91c1c',
    goals: {
      Steps: '#15803d',
      Calories: '#c2410c',
      Water: '#0369a1',
      Sleep: '#6d28d9',
      Workouts: '#a16207',
    },
  },
  dark: {
    strength: '#bf5fff',
    trendUp: TREND_COLOR.up,
    trendDown: TREND_COLOR.down,
    goals: {
      Steps: '#22c55e',
      Calories: '#f97316',
      Water: '#38bdf8',
      Sleep: '#a78bfa',
      Workouts: '#fbbf24',
    },
  },
};
// Health > Training. A phase is a category, not a state, so these are their own tokens: reordering
// the session palette must not recolour a phase, and no phase takes the green, amber or red of a
// status. `baseline` is the absence of a phase and follows the muted text colour in the theme.
export const trainingColors = {
  light: {
    activity: '#047c90',
    movement: '#047c90',
    phases: {
      accumulation: '#1d4ed8',
      intensification: '#4338ca',
      realisation: '#7e22ce',
      deload: '#047c90',
    },
  },
  dark: {
    activity: '#06b6d4',
    movement: '#06b6d4',
    phases: {
      accumulation: '#60a5fa',
      intensification: '#818cf8',
      realisation: '#c084fc',
      deload: '#06b6d4',
    },
  },
};
