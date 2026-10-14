// What the Oura Cloud feed reports to `error_events` (#2895 review, item 5), at most once an hour per
// kind in this process.
//
// The webhook signature, the subscription renewal and the connect backfill all fail without anyone
// watching: Oura retries, the timer fires again, the backfill runs in the background. Real Oura
// signing has never been exercised against this code, so a format mismatch would refuse every event
// and nothing would say so. Each report carries only the outcome (a verdict, a status, which headers
// were present) — never a token, a secret, a signature value or a request body.
//
// `@/lib/observability` is imported lazily: the renewal timer reaches this module from
// `instrumentation-node.ts`, and a static import would pull `@/lib/data` (and the Drizzle adapter's
// native addon) into the boot bundle — the reason `instrumentation-node.ts` avoids it itself.

export const OURA_REPORT_INTERVAL_MS = 60 * 60 * 1000

const lastReported = new Map<string, number>()
let observability: Promise<typeof import('@/lib/observability')> | null = null

/**
 * Reports `message` under `kind`, unless the same kind was reported in the last hour. Returns whether
 * it was sent. `kind` is the throttle key, so put the outcome in it (`webhook-signature:mismatch`)
 * and leave per-event detail in the message.
 */
export function reportOuraCloudIssue(
  kind: string, message: string, context: { userId?: string } = {}, now = Date.now(),
): boolean {
  const last = lastReported.get(kind)
  if (last !== undefined && now - last < OURA_REPORT_INTERVAL_MS) return false
  lastReported.set(kind, now)
  const err = new Error(`oura_cloud ${kind}: ${message}`.slice(0, 500))
  // One import promise for every report, so concurrent reports never race the module load; a failed
  // load is forgotten so the next report tries again.
  observability ??= import('@/lib/observability')
  void observability
    .then(({ reportServerError }) => reportServerError(err, { userId: context.userId, url: `oura:${kind.split(':')[0]}` }))
    .catch(() => { observability = null })
  return true
}

/** Test seam: forget the throttle. */
export function resetOuraCloudReportThrottle(): void {
  lastReported.clear()
}
