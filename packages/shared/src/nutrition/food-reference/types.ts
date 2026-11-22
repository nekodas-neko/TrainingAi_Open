/** Where a bundled table came from, so every number in it can be traced to a release. */
export interface FoodReferenceDataset {
  name: string
  release: string
  url: string
  licence: string
}

/**
 * One food in a bundled table: its source id and description, the exact names it answers to, and
 * its values per 100 g. `names` are already case- and whitespace-folded (`text()` in
 * food-item-identity.ts), which is the only normalisation the resolver applies.
 */
export interface FoodReferenceRow {
  fdcId: number
  description: string
  names: readonly string[]
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}
