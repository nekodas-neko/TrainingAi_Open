'use client'

/**
 * #3806 — nothing that was in flight when the user signed out may undo the sign-out.
 *
 * The Auth.js middleware re-issues the session cookie on every response it answers with a session.
 * A request sent just before the sign-out carries the old cookie, so its response, landing after the
 * sign-out's clearing `Set-Cookie`, signed the browser back in (measured: three `trophy-pins` reads
 * re-set the cookie after `POST /more` cleared it). Its body could also write the outgoing account's
 * data into the stores the sign-out had just emptied.
 *
 * Installed once at the root, so every `fetch` on the page goes through it. While a sign-out runs:
 *
 * 1. `beginSignOut()` bumps the epoch, aborts every request this page started, and from then on
 *    refuses new ones before they are sent. An aborted request's response is never applied, cookies
 *    included, and its caller sees an `AbortError`, so it writes nothing.
 * 2. Exactly one request is let through: the sign-out server action (`allowSignOutRequest`), whose
 *    response clears the cookie. Its clear is therefore the last cookie write.
 * 3. `endSignOut()` stops refusing. Requests from then on carry no session cookie and cannot restore
 *    one. A response from before the epoch bump that still resolves is refused as well.
 *
 * Ordering, not a delay: nothing here waits on a timer.
 */

let epoch = 0
let fencing = false
let exemptAction = false
let installed = false
/** Controllers of requests this page started; aborting a finished one is a no-op. */
const live = new Set<AbortController>()
const MAX_TRACKED = 200

function abortError(): DOMException {
  return new DOMException('Signed out while the request was in flight', 'AbortError')
}

function isServerAction(input: RequestInfo | URL, init?: RequestInit): boolean {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  return headers.has('next-action')
}

function track(controller: AbortController) {
  live.add(controller)
  if (live.size > MAX_TRACKED) {
    const oldest = live.values().next().value
    if (oldest) live.delete(oldest)
  }
}

/** Wraps `fetch` so the fence above holds. Exported for tests; production calls `installSignOutFence`. */
export function fencedFetch(original: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (fencing) {
      if (!(exemptAction && isServerAction(input, init))) throw abortError()
      exemptAction = false
    }
    const started = epoch
    const controller = new AbortController()
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (callerSignal?.aborted) throw callerSignal.reason ?? abortError()
    callerSignal?.addEventListener('abort', () => controller.abort(callerSignal.reason), { once: true })
    track(controller)
    try {
      const res = await original(input, { ...init, signal: controller.signal })
      // The sign-out's own request bumps nothing, so it is never refused here.
      if (epoch !== started) throw abortError()
      return res
    } catch (error) {
      live.delete(controller)
      throw error
    }
  }
}

export function installSignOutFence(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  window.fetch = fencedFetch(window.fetch.bind(window))
}

/** Step 1: refuse and abort everything this page has in flight. */
export function beginSignOut(): void {
  installSignOutFence()
  epoch += 1
  fencing = true
  for (const controller of live) controller.abort(abortError())
  live.clear()
}

/** Step 2: let the next server action — the sign-out itself — through. Call right before it. */
export function allowSignOutRequest(): void {
  exemptAction = true
}

/** Step 3: the cookie is cleared (or the sign-out failed and the app carries on); stop refusing. */
export function endSignOut(): void {
  fencing = false
  exemptAction = false
}

export function __resetSignOutFenceForTests(): void {
  epoch = 0
  fencing = false
  exemptAction = false
  live.clear()
}
