/**
 * PS-39 — the three ring-device probes: `oura-ble/battery-latest`, `oura-ble/battery-analytics`
 * and `oura-ble/daytime-coverage`.
 *
 * Batched because they read the same ring from three angles, and because the first two sit on
 * opposite sides of the admin line **on purpose**: `battery-latest` is what the Ring Status card
 * calls, so it is owner-authed; `battery-analytics` is an R&D probe and is admin-gated. Gating the
 * first would break the card for a non-admin; leaving the second open would publish the owner's
 * telemetry. Both halves are asserted.
 *
 * What else each decides:
 *
 *   · **"Latest" means the highest timestamp, not the last row returned.** These come back from a
 *     time-range query with no ordering guarantee the route can rely on, and a stale reading
 *     presented as live is exactly what the Ring Status card exists to avoid — the Oura Cloud
 *     battery has been frozen since the 2026-07-07 re-key.
 *   · **`battery-analytics` reads two different series over ONE window** — the forward-only 0x61
 *     history and the higher-resolution keepalive polls. Two windows would silently compare
 *     different spans.
 *   · **`daytime-coverage` threads the caller's timezone**, because its whole output is
 *     hour-of-day buckets: in the wrong zone every bucket is shifted and the answer to "does the
 *     ring stream while worn-idle" is wrong in a way that still looks like data.
 *
 * Fixture discipline (the PS-39 note): the poll list is deliberately **unsorted with the newest in
 * the middle**, so "reduce to the max" and "take the last" give different answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const getOuraBatteryPolls = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getOuraBatteryEvents = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getDaytimeTagCoverage = vi.fn(async (..._a: unknown[]) => ({}) as Row)
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null =
  { id: 'u-1', isAdmin: true, timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  // One repo for both accessors — the admin gate runs for real rather than stubbed.
  const repo = async () => ({ getUserById, getOuraBatteryPolls, getOuraBatteryEvents, getDaytimeTagCoverage })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as batteryLatest } from '@/app/api/oura-ble/battery-latest/route'
import { GET as batteryAnalytics } from '@/app/api/oura-ble/battery-analytics/route'
import { GET as daytimeCoverage } from '@/app/api/oura-ble/daytime-coverage/route'

const NOW = new Date('2026-03-10T05:00:00Z')
const analytics = (qs = '') => batteryAnalytics(new Request(`http://localhost/api/oura-ble/battery-analytics${qs}`))
const coverage = (qs = '') => daytimeCoverage(new Request(`http://localhost/api/oura-ble/daytime-coverage${qs}`))

beforeEach(() => {
  for (const m of [getUserById, getOuraBatteryPolls, getOuraBatteryEvents, getDaytimeTagCoverage, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  getOuraBatteryPolls.mockResolvedValue([])
  getOuraBatteryEvents.mockResolvedValue([])
  getDaytimeTagCoverage.mockResolvedValue({ tags: [] })
  sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Australia/Brisbane' }
})
afterEach(() => { vi.useRealTimers() })

describe('GET /api/oura-ble/battery-latest', () => {
  it('is owner-authed, NOT admin-gated, because the Ring Status card calls it', async () => {
    // The asymmetry with `battery-analytics` is the design. Gating this one breaks the card for a
    // non-admin; the case below proves the sibling still refuses.
    // The DATABASE says not an admin — setting only the JWT claim would prove nothing, since
    // `requireAdmin` ignores the claim by design and the sibling would have answered 200 for the
    // wrong reason. (It did, on the first draft of this case.)
    sessionUser = { id: 'u-1', isAdmin: false }
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await batteryLatest()).status).toBe(200)
    expect(getUserById).not.toHaveBeenCalled()   // this route never asks

    expect((await analytics()).status).toBe(403)
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

describe('GET /api/oura-ble/battery-analytics', () => {
  it('reads both series over ONE window', async () => {
    // Two windows would compare different spans while still returning a plausible-looking object —
    // the 0x61 history is forward-only and the keepalive polls are higher-resolution, so they are
    // only comparable when they cover the same time.
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    await analytics('?days=5')
    const [, evFrom, evTo] = getOuraBatteryEvents.mock.calls[0] as [string, Date, Date]
    const [, pFrom, pTo] = getOuraBatteryPolls.mock.calls[0] as [string, Date, Date]
    expect(evFrom.getTime()).toBe(pFrom.getTime())
    expect(evTo.getTime()).toBe(pTo.getTime())
    expect((evTo.getTime() - evFrom.getTime()) / 86_400_000).toBe(5)
  })

  it('clamps the day window to a month and falls back to a week', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    for (const [qs, expected] of [
      ['', 7], ['?days=14', 14], ['?days=100', 30], ['?days=0', 7], ['?days=-3', 7], ['?days=abc', 7],
    ] as [string, number][]) {
      getOuraBatteryEvents.mockClear()
      await analytics(qs)
      const [, from, to] = getOuraBatteryEvents.mock.calls[0] as [string, Date, Date]
      expect((to.getTime() - from.getTime()) / 86_400_000, qs || 'default').toBe(expected)
    }
  })

  it('runs the real analyser over the events and reports how many there were', async () => {
    // `analyzeRingBattery` is left real: the arithmetic it does on these events is the point of the
    // route, and stubbing it would leave only the plumbing under test.
    const t = NOW.getTime()
    getOuraBatteryEvents.mockResolvedValue([
      { kind: 'battery_level_changed', tsMs: t - 6 * 3_600_000, batteryPct: 80 },
      { kind: 'battery_level_changed', tsMs: t - 3 * 3_600_000, batteryPct: 74 },
      { kind: 'charging_time', tsMs: t - 3_600_000, chargingTimeSec: 2_400 },
    ])
    getOuraBatteryPolls.mockResolvedValue([{ tsMs: t, percent: 74, charging: false }])
    const body = await (await analytics()).json()
    expect(body.eventCount).toBe(3)
    expect(body.days).toBe(7)
    expect(body.livePolls).toEqual([{ tsMs: t, percent: 74, charging: false }])
    // **The analyser's own output, not just the counters around it.** Asserting `eventCount` alone
    // left `analyzeRingBattery([])` surviving the mutation pass — the summary was spread into the
    // response and never read. 6% over three hours is 48%/day, and the two level samples are what
    // that rate is derived from.
    expect(body.avgDailyDrainPct).toBe(48)
    expect(body.levelSampleCount).toBe(2)
    expect(body.spanDays).toBe(0.125)
  })

  it('refuses a non-admin, answers 503 when the check cannot run, and gates before the limiter', async () => {
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await analytics()).status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()

    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    expect((await analytics()).status).toBe(503)

    getUserById.mockResolvedValue({ isAdmin: true })
    rateLimit.mockReturnValue(false)
    expect((await analytics()).status).toBe(429)
    expect(getOuraBatteryEvents).not.toHaveBeenCalled()
  })
})

describe('GET /api/oura-ble/daytime-coverage', () => {
  it("threads the caller's timezone, because the output is hour-of-day buckets", async () => {
    // In the wrong zone every bucket shifts and the answer to "does the ring stream while
    // worn-idle" is wrong while still looking like data. The fixture zone is not `DEFAULT_TZ`, so
    // the assertion can tell which was read.
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Etc/GMT+5' }
    await coverage()
    expect(getDaytimeTagCoverage).toHaveBeenCalledWith('u-1', 'Etc/GMT+5', 7)

    getDaytimeTagCoverage.mockClear()
    sessionUser = { id: 'u-1', isAdmin: true }
    await coverage()
    expect(getDaytimeTagCoverage).toHaveBeenCalledWith('u-1', DEFAULT_TZ, 7)
  })

  it('takes a positive day count and falls back on anything else — with NO upper bound', async () => {
    // Pinned as it stands rather than endorsed: unlike `battery-analytics`, which caps at 30, this
    // one accepts any positive number, so `?days=99999` scans the whole table. It is admin-only and
    // rate-limited, and the person typing the query is the one who waits for it, which is why this
    // is recorded here rather than filed — but the difference between the two neighbours is
    // deliberate-looking and is not, so a reader should find it stated.
    for (const [qs, expected] of [
      ['?days=14', 14], ['?days=99999', 99999], ['?days=0', 7], ['?days=-1', 7], ['?days=abc', 7], ['', 7],
    ] as [string, number][]) {
      getDaytimeTagCoverage.mockClear()
      await coverage(qs)
      expect(getDaytimeTagCoverage.mock.calls[0][2], qs || 'default').toBe(expected)
    }
  })

  it('returns the coverage unchanged, and refuses a non-admin before the limiter', async () => {
    getDaytimeTagCoverage.mockResolvedValue({ tags: [{ tag: 126, hours: [0, 0, 3] }] })
    expect(await (await coverage()).json()).toEqual({ tags: [{ tag: 126, hours: [0, 0, 3] }] })

    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await coverage()).status).toBe(403)
    expect(rateLimit).toHaveBeenCalledTimes(1)   // only the successful call above spent one
  })
})
