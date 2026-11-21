// #3893 — the session read replay's gates, without a database: admin only, strict Zod query, 31-day
// cap, rate limit, dry run only (dryRun=false refused), scoped to the session user, counts only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import type { SessionReadLog } from '@trainingai/shared/ai-periodization/session-read'

const TZ = 'Australia/Brisbane'
const session = vi.hoisted(() => ({ value: null as null | { user: { id: string; timezone: string; isAdmin: boolean } } }))
const repo = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getSessionReadLogs: vi.fn(async () => [] as unknown[]),
  getExerciseEquipment: vi.fn(async () => ({}) as Record<string, string[]>),
}))
const limited = vi.hoisted(() => ({ value: true }))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.value) }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => repo) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => limited.value) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const post = async (qs: string) => {
  const { POST } = await import('../route')
  const { NextRequest } = await import('next/server')
  return POST(new NextRequest(`http://localhost/api/admin/session-read-replay?${qs}`, { method: 'POST' }))
}

const set = (setNumber: number, reps: number, restTimeSec = 120) => ({
  setNumber, reps, weightKg: 80, plannedReps: 8, plannedWeightKg: 80, plannedPct: 80,
  restTimeSec, plannedRestSec: 120, rpe: null, rpeSource: null, hr: null,
})
const log = (sets: ReturnType<typeof set>[]): SessionReadLog => ({
  exerciseLogId: 'el', workoutSessionId: 'ws', programSessionId: 'ps', exerciseName: 'Bench Press',
  loggedAt: new Date(), estimated1rm: 95, exerciseDeloaded: false, exerciseType: 'weighted',
  session: { completed: true, isEarlyDeload: false, wasOverride: false, intensityMode: 'full', phaseType: 'normal', hrDense: null },
  effortVsPlan: null, effortSource: null, sets,
})

describe('POST /api/admin/session-read-replay (#3893)', () => {
  const d = (n: number) => shiftDateStr(todayInTz(TZ), n)

  beforeEach(() => {
    session.value = { user: { id: 'u1', timezone: TZ, isAdmin: true } }
    repo.getUserById.mockReset().mockResolvedValue({ id: 'u1', isActive: true, isAdmin: true })
    repo.getSessionReadLogs.mockReset().mockResolvedValue([])
    repo.getExerciseEquipment.mockReset().mockResolvedValue({ 'Bench Press': ['barbell'] })
    limited.value = true
  })

  it('401 without a session, and nothing is read', async () => {
    session.value = null
    expect((await post(`from=${d(-5)}&to=${d(-3)}`)).status).toBe(401)
    expect(repo.getSessionReadLogs).not.toHaveBeenCalled()
  })

  it('403 for a non-admin, judged by the database and not the token flag', async () => {
    repo.getUserById.mockResolvedValue({ id: 'u1', isActive: true, isAdmin: false })
    expect((await post(`from=${d(-5)}&to=${d(-3)}`)).status).toBe(403)
    expect(repo.getSessionReadLogs).not.toHaveBeenCalled()
  })

  it('429 once the rate limit is spent', async () => {
    limited.value = false
    expect((await post(`from=${d(-5)}&to=${d(-3)}`)).status).toBe(429)
    expect(repo.getSessionReadLogs).not.toHaveBeenCalled()
  })

  it.each([
    ['missing from', `to=${d(-3)}`],
    ['missing to', `from=${d(-3)}`],
    ['not a date', `from=yesterday&to=${d(-3)}`],
    ['a date-shaped non-date', 'from=2026-13-45&to=2026-13-46'],
    ['an unknown parameter', `from=${d(-5)}&to=${d(-3)}&userId=someone-else`],
    ['a write: it is a dry run only', `from=${d(-5)}&to=${d(-3)}&dryRun=false`],
    ['to before from', `from=${d(-3)}&to=${d(-5)}`],
    ['a 32-day range', `from=${d(-40)}&to=${d(-9)}`],
  ])('400 for %s, and nothing is read', async (_name, qs) => {
    expect((await post(qs)).status).toBe(400)
    expect(repo.getSessionReadLogs).not.toHaveBeenCalled()
  })

  it('reads the session user\'s workouts from local midnight of `from` to the midnight after `to`', async () => {
    const res = await post(`from=${d(-40).replace(/-/g, '/')}&to=${d(-10)}&dryRun=true`)
    expect(res.status).toBe(200)
    expect(repo.getSessionReadLogs).toHaveBeenCalledWith(
      'u1', dateStrMidnightInTz(d(-40), TZ), dateStrMidnightInTz(d(-9), TZ),
    )
    expect((await res.json()).dryRun).toBe(true)
  })

  it('answers counts per exercise and nothing else', async () => {
    repo.getSessionReadLogs.mockResolvedValue([
      log([set(1, 8, 48), set(2, 7), set(3, 8)]), // the rest explains it: held → heavier than today
      log([set(1, 5), set(2, 8), set(3, 8)]),      // set 1 missed by 3: two steps down → lighter
    ])
    const body = await (await post(`from=${d(-5)}&to=${d(-3)}`)).json()
    expect(body.summary).toMatchObject({
      exerciseLogs: 2, read: 2, heavierNextWeight: 1, lighterNextWeight: 1, sameNextWeight: 0,
      changed: { 'Bench Press': '1 lighter, 1 heavier of 2' },
    })
    expect(JSON.stringify(body)).not.toMatch(/"(weightKg|reps|plannedWeightKg|estimated1rm|sets)"/)
  })

  it('a failure is a 500 with no detail', async () => {
    repo.getSessionReadLogs.mockRejectedValue(new Error('boom: secret detail'))
    const res = await post(`from=${d(-5)}&to=${d(-3)}`)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
