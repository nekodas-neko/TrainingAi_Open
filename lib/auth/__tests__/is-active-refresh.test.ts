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

  it('propagates an outage so it cannot be confused with an invalid login', async () => {
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: 0 }
    await expect(
      refreshIsActiveClaim(token, async () => { throw new Error('db down') }, NOW),
    ).rejects.toThrow('db down')
    expect(token.isActive).toBe(true)
    expect(token.isActiveCheckedAt).toBe(0)
  })

  it('treats a DELETED user row as deactivation (RV-195 ②)', async () => {
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => null, NOW)
    expect(token.isActive).toBe(false)
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
