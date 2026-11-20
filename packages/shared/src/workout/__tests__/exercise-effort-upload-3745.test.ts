// #3745: the after-the-last-set answer ("how did this exercise feel?") on the workout upload.
//
// OLD-BUILD COMPATIBILITY lives here: a payload without `effort` (every build before this one)
// still parses and still logs, with nothing written over a stored answer. The database half of
// that promise (the upsert keeps the stored pair on a replay without one) is
// lib/data/postgres/__tests__/exercise-log-effort-vs-plan-upload.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const logExerciseAndSets = vi.fn(async () => ({ exerciseLog: { id: 'el-1' } }))

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getActiveProgramWithPhases: async () => null,
    getActiveProgram: async () => null,
    getExerciseType: async () => 'barbell',
    getDayLog: async () => [],
    createWorkoutSession: async () => ({ id: 'ws-1' }),
    ensureWorkoutSession: vi.fn(),
    setWorkoutSessionWarmupEnd: async () => {},
    logExerciseAndSets,
    upsertPersonalRecordIfBetter: async () => false,
    countAllSessionsSinceStart: async () => new Map(),
    getSessionPeriodization: async () => null,
    listBodyMetrics: async () => [],
    getPrescriptionBasisBefore: async () => null,
    programSessionIdOwned: async () => true,
  }),
}))

import { logExerciseFromPayload, LogExercisePayloadSchema } from '../log-exercise'

const TZ = 'Australia/Brisbane'
// What a build from before #3745 sends: no `effort` key at all.
const oldBuildPayload = {
  sessionName: 'Push',
  exercise: 'Bench Press',
  weights: [60, 60],
  sets: 2,
  reps: [8, 8],
  rpeValues: [7, 7],
  rpeSources: ['expected', 'expected'] as ('expected' | 'rated')[],
}

beforeEach(() => logExerciseAndSets.mockClear())

describe('the upload schema takes the answer, and only the answer (#3745)', () => {
  it('accepts a payload from an older build that sends no answer', () => {
    const parsed = LogExercisePayloadSchema.safeParse(oldBuildPayload)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.effort).toBeUndefined()
  })

  it('accepts each of -1, 0 and +1 with either source', () => {
    for (const vsPlan of [-1, 0, 1]) {
      for (const source of ['tapped', 'default']) {
        expect(LogExercisePayloadSchema.safeParse({ ...oldBuildPayload, effort: { vsPlan, source } }).success).toBe(true)
      }
    }
  })

  it('refuses any other value, any other source, and half an answer', () => {
    const bad: unknown[] = [
      { vsPlan: 2, source: 'tapped' },
      { vsPlan: -2, source: 'tapped' },
      { vsPlan: 0.5, source: 'tapped' },
      { vsPlan: '1', source: 'tapped' },
      { vsPlan: 0, source: 'expected' },
      { vsPlan: 0, source: 'rated' },
      { vsPlan: 0 },
      { source: 'default' },
      { vsPlan: null, source: null },
      0,
    ]
    for (const effort of bad) {
      expect(LogExercisePayloadSchema.safeParse({ ...oldBuildPayload, effort }).success, JSON.stringify(effort)).toBe(false)
    }
  })
})

describe('logExerciseFromPayload carries the answer to the exercise log (#3745)', () => {
  it('stores a tapped answer as the answer itself', async () => {
    await logExerciseFromPayload('u1', { ...oldBuildPayload, effort: { vsPlan: 1, source: 'tapped' } }, TZ)
    const [, log] = logExerciseAndSets.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(log.effortVsPlan).toBe(1)
    expect(log.effortSource).toBe('tapped')
  })

  it('stores a default answer with its source', async () => {
    await logExerciseFromPayload('u1', { ...oldBuildPayload, effort: { vsPlan: 0, source: 'default' } }, TZ)
    const [, log] = logExerciseAndSets.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(log.effortVsPlan).toBe(0)
    expect(log.effortSource).toBe('default')
  })

  it('an older build still logs, with no answer (the upsert then keeps any stored one)', async () => {
    await logExerciseFromPayload('u1', oldBuildPayload, TZ)
    expect(logExerciseAndSets).toHaveBeenCalledTimes(1)
    const [, log, sets] = logExerciseAndSets.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>[]]
    expect(log.effortVsPlan).toBeNull()
    expect(log.effortSource).toBeNull()
    // The per-set effort is untouched by the answer: still the pre-fill, still `expected`.
    expect(sets.map(s => [s.rpe, s.rpeSource])).toEqual([[7, 'expected'], [7, 'expected']])
  })
})
