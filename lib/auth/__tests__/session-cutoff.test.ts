// #3369 — an admin's data reset sets `users.sessions_valid_from`; a sign-in older than it is refused.
import { describe, it, expect } from 'vitest'
import { encode } from 'next-auth/jwt'
import { dataEpochOf, signedInBeforeCutoff } from '../session-cutoff'
import { refreshIsActiveClaim } from '../is-active-refresh'

const CUT = new Date('2026-10-26T01:00:00.000Z')
const CUT_S = Math.floor(CUT.getTime() / 1000)

describe('signedInBeforeCutoff', () => {
  it('refuses nothing for an account with no cut-off, however old the sign-in or whatever it lacks', () => {
    expect(signedInBeforeCutoff(1, null)).toBe(false)
    expect(signedInBeforeCutoff(undefined, null)).toBe(false)
    expect(signedInBeforeCutoff(undefined, undefined)).toBe(false)
  })

  it('refuses a sign-in before the cut-off, and keeps one at or after it', () => {
    expect(signedInBeforeCutoff(CUT_S - 1, CUT)).toBe(true)
    expect(signedInBeforeCutoff(CUT_S, CUT)).toBe(false)
    expect(signedInBeforeCutoff(CUT_S + 3600, CUT)).toBe(false)
  })

  it('keeps a sign-in in the same second as the cut-off even when the cut-off has milliseconds', () => {
    expect(signedInBeforeCutoff(CUT_S, new Date(CUT.getTime() + 999))).toBe(false)
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])('refuses a token that cannot prove its age (%s) once a cut-off is set', signedInAt => {
    // Infinity is "newer than everything" arithmetically; a claim that is not a finite number is not a stamp.
    expect(signedInBeforeCutoff(signedInAt as number | undefined, CUT)).toBe(true)
  })

  it('refuses everything for a cut-off that is not a date, rather than letting it through', () => {
    expect(signedInBeforeCutoff(CUT_S + 100, new Date('nonsense'))).toBe(true)
  })
})

describe('dataEpochOf', () => {
  it('is 0 for an account that was never reset, and the cut-off in whole seconds otherwise', () => {
    expect(dataEpochOf(null)).toBe(0)
    expect(dataEpochOf(undefined)).toBe(0)
    expect(dataEpochOf(new Date(CUT.getTime() + 999))).toBe(CUT_S)
  })
})

describe('refreshIsActiveClaim with a cut-off', () => {
  const user = (validFrom: Date | null) => async () => ({ isActive: true, isAdmin: true, sessionsValidFrom: validFrom })

  it('marks a stale sign-in inactive, which is the refusal every caller already honours', async () => {
    const token = { userId: 'u1', isActive: true, isAdmin: true, signedInAt: CUT_S - 60 }
    await refreshIsActiveClaim(token, user(CUT))
    expect(token.isActive).toBe(false)
  })

  it('keeps a sign-in made after the reset', async () => {
    const token = { userId: 'u1', isActive: false, signedInAt: CUT_S + 60 }
    await refreshIsActiveClaim(token, user(CUT))
    expect(token.isActive).toBe(true)
  })

  it('refuses a token issued before the claim existed once the account has a cut-off', async () => {
    const token: { userId: string; isActive: boolean; signedInAt?: number } = { userId: 'u1', isActive: true }
    await refreshIsActiveClaim(token, user(CUT))
    expect(token.isActive).toBe(false)
  })

  it('does not touch an account that was never reset', async () => {
    const token: { userId: string; isActive: boolean; signedInAt?: number } = { userId: 'u1', isActive: true }
    await refreshIsActiveClaim(token, user(null))
    expect(token.isActive).toBe(true)
  })

  it('does not lift a deactivation: an inactive account stays inactive past the cut-off', async () => {
    const token = { userId: 'u1', isActive: true, signedInAt: CUT_S + 60 }
    await refreshIsActiveClaim(token, async () => ({ isActive: false, sessionsValidFrom: CUT }))
    expect(token.isActive).toBe(false)
  })
})

describe('bearerSession with a cut-off', () => {
  const SECRET = 'cutoff-test-secret-value-long-enough-to-derive'
  process.env.AUTH_SECRET = SECRET
  const mint = (claims: Record<string, unknown>) =>
    encode({ token: claims, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 })
  const bearer = (t: string) => new Headers({ authorization: `Bearer ${t}` })

  it('answers inactive for a token signed in before the reset, and active for one signed in after', async () => {
    const { bearerSession } = await import('../bearer-session')
    const lookup = async () => ({ isActive: true, isAdmin: false, sessionsValidFrom: CUT })
    const stale = await bearerSession(bearer(await mint({ userId: 'u1', isActive: true, signedInAt: CUT_S - 5 })), lookup)
    expect(stale?.isActive).toBe(false)
    const fresh = await bearerSession(bearer(await mint({ userId: 'u1', isActive: true, signedInAt: CUT_S + 5 })), lookup)
    expect(fresh?.isActive).toBe(true)
  })
})

describe('where the sign-in stamp comes from', () => {
  it('stamps signedInAt once at sign-in and carries it through a later re-issue', async () => {
    const { authConfig } = await import('@/auth.config')
    const jwt = authConfig.callbacks.jwt as (a: Record<string, unknown>) => Record<string, unknown>
    const before = Math.floor(Date.now() / 1000)
    const first = jwt({ token: {}, user: { id: 'u1', isActive: true } })
    expect(first.signedInAt).toBeGreaterThanOrEqual(before)
    // Auth.js calls the callback again without `user` as the cookie ages; the stamp must not move.
    const later = jwt({ token: { ...first } })
    expect(later.signedInAt).toBe(first.signedInAt)
  })
})
