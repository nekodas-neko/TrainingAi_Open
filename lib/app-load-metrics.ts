// BF-19 — how long the app actually takes to load, recorded so the question can be answered from
// data instead of from memory.
//
// The owner reported the app "VERY slowly lately" and asked for a second opinion in case the
// regression was permanent. Nothing could answer it: the two existing timing endpoints measure
// WORKOUT duration, and everything server-side was ruled out by measurement (`SELECT 1` at 3 ms,
// 99.90% buffer-cache hit, zero idle-in-transaction). The number that matters is on the device.
//
// **This must never be able to slow the thing it measures.** It is telemetry, so every design
// choice here is subordinate to that:
//
//   - `sendBeacon` where available: the browser sends it outside the page's critical path and it
//     survives the navigation that triggered it. `keepalive: true` on the fetch fallback is the
//     same guarantee by another name.
//   - Online only, silently. An offline post fails anyway, and being offline is not a measurement
//     worth keeping.
//   - **Never the outbox.** Every other client write in this app queues a mutation so it survives
//     offline — that is the standing offline-first rule and it is right for user data. Telemetry is
//     not user data: queueing it would put navigation rows in front of the user's food logs on the
//     next push, so a dropped measurement is strictly better than a delayed workout.
//   - Never throws. A reporting failure that surfaced as an error would be worse than the slowness.
//
// Its ingest route is `POST /api/app-load` and the report is `GET /api/admin/app-load-report`.

/** Sub-millisecond floats are noise at the resolution this is read. Negative clamps to 0. */
function ms(value: number | undefined | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

/**
 * The route *pattern*, never the resolved URL.
 *
 * `/health/day?d=2026-08-26` and `/workout?session=<uuid>` would otherwise make every row its own
 * group and no percentile could ever be computed. The query string goes entirely; a path segment
 * that looks like an id is replaced rather than kept.
 */
export function routePattern(pathname: string): string {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return (
    pathname
      .split('/')
      .map(seg => (UUID.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
      .join('/') || '/'
  )
}

/**
 * Read the navigation timing for this page load, or `null` when there is nothing to report.
 *
 * `null` is the common case rather than a failure: the API is absent in some contexts, and a
 * navigation that has not finished has `loadEventEnd === 0`.
 *
 * **`cold` is the split the whole report depends on.** Every merge is a Railway deploy and the
 * service worker's cache name is stamped from the deploy SHA, so the device's offline shell is
 * invalidated once per deploy — 80 times on one measured day. A p95 that pools cold and warm loads
 * measures release cadence, not the app. `deliveryType`/`transferSize` is how the browser says
 * whether it went to the network: a service-worker or memory hit transfers nothing.
 */
export function readNavigationTiming(): {
  responseStartMs: number | null
  domContentMs: number | null
  totalMs: number
  cold: boolean
} | null {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return null
  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  if (!nav) return null

  const totalMs = ms(nav.loadEventEnd || nav.domComplete)
  if (totalMs == null || totalMs === 0) return null

  return {
    responseStartMs: ms(nav.responseStart),
    domContentMs: ms(nav.domContentLoadedEventEnd),
    totalMs,
    // A cached shell transfers no bytes. Treating an unknown transferSize as cold is the safer
    // default: it inflates the cold bucket rather than quietly flattering the warm one.
    cold: !(typeof nav.transferSize === 'number' && nav.transferSize === 0),
  }
}

let reported = false

/**
 * Report this page load, at most once per JS context.
 *
 * Once, not per route change: `getEntriesByType('navigation')` describes the document load, and a
 * client-side route change does not create a new one. Reporting on every route settle would post
 * the same numbers repeatedly under whichever route happened to be current — which is worse than
 * not reporting, because it would look like data.
 */
export function reportAppLoad(buildId?: string): void {
  if (reported) return
  if (typeof navigator === 'undefined' || !navigator.onLine) return
  if (typeof window === 'undefined') return

  const timing = readNavigationTiming()
  if (!timing) return
  reported = true

  const body = JSON.stringify({
    route: routePattern(window.location.pathname),
    ...timing,
    buildId,
  })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/app-load', new Blob([body], { type: 'application/json' }))
    } else {
      void fetch('/api/app-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    /* telemetry is best-effort — a reporting failure must never surface */
  }
}

/**
 * Start reporting: fire now if the document has finished loading, otherwise wait for `load`.
 *
 * The timing is only complete once `loadEventEnd` is set, and a React effect runs well before that
 * on a cold start — so calling `reportAppLoad` directly from a mount would read nothing on exactly
 * the loads that matter most. `readNavigationTiming` returns null in that case and, deliberately,
 * does **not** consume the once-per-context guard, so an early call is harmless rather than fatal;
 * this is what makes the report actually happen.
 *
 * Returns a cleanup that removes the listener, so a caller can use it directly from `useEffect`.
 * Everything above the mount lives here rather than in the component, so the surface a UI file has
 * to touch is one call.
 */
export function startAppLoadReporting(buildId?: string): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  if (document.readyState === 'complete') {
    reportAppLoad(buildId)
    return () => {}
  }
  const onLoad = () => reportAppLoad(buildId)
  window.addEventListener('load', onLoad, { once: true })
  return () => window.removeEventListener('load', onLoad)
}

/** Test seam: the once-per-context guard is module state and would otherwise leak between cases. */
export function __resetAppLoadReporterForTests(): void {
  reported = false
}
