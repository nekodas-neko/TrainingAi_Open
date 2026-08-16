// Cardio baseline / fitness-test estimators — One Formula, One Place.
// Every VO2max equation is pinned to a published source, cited inline. Before
// adding a new estimator here, confirm no duplicate exists (grep 'vo2max').
import { analyseHrRecovery, type HrReading } from '@trainingai/shared/workout/hr-analysis'
import { computeObservedHr } from '@trainingai/shared/health/observed-hr'

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

const clampVo2 = (v: number): number => round1(Math.max(10, Math.min(100, v)))

export interface SixMwtInputs {
  distanceM: number
  age: number | null
  sex: string | null          // 'male' | 'female' | 'other' | null
  weightKg: number | null
  restingHr: number | null
}

/**
 * 6-Minute Walk Test → VO2max (mL·kg⁻¹·min⁻¹).
 *
 * Primary — Burr et al. (2011) multivariable model, developed & validated on
 * healthy working-aged adults (R²≈0.72):
 *   VO2max = 70.161 + 0.023·dist(m) − 0.276·weight(kg)
 *            − 6.79·sex(male=0, female=1) − 0.193·restingHR(bpm) − 0.191·age(yr)
 * Burr JF, Bredin SS, Faktor MD, Warburton DE. "The 6-minute walk test as a
 * predictor of objectively measured aerobic fitness in healthy working-aged
 * adults." Phys Sportsmed. 2011;39(2):133-9.
 *
 * Fallback (only when weight / sex / resting HR / age are unavailable) — Ross
 * et al. (2010) distance-only form: VO2peak = 4.948 + 0.023·dist(m). This was
 * derived on a mixed clinical/referral population and systematically UNDER-reads
 * for healthy adults (roughly half a fit person's true VO2max — a 600 m walk
 * reads ~18), so it is the last resort, used only when the profile terms are
 * missing. Ross RM et al. BMC Pulm Med. 2010;10:31.
 */
export function sixMwtVo2max(input: SixMwtInputs): number {
  const sexCode = input.sex === 'female' ? 1 : input.sex === 'male' ? 0 : null
  if (
    input.age != null && input.weightKg != null && input.weightKg > 0 &&
    input.restingHr != null && input.restingHr > 0 && sexCode != null
  ) {
    return clampVo2(
      70.161 + 0.023 * input.distanceM - 0.276 * input.weightKg
        - 6.79 * sexCode - 0.193 * input.restingHr - 0.191 * input.age,
    )
  }
  return clampVo2(4.948 + 0.023 * input.distanceM)   // Ross 2010 fallback
}

/**
 * Cooper 12-minute run → VO2max (mL·kg⁻¹·min⁻¹).
 * Cooper KH. "A means of assessing maximal oxygen intake." JAMA.
 * 1968;203(3):201-204.
 *   VO2max = (distance(metres) − 504.9) / 44.73
 */
export function cooperVo2max(distanceM: number): number {
  return round1((distanceM - 504.9) / 44.73)
}

/**
 * 1-minute heart-rate recovery for a baseline test. Reuses the workout
 * HR-recovery analyser (lib/workout/hr-analysis) — do NOT re-implement HRR.
 * Recovery is anchored at the PEAK-HR instant within the capture (the end of the
 * hard effort), and HRR1 is read from samples already recorded during the
 * post-effort rest minute — never from a reading after capture ends, which never
 * exists because sampling stops at the Finish tap (review E2-9). Result is the
 * peak bpm minus bpm 60 s later; a larger drop = better recovery. Null when there
 * is no post-peak rest minute captured (peak too close to the end).
 */
export function baselineHrr1(readings: HrReading[]): number | null {
  if (readings.length < 2) return null
  let peak = readings[0]
  for (const r of readings) if (r.bpm > peak.bpm) peak = r
  const [stat] = analyseHrRecovery(readings, [
    { exerciseName: 'baseline', setNumber: 1, loggedAt: peak.timestamp },
  ])
  return stat.hrr1
}

/** Corroborated low bpm across the captured readings (resting-HR proxy), or null when
 *  there is too little data. Spike-rejected — a single dropout must not become a resting HR. */
export function restingHrFrom(readings: HrReading[]): number | null {
  return computeObservedHr(readings.map((r) => r.bpm)).min
}

/** Corroborated peak bpm across the captured readings, or null when there is too little
 *  data. This was a bare `Math.max`, so one motion artefact set the test's peak — and that
 *  value was fed straight in as a max-HR override. `computeObservedHr` drops readings
 *  outside 30–220 bpm and takes the k-th highest, so a lone spike can't move it. */
export function maxHrFrom(readings: HrReading[]): number | null {
  return computeObservedHr(readings.map((r) => r.bpm)).max
}
