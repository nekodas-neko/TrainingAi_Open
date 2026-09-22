/**
 * RV-70 — every AI call gets a wall-clock ceiling, in one place.
 *
 * Before this, no AI call carried one. Every route passes `maxRetries: 0` to the SDK, which takes
 * the SDK's own timeout handling out of the picture, and exactly one route in `app/api/**` used an
 * `AbortSignal` at all — `admin/mirror-dataset-gifs`, not an AI one. Two AI routes declare
 * `export const maxDuration = 30`; the rest declare nothing, so a provider that accepts the
 * connection and never answers holds the request open for as long as the platform allows.
 *
 * No hang has been observed. Measured 2026-09-22 over the owner's `ai_call_log`, the slowest call
 * of any section ever recorded is **4,786 ms** (`generate-program`), and every section's p95 is
 * under 4 s. So this is a bound on a tail nobody has measured, which argues for a generous ceiling
 * rather than a tight one: {@link AI_CALL_BUDGET_MS} is ~6x the slowest call on record, and a
 * legitimate call would have to be six times worse than anything ever seen to be cut off.
 *
 * Deliberately NOT per-section. The entry proposed sizing it per section; the latency spread does
 * not support that — the slowest section's max is 4.8 s and the fastest's is 0.9 s, both of them an
 * order of magnitude under any ceiling worth setting, so per-section constants would be invented
 * precision that then has to be maintained.
 */

/**
 * Total wall-clock budget for one logical AI call, INCLUDING the single retry in `withAiRetry`.
 *
 * A budget rather than a per-attempt timeout: two attempts of 30 s each is a 60 s worst case, which
 * is the thing being fixed, not a smaller version of it.
 */
export const AI_CALL_BUDGET_MS = 30_000

export class AiTimeoutError extends Error {
  readonly budgetMs: number
  constructor(budgetMs: number) {
    super(`AI call exceeded its ${budgetMs}ms budget`)
    this.name = 'AiTimeoutError'
    this.budgetMs = budgetMs
  }
}

/**
 * Run one attempt under a deadline, and hand it the signal so it can be cancelled upstream.
 *
 * Two mechanisms on purpose, and they guarantee different things:
 *
 *   · the **race** is what makes the bound unconditional — the returned promise settles by the
 *     deadline whether or not the caller wired the signal into anything. A new AI call site added
 *     later is bounded for free, which is the whole reason the ceiling lives at the chokepoint;
 *   · the **signal** is what makes the abandoned request actually stop. Every current call site
 *     passes it to the SDK as `abortSignal`, so a timed-out call releases the connection instead
 *     of running on invisibly. Without it the race would still answer in time, but the provider
 *     call would continue and be billed.
 *
 * `AiTimeoutError` is deliberately not an `APICallError`, so `isRetryableAiError` reads it as
 * non-retryable and a call that ran out of time is never retried into a second helping of the same.
 */
export function runWithDeadline<T>(fn: (signal: AbortSignal) => Promise<T>, budgetMs: number): Promise<T> {
  const controller = new AbortController()
  const err = new AiTimeoutError(budgetMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(err)
      reject(err)
    }, budgetMs)
  })
  return Promise.race([fn(controller.signal), expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
