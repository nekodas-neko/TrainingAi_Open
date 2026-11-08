// Wear-time confidence — a day the ring wasn't worn enough hours produces
// unreliable HRV/RHR/readiness signals. One shared filter so every baseline
// computation (readiness-score, ai-periodization signals) excludes the same
// low-wear days instead of drifting into divergent thresholds.
import type { DailyWear } from './readiness-signals';

export const MIN_WEAR_HOURS = 18;

export function wornHours(
  nonWearTimeSec: number | null | undefined,
  dayLenSec = 86400,
): number | null {
  if (nonWearTimeSec == null) return null;
  return (dayLenSec - nonWearTimeSec) / 3600;
}

export function isLowWearDay(nonWearTimeSec: number | null | undefined): boolean {
  const hours = wornHours(nonWearTimeSec);
  return hours != null && hours < MIN_WEAR_HOURS;
}

/** A day's wear, as {@link excludeLowWearDays} reads it: the generic `DailyWear` shape's seconds. */
export type WearByDate = ReadonlyMap<string, Pick<DailyWear, 'nonWearSec'>>;

/**
 * The wear rows by date (#3668: the generic shape a connector maps, never a device's own field).
 * With more than one source on a date, the longest non-wear time stands, so a day any source saw
 * as low-wear is low-wear.
 */
export function wearByDate(wear: readonly DailyWear[]): Map<string, DailyWear> {
  const out = new Map<string, DailyWear>();
  for (const w of wear) {
    const prev = out.get(w.date);
    if (!prev || w.nonWearSec > prev.nonWearSec) out.set(w.date, w);
  }
  return out;
}

/**
 * Excludes rows whose date is a known low-wear day. A date with no wear row
 * at all is kept — there's no wear-time signal to judge it by, so it
 * shouldn't be silently dropped from a baseline that predates this filter.
 */
export function excludeLowWearDays<T extends { date: string }>(
  rows: T[],
  wear: WearByDate,
): T[] {
  return rows.filter(r => !isLowWearDay(wear.get(r.date)?.nonWearSec));
}

export interface DayCompleteness {
  wornBins: number
  expectedBins: number
  pct: number
  longestGapMin: number
  lastSampleAgeMin: number
}

/** Data-capture completeness for one day from its worn 15-min bin indices.
 *  `expectedBins` = full day (96) for a past day, or elapsed-so-far for today.
 *  A "gap" is a run of consecutive expected-but-unworn bins; the trailing gap
 *  (from the last worn bin to the last expected bin) is the last-sample age. */
export function completenessForDay(input: {
  wornBinIndices: number[]
  expectedBins: number
  binMinutes: number
}): DayCompleteness {
  const { expectedBins, binMinutes } = input
  const worn = new Set(input.wornBinIndices.filter(i => i >= 0 && i < expectedBins))
  const wornBins = worn.size
  const pct = expectedBins > 0 ? Math.round((wornBins / expectedBins) * 100) : 0

  let longestRun = 0
  let currentRun = 0
  let lastWorn = -1
  for (let i = 0; i < expectedBins; i++) {
    if (worn.has(i)) {
      lastWorn = i
      currentRun = 0
    } else {
      currentRun++
      if (currentRun > longestRun) longestRun = currentRun
    }
  }
  const trailingGapBins = expectedBins - 1 - lastWorn // = expectedBins if lastWorn === -1
  return {
    wornBins,
    expectedBins,
    pct,
    longestGapMin: longestRun * binMinutes,
    lastSampleAgeMin: Math.max(0, trailingGapBins) * binMinutes,
  }
}
