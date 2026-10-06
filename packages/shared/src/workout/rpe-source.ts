/**
 * #2450 (step 1 of #2253): where a set's RPE came from.
 *
 * The picker opens on the expected effort, and the owner's rule (2026-10-06, on #2253) is that an
 * untouched value means "went as predicted". So a stored RPE is one of two different things:
 *   - `rated`    — the lifter set it on the picker (a real rating, even if it equals the pre-fill)
 *   - `expected` — the picker's pre-fill, never touched
 * Stored as `set_logs.rpe_source`. NULL on a set with no RPE and on every row logged before the
 * column existed — those are unknown, never assumed to be either.
 */
export const RPE_SOURCES = ['expected', 'rated'] as const
export type RpeSource = (typeof RPE_SOURCES)[number]

/** A stored value read back from SQLite or a sync row; anything else is unknown (`null`). */
export function asRpeSource(v: unknown): RpeSource | null {
  return v === 'expected' || v === 'rated' ? v : null
}

/** `rpeSources` for the log payload, index-aligned with `rpeValues`: `rated` where the lifter set
 *  that set's value, `expected` where it is still the pre-fill, `null` where the set has no RPE.
 *  Omitted when no set has an RPE, so a log without RPEs stays bare. */
export function rpeSourcesPayload(
  rpeValues: readonly (number | null | undefined)[],
  rated: readonly (boolean | undefined)[],
): (RpeSource | null)[] | undefined {
  if (!rpeValues.some(v => v != null)) return undefined
  return rpeValues.map((v, i) => (v == null ? null : rated[i] ? 'rated' : 'expected'))
}
