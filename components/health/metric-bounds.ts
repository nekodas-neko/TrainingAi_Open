/**
 * The bounds a user-typed body metric is checked against, at the keyboard (Q-321).
 *
 * **Why this exists at all.** `packages/shared/src/validation/body-metrics.ts` has held every one of
 * these thresholds for months and was imported by nothing under `components/` or `app/` except the
 * API route. So a 5,000 kg weight was accepted by the sheet, written to the local store, queued,
 * pushed — and silently discarded server-side, where the number the user typed never appeared
 * again. The bounds were never missing; the client just never asked.
 *
 * **Why only user-typed fields.** Q-321's decision was that a device-sourced reading (`hrvMs`,
 * `spo2Pct`, `restingHr` from the ring or Health Connect) should keep coercing silently, because the
 * user cannot fix a bad reading and a badge over one is noise they cannot clear. A value someone
 * typed is the opposite case: they can correct it, and the only place that correction is cheap is
 * before the keyboard closes.
 *
 * **No new thresholds live here.** Every bound is imported from the shared module, so the client and
 * the server cannot disagree about what is acceptable — which is the same reason `pushMutations` and
 * the web route share it.
 */
import {
  validWeightKgOrNull, WEIGHT_KG_MIN, WEIGHT_KG_MAX,
  validBodyFatPctOrNull, BODY_FAT_PCT_MIN, BODY_FAT_PCT_MAX,
  validStepsOrNull, STEPS_MIN, STEPS_MAX,
  validCaloriesOrNull, CALORIES_MIN, CALORIES_MAX,
  validMacroGOrNull, MACRO_G_MIN, MACRO_G_MAX,
  validWaterMlDeltaOrNull, WATER_ML_DELTA_MAX,
} from '@trainingai/shared/validation/body-metrics'

/** Keyed by the field name each sheet already uses, so no caller needs a second mapping. */
export type BoundedMetricField =
  | 'weightKg' | 'bodyFat' | 'bodyFatPct' | 'steps'
  | 'calories' | 'protein' | 'carb' | 'fat'
  | 'waterIntake' | 'waterMlDelta'

interface Bound {
  valid: (n: number) => number | null
  min: number
  max: number
  unit: string
}

const BOUNDS: Record<BoundedMetricField, Bound> = {
  weightKg:     { valid: validWeightKgOrNull,      min: WEIGHT_KG_MIN,     max: WEIGHT_KG_MAX,        unit: 'kg' },
  bodyFat:      { valid: validBodyFatPctOrNull,    min: BODY_FAT_PCT_MIN,  max: BODY_FAT_PCT_MAX,     unit: '%' },
  bodyFatPct:   { valid: validBodyFatPctOrNull,    min: BODY_FAT_PCT_MIN,  max: BODY_FAT_PCT_MAX,     unit: '%' },
  steps:        { valid: validStepsOrNull,         min: STEPS_MIN,         max: STEPS_MAX,            unit: '' },
  calories:     { valid: validCaloriesOrNull,      min: CALORIES_MIN,      max: CALORIES_MAX,         unit: 'kcal' },
  protein:      { valid: validMacroGOrNull,        min: MACRO_G_MIN,       max: MACRO_G_MAX,          unit: 'g' },
  carb:         { valid: validMacroGOrNull,        min: MACRO_G_MIN,       max: MACRO_G_MAX,          unit: 'g' },
  fat:          { valid: validMacroGOrNull,        min: MACRO_G_MIN,       max: MACRO_G_MAX,          unit: 'g' },
  // A water ENTRY is an increment, and `validWaterMlDeltaOrNull` is one of the two validators that
  // quarantines rather than coerces — so an out-of-range value here dead-letters into a badge the
  // user cannot act on. It is the field this check buys the most.
  waterIntake:  { valid: validWaterMlDeltaOrNull,  min: 1,                 max: WATER_ML_DELTA_MAX,   unit: 'ml' },
  waterMlDelta: { valid: validWaterMlDeltaOrNull,  min: 1,                 max: WATER_ML_DELTA_MAX,   unit: 'ml' },
}

/**
 * `null` when the value is acceptable, otherwise the message to show under the input.
 *
 * An empty string is not an error — it is an unfinished entry, and the Save button is already
 * disabled for it. Saying "enter a number" while someone is still reaching for the keypad is noise.
 *
 * A field with no bound returns `null` rather than throwing: this is a guard on the way to a save,
 * and a new field arriving without an entry here must not become an unsaveable one.
 */
export function metricBoundError(field: string, raw: string): string | null {
  if (raw.trim() === '') return null
  const bound = BOUNDS[field as BoundedMetricField]
  if (!bound) return null
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return 'Enter a number'
  if (bound.valid(n) !== null) return null
  const suffix = bound.unit ? ` ${bound.unit}` : ''
  return `Enter a value between ${bound.min.toLocaleString()} and ${bound.max.toLocaleString()}${suffix}`
}

/** True when this field has a bound at all — for a caller that wants to know before it asks. */
export function hasMetricBound(field: string): field is BoundedMetricField {
  return field in BOUNDS
}
