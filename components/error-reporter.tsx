"use client"

import { useEffect } from "react"
import { startAppLoadReporting } from "@/lib/app-load-metrics"
import { reportRenderProcessDeaths } from "@/lib/renderer-recovery"

const MAX_REPORTS_PER_MINUTE = 5
const THROTTLE_WINDOW_MS = 60_000

// Global client-error capture: uncaught exceptions and unhandled promise
// rejections. Dedupes by message within the session (a render-loop error can
// otherwise fire hundreds of times) and throttles to a handful per minute so
// a runaway error can't flood the client-error rate limit for everyone else.
export function ErrorReporter() {
  useEffect(() => {
    const seenMessages = new Set<string>()
    let reportTimestamps: number[] = []

    function report(message: string, stack?: string | null) {
      if (seenMessages.has(message)) return
      seenMessages.add(message)

      const now = Date.now()
      reportTimestamps = reportTimestamps.filter(t => now - t < THROTTLE_WINDOW_MS)
      if (reportTimestamps.length >= MAX_REPORTS_PER_MINUTE) return
      reportTimestamps.push(now)

      const body = JSON.stringify({ message: message.slice(0, 2000), stack: stack?.slice(0, 8000), url: window.location.href })
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }))
      } else {
        fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {})
      }
    }

    function onError(event: ErrorEvent) {
      report(event.message, event.error?.stack)
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      report(message, reason instanceof Error ? reason.stack : undefined)
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)

    // BF-19. Mounted here rather than as a second component because this is already the app's one
    // global client-telemetry mount, and app-load timing is telemetry. All of its logic lives in
    // `lib/app-load-metrics.ts` (waiting for `load`, reading the navigation entry, the
    // once-per-context guard, the beacon) so this file's share of it stays one call.
    const stopAppLoadReporting = startAppLoadReporting(process.env.NEXT_PUBLIC_BUILD_ID || undefined)

    // BF-80. A dead WebView renderer takes this component's own listeners with it, so the death is
    // recorded natively and collected here on the next boot. It rides on this mount for the same
    // reason app-load timing does — this is the global client-telemetry mount — and all of its
    // logic lives in `lib/renderer-recovery.ts`. No-ops outside the APK.
    reportRenderProcessDeaths()

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
      stopAppLoadReporting()
    }
  }, [])

  return null
}
