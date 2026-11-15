import { describe, it, expect } from 'vitest'
import { freshForFirstPassword, FIRST_PASSWORD_SIGN_IN_MAX_AGE_SECONDS } from '../fresh-sign-in'

const NOW = 1_800_000_000
const at = (s: number) => new Date(s * 1000)

describe('#3797 — a fresh sign-in for a first password', () => {
  it('accepts a sign-in inside the window and after the newest link', () => {
    expect(freshForFirstPassword(NOW - 60, at(NOW - 61), NOW)).toBe(true)
    expect(freshForFirstPassword(NOW - FIRST_PASSWORD_SIGN_IN_MAX_AGE_SECONDS, null, NOW)).toBe(true)
  })
  it('accepts a sign-in in the same second as its own link (the link happens inside it)', () => {
    expect(freshForFirstPassword(NOW, new Date(NOW * 1000 + 700), NOW)).toBe(true)
  })
  it('refuses a stale sign-in', () => {
    expect(freshForFirstPassword(NOW - FIRST_PASSWORD_SIGN_IN_MAX_AGE_SECONDS - 1, null, NOW)).toBe(false)
  })
  it('refuses a recent sign-in from before the link that cleared the password', () => {
    expect(freshForFirstPassword(NOW - 60, at(NOW - 30), NOW)).toBe(false)
  })
  it('refuses a session with no sign-in stamp, or an unreadable one', () => {
    expect(freshForFirstPassword(undefined, null, NOW)).toBe(false)
    expect(freshForFirstPassword(Number.NaN, null, NOW)).toBe(false)
    expect(freshForFirstPassword(NOW, new Date(Number.NaN), NOW)).toBe(false)
  })
})
