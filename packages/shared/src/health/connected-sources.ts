/**
 * Which device sources a user has connected, as three booleans (issue 2613).
 *
 * The only client signal before this was `hasHrSource` (any heart rate recorded), so a ring user, a
 * strap-only user and a Health Connect-only user were indistinguishable and every empty state had to
 * use neutral wording. This is the summary that lets a later change name the right device.
 *
 * **No new detector.** Each flag is built from a fact the server already holds:
 *  - `ring`: the user's BLE raw samples exist at all, the same existence fact `/api/oura/stats` reports
 *    as `connected` (`repo.hasOuraBleSamples`). It is not windowed: a ring that has reported once is
 *    a ring the user owns, and the raw archive is never pruned.
 *  - `strap`: a heart-rate row with `source = 'chest_strap'` (the Polar H10 path, the same tag
 *    `mergeHrSources` ranks above the ring) in the last `CONNECTED_SOURCE_WINDOW_DAYS` days. Strap
 *    pairing itself lives on the phone only, so "strap: true" means *strap-sourced heart rate seen
 *    recently*, not "a strap is paired right now". A paired strap that has not been worn for the
 *    window reads false.
 *  - `healthConnect`: a Health Connect heart-rate row, or a Health Connect movement interval, received
 *    in the same window, i.e. the sync has delivered data recently.
 *
 * Booleans only, deliberately: a timestamp in a cached payload goes stale on the device.
 */

/** How recent strap and Health Connect data must be to count as connected. */
export const CONNECTED_SOURCE_WINDOW_DAYS = 30

export interface ConnectedSources {
  ring: boolean
  strap: boolean
  healthConnect: boolean
}

/** The raw facts `connectedSources` summarises. Each is a plain existence answer. */
export interface ConnectedSourceFacts {
  /** The user has BLE raw samples (any age). */
  ringSamples: boolean
  /** A `chest_strap` heart-rate row inside the window. */
  strapHeartRate: boolean
  /** A Health Connect heart-rate row inside the window. */
  healthConnectHeartRate: boolean
  /** A Health Connect movement interval inside the window. */
  healthConnectIntervals: boolean
}

export function connectedSources(facts: ConnectedSourceFacts): ConnectedSources {
  return {
    ring: facts.ringSamples,
    strap: facts.strapHeartRate,
    healthConnect: facts.healthConnectHeartRate || facts.healthConnectIntervals,
  }
}
