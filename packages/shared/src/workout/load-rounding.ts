/**
 * Plate rounding and the starting weight of a set, for both apps.
 *
 * These lived in `components/workout/utils.ts` and were copied into the native app's
 * `logging/targets.ts` (issue 2995, the #2888 pattern). The copies matched; this keeps them from
 * drifting. `components/workout/utils.ts` re-exports everything here.
 */

// Barbell plates come in pairs, so the smallest real change on a bar is two
// plates — 2.5 kg with a 1.25 kg pair. Other equipment (dumbbells, cable
// stacks, machines) keeps the finer 1.25 kg default.
export const BARBELL_WEIGHT_STEP_KG = 2.5
export const DEFAULT_WEIGHT_STEP_KG = 1.25

export function weightStepFor(equipment?: string[] | null): number {
  return equipment?.includes('barbell') ? BARBELL_WEIGHT_STEP_KG : DEFAULT_WEIGHT_STEP_KG
}

/** The bar range every plate-rounded weight is clamped to. */
export const MIN_BAR_KG = 5
export const MAX_BAR_KG = 250

export function mroundStep(value: number, step: number): number {
  return Math.max(MIN_BAR_KG, Math.min(MAX_BAR_KG, Math.round(value / step) * step))
}

export function mroundStepUp(value: number, step: number): number {
  return Math.max(MIN_BAR_KG, Math.min(MAX_BAR_KG, Math.ceil(value / step) * step))
}

/** #2762: true when `mroundStepUp` would cut this prescription down to MAX_BAR_KG, so the screen
 *  can say the bar is capped instead of showing 250 as if it were the real figure. */
export function barIsCapped(value: number | null | undefined): boolean {
  return value != null && value > MAX_BAR_KG
}

/** The bar a style percentage prescribes, rounded up so following it never drags the 1RM down;
 *  `null` with no strength basis yet. */
export function prescribedBar(
  basis: number | null | undefined,
  pct: number,
  equipment?: string[] | null,
): number | null {
  return basis ? mroundStepUp((basis * pct) / 100, weightStepFor(equipment)) : null
}

export interface InitialWeightInputs {
  exerciseType?: string | null
  equipment?: string[] | null
  target80?: number | null
  estimated1rm?: number | null
  latestWeight?: number | null
}

/** The weight a set opens on: the prescribed bar, else the saved target, else 80% of the 1RM,
 *  else the last load, else 60 kg. Bodyweight opens on 0 (no added load). */
export function initialSetWeight(ex: InitialWeightInputs | undefined, bar: number | null): number {
  if (ex?.exerciseType === 'bodyweight') return 0
  if (bar != null) return bar
  const step = weightStepFor(ex?.equipment)
  // #2762: up, like the card's "Target weight" and every other prescription, so the field opens
  // on the bar the lifter is shown.
  if (ex?.target80 != null) return mroundStepUp(ex.target80, step)
  // Fallback for old logs that predate the target_80 column: derive from 1RM or last weight
  if (ex?.estimated1rm) return mroundStepUp(ex.estimated1rm * 0.8, step)
  if (ex?.latestWeight != null) return mroundStep(ex.latestWeight, step)
  return 60
}
