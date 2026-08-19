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

/**
 * Rounds rather than rejecting a fractional count (Q-321).
 *
 * It was the only validator here gated on `Number.isInteger`, so an estimator or decoder producing
 * `8000.5` lost the **whole day's** steps — the push branch discarded the field and the web route
 * answered 400 for the entire body-metrics write, which on `metric-log-sheet`'s one-field payload
 * means the save simply fails.
 *
 * Rounding is the house pattern for the integer-valued columns, not a new call: `resting_heart_rate`
 * and `water_ml` are `integer` columns too, and `validRestingHrOrNull`/`validWaterMlDeltaOrNull`
 * both take a finite number and `Math.round` it. Steps was the outlier.
 *
 * `BodyMetadataPostSchema.steps` below rounds in step with this, deliberately. Changing one without
 * the other would leave the offline push accepting a value the web route refuses, which is exactly
 * the drift the one-write-path-per-domain rule exists to stop.
 */
export function validStepsOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= STEPS_MIN && n <= STEPS_MAX ? Math.round(n) : null
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
  // `.int()` dropped and rounded instead, to mirror `validStepsOrNull` — see its note. The column is
  // `integer`, so the round has to happen somewhere; doing it here keeps the route a pass-through.
  steps:      z.number().min(STEPS_MIN).max(STEPS_MAX).nullish()
                .transform(v => (v == null ? v : Math.round(v))),
  distanceKm: z.number().min(DISTANCE_KM_MIN).max(DISTANCE_KM_MAX).nullish(),
  waistCm:    measurementCm,
  chestCm:    measurementCm,
  armCm:      measurementCm,
  thighCm:    measurementCm,
  hipCm:      measurementCm,
  neckCm:     measurementCm,
// Q-464 — `.strict()`, so an unknown key is a 400 instead of being silently dropped.
//
// Measured on this exact schema: `{"date":"2026-08-10","weightKg":81}` answered
// `200 {"success":true,"date":"2026-08-18"}` and wrote the weight on TODAY, because the contract's
// key is `localDate` and `date` was discarded. `"3026-08-18"` and `"not-a-date"` did the same. The
// route is correct — it reads `body.localDate` and defaults to today in the user's timezone; what
// was missing is that `date` is not in the contract and nothing said so.
//
// Verified safe before flipping: both POST clients (`metric-log-sheet.tsx`,
// `log-value-sheet.tsx`) send `{ localDate, <field> }` and nothing else. The one field key they can
// send that this schema does not name is `waterIntake`, and that write is **already lost today** —
// water lives on `/api/water-log`, not here. Strict turns that silent loss into a visible failure,
// which is the point; the client fix is Q-319.
}).strict()
