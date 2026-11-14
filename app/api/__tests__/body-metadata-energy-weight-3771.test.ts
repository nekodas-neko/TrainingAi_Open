// #3771. The active-energy estimate takes the last-known weight from the 180-day read, and when that
// read fails it fell back to `metrics.find(m => m.weightKg != null)`: the first row with a weight in
// the 7-day list, which is the latest only while the list arrives newest first. The fallback now
// picks by date (`latestWeightKg`).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { bodyRecentFromDay } from '@trainingai/shared/health/body-recent-window'

const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const recentFrom = bodyRecentFromDay(today)

const state = vi.hoisted(() => ({ rows: [] as { date: string; weightKg?: number; steps?: number }[] }))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ, dateOfBirth: '1990-01-01', sex: 'male' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    // The 7-day read answers in the order the test set. Any wider read (the weight history) fails,
    // which is the only case the fallback runs in.
    listBodyMetrics: async (_u: string, from: string) => {
      if (from < recentFrom) throw new Error('weight history unavailable')
      return state.rows
    },
    listFoodLogs:           async () => [],
    listActivityLogs:       async () => [],
    listFoodLogsSummary:    async () => [],
    getWorkoutSessionsFrom: async () => [],
    getBodyFatCalibration:  async () => null,
    getAvgBpmBySession:     async () => new Map(),
  }),
}))

import { GET } from '@/app/api/body-metadata/route'

// Enough steps that the passive-steps part of the estimate is above zero and scales with weight.
const TODAY_STEPS = { date: today, steps: 15_000 }
const OLDEST = { date: shiftDateStr(today, -5), weightKg: 95 }
const MIDDLE = { date: shiftDateStr(today, -3), weightKg: 85 }
const LATEST = { date: shiftDateStr(today, -1), weightKg: 75 }

async function activeEnergy(rows: typeof state.rows) {
  state.rows = rows
  const res = await GET(new NextRequest('http://localhost/api/body-metadata'))
  expect(res.status).toBe(200)
  return ((await res.json()) as { activeEnergyKcalToday: number }).activeEnergyKcalToday
}

describe('#3771 the active-energy fallback weight is the latest by date', () => {
  beforeEach(() => { state.rows = [] })

  it('chooses the same weight with the rows newest first and oldest first', async () => {
    const fromLatestOnly = await activeEnergy([TODAY_STEPS, LATEST])
    expect(fromLatestOnly).toBeGreaterThan(0)
    expect(await activeEnergy([TODAY_STEPS, LATEST, MIDDLE, OLDEST])).toBe(fromLatestOnly)
    expect(await activeEnergy([OLDEST, MIDDLE, LATEST, TODAY_STEPS])).toBe(fromLatestOnly)
  })

  // Without this the test above would pass on an estimate that ignored weight.
  it('and the weight does move the estimate', async () => {
    expect(await activeEnergy([TODAY_STEPS, OLDEST])).not.toBe(await activeEnergy([TODAY_STEPS, LATEST]))
  })
})
