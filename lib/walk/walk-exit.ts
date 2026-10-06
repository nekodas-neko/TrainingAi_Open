/**
 * How the Android back gesture reaches the guided walk's one Exit prompt (#2134).
 *
 * The prompt belongs to `WalkActive`, which holds the HR samples and the cadence tracker a save
 * needs. The `backButton` listener lives in `MobileAuthHandler`, outside that tree, so it asks here
 * instead of mounting a second copy of the dialog — two copies were how the button and the gesture
 * came to offer different choices.
 *
 * `requestWalkExit` answers whether anyone took the request. When the walk screen is not mounted
 * (the route's error boundary is showing, say) the listener must fall through to its ordinary back
 * rather than do nothing, which is why this is a registry and not a flag in the store: a flag would
 * be set and never read.
 */
let handler: (() => void) | null = null

export function registerWalkExit(open: () => void): () => void {
  handler = open
  return () => {
    if (handler === open) handler = null
  }
}

export function requestWalkExit(): boolean {
  if (!handler) return false
  handler()
  return true
}
