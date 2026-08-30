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

/**
 * How much of one ingredient a collapsed builder row shows: **grams**, whichever unit its editor is
 * set to (BF-46 ②).
 *
 * A row used to read `8 servings · 1000 g` while the meal it belongs to is measured in *portions*,
 * so "serving" meant two different things one line apart. The owner settled it: *"just the weight
 * would be fine for the meals. Only portions are really needed when making serving sizes for the
 * meals."*
 *
 * Grams are already the stored truth — the quantity is a serving multiplier and this is a second
 * view of it — so this is display only and the editor still offers both units. **Servings survive
 * as the fallback for a food with no serving size**, which has no gram equivalent to show instead;
 * that is the one case where the word is the only thing available rather than a competing unit.
 *
 * It takes no unit, on purpose: a parameter it ignored would read as a switch that still works.
 */
export function ingredientAmountLabel(servingSizeG: number | null | undefined, qty: number): string {
  const serving = servingSizeG ?? 0
  if (serving > 0) return `${Math.round(serving * qty)} g`
  const servings = round2(qty)
  return `${servings} ${servings === 1 ? 'serving' : 'servings'}`
}
