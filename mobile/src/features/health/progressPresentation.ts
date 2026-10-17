import type { BarMetric } from '@trainingai/shared/health/strength-progress';
import { plural } from '@trainingai/shared/format/plural';

// Colours and wording for Health > Progress, matching the current app's Strength Progress and
// Goals cards (components/health/strength-progress-card.tsx, goals-progress-card.tsx).

export const STRENGTH_ACCENT = '#bf5fff';
// Same two values the current app uses for a better / worse change.
const TREND_COLOR = { up: '#22c55e', down: '#f87171' } as const;

/** Where the dashed 60 / 70 / 80 guides sit on a strength bar. */
export const STRENGTH_BAR_MARKERS = [60, 70, 80] as const;

/** Fills below this still show a sliver, so a low lift never reads as an empty bar. */
export const STRENGTH_BAR_MIN_PCT = 4;

export function strengthFillPct(pct: number): number {
  return Math.max(pct, STRENGTH_BAR_MIN_PCT);
}

/** "+3 reps" for a bodyweight exercise, "-2.5 kg" for a loaded one; null when nothing changed. */
export function strengthDelta(metric: BarMetric): { text: string; color: string } | null {
  if (metric.trend == null || metric.trend === 'same' || metric.delta == null) return null;
  const sign = metric.trend === 'up' ? '+' : '-';
  const amount =
    metric.deltaUnit === 'RM' ? plural(metric.delta, 'rep', 'reps') : `${metric.delta} kg`;
  return { text: `${sign}${amount}`, color: TREND_COLOR[metric.trend] };
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

export const GOAL_COLORS = {
  Steps: '#22c55e',
  Calories: '#f97316',
  Water: '#38bdf8',
  Sleep: '#a78bfa',
  Workouts: '#fbbf24',
} as const;
export type GoalKey = keyof typeof GOAL_COLORS;

function formatCount(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('en-US');
}

/** "3,200 / 8,000", "This week: 3 / 4 workouts", with a tick once the goal is met. */
export function goalCountText(
  key: GoalKey,
  value: number,
  goal: number,
  weekly: boolean,
): string {
  const done = goal > 0 && value >= goal;
  const goalText = key === 'Workouts' ? plural(goal, 'workout', 'workouts') : formatCount(goal);
  return `${weekly ? 'This week: ' : ''}${formatCount(value)} / ${goalText}${done ? ' ✓' : ''}`;
}
