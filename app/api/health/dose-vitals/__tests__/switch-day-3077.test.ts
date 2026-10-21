// #3077 — dose vitals after the switch to the Oura API read Oura's per-device nights, labelled;
// nights before the switch day are the ring's, unchanged.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const TZ = 'Australia/Brisbane'
const h = vi.hoisted(() => ({
  listDoseEvents: vi.fn(async () => []),
  getOuraDailySummary: vi.fn(),
  listBodyMetrics: vi.fn(),
  getOuraCloudSwitchDay: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => h }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { GET } from '../route'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

describe('GET /api/health/dose-vitals across the switch day (#3077)', () => {
  const today = todayInTz(TZ)
  const switchDay = shiftDateStr(today, -2)
  const before = shiftDateStr(today, -4)
  const after = shiftDateStr(today, -1)

  it('returns the Oura-only night after the switch day and the ring night before it', async () => {
    h.getOuraCloudSwitchDay.mockResolvedValue(switchDay)
    h.getOuraDailySummary.mockResolvedValue([
      { date: before, rhrLowBpm: 56.3, hrvAvgMs: 39, rhrBaseline: { meanX8: 423 }, hrvBaseline: { meanX8: 449 } },
      { date: switchDay, rhrLowBpm: null, hrvAvgMs: null, rhrBaseline: null, hrvBaseline: null },
    ])
    h.listBodyMetrics.mockResolvedValue([
      { date: after, restingHeartRate: 55, hrvMs: 47, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' },
    ])
    const res = await GET(new NextRequest('http://localhost/api/health/dose-vitals?days=14'))
    expect(res.status).toBe(200)
    expect((await res.json()).nights).toEqual([
      { date: before, restingHr: 56.3, hrvMs: 39, restingHrBaseline: 52.9, hrvBaseline: 56.1, restingHrSource: 'oura_ble', hrvSource: 'oura_ble' },
      { date: after, restingHr: 55, hrvMs: 47, restingHrBaseline: null, hrvBaseline: null, restingHrSource: 'oura_cloud', hrvSource: 'oura_cloud' },
    ])
  })
})
