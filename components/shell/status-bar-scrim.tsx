'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createScrimController } from '@/lib/shell/status-bar-scrim-controller'

/**
 * DV-6 — a gradient behind the status bar, once, for the whole app.
 *
 * The owner was offered a solid strip and chose the fade, so the app stays edge-to-edge and nothing
 * loses the ~28 px a flat backing costs. It lives in the ROOT LAYOUT rather than on each screen
 * because a per-screen scrim is a rule every future screen can forget — which is how the defect
 * reached a device sweep in the first place. DV-6 mounted it in `tab-shell.tsx`, one layer too low:
 * a pushed route is not inside that shell, so `/health/sleep` scrolled under the clock with no
 * backing at all (DV-22). `app/layout.tsx` is the only parent every route shares — this app has
 * exactly one layout file.
 *
 * **Scroll does not bubble**, but it does reach a listener registered in the CAPTURE phase on an
 * ancestor, which is what lets one listener here cover every screen with no per-screen opt-in. The
 * two kinds of screen scroll differently and the controller handles both: a tab scrolls its own
 * inner container (three through `PullToSync`, Nutrition its own), a pushed route scrolls the
 * document itself.
 *
 * The decision logic is in `lib/shell/status-bar-scrim-controller.ts` so it can be tested — the
 * vitest projects here cannot transform `.tsx`. Opacity is written straight to the node rather
 * than held in state: this runs on every scroll frame on a Samsung WebView.
 */
export function StatusBarScrim() {
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    const controller = createScrimController(shown => {
      const el = ref.current
      if (el) el.style.opacity = shown ? '1' : '0'
    })
    controller.reevaluate()
    document.addEventListener('scroll', controller.onScroll, true)

    // Two things change what is on screen WITHOUT firing a scroll event, and each needs its own
    // signal now that there is no `activeKey` prop to key the effect on.
    //
    // A route change is `pathname`, above. A TAB change is not: the shell swaps panels with a raw
    // `history.replaceState`, which the App Router does not observe, so `usePathname` cannot be
    // relied on for it. The attribute the shell flips is the signal, and an `attributeFilter`
    // observer fires only for that attribute rather than on every render in the subtree.
    const observer = new MutationObserver(() => controller.reevaluate())
    observer.observe(document.body, { subtree: true, attributeFilter: ['data-tab-active'] })

    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', controller.onScroll, true)
    }
  }, [pathname])

  return (
    <div
      ref={ref}
      aria-hidden
      // z-40 keeps it under the fixed top warning banner and the offline pill, which own z-[60] —
      // a scrim that covers a warning is a worse bug than the one it fixes.
      className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-40 opacity-0 transition-opacity duration-200 motion-reduce:transition-none"
      style={{
        // `--background`, NOT `--page-bg`: DynamicBackground sets `--page-bg: transparent`, so a
        // gradient built from it would vanish in exactly the case this exists for.
        // Chromium premultiplies alpha in gradients, so fading to `transparent` does not grey-band;
        // the canonical runtime is a Chromium WebView.
        backgroundImage: 'linear-gradient(to bottom, var(--background), transparent)',
      }}
    />
  )
}
