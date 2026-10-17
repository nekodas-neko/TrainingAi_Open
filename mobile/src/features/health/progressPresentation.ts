import {
  computeBarMetric,
  strengthDeltaText,
  type BarMetric,
  type StrengthMode,
  type StrengthReading,
} from '@trainingai/shared/health/strength-progress';

// Colours and wording for Health > Progress, matching the current app's Strength Progress and
// Goals cards (components/health/strength-progress-card.tsx, goals-progress-card.tsx).

/** Width of one strength bar. */
export const STRENGTH_BAR_WIDTH = 112;

/** Where the dashed 60 / 70 / 80 guides sit on a strength bar. */
export const STRENGTH_BAR_MARKERS = [60, 70, 80] as const;

/** Fills below this still show a sliver, so a low lift never reads as an empty bar. */
export const STRENGTH_BAR_MIN_PCT = 4;

export function strengthFillPct(pct: number): number {
  return Math.max(pct, STRENGTH_BAR_MIN_PCT);
}

/** The delta text beside a bar (shared with the current app) in the theme's better / worse colour. */
export function strengthDelta(
  metric: BarMetric,
  colors: { trendUp: string; trendDown: string },
): { text: string; color: string } | null {
  const text = strengthDeltaText(metric);
  if (text === null) return null;
  return { text, color: metric.trend === 'up' ? colors.trendUp : colors.trendDown };
}

type StrengthExercise = StrengthReading & { exercise: string; sessionName: string };

/**
 * The Strength Progress rows grouped by session, as the current app draws them: only exercises with
 * a 1RM, and a session with no row left under the chosen mode is dropped rather than shown as a bare
 * header.
 */
export function strengthGroups<T extends StrengthExercise>(
  exercises: readonly T[],
  mode: StrengthMode,
): { session: string; rows: { exercise: T; metric: BarMetric }[] }[] {
  const groups = new Map<string, { exercise: T; metric: BarMetric }[]>();
  for (const exercise of exercises) {
    if (exercise.estimated1rm == null) continue;
    const metric = computeBarMetric(exercise, mode);
    if (!metric) continue;
    groups.set(exercise.sessionName, [...(groups.get(exercise.sessionName) ?? []), { exercise, metric }]);
  }
  return [...groups].map(([session, rows]) => ({ session, rows }));
}

/** The session of the most recently trained exercise that has a reading, as the current app marks it. */
export function lastTrainedSession(
  exercises: readonly { sessionName: string; date?: string | null; estimated1rm: number | null }[],
): string | null {
  let name: string | null = null;
  let latest: string | null = null;
  for (const exercise of exercises) {
    if (exercise.estimated1rm == null || !exercise.date) continue;
    if (!latest || exercise.date > latest) {
      latest = exercise.date;
      name = exercise.sessionName;
    }
  }
  return name;
}

export type GoalKey = 'Steps' | 'Calories' | 'Water' | 'Sleep' | 'Workouts';

const roundCount = (n: number) => Math.round(n * 10) / 10;
const formatCount = (n: number) => roundCount(n).toLocaleString('en-US');

/** "3,200 / 8,000", "This week: 3 / 4", with a tick once the goal is met. */
export function goalCountText(value: number, goal: number, weekly: boolean): string {
  // Compared as printed, so "8 / 8" always carries its tick (7.96 prints as 8).
  const done = goal > 0 && roundCount(value) >= roundCount(goal);
  return `${weekly ? 'This week: ' : ''}${formatCount(value)} / ${formatCount(goal)}${done ? ' ✓' : ''}`;
}
