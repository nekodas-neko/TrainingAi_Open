/**
 * Quantity arithmetic for the saved-meal builder, in servings.
 *
 * A row can be shown in grams or in servings, but `qty` is always stored as a serving multiplier —
 * so both of these convert into that one unit rather than letting the display unit leak into the
 * stored value. Extracted from `saved-meals-sheet.tsx` when the file crossed its size limit; the
 * component keeps the `setIngredients` calls and these keep the maths, which is the half worth
 * testing.
 */

/** How a row's quantity is being *entered*. What gets stored is always a serving multiplier. */
export type QtyUnit = 'serving' | 'g'

/** Two decimals is enough to express any gram value against a sane serving size, and stops a long
 *  float reaching the database. 100 servings is the ceiling for one ingredient. */
const round2 = (n: number) => Math.round(n * 100) / 100
const MAX_QTY = 100

/**
 * The typed value converted to servings, or null when it cannot be: a non-positive/NaN input, or
 * grams asked for on a food with no serving size to divide by (which would be a division by zero).
 * Null means "leave the row alone", not "set it to zero".
 */
export function qtyFromInput(raw: string, unit: QtyUnit, servingSizeG: number | null | undefined): number | null {
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  const serving = servingSizeG ?? 0
  if (unit === 'g' && serving <= 0) return null
  return Math.min(MAX_QTY, round2(unit === 'g' ? n / serving : n))
}

/**
 * One ± press: half a serving, or 5 g — whichever unit the row is showing. Returns the new quantity,
 * or null when the step would take it to zero or below, which the caller reads as "remove the row".
 */
export function steppedQty(
  current: number,
  unit: QtyUnit,
  direction: 1 | -1,
  servingSizeG: number | null | undefined,
): number | null {
  const serving = servingSizeG ?? 0
  const delta = (unit === 'g' && serving > 0 ? 5 / serving : 0.5) * direction
  const next = Math.min(MAX_QTY, round2(current + delta))
  return next <= 0 ? null : next
}
