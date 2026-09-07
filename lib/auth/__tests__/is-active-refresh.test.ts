import { describe, it, expect, vi } from 'vitest'
import { refreshIsActiveClaim, ISACTIVE_RECHECK_MS } from '../is-active-refresh'

const NOW = 1_800_000_000_000
const active = async () => ({ isActive: true })
const deactivated = async () => ({ isActive: false })

describe('refreshIsActiveClaim', () => {
  it('picks up a deactivation once the recheck is due', async () => {
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: NOW - ISACTIVE_RECHECK_MS - 1 }
    await refreshIsActiveClaim(token, deactivated, NOW)
    expect(token.isActive).toBe(false)
    expect(token.isActiveCheckedAt).toBe(NOW)
  })

  it('does not hit the lookup before the recheck is due', async () => {
    // The jwt callback runs on every auth() call, so an unthrottled read would be a
    // DB query per request — this throttle is the whole reason the approach is viable.
    const lookup = vi.fn(deactivated)
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: NOW - 1000 }
    await refreshIsActiveClaim(token, lookup, NOW)
    expect(lookup).not.toHaveBeenCalled()
    expect(token.isActive).toBe(true)
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

  it('leaves the claim alone when the lookup throws, and does not advance the timestamp', async () => {
    // A DB blip must never sign everyone out, and must not suppress the retry for a day.
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: 0 }
    await expect(
      refreshIsActiveClaim(token, async () => { throw new Error('db down') }, NOW),
    ).resolves.toBeDefined()
    expect(token.isActive).toBe(true)
    expect(token.isActiveCheckedAt).toBe(0)
  })

  it('treats a missing user row as no evidence, and retries next request', async () => {
    const token = { userId: 'u1', isActive: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => null, NOW)
    expect(token.isActive).toBe(true)
    expect(token.isActiveCheckedAt).toBe(0) // not advanced — next request tries again
  })

  it('does nothing without a userId', async () => {
    const lookup = vi.fn(deactivated)
    await refreshIsActiveClaim({ isActive: true }, lookup, NOW)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('a continuously-active user is re-checked about once a day, not signed out', async () => {
    // Walks a week of steady use one hour at a time: the claim stays true throughout
    // (no re-auth, no interruption) and the lookup fires roughly daily, not hourly.
    const lookup = vi.fn(active)
    const token: { userId?: string; isActive?: boolean; isActiveCheckedAt?: number } =
      { userId: 'u1', isActive: true, isActiveCheckedAt: NOW }
    for (let h = 1; h <= 24 * 7; h++) {
      await refreshIsActiveClaim(token, lookup, NOW + h * 60 * 60 * 1000)
      expect(token.isActive).toBe(true)
    }
    expect(lookup).toHaveBeenCalledTimes(7)
  })

  // ── isAdmin, added 2026-08-10 alongside the ADMIN_EMAIL boot grant ───────────────────────────
  it('picks up an admin grant made after the token was minted', async () => {
    // The exact bootstrapAdmin case: the row is created by sign-in with is_admin false, and the
    // boot grant flips it afterwards. Without this the admin UI stays hidden until re-login.
    const token = { userId: 'u1', isActive: true, isAdmin: false, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => ({ isActive: true, isAdmin: true }), NOW)
    expect(token.isAdmin).toBe(true)
  })

  it('picks up an admin revocation, which is the direction that matters', async () => {
    const token = { userId: 'u1', isActive: true, isAdmin: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => ({ isActive: true, isAdmin: false }), NOW)
    expect(token.isAdmin).toBe(false)
  })

  it('leaves the claim alone when the lookup does not supply isAdmin', async () => {
    // A lookup that omits the field says nothing about it. Treating absent as false would strip
    // admin from every session the moment any caller passed a narrower row.
    const token = { userId: 'u1', isActive: true, isAdmin: true, isActiveCheckedAt: 0 }
    await refreshIsActiveClaim(token, async () => ({ isActive: true }), NOW)
    expect(token.isAdmin).toBe(true)
  })
})

// ── PS-24: the throttle that never engages, and why that is now load-bearing ─────────────────
//
// The checkpoint filed "every authenticated request performs the once-per-day users-row read" as a
// cost. It is, but it is also the only reason PS-24's fix works, so it must not be "optimised".
//
// `isActiveCheckedAt` lives in the token. The token is re-signed by the Edge middleware from the
// cookie on every request, and the cookie never carries the stamp — so every request arrives with
// an unstamped token and the throttle cannot fire. Making it persist would restore a staleness
// window of `ISACTIVE_RECHECK_MS`, which is exactly the vulnerability `auth()`'s refusal closes.
//
// If a future change makes the stamp survive, `ISACTIVE_RECHECK_MS` becomes the deactivation
// latency again and that trade needs deciding on purpose, not inheriting.
describe('the per-request read PS-24 depends on', () => {
  it('fires on every request, because the stamp never arrives with the token', async () => {
    let reads = 0
    const lookup = async () => { reads++; return { isActive: false, isAdmin: false } }
    for (let i = 0; i < 3; i++) {
      // What actually reaches the callback: the claim as stamped at sign-in, and no stamp.
      const fromCookie: { userId: string; isActive: boolean; isActiveCheckedAt?: number } =
        { userId: 'u1', isActive: true }
      const token = await refreshIsActiveClaim(fromCookie, lookup)
      expect(token.isActive).toBe(false)
    }
    expect(reads, 'a persisted stamp would make this 1 and reintroduce a day of staleness').toBe(3)
  })

  it('and the same read keeps isAdmin fresh for every Node caller', async () => {
    // So the checkpoint's "an isAdmin revocation never reaches a live session" holds only for the
    // Edge middleware, which does not read isAdmin at all. Anything going through `auth()` — every
    // route handler and server component — gets the row's value.
    const fromCookie = { userId: 'u1', isActive: true, isAdmin: true }
    const token = await refreshIsActiveClaim(fromCookie, async () => ({ isActive: true, isAdmin: false }))
    expect(token.isAdmin).toBe(false)
  })
})
