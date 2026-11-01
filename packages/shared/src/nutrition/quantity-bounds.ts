// The range a food log's (or saved-meal ingredient's) `quantityMultiplier` may take. The web routes,
// the sync push (`pushMutations`) and the saved-meal validator all refuse a value outside it, and the
// look-alike merge (`food-merge.ts`) must not write one, since a log stored out of range is dead-lettered
// by the push the next time a device edits it.
export const QUANTITY_MULTIPLIER_MIN = 0.01
export const QUANTITY_MULTIPLIER_MAX = 100

export const quantityMultiplierInRange = (q: unknown): q is number =>
  typeof q === 'number' && q >= QUANTITY_MULTIPLIER_MIN && q <= QUANTITY_MULTIPLIER_MAX
