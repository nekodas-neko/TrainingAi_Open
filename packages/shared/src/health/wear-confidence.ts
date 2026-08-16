// Wear-time confidence — a day the ring wasn't worn enough hours produces
// unreliable HRV/RHR/readiness signals. One shared filter so every baseline
// computation (readiness-score, ai-periodization signals) excludes the same
// low-wear days instead of drifting into divergent thresholds.
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

/**
 * Excludes rows whose date matches a known low-wear Oura day. A date with no
 * Oura row at all is kept — there's no wear-time signal to judge it by, so it
 * shouldn't be silently dropped from a baseline that predates this filter.
 */
export function excludeLowWearDays<T extends { date: string }>(
  rows: T[],
  ouraByDate: Map<string, { nonWearTimeSec?: number | null }>,
): T[] {
  return rows.filter(r => {
    const oura = ouraByDate.get(r.date);
    if (!oura) return true;
    return !isLowWearDay(oura.nonWearTimeSec);
  });
}

export function toOuraByDate<T extends { date: string; nonWearTimeSec?: number | null }>(
  rows: T[],
): Map<string, T> {
  return new Map(rows.map(r => [r.date, r]));
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
