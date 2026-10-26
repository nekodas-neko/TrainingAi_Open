/**
 * PS-39 — the ring-battery read the Ring Status card calls, `oura-ble/battery-latest`.
 * (`battery-analytics` and `daytime-coverage`, the two admin R&D probes that shared this file, were
 * retired in #2862.)
 *
 * It is owner-authed, not admin-gated, because the card calls it for any signed-in user.
 *
 * What else it decides:
 *
 *   · **"Latest" means the highest timestamp, not the last row returned.** These come back from a
 *     time-range query with no ordering guarantee the route can rely on, and a stale reading
 *     presented as live is exactly what the Ring Status card exists to avoid — the Oura Cloud
 *     battery has been frozen since the 2026-07-07 re-key.
 *
 * Fixture discipline (the PS-39 note): the poll list is deliberately **unsorted with the newest in
 * the middle**, so "reduce to the max" and "take the last" give different answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isActive: true, isAdmin: true }) as Row | null)
const getOuraBatteryPolls = vi.fn(async (..._a: unknown[]) => [] as Row[])
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null =
  { id: 'u-1', isAdmin: true, timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getUserById, getOuraBatteryPolls })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as batteryLatest } from '@/app/api/oura-ble/battery-latest/route'

const NOW = new Date('2026-03-10T05:00:00Z')

beforeEach(() => {
  for (const m of [getUserById, getOuraBatteryPolls, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isActive: true, isAdmin: true })
  getOuraBatteryPolls.mockResolvedValue([])
  sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Australia/Brisbane' }
})
afterEach(() => { vi.useRealTimers() })

describe('GET /api/oura-ble/battery-latest', () => {
  it('is owner-authed, NOT admin-gated, because the Ring Status card calls it', async () => {
    // Gating this one breaks the card for a non-admin. (Its admin-gated sibling, `battery-analytics`,
    // was retired in #2862.)
    sessionUser = { id: 'u-1', isAdmin: false }
    getUserById.mockResolvedValue({ isActive: true, isAdmin: false })
    expect((await batteryLatest()).status).toBe(200)
    expect(getUserById).not.toHaveBeenCalled()   // this route never asks
  })

  it('picks the highest timestamp, not the last row the query happened to return', async () => {
    // **Unsorted, newest in the MIDDLE.** A time-range query gives no ordering the route can rely
    // on, and with the newest last, `reduce` to the max and "take the last" agree — the rule would
    // go untested. Presenting a stale reading as live is the whole thing the card exists to avoid.
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    const t = NOW.getTime()
    getOuraBatteryPolls.mockResolvedValue([
      { tsMs: t - 90 * 60_000, percent: 71, charging: false },
      { tsMs: t - 15 * 60_000, percent: 68, charging: true },   // newest, and not last
      { tsMs: t - 40 * 60_000, percent: 70, charging: false },
    ])
    const body = await (await batteryLatest()).json()
    expect(body.latest).toEqual({ percent: 68, charging: true, tsMs: t - 15 * 60_000, ageMinutes: 15 })
  })

  it('answers a null reading rather than an error when nothing is live', async () => {
    // The card renders "unknown" from this. A 404 or a 500 would make a quiet ring look broken.
    const res = await batteryLatest()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ latest: null })
  })

  it('asks for a three-day window, because older than that is not "live"', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    await batteryLatest()
    const [userId, from, to] = getOuraBatteryPolls.mock.calls[0] as [string, Date, Date]
    expect(userId).toBe('u-1')
    expect(to.getTime()).toBe(NOW.getTime())
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(3)
  })

  it('refuses without a session and over its rate limit', async () => {
    sessionUser = null
    expect((await batteryLatest()).status).toBe(401)
    expect(rateLimit).not.toHaveBeenCalled()

    sessionUser = { id: 'u-1' }
    rateLimit.mockReturnValue(false)
    expect((await batteryLatest()).status).toBe(429)
    expect(getOuraBatteryPolls).not.toHaveBeenCalled()
  })
})
