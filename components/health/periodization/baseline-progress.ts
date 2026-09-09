/**
 * How much of a session's baseline is done (LA-92).
 *
 * The card read *"Baseline needed"* identically after zero baseline sessions and after four of five
 * exercises, which is what made BF-131 unreportable — the owner could only say *"even though the
 * session was done it's saying baseline needed"*, because the screen genuinely had no other words.
 *
 * **The anchors are keyed by session-exercise id, and that decides the numerator as well as the
 * denominator.** `Object.keys(baseline1rm).length` alone counts anchors for exercises that may no
 * longer be in the session — edit the program and the count can exceed the exercise list, so
 * "6 of 5" is reachable from a plain key count. Intersecting against the session's current
 * exercise ids is what makes the pair consistent.
 */

export interface BaselineProgress {
  /** Exercises in the session that have a measured anchor. */
  logged: number
  /** Exercises in the session. */
  total: number
}

/**
 * Null when the exercise list is unknown — the card has to keep its old wording then rather than
 * invent a denominator, and an empty session is not progress to report either.
 */
export function baselineProgress(
  baseline1rm: Record<string, unknown> | null | undefined,
  exerciseIds: string[] | null | undefined,
): BaselineProgress | null {
  if (!exerciseIds || exerciseIds.length === 0) return null
  const anchored = new Set(Object.keys(baseline1rm ?? {}))
  const logged = exerciseIds.reduce((n, id) => n + (anchored.has(id) ? 1 : 0), 0)
  return { logged, total: exerciseIds.length }
}

/** `3 of 5 exercises logged`. Singular where it matters, because "1 exercises" reads as a bug. */
export function baselineProgressLabel(p: BaselineProgress): string {
  return `${p.logged} of ${p.total} exercise${p.total === 1 ? '' : 's'} logged`
}
