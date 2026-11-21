import { describe, it, expect, vi } from 'vitest'
import { refreshIsActiveClaim } from '../is-active-refresh'

const NOW = 1_800_000_000_000
const active = async () => ({ isActive: true })
const deactivated = async () => ({ isActive: false })

describe('refreshIsActiveClaim', () => {
  it('picks up a deactivation once the recheck is due', async () => {
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: NOW - 1 }
    await refreshIsActiveClaim(token, deactivated, NOW)
    expect(token.isActive).toBe(false)
    expect(token.isActiveCheckedAt).toBe(NOW)
  })

  it('checks even a freshly persisted timestamp', async () => {
    const lookup = vi.fn(deactivated)
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: NOW }
    await refreshIsActiveClaim(token, lookup, NOW)
    expect(lookup).toHaveBeenCalledWith('u1')
    expect(token.isActive).toBe(false)
  })

  it('checks immediately on a token that has never been checked', async () => {
    const token = { userId: 'u1', isActive: true }
    await refreshIsActiveClaim(token, deactivated, NOW)
    expect(token.isActive).toBe(false)
  })

  it('re-activation propagates too, not just deactivation', async () => {
    const token = { userId: 'u1', isActive: false, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, active, NOW)
    expect(token.isActive).toBe(true)
  })

  // #3949 review S2: an outage fails closed for that request (a signed-out or password-revoked
  // cookie must not authenticate while the cut-off cannot be read), and leaves nothing behind: the
  // check stamp and profile claims are untouched, and the next call decides from the row alone.
  it.each([true, false, undefined])('refuses isActive=%s during a database outage, and passes once it is back', async isActive => {
    const token = { userId: 'u1', isActive, isAdmin: true, isActiveCheckedAt: 0, signedInAt: 1_799_999_000 }
    const lookup = vi.fn().mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ isActive: true, isAdmin: true })
    await expect(refreshIsActiveClaim(token, lookup, NOW)).resolves.toBe(token)
    expect(token).toEqual({ userId: 'u1', isActive: false, isAdmin: false, isActiveCheckedAt: 0, signedInAt: 1_799_999_000 })
    await refreshIsActiveClaim(token, lookup, NOW + 1)
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(token).toEqual({ userId: 'u1', isActive: true, isAdmin: true, isActiveCheckedAt: NOW + 1, signedInAt: 1_799_999_000 })
  })

  it('a signed-out session is refused during an outage, not let through by it', async () => {
    const cutoff = new Date(1_800_000_000_000)
    const token = { userId: 'u1', isActive: true, isAdmin: true, signedInAt: 1_799_999_000 }
    await refreshIsActiveClaim(token, async () => { throw new Error('db down') }, NOW)
    expect(token.isActive).toBe(false)
    await refreshIsActiveClaim(token, async () => ({ isActive: true, signInsValidFrom: cutoff }), NOW)
    expect(token.isActive).toBe(false)
  })

  // #3949 review N1: the sign-in cut-off is strict. A cut-off with a fraction (written from the app
  // clock before the database clock took over) refuses a sign-in stamped in its own second.
  it('refuses a sign-in in the same second as a sign-in cut-off, and keeps one at the next', async () => {
    const cut = new Date(1_800_000_000_400)
    const at = async (signedInAt: number) => (await refreshIsActiveClaim<{ userId: string; signedInAt: number; isActive?: boolean }>({ userId: 'u1', signedInAt },
      async () => ({ isActive: true, signInsValidFrom: cut }), NOW)).isActive
    expect(await at(1_800_000_000)).toBe(false)
    expect(await at(1_800_000_001)).toBe(true)
    const whole = new Date(1_800_000_001_000)
    const atWhole = async (signedInAt: number) => (await refreshIsActiveClaim<{ userId: string; signedInAt: number; isActive?: boolean }>({ userId: 'u1', signedInAt },
      async () => ({ isActive: true, signInsValidFrom: whole }), NOW)).isActive
    expect(await atWhole(1_800_000_000)).toBe(false)
    expect(await atWhole(1_800_000_001)).toBe(true)
  })

  it('treats a DELETED user row as deactivation (RV-195 ②)', async () => {
    const token = { userId: 'u1', isActive: true, isAdmin: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => null, NOW)
    expect(token.isActive).toBe(false)
    expect(token.isAdmin).toBe(false)
    expect(token.isActiveCheckedAt).toBe(0) // nothing to re-check; a restored row takes effect at once
  })

  it('does nothing without a userId', async () => {
    const lookup = vi.fn(deactivated)
    await refreshIsActiveClaim({ isActive: true }, lookup, NOW)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('a continuously-active user is checked on every request', async () => {
    const lookup = vi.fn(active)
    const token: { userId?: string; isActive?: boolean; isActiveCheckedAt?: number } =
      { userId: 'u1', isActive: true, isActiveCheckedAt: NOW }
    for (let h = 1; h <= 24 * 7; h++) {
      await refreshIsActiveClaim(token, lookup, NOW + h * 60 * 60 * 1000)
      expect(token.isActive).toBe(true)
    }
    expect(lookup).toHaveBeenCalledTimes(24 * 7)
  })
  it('picks up an admin grant made after the token was minted', async () => {
    const token = { userId: 'u1', isActive: true, isAdmin: false, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => ({ isActive: true, isAdmin: true }), NOW)
    expect(token.isAdmin).toBe(true)
  })

  it('picks up an admin revocation, which is the direction that matters', async () => {
    const token = { userId: 'u1', isActive: true, isAdmin: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => ({ isActive: true, isAdmin: false }), NOW)
    expect(token.isAdmin).toBe(false)
  })

  it('does not grant admin when the lookup does not supply isAdmin', async () => {
    const token = { userId: 'u1', isActive: true, isAdmin: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => ({ isActive: true }), NOW)
    expect(token.isAdmin).toBe(false)
  })
})
describe('the per-request read PS-24 depends on', () => {
  it('fires on every request, because the stamp never arrives with the token', async () => {
    let reads = 0
    const lookup = async () => { reads++; return { isActive: false, isAdmin: false } }
    for (let i = 0; i < 3; i++) {
      const fromCookie: { userId: string; isActive: boolean; isActiveCheckedAt?: number } =
        { userId: 'u1', isActive: true }
      const token = await refreshIsActiveClaim(fromCookie, lookup)
      expect(token.isActive).toBe(false)
    }
    expect(reads, 'a persisted stamp would make this 1 and reintroduce a day of staleness').toBe(3)
  })

  it('and the same read keeps isAdmin fresh for every Node caller', async () => {
    const fromCookie = { userId: 'u1', isActive: true, isAdmin: true }
    const token = await refreshIsActiveClaim(fromCookie, async () => ({ isActive: true, isAdmin: false }))
    expect(token.isAdmin).toBe(false)
  })
})

it('preserves calculation claims on an outage and clears fields the user removed', async () => {
  const token = {userId:'u1',isActive:true,isAdmin:false,timezone:'Australia/Brisbane',heightCm:180,sex:'male'}
  await refreshIsActiveClaim(token,async () => {throw new Error('offline')})
  expect(token.isActive).toBe(false)
  expect(token.timezone).toBe('Australia/Brisbane')
  expect(token.heightCm).toBe(180)
  await refreshIsActiveClaim(token,async () => ({isActive:true,heightCm:undefined,sex:undefined}))
  expect(token.heightCm).toBeNull()
  expect(token.sex).toBeNull()
})
