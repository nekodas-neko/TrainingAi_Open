import { reportServerError } from '@/lib/observability'

/**
 * Surface a rollup's swallowed step failures into `error_events`.
 *
 * **Why this exists.** `aggregateOuraRawSamples` wraps every write in a `step()` that catches,
 * pushes the message onto `stepErrors` and `console.error`s — deliberately, so a failed illness
 * write cannot block the summary write beside it. The consequence nobody had closed is that
 * `step()` **guarantees the rollup never throws**, and the only reporting on either caller is a
 * `.catch` — which therefore cannot fire. So a failing sleep, summary, illness or resilience write
 * reached Railway stdout and **nothing else**: not `error_events`, not Sentry, not the job row.
 *
 * That is a blind spot on the heaviest write path in the app, and it is the reason a full-history
 * pass on 2026-09-03 rewrote 84 derived rows while leaving `oura_daily_summary` untouched with no
 * trace of why (LA-56). Before this, `error_events` recorded rollup faults only when the whole
 * worker died — the outer `.catch` — which is the rarer half.
 *
 * Reported as ONE event rather than one per step: the steps of a single pass fail together far more
 * often than independently (a lost connection takes whatever is in flight), and N events per pass
 * would push the genuinely distinct faults out of a table that prunes at 30 days.
 */
export function reportRollupStepErrors(
  stepErrors: readonly string[] | undefined,
  context: { userId: string; url: string },
): void {
  if (!stepErrors?.length) return
  reportServerError(
    new Error(`rollup step(s) failed: ${stepErrors.join(' | ')}`.slice(0, 1800)),
    context,
  )
}
