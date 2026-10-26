// The ring-battery read (#3069): auth, rate limit, and the shared calculation over the stored readings.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.fn<() => Promise<{ user: { id: string; timezone?: string } } | null>>()
const rateLimit = vi.fn(() => true)
const getRingBatteryReadings = vi.fn()
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({ getRingBatteryReadings }) }))

import { GET } from '../ring-battery/route'

describe('GET /api/oura/ring-battery', () => {
  beforeEach(() => {
    authMock.mockReset(); getRingBatteryReadings.mockReset(); rateLimit.mockReset()
    rateLimit.mockReturnValue(true)
    authMock.mockResolvedValue({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })
  })

  it('refuses a request with no session, and a rate-limited one', async () => {
    authMock.mockResolvedValueOnce(null)
    expect((await GET()).status).toBe(401)
    rateLimit.mockReturnValueOnce(false)
    expect((await GET()).status).toBe(429)
    expect(getRingBatteryReadings).not.toHaveBeenCalled()
  })

  it('answers the newest reading and its age, never cached', async () => {
    getRingBatteryReadings.mockResolvedValue([{ tsMs: Date.now() - 14 * 60_000, percent: 64, charging: false }])
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.latest).toMatchObject({ percent: 64, charging: false, ageMinutes: 14 })
    expect(body.daysLeft).toBeNull()
    expect(getRingBatteryReadings.mock.calls[0][0]).toBe('u1')
  })

  it('answers latest: null when no reading is stored', async () => {
    getRingBatteryReadings.mockResolvedValue([])
    expect((await (await GET()).json()).latest).toBeNull()
  })
})
