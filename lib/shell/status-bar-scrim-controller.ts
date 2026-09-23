/**
 * DV-6 — decides when the status-bar scrim is showing. Split out of the component deliberately:
 * this repo's vitest projects are all `environment: 'node'` and cannot transform `.tsx`, so logic
 * left inside the component is logic nothing can drive. Everything that could silently be wrong
 * lives here; the component is the div.
 */

/** Ignore the first few px so a rubber-band bounce at rest does not flash the scrim. */
export const SCRIM_THRESHOLD = 4

/** The shell marks the panel on show; only its offset may drive the scrim. */
const ACTIVE_PANEL = '[data-tab-active="true"]'

export interface ScrimController {
  /** Capture-phase scroll handler. Register with `addEventListener('scroll', h, true)`. */
  onScroll: (e: Event) => void
  /** Re-read after a tab change, when no scroll event will fire. */
  reevaluate: () => void
}

export function createScrimController(paint: (shown: boolean) => void): ScrimController {
  // Every element that has ever scrolled. Bounded by the number of scrollers in the app — a
  // handful — and it is what lets a flip back to a tab left scrolled down repaint with no event.
  const scrollers = new Set<Element>()
  let shown: boolean | null = null

  const set = (next: boolean) => {
    if (next === shown) return
    shown = next
    paint(next)
  }

  const inActivePanel = (el: Element) => el.closest(ACTIVE_PANEL) !== null

  return {
    onScroll(e) {
      const el = e.target
      // A document/window scroll is not a panel's, and this app scrolls inner containers anyway.
      if (!(el instanceof Element)) return
      scrollers.add(el)
      if (inActivePanel(el)) set(el.scrollTop > SCRIM_THRESHOLD)
    },
    reevaluate() {
      for (const el of scrollers) {
        // `isConnected` drops scrollers whose screen has been torn down, so the set cannot pin
        // detached nodes for the life of the shell.
        if (!el.isConnected) { scrollers.delete(el); continue }
        if (inActivePanel(el) && el.scrollTop > SCRIM_THRESHOLD) { set(true); return }
      }
      set(false)
    },
  }
}
