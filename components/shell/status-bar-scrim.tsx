'use client'

import { useEffect, useRef } from 'react'
import { createScrimController } from '@/lib/shell/status-bar-scrim-controller'

/**
 * DV-6 — a gradient behind the status bar, once, in the shell.
 *
 * The owner was offered a solid strip and chose the fade, so the app stays edge-to-edge and nothing
 * loses the ~28 px a flat backing costs. It lives here rather than on each screen because a
 * per-screen scrim is a rule every future screen can forget — which is how the defect reached a
 * device sweep in the first place.
 *
 * **There is no document scroll to listen to.** Every tab scrolls its own inner container (three
 * through `PullToSync`, Nutrition its own), and `scroll` does not bubble. It *does* reach a
 * listener registered in the CAPTURE phase on an ancestor, which is what lets one listener here
 * cover all five panels with no per-screen opt-in.
 *
 * The decision logic is in `lib/shell/status-bar-scrim-controller.ts` so it can be tested — the
 * vitest projects here cannot transform `.tsx`. Opacity is written straight to the node rather
 * than held in state: this runs on every scroll frame on a Samsung WebView.
 */
export function StatusBarScrim({ activeKey }: { activeKey: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = createScrimController(shown => {
      const el = ref.current
      if (el) el.style.opacity = shown ? '1' : '0'
    })
    controller.reevaluate()
    document.addEventListener('scroll', controller.onScroll, true)
    return () => document.removeEventListener('scroll', controller.onScroll, true)
  }, [activeKey])

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
