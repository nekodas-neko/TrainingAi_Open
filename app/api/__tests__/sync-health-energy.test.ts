import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const repo = vi.hoisted(() => ({
  listActivityLogs: vi.fn(async () => []),
  upsertBodyMetrics: vi.fn<(userId: string, rows: Record<string, unknown>[], source: string) => Promise<void>>(),
  saveSleepSession: vi.fn<(userId: string, row: Record<string, unknown>, source: string) => Promise<void>>(),
}))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => repo) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))
import { POST } from '@/app/api/sync-health/route'

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/sync-health', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}))
beforeEach(() => {
  vi.clearAllMocks()
  repo.upsertBodyMetrics.mockResolvedValue(undefined)
  repo.saveSleepSession.mockResolvedValue(undefined)
})

describe('explicit active energy imports', () => {
  it('keeps legacy Android total energy out of active energy and food intake', async () => {
    const response = await post({ dailyMetrics: [{ date: '2026-09-24', caloriesBurned: 2400, steps: 5000 }] })
    expect(response.status).toBe(200)
    const row = repo.upsertBodyMetrics.mock.calls[0][1][0]
    expect(row.activeCalories).toBeUndefined()
    expect(row.calories).toBeUndefined()
  })
  it('forwards active energy independently of food and total energy', async () => {
    const response = await post({ dailyMetrics: [{ date: '2026-09-24', activeCalories: 410.5, calories: 1800, caloriesBurned: 2400 }] })
    expect(response.status).toBe(200)
    expect(repo.upsertBodyMetrics).toHaveBeenCalledWith('u1', [expect.objectContaining({ activeCalories: 410.5, calories: 1800 })], 'health_connect')
  })
  it('preserves zero and leaves omitted active energy undefined', async () => {
    const response = await post({ dailyMetrics: [{ date: '2026-09-24', activeCalories: 0 }, { date: '2026-09-23', steps: 500 }] })
    expect(response.status).toBe(200)
    const rows = repo.upsertBodyMetrics.mock.calls[0][1]
    expect(rows[0].activeCalories).toBe(0)
    expect(rows[1].activeCalories).toBeUndefined()
  })
  it.each([-1, 20001, null, '100'])('rejects invalid active energy %s before writes', async activeCalories => {
    const response = await post({ dailyMetrics: [{ date: '2026-09-24', activeCalories }] })
    expect(response.status).toBe(400)
    expect(repo.upsertBodyMetrics).not.toHaveBeenCalled()
  })
})
