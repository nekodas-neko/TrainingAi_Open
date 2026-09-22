/**
 * RV-70 — every AI call is bounded, and one retry cannot double the bound.
 *
 * Before this there was no ceiling anywhere: every route passes `maxRetries: 0` to the SDK, so the
 * SDK's own timeout handling never applies, and exactly one route in `app/api/**` carried an
 * `AbortSignal` at all — a non-AI one. A provider that accepts the connection and never answers
 * held the request open for as long as the platform allowed.
 *
 * The property worth pinning is not "there is a timeout" — it is that the budget is **total**. Two
 * attempts of one ceiling each is a worst case of two ceilings, which is the bug wearing a
 * different hat, so the retry runs inside the remaining budget and is skipped outright when the
 * backoff alone would carry it past the deadline.
 */
import { describe, it, expect, vi } from 'vitest'
import { APICallError } from 'ai'
import { runWithDeadline, AiTimeoutError, AI_CALL_BUDGET_MS } from '@/lib/ai/deadline'
import { withAiRetry, isRetryableAiError } from '@/lib/ai/retry'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const never = () => new Promise<never>(() => {})
const apiError = (statusCode: number) =>
  new APICallError({ message: `status ${statusCode}`, url: 'https://example.test', requestBodyValues: {}, statusCode })

describe('runWithDeadline', () => {
  it('settles a call that never resolves', async () => {
    await expect(runWithDeadline(never, 20)).rejects.toBeInstanceOf(AiTimeoutError)
  })

  it('aborts the signal it handed out, so the abandoned request can actually stop', async () => {
    let seen: AbortSignal | undefined
    const p = runWithDeadline(signal => { seen = signal; return never() }, 20)
    await expect(p).rejects.toBeInstanceOf(AiTimeoutError)
    expect(seen?.aborted).toBe(true)
    expect((seen?.reason as Error)?.name).toBe('AiTimeoutError')
  })

  /**
   * The bound must not depend on the call site wiring the signal into anything. A call site that
   * ignores it — a new AI route, or one whose SDK shape has no `abortSignal` — is still answered
   * within the budget, because the race is what returns, not the abort.
   */
  it('bounds a call that ignores the signal entirely', async () => {
    await expect(runWithDeadline(() => never(), 20)).rejects.toBeInstanceOf(AiTimeoutError)
  })

  it('returns a result that beats the deadline, and does not abort it', async () => {
    let seen: AbortSignal | undefined
    await expect(runWithDeadline(async signal => { seen = signal; return 'ok' }, 10_000)).resolves.toBe('ok')
    expect(seen?.aborted).toBe(false)
  })

  /**
   * A timeout must not be retryable. If it were, the shared retry would answer a call that ran out
   * of time by starting a second helping of the same — the exact doubling this bound exists to stop.
   */
  it('a timeout reads as non-retryable', () => {
    expect(isRetryableAiError(new AiTimeoutError(100))).toBe(false)
  })

  it('the shipped budget is generous against the slowest call on record', () => {
    // Measured 2026-09-22 over the owner's `ai_call_log`: the slowest call of any section ever
    // recorded is 4,786 ms. A ceiling under ~5x that would be cutting off calls the app makes.
    expect(AI_CALL_BUDGET_MS).toBeGreaterThanOrEqual(25_000)
  })
})

describe('withAiRetry — deadline', () => {
  it('skips the retry when the backoff alone would cross the deadline', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(429))
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(withAiRetry(fn, {
      sleep, baseDelayMs: 1000, jitterMs: 0, deadlineAt: 5_000, now: () => 4_500,
    })).rejects.toThrow('status 429')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  /**
   * The ORIGINAL error, not a timeout. A 429 we chose not to retry is still a 429, and reporting it
   * as "ran out of time" would hide the rate limit from `error_events` — which is where the next
   * session looks first.
   */
  it('re-throws the original error rather than a timeout when it skips', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(503))
    await expect(withAiRetry(fn, {
      sleep: () => Promise.resolve(), baseDelayMs: 1000, jitterMs: 0, deadlineAt: 0, now: () => 0,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('still retries when there is budget left', async () => {
    const fn = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce('ok')
    await expect(withAiRetry(fn, {
      sleep: () => Promise.resolve(), baseDelayMs: 1000, jitterMs: 0, deadlineAt: 100_000, now: () => 0,
    })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('is unbounded when no deadline is given, exactly as before', async () => {
    const fn = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce('ok')
    await expect(withAiRetry(fn, { sleep: () => Promise.resolve() })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
