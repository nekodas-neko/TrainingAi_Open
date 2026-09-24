import type { RestrictionSelection } from './restrictions-picker'

/**
 * Set equality, not list equality: the picker rebuilds the array on every toggle, so order shifts
 * without the selection changing. Comparing as ordered lists would make almost every open look like
 * an edit and re-run the delete-and-reinsert this exists to avoid.
 *
 * Lives here rather than in the sheet so it can be tested directly — vitest's unit project does not
 * transform JSX, so nothing is importable out of a `.tsx`.
 */
export function sameRestrictions(a: RestrictionSelection[], b: RestrictionSelection[]): boolean {
  if (a.length !== b.length) return false
  const key = (r: RestrictionSelection) => `${r.restrictionId}:${r.severity}`
  const left = new Set(a.map(key))
  return b.every(r => left.has(key(r)))
}
