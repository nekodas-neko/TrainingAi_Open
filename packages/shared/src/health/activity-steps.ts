/**
 * Which logged activities' steps add to the day's step count — the one rule, for the server route
 * and the client fast path that mirrors it.
 *
 * **Only activity treated as unseen by the ring and the phone.** A treadmill walk is on that list:
 * its stored step count is added to the day. Whether the ring already counts some of those steps
 * is unknown, pending the owner's call (#3112). An outdoor walk or run is already inside the
 * ring's (or the phone pedometer's) total for the day.
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

/**
 * The day's step count: the device's own total plus the indoor activity steps (treated as unseen
 * by the device; see #3112).
 * Every surface that shows a day's steps builds it here (#3095), so Home, the cardio week, the day
 * screen and the goals cards cannot disagree on a treadmill day. Null only when there is neither a
 * device count nor any indoor steps — "no reading", which a surface must not print as zero.
 *
 * **Whether the ring already counts treadmill steps is unknown.** #3095 checked: on 4 of 12
 * treadmill days with both figures the ring missed the session outright (its whole-day total was
 * below the session's own steps), while on 5 of the other 8 the day ran high enough to fit the ring
 * counting most of it. Treadmill stays on the indoor list pending the owner's call (#3112).
 */
export function dayStepCount(
  deviceSteps: number | null | undefined,
  activities: readonly { activityType: string; steps?: number | null }[],
): number | null {
  const indoor = activityStepsForDayCount(activities)
  if (deviceSteps == null && indoor === 0) return null
  return (deviceSteps ?? 0) + indoor
}

/** The step fields a body-metric row carries, on the server's rows and both apps' copies of them. */
interface StepFields { steps?: number | null; deviceSteps?: number | null }

/**
 * `row` with that day's indoor activity steps folded into `steps`, and the device's own count kept
 * in `deviceSteps`. A day with no indoor steps comes back unchanged and without `deviceSteps`, so
 * an absent `deviceSteps` always means `steps` already is the device's count (#3095).
 *
 * `activities` must be the row's own day; the caller filters.
 */
export function withIndoorSteps<T extends StepFields>(
  row: T,
  activities: readonly { activityType: string; steps?: number | null }[],
): T {
  if (activityStepsForDayCount(activities) === 0) return row
  return { ...row, steps: dayStepCount(row.steps, activities), deviceSteps: row.steps ?? null }
}

/**
 * The reading a body-metric log sheet's input starts from: today's stored value for the field, and
 * for steps the device's own count. Seeding the treadmill-inclusive figure and saving it unchanged
 * would write the session's steps into body_metrics, and the next read would add them again
 * (#3095). Shared by the web log sheets and Preview's, which had each grown their own seed.
 */
export function logSeedReading(
  field: string,
  today: (StepFields & Record<string, unknown>) | null | undefined,
): unknown {
  if (!today) return null
  if (field === 'steps' && today.deviceSteps !== undefined) return today.deviceSteps
  return today[field] ?? null
}

/**
 * Today's row after the user logs a device step count, keeping the indoor steps already folded into
 * it — so the tile does not drop the treadmill session the moment a value is saved (#3095).
 */
export function withLoggedDeviceSteps<T extends StepFields>(row: T, steps: number | null): T {
  if (row.deviceSteps === undefined) return { ...row, steps }
  const indoor = Math.max(0, (row.steps ?? 0) - (row.deviceSteps ?? 0))
  return { ...row, steps: steps == null && indoor === 0 ? null : (steps ?? 0) + indoor, deviceSteps: steps }
}

/**
 * Each day's step count for a reader holding many days of device rows (a week, a month, a chat
 * tool's range): `dayStepCount` per date, so a treadmill-only day counts too. Keyed by date; a day
 * with neither a device count nor indoor steps is absent.
 */
export function dayStepCountsByDate(
  rows: readonly { date: string; steps?: number | null }[],
  activities: readonly { date: string; activityType: string; steps?: number | null }[],
): Map<string, number> {
  const device = new Map(rows.map(r => [r.date, r.steps]))
  const byDate = new Map<string, { activityType: string; steps?: number | null }[]>()
  for (const a of activities) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a])
  const out = new Map<string, number>()
  for (const date of new Set([...device.keys(), ...byDate.keys()])) {
    const steps = dayStepCount(device.get(date), byDate.get(date) ?? [])
    if (steps != null) out.set(date, steps)
  }
  return out
}
