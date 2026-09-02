/**
 * How much of a saved meal is being logged (BF-104) — the values, separate from the control.
 *
 * In its own `.ts` because both vitest projects run `environment: 'node'` and cannot parse a `.tsx`,
 * so anything asserted directly rather than by source-scan has to live outside the component. The
 * split is the better shape regardless: these three numbers are a product decision and the picker is
 * a rendering of them.
 */

/** The owner named these three. Not a range, and deliberately not configurable. */
export const MEAL_SCALES = [
  { value: '0.5', label: '½×' },
  { value: '1', label: '1×' },
  { value: '1.5', label: '1½×' },
] as const

export type MealScale = (typeof MEAL_SCALES)[number]['value']

export function scaleToNumber(scale: MealScale): number {
  return Number(scale)
}
