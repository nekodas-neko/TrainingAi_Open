// Activity's two intraday-HR contributors — zone minutes and move-every-hour — from one day's merged
// heart-rate series, with the density rule #2437 decided (2026-10-06, under the owner's input-cascade
// rule "missing is missing, never zero").
//
// A heart-rate source counts in an hour only when it is at least as dense as the ring's own
// 5-minute cadence across the part of the hour it was worn. Below that the hour's HR is MISSING: its
// readings are left out, and for move-every-hour the hour leaves the goal too, so a sparse source
// reads as "not measured" rather than as a low score. Zone minutes credit each reading for at most
// 120 s, so a phone writing one Health Connect reading every 10 minutes used to undercount a real
// workout and score lower than having no HR at all.
//
// Health Connect and native Apple Health are gated. The ring and the strap are dense by construction and outrank it in
// the merged series (`hc-heart-rate-ranked-below-ring.test.ts`), so the owner's days do not move —
// the measured outcome the decision stated. One implementation for the live payload and the day
// audit, so the two cannot drift.
//
// Oura Cloud (#3114, option C, owner-approved 26 Oct 2026). Since the switch to the API the ring serves
// 5-minute points at rest and asleep, irregular bursts while awake (in-hour gaps of ~17 minutes are
// typical), and 5-second points only inside an Oura-app workout. That is too thin to say whether
// the owner moved in an hour, so:
//   - zone minutes read Oura heart rate only in dense STRETCHES (a run of readings no further apart
//     than HR_DENSE_MAX_GAP_MS), so an Oura-app workout counts even inside an hour that is otherwise
//     scattered; the strap and Health Connect are as before;
//   - "moved this hour" comes from Oura's per-minute MET (`ouraCloudMovedHours`): a waking hour is
//     moved when any worn minute in it is at MET_ACTIVE_THRESHOLD or more. Oura heart rate never
//     decides it. An hour with no worn minute is not measured and leaves the goal, once the day is
//     over or the ring has been worn later in it (an hour that has not arrived yet stays in);
//   - the workout calorie estimate holds `oura_cloud` to the same rule (`getAvgBpmBySession`).
import { activeMinutesFromReadings } from '@trainingai/shared/health/zone-minutes';
import {
  hourlyHrActivity,
  moveHoursGoal,
  DEFAULT_WAKE_HOUR,
  DEFAULT_SLEEP_HOUR,
} from '@trainingai/shared/health/hourly-movement';
import { ouraCloudMovedHours } from '@trainingai/shared/health/oura-cloud-met';
import { MET_ACTIVE_THRESHOLD } from '@trainingai/shared/health/daily-medians';
import { moderateIntensityBpm, vigorousIntensityBpm } from '@trainingai/shared/health/hr-zones';

/** The ring's own cadence, with 30 s of slack: the longest gap a dense hour may have. */
export const HR_DENSE_MAX_GAP_MS = 5 * 60_000 + 30_000;
/** The sources held to the density rule. A source not listed is dense by construction. */
export const DENSITY_GATED_HR_SOURCES: ReadonlySet<string> = new Set([
  'health_connect',
  'health_connect_native',
  'apple_health',
  'oura_cloud',
]);
/** Gated sources judged by stretch, not by hour: their dense stretches sit inside otherwise
 *  scattered hours (an Oura-app workout). The rest are judged hour by hour. */
const DENSE_STRETCH_HR_SOURCES: ReadonlySet<string> = new Set(['oura_cloud']);

type Row = { timestamp: Date | number; bpm: number; source?: string | null };

/** The density rule on its own: at least two readings, and no gap between consecutive ones longer
 *  than HR_DENSE_MAX_GAP_MS. Time before the first and after the last is not counted. */
export function isDenseHrSpan(readings: number, maxGapMs: number | null): boolean {
  return readings >= 2 && maxGapMs != null && Number.isFinite(maxGapMs) && maxGapMs <= HR_DENSE_MAX_GAP_MS;
}

/** `isDenseHrSpan` over a list of reading times (epoch ms, any order). */
export function isDenseHrSeries(times: readonly number[]): boolean {
  const sorted = [...times].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  return isDenseHrSpan(sorted.length, sorted.length >= 2 ? maxGap : null);
}

const ms = (t: Date | number) => (t instanceof Date ? t.getTime() : t);

/**
 * The series with every gated source's sparse readings removed, and the local hours (`YYYY-MM-DD`,
 * hour) that lost their only HR. An hour of an hour-judged source is dense when it has at least two
 * readings and no gap between consecutive ones longer than HR_DENSE_MAX_GAP_MS — "across the worn
 * part": time before its first reading and after its last is not counted against it. A
 * stretch-judged source (Oura Cloud) keeps a reading when it sits in a run of at least two readings
 * no further apart than that.
 */
export function dropSparseHrHours<T extends Row>(
  rows: readonly T[],
  tz: string,
): { rows: T[]; sparseHours: { date: string; hour: number }[] } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const keyOf = (t: number) => {
    const p = fmt.formatToParts(t);
    const get = (type: string) => p.find((x) => x.type === type)!.value;
    const hour = get('hour') === '24' ? 0 : Number(get('hour'));
    return `${get('year')}-${get('month')}-${get('day')}|${hour}`;
  };
  const gatedByHour = new Map<string, number[]>();
  const hourOf = new Map<T, string>();
  const stretchRows = new Map<string, T[]>();
  for (const r of rows) {
    hourOf.set(r, keyOf(ms(r.timestamp)));
    const src = r.source;
    if (src != null && DENSE_STRETCH_HR_SOURCES.has(src)) {
      stretchRows.set(src, [...(stretchRows.get(src) ?? []), r]);
    } else if (src != null && DENSITY_GATED_HR_SOURCES.has(src)) {
      const key = hourOf.get(r)!;
      gatedByHour.set(key, [...(gatedByHour.get(key) ?? []), ms(r.timestamp)]);
    }
  }
  const sparseGatedHours = new Set<string>();
  for (const [key, times] of gatedByHour) {
    if (!isDenseHrSeries(times)) sparseGatedHours.add(key);
  }
  const dropped = new Set<T>();
  for (const group of stretchRows.values()) {
    const sorted = [...group].sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
    let run: T[] = [];
    const close = () => {
      if (run.length < 2) run.forEach((r) => dropped.add(r));
      run = [];
    };
    for (const r of sorted) {
      if (run.length > 0 && ms(r.timestamp) - ms(run[run.length - 1].timestamp) > HR_DENSE_MAX_GAP_MS) close();
      run.push(r);
    }
    close();
  }
  const isGatedHourSource = (r: T) =>
    r.source != null && DENSITY_GATED_HR_SOURCES.has(r.source) && !DENSE_STRETCH_HR_SOURCES.has(r.source);
  const removed = (r: T) => dropped.has(r) || (isGatedHourSource(r) && sparseGatedHours.has(hourOf.get(r)!));
  const kept = rows.filter((r) => !removed(r));
  const keptHours = new Set(kept.map((r) => hourOf.get(r)!));
  const lostHours = new Set(rows.filter(removed).map((r) => hourOf.get(r)!));
  return {
    rows: kept,
    sparseHours: [...lostHours]
      .filter((k) => !keptHours.has(k))
      .map((k) => {
        const [date, hour] = k.split('|');
        return { date, hour: Number(hour) };
      }),
  };
}

export interface IntradayHrContributors {
  zoneMinutes: number | null;
  moveHours: number | null;
  /** The move-every-hour goal: waking hours, less those whose HR was missing. Null with `moveHours`. */
  moveHoursGoal: number | null;
}

/** Oura's per-minute MET as `ouraCloudMetGrid` builds it, covering at least the local day. */
export interface MetGridInput {
  startTimestampMs: number;
  metsPerMinute: readonly (number | null)[];
}

/**
 * Zone minutes and move-every-hour for `dateIso`. Zone minutes are null when no dense HR remains;
 * the move lane is null when neither HR from a source other than Oura Cloud nor a worn MET minute
 * exists. `dayIsOver` says whether `dateIso` is a finished day: its hours with no worn minute have
 * all left the goal, rather than only those before the last worn hour.
 */
export function intradayHrContributors(input: {
  hrRows: readonly { timestamp: Date; bpm: number; source?: string | null }[];
  maxHr: number;
  restingHr: number;
  tz: string;
  dateIso: string;
  metGrid?: MetGridInput | null;
  dayIsOver?: boolean;
}): IntradayHrContributors {
  const { maxHr, restingHr, tz, dateIso, metGrid, dayIsOver = false } = input;
  const { rows, sparseHours } = dropSparseHrHours(input.hrRows, tz);

  const profile = { maxHr, restingHr };
  const zoneMinutes =
    rows.length === 0
      ? null
      : activeMinutesFromReadings(
          rows.map((r) => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm })),
          {
            moderateFloorBpm: moderateIntensityBpm(profile),
            vigorousFloorBpm: vigorousIntensityBpm(profile),
          },
        );

  // Oura's heart rate does not decide a moved hour, its MET does.
  const moveRows = rows.filter((r) => r.source !== 'oura_cloud');
  const met = metGrid
    ? ouraCloudMovedHours(metGrid, {
        tz, dateIso, wakeHour: DEFAULT_WAKE_HOUR, sleepHour: DEFAULT_SLEEP_HOUR, activeMet: MET_ACTIVE_THRESHOLD,
      })
    : null;
  if (moveRows.length === 0 && (met == null || met.worn.size === 0)) {
    return { zoneMinutes, moveHours: null, moveHoursGoal: null };
  }

  const hr = hourlyHrActivity({ hrRows: moveRows, maxHr, restingHr, tz, dateIso });
  const measured = new Set([...hr.measured, ...(met?.worn ?? [])]);
  const moved = new Set([...hr.moved, ...(met?.moved ?? [])]);

  // Waking hours that leave the goal: a sparse hour whose HR was the only thing in it, and, on a day
  // Oura's MET covers, an hour with no worn minute and no HR (the ring was off).
  const left = new Set<number>();
  for (const h of sparseHours) {
    if (h.date === dateIso && h.hour >= DEFAULT_WAKE_HOUR && h.hour < DEFAULT_SLEEP_HOUR) left.add(h.hour);
  }
  if (met?.lastWornHour != null) {
    for (let h = DEFAULT_WAKE_HOUR; h < DEFAULT_SLEEP_HOUR; h++) {
      if (!measured.has(h) && (dayIsOver || h < met.lastWornHour)) left.add(h);
    }
  }
  for (const h of measured) left.delete(h);
  const goal = moveHoursGoal() - left.size;
  if (goal <= 0) return { zoneMinutes, moveHours: null, moveHoursGoal: null };
  return { zoneMinutes, moveHours: moved.size, moveHoursGoal: goal };
}
