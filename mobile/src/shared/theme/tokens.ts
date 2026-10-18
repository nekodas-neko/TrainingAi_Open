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
  // The current app floors every button at 48 px (app/globals.css, "Minimum tap target size").
  touchTarget: 48,
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
  // calendar-widget.tsx: the day digit sits in an h-7 w-7 circle.
  calendarDay: 28,
  // nutrition-action-row.tsx: w-4 h-4 icons.
  iconCompact: 16,
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
// Sizes are the current app's CSS px at its 384 px width, which is 384 dp on the S25 Ultra, so they
// carry across one for one. Each comment names the class the current app uses for that role, and
// tests/type-scale.test.ts pins them to it (#2994).
export const typography = {
  score: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1 },
  // A large value inside a card. A page's own title is pageTitle, never this.
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  hero: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  // text-base font-semibold: empty-state, sheet and dialog titles.
  heading: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  // text-sm font-semibold: a heading inside a card or a sheet.
  subheading: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  // text-xs font-semibold uppercase tracking-widest, muted: the title a card carries at its top.
  cardTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  // text-xs font-semibold uppercase tracking-wide, muted: a heading over a group of cards
  // (health/section-header.tsx) and the calendar card's title.
  groupTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  // text-sm: body copy and descriptions.
  body: { fontSize: 14, lineHeight: 20 },
  // Typed text: the current app forces 16 px on every input (globals.css) so focusing never zooms.
  input: { fontSize: 16, lineHeight: 24 },
  // text-sm: a row or list label, at regular weight as the current app draws it.
  label: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  // text-sm font-medium: the current app's Button.
  button: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  // text-xs.
  caption: { fontSize: 12, lineHeight: 16 },
  // text-[10px] font-semibold uppercase tracking-widest: a small label over a group or a value.
  eyebrow: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  metric: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  // bottom-nav.tsx: text-[10px] font-medium.
  tab: { fontSize: 10, lineHeight: 15, fontWeight: '500' },
  // screen-header.tsx: text-xl font-bold, the title of every tab page.
  pageTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  // nutrition-content.tsx: the Nutrition tab's own title, text-[26px] font-semibold leading-none.
  nutritionTitle: { fontSize: 26, lineHeight: 26, fontWeight: '600', letterSpacing: -0.52 },
  // calendar-widget.tsx: text-xs font-medium, the day digits and the month name.
  calendarDay: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  // calendar-widget.tsx: text-[10px] font-medium, the weekday row.
  calendarWeekday: { fontSize: 10, lineHeight: 15, fontWeight: '500' },
  // observed-hr-card.tsx Stat: text-[9px] uppercase tracking-wider over text-xl font-semibold
  // (text-2xl font-bold when emphasised) over a text-[9px] unit.
  statLabel: {
    fontSize: 9,
    lineHeight: 13.5,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  statValueStrong: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  statUnit: { fontSize: 9, lineHeight: 13.5 },
  micro: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  display: { fontSize: 48, lineHeight: 56, fontWeight: '800' },
  wheelValue: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
} satisfies Record<string, TextStyle>;
export type Space = keyof typeof spacing;
export type TextVariant = keyof typeof typography;
// The four status colours. Dark values are the ones the app has always drawn (Tailwind 500 steps);
// the light ones are darker steps that reach 4.5:1 for text on every light card background
// (tests/light-contrast.test.ts). `info` is the cool step for a state that is neither good nor bad.
export const statusColors = {
  light: { success: '#177a3c', warning: '#b04e06', danger: '#b91c1c', info: '#1d4ed8' },
  dark: { success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#60a5fa' },
};
// The muscle map and the good / watch / bad cues. Dark is unchanged. Light takes the status steps
// for the three signals and a pale grey for an untrained muscle and the head, which were
// near-black on a white card.
export const anatomyColors = {
  light: {
    main: statusColors.light.success,
    secondary: statusColors.light.warning,
    injured: statusColors.light.danger,
    untrained: '#d6d9d7',
    head: '#c2c6c3',
    outline: 'rgba(128,128,128,0.3)',
  },
  dark: {
    main: '#22c55e',
    secondary: '#f59e0b',
    injured: '#ef4444',
    untrained: '#3f3f3f',
    head: '#bebebe',
    outline: 'rgba(128,128,128,0.3)',
  },
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
  light: {
    uvLow: statusColors.light.success,
    uvModerate: '#8a5a00',
    uvHigh: '#c2410c',
    uvVeryHigh: statusColors.light.danger,
    uvExtreme: '#6d28d9',
  },
  dark: {
    uvLow: '#22c55e',
    uvModerate: '#eab308',
    uvHigh: '#f97316',
    uvVeryHigh: '#ef4444',
    uvExtreme: '#8b5cf6',
  },
};
// Protein, carbs and fat in light: a darker step of each, so a gram figure drawn in the colour
// reads on a white card. Dark is the shared MACRO_COLORS, read in theme.ts.
export const macroColorsLight = {
  protein: statusColors.light.success,
  carbs: statusColors.light.info,
  fat: '#c2410c',
};
// Heart-rate zones 1 to 5 in light, a darker step of each. Dark is the shared HR_ZONE_META.
export const hrZoneColorsLight = ['#1d4ed8', '#177a3c', '#8a5a00', '#c2410c', '#b91c1c'];
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
