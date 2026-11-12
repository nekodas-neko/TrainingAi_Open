/**
 * A sleep night as the device's local store holds it (the `sleep_sessions` table on the phone).
 *
 * Lived in `lib/local-store/types.ts` until #3729. The server's sleep merge reads it too
 * (`lib/sleep/merge-sessions.ts` turns local rows into the API's nights), and the server must not
 * import the local store, so the shape lives here and the local store re-exports it.
 */
export interface LocalSleepSession {
  id:              string;
  date:            string;
  durationHours:   number | null;
  deepSleepHours:  number | null;
  remSleepHours:   number | null;
  lightSleepHours: number | null;
  /** #2414 (v50): the session's own window and awake time, as the server stores them. Null on
   *  every row pulled before v50 until the server re-sends it — and a reader must treat a null
   *  window as "cannot place this row", never as a zero-length night. `awakHours` keeps the
   *  server's spelling (`sleep_sessions.awake_hours` → Drizzle `awakHours`) so the row reads as
   *  the API's `SleepRow` without renaming. */
  sleepStart:      string | null;
  sleepEnd:        string | null;
  awakHours:       number | null;
  // Oura columns (v18, added via RECONCILE) — carried through pull/restore so a
  // wiped device gets HRV/stages back, not sleep stripped to stage hours (review R6).
  ouraId:          string | null;
  efficiency:      number | null;
  onsetLatencySec: number | null;
  averageHrvMs:    number | null;
  avgHeartRate:    number | null;
  lowestHeartRate: number | null;
  restlessPeriods: number | null;
  sleepScore:      number | null;
  respiratoryRate: number | null;
  sleepPhase5Min:  string | null;
  timeInBedHours:  number | null;
  /** Q-519 — the bedtime the user remembers for a night the ring did not observe. Read only by the
   *  bedtime estimate; never by anything deriving a window, duration or efficiency. */
  manualSleepStart: string | null;
  /** #2338 (v51) — a night the user entered by hand, not one a device measured. `getSleepSessions`
   *  never returns one that a device night covers (`preferDeviceNights`). */
  manualEntry:     boolean;
  /** Issue 2606 (v52) — set on a manual night the user removed. Carried by the pull (the tombstone
   *  channel); `getSleepSessions` never returns a removed row, so a reader always sees null/absent. */
  deletedAt?:      string | null;
  /** #3060 (v53) — Oura's period type, from the server's Cloud period table. Null for any other
   *  source; `localSleepRowsAsNights` feeds it to the same nap rule the server's card applies. */
  ouraSleepType?:  string | null;
  /** #3582 (v54) — when sleep really began and ended on an Oura Cloud night, and its awake runs
   *  between the two, computed by the server from the 30-second hypnogram and carried by the pull.
   *  Null/absent on a ring, manual or Health Connect night, on a night without a usable hypnogram,
   *  and on any row pulled before v54. `sleepStart`/`sleepEnd` stay the bed window. */
  onsetAt?:        string | null;
  finalWakeAt?:    string | null;
  computedAwakenings?: number | null;
  /** #3600 (v55) — the generic recording fields the server derives on read and the pull carries: minutes
   *  moving and measured inside the sleep window, the source's own incomplete-recording flag, and the
   *  label of the source's algorithm. Null/absent for a source that sent none and on any row pulled before v55. */
  restlessMin?:    number | null;
  movementMeasuredMin?: number | null;
  recordingIncomplete?: boolean | null;
  sourceAlgorithmVersion?: string | null;
  syncStatus:      'pending' | 'synced';
  updatedAt:       string;
}
