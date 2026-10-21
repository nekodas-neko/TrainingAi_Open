// issue 2152 — GET /api/supplements/[id]/heart-response hands the card its two inputs: this
// supplement's dose logs WITH the time taken (wired through `listDoseHistory`) and each night's
// resting HR (the night's low) and HRV.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER = '00000000-0000-4000-8000-000000002152'
const RETA = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  listDoseHistory: vi.fn(),
  getOuraDailySummary: vi.fn(),
  listBodyMetrics: vi.fn(),
  getOuraCloudSwitchDay: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000002152', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => h }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { GET } from '../route'

const call = (id: string) =>
  GET(new NextRequest(`http://localhost/api/supplements/${id}/heart-response`), { params: Promise.resolve({ id }) })

describe('GET /api/supplements/[id]/heart-response (issue 2152)', () => {
  beforeEach(() => {
    h.listDoseHistory.mockReset()
    h.getOuraDailySummary.mockReset()
    h.listBodyMetrics.mockReset().mockResolvedValue([])
    h.getOuraCloudSwitchDay.mockReset().mockResolvedValue(null)
  })

  it('carries taken_at through, keeps null for the dose logged before the column existed, and filters to this supplement', async () => {
    h.listDoseHistory.mockResolvedValue({
      logs: [
        { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-07', amount: 0.5, unit: 'mg', doseText: null, takenAt: null },
        { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-13', amount: 1, unit: 'mg', doseText: null, takenAt: '2026-09-13T00:30:00.000Z' },
        { supplementId: OTHER, supplementName: 'Creatine', date: '2026-09-13', amount: 5, unit: 'g', doseText: null, takenAt: '2026-09-13T01:00:00.000Z' },
      ],
      courses: [],
    })
    h.getOuraDailySummary.mockResolvedValue([{ date: '2026-09-14', rhrLowBpm: 56.3, hrvAvgMs: 39 }, { date: '2026-09-15', rhrLowBpm: null, hrvAvgMs: null }])

    const res = await call(RETA)
    expect(res.status).toBe(200)
    expect(h.listDoseHistory.mock.calls[0][0]).toBe(USER)
    const body = await res.json()
    expect(body.doses).toEqual([
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-07', amount: 0.5, unit: 'mg', doseText: null, takenAt: null },
      { supplementId: RETA, supplementName: 'Retatrutide', date: '2026-09-13', amount: 1, unit: 'mg', doseText: null, takenAt: '2026-09-13T00:30:00.000Z' },
    ])
    expect(body.nights).toEqual([
      { date: '2026-09-14', restingHr: 56.3, hrvMs: 39, restingHrSource: 'oura_ble', hrvSource: 'oura_ble' },
      { date: '2026-09-15', restingHr: null, hrvMs: null, restingHrSource: null, hrvSource: null },
    ])
  })

  // #3077: from the switch day the ring's row is a partial leftover; the night is Oura's own value.
  it('reads the Oura value, labelled, from the switch day, and leaves earlier nights as they were', async () => {
    h.listDoseHistory.mockResolvedValue({ logs: [], courses: [] })
    h.getOuraCloudSwitchDay.mockResolvedValue('2026-10-18')
    h.getOuraDailySummary.mockResolvedValue([
      { date: '2026-10-17', rhrLowBpm: 52, hrvAvgMs: 58 },
      { date: '2026-10-18', rhrLowBpm: null, hrvAvgMs: null },
    ])
    h.listBodyMetrics.mockResolvedValue([
      { date: '2026-10-17', restingHeartRate: 80, hrvMs: 20, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' },
      { date: '2026-10-19', restingHeartRate: 55, hrvMs: 47, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' },
    ])
    const body = await (await call(RETA)).json()
    expect(body.nights).toEqual([
      { date: '2026-10-17', restingHr: 52, hrvMs: 58, restingHrSource: 'oura_ble', hrvSource: 'oura_ble' },
      { date: '2026-10-19', restingHr: 55, hrvMs: 47, restingHrSource: 'oura_cloud', hrvSource: 'oura_cloud' },
    ])
  })

  it('rejects a malformed id', async () => {
    const res = await call('not-a-uuid')
    expect(res.status).toBe(400)
  })
})
