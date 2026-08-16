// The day-review route exposes a full health-data export, so its two auth paths are the whole
// security surface. These lock in the properties that matter: the bearer path is disabled unless
// BOTH env vars are set (fail closed, never "skip the check when unconfigured"), a token identifies
// a caller but never grants authority (the resolved user must still be an admin), and the range
// bounds hold so one request can't fan 12 queries × N days at the pg pool.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authMock = vi.fn(async () => null as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const getUserById = vi.fn(async () => ({ id: 'admin-1', isAdmin: true, timezone: 'Australia/Brisbane' }))
vi.mock('@/lib/data', () => ({
  getRepository: vi.fn(async () => ({ getUserById })),
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

const buildDayAudit = vi.fn(async ({ date }: { date: string }) => ({
  date, timezone: 'Australia/Brisbane', generatedAt: '2026-07-26T00:00:00.000Z',
  historyWindowDays: 28,
  pillars: [{ pillar: 'sleep', label: 'Sleep', score: 82, model: { weights: { totalSleep: 28 } } }],
  context: {}, warnings: [],
}))
vi.mock('@trainingai/shared/health/score-audit/build-day-audit', () => ({ buildDayAudit: (o: never) => buildDayAudit(o) }))

import { GET } from '@/app/api/admin/day-review/route'
import { NextRequest } from 'next/server'

const SECRET = 'a-very-secret-token-value'

function get(url: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(new Request(`http://x${url}`, { headers })))
}
const withToken = (t: string) => ({ authorization: `Bearer ${t}` })

describe('GET /api/admin/day-review — auth', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(null)
    buildDayAudit.mockClear()
    getUserById.mockReset().mockResolvedValue({ id: 'admin-1', isAdmin: true, timezone: 'Australia/Brisbane' })
    process.env.ADMIN_EXPORT_SECRET = SECRET
    process.env.ADMIN_EXPORT_USER_ID = 'admin-1'
  })
  afterEach(() => {
    delete process.env.ADMIN_EXPORT_SECRET
    delete process.env.ADMIN_EXPORT_USER_ID
    delete process.env.WEBHOOK_USER_ID
  })

  it('401s with no session and no token', async () => {
    expect((await get('/api/admin/day-review?date=2026-07-24')).status).toBe(401)
  })

  it('accepts a correct bearer token', async () => {
    const res = await get('/api/admin/day-review?date=2026-07-24', withToken(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ date: '2026-07-24' })
  })

  it('401s on a wrong token of the same length', async () => {
    const wrong = 'b'.repeat(SECRET.length)
    expect((await get('/api/admin/day-review?date=2026-07-24', withToken(wrong))).status).toBe(401)
  })

  it('401s on a wrong token of a different length', async () => {
    expect((await get('/api/admin/day-review?date=2026-07-24', withToken('x'))).status).toBe(401)
  })

  it('fails CLOSED when ADMIN_EXPORT_SECRET is unset — the token path is disabled, not skipped', async () => {
    delete process.env.ADMIN_EXPORT_SECRET
    expect((await get('/api/admin/day-review?date=2026-07-24', withToken(SECRET))).status).toBe(401)
  })

  it('fails CLOSED when no export user id is configured', async () => {
    delete process.env.ADMIN_EXPORT_USER_ID
    expect((await get('/api/admin/day-review?date=2026-07-24', withToken(SECRET))).status).toBe(401)
  })

  it('falls back to WEBHOOK_USER_ID when ADMIN_EXPORT_USER_ID is unset', async () => {
    delete process.env.ADMIN_EXPORT_USER_ID
    process.env.WEBHOOK_USER_ID = 'admin-1'
    expect((await get('/api/admin/day-review?date=2026-07-24', withToken(SECRET))).status).toBe(200)
  })

  it('403s when the token resolves to a non-admin — a token widens transport, never authority', async () => {
    getUserById.mockResolvedValue({ id: 'admin-1', isAdmin: false, timezone: 'Australia/Brisbane' })
    expect((await get('/api/admin/day-review?date=2026-07-24', withToken(SECRET))).status).toBe(403)
  })

  it('403s a signed-in non-admin session', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', isAdmin: true } })
    getUserById.mockResolvedValue({ id: 'u2', isAdmin: false, timezone: 'Australia/Brisbane' })
    expect((await get('/api/admin/day-review?date=2026-07-24')).status).toBe(403)
  })

  it('ignores a malformed Authorization header and falls through to the session check', async () => {
    expect((await get('/api/admin/day-review?date=2026-07-24', { authorization: SECRET })).status).toBe(401)
  })
})

describe('GET /api/admin/day-review — date handling', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(null)
    buildDayAudit.mockClear()
    getUserById.mockReset().mockResolvedValue({ id: 'admin-1', isAdmin: true, timezone: 'Australia/Brisbane' })
    process.env.ADMIN_EXPORT_SECRET = SECRET
    process.env.ADMIN_EXPORT_USER_ID = 'admin-1'
  })
  afterEach(() => {
    delete process.env.ADMIN_EXPORT_SECRET
    delete process.env.ADMIN_EXPORT_USER_ID
  })

  it('accepts both separators and normalises to the dash form the assembler needs', async () => {
    await get('/api/admin/day-review?date=2026/07/24', withToken(SECRET))
    expect(buildDayAudit).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-07-24' }))
  })

  it('400s an impossible calendar date rather than building an Invalid Date', async () => {
    expect((await get('/api/admin/day-review?date=2026-06-31', withToken(SECRET))).status).toBe(400)
    expect(buildDayAudit).not.toHaveBeenCalled()
  })

  it('walks every day in a range and hoists the shared model block', async () => {
    const res = await get('/api/admin/day-review?from=2026-07-20&to=2026-07-24', withToken(SECRET))
    expect(res.status).toBe(200)
    expect(buildDayAudit).toHaveBeenCalledTimes(5)

    const body = await res.json()
    expect(body.days.map((d: { date: string }) => d.date))
      .toEqual(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'])
    // Model constants appear once at the top, not repeated on every day.
    expect(body.models.sleep).toBeTruthy()
    expect(body.days[0].pillars[0].model).toBeUndefined()
  })

  it('400s a range wider than the cap instead of fanning queries at the pool', async () => {
    const res = await get('/api/admin/day-review?from=2026-06-01&to=2026-07-24', withToken(SECRET))
    expect(res.status).toBe(400)
    expect(buildDayAudit).not.toHaveBeenCalled()
  })

  it('400s when `to` precedes `from`', async () => {
    const res = await get('/api/admin/day-review?from=2026-07-24&to=2026-07-20', withToken(SECRET))
    expect(res.status).toBe(400)
    expect(buildDayAudit).not.toHaveBeenCalled()
  })

  it('returns a bare day object (not a range envelope) for a single day', async () => {
    const res = await get('/api/admin/day-review?from=2026-07-24&to=2026-07-24', withToken(SECRET))
    const body = await res.json()
    expect(body.days).toBeUndefined()
    expect(body.date).toBe('2026-07-24')
  })
})
