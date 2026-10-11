'use client'

import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import type { WalkCandidatesResponse } from '@/app/api/activity-detection/walks/route'

/**
 * #2471 (owner direction 2026-10-06): ask the server for today's walks in the ring's MET and offer
 * the new ones on the "detected" card — "Looks like you walked 9:10–9:32. Save it?".
 *
 * Called whenever a ring sync settles (`ta:oura-ble-synced`, which the app-open drain fires too, so
 * opening the app right after a walk shows it within about a minute) and once when detection
 * starts. The server owns the rule (`detectWalksFromMet`) and leaves out anything already logged;
 * the store leaves out anything already answered or already on the card. Best-effort: a failure
 * offers nothing and the next sync tries again.
 */
export async function offerRingWalks(): Promise<void> {
  try {
    // Not cachedFetch: an offer is acted on, never painted, so a cached copy would have no reader and
    // a stale one would re-offer a walk the user just saved.
    const res = await fetch('/api/activity-detection/walks', { cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as Partial<WalkCandidatesResponse>
    if (!Array.isArray(body.walks)) return
    useAutoDetectionStore.getState().offerRingWalks(body.walks)
  } catch {
    /* offline, or no ring data yet — the next sync asks again */
  }
}
