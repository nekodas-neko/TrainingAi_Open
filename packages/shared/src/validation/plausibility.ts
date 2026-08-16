/**
 * Cross-field plausibility — do a payload's fields make sense *against each other*?
 *
 * The 2026-07-28 step over-count got through because `steps` (≤20,000) and window length (≤4 h) were
 * each bounded and the *pair* never was: 3,605 steps in 13 minutes passed both checks. The audit that
 * followed found `isPlausibleStepWindow` was the only cross-field check in the codebase, while
 * `activity_logs` would accept 420 km in one minute at 900,000 kcal.
 *
 * These bounds are deliberately **generous**. They exist to reject the physically impossible, not to
 * second-guess a hard session — every threshold here sits far above any real human performance, so a
 * rejection means a decode fault, a unit mix-up or a bad client, never a good day. Where the codebase
 * already owns a bound (cadence, gait cadence, the auto-detection floor) it is imported rather than
 * restated.
 */
import { MAX_PLAUSIBLE_SPM } from '@trainingai/shared/health/cadence'

/** Fastest sustained average a human reaches under any self-powered mode. Downhill cycling tops out
 *  near 80 km/h; 120 leaves headroom while still catching 25,200 km/h from a 1-minute duration. */
export const MAX_AVG_SPEED_KMH = 120

/** Elite sustained expenditure is ~25 kcal/min. 100 is four times that. */
export const MAX_KCAL_PER_MIN = 100

/** Steps per minute over a whole activity. Sprint cadence peaks near 220 (MAX_PLAUSIBLE_SPM); an
 *  average above that across an entire session is a counting fault. */
export const MAX_STEPS_PER_MIN = MAX_PLAUSIBLE_SPM

/**
 * Single-field ceilings for one activity (Q-164).
 *
 * The rate checks below are cross-field: every one of them is skipped when `durationMin` is absent
 * or zero, because there is nothing to divide by. That left each numeric unbounded **on its own** —
 * `POST /api/activity-logs` with `durationMin: 100000` and nothing else returned 201, persisting a
 * single walk of 69.4 days. A plausible typo (1000 for 100) is the more dangerous case, because
 * nothing looks obviously wrong afterwards and every weekly aggregate silently absorbs it.
 *
 * Derived from the rate constants wherever possible, so a single-field ceiling can never contradict
 * the per-minute check that runs beside it.
 */

/** A day. Beyond this the value is unrepresentable anyway: `addMinutes` wraps at 1440, so a longer
 *  duration derives an end time *earlier the same day* rather than a later one. Covers a 24 h ultra. */
export const MAX_ACTIVITY_DURATION_MIN = 1440

/** 24 h at the speed ceiling. The 24 h cycling record is ~1,000 km, so this is nearly 3× clear. */
export const MAX_ACTIVITY_DISTANCE_KM = MAX_AVG_SPEED_KMH * (MAX_ACTIVITY_DURATION_MIN / 60)

/** 24 h at the expenditure ceiling — itself already 4× elite sustained output. */
export const MAX_ACTIVITY_KCAL = MAX_KCAL_PER_MIN * MAX_ACTIVITY_DURATION_MIN

/** 24 h at sprint cadence. No one averages that for a day; it catches counting faults. */
export const MAX_ACTIVITY_STEPS = MAX_STEPS_PER_MIN * MAX_ACTIVITY_DURATION_MIN

/** Vertical metres in one activity. A "double Everesting" is ~17,700 m of ascent; this clears it. */
export const MAX_ACTIVITY_ELEVATION_M = 25_000

/** Slowest average pace worth recording — one hour per kilometre is already a standstill. */
export const MAX_PACE_SEC_PER_KM = 3600

/** Heart rate, beyond which a reading is a sensor artefact rather than a person. Matches the bounds
 *  `sync-health` already applies per-field. */
export const MIN_PLAUSIBLE_BPM = 20
export const MAX_PLAUSIBLE_BPM = 250

/** Beat-to-beat interval band. 200 ms is 300 bpm, 4,000 ms is 15 bpm. */
export const MIN_PLAUSIBLE_RR_MS = 200
export const MAX_PLAUSIBLE_RR_MS = 4000

/**
 * How far a packet's RR intervals may imply a rate its own bpm disagrees with.
 *
 * Wide on purpose: the strap's bpm is smoothed while the intervals are instantaneous, so they
 * legitimately diverge through a hard interval. Beyond this one of the two is a decode fault.
 */
export const RR_BPM_TOLERANCE = 0.5

/**
 * True when a chest-strap packet contradicts itself (Q-24 §7).
 *
 * `bpm` and `rr` were each filtered against their own band and never compared, so a packet could
 * store a 60 bpm reading alongside intervals implying 200 — and the intervals are what feed HRV,
 * where a wrong value is not obviously wrong on any screen.
 *
 * Only in-band intervals are averaged: the rest are dropped anyway, and letting them skew the mean
 * would reject packets that are mostly fine. A packet whose own bpm is out of band is not judged —
 * bpm=0 during strap-on acquisition is routine, and there is nothing trustworthy to compare against.
 */
export function rrContradictsBpm(rr: number[], bpm: number): boolean {
  if (bpm < MIN_PLAUSIBLE_BPM || bpm > MAX_PLAUSIBLE_BPM) return false
  const inBand = rr.filter(v => v >= MIN_PLAUSIBLE_RR_MS && v <= MAX_PLAUSIBLE_RR_MS)
  if (inBand.length === 0) return false
  const meanRr = inBand.reduce((a, b) => a + b, 0) / inBand.length
  return Math.abs(60_000 / meanRr - bpm) / bpm > RR_BPM_TOLERANCE
}

export interface ActivityPlausibilityInput {
  durationMin?: number | null
  distanceKm?: number | null
  caloriesBurned?: number | null
  steps?: number | null
  avgHr?: number | null
  maxHr?: number | null
}

/**
 * Returns a human-readable reason the activity is impossible, or `null` if it is fine.
 *
 * A reason string rather than a boolean on purpose: these reach a 400 response, and "distance
 * implies 25200 km/h" tells the owner what actually went wrong where "invalid activity" does not.
 *
 * Every rate check is skipped when `durationMin` is absent or zero — there is nothing to divide by,
 * and inventing a duration to validate against would be worse than not checking.
 */
export function activityImplausibleReason(a: ActivityPlausibilityInput): string | null {
  const mins = a.durationMin != null && a.durationMin > 0 ? a.durationMin : null

  if (a.avgHr != null && (a.avgHr < MIN_PLAUSIBLE_BPM || a.avgHr > MAX_PLAUSIBLE_BPM)) {
    return `avgHr ${a.avgHr} is outside ${MIN_PLAUSIBLE_BPM}-${MAX_PLAUSIBLE_BPM} bpm`
  }
  if (a.maxHr != null && (a.maxHr < MIN_PLAUSIBLE_BPM || a.maxHr > MAX_PLAUSIBLE_BPM)) {
    return `maxHr ${a.maxHr} is outside ${MIN_PLAUSIBLE_BPM}-${MAX_PLAUSIBLE_BPM} bpm`
  }
  // A max below the average is self-contradictory whichever one is wrong.
  if (a.avgHr != null && a.maxHr != null && a.maxHr < a.avgHr) {
    return `maxHr ${a.maxHr} is below avgHr ${a.avgHr}`
  }

  if (mins == null) return null

  if (a.distanceKm != null) {
    const kmh = a.distanceKm / (mins / 60)
    if (kmh > MAX_AVG_SPEED_KMH) return `distance implies ${Math.round(kmh)} km/h`
  }
  if (a.caloriesBurned != null && a.caloriesBurned / mins > MAX_KCAL_PER_MIN) {
    return `calories imply ${Math.round(a.caloriesBurned / mins)} kcal/min`
  }
  if (a.steps != null && a.steps / mins > MAX_STEPS_PER_MIN) {
    return `steps imply ${Math.round(a.steps / mins)} steps/min`
  }
  return null
}

export interface SleepPlausibilityInput {
  /** Hours between sleepStart and sleepEnd. */
  spanHours?: number | null
  durationHours?: number | null
  deepSleepHours?: number | null
  remSleepHours?: number | null
  lightSleepHours?: number | null
  awakHours?: number | null
}

/**
 * A night cannot contain more sleep than it lasted. Each stage was bounded independently, so four
 * stages of ≤24 h could sum to 96 hours inside a one-hour window.
 *
 * A small tolerance is allowed because the stages and the span come from different places (the stage
 * rollup vs the session window) and rounding at both ends should not reject a real night.
 */
export const SLEEP_STAGE_TOLERANCE_HOURS = 0.5

export function sleepImplausibleReason(sl: SleepPlausibilityInput): string | null {
  const span = sl.spanHours
  if (span != null && span < 0) return `sleepEnd is before sleepStart`
  const stages = [sl.deepSleepHours, sl.remSleepHours, sl.lightSleepHours, sl.awakHours]
    .filter((h): h is number => h != null)
  const stageSum = stages.reduce((a, b) => a + b, 0)

  if (span != null && span > 0) {
    if (stages.length > 0 && stageSum > span + SLEEP_STAGE_TOLERANCE_HOURS) {
      return `stages total ${stageSum.toFixed(1)} h inside a ${span.toFixed(1)} h window`
    }
    if (sl.durationHours != null && sl.durationHours > span + SLEEP_STAGE_TOLERANCE_HOURS) {
      return `durationHours ${sl.durationHours} exceeds the ${span.toFixed(1)} h window`
    }
  }
  return null
}

/**
 * No human has lifted this much, so an estimated 1RM above it is arithmetic, not strength.
 * The heaviest deadlift ever recorded is ~501 kg; the ceiling sits clear of it so a real lift
 * can never be rejected.
 */
export const MAX_PLAUSIBLE_ONE_RM_KG = 600

/**
 * True when an estimated 1RM could not belong to a human.
 *
 * `weights` and `reps` are each bounded on their own (≤500 kg, ≤100 reps) and each bound is
 * reasonable — but the Epley-style rep factor multiplies them, so the individually-legal pair
 * 500 kg × 100 reps estimates a 1612.75 kg 1RM (Q-24 §7). That number is then written to
 * `personal_records`, which keeps the maximum **forever**: the IfBetter gate that protects the
 * table from bad data is exactly what makes a bad value permanent.
 *
 * This is the cross-field check the individual bounds cannot express.
 */
export function oneRmImplausible(estimated1rm: number): boolean {
  return !Number.isFinite(estimated1rm) || estimated1rm > MAX_PLAUSIBLE_ONE_RM_KG
}
