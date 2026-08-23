/**
 * Fire one background prescription regeneration per (user, session, local day).
 *
 * `/api/workout-data` is fetched with `cachedFetch`, which paints from cache and **then always
 * revalidates**, so every open of the workout screen issues a real GET. Until the first background
 * generation lands, `needsRegenerate` / `aiPrescriptionPending` are still true, so the next GET
 * starts a second generation for the same session-day. Measured on the AI-usage screen as 14
 * redundant calls across 8 distinct prescriptions (Q-470).
 *
 * **The rate limit is not, and cannot be, the guard.** It is a counter over a window, so it cannot
 * tell "already running" from "ran a minute ago" — Q-535's redecode job makes the same point about
 * its own 4/min limit. It stays: it exists to stop an unattended poll loop minting unlimited Gemini
 * calls, and it still does that.
 *
 * **The marker is process-local on purpose.** The DB-backed alternative (Q-535 uses a partial
 * unique index) survives replicas, and needs a staleness reaper for exactly that reason: a process
 * that dies mid-run holds the slot forever. A `Set` in this module dies with the process, so it
 * self-heals by construction. The window it leaves open needs two replicas serving one user seconds
 * apart, and the rate limit still caps the blast radius. Move it to the DB if replicas are ever
 * confirmed to run.
 */

const inFlight = new Set<string>()

export interface RegenerateInBackgroundDeps {
  /** Today in the user's timezone — the same key half the call's own fingerprint uses. */
  today: string
  /** Returns false when the budget is spent. Checked AFTER the in-flight guard, so a deduped
   *  call does not consume it — two screen opens used to burn two of the twenty. */
  allow: () => boolean
  run: () => Promise<unknown>
  onError: (err: unknown) => void
}

/** @returns whether a generation was started. */
export function regeneratePrescriptionInBackground(
  userId: string,
  programSessionId: string,
  deps: RegenerateInBackgroundDeps,
): boolean {
  const key = `${userId}:${programSessionId}:${deps.today}`
  if (inFlight.has(key)) return false
  if (!deps.allow()) return false
  inFlight.add(key)
  void deps
    .run()
    .catch(deps.onError)
    .finally(() => inFlight.delete(key))
  return true
}

/** Test-only: forget every marker, so one test's leak cannot fail the next. */
export function __clearPrescriptionInFlight(): void {
  inFlight.clear()
}
