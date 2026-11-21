/**
 * #3882: the two HR-snapshot backfills answer a read-only count for Preview's admin list. Mocked
 * repository, no SQL: it pins that a count never writes, never computes, is admin-only and reads
 * the same 180-day window the real run reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>
const getUserById = vi.fn(async (_id: string) => ({ isActive: true, isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const listSessionsMissingHrStats = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listSessionsMissingSetHrStats = vi.fn(async (..._a: unknown[]) => [] as Row[])
const upsertWorkoutHrStats = vi.fn(async (..._a: unknown[]) => undefined)
const upsertSetHrStats = vi.fn(async (..._a: unknown[]) => undefined)
const computeWorkoutHr = vi.fn(async (..._a: unknown[]) => null as Row | null)

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: () => undefined }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    listSessionsMissingHrStats: (...a: unknown[]) => listSessionsMissingHrStats(...a),
    listSessionsMissingSetHrStats: (...a: unknown[]) => listSessionsMissingSetHrStats(...a),
    upsertWorkoutHrStats: (...a: unknown[]) => upsertWorkoutHrStats(...a),
    upsertSetHrStats: (...a: unknown[]) => upsertSetHrStats(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/workout/compute-workout-hr', () => ({
  computeWorkoutHr: (...a: unknown[]) => computeWorkoutHr(...a),
}))

import { GET as workoutCount } from '@/app/api/oura-ble/backfill-hr-stats/route'
import { GET as setCount } from '@/app/api/workout/backfill-set-hr-stats/route'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ws-${i}` }))
const CASES: [string, () => Promise<Response>, typeof listSessionsMissingHrStats, number][] = [
  ['workout HR snapshot', () => workoutCount(), listSessionsMissingHrStats, 2000],
  ['set HR snapshot', () => setCount(), listSessionsMissingSetHrStats, 1000],
]

beforeEach(() => {
  for (const m of [getUserById, rateLimit, listSessionsMissingHrStats, listSessionsMissingSetHrStats,
                   upsertWorkoutHrStats, upsertSetHrStats, computeWorkoutHr]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isActive: true, isAdmin: true })
  sessionUser = { id: 'u-1', isAdmin: true }
})
afterEach(() => { vi.useRealTimers() })

describe.each(CASES)('GET count: %s', (_name, call, lister, cap) => {
  it('counts the sessions the run would take on and writes nothing', async () => {
    lister.mockResolvedValue(rows(7))
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ dryRun: true, summary: { sessionsToProcess: 7, atLeast: false } })
    expect(computeWorkoutHr).not.toHaveBeenCalled()
    expect(upsertWorkoutHrStats).not.toHaveBeenCalled()
    expect(upsertSetHrStats).not.toHaveBeenCalled()
  })

  it('says "at least" when the ceiling was reached', async () => {
    lister.mockResolvedValue(rows(cap))
    expect(await (await call()).json()).toEqual({ dryRun: true, summary: { sessionsToProcess: cap, atLeast: true } })
  })

  it('reads the 180-day window the real run reads, at the ceiling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    await call()
    const [userId, since, limit] = lister.mock.calls[0] as [string, Date, number]
    expect(userId).toBe('u-1')
    expect(limit).toBe(cap)
    expect(Math.round((Date.now() - since.getTime()) / 86_400_000)).toBe(180)
  })

  it('refuses a non-admin and a signed-out caller, and is rate limited', async () => {
    getUserById.mockResolvedValue({ isActive: true, isAdmin: false })
    expect((await call()).status).toBe(403)
    sessionUser = null
    expect((await call()).status).toBe(401)
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isActive: true, isAdmin: true })
    rateLimit.mockReturnValue(false)
    expect((await call()).status).toBe(429)
    expect(lister).not.toHaveBeenCalled()
  })
})
