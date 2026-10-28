import { formatCount } from '../progressPresentation';
import { rankedContributors } from '@trainingai/shared/health/contributor-ranking';

// Week in review wording and figures, kept out of the screen so they can be tested (#2935).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "7 Jun": the web's `d MMM`. A fixed array, not a locale: en-AU spells June, July and September
// out in full ("7 June", "7 Sept"), and Hermes' Intl differs again.
function dayMonth(date: string) {
  const [, month, day] = date.split(/[-/]/).map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

// "5 Oct – 11 Oct 2026": both ends as day and month, the year once at the end. The week's own
// date strings are calendar days already, so nothing here goes through an instant.
export function weekRangeLabel(weekStart: string, weekEnd: string | undefined) {
  if (!weekEnd) return `${dayMonth(weekStart)} ${weekStart.slice(0, 4)}`;
  return `${dayMonth(weekStart)} – ${dayMonth(weekEnd)} ${weekEnd.slice(0, 4)}`;
}

// M T W T F S S under the training bars, read from the date so a week that does not start on a
// Monday still labels its days truthfully.
export function weekdayName(date: string) {
  const [year, month, day] = date.split(/[-/]/).map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function weekdayInitial(date: string) {
  return weekdayName(date)[0];
}

// A figure with its decimals kept: sleep reads "6.0", not "6". `toFixed` as the web does, so the
// text does not depend on the device locale.
export function fixedValue(value: number | null, decimals: number) {
  return value === null ? '—' : value.toFixed(decimals);
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

// Which contributor scores lowest, for the "Weakest: HRV" line. The ranking is the web's
// (`rankedContributors`). Learning factors carry a neutral placeholder, not a measurement, so they
// are left out before it runs.
export function weakestFactor(
  factors: readonly { key: string; label: string; score: number | null | undefined; provisional?: boolean }[],
) {
  const measured = Object.fromEntries(
    factors.filter((f) => !f.provisional && f.score != null).map((f) => [f.key, f.score]),
  );
  const [worst] = rankedContributors(measured);
  return factors.find((f) => f.key === worst?.[0])?.label ?? null;
}

// The Training card's headline pair (week-detail-content.tsx): the big figure, and "kg over N
// sessions" beside it on the same line.
export function trainingHeadline(volumeKg: number, sessions: number) {
  return {
    value: formatCount(Math.round(volumeKg)),
    caption: `kg over ${sessions} session${sessions === 1 ? '' : 's'}`,
  };
}

// The training chart's y labels (week-volume-chart.tsx): thousands of kg, "4k" / "2k", with the
// baseline a bare "0". Under 1,000 the number stays as it is, so 250 / 500 / 750 are not "0k" / "1k".
export function volumeTickLabel(value: number) {
  return value === 0 ? '0' : value < 1000 ? String(value) : `${Math.round(value / 1000)}k`;
}

// "Your week" as the current app flows it: the digest's lines (bullets included) run together as one
// paragraph rather than one line each. The shared builder writes every point as "• …"; the "•" stays
// as the separator between points, so a list marker of any kind is normalised to it, not dropped.
export function flowDigest(digest: string) {
  return digest
    .split(/\r?\n/)
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) => line.replace(/^\s*[-*•]\s+/, '• ').trim())
    .filter(Boolean)
    .join(' ');
}
