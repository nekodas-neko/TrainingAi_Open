/**
 * The decision logic behind `useSheetBackDismiss`, extracted so the sequences
 * that keep breaking it can be driven directly.
 *
 * All three bugs this has carried — LB-10, LB-17, BF-34 — were in *when to
 * close*, not in the React wiring, and every one of them was found on a device
 * or in an e2e run because there was nothing smaller to aim at. The three
 * sequences below are now unit tests, which is the only way the SIBLING case
 * (BF-34) is checkable at all: it needs a sheet to close and a dialog to open
 * in the same tick with a `history.back()` already in flight, and neither the
 * web sandbox nor CI can stage that through the UI.
 *
 * `HistoryLike` is injected rather than reaching for `window` so the tests can
 * watch what was pushed. The hook passes the real `window.history`.
 */

export type Surface = { id: string; depth: number; close: () => void; pushed: boolean }

export interface HistoryLike {
  pushState(state: unknown, unused: string): void
  back(): void
}

/** Open surfaces, innermost last. Module-level because depth is a property of
 *  the STACK — a surface cannot know how many sit under it. */
const stack: Surface[] = []

/** How many of our own `back()` calls are in flight. **Module-level is the
 *  whole point (BF-34):** a sheet closing and a dialog opening in the same tick
 *  are different instances, so a per-instance flag is invisible to whichever
 *  one receives the pop, and a state that is not mine is indistinguishable from
 *  a real back gesture. */
let pendingSelfPops = 0

function pushEntry(surface: Surface, history: HistoryLike): void {
  history.pushState({ sheetId: surface.id, sheetDepth: surface.depth }, '')
  surface.pushed = true
}

export function openSurface(id: string, close: () => void, history: HistoryLike): Surface {
  const surface: Surface = { id, depth: stack.length + 1, close, pushed: false }
  stack.push(surface)
  // Skip the push while one of our own back()s is in flight: that pop is already
  // aimed at the entry below, and pushing now would put this entry in its path.
  // `handlePop` pushes for us once it has swallowed the pop.
  if (pendingSelfPops === 0) pushEntry(surface, history)
  return surface
}

export function closeSurface(surface: Surface, history: HistoryLike): void {
  const slot = stack.lastIndexOf(surface)
  if (slot !== -1) stack.splice(slot, 1)
  // Nothing to undo when a real back gesture already consumed the entry —
  // `handlePop` clears `pushed` before it closes anything.
  if (!surface.pushed) return
  surface.pushed = false
  pendingSelfPops++
  history.back()
}

/**
 * A navigation is taking over the top surface's history entry (BF-165, DV-2).
 *
 * **The bug this exists for, and why nothing smaller works.** A surface pushes an entry on open and
 * pops it on close, which is right in isolation. When the close is *caused by* a navigation, that pop
 * lands on the entry the navigation just created and undoes it: measured on the S25, `pushState(…)`
 * then `back()` **7 ms later**, screen unchanged. Three cheaper fixes were built and each failed on
 * evidence rather than on reasoning:
 *
 * - **Waiting for the pop to drain** (`afterSelfPops`, using the `pendingSelfPops` counter above).
 *   `pendingSelfPops` is still **0** when the navigation is issued, so the parked callback runs
 *   inline and is eaten by a pop that has not happened yet.
 * - **Reordering the call site's three statements.** `router.push` runs inside
 *   `document.startViewTransition`, which suspends frame production and holds the React commit — so
 *   the navigation is itself what delays the surface's close past it. No order separates them.
 * - **Lengthening the navigation cap.** The push is fine; it is undone afterwards. That turns a dead
 *   tap into a slow dead tap.
 *
 * So the entry is released **synchronously, before the navigation**, and the pop then never happens
 * at all — there is no window for it to be mistimed in. It is tied to the surface OBJECT rather than
 * to a module flag, which is what BF-34 established the difference between: *"a state that is not
 * mine is indistinguishable from a real back gesture"*.
 *
 * **Returns whether that surface had an entry, and the caller must act on it.** Going forward, `true`
 * means the current history entry is the surface's, so the navigation has to `replace` it — a `push`
 * would leave a dead entry at the same URL as the page below, costing a back press that appears to do
 * nothing. Going back, `true` means one extra entry stands between here and the destination.
 */
export function releaseTopSurfaceEntry(): boolean {
  const top = stack[stack.length - 1]
  if (!top || !top.pushed) return false
  top.pushed = false
  return true
}

export function handlePop(state: unknown, history: HistoryLike): void {
  if (pendingSelfPops > 0) {
    pendingSelfPops--
    // Whichever surface is on top either skipped its push while this was in
    // flight or just had its entry consumed. Either way it is still open.
    const top = stack[stack.length - 1]
    if (top && !top.pushed) pushEntry(top, history)
    return
  }
  const depth = (state as { sheetDepth?: unknown } | null)?.sheetDepth
  // An entry with no depth is the page itself, which is depth 0 — so a lone
  // sheet still closes on back.
  const arrivedDepth = typeof depth === 'number' ? depth : 0
  // Topmost first, so closing one cannot disturb the indices still to consider.
  for (let i = stack.length - 1; i >= 0; i--) {
    const surface = stack[i]
    if (surface.depth > arrivedDepth) {
      surface.pushed = false
      surface.close()
    }
  }
}

/**
 * Is any sheet or dialog currently open? (BF-166.)
 *
 * **The Capacitor `backButton` listener needs this because a pushed entry is invisible to it.**
 * `openSurface` pushes with no URL, so `window.location.pathname` is unchanged — and
 * `backActionForPath` decides from the pathname alone. On a tab route it answers `"home"` and the
 * listener calls `navigateToTab` instead of popping; on `/` it answers `"minimize"`. Neither touches
 * history, so the surface's entry is never consumed and the page moves out from under an open sheet.
 * That is the owner's report: *"a nutrition meal creator menu open and you press the back button —
 * it makes the page behind it go back to main."*
 *
 * Only the `"pop"` branch happened to work, and only by coincidence: it calls `history.back()`,
 * which is what consumes the entry.
 */
export function hasOpenSurface(): boolean {
  return stack.length > 0
}

/** Tests only — the stack outlives any one component by design. */
export function resetSheetBackStack(): void {
  stack.length = 0
  pendingSelfPops = 0
}
