import { gainTone, type GainTone } from '@trainingai/shared/health/strength-progress';
import {
  strengthDeltaText,
  strengthGroups,
  type BarMetric,
} from '@trainingai/shared/health/strength-progress';

// Colours and wording for Health > Progress, matching the current app's Strength Progress and
// Goals cards (components/health/strength-progress-card.tsx, goals-progress-card.tsx).

/** Width of one strength bar. */
export const STRENGTH_BAR_WIDTH = 112;

/** Width of the box each 60 / 70 / 80 label is centred in. Wide enough that scaled digits never wrap; the digits themselves are narrower than the 11 px between guides. */
export const STRENGTH_MARKER_LABEL_WIDTH = 20;

/** Where the dashed 60 / 70 / 80 guides sit on a strength bar. */
export const STRENGTH_BAR_MARKERS = [60, 70, 80] as const;

/** Fills below this still show a sliver, so a low lift never reads as an empty bar. */
export const STRENGTH_BAR_MIN_PCT = 4;

export function strengthFillPct(pct: number): number {
  return Math.max(pct, STRENGTH_BAR_MIN_PCT);
}

// The session grouping is shared with the web card: re-exported here for the Progress panel.
export { strengthGroups };

/** The delta text beside a bar (shared with the current app) in the theme's better / worse colour. */
export function strengthDelta(
  metric: BarMetric,
  colors: { trendUp: string; trendDown: string },
): { text: string; color: string } | null {
  const text = strengthDeltaText(metric);
  if (text === null) return null;
  return { text, color: metric.trend === 'up' ? colors.trendUp : colors.trendDown };
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
/** A count with thousands separators, rounded to one decimal; the one grouping formatter Preview uses. */
export const formatCount = (n: number) => roundCount(n).toLocaleString('en-US');

/** "3,200 / 8,000", "This week: 3 / 4", with a tick once the goal is met. */
export function goalCountText(value: number, goal: number, weekly: boolean): string {
  // The raw values, as the current app's GoalProgressBar does: 7.96 of 8 prints "8 / 8" without a tick.
  const done = goal > 0 && value >= goal;
  return `${weekly ? 'This week: ' : ''}${formatCount(value)} / ${formatCount(goal)}${done ? ' ✓' : ''}`;
}

/** The colour of a strength-trend gain: up green, down red, flat amber, from the status tokens. */
export function gainColor(
  gainPct: number | null | undefined,
  status: { success: string; danger: string; warning: string },
): string | null {
  const tone: GainTone | null = gainTone(gainPct);
  if (tone === null) return null;
  return { up: status.success, down: status.danger, flat: status.warning }[tone];
}
