import { z } from 'zod';
import { MoodFieldsSchema } from '@trainingai/shared/validation/mood-log';
import { UserPreferencesSchema } from '@trainingai/shared/user/preferences';
import { computeDayStreak, streakRestGapFor } from '@trainingai/shared/workout/day-streak';
import { shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
export type HomeSchedule = {
  type: 'weekly' | 'rotation';
  restAfterN?: number | null;
  days?: { dayOfWeek: number; sessionId?: string | null }[];
};

export const moodSchema = MoodFieldsSchema.extend({
  id: z.string(),
  userId: z.string(),
  logDate: z.string(),
  soreMuscles: z.array(z.string()).default([]),
  bodyState: z.array(z.string()).default([]),
});
export type Mood = z.infer<typeof moodSchema>;
export const preferencesSchema = UserPreferencesSchema.pick({
  homeWidgets: true,
  homeCards: true,
  homeSectionOrder: true,
  homeHiddenSections: true,
  pillColors: true,
  cardColors: true,
  scoreRingStyle: true,
  weightLookback: true,
}).strip();
export type HomePreferences = z.infer<typeof preferencesSchema>;
export const widgetLabels = {
  weightSparkline: 'Weight Trend',
  nutritionDonut: 'Nutrition',
  sleepWidget: 'Sleep',
  stepsWidget: 'Steps',
  moodWidget: 'Exercise Readiness',
  acwrWidget: 'ACWR',
  muscleStatusWidget: 'Muscle Status',
  hrChartWidget: 'Heart Rate',
  energyBalanceWidget: 'Energy Balance',
};
export const sectionLabels: Record<string, string> = {
  recommendation: 'Recommended Today',
  streak: 'Streak & This Week',
  weekStrip: 'Week Strip',
  metricTiles: 'Metric Tiles',
  ...Object.fromEntries(
    Object.entries(widgetLabels).map(([key, label]) => [`card_${key}`, label]),
  ),
};
export const metricLabels = {
  weightKg: 'Body Weight',
  steps: 'Steps',
  calories: 'Calories',
  distanceKm: 'Distance',
  protein: 'Protein',
  carb: 'Carbs',
  fat: 'Fat',
  waterIntake: 'Water',
};
export const scoreStyles = [
  ['default', 'Default'],
  ['openring', 'Open ring'],
  ['perforated', 'Perforated'],
  ['accentring', 'Accent ring'],
  ['halo', 'Halo'],
  ['bare', 'Bare'],
  ['watermark', 'Watermark'],
  ['squircle', 'Rounded tiles'],
  ['frosted', 'Frosted'],
  ['pill', 'Pill row'],
  ['rail', 'Rail'],
  ['overlap', 'Overlap'],
  ['duorail', 'Duotone rail'],
  ['footnote', 'Footnote'],
  ['nolabel', 'No label'],
  ['accentrule', 'Accent rule'],
  ['divider', 'Divider'],
  ['band', 'Band'],
  ['underline', 'Underline'],
].map(([value, label]) => ({ value, label }));
// Cards missing from a saved order go in just before Metric Tiles, as the current app does, so a
// card turned on later never lands below the tiles.
export function insertBeforeMetricTiles(order: string[], additions: string[]) {
  const fresh = additions.filter((key) => !order.includes(key));
  if (!fresh.length) {
    return order;
  }
  const at = order.indexOf('metricTiles');
  const index = at >= 0 ? at : order.length;
  return [...order.slice(0, index), ...fresh, ...order.slice(index)];
}
export function homeSections(preferences: HomePreferences) {
  const keys = [
    'recommendation',
    'streak',
    'weekStrip',
    ...(preferences.homeCards ?? []).map((key) => `card_${key}`),
    'metricTiles',
  ];
  const saved = [...new Set(preferences.homeSectionOrder ?? [])].filter(
    (key) => keys.includes(key) && key in sectionLabels,
  );
  if (!saved.length) {
    return keys.filter((key) => key in sectionLabels);
  }
  return insertBeforeMetricTiles(
    saved,
    keys.filter((key) => key in sectionLabels),
  );
}
// The preferences to save when the enabled cards change: the cards, and the section order with the
// turned-off cards dropped and the turned-on ones placed before Metric Tiles (the web saves both).
export function homeCardsPatch(preferences: HomePreferences, homeCards: string[]) {
  const current = homeSections(preferences).filter(
    (key) => !key.startsWith('card_') || homeCards.includes(key.slice(5)),
  );
  return {
    homeCards,
    homeSectionOrder: insertBeforeMetricTiles(
      current,
      homeCards.map((key) => `card_${key}`).filter((key) => key in sectionLabels),
    ),
  };
}
export function moveHomeSection(order: string[], key: string, direction: -1 | 1) {
  const index = order.indexOf(key);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= order.length) {
    return order;
  }
  const next = [...order];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
export function trainingDays(
  calendars: (Record<string, string[]> | undefined)[],
  workouts: readonly { date: string; sessionName: string; status: string; id: string }[],
  removedIds: ReadonlySet<string> = new Set(),
) {
  const days: Record<string, string[]> = {};
  for (const calendar of calendars) {
    for (const [date, names] of Object.entries(calendar ?? {})) {
      const key = date.replace(/\//g, '-');
      days[key] = [...new Set([...(days[key] ?? []), ...names])];
    }
  }
  for (const workout of workouts) {
    if (workout.status === 'completed' && !removedIds.has(workout.id)) {
      days[workout.date] = [...new Set([...(days[workout.date] ?? []), workout.sessionName])];
    }
  }
  return days;
}
export function trainingWeek(days: Record<string, string[]>, today: string) {
  const monday = weekStartForDay(today);
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftDateStr(monday, index);
    return {
      date,
      label: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index],
      names: days[date] ?? [],
      isToday: date === today,
      future: date > today,
    };
  });
}
export function homeStreak(
  days: Record<string, string[]>,
  today: string,
  schedule: HomeSchedule | null,
) {
  return computeDayStreak(
    Object.keys(days).filter((day) => days[day].length),
    today,
    streakRestGapFor(schedule as Parameters<typeof streakRestGapFor>[0]),
  ).current;
}
