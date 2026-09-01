/**
 * BF-97 — the name a scanned diary group is headed with, normalised in one place.
 *
 * Three surfaces write it and they must agree: the web route, the offline push branch in
 * `pushMutations`, and `logFoodEntries` on the device. That is exactly the shape CLAUDE.md's
 * sibling-surface rule is about, and the value is model-authored text arriving from a photo scan,
 * so "the client already trimmed it" is not a guarantee any of the three may lean on.
 */

/** Long enough for a real dish description, short enough that a diary header cannot be a paragraph. */
export const MEAL_GROUP_NAME_MAX_CHARS = 120

/**
 * The stored form of a group name, or `null` when there is nothing to store.
 *
 * **It truncates rather than rejecting, deliberately.** An over-long name reaches the push branch
 * inside an outbox mutation, and a 4xx there is a poison pill the outbox quarantines — losing the
 * whole food log over a display string. Nothing about a long name makes the log wrong.
 */
export function normalizeMealGroupName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.length <= MEAL_GROUP_NAME_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, MEAL_GROUP_NAME_MAX_CHARS - 1).trimEnd()}…`
}
