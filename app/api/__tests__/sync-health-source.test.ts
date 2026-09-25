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

describe('aggregate health source attribution', () => {
  it.each([undefined, 'health_connect', 'apple_health'])('attributes daily imports from %s', async source => {
    const response = await post({ source, dailyMetrics: [{ date: '2026-09-24', steps: 500 }] })
    expect(response.status).toBe(200)
    expect(repo.upsertBodyMetrics).toHaveBeenCalledWith('u1', [expect.objectContaining({ steps: 500 })], source ?? 'health_connect')
  })
  it.each([undefined, 'health_connect', 'apple_health'])('attributes sleep imports from %s', async source => {
    const response = await post({ source, sleepRecords: [{
      date: '2026-09-24', sleepStart: '2026-09-23T23:00:00+10:00',
      sleepEnd: '2026-09-24T07:00:00+10:00', durationHours: 7.5,
    }] })
    expect(response.status).toBe(200)
    expect(repo.saveSleepSession.mock.calls[0][2]).toBe(source ?? 'health_connect')
  })
  it.each(['manual', 'oura_ble', 'unknown', null, 1])('rejects invalid or privileged source %s before writes', async source => {
    const response = await post({ source, dailyMetrics: [{ date: '2026-09-24', steps: 500 }] })
    expect(response.status).toBe(400)
    expect(repo.upsertBodyMetrics).not.toHaveBeenCalled()
    expect(repo.saveSleepSession).not.toHaveBeenCalled()
  })
})
