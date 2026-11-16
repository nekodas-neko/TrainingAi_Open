// #3829 — `users.sign_ins_valid_from`: a sign-in older than it is refused, on the web cookie path and
// the native bearer path, and it is never the data epoch.
import { describe, it, expect } from 'vitest'
import { encode } from 'next-auth/jwt'
import { refreshIsActiveClaim } from '../is-active-refresh'
import { userClaims } from '../user'

const CUT = new Date('2026-11-16T01:00:00.000Z')
const CUT_S = Math.floor(CUT.getTime() / 1000)
const user = (signInsValidFrom: Date | null | undefined) =>
  async () => ({ isActive: true, isAdmin: false, sessionsValidFrom: null, signInsValidFrom })

describe('refreshIsActiveClaim with a sign-in cut-off', () => {
  it('refuses a sign-in from before the cut-off', async () => {
    const token = { userId: 'u1', isActive: true, signedInAt: CUT_S - 60 }
    await refreshIsActiveClaim(token, user(CUT))
    expect(token.isActive).toBe(false)
  })

  it('accepts a sign-in at or after it: the linking request\'s own', async () => {
    for (const signedInAt of [CUT_S, CUT_S + 60]) {
      const token = { userId: 'u1', isActive: true, signedInAt }
      await refreshIsActiveClaim(token, user(CUT))
      expect(token.isActive).toBe(true)
    }
  })

  it('changes nothing for an account with no cut-off, however old or stampless the sign-in', async () => {
    for (const cut of [null, undefined]) {
      const old = { userId: 'u1', isActive: true, signedInAt: 1 }
      await refreshIsActiveClaim(old, user(cut))
      expect(old.isActive).toBe(true)
      const stampless: { userId: string; isActive: boolean; signedInAt?: number } = { userId: 'u1', isActive: true }
      await refreshIsActiveClaim(stampless, user(cut))
      expect(stampless.isActive).toBe(true)
    }
  })

  it('fails closed: a token without a stamp, or an unreadable cut-off, is refused', async () => {
    const stampless: { userId: string; isActive: boolean; signedInAt?: number } = { userId: 'u1', isActive: true }
    await refreshIsActiveClaim(stampless, user(CUT))
    expect(stampless.isActive).toBe(false)
    const invalid = { userId: 'u1', isActive: true, signedInAt: CUT_S + 60 }
    await refreshIsActiveClaim(invalid, user(new Date('not a date')))
    expect(invalid.isActive).toBe(false)
  })

  it('is not the data epoch: the token carries no epoch from it, so no phone wipes its store', () => {
    const claims = userClaims({ id: 'u1', email: 'e', isActive: true, isAdmin: false, timezone: 'UTC',
      sessionsValidFrom: null, signInsValidFrom: CUT } as Parameters<typeof userClaims>[0])
    expect(claims.dataEpoch).toBe(0)
  })
})

describe('bearerSession with a sign-in cut-off (a phone\'s access token)', () => {
  const SECRET = 'cutoff-3829-test-secret-value-long-enough'
  process.env.AUTH_SECRET = SECRET
  const mint = (claims: Record<string, unknown>) =>
    encode({ token: claims, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 })
  const bearer = (t: string) => new Headers({ authorization: `Bearer ${t}` })

  it('answers inactive for a token signed in before the link, and active for one after', async () => {
    const { bearerSession } = await import('../bearer-session')
    const stale = await bearerSession(bearer(await mint({ userId: 'u1', isActive: true, signedInAt: CUT_S - 5 })), user(CUT))
    expect(stale?.isActive).toBe(false)
    const fresh = await bearerSession(bearer(await mint({ userId: 'u1', isActive: true, signedInAt: CUT_S + 5 })), user(CUT))
    expect(fresh?.isActive).toBe(true)
  })
})
