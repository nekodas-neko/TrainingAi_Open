// Issue 2093 — the gates on the heart-health re-score route, without a database: admin only,
// strict Zod query, 31-day cap, rate limit, dry run unless `dryRun=false`, and today is never
// re-scored. The rule and the write are the service's (lib/health/__tests__/heart-health-service.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const session = vi.hoisted(() => ({ value: null as null | { user: { id: string; timezone: string; isAdmin: boolean } } }))
const repo = vi.hoisted(() => ({ getUserById: vi.fn() }))
const rescore = vi.hoisted(() => vi.fn())
const limited = vi.hoisted(() => ({ value: true }))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.value) }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => repo) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => limited.value) }))
vi.mock('@/lib/health/heart-health-service', () => ({ rescoreHeartHealth: rescore }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const post = async (qs: string) => {
  const { POST } = await import('../route')
  const { NextRequest } = await import('next/server')
  return POST(new NextRequest(`http://localhost/api/admin/backfill-heart-health?${qs}`, { method: 'POST' }))
}

describe('POST /api/admin/backfill-heart-health (issue 2093)', () => {
  const today = todayInTz(TZ)
  const yesterday = shiftDateStr(today, -1)
  const d = (n: number) => shiftDateStr(today, n)

  beforeEach(() => {
    session.value = { user: { id: 'u1', timezone: TZ, isAdmin: true } }
    repo.getUserById.mockReset().mockResolvedValue({ id: 'u1', isAdmin: true })
    rescore.mockReset().mockResolvedValue({ days: [], changes: [], written: 0 })
    limited.value = true
  })

  it('401 without a session, and nothing runs', async () => {
    session.value = null
    expect((await post(`from=${d(-5)}&to=${d(-3)}`)).status).toBe(401)
    expect(rescore).not.toHaveBeenCalled()
  })

  it('403 for a non-admin, judged by the database and not the token flag', async () => {
    repo.getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })
    expect((await post(`from=${d(-5)}&to=${d(-3)}`)).status).toBe(403)
    expect(rescore).not.toHaveBeenCalled()
  })

  it('429 once the rate limit is spent', async () => {
    limited.value = false
    expect((await post(`from=${d(-5)}&to=${d(-3)}`)).status).toBe(429)
    expect(rescore).not.toHaveBeenCalled()
  })

  it.each([
    ['missing from', `to=${d(-3)}`],
    ['not a date', `from=yesterday&to=${d(-3)}`],
    ['a date-shaped non-date', `from=2026-13-45&to=2026-13-46`],
    ['an unknown parameter', `from=${d(-5)}&to=${d(-3)}&userId=someone-else`],
    ['a dryRun that is neither true nor false', `from=${d(-5)}&to=${d(-3)}&dryRun=0`],
    ['to before from', `from=${d(-3)}&to=${d(-5)}`],
    ['a 32-day range', `from=${d(-40)}&to=${d(-9)}`],
  ])('400 for %s, and nothing runs', async (_name, qs) => {
    expect((await post(qs)).status).toBe(400)
    expect(rescore).not.toHaveBeenCalled()
  })

  it('accepts a 31-day range, and slash dates', async () => {
    const res = await post(`from=${d(-40).replace(/-/g, '/')}&to=${d(-10)}`)
    expect(res.status).toBe(200)
    expect(rescore).toHaveBeenCalledWith(expect.anything(), 'u1', TZ, d(-40), d(-10), { write: false })
  })

  it('is a dry run by default and for anything but an explicit dryRun=false', async () => {
    await post(`from=${d(-5)}&to=${d(-3)}`)
    await post(`from=${d(-5)}&to=${d(-3)}&dryRun=true`)
    expect(rescore.mock.calls.map(c => c[5].write)).toEqual([false, false])
  })

  it('writes only on dryRun=false, for the session user, and reports what moved', async () => {
    rescore.mockResolvedValue({
      days: [{ date: d(-4), status: 'pending', targetMin: 25, countedMin: 31, met: true, activities: [] }],
      changes: [{ date: d(-4), runId: 'r', activityLogId: 'l', completedAs: 'walk', countedMin: 31, targetMin: 25 }],
      written: 1,
    })
    const body = await (await post(`from=${d(-5)}&to=${d(-3)}&dryRun=false`)).json()
    expect(body).toMatchObject({ dryRun: false, summary: { wouldComplete: 1, written: 1 } })
    expect(rescore).toHaveBeenCalledWith(expect.anything(), 'u1', TZ, d(-5), d(-3), { write: true })
  })

  it('never reaches today: a range ending today or later is cut to yesterday', async () => {
    const body = await (await post(`from=${d(-2)}&to=${today}`)).json()
    expect(body.to).toBe(yesterday)
    expect(rescore).toHaveBeenCalledWith(expect.anything(), 'u1', TZ, d(-2), yesterday, { write: false })
  })

  it('a service failure is a 500 with no detail', async () => {
    rescore.mockRejectedValue(new Error('boom: secret detail'))
    const res = await post(`from=${d(-5)}&to=${d(-3)}&dryRun=false`)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
