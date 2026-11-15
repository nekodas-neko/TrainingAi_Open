// #3778 / #3824 — one converter from a stored readiness score to the current (75-centred) scale.
//
// Readiness v18 moved the centre of resting HR, HRV balance and sleep balance from 50 to 75. Stored
// rows are never rewritten, so a window that spans the release holds two scales, and an average or a
// difference across it reads the change as a change in the person. Anything that averages or
// differences readiness across days converts each day through here first.
//
// **The conversion is this change alone, not a recompute.** Holding every other contributor where
// the row stored it:
//
//     converted = clamp(round(stored + Σ w × (v18 sub-score − stored sub-score)))
//
// over the three centred contributors. The v18 sub-score comes from the stored input (z) through the
// shipped curve when the row has one, from the stored sub-score through the same re-centring when it
// predates stored inputs (Q-501), and is the centre 75 when the contributor was unscored. Recomputing
// the whole row (`rederiveReadinessFromStored`) would mix in every older model change as well, and
// the point is that a v17 day and a v18 day with the same person behind them read the same.
//
// The production count (`scripts/tuning/readiness-centre-75.sql`) is the same arithmetic.
import {
  baselineContributorCurve,
  READINESS_BASELINE_CENTRE,
  READINESS_WEIGHTS,
} from './readiness-composite'
import { readinessScaleOf } from './readiness-decision-thresholds'

/** The three contributors #3778 re-centred, with the direction their stored z is read in. */
const CENTRED = {
  restingHeartRate: 'lower-better',
  hrvBalance: 'higher-better',
  sleepBalance: 'higher-better',
} as const

/** The re-centring `baselineContributorCurve` applies, for a stored sub-score with no stored z. */
function recentreStoredSubScore(s: number): number {
  const c = READINESS_BASELINE_CENTRE
  return s >= 50 ? c + (s - 50) * ((100 - c) / 50) : c - (50 - s) * (c / 50)
}

/**
 * How far #3778 moves a row scored on the old scale: `Σ w × (v18 sub-score − stored sub-score)`,
 * unrounded. Null when the row has no contributor map to read (or none of the three in it).
 */
export function centreShiftDelta(contributors: unknown): number | null {
  if (contributors == null || typeof contributors !== 'object' || Array.isArray(contributors)) return null
  let delta = 0
  let seen = 0
  for (const [key, direction] of Object.entries(CENTRED) as [keyof typeof CENTRED, 'lower-better' | 'higher-better'][]) {
    const c = (contributors as Record<string, unknown>)[key]
    if (c == null || typeof c !== 'object') continue
    const entry = c as { score?: unknown; input?: unknown }
    if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) continue
    seen++
    const next = !('input' in entry)
      ? recentreStoredSubScore(entry.score)
      : typeof entry.input === 'number' && Number.isFinite(entry.input)
        ? baselineContributorCurve(entry.input, direction)
        : READINESS_BASELINE_CENTRE
    delta += READINESS_WEIGHTS[key] * (Math.max(0, Math.min(100, Math.round(next))) - entry.score)
  }
  return seen === 0 ? null : delta
}

/**
 * A stored readiness score on the current scale. A v18 (or later) score is returned as stored. An
 * older one is moved by {@link centreShiftDelta}; when its row has no contributor map it cannot be
 * converted and the answer is null, so the caller leaves the day out rather than mixing scales.
 *
 * Works on the served score and on the composite before the illness suppression alike: the shift
 * is a sum over contributors, so it adds the same either way.
 */
export function toCurrentReadinessScale(
  score: number | null | undefined,
  modelVersion: string | null | undefined,
  contributors: unknown,
): number | null {
  if (score == null || !Number.isFinite(score)) return null
  if (readinessScaleOf(modelVersion) === 'centre-75') return score
  const delta = centreShiftDelta(contributors)
  if (delta == null) return null
  return Math.max(0, Math.min(100, Math.round(score + delta)))
}
