/**
 * Which logged activities' steps add to the day's step count — the one rule, for the server route
 * and the client fast path that mirrors it.
 *
 * **Only activity the ring and the phone cannot see.** A treadmill walk happens indoors on a belt,
 * and its stored step count is the only record of it, so it is folded into the day. An outdoor walk
 * or run is already inside the ring's (or the phone pedometer's) total for the day.
 *
 * #3090: the fold used to add every row's `steps`, on the premise that only treadmill sessions
 * carried any. Q-230 made GPS walks and runs save strap-cadence steps too, so each one was counted
 * twice in the step count, the step goal and everything reading them. It also contradicted
 * `pedometerStepsInside` in `daily-energy.ts` (#3082), which treats an outdoor walk's stored steps
 * as already inside the pedometer total.
 *
 * **An explicit indoor list, not "everything except walk/run/hike".** A type added later earns
 * nothing here until someone decides the ring cannot see it; the other way round, every new
 * foot-based type would be double-counted by default.
 *
 * Imports nothing, like `energy-baseline.ts`: `app/session-select` is a client component and reads
 * this directly.
 */
export const INDOOR_STEP_ACTIVITY_TYPES: readonly string[] = ['treadmill']

/**
 * Outdoor foot activity: its steps are already inside the ring's (or phone pedometer's) day total.
 * `daily-energy.ts` takes them back out of the passive step term (`pedometerStepsInside`, #3082),
 * and `activityStepsForDayCount` never adds them. Kept beside the indoor list so the two cannot
 * drift into claiming the same type; a test holds them disjoint.
 */
export const PEDOMETER_ACTIVITY_TYPES: readonly string[] = ['walk', 'run', 'hike']

/** Steps from logged activities that the day's step count must add on top of the device total. */
export function activityStepsForDayCount(
  activities: readonly { activityType: string; steps?: number | null }[],
): number {
  return activities.reduce(
    (sum, a) => INDOOR_STEP_ACTIVITY_TYPES.includes(a.activityType.toLowerCase()) && a.steps != null && a.steps > 0
      ? sum + a.steps
      : sum,
    0,
  )
}
