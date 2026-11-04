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
// Which sources are held to the rule, and how, is each source's declared `heartRateSpacing`
// (`source-connectors.ts`, #3597): scoring never names a source. Health Connect and native Apple
// Health are judged hour by hour. The ring and the strap are dense by construction and outrank it in
// the merged series (`hc-heart-rate-ranked-below-ring.test.ts`), so the owner's days do not move —
// the measured outcome the decision stated. One implementation for the live payload and the day
// audit, so the two cannot drift.
//
// A source whose heart rate is dense only in stretches (#3114, option C, owner-approved 26 Oct 2026;
// Oura Cloud declares it: 5-minute points at rest and asleep, irregular bursts while awake, 5-second
// points only inside a workout) is too thin to say whether the user moved in an hour, so:
//   - zone minutes read its heart rate only in dense STRETCHES (a run of readings no further apart
//     than HR_DENSE_MAX_GAP_MS), so a workout counts even inside an hour that is otherwise
//     scattered; hour-judged and dense sources are as before;
//   - a source declaring `heartRateDecidesMovedHour: false` never decides "moved this hour". The
//     per-minute movement series does (`movedHoursFromMovement`): a waking hour is moved when any worn
//     minute in it is at MET_ACTIVE_THRESHOLD or more. An hour with no worn minute is not measured and
//     leaves the goal, once the day is over or the device has been worn later in it (an hour that has
//     not arrived yet stays in);
//   - the workout calorie estimate holds gated sources to the same rule (`getAvgBpmBySession`).
import { activeMinutesFromReadings } from '@trainingai/shared/health/zone-minutes';
import {
  hourlyHrActivity,
  moveHoursGoal,
  DEFAULT_WAKE_HOUR,
  DEFAULT_SLEEP_HOUR,
} from '@trainingai/shared/health/hourly-movement';
import { movedHoursFromMovement, type PerMinuteMovementGrid } from '@trainingai/shared/health/per-minute-movement';
import { sourceCapabilities, sourcesWith } from '@trainingai/shared/health/source-connectors';
import { MET_ACTIVE_THRESHOLD } from '@trainingai/shared/health/daily-medians';
import { moderateIntensityBpm, vigorousIntensityBpm } from '@trainingai/shared/health/hr-zones';

/** The ring's own cadence, with 30 s of slack: the longest gap a dense hour may have. */
export const HR_DENSE_MAX_GAP_MS = 5 * 60_000 + 30_000;
/** The declared sources held to the density rule, for a reader that has to name them (the workout
 *  calorie SQL). A source not listed is dense by construction. Read from each source's capabilities. */
export const DENSITY_GATED_HR_SOURCES: ReadonlySet<string> = new Set(
  sourcesWith((c) => c.heartRateSpacing !== 'continuous'),
);
const spacingOf = (source: string | null | undefined) => sourceCapabilities(source).heartRateSpacing;

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
 * stretch-judged source (one dense only in stretches) keeps a reading when it sits in a run of at least two readings
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
    const spacing = spacingOf(src);
    if (src != null && spacing === 'dense_in_stretches') {
      stretchRows.set(src, [...(stretchRows.get(src) ?? []), r]);
    } else if (src != null && spacing === 'sparse_by_hour') {
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
  const isGatedHourSource = (r: T) => r.source != null && spacingOf(r.source) === 'sparse_by_hour';
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

/** The per-minute movement grid as `perMinuteMovementGrid` builds it, covering at least the local day. */
export type MetGridInput = PerMinuteMovementGrid;

/**
 * Zone minutes and move-every-hour for `dateIso`. Zone minutes are null when no dense HR remains;
 * the move lane is null when neither HR from a source whose heart rate can decide a moved hour nor a
 * worn movement minute exists. `dayIsOver` says whether `dateIso` is a finished day: its hours with no worn minute have
 * all left the goal, rather than only those before the last worn hour.
 */
export function intradayHrContributors(input: {
  hrRows: readonly { timestamp: Date; bpm: number; source?: string | null }[];
  maxHr: number;
  /** The resting HR the zone floors are drawn from; null while there is none. Zone minutes then wait,
   *  and the move lane reads the movement series alone (heart rate needs it to say an hour was moved). */
  restingHr: number | null;
  tz: string;
  dateIso: string;
  metGrid?: MetGridInput | null;
  dayIsOver?: boolean;
}): IntradayHrContributors {
  const { maxHr, restingHr, tz, dateIso, metGrid, dayIsOver = false } = input;
  const { rows, sparseHours } = dropSparseHrHours(input.hrRows, tz);

  const zoneMinutes =
    rows.length === 0 || restingHr == null
      ? null
      : activeMinutesFromReadings(
          rows.map((r) => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm })),
          {
            moderateFloorBpm: moderateIntensityBpm({ maxHr, restingHr }),
            vigorousFloorBpm: vigorousIntensityBpm({ maxHr, restingHr }),
          },
        );

  // A source that declares its heart rate cannot decide a moved hour is left to the movement series.
  const moveRows = restingHr == null ? [] : rows.filter((r) => sourceCapabilities(r.source).heartRateDecidesMovedHour);
  const met = metGrid
    ? movedHoursFromMovement(metGrid, {
        tz, dateIso, wakeHour: DEFAULT_WAKE_HOUR, sleepHour: DEFAULT_SLEEP_HOUR, activeMet: MET_ACTIVE_THRESHOLD,
      })
    : null;
  if (moveRows.length === 0 && (met == null || met.worn.size === 0)) {
    return { zoneMinutes, moveHours: null, moveHoursGoal: null };
  }

  const hr = restingHr == null
    ? { measured: new Set<number>(), moved: new Set<number>() }
    : hourlyHrActivity({ hrRows: moveRows, maxHr, restingHr, tz, dateIso });
  const measured = new Set([...hr.measured, ...(met?.worn ?? [])]);
  const moved = new Set([...hr.moved, ...(met?.moved ?? [])]);

  // Waking hours that leave the goal: a sparse hour whose HR was the only thing in it, and, on a day
  // the movement series covers, an hour with no worn minute and no HR (the device was off).
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
