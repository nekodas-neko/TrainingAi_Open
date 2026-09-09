/**
 * Which nights count as the baseline a night is compared against (BF-83).
 *
 * **A provisional night must not be in it.** The owner opened the same night four minutes apart and
 * every number moved — including the "vs your recent nights" scale it was being compared against, so
 * the *context* shifted under the reading as well as the reading. A night still filling is the one
 * night whose numbers are known to be wrong, and it is the newest, so it drags the comparison it is
 * being measured by.
 *
 * The night being VIEWED is never filtered here — it is the reading, not the baseline, and a
 * provisional night still shows its own numbers under its own badge.
 */

export interface NightWithProvisional {
  provisional?: boolean
}

/** The nights a distribution may be built from: everything that is not still filling. */
export function settledNights<T extends NightWithProvisional>(nights: T[]): T[] {
  return nights.filter(n => n.provisional !== true)
}
