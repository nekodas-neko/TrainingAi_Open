// Q-11 Defect B: the recap fetch (GET /api/oura/hr-data) used to be the only trigger for per-set/
// per-workout HR attribution, so a session whose recap was never opened got none, ever. Proves the
// new completion-time trigger fires, is fire-and-forget (never affects the response or blocks on
// the HR compute), and skips the persist when there's nothing to attribute yet.
//
// Q-122: also proves the route no longer reaches the Oura sync half by POSTing back to this same
// server's /api/oura/hr-sync — the whole pipeline runs in-process now.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TEST_USER_ID = 'user-1'
const WORKOUT_SESSION_ID = '00000000-0000-4000-8000-000000000001'

const authMock = vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } }))
const rateLimit = vi.fn(() => true)
const completeWorkoutFromPayload = vi.fn(async () => ({ alreadyCompleted: false, programSessionId: null }))
const reportServerError = vi.fn()
const getWorkoutSessionById = vi.fn()
const upsertWorkoutHrStats = vi.fn(async () => {})
const upsertSetHrStats = vi.fn(async () => {})
const computeWorkoutHr = vi.fn()

vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...args: unknown[]) => rateLimit(...args) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...args: unknown[]) => reportServerError(...args) }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ getWorkoutSessionById, upsertWorkoutHrStats, upsertSetHrStats }),
}))
vi.mock('@trainingai/shared/workout/compute-workout-hr', () => ({
  computeWorkoutHr: (...args: unknown[]) => computeWorkoutHr(...args),
}))
vi.mock('@trainingai/shared/workout/complete-workout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@trainingai/shared/workout/complete-workout')>()
  return { ...actual, completeWorkoutFromPayload: (...args: unknown[]) => completeWorkoutFromPayload(...args) }
})

import { POST } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/complete-workout', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Waits for the fire-and-forget HR-attribution IIFE to settle without depending on its internals.
async function flush() {
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
}

describe('POST /api/complete-workout — HR attribution trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })
    rateLimit.mockReturnValue(true)
    completeWorkoutFromPayload.mockResolvedValue({ alreadyCompleted: false, programSessionId: null })
    getWorkoutSessionById.mockResolvedValue({
      id: WORKOUT_SESSION_ID,
      startedAt: new Date(Date.now() - 3_600_000),
      completedAt: new Date(),
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  })

  it('persists both snapshots when HR data is already available at completion time', async () => {
    computeWorkoutHr.mockResolvedValue({
      readings: [{ timestamp: new Date(), bpm: 140, source: 'chest_strap' }],
      stats: [],
      setHrRows: [{ setLogId: 'sl-1' }],
      workoutHrvMs: 42,
      summary: { avgBpm: 130, peakBpm: 150, hrr1Best: 20, workoutHrvMs: 42, readingsCount: 1, source: 'chest_strap' },
    })

    const res = await POST(req({ workoutSessionId: WORKOUT_SESSION_ID }))
    expect(res.status).toBe(200)
    await flush()

    expect(upsertWorkoutHrStats).toHaveBeenCalledWith(TEST_USER_ID, WORKOUT_SESSION_ID, expect.objectContaining({ readingsCount: 1 }))
    expect(upsertSetHrStats).toHaveBeenCalledWith(TEST_USER_ID, WORKOUT_SESSION_ID, [{ setLogId: 'sl-1' }])
  })

  it('makes no server-to-self request for the Oura sync half (Q-122)', async () => {
    computeWorkoutHr.mockResolvedValue({
      readings: [], stats: [], setHrRows: [], workoutHrvMs: null,
      summary: { avgBpm: null, peakBpm: null, hrr1Best: null, workoutHrvMs: null, readingsCount: 0, source: null },
    })

    const res = await POST(req({ workoutSessionId: WORKOUT_SESSION_ID }))
    expect(res.status).toBe(200)
    await flush()

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls.filter(([url]) => String(url).includes('/api/oura/hr-sync'))).toHaveLength(0)
  })

  it('does not persist when no readings exist yet (the ring has not drained) — leaves the session for the missing-list', async () => {
    computeWorkoutHr.mockResolvedValue({
      readings: [],
      stats: [],
      setHrRows: [],
      workoutHrvMs: null,
      summary: { avgBpm: null, peakBpm: null, hrr1Best: null, workoutHrvMs: null, readingsCount: 0, source: null },
    })

    const res = await POST(req({ workoutSessionId: WORKOUT_SESSION_ID }))
    expect(res.status).toBe(200)
    await flush()

    expect(upsertWorkoutHrStats).not.toHaveBeenCalled()
    expect(upsertSetHrStats).not.toHaveBeenCalled()
  })

  it('is fire-and-forget: a throwing HR compute reports the error but the completion response already succeeded', async () => {
    computeWorkoutHr.mockRejectedValue(new Error('boom'))

    const res = await POST(req({ workoutSessionId: WORKOUT_SESSION_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    await flush()

    expect(reportServerError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ url: '/api/complete-workout#hr-pipeline' }))
  })
})
