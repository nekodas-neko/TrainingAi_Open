/**
 * DV-6 — decides when the status-bar scrim is showing. Split out of the component deliberately:
 * this repo's vitest projects are all `environment: 'node'` and cannot transform `.tsx`, so logic
 * left inside the component is logic nothing can drive. Everything that could silently be wrong
 * lives here; the component is the div.
 */

/** Ignore the first few px so a rubber-band bounce at rest does not flash the scrim. */
export const SCRIM_THRESHOLD = 4

/**
 * The shell marks every panel, on show or not. A scroller drives the scrim unless it belongs to a
 * panel that is NOT on show — stated as the negative on purpose (DV-22): a pushed route has no
 * panel ancestor at all, and the positive form excluded it along with the hidden panels.
 */
const HIDDEN_PANEL = '[data-tab-active="false"]'

/**
 * The element whose offset a scroll event is about.
 *
 * A tab panel scrolls an inner container, so the target is that Element. **A pushed route scrolls
 * the document** — measured at 412 px on `/health/sleep`, which has no inner scroller and no panel
 * — and a document scroll's target is the `Document`, not an Element, so the old early return
 * discarded it and the scrim could never fire there even once it was mounted.
 */
function scrollerFor(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target
  if (target instanceof Document) return target.scrollingElement
  return null
}

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

  // `document.scrollingElement` is never inside a panel, so a pushed route's document scroll
  // qualifies by the same rule rather than by a second branch.
  const drivesScrim = (el: Element) => el.closest(HIDDEN_PANEL) === null

  return {
    onScroll(e) {
      const el = scrollerFor(e.target)
      if (!el) return
      scrollers.add(el)
      if (drivesScrim(el)) set(el.scrollTop > SCRIM_THRESHOLD)
    },
    reevaluate() {
      for (const el of scrollers) {
        // `isConnected` drops scrollers whose screen has been torn down, so the set cannot pin
        // detached nodes for the life of the shell.
        if (!el.isConnected) { scrollers.delete(el); continue }
        if (drivesScrim(el) && el.scrollTop > SCRIM_THRESHOLD) { set(true); return }
      }
      set(false)
    },
  }
}
