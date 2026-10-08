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
      { date: '2026-09-14', restingHr: 56.3, hrvMs: 39 },
      { date: '2026-09-15', restingHr: null, hrvMs: null },
    ])
  })

  it('rejects a malformed id', async () => {
    const res = await call('not-a-uuid')
    expect(res.status).toBe(400)
  })
})
