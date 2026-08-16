import { getRepositoryAsync } from "@/lib/data"
import { summariseCause } from "@/lib/observability/pg-cause"

// `summariseCause` lives in ./observability/pg-cause because `request-error.ts` needs it too and
// cannot import this module (it would drag the Drizzle adapter into the instrumentation bundle).
// Re-exported here so the existing import path keeps working.
export { summariseCause }

// Fire-and-forget server-error capture. Never throws — a failure to record
// an error must never mask or replace the original error being reported.
// Adopted in the catch blocks of the highest-risk routes only (sync/push,
// log-exercise, oura/sync, the AI retry failure path) — not a blanket sweep.
export function reportServerError(err: unknown, context?: { userId?: string; url?: string }): void {
  const baseMessage = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack ?? null : null

  const { prefix, block } = summariseCause(err)
  const message = `${prefix}${baseMessage}`
  const fullStack = block ? `${block}\n${stack ?? ''}` : stack

  getRepositoryAsync()
    .then(repo => repo.insertErrorEvent({
      userId: context?.userId ?? null,
      source: "server",
      message: message.slice(0, 2000),
      stack: fullStack?.slice(0, 8000) ?? null,
      url: context?.url ?? null,
    }))
    .catch(() => {})
}
