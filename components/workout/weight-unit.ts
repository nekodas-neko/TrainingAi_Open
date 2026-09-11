import { lbsToKg, kgToLbs } from '@trainingai/shared/workout/units'

/**
 * The weight dial's display unit, and the conversion around it (BF-141).
 *
 * Owner, from the live logging screen for Dumbbell Lateral Raise: *"my Dumbells are pounds and I
 * need to convert it. im 90% in kg but some are lb ... then just have it convert to the kg
 * equivalent"*.
 *
 * **Stored weight is ALWAYS kilograms.** `set_logs.weight_kg` has no companion unit column and this
 * does not add one — the point is to stop pounds reaching the payload, not to record which unit
 * arrived. The unit here is a property of the *dial*, never of the value.
 *
 * **This exists because the failure has already happened, on this exercise.** Session 119
 * (2026-06-15): Dumbbell Lateral Raise, Preacher Curl and Shoulder Press were logged in pounds into
 * the kg field, inflating 1RM, target80, volume and the all-time PR. The repair needed an admin
 * preview/apply tool that still ships. A pound value validates cleanly against
 * `weights: z.array(z.number().min(-100).max(500))` and lands as kilograms, exactly as before.
 */
export type WeightUnit = 'kg' | 'lb'

/**
 * Pound detents, because the kg grid has no pound dumbbell on it.
 *
 * The dial steps 1.25 kg for non-barbell equipment, which is 2.76 lb — a grid no dumbbell sits on.
 * A 20 lb dumbbell is 9.07 kg and the kg dial offers 8.75 or 10.00. Reusing the kg step and
 * relabelling it is the trap: it would offer 1.25 lb rungs that do not exist either.
 */
export const LB_STEP = 2.5

/** Storage precision for a converted weight — what the 2026-06-15 repair tool used for derived figures. */
const STORAGE_PRECISION_KG = 0.25

/**
 * **Never `mround125` or `mroundStep`.** Both clamp to [5, 250]
 * (`components/workout/utils.ts`), so a 5 lb dumbbell — 2.27 kg — floors to **5 kg** and silently
 * more than doubles. Snapping a converted weight back onto the 1.25 kg grid would also reinstate
 * the exact inaccuracy the toggle exists to remove. Round to the storage precision and stop.
 */
function roundForStorage(kg: number): number {
  return Math.round(kg / STORAGE_PRECISION_KG) * STORAGE_PRECISION_KG
}

/** The stored kilograms, as the dial should show them. */
export function toDisplay(kg: number, unit: WeightUnit): number {
  if (unit === 'kg') return kg
  return Math.round(kgToLbs(kg) / LB_STEP) * LB_STEP
}

/** A dial value, as kilograms to store. */
export function fromDisplay(value: number, unit: WeightUnit): number {
  if (unit === 'kg') return value
  return roundForStorage(lbsToKg(value))
}

/** The dial's own range, in whichever unit it is drawing. */
export function dialRange(unit: WeightUnit, kgStep: number): { min: number; max: number; step: number } {
  if (unit === 'kg') return { min: 0, max: 250, step: kgStep }
  // 550 lb is 249.5 kg — the kg ceiling, without letting the grid run past it.
  return { min: 0, max: 550, step: LB_STEP }
}

export const UNIT_STORAGE_PREFIX = 'ta_weight_unit_v1:'

/**
 * Which unit this exercise was last logged in.
 *
 * **Per exercise, and `localStorage` rather than the synced preference bag.** He is 90% metric with
 * a few pound items, and those are tied to specific exercises — per-exercise is the only shape where
 * he sets it once and stops thinking about it. It is deliberately not in `UserPreferencesSchema`:
 * that is `.strict()`, so a key there means editing the schema *and* `PREFERENCE_STORAGE`, and this
 * is a fact about which dumbbells are in one room. It should not follow him to another device.
 *
 * Keyed by `sessionExerciseId` — session identity is the DB id, never the name.
 */
export function readUnit(exerciseId: string | undefined): WeightUnit {
  if (!exerciseId) return 'kg'
  try {
    return localStorage.getItem(UNIT_STORAGE_PREFIX + exerciseId) === 'lb' ? 'lb' : 'kg'
  } catch { return 'kg' }
}

export function writeUnit(exerciseId: string | undefined, unit: WeightUnit): void {
  if (!exerciseId) return
  try {
    if (unit === 'kg') localStorage.removeItem(UNIT_STORAGE_PREFIX + exerciseId)
    else localStorage.setItem(UNIT_STORAGE_PREFIX + exerciseId, 'lb')
  } catch { /* private mode */ }
}
