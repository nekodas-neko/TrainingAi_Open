import { formatDateDisplay, formatTime12h } from '@trainingai/shared/date-utils';
import { formatActivityTitle } from '@trainingai/shared/format/activity-title';
import { plural } from '@trainingai/shared/format/plural';
import { PHASE_LABELS, lastTrainedLabel } from '@trainingai/shared/ai-periodization/status-labels';
import { PATTERN_LABEL, movementBalance } from '@trainingai/shared/health/movement-balance';
import { seriesShape } from '@trainingai/shared/health/series-gaps';

// What the Health Training cards print, kept out of the components so each rule is tested once.
// The wording follows the current app's cards (components/health/*).

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

// Date, clock time and minutes on the left; distance and kcal on the right, each only when present
// (never a placeholder dash for a figure the activity does not have).
export function activityRow(log: ActivityRowInput) {
  const subtitle = [
    formatDateDisplay(log.date),
    log.startTime ? formatTime12h(log.startTime) : '',
    log.durationMin ? `${Math.round(log.durationMin)} min` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const facts = [
    log.distanceKm != null ? `${Number(log.distanceKm).toFixed(2)} km` : '',
    log.caloriesBurned != null ? `${Math.round(log.caloriesBurned)} kcal` : '',
  ].filter(Boolean);
  return {
    title: formatActivityTitle(log.title ?? log.activityType),
    subtitle,
    facts,
  };
}

// "3 / 13 sets" against a program target, "3 sets" without one.
export function muscleSetsLabel(sets: number, target: number | null) {
  return target !== null
    ? `${sets} / ${plural(target, 'set', 'sets')}`
    : plural(sets, 'set', 'sets');
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
      : `${PHASE_LABELS[phase] ?? phase} · ${plural(state.sessionsInPhase ?? 0, 'session', 'sessions')}`;
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

// A 14-day trend as a chart wants it: leading empty days trimmed, a one-letter weekday per day, and
// the "3 days missing" note when some of the days drawn have no reading.
export function trendSeries<T extends { date: string }>(
  days: readonly T[] | undefined,
  read: (day: T) => number | null,
) {
  const rows = (days ?? []).map((day) => ({ date: day.date, value: read(day) }));
  const first = rows.findIndex((row) => row.value !== null);
  if (first === -1) {
    return null;
  }
  const shown = rows.slice(first);
  return {
    points: shown.map((row) => ({ label: row.date, value: row.value })),
    axisLabels: shown.map((row) => formatDateDisplay(row.date, 'weekday').charAt(0)),
    missing: seriesShape(shown.map((row) => row.value)).coverage,
  };
}
