// Push/adherence session split (spec D-3) and environment inference (spec D-5) — both fully
// derived, never stored, per the "derive, or reconcile on read" rule (this project's stored
// counters have drifted every time one was persisted instead).

const PUSH_INTERVAL = 5

/** Whether the session at this 0-indexed position (count of PRIOR completed sessions in the plan)
 *  should be a push/benchmark session — spec D-3's "~1 in 4-5". Every 5th session, starting with
 *  the 5th (index 4). */
export function isPushSession(completedSessionsSoFar: number): boolean {
  return (completedSessionsSoFar + 1) % PUSH_INTERVAL === 0
}

export type RunEnvironment = 'indoor' | 'outdoor'

/** A session is outdoor if it has a real GPS route; treadmill/indoor sessions never record one.
 *  Environment-tagging (D-5) exists so a treadmill result never corrupts an outdoor pace anchor. */
export function inferEnvironment(routePolyline: string | null): RunEnvironment {
  return routePolyline ? 'outdoor' : 'indoor'
}
