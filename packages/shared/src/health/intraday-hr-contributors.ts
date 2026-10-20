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
// Oura Cloud is NOT gated, though it is no longer the dense BLE stream the sign-off assumed: since
// the switch to the API the ring serves 5-minute points at rest and asleep, irregular bursts while
// awake (in-hour gaps of ~17 minutes are typical), and 5-second points only inside an Oura-app
// workout. Gating it would drop most of the owner's waking hours and every elevated reading, which
// reverses the outcome #2437 was signed off on, so how these lanes read an Oura-only day is the
// owner's call: #3114.
import { activeMinutesFromReadings } from '@trainingai/shared/health/zone-minutes';
import {
  computeMovedHours,
  moveHoursGoal,
  DEFAULT_WAKE_HOUR,
  DEFAULT_SLEEP_HOUR,
} from '@trainingai/shared/health/hourly-movement';
import { moderateIntensityBpm, vigorousIntensityBpm } from '@trainingai/shared/health/hr-zones';

/** The ring's own cadence, with 30 s of slack: the longest gap a dense hour may have. */
export const HR_DENSE_MAX_GAP_MS = 5 * 60_000 + 30_000;
/** The sources whose hours are checked. A source not listed is dense by construction. */
export const DENSITY_GATED_HR_SOURCES: ReadonlySet<string> = new Set([
  'health_connect',
  'health_connect_native',
  'apple_health',
]);

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
 * The series with every gated source's sparse hours removed, and the local hours (`YYYY-MM-DD`,
 * hour) that lost their only HR. An hour is dense when the gated source has at least two readings in
 * it and no gap between consecutive ones longer than HR_DENSE_MAX_GAP_MS — "across the worn part":
 * time before its first reading and after its last is not counted against it.
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
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour };
  };
  const gatedByHour = new Map<string, number[]>();
  const keyById = new Map<T, string>();
  const otherHours = new Set<string>();
  for (const r of rows) {
    const k = keyOf(ms(r.timestamp));
    const key = `${k.date}|${k.hour}`;
    if (r.source != null && DENSITY_GATED_HR_SOURCES.has(r.source)) {
      keyById.set(r, key);
      gatedByHour.set(key, [...(gatedByHour.get(key) ?? []), ms(r.timestamp)]);
    } else {
      otherHours.add(key);
    }
  }
  const sparse = new Set<string>();
  for (const [key, times] of gatedByHour) {
    if (!isDenseHrSeries(times)) sparse.add(key);
  }
  return {
    rows: rows.filter((r) => !sparse.has(keyById.get(r) ?? '')),
    sparseHours: [...sparse]
      .filter((k) => !otherHours.has(k))
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

/** Zone minutes and move-every-hour for `dateIso`; all null when no dense HR remains. */
export function intradayHrContributors(input: {
  hrRows: readonly { timestamp: Date; bpm: number; source?: string | null }[];
  maxHr: number;
  restingHr: number;
  tz: string;
  dateIso: string;
}): IntradayHrContributors {
  const { maxHr, restingHr, tz, dateIso } = input;
  const { rows, sparseHours } = dropSparseHrHours(input.hrRows, tz);
  if (rows.length === 0) return { zoneMinutes: null, moveHours: null, moveHoursGoal: null };

  const profile = { maxHr, restingHr };
  const zoneMinutes = activeMinutesFromReadings(
    rows.map((r) => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm })),
    {
      moderateFloorBpm: moderateIntensityBpm(profile),
      vigorousFloorBpm: vigorousIntensityBpm(profile),
    },
  );
  const missingWaking = sparseHours.filter(
    (h) => h.date === dateIso && h.hour >= DEFAULT_WAKE_HOUR && h.hour < DEFAULT_SLEEP_HOUR,
  ).length;
  const goal = moveHoursGoal() - missingWaking;
  if (goal <= 0) return { zoneMinutes, moveHours: null, moveHoursGoal: null };
  const moveHours = computeMovedHours({ hrRows: rows, maxHr, restingHr, tz, dateIso });
  return { zoneMinutes, moveHours, moveHoursGoal: goal };
}
