'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Return a scroll container to where the user left it when they come back to a route (BF-100).
 *
 * Owner: *"when I scroll down to a button; then click on it and it takes me to a new page; when I
 * press back I want to go back to that page at the same scroll level I was at. It usually starts me
 * at the top of the page. This is on many pages if not all pages."*
 *
 * **"If not all pages" is right, and there is one reason.** The app does not scroll the document —
 * it scrolls an inner container. Next's App Router scroll restoration operates on the
 * window/document scroller, so it cannot see, save or restore a nested element's `scrollTop`, and
 * nothing in the app did it either. Measured before building: on `/health` the container reads 600
 * after scrolling, the document reads 0 throughout, and a push-and-back returns 0.
 *
 * **Save on unmount, restore on mount, clear on restore — and no navigation-direction check.**
 * The obvious design gates the restore on a `popstate` flag so a forward arrival starts at the top.
 * That was built first and measured wrong: React StrictMode double-invokes effects in dev, the first
 * pass consumes the flag, and the second — the one that survives — always sees `false`. Consuming
 * module state inside an effect is not safe here.
 *
 * Clearing the entry as it is restored gets the same outcome without the flag. A genuinely fresh
 * arrival has nothing saved, so it starts at the top by construction. The one case the two designs
 * differ on is returning to a tab you left scrolled: this restores it, which is what the persistent
 * tab shell already does for a tab switch, so it is the consistent answer rather than an exception.
 */

/** Per-tab, dies with the app, and a stale offset is worthless anyway. */
const KEY_PREFIX = 'ta_scroll:'

/**
 * How long to keep watching for the container to grow tall enough to hold the saved offset.
 *
 * **Generous on purpose, and not because anything measured 3 s failing.** It was raised from 3 s on
 * a hypothesis that turned out to be wrong — a red e2e run was blamed on a cold server outrunning
 * the window, and the actual cause was the spec tapping a card that opens a sheet instead of a link,
 * so nothing ever unmounted. The wider value is kept on its own merits rather than that story: a
 * cold route genuinely can still be compiling seconds in, and the timer is not what protects the
 * user from a late jump — the takeover listener is. Any wheel, touch or key cancels the restore
 * immediately, so all this bounds is how long an untouched screen will still settle into place.
 */
const RESTORE_WINDOW_MS = 15_000

/** Below this, restoring is indistinguishable from not bothering, and the entry is noise. */
const MIN_OFFSET_PX = 40

/**
 * Read the saved offset **without consuming it**.
 *
 * Consuming on read was the first design and StrictMode ate it, in a shape worth spelling out
 * because it is not the obvious one. React runs effect → cleanup → effect in dev. Pass one took the
 * value, found the container still too short to hold it, and waited. Pass one's *cleanup* then wrote
 * the current offset — 0, since nothing had been restored yet — over the pending target. Pass two,
 * the one that survives, read 0, discarded it as below the floor, and never restored anything. The
 * trace that caught it, from a cold-server harness run:
 *
 *     [SR] mount /more target 1051 gap 766   <- pass 1 takes 1051, waits for the content to grow
 *     [SR] save  /more 0                     <- pass 1's cleanup overwrites it
 *     [SR] mount /more target null gap 766   <- pass 2 finds nothing
 *
 * So the entry is cleared when the restore actually lands, and a cleanup with nothing to save leaves
 * a pending target alone.
 */
function peek(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + key)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= MIN_OFFSET_PX ? n : null
  } catch { return null }
}

function clear(key: string) {
  try { sessionStorage.removeItem(KEY_PREFIX + key) } catch { /* private mode */ }
}

export function useScrollRestoration(ref: RefObject<HTMLElement | null>, keySuffix?: string) {
  const pathname = usePathname()
  const key = keySuffix ? `${pathname}#${keySuffix}` : pathname
  /** Last observed offset. See the cleanup for why this is not read off the element there. */
  const lastTop = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const target = peek(key)
    let done = target == null
    let observer: ResizeObserver | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    if (target != null) {
      // **Restore only once the content is tall enough, or it silently no-ops.** These screens paint
      // from a cache seed and then revalidate, so setting `scrollTop` on a still-short container
      // makes the browser clamp it to 0 — which looks exactly like the bug this fixes. And only
      // once: a later revalidation must not yank the user back down.
      // **Re-asserted for the whole window, not set once.** Setting it once and stopping was measured
      // landing 144–231 px PAST the saved offset: the restore lands correctly and then content
      // keeps arriving above it, and the browser's scroll anchoring pushes the offset down to keep
      // the anchored element still. Which is the right instinct in general and wrong here — we are
      // trying to hold a position the anchoring does not know about.
      const land = (to: number) => {
        el.scrollTop = to
        lastTop.current = to
        clear(key)
      }
      const attempt = () => {
        if (done) return
        if (el.scrollHeight - el.clientHeight < target) return
        land(target)
      }
      attempt()
      observer = new ResizeObserver(attempt)
      observer.observe(el)
      for (const child of Array.from(el.children)) observer.observe(child)
      // Give up rather than hold forever: past this the user has moved on, and a jump would be
      // worse than starting at the top.
      timer = setTimeout(() => {
        // **Land as close as the page allows rather than giving up.** A screen can legitimately come
        // back shorter than it was — a card that has not re-fetched, a list that renders fewer rows
        // — and abandoning the restore then drops the user at the top, which is the bug. Measured:
        // `target 1051` against a container whose scrollable range was 766.
        if (!done) {
          const gap = el.scrollHeight - el.clientHeight
          if (gap >= MIN_OFFSET_PX) land(Math.min(target, gap))
          else clear(key)
        }
        done = true
        observer?.disconnect()
      }, RESTORE_WINDOW_MS)
    }

    // **The offset is tracked while scrolling, not read on unmount.** Reading `el.scrollTop` in the
    // cleanup was the first design and it silently saved 0 every time: React has already detached
    // the node by then, and a detached element reports 0. The failure is invisible — the code runs,
    // the write happens, the value is just wrong — which is why this was caught by measuring the
    // saved key rather than by reading the diff.
    //
    // A passive listener writing to a ref costs no render and no layout read beyond the one the
    // browser has already done for the scroll it is reporting.
    const onScroll = () => { lastTop.current = el.scrollTop }
    el.addEventListener('scroll', onScroll, { passive: true })

    // **User takeover is an INPUT event, not a scroll delta.** Comparing the offset against what we
    // last set was the first attempt and it made the re-assert useless: the layout shift this holds
    // against arrives as a scroll of exactly the size a real drag produces, so every settle read as
    // the user grabbing the page and we yielded to it. A wheel, a finger or a key is the user; a
    // scroll event is not evidence of anything.
    const stop = () => {
      if (done) return
      done = true
      observer?.disconnect()
      if (timer) clearTimeout(timer)
    }
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
      el.addEventListener(type, stop, { passive: true })
    }

    return () => {
      el.removeEventListener('scroll', onScroll)
      for (const type of ['wheel', 'touchstart', 'keydown'] as const) el.removeEventListener(type, stop)
      observer?.disconnect()
      if (timer) clearTimeout(timer)
      const top = Math.round(lastTop.current)
      if (top >= MIN_OFFSET_PX) {
        try { sessionStorage.setItem(KEY_PREFIX + key, String(top)) } catch { /* private mode */ }
      } else if (target == null) {
        // Nothing to save AND nothing pending: the screen was never scrolled, so drop any stale
        // entry. When a restore IS pending and has not landed, leave it — writing 0 over it is
        // exactly what StrictMode's first cleanup did, and it is why nothing ever restored.
        clear(key)
      }
    }
  }, [ref, key])
}

export const __scrollRestorationInternals = { KEY_PREFIX, RESTORE_WINDOW_MS, MIN_OFFSET_PX }
