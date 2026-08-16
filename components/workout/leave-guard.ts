/**
 * Whether leaving the current exercise would discard work the user has done.
 *
 * Extracted from `active-workout-screen.tsx` so the rule is testable. It is the whole safety
 * property behind the "Leave this exercise?" dialog, and it was living inline in a ~1,000-line
 * component with no component-test setup in this repo (vitest runs `environment: 'node'` and there
 * are no `.tsx` tests) — so it could not be exercised at all.
 *
 * Deliberately NOT "always confirm". A dialog on a fresh exercise with nothing logged is friction
 * on a button pressed repeatedly mid-workout, and a prompt people learn to dismiss by reflex stops
 * guarding the case that matters.
 */
export function wouldDiscardWork(args: {
  /** The set timer has been started for this exercise. */
  timerStarted: boolean
  workoutPhase: 'rest' | 'set'
  /** Laps recorded for the current set. */
  lapCount: number
}): boolean {
  const { timerStarted, workoutPhase, lapCount } = args
  // Rest with no laps is the one "started but nothing to lose" state: the set that produced it has
  // already been logged, so leaving now discards nothing.
  return timerStarted && (workoutPhase === 'set' || lapCount > 0)
}
