/**
 * Per-workout active-energy estimate — Oura `energy_expenditure_1_0_0` MET fallback (Phase A).
 *
 * When Oura's model lacks enough motion signal it falls back to a closed-form MET estimate
 * (`app.py` `has_enough_motion === false` branch):
 *
 *     kcal = max(0, duration_min × (met − 1.5) × bmr_per_minute)
 *
 * where `met` is the activity's easy/moderate/hard tier and `bmr_per_minute` is the Schofield BMR.
 * This module ports that path faithfully — the exact Schofield coefficients (`util.py`) and the
 * 82-activity MET table (`energy-expenditure-features.json`) are pinned to the model's own `.pt`
 * source. Deterministic; no neural inference. See
 * `docs/superpowers/plans/2026-07-15-energy-expenditure-onnx.md`.
 */
import { getEnergyFeatureSpec } from '@/lib/oura-models/constants'
import { DEFAULT_ACTIVITY_ID } from '@trainingai/shared/health/workout-activities'

export type Sex = 'male' | 'female'
export type Intensity = 'easy' | 'moderate' | 'hard'

export { DEFAULT_ACTIVITY_ID }

/** True when `id` is a real Oura activity in the MET table (guards a client-supplied param). */
export function isKnownActivity(id: number): boolean {
  return metForActivity(id, 'moderate') != null
}

type ActivityMet = { name: string; met_easy: number; met_moderate: number; met_hard: number }

/**
 * Read on FIRST USE, memoised — not at module scope, which is where this used to be.
 *
 * A module-scope read is still a build-time dependency, whatever the loader does: `next build`
 * imports every route to collect page data, so importing this module opened the file. That went
 * unnoticed while the constants were committed, and the deletion turned it into `ENOENT ...
 * energy-expenditure-features.json` at `Failed to collect page data for /api/achievements`. The
 * directory only exists at runtime now, so the read has to happen at runtime too.
 *
 * Every consumer of this module is server-side (verified 2026-08-13).
 */
let activityMet: Record<string, ActivityMet> | null = null
function activityMetTable(): Record<string, ActivityMet> {
  return (activityMet ??= getEnergyFeatureSpec().activity_type_dict as Record<string, ActivityMet>)
}

// Schofield BMR coefficients (kcal/day), ported verbatim from the model's util.py.
// Rows: 0 = female, 1 = male. Columns align with the age brackets' upper bounds.
const AGE_BRACKETS = [1.5, 6.5, 14, 24, 45, 500]
const WEIGHT_MULT: [number[], number[]] = [
  [58.317, 20.315, 13.384, 14.818, 8.126, 9.082],   // female
  [59.512, 22.706, 17.686, 15.057, 11.472, 11.711], // male
]
const WEIGHT_BIAS: [number[], number[]] = [
  [-31.1, 485.9, 692.6, 486.6, 845.6, 658.5],  // female
  [-30.4, 504.3, 658.2, 692.2, 873.1, 587.7],  // male
]

/** Schofield basal metabolic rate in kcal/day, age-bracket-interpolated (mirrors util.py). */
export function schofieldBmrPerDay(ageYears: number, weightKg: number, sex: Sex): number {
  if (ageYears < 1.5) return 0
  const g = sex === 'male' ? 1 : 0
  const upper = AGE_BRACKETS.findIndex(b => b > ageYears)
  // Ages past the top bracket (>500) never occur for a real user; clamp defensively.
  const u = upper === -1 ? AGE_BRACKETS.length - 1 : upper
  const lower = u - 1
  const loBmr = WEIGHT_MULT[g][lower] * weightKg + WEIGHT_BIAS[g][lower]
  if (u === lower) return loBmr
  const upBmr = WEIGHT_MULT[g][u] * weightKg + WEIGHT_BIAS[g][u]
  const ratio = (ageYears - AGE_BRACKETS[lower]) / (AGE_BRACKETS[u] - AGE_BRACKETS[lower])
  return loBmr + (upBmr - loBmr) * ratio
}

/** Schofield BMR per minute — the model's `bmr_per_minute` (kcal/day ÷ 24 ÷ 60). */
export function bmrPerMinute(ageYears: number, weightKg: number, sex: Sex): number {
  return schofieldBmrPerDay(ageYears, weightKg, sex) / 24 / 60
}

/** MET for an activity at a given intensity tier, or null if the activity id is unknown. */
export function metForActivity(activityId: number, intensity: Intensity): number | null {
  const a = activityMetTable()[String(activityId)]
  if (!a) return null
  return intensity === 'easy' ? a.met_easy : intensity === 'hard' ? a.met_hard : a.met_moderate
}

/** Map a Foster session RPE (1–10) to the model's easy/moderate/hard intensity tier. */
export function intensityFromRpe(rpe: number | null | undefined): Intensity {
  if (rpe == null) return 'moderate'
  if (rpe <= 4) return 'easy'
  if (rpe >= 8) return 'hard'
  return 'moderate'
}

export interface WorkoutEnergyInput {
  durationMin: number
  ageYears: number
  weightKg: number
  sex: Sex
  activityId?: number
  intensity: Intensity
}

/**
 * Estimated active energy (kcal) for one workout via Oura's MET fallback. Returns null when a
 * required input is missing or non-finite (caller shows nothing rather than a wrong number).
 */
export function estWorkoutKcal(input: WorkoutEnergyInput): number | null {
  const { durationMin, ageYears, weightKg, sex, intensity } = input
  const activityId = input.activityId ?? DEFAULT_ACTIVITY_ID
  if (![durationMin, ageYears, weightKg].every(v => typeof v === 'number' && Number.isFinite(v))) return null
  if (durationMin <= 0 || ageYears <= 0 || weightKg <= 0) return null
  const met = metForActivity(activityId, intensity)
  if (met == null) return null
  return Math.max(0, durationMin * (met - 1.5) * bmrPerMinute(ageYears, weightKg, sex))
}
