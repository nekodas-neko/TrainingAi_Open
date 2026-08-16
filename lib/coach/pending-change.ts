import type { CoachPatch } from './patch'

/**
 * How a tier-3 proposal reaches its confirmation screen.
 *
 * Tier 3 pushes a real route rather than confirming inline, so the Android back gesture works and
 * the consequence list gets a full screen. That leaves the question of how the patch gets there.
 * A URL cannot carry it (it is an object, and a patch in a query string is a patch anyone can
 * edit), and re-deriving it on the confirm screen would mean asking the model again — which could
 * legitimately return something different from what the user tapped.
 *
 * So it is stashed in `sessionStorage` under the tool call's own id and read once. Three
 * consequences worth stating:
 *
 *   - **A reload loses it.** That is correct rather than unfortunate: a proposal the user cannot
 *     see the origin of should be re-asked, and the confirm screen says so instead of applying
 *     something from a previous session.
 *   - It is per-tab, so two tabs cannot collide.
 *   - It is never the authority. `/api/coach/apply` re-validates the patch against current state
 *     and refuses a moved base, exactly as it does for an inline confirmation.
 */
const KEY_PREFIX = 'ta_coach_pending:'

export interface PendingChange {
  toolCallId: string
  title: string
  patch: CoachPatch
}

export function stashPendingChange(change: PendingChange): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + change.toolCallId, JSON.stringify(change))
  } catch {
    // Storage blocked — the confirm screen will report the proposal as expired, which is the same
    // honest outcome as a reload.
  }
}

export function readPendingChange(toolCallId: string): PendingChange | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + toolCallId)
    return raw ? (JSON.parse(raw) as PendingChange) : null
  } catch {
    return null
  }
}

export function clearPendingChange(toolCallId: string): void {
  try {
    sessionStorage.removeItem(KEY_PREFIX + toolCallId)
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}
