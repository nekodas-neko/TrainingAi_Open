import type { TextStyle } from 'react-native';
import { TREND_COLOR } from '@trainingai/shared/health/strength-progress';

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  // achievements-grid.tsx: gap-2.5.
  snug: 10,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};
export const radii = { small: 8, control: 12, card: 16, pill: 999, swatch: 2 };
export const icons = { strokeWidth: 2 };
export const sizes = {
  // The current app floors every button at 48 px (app/globals.css, "Minimum tap target size").
  touchTarget: 48,
  button: 48,
  // The drawn height of a control that is not a button in the current app (a segmented-control cell).
  // Its hit area stays touchTarget: the control carries hitSlop for the difference (#3248).
  control: 40,
  icon: 24,
  iconSmall: 20,
  emphasizedIcon: 28,
  avatar: 48,
  profileAvatar: 96,
  navigation: 80,
  workoutButton: 56,
  // active-set-card.tsx: the stepper buttons are w-14 h-14 (#3248).
  loggingControl: 56,
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
  // calendar-widget.tsx and weekly-stats-hub.tsx legends: h-1.5 w-1.5 dots.
  legendDot: 6,
  // strength-trend-card.tsx: <Sparkline height={64} responsive />.
  sparkline: 64,
  // strength-progress-card.tsx: an h-[11px] row of 60 / 70 / 80 labels over a 6 px bar.
  strengthMarkerRow: 11,
  strengthBar: 6,
  // nutrition-action-row.tsx: w-4 h-4 icons.
  iconCompact: 16,
  // week-detail-content.tsx: the sparkle before "Your week" is h-3 w-3.
  iconCaption: 12,
  weightSparkline: 110,
  // sparkline-chart rows (TrendRowCard in day-trends-section.tsx): <Sparkline width={110} height={30} />.
  trendSparkline: 30,
  stepsSparkline: 40,
  nutritionRing: 104,
  mealLabel: 189,
  foodThumbnail: 32,
  healthHero: 260,
  // Held at 64 on purpose (#3248): the selected value is the 48 px display numeral (56 line height),
  // and SetEntry floors a row at that plus 8, so a smaller token would change nothing but the stepper.
  wheelRow: 64,
  demonstration: 64,
  summaryWidth: 320,
  chartHeight: 96,
  // week-metric-card.tsx: the tile's sparkline is h-10.
  weekTileChart: 40,
  // hr-day-chart.tsx and the cardio trend charts are h-40.
  hrChartHeight: 160,
  miniChart: 48,
  // hero line (30) plus 6, so the row that opens a history keeps a 48 hit area through hitSlop (#3248).
  metricValue: 36,
  compactMetricWidth: 104,
  actionTile: 112,
  weekVolumeChart: 128,
  // home-day-timeline.tsx: the event icon sits in a w-9 h-9 circle.
  timelineMarker: 36,
  // home-nutrition-card.tsx: the ring is w-[58px] h-[58px].
  homeNutritionRing: 58,
  // The same ring's stroke: its mask clears the inner 60% of the radius, so 40% of 29 px.
  homeNutritionRingStroke: 11.6,
  // time-in-zone-card.tsx: the Day | Week | Month tabs sit on the title row at w-40.
  zonePeriodToggle: 160,
  // calendar-widget.tsx: the month between the arrows is w-24.
  calendarMonthLabel: 96,
  // muscle-heatmap.tsx KeyItem: a w-2.5 h-2.5 rounded-[2px] swatch.
  legendSwatch: 10,
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
  // heart-rate/page.tsx "Today so far" tile: text-[10px] uppercase tracking-wider over a text-xl value.
  tileLabel: {
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // week-detail-content.tsx: the centred header title is text-[17px] font-extrabold tracking-tight.
  headerTitle: { fontSize: 17, lineHeight: 24, fontWeight: '800', letterSpacing: -0.43 },
  statValue: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  statValueStrong: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  // week-metric-card.tsx: text-xl font-bold value and a text-[11px] delta under it.
  weekTileValue: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  weekTileDelta: { fontSize: 11, lineHeight: 16.5 },
  // contributor-chart.tsx FactorBar: a text-[11px] leading-tight name and a text-[11px] font-semibold
  // score or weight either side of the bar.
  factorLabel: { fontSize: 11, lineHeight: 13.75 },
  factorValue: { fontSize: 11, lineHeight: 16.5, fontWeight: '600' },
  statUnit: { fontSize: 9, lineHeight: 13.5 },
  // home-nutrition-card.tsx: the ring's centre, text-[9px] font-extrabold over a text-[7px] word.
  ringValue: { fontSize: 9, lineHeight: 9, fontWeight: '800' },
  ringWord: { fontSize: 7, lineHeight: 7 },
  // body-battery-card.tsx: the level and the figure in the header, text-xl leading-none.
  batteryValue: { fontSize: 20, lineHeight: 20, fontWeight: '700' },
  // Home's Energy hero number (#2989), from the approved mockups at 384 px
  // (docs/design/2026-10-18-energy-pillar-round3.html: Full 72, Compact 50, Slim 34).
  energyFull: { fontSize: 72, lineHeight: 76, fontWeight: '700', letterSpacing: -2.5 },
  energyCompact: { fontSize: 50, lineHeight: 52, fontWeight: '700', letterSpacing: -1.75 },
  energySlim: { fontSize: 34, lineHeight: 36, fontWeight: '700', letterSpacing: -1.2 },
  // recommendation-card.tsx: the soreness chip, text-[10px] font-semibold leading-none.
  chipLabel: { fontSize: 10, lineHeight: 10, fontWeight: '600' },
  // trend-sparkline.tsx: chart.js x ticks at font size 9, so 14 weekday labels fit the plot.
  axisTick: { fontSize: 9, lineHeight: 13.5 },
  // trend-sparkline.tsx: chart.js y ticks at font size 8, a 14-day card's value labels.
  yAxisTick: { fontSize: 8, lineHeight: 12 },
  micro: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  // day-sections.tsx Stat: text-[0.95rem] font-bold leading-none over a text-[8.5px] uppercase
  // tracking-[0.16em] label (Eaten / Burned / Net).
  figureValue: { fontSize: 15.2, lineHeight: 15.2, fontWeight: '700' },
  figureLabel: {
    fontSize: 8.5,
    lineHeight: 12.75,
    letterSpacing: 1.36,
    textTransform: 'uppercase',
  },
  // food-list.tsx: the "N items" line over a list, text-[11px] font-semibold uppercase
  // tracking-[0.05em] muted.
  listCount: {
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: '600',
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  // energy-card.tsx: the remaining-calories number beside the ring, text-lg font-bold.
  remainingValue: { fontSize: 18, lineHeight: 27, fontWeight: '700' },
  // energy-card.tsx MacroColumn: text-[11.5px] font-semibold share, text-[15px] font-bold grams,
  // text-[10.5px] target / unit / name. Line heights are the 1.5 the page inherits.
  macroShare: { fontSize: 11.5, lineHeight: 17.25, fontWeight: '600' },
  macroValue: { fontSize: 15, lineHeight: 22.5, fontWeight: '700' },
  macroCaption: { fontSize: 10.5, lineHeight: 15.75, fontWeight: '400' },
  // strength-progress-card.tsx: the 60 / 70 / 80 labels over a strength bar, 7 px bold at -0.02em.
  strengthMarker: { fontSize: 7, lineHeight: 7, fontWeight: '700', letterSpacing: -0.14 },
  display: { fontSize: 48, lineHeight: 56, fontWeight: '800' },
  // The current app's rest ring numerals: text-[56px] font-black, 44px in overtime (#3142).
  restCountdown: { fontSize: 56, lineHeight: 56, fontWeight: '900' },
  restOvertime: { fontSize: 44, lineHeight: 44, fontWeight: '900' },
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
// home-day-timeline.tsx TYPE_ICON_COLOR: the 400 steps of indigo, blue, orange and green on a dark
// card; a light card takes the darker steps so an icon stays readable.
export const timelineHues = {
  light: {
    sleep: '#4338ca',
    walk: statusColors.light.info,
    meal: '#c2410c',
    ready: statusColors.light.success,
  },
  dark: { sleep: '#818cf8', walk: '#60a5fa', meal: '#fb923c', ready: '#4ade80' },
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
  collectionWidget: '#fb923c',
};
// Health > Body. health-sections.tsx accentCardStyle(...) on each card; the same in both modes.
export const bodyCardColors = {
  weight: '#00d4ff',
  fat: '#f43f5e',
  burned: '#f97316',
  bmi: '#a78bfa',
  composition: '#a78bfa',
  leanMass: '#22c55e',
  sleep: '#2dd4bf',
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
// Achievement badges. Dark values are the current app's (bronze/silver/gold tier borders and the
// category colours in `achievements-grid.tsx`; dark Sleep is 4.15:1 on the dark card, under 4.5);
// the light ones are darker steps, each at least 4.5:1 on #ffffff. "Workouts" has no entry: it
// takes the brand colour. Steps is the current app's `--accent-green` (oklch 0.52 / 0.84, hue 145)
// as sRGB.
export const rewardColors = {
  light: {
    tiers: { bronze: '#9a5a1a', silver: '#6b7280', gold: '#a16207' },
    categories: {
      Volume: '#c2410c',
      Sets: '#0e7490',
      Streaks: '#b45309',
      Records: '#7e22ce',
      Timing: '#be185d',
      Consistency: '#047857',
      Nutrition: '#4d7c0f',
      Sleep: '#4338ca',
      'Body Metrics': '#0f766e',
      Steps: '#008300',
      'Lift Milestones': '#b91c1c',
    },
  },
  dark: {
    tiers: { bronze: '#cd7c2e', silver: '#9ca3af', gold: '#f59e0b' },
    categories: {
      Volume: '#ff6a1a',
      Sets: '#00d4ff',
      Streaks: '#f59e0b',
      Records: '#a855f7',
      Timing: '#ec4899',
      Consistency: '#10b981',
      Nutrition: '#84cc16',
      Sleep: '#6366f1',
      'Body Metrics': '#14b8a6',
      Steps: '#56ee66',
      'Lift Milestones': '#ef4444',
    },
  },
};
// Health > Progress. Dark values are the current app's; the light ones are darker steps that keep
// 10 px text and thin fills readable on a white card (each at least 4.5:1 on #ffffff).
export const progressColors = {
  light: {
    strength: '#7e22ce',
    trendUp: '#166534',
    trendDown: '#b91c1c',
    // trends-section.tsx accentCardStyle('#8b5cf6'): the Trends card's tint.
    trends: '#8b5cf6',
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
    trends: '#8b5cf6',
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
