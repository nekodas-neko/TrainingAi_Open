import { APICallError, NoObjectGeneratedError } from 'ai'
import { reportServerError } from '@/lib/observability'

// Retryable = transient provider failures: rate limit or server error.
export function isRetryableAiError(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode
    return status === 429 || (status != null && status >= 500)
  }
  return false
}

// generateObject additionally fails when the model's output doesn't satisfy the
// schema — a single re-roll usually fixes it on flash-lite.
export function isRetryableObjectError(err: unknown): boolean {
  return isRetryableAiError(err) || NoObjectGeneratedError.isInstance(err)
}

export interface AiRetryOptions {
  baseDelayMs?: number
  jitterMs?: number
  shouldRetry?: (err: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
  /**
   * RV-70. Epoch ms after which no retry may START. The retry is skipped when the backoff alone
   * would carry it past this, which is what stops one jittered retry from turning a bounded call
   * into two of them.
   *
   * Skipping re-throws the ORIGINAL error rather than a timeout: a 429 that we chose not to retry
   * is still a 429, and reporting it as "ran out of time" would hide the rate limit from
   * `error_events`.
   */
  deadlineAt?: number
  now?: () => number
}

// Exactly one jittered retry. Callers pass maxRetries: 0 to the SDK call so the
// retry policy lives in one place instead of multiplying with the SDK's default 2.
export async function withAiRetry<T>(fn: () => Promise<T>, opts: AiRetryOptions = {}): Promise<T> {
  const {
    baseDelayMs = 1000,
    jitterMs = 500,
    shouldRetry = isRetryableAiError,
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    deadlineAt,
    now = () => Date.now(),
  } = opts
  try {
    return await fn()
  } catch (err) {
    if (!shouldRetry(err)) throw err
    const delay = baseDelayMs + Math.random() * jitterMs
    if (deadlineAt != null && now() + delay >= deadlineAt) {
      // Out of budget. Same terminal state as two exhausted attempts, so report it the same way.
      reportServerError(err)
      throw err
    }
    await sleep(delay)
    try {
      return await fn()
    } catch (retryErr) {
      // Both attempts exhausted — report before re-throwing so the caller's
      // own error handling is unaffected. No user context here (shared across
      // every AI route); error_events.user_id is nullable for exactly this case.
      reportServerError(retryErr)
      throw retryErr
    }
  }
}
