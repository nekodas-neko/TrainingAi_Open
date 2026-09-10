import { shiftDateStr } from '@trainingai/shared/date-utils'

/**
 * The bounds on a vial's reconstitution date (BF-136).
 *
 * **The date anchors every derived figure on the vial card**, and it is the one field a user cannot
 * see or correct once it is wrong — `WeightResponseCard` windows on `p.date >= openedOn`, so a date
 * a few days late silently drops most of the weigh-ins and the card reports *"not enough weigh-ins
 * yet"* to someone who has weighed daily for a fortnight. That is what happened: the field was
 * hardcoded to `todayInTz(tz)` and the sheet rendered no control for it.
 *
 * So it is bounded rather than free. A mistyped year does not error — it moves the window — and the
 * failure is a true-sounding message rather than a rejection, which is exactly the shape that gets
 * reported as a different bug.
 */

/**
 * Six months. A vial lasts weeks, so this is generous for any real reconstitution and still rejects
 * the realistic typo: last year's date lands 365 days back and a transposed year further still.
 */
export const MAX_OPENED_DAYS_BACK = 180

/** `min`/`max` for the date input — both `YYYY-MM-DD`, both inclusive. */
export function openedOnBounds(today: string): { min: string; max: string } {
  return { min: shiftDateStr(today, -MAX_OPENED_DAYS_BACK), max: today }
}

/**
 * Compared as strings, deliberately: `YYYY-MM-DD` sorts lexicographically in date order, so this
 * needs no `Date` at all — and a `new Date('2026-09-10')` here would parse as UTC midnight and shift
 * the day west of UTC, which is the trap `formatDateDisplay` carries a comment about.
 */
export function isOpenedOnValid(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const { min, max } = openedOnBounds(today)
  return value >= min && value <= max
}

/** Why a date was rejected, for the line under the field. Null when it is fine. */
export function openedOnProblem(value: string, today: string): string | null {
  if (isOpenedOnValid(value, today)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Pick the day you mixed this vial.'
  return value > today
    ? 'A vial cannot be opened in the future.'
    : `That is more than ${MAX_OPENED_DAYS_BACK} days ago — check the year.`
}
