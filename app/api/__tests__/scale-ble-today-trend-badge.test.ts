// Q-69: the "Trend" badge in Settings → Scale used to be `isTrend: i === 0` — the first reading in
// the day's list. That was only correct while first-wins held. Now the day's LOWEST reading owns the
// trend, so the badge has to be resolved by matching the value actually stored in body_metrics.
//
// Worth a route test rather than a unit one: the bug this guards is the badge and the stored value
// disagreeing, and that only shows up when both come from the route together.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listConfirmedScaleSamplesForDate = vi.fn()
const getConfirmedScaleTrendForDate = vi.fn()

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({
    getUserById: vi.fn(async () => ({ timezone: 'Australia/Brisbane' })),
    listConfirmedScaleSamplesForDate,
    getConfirmedScaleTrendForDate,
  })),
}))

import { GET } from '@/app/api/scale-ble/today/route'

/** Two readings, oldest first — a clothed morning one and a lower nude one later. */
const readings = (...weights: number[]) =>
  weights.map((weightKg, i) => ({
    id: i + 1,
    measuredAt: new Date(`2026-07-29T0${i}:00:00Z`),
    decoded: { weightKg },
  }))

const trendFlags = async (): Promise<boolean[]> => {
  const res = await GET()
  const body = await res.json() as { readings: { isTrend: boolean }[] }
  return body.readings.map(r => r.isTrend)
}

describe('GET /api/scale-ble/today — which reading carries the Trend badge', () => {
  beforeEach(() => {
    listConfirmedScaleSamplesForDate.mockReset()
    getConfirmedScaleTrendForDate.mockReset()
  })

  it('badges the LOWER later reading, not the first — the case that broke the old rule', async () => {
    listConfirmedScaleSamplesForDate.mockResolvedValue(readings(84.1, 82.4))
    getConfirmedScaleTrendForDate.mockResolvedValue({ weightKg: 82.4 })
    expect(await trendFlags()).toEqual([false, true])
  })

  it('still badges the first reading on an ordinary day', async () => {
    // Fasted morning first, heavier evening after food — the common case, unchanged.
    listConfirmedScaleSamplesForDate.mockResolvedValue(readings(82.4, 83.9))
    getConfirmedScaleTrendForDate.mockResolvedValue({ weightKg: 82.4 })
    expect(await trendFlags()).toEqual([true, false])
  })

  it('badges exactly one row when two readings tie on weight', async () => {
    // Badging both would claim the trend came from two places.
    listConfirmedScaleSamplesForDate.mockResolvedValue(readings(82.4, 82.4))
    getConfirmedScaleTrendForDate.mockResolvedValue({ weightKg: 82.4 })
    expect(await trendFlags()).toEqual([true, false])
  })

  it('badges nothing when the day\'s weight is not from the scale', async () => {
    // A manual entry outranks scale_ble, so no listed reading is the trend. The old code would
    // have badged the first reading regardless and claimed it set a value it did not.
    listConfirmedScaleSamplesForDate.mockResolvedValue(readings(84.1, 82.4))
    getConfirmedScaleTrendForDate.mockResolvedValue(null)
    expect(await trendFlags()).toEqual([false, false])
  })

  it('badges nothing when no reading matches the stored value', async () => {
    // Defensive: the stored trend and the archived readings disagreeing is a real fault, and the
    // honest render is no badge rather than an arbitrary one.
    listConfirmedScaleSamplesForDate.mockResolvedValue(readings(84.1, 83.0))
    getConfirmedScaleTrendForDate.mockResolvedValue({ weightKg: 71.0 })
    expect(await trendFlags()).toEqual([false, false])
  })

  it('returns an empty list without error when nothing was weighed', async () => {
    listConfirmedScaleSamplesForDate.mockResolvedValue([])
    getConfirmedScaleTrendForDate.mockResolvedValue(null)
    expect(await trendFlags()).toEqual([])
  })
})
