import { z } from 'zod'

// Weight range copied from the profile route's weightGoalKg clamp
// (app/api/user/profile/route.ts). Other bounds are generous sanity caps —
// they exist to stop a stray regex match or malformed client write from
// poisoning trends, not to police plausible data.
export const WEIGHT_KG_MIN = 20
export const WEIGHT_KG_MAX = 500

export function validWeightKgOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= WEIGHT_KG_MIN && n <= WEIGHT_KG_MAX ? n : null
}

// Generous sanity bounds for a body circumference measurement (waist/chest/arm/
// thigh/hip/neck) — wide enough to cover any adult body part, tight enough to
// reject an obvious unit mix-up (e.g. inches typed into a cm field).
export const MEASUREMENT_CM_MIN = 10
export const MEASUREMENT_CM_MAX = 300

export function validMeasurementCmOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= MEASUREMENT_CM_MIN && n <= MEASUREMENT_CM_MAX ? n : null
}

export const BODY_FAT_PCT_MIN = 1
export const BODY_FAT_PCT_MAX = 80

export function validBodyFatPctOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= BODY_FAT_PCT_MIN && n <= BODY_FAT_PCT_MAX ? n : null
}

export const CALORIES_MIN = 0
export const CALORIES_MAX = 20000

export function validCaloriesOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= CALORIES_MIN && n <= CALORIES_MAX ? n : null
}

export const MACRO_G_MIN = 0
export const MACRO_G_MAX = 2000

export function validMacroGOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= MACRO_G_MIN && n <= MACRO_G_MAX ? n : null
}

export const STEPS_MIN = 0
export const STEPS_MAX = 200000

export function validStepsOrNull(n: number): number | null {
  return Number.isInteger(n) && n >= STEPS_MIN && n <= STEPS_MAX ? n : null
}

// The four fields below reach the DB ONLY through the offline sync push branch — the web schema
// does not accept them — and that branch type-checked them without bounds while every sibling field
// used a validator. Since `source` is client-chosen and includes `manual` (the top of the precedence
// ladder), an unbounded value there overwrote the ring's real measurement. Bounds match what
// `sync-health` already applies to the identical fields.
export const RESTING_HR_MIN = 20
export const RESTING_HR_MAX = 300
export function validRestingHrOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= RESTING_HR_MIN && n <= RESTING_HR_MAX ? Math.round(n) : null
}

export const HRV_MS_MAX = 1000
export function validHrvMsOrNull(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= HRV_MS_MAX ? n : null
}

export function validSpo2PctOrNull(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null
}

export const WATER_ML_MAX = 20_000
export function validWaterMlOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= 0 && n <= WATER_ML_MAX ? n : null
}

/** A single water increment. The web route caps one call at 5,000 ml; the sync path enforced
 *  neither a bound nor a sign, so a -1e9 delta drove the day's hydration to minus a billion. */
export const WATER_ML_DELTA_MAX = 5000
export function validWaterMlDeltaOrNull(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= WATER_ML_DELTA_MAX ? Math.round(n) : null
}

export const DISTANCE_KM_MIN = 0
export const DISTANCE_KM_MAX = 1000

export function validDistanceKmOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= DISTANCE_KM_MIN && n <= DISTANCE_KM_MAX ? n : null
}

const measurementCm = z.number().min(MEASUREMENT_CM_MIN).max(MEASUREMENT_CM_MAX).nullish()

export const BodyMetadataPostSchema = z.object({
  localDate:  z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  weightKg:   z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).nullish(),
  bodyFat:    z.number().min(BODY_FAT_PCT_MIN).max(BODY_FAT_PCT_MAX).nullish(),
  calories:   z.number().min(CALORIES_MIN).max(CALORIES_MAX).nullish(),
  protein:    z.number().min(MACRO_G_MIN).max(MACRO_G_MAX).nullish(),
  carb:       z.number().min(MACRO_G_MIN).max(MACRO_G_MAX).nullish(),
  fat:        z.number().min(MACRO_G_MIN).max(MACRO_G_MAX).nullish(),
  steps:      z.number().int().min(STEPS_MIN).max(STEPS_MAX).nullish(),
  distanceKm: z.number().min(DISTANCE_KM_MIN).max(DISTANCE_KM_MAX).nullish(),
  waistCm:    measurementCm,
  chestCm:    measurementCm,
  armCm:      measurementCm,
  thighCm:    measurementCm,
  hipCm:      measurementCm,
  neckCm:     measurementCm,
})
