// #2115 v4 (owner, 2026-10-06): what the training-load model does with a minute nothing measured.
//
// The vendored scorer (`ots.ts`, untouched) rejects any NaN in its MET series, and a value below its
// floor is read as no reading, which its `nansum` then counts as ZERO MET: below rest, and the
// "missing is never zero" rule broken. So a minute no `MET/min` route filled is handled here:
//
//   - **Cap.** The recency-weighted share of empty minutes in the last 720 (weights `metWeights`, the
//     window the scorer reads) must be at most 20%, else the day is not scored.
//   - **Fill.** Under the cap, every empty minute gets one value `v*` chosen so the model's weighted
//     mean over that window equals the mean over the minutes that were measured:
//       f(v*) = Σ w_j f(m_j) / Σ w_j over valued j,   f(met) = met × metIntensityWeightNorm(met)
//     So the score is renormalised over what we have instead of diluted by zeros.
//
// The intensity curve below restates `metIntensityWeightNorm` from `ots.ts` because the vendored file
// keeps it private; `ots-gap-fill.test.ts` runs the real scorer on a filled series to prove the two
// agree.
import { getOtsTypedConstants } from '@/lib/oura-models/constants'

/** The most of the recency-weighted last 720 minutes that may be empty before a day is not scored. */
export const MAX_RESIDUAL_SHARE = 0.2
/** The window the scorer's last value is read from. */
export const OTS_WINDOW_MIN = 720

export interface OtsFillConstants {
  metWeights: ArrayLike<number>
  minMetValue: number
  metIntensityGamma: number
  metIntensityM: number
  useMetIntensityWeights: boolean
}

export type OtsFillResult =
  | { status: 'ok'; mets: number[]; residualShare: number }
  | { status: 'insufficient'; residualShare: number }

/** The scorer's per-minute factor for a MET value (`ots.ts`: met × metIntensityWeightNorm(met)). */
export function otsMetFactor(met: number, c: OtsFillConstants): number {
  if (!c.useMetIntensityWeights) return met
  const clamped = Math.min(10, Math.max(1, met))
  const x = (clamped - 1) / 9
  return met * (Math.pow(x, c.metIntensityGamma) * (c.metIntensityM - 1) + 1)
}

/**
 * Apply the cap and the fill to a minute series (`null` = no route filled it). A valued minute below
 * the scorer's floor counts as empty, because the scorer would drop it anyway. Pure: the constants are
 * passed in.
 */
export function fillOtsGaps(mets: readonly (number | null)[], c: OtsFillConstants): OtsFillResult {
  const n = mets.length
  if (n < OTS_WINDOW_MIN || c.metWeights.length < OTS_WINDOW_MIN) return { status: 'insufficient', residualShare: 1 }
  const isValued = (v: number | null): v is number => v != null && Number.isFinite(v) && v >= c.minMetValue
  const offset = n - OTS_WINDOW_MIN

  let wAll = 0, wEmpty = 0, wValued = 0, fValued = 0, maxValued = c.minMetValue
  for (let j = 0; j < OTS_WINDOW_MIN; j++) {
    const w = c.metWeights[j]
    wAll += w
    const v = mets[offset + j]
    if (isValued(v)) {
      wValued += w
      fValued += w * otsMetFactor(v, c)
      if (v > maxValued) maxValued = v
    } else {
      wEmpty += w
    }
  }
  const residualShare = wAll > 0 ? wEmpty / wAll : 1
  if (!(wValued > 0) || residualShare > MAX_RESIDUAL_SHARE) return { status: 'insufficient', residualShare }

  const target = fValued / wValued
  // `otsMetFactor` is non-decreasing from the floor up, so bisect for the value whose factor is the
  // target. It lies between the floor and the largest measured minute.
  let lo = c.minMetValue, hi = Math.max(maxValued, c.minMetValue)
  if (otsMetFactor(lo, c) >= target) hi = lo
  for (let i = 0; i < 60 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2
    if (otsMetFactor(mid, c) < target) lo = mid
    else hi = mid
  }
  const fill = hi
  return { status: 'ok', mets: mets.map(v => (isValued(v) ? v : fill)), residualShare }
}

/** The vendored constants the fill reads, from the same accessor the scorer uses. Server-only. */
export function otsFillConstants(): OtsFillConstants {
  const c = getOtsTypedConstants()
  return {
    metWeights: c.metWeights, minMetValue: c.minMetValue, metIntensityGamma: c.metIntensityGamma,
    metIntensityM: c.metIntensityM, useMetIntensityWeights: c.useMetIntensityWeights,
  }
}
