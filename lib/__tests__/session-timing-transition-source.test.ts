import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * LA-65 — `/api/workout-sessions/[id]/timing` reported the ACTUAL setup from `prepTimeSec` and
 * compared it against `transitionSecForEquipment`, which models the WHOLE inter-exercise transition.
 * That is a part against a whole: `prep` is a sub-interval of `interExerciseRestSec` by
 * construction (`components/workout-screen.tsx` computes `prepSecRef` inside the same `handleStart`
 * that stamps `exerciseStartMs`, which is where `inter` ends).
 *
 * Measured over 171 transitions against the independent `set_end_ms`/`set_start_ms` clock: `inter`
 * alone matches the real gap to a median **0.05 s**, `inter + prep` overshoots by a median **136 s**.
 * Median `prep` on a non-first exercise is 2 s against a 240 s expectation, so the screen read
 * "four minutes faster than expected" while the real transition ran ~300 s — slower.
 */
const getWorkoutSessionDetail = vi.fn()
const listExerciseLibrary = vi.fn(async () => [{ name: 'Barbell Bench Press', equipment: ['barbell'] }])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1' } }) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ getWorkoutSessionDetail, listExerciseLibrary }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET } from '@/app/api/workout-sessions/[id]/timing/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000a1'

const exercise = (over: Record<string, unknown>) => ({
  exerciseName: 'Barbell Bench Press',
  sets: [{ reps: 5, setTimeSec: 40, restTimeSec: 120, plannedRestSec: 120 }],
  ...over,
})

const call = async () => {
  const res = await GET(
    new Request(`http://localhost/api/workout-sessions/${SESSION_ID}/timing`) as never,
    { params: Promise.resolve({ id: SESSION_ID }) } as never,
  )
  return res.json()
}

beforeEach(() => { getWorkoutSessionDetail.mockReset(); listExerciseLibrary.mockClear() })

describe('session timing — the actual transition comes from interExerciseRestSec', () => {
  it('reports the real gap, not the prep sub-interval inside it', async () => {
    getWorkoutSessionDetail.mockResolvedValue({
      exercises: [exercise({ interExerciseRestSec: 300, prepTimeSec: 2 })],
    })
    const body = await call()
    // 300, the measured transition — NOT 2, which is the tail of that same gap.
    expect(body.exercises[0].setupActualSec).toBe(300)
  })

  it('so a slower-than-modelled transition reads as slower, not faster', async () => {
    getWorkoutSessionDetail.mockResolvedValue({
      exercises: [exercise({ interExerciseRestSec: 300, prepTimeSec: 2 })],
    })
    const e = (await call()).exercises[0]
    expect(e.setupExpectedSec).toBe(240)              // TRANSITION_SEC_BARBELL
    expect(e.setupActualSec).toBeGreaterThan(e.setupExpectedSec)
  })

  it('falls back to prep for the FIRST exercise, which has no preceding gap', async () => {
    getWorkoutSessionDetail.mockResolvedValue({
      exercises: [exercise({ interExerciseRestSec: undefined, prepTimeSec: 286 })],
    })
    expect((await call()).exercises[0].setupActualSec).toBe(286)
  })

  it('never sums the two — that double-counts by a median 136 s', async () => {
    getWorkoutSessionDetail.mockResolvedValue({
      exercises: [exercise({ interExerciseRestSec: 300, prepTimeSec: 150 })],
    })
    expect((await call()).exercises[0].setupActualSec).toBe(300)
  })

  it('reports null when neither clock was stamped', async () => {
    getWorkoutSessionDetail.mockResolvedValue({
      exercises: [exercise({ interExerciseRestSec: undefined, prepTimeSec: undefined })],
    })
    expect((await call()).exercises[0].setupActualSec).toBeNull()
  })
})
