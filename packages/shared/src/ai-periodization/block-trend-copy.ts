import { BLOCK_TREND_THRESHOLDS, LOAD_WINDOW_DAYS, type BlockTrendBand } from './acwr'

/** The insight line under the 28:90 block trend, one per band (wording fixed on #2740). */
export const BLOCK_TREND_COPY: Record<BlockTrendBand, string> = {
  steady: 'Your last 4 weeks match your 3-month norm.',
  building: 'Your last 4 weeks are heavier than your 3-month norm. You are in a build, so watch your recovery.',
  detraining: 'Your last 4 weeks are lighter than your 3-month norm. Fine after a deload, or ease back in if it was not planned.',
}

export const BLOCK_TREND_NOT_ENOUGH_HISTORY = 'Not enough history yet'

/** Weeks in the 90-day baseline window: from this span on, the ratio rests on a full 3 months. */
export const BLOCK_TREND_FULL_WEEKS = Math.ceil(LOAD_WINDOW_DAYS.block / 7)

/** The "Based on N weeks" caption, or null once the data span covers a full 3 months. */
export function blockTrendBasis(spanDays: number): string | null {
  const weeks = Math.floor(spanDays / 7)
  if (weeks >= BLOCK_TREND_FULL_WEEKS) return null
  const n = Math.max(1, weeks)
  return `Based on ${n} ${n === 1 ? 'week' : 'weeks'}`
}

/** The shaded "steady" band of the chart: the two thresholds, read from the one constant. */
export const BLOCK_TREND_STEADY_BAND = {
  from: BLOCK_TREND_THRESHOLDS.detrainingMax,
  to: BLOCK_TREND_THRESHOLDS.buildingMin,
} as const
