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

/** Tests only — the stack outlives any one component by design. */
export function resetSheetBackStack(): void {
  stack.length = 0
  pendingSelfPops = 0
}
