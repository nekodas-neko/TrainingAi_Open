import { describe, it, expect, vi } from 'vitest'
import { APICallError, NoObjectGeneratedError } from 'ai'
import { withAiRetry, isRetryableAiError, isRetryableObjectError } from '@/lib/ai/retry'

const noSleep = () => Promise.resolve()

function apiError(statusCode: number) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
  })
}

function noObjectError() {
  return new NoObjectGeneratedError({
    message: 'schema mismatch',
    response: { id: 'r1', timestamp: new Date(), modelId: 'test-model' },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'stop',
  })
}

describe('isRetryableAiError', () => {
  it('is true for 429 and 5xx APICallErrors', () => {
    expect(isRetryableAiError(apiError(429))).toBe(true)
    expect(isRetryableAiError(apiError(500))).toBe(true)
    expect(isRetryableAiError(apiError(503))).toBe(true)
  })
  it('is false for 4xx (non-429) and plain errors', () => {
    expect(isRetryableAiError(apiError(400))).toBe(false)
    expect(isRetryableAiError(new Error('boom'))).toBe(false)
  })
})

describe('isRetryableObjectError', () => {
  it('additionally accepts NoObjectGeneratedError', () => {
    expect(isRetryableObjectError(noObjectError())).toBe(true)
    expect(isRetryableObjectError(new Error('boom'))).toBe(false)
  })
})

describe('withAiRetry', () => {
  it('retries once on a retryable error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce('ok')
    await expect(withAiRetry(fn, { sleep: noSleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('bad request'))
    await expect(withAiRetry(fn, { sleep: noSleep })).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('gives up after the second failure', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(500))
    await expect(withAiRetry(fn, { sleep: noSleep })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('waits a jittered delay before retrying', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fn = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce('ok')
    await withAiRetry(fn, { sleep, baseDelayMs: 100, jitterMs: 50 })
    expect(sleep).toHaveBeenCalledTimes(1)
    const ms = sleep.mock.calls[0][0] as number
    expect(ms).toBeGreaterThanOrEqual(100)
    expect(ms).toBeLessThanOrEqual(150)
  })
})
