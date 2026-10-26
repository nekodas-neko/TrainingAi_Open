import { formatDateDisplay, formatTimeOfDay } from '@trainingai/shared/date-utils';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { actualSleepWindow, wokeTime } from '@trainingai/shared/health/actual-sleep-window';
import { evaluateWeightRateVsGoalBand } from '@trainingai/shared/health/long-term-goal-progress';
import { hrvBaselineBand as sharedHrvBand } from '@trainingai/shared/health/hrv-baseline';
import type { Tone } from '../../../shared/theme/theme';
import type { BodyRow, SleepRow } from './models';

// Pure view logic for the Health Body panel, kept out of the components so it can be tested without
// React Native. Domain maths (ranges, BMI, goal gaps, sleep window, week-on-week change) lives in
// packages/shared and is imported, never rewritten here.

/** A good / watch / bad cue, mapped to theme colours by the component that draws it. */
export type Cue = 'good' | 'watch' | 'bad';

/** "+0.3", "-0.2", "+0": the sign the current app prints. A fitted rate that rounds to -0 reads +0. */
export function signedRate(value: number): string {
  const v = Object.is(value, -0) ? 0 : value;
  return `${v >= 0 ? '+' : ''}${v}`;
}

/**
 * Where a printed sleep range ends: the time you woke, the end of the last non-awake epoch (#2830).
 * The stage minutes and the ribbon keep the recorded window, so this is only the displayed end.
 * Without a hypnogram it is the recorded wake, then the raw sleepEnd.
 */
export function sleepWokeEnd(row: SleepRow): string | null {
  return wokeTime(row) ?? actualSleepWindow(row)?.end ?? row.sleepEnd ?? null;
}

/** The bed to wake range. Start is the raw bedtime and the end is the time you woke. */
export function sleepTimeRange(row: SleepRow | undefined, timezone: string): string | null {
  if (!row?.sleepStart || !row.sleepEnd) return null;
  const end = sleepWokeEnd(row) ?? row.sleepEnd;
  const from = formatTimeOfDay(row.sleepStart, timezone);
  const to = formatTimeOfDay(end, timezone);
  return from && to ? `${from} – ${to}` : null;
}

export type SleepChip = { key: string; label: string; tone: Tone };

/** The stage chips (a zero Awake is hidden) then the efficiency, onset, HRV, HR and breathing chips. */
export function sleepChips(row: SleepRow): { stages: SleepChip[]; vitals: SleepChip[] } {
  const stage = (key: string, title: string, hours: number | null, tone: Tone): SleepChip[] =>
    hours === null ? [] : [{ key, label: `${title} ${formatHoursMinutes(hours * 60)}`, tone }];
  const vital = (key: string, label: string | null, tone: Tone): SleepChip[] =>
    label === null ? [] : [{ key, label, tone }];
  return {
    stages: [
      ...stage('deep', 'Deep', row.deepSleepHours, 'sleep'),
      ...stage('rem', 'REM', row.remSleepHours, 'sleep'),
      ...stage('light', 'Light', row.lightSleepHours, 'sleep'),
      ...stage(
        'awake',
        'Awake',
        row.awakHours !== null && row.awakHours > 0 ? row.awakHours : null,
        'checkin',
      ),
    ],
    vitals: [
      ...vital('eff', row.efficiency === null ? null : `${row.efficiency}% eff`, 'activity'),
      ...vital(
        'onset',
        row.onsetLatencySec === null ? null : `↓ ${Math.round(row.onsetLatencySec / 60)}m onset`,
        'checkin',
      ),
      ...vital(
        'hrv',
        row.averageHrvMs === null ? null : `HRV (overnight) ${row.averageHrvMs}ms`,
        'heart',
      ),
      ...vital(
        'hr',
        row.lowestHeartRate === null ? null : `Lowest HR ${row.lowestHeartRate}bpm`,
        'heart',
      ),
      ...vital(
        'br',
        row.respiratoryRate === null ? null : `${row.respiratoryRate.toFixed(1)} br/m`,
        'recovery',
      ),
    ],
  };
}

/** The weight card's pace line: "On track · -0.4 kg/wk", or null at goal or without a trend. */
export function weightPaceLine(
  weight: number | null,
  target: number | null,
  rateKgPerWeek: number | null,
): { text: string; cue: Cue } | null {
  if (weight === null || target === null || rateKgPerWeek === null) return null;
  const { status, rateKgPerWeek: rate } = evaluateWeightRateVsGoalBand(
    weight,
    target,
    rateKgPerWeek,
  );
  if (status === null || status === 'at_goal' || rate === null) return null;
  const label =
    status === 'on_track'
      ? 'On track'
      : status === 'too_slow'
        ? 'Slower than ideal pace'
        : status === 'too_fast'
          ? 'Faster than ideal pace'
          : 'Trending away from goal';
  const cue: Cue = status === 'on_track' ? 'good' : status === 'wrong_direction' ? 'bad' : 'watch';
  return { text: `${label} · ${signedRate(rate)} kg/wk`, cue };
}

/** The HRV card cue: the band of the 7-day deviation from the 28-day baseline, as the current app maps it. */
export function hrvBaselineBand(deviationPct: number): { label: string; cue: Cue } {
  const band = sharedHrvBand(deviationPct);
  return {
    label: band.label,
    cue: band.label === 'High' ? 'good' : band.label === 'Moderate' ? 'watch' : 'bad',
  };
}

/** The ACWR zone wording the current app prints beside the ratio. */
export function acwrZoneLabel(interpretation: string | undefined): string | null {
  switch (interpretation) {
    case 'optimal':
      return 'Optimal zone';
    case 'high':
      return 'Slightly elevated';
    case 'very_high':
      return 'Overreaching risk';
    case 'low':
      return 'Detraining risk';
    default:
      return null;
  }
}

/** The newest non-null reading of a field, with the date only when it is not today's. */
export function latestReading(
  rows: readonly BodyRow[],
  field: 'restingHeartRate' | 'hrvMs' | 'spo2Pct',
  today: string,
): { value: number; staleDate: string | null } | null {
  const row = [...rows].sort((a, b) => b.date.localeCompare(a.date)).find((r) => r[field] !== null);
  return row
    ? { value: row[field] as number, staleDate: row.date === today ? null : row.date }
    : null;
}

/** One axis label per date, oldest first: the weekday on every `step`th day counting back from the newest, '' elsewhere. LineChart centres each non-blank label under its own point. The current app labels all 14 days of a fortnight, so up to 14 is every day. */
export function weekdayAxis(dates: readonly string[], max = 14): string[] {
  const step = Math.ceil(dates.length / max);
  return dates.map((date, i) =>
    (dates.length - 1 - i) % step === 0 ? formatDateDisplay(date, 'weekday') : '',
  );
}

/** Seconds the ring has been worn so far today: the elapsed day minus non-wear time, never negative. */
export function wornSeconds(nonWearTimeSec: number | null, elapsedSec: number): number | null {
  return nonWearTimeSec === null ? null : Math.max(0, elapsedSec - nonWearTimeSec);
}

/** "From 4 readings" / "From 1 reading". */
export function readingCount(count: number): string {
  return `From ${count} reading${count === 1 ? '' : 's'}`;
}

/** The water goal wording: "Goal: 2.5L" or "Goal: 800ml"; null when there is no goal. */
export function waterGoalText(goalMl: number | null | undefined): string | null {
  return goalMl && goalMl > 0
    ? `Goal: ${goalMl >= 1000 ? `${(goalMl / 1000).toFixed(1)}L` : `${goalMl}ml`}`
    : null;
}

/** A water amount the way the current app writes it: 1.8L or 800ml. */
export function waterText(ml: number | null | undefined): string | null {
  return ml == null ? null : ml >= 1000 ? `${(ml / 1000).toFixed(1)}L` : `${ml}ml`;
}

/** The muscle-status row's title and severity: capitalised words, as the current app's capitalize class shows them. */
export function titleCaseWords(text: string): string {
  return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
