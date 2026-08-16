// Illness radar — a rule-based "vs-baseline" deviation flag, NOT Oura's demographic-
// calibrated illness_detection CNN (155k params, weights not portable). It watches the
// biomarkers we already baseline — skin-temperature deviation, resting HR, and HRV —
// and raises a graded advisory when they move together in the illness-consistent
// direction against a *mature personal baseline*. Skin temperature is weighted highest
// because it is the fever signal and the strongest illness marker (Sub-plan E §5.5).
//
// Honesty guards baked in:
//  - It never fires on a cold user: below BASELINE_MIN_NIGHTS of accrued history it
//    reports `learning` and suppresses nothing (learn your normal before calling a
//    deviation).
//  - Breathing rate joined as the 4th biomarker (2026-07-16, review S4): nightly
//    respiratory rate vs its own personal baseline, one-sided higher-is-worse.
//    Weights still renormalise over whichever biomarkers a night actually has.
//  - It is surfaced as a bounded readiness *suppression* (a documented penalty on top
//    of the composite), never as an extra weighted contributor — the biomarkers are
//    already readiness contributors, so re-adding them would double-count (§5.5).

import { BASELINE_MIN_NIGHTS } from './readiness-composite'
import { baselineZ, type Baseline } from './personal-baseline'

/** Relative weights, temperature-first per §5.5 (fever is the strongest signal), used
 *  as the illness_detection biomarker ordering suggests but tuned to the 3 we compute.
 *  Renormalised over whichever biomarkers are actually present. */
export const ILLNESS_WEIGHTS = {
  temperature:      0.40,
  breathing:        0.25,
  restingHeartRate: 0.20,
  hrvBalance:       0.15,
} as const

/** A one-sided z of this magnitude counts as a full (100) illness signal for that
 *  biomarker; smaller deviations scale linearly. z≈3 ≈ a 3-sigma move from baseline. */
export const ILLNESS_Z_FULL = 3

/** Skin-temp z at/above this is treated as fever (the `temp_dev > temp_dev_baseline`
 *  analog — we work in baseline-z space, not absolute °C). */
export const FEVER_TEMP_Z = 2.5

/** illness_score thresholds for the graded, non-fever flags. */
export const ILLNESS_WATCH_SCORE = 40
export const ILLNESS_ELEVATED_SCORE = 65

/** Bounded readiness penalty (points subtracted) per flag. `watch` is advisory-only
 *  (no suppression); `elevated`/`fever` lower readiness because illness overrides an
 *  otherwise-OK score. Documented constants — never magic at the call site. */
export const READINESS_SUPPRESSION: Record<IllnessFlag, number> = {
  learning: 0,
  normal:   0,
  watch:    0,
  elevated: 10,
  fever:    25,
}

export type IllnessFlag = 'learning' | 'normal' | 'watch' | 'elevated' | 'fever'

export type IllnessBiomarkerKey = keyof typeof ILLNESS_WEIGHTS

export interface IllnessInputs {
  /** (sample − baselineMean)/baselineDev of last night's skin temperature. Up = fever-consistent. */
  tempZ: number | null
  /** Same, for resting HR. Up = illness-consistent. */
  rhrZ: number | null
  /** Same, for HRV. Down = illness-consistent. */
  hrvZ: number | null
  /** Same, for nightly respiratory rate. Up = illness-consistent. */
  breathZ: number | null
  /** Nights of baseline history accrued (oura_daily_summary.n_history). */
  nHistory: number
}

export interface IllnessBiomarker {
  /** The raw baseline-z (signed) — the "why", for the advisory. */
  z: number
  /** This biomarker's 0–100 illness contribution (one-sided, weighted share). */
  contribution: number
}

export interface IllnessResult {
  flag: IllnessFlag
  /** 0–100 weighted composite of the one-sided illness signals. 0 while learning. */
  score: number
  /** Per-biomarker `{ z, contribution }`; a biomarker with no z is absent. */
  biomarkers: Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>>
  /** Points to subtract from the displayed readiness (0 unless elevated/fever). */
  readinessSuppression: number
}

/** One-sided, illness-consistent magnitude of a z (0 when the move is in the healthy
 *  direction), scaled to 0–100 by ILLNESS_Z_FULL. */
function illnessSignal(z: number, direction: 'up-bad' | 'down-bad'): number {
  const mag = direction === 'up-bad' ? Math.max(0, z) : Math.max(0, -z)
  return Math.max(0, Math.min(100, (mag / ILLNESS_Z_FULL) * 100))
}

/**
 * Compute the illness radar from tonight's baseline-z scores. Pure. `learning` (cold
 * baseline) and any all-null input yield a zero score and no suppression — never a
 * fabricated signal.
 */
export function computeIllnessRadar(input: IllnessInputs): IllnessResult {
  const signals: { key: IllnessBiomarkerKey; z: number; signal: number }[] = []
  if (input.tempZ != null) signals.push({ key: 'temperature', z: input.tempZ, signal: illnessSignal(input.tempZ, 'up-bad') })
  if (input.breathZ != null) signals.push({ key: 'breathing', z: input.breathZ, signal: illnessSignal(input.breathZ, 'up-bad') })
  if (input.rhrZ != null) signals.push({ key: 'restingHeartRate', z: input.rhrZ, signal: illnessSignal(input.rhrZ, 'up-bad') })
  if (input.hrvZ != null) signals.push({ key: 'hrvBalance', z: input.hrvZ, signal: illnessSignal(input.hrvZ, 'down-bad') })

  // Cold baseline, or no biomarker at all → learning, no signal, no suppression.
  if (input.nHistory < BASELINE_MIN_NIGHTS || signals.length === 0) {
    const biomarkers: IllnessResult['biomarkers'] = {}
    for (const s of signals) biomarkers[s.key] = { z: round2(s.z), contribution: 0 }
    return { flag: 'learning', score: 0, biomarkers, readinessSuppression: 0 }
  }

  const totalWeight = signals.reduce((sum, s) => sum + ILLNESS_WEIGHTS[s.key], 0)
  const biomarkers: IllnessResult['biomarkers'] = {}
  let score = 0
  for (const s of signals) {
    const contribution = (s.signal * ILLNESS_WEIGHTS[s.key]) / totalWeight
    score += contribution
    biomarkers[s.key] = { z: round2(s.z), contribution: Math.round(contribution) }
  }
  score = Math.round(score)

  const isFever = input.tempZ != null && input.tempZ >= FEVER_TEMP_Z
  const flag: IllnessFlag = isFever
    ? 'fever'
    : score >= ILLNESS_ELEVATED_SCORE
      ? 'elevated'
      : score >= ILLNESS_WATCH_SCORE
        ? 'watch'
        : 'normal'

  return { flag, score, biomarkers, readinessSuppression: READINESS_SUPPRESSION[flag] }
}

/** The daily-summary fields the radar reads. Structurally satisfied by both the rollup's
 *  `DailySummaryRow` and the route's `OuraDailySummaryRow` (their baseline fields are the
 *  same `{meanX8, devX8}` shape). */
export interface IllnessSummaryInput {
  rhrBaseline: Baseline | null
  hrvBaseline: Baseline | null
  tempBaseline: Baseline | null
  breathBaseline: Baseline | null
  rhrLowBpm: number | null
  hrvAvgMs: number | null
  tempMeanC: number | null
  breathAvgRpm: number | null
  nHistory: number
}

/** Tonight's biomarker z-scores vs the PRIOR night's baseline (the pre-update relationship) —
 *  the single source both the readiness route and the rollup use, so the live-displayed and the
 *  persisted illness can never diverge. Skin temp is compared in centi-°C to match the baseline. */
export function illnessZScores(prior: IllnessSummaryInput | null, current: IllnessSummaryInput): {
  rhrZ: number | null; hrvZ: number | null; tempZ: number | null; breathZ: number | null
} {
  return {
    rhrZ: prior?.rhrBaseline && current.rhrLowBpm != null ? baselineZ(prior.rhrBaseline, Math.round(current.rhrLowBpm)) : null,
    hrvZ: prior?.hrvBaseline && current.hrvAvgMs != null ? baselineZ(prior.hrvBaseline, Math.round(current.hrvAvgMs)) : null,
    tempZ: prior?.tempBaseline && current.tempMeanC != null ? baselineZ(prior.tempBaseline, Math.round(current.tempMeanC * 100)) : null,
    // Breathing compared in rpm×10 to match its baseline units (same pattern as temp's centi-°C).
    breathZ: prior?.breathBaseline && current.breathAvgRpm != null ? baselineZ(prior.breathBaseline, Math.round(current.breathAvgRpm * 10)) : null,
  }
}

/** Compute the radar for a (prior, current) summary pair — used by the rollup to persist per night. */
export function illnessFromSummaries(prior: IllnessSummaryInput | null, current: IllnessSummaryInput): IllnessResult {
  const { rhrZ, hrvZ, tempZ, breathZ } = illnessZScores(prior, current)
  return computeIllnessRadar({ tempZ, rhrZ, hrvZ, breathZ, nHistory: current.nHistory })
}

/** Short human advisory for the readiness surface, or null when nothing to say. */
export function illnessAdvisory(flag: IllnessFlag): string | null {
  switch (flag) {
    case 'fever':
      return 'Skin temperature is well above your baseline — possible fever. Readiness lowered; rest and hydrate.'
    case 'elevated':
      return 'Signs your body may be fighting something (temperature, resting HR, HRV, breathing rate moving together) — readiness lowered.'
    case 'watch':
      return 'Some biomarkers are drifting from your baseline — worth keeping an eye on.'
    default:
      return null
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** The latest persisted illness reading from a `getOuraDailyDerived` range. */
export interface LatestIllness {
  day: string
  flag: IllnessFlag
  score: number
  biomarkers: Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>> | null
}

/**
 * Latest non-learning illness row from an ASC-sorted `oura_daily_derived` range (the shape
 * `repo.getOuraDailyDerived` returns). The ONE place the repo's `string | null` flag is
 * narrowed to IllnessFlag. `learning` or no flagged row → null — consumers treat null as
 * "no data" and must never act on it.
 */
export function latestIllnessFromDerived(
  rows: Array<{ day: string; illnessFlag: string | null; illnessScore: number | null; illnessBiomarkers?: unknown }>,
): LatestIllness | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.illnessFlag == null) continue
    if (r.illnessFlag === 'learning') return null
    return {
      day: r.day,
      flag: r.illnessFlag as IllnessFlag,
      score: r.illnessScore ?? 0,
      biomarkers: (r.illnessBiomarkers ?? null) as Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>> | null,
    }
  }
  return null
}
