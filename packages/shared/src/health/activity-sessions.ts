/**
 * #3875: an activity session a data source detected or recorded (a walk, a ride, a swim), in the
 * generic shape of `docs/data-source-connector-guide.md` §3d. Readers (the energy budget, the
 * heart-rate recovery profile) read this, never a source's own table or field names, so a second
 * source fills them the same way. Each connector maps its own rows into it beside its own code
 * (Oura: `lib/oura/cloud/activity-sessions-map.ts`), and `repo.getSourceActivitySessions` reads
 * every connector's.
 *
 * Pure types; importing no node module.
 */
export interface SourceActivitySession {
  /** The day the source files the session under (`YYYY-MM-DD`). It can differ from the user's local
   *  day of `start`, so a reader keying by local day widens its read and re-keys. */
  day: string
  /** The app's own activity type where the source's vocabulary has one, else the source's own name. */
  activityType: string
  /** Set only when the source's name maps to no app type: that name, which the energy budget costs
   *  at its own MET (`daily-energy.ts`). */
  unmappedActivity?: string
  start: Date
  end: Date
  /** Kilometres, or null when the source sent none or zero. */
  distanceKm: number | null
  /** The user said this was not an activity to count (Oura: a workout reviewed on the old review card
   *  without being logged). Still a real session for heart-rate readers. */
  dismissed: boolean
  /** The connector's `HealthSource`. */
  source: string
}
