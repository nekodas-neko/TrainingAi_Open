import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { plural } from '@trainingai/shared/format/plural';

// Week in review wording and figures, kept out of the screen so they can be tested (#2935).

// "5 Oct – 11 Oct 2026": both ends as day and month, the year once at the end. The week's own
// date strings are calendar days already, so nothing here goes through an instant.
export function weekRangeLabel(weekStart: string, weekEnd: string | undefined) {
  const start = formatDateDisplay(weekStart, 'short');
  if (!weekEnd) return `${start} ${weekStart.slice(0, 4)}`;
  return `${start} – ${formatDateDisplay(weekEnd, 'short')} ${weekEnd.slice(0, 4)}`;
}

// M T W T F S S under the training bars, read from the date so a week that does not start on a
// Monday still labels its days truthfully.
export function weekdayInitial(date: string) {
  const [year, month, day] = date.split(/[-/]/).map(Number);
  return 'SMTWTFS'[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

// A figure with its decimals kept: sleep reads "6.0 h", not "6 h".
export function fixedValue(value: number | null, decimals: number) {
  return value === null
    ? '—'
    : value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
}

export type DeltaCue = 'good' | 'bad' | 'same' | null;

// One metric's week against the week before: an arrow and the amount, and whether that is the
// good direction. Stress is the one metric where a rise is bad, so the caller says so.
export function weekDelta(
  week: number | null,
  priorWeek: number | null,
  { unit = '', decimals = 0, higherIsBetter = true } = {},
): { text: string; cue: DeltaCue } {
  if (priorWeek === null) return { text: 'No week before this one', cue: null };
  if (week === null) return { text: 'Not measured this week', cue: null };
  const change = week - priorWeek;
  const against = fixedValue(priorWeek, decimals);
  if (Math.abs(change) < 0.5 * 10 ** -decimals) {
    return { text: `Level with ${against}`, cue: 'same' };
  }
  const amount = fixedValue(Math.abs(change), decimals);
  return {
    text: `${change > 0 ? '↑' : '↓'} ${amount}${unit ? ` ${unit}` : ''} on ${against}`,
    cue: change > 0 === higherIsBetter ? 'good' : 'bad',
  };
}

// The week's weighted sets per muscle for the body map and bars. The recap carries no program
// target, so the figure draws the generic minimum; a half set is a real number, so one decimal.
export function weekMuscleRows(muscleSets: readonly { muscle: string; sets: number }[]) {
  return muscleSets.map((row) => ({
    muscle: row.muscle,
    sets: Math.round(row.sets * 10) / 10,
    target: null,
  }));
}

export const weekSessionsLabel = (sessions: number) => plural(sessions, 'session', 'sessions');

// Which contributor scores lowest, for the "Weakest: HRV" line. Learning factors carry a neutral
// placeholder, not a measurement, so they never count.
export function weakestFactor(
  factors: readonly { label: string; score: number | null | undefined; provisional?: boolean }[],
) {
  let worst: { label: string; score: number } | null = null;
  for (const f of factors) {
    if (f.score == null || f.provisional) continue;
    if (worst === null || f.score < worst.score) worst = { label: f.label, score: f.score };
  }
  return worst?.label ?? null;
}
