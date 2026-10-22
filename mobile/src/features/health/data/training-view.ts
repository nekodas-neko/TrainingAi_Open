import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { activityRowText } from '@trainingai/shared/format/activity-row';
import { formatActivityTitle } from '@trainingai/shared/format/activity-title';
import { plural } from '@trainingai/shared/format/plural';
import { phaseLabel, lastTrainedLabel } from '@trainingai/shared/ai-periodization/status-labels';
import { PATTERN_LABEL, movementBalance } from '@trainingai/shared/health/movement-balance';
import { GENERIC_TARGET, MAX_TARGET } from '@trainingai/shared/health/volume-band';
import { weekOverWeekChange } from '@trainingai/shared/health/trend-delta';
import { seriesShape, trimLeadingGaps } from '@trainingai/shared/health/series-gaps';

// What the Health Training cards print, kept out of the components so each rule is tested once.
// The wording follows the current app's cards (components/health/*).

type ActivityRowInput = {
  id: string;
  date: string;
  title: string | null;
  activityType: string;
  startTime: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  caloriesBurned: number | null;
};

// "Activities this week": the log's own week, Monday on, whatever date separator it came with.
export function weekActivities<T extends { date: string }>(logs: readonly T[], weekStart: string) {
  return logs.filter((log) => log.date.replace(/\//g, '-') >= weekStart);
}

// The figures come from the shared formatter the current app's history card uses.
export function activityRow(log: ActivityRowInput) {
  return {
    title: formatActivityTitle(log.title ?? log.activityType),
    ...activityRowText(log),
  };
}

// "3 / 13 sets" against a program target, "3 sets" without one.
export function muscleSetsLabel(sets: number, target: number | null) {
  return target !== null
    ? `${sets} / ${plural(target, 'set', 'sets')}`
    : plural(sets, 'set', 'sets');
}

/** What the Muscle Volume card says at the right of its title, as weekly-muscle-sets-card.tsx does. */
export function muscleVolumeCaption(muscles: readonly { target: number | null }[]) {
  return muscles.some((row) => row.target !== null)
    ? 'vs your program target'
    : `Target: ${GENERIC_TARGET}–${MAX_TARGET} sets`;
}

export function periodizationRow(session: {
  state?: {
    phase?: string;
    currentPhase?: string;
    sessionsInPhase?: number | null;
    baselineComplete?: boolean | null;
  } | null;
  lastTrainedDaysAgo: number | null;
}) {
  const state = session.state;
  const phase = state?.phase ?? state?.currentPhase ?? 'baseline';
  const label = !state
    ? 'No data'
    : phase === 'baseline' && !state.baselineComplete
      ? 'Baseline needed'
      : `${phaseLabel(phase)} · ${plural(state.sessionsInPhase ?? 0, 'session', 'sessions')}`;
  return {
    phase,
    label,
    recency: state ? lastTrainedLabel(session.lastTrainedDaysAgo) : null,
  };
}

// Push / pull / legs / other: the bar is scaled to the biggest row so the shortest stays legible,
// and the counts are whole numbers.
export function movementRows(muscles: { muscle: string; sets: number }[]) {
  const { rows, total } = movementBalance(muscles);
  const max = Math.max(0, ...rows.map((row) => row.sets));
  return {
    total,
    rows: rows.map((row) => ({
      key: row.pattern,
      label: PATTERN_LABEL[row.pattern],
      percent: `${Math.round(row.pct)}%`,
      sets: plural(Math.round(row.sets), 'set', 'sets'),
      fraction: max > 0 ? row.sets / max : 0,
    })),
  };
}

// A 14-day trend as a chart wants it: leading empty days trimmed, a three-letter weekday per day,
// and the "3 days missing" note when some of the days drawn have no reading.
export function trendSeries<T extends { date: string }>(
  days: readonly T[] | undefined,
  read: (day: T) => number | null,
) {
  const rows = (days ?? []).map((day) => ({ date: day.date, value: read(day) }));
  const shown = trimLeadingGaps(rows, (row) => row.value);
  if (!shown) {
    return null;
  }
  return {
    points: shown.map((row) => ({ label: row.date, value: row.value })),
    axisLabels: shown.map((row) => formatDateDisplay(row.date, 'weekday')),
    missing: seriesShape(shown.map((row) => row.value)).coverage,
    // Over every day fetched, as the current app's chip is, not only the days drawn.
    change: weekOverWeekChange(rows.map((row) => row.value)),
  };
}

type CalendarDays = Record<string, readonly string[]>;

// The month's training calendar: for each date the names it holds (for a screen reader) and a dot
// per trained session in that session's colour, then one dot in the activity colour for any logged
// activity. Server days and on-device logs merge, whichever date separator they came with.
export function calendarMarks(input: {
  month: string;
  trainedDays: CalendarDays;
  activityDays: CalendarDays;
  activities: readonly { date: string; title: string }[];
  workouts: readonly { date: string; status: string; sessionName: string }[];
  sessionColor: (name: string) => string;
  activityColor: string;
}) {
  const trained: Record<string, string[]> = {};
  const active: Record<string, string[]> = {};
  const add = (into: Record<string, string[]>, date: string, names: readonly string[]) => {
    const day = date.replace(/\//g, '-');
    into[day] = [...new Set([...(into[day] ?? []), ...names])];
  };
  for (const [date, names] of Object.entries(input.trainedDays)) add(trained, date, names);
  for (const [date, names] of Object.entries(input.activityDays)) add(active, date, names);
  for (const row of input.activities) {
    if (row.date.startsWith(input.month)) add(active, row.date, [row.title]);
  }
  for (const workout of input.workouts) {
    if (workout.status === 'completed' && workout.date.startsWith(input.month)) {
      add(trained, workout.date, [workout.sessionName]);
    }
  }
  const markers: Record<string, string[]> = {};
  const dots: Record<string, string[]> = {};
  for (const date of new Set([...Object.keys(trained), ...Object.keys(active)])) {
    markers[date] = [...(trained[date] ?? []), ...(active[date] ?? [])];
    dots[date] = [
      ...(trained[date] ?? []).map(input.sessionColor),
      ...(active[date] ? [input.activityColor] : []),
    ];
  }
  return { markers, dots };
}
