// #2426 — classification of a failed Google Calendar write, from the shape `GaxiosError` builds.
import { describe, it, expect } from 'vitest'
import { isCalendarScopeMissing, googleErrorStatus, googleErrorReasons } from '../google-error'

describe('googleErrorStatus', () => {
  it('reads .status, then response.status, then a numeric .code', () => {
    expect(googleErrorStatus({ status: 403 })).toBe(403)
    expect(googleErrorStatus({ response: { status: 429 } })).toBe(429)
    expect(googleErrorStatus({ code: 500 })).toBe(500)
  })

  it('is null for anything that did not come from a response', () => {
    // A system error's `code` is a string; it is not an HTTP status.
    expect(googleErrorStatus({ code: 'ECONNRESET' })).toBeNull()
    expect(googleErrorStatus({ code: 'ERR_HTTP_403' })).toBeNull()
    expect(googleErrorStatus(new Error('boom'))).toBeNull()
    expect(googleErrorStatus(null)).toBeNull()
    expect(googleErrorStatus('403')).toBeNull()
  })
})

describe('googleErrorReasons', () => {
  it('collects reasons from the error, its cause and the response body', () => {
    expect(googleErrorReasons({
      errors: [{ reason: 'a' }],
      cause: { errors: [{ reason: 'b' }] },
      response: { data: { error: { errors: [{ reason: 'c' }] } } },
    })).toEqual(['a', 'b', 'c'])
  })

  it('ignores malformed entries without throwing', () => {
    expect(googleErrorReasons({ errors: [null, 7, { reason: 4 }, { reason: 'ok' }], cause: 'x' })).toEqual(['ok'])
    expect(googleErrorReasons(undefined)).toEqual([])
  })
})

describe('isCalendarScopeMissing', () => {
  it('is true for a 403 with the insufficientPermissions reason, wherever it sits', () => {
    expect(isCalendarScopeMissing({ status: 403, cause: { errors: [{ reason: 'insufficientPermissions' }] } })).toBe(true)
    expect(isCalendarScopeMissing({ response: { status: 403, data: { error: { errors: [{ reason: 'insufficientPermissions' }] } } } })).toBe(true)
  })

  it('is true for a 403 whose reason cannot be read (the answer it always had)', () => {
    expect(isCalendarScopeMissing({ status: 403 })).toBe(true)
    expect(isCalendarScopeMissing({ code: 403 })).toBe(true)
  })

  it('is false for a 403 that names another reason', () => {
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'forbiddenForNonOrganizer']) {
      expect(isCalendarScopeMissing({ status: 403, cause: { errors: [{ reason }] } }), reason).toBe(false)
    }
  })

  it('is false for any other status, and for text with no status', () => {
    expect(isCalendarScopeMissing({ status: 401 })).toBe(false)
    expect(isCalendarScopeMissing({ status: 500, message: 'calendar' })).toBe(false)
    expect(isCalendarScopeMissing(new Error('Forbidden 403 calendar insufficientPermissions'))).toBe(false)
    expect(isCalendarScopeMissing({ code: 'ERR_HTTP_403' })).toBe(false)
  })
})
