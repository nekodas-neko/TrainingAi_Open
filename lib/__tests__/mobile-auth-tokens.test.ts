import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMobileAuthToken, consumeMobileAuthToken } from '../mobile-auth-tokens'

afterEach(() => vi.useRealTimers())

describe('mobile auth tokens', () => {
  it('round-trips cookie value and challenge, one time only', () => {
    const token = createMobileAuthToken('cookie-value', 'challenge-abc')
    expect(consumeMobileAuthToken(token)).toEqual({ sessionCookieValue: 'cookie-value', challenge: 'challenge-abc' })
    expect(consumeMobileAuthToken(token)).toBeNull() // consumed
  })
  it('returns null for unknown tokens', () => {
    expect(consumeMobileAuthToken('nope')).toBeNull()
  })
  it('expires after 5 minutes', () => {
    vi.useFakeTimers()
    const token = createMobileAuthToken('cookie-value', 'challenge-abc')
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(consumeMobileAuthToken(token)).toBeNull()
  })
})
