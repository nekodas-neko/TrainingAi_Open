import { scoreBand, type ScoreBand } from './score-band'

/** The HRV card's headline: how far the 7-day average sits from the 28-day baseline, whole percent. */
export function hrvBaselineDeviationPct(recentHrv: number, baselineHrv: number): number {
  return Math.round(((recentHrv - baselineHrv) / baselineHrv) * 100)
}

/**
 * The band of that deviation. `scoreBand()` is the one place High/Moderate/Low thresholds live, so
 * the deviation is mapped onto its 0-100 scale: 0% lands exactly on the High cutoff (70) and -10% on
 * the Moderate cutoff (50), keeping the card's original break points.
 */
export function hrvBaselineBand(deviationPct: number): ScoreBand {
  return scoreBand(70 + 2 * deviationPct)
}
