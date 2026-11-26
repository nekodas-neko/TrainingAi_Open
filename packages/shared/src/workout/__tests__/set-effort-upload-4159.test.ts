// #4159: each set's "how did it feel?" answer on the workout upload, the schema and the hand-off.
//
// The database half (stored beside the set, kept on a re-upload without it, kept through an edit) is
// lib/data/postgres/__tests__/set-log-effort-vs-plan-upload-4159.test.ts. Here: what the route and the
// sync push accept, and what `logExerciseWithRepo` hands the repository.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const logExerciseAndSets = vi.fn(
  async (_userId: string, _log: Record<string, unknown>, _sets: Record<string, unknown>[]) => ({ exerciseLog: { id: 'el-1' } }),
)

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

import { logExerciseFromPayload, LogExerciseUploadSchema as LogExercisePayloadSchema } from '../log-exercise'

const TZ = 'Australia/Brisbane'
const base = { sessionName: 'Push', exercise: 'Bench Press', weights: [60, 60, 60], sets: 3, reps: [8, 8, 8] }

beforeEach(() => logExerciseAndSets.mockClear())

describe('the upload schema takes each set\'s answer, and only that (#4159)', () => {
  it('a payload from today\'s phones, with no per-set answers, parses as before', () => {
    const parsed = LogExercisePayloadSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.setEfforts).toBeUndefined()
    // The same payload's parsed form carries no new key at all.
    expect(parsed.success && Object.keys(parsed.data)).not.toContain('setEfforts')
  })

  it('accepts every value with either source, and null for a set the question was not shown for', () => {
    for (const vsPlan of [-1, 0, 1]) {
      for (const source of ['tapped', 'default']) {
        const setEfforts = [{ vsPlan, source }, null, { vsPlan, source }]
        expect(LogExercisePayloadSchema.safeParse({ ...base, setEfforts }).success).toBe(true)
      }
    }
    expect(LogExercisePayloadSchema.safeParse({ ...base, setEfforts: [null, null, null] }).success).toBe(true)
  })

  it('refuses a half pair, another value, another source, another key, a wrong length, and a non-list', () => {
    const one = { vsPlan: 1, source: 'tapped' }
    const bad: [string, unknown][] = [
      ['value only', [{ vsPlan: 1 }, one, one]],
      ['source only', [{ source: 'tapped' }, one, one]],
      ['null halves', [{ vsPlan: null, source: null }, one, one]],
      ['value null, source set', [{ vsPlan: null, source: 'tapped' }, one, one]],
      ['value 2', [{ vsPlan: 2, source: 'tapped' }, one, one]],
      ['value -2', [{ vsPlan: -2, source: 'tapped' }, one, one]],
      ['fractional', [{ vsPlan: 0.5, source: 'tapped' }, one, one]],
      ['string value', [{ vsPlan: '1', source: 'tapped' }, one, one]],
      ['source expected', [{ vsPlan: 0, source: 'expected' }, one, one]],
      ['source rated', [{ vsPlan: 0, source: 'rated' }, one, one]],
      ['extra key', [{ vsPlan: 0, source: 'default', rpe: 8 }, one, one]],
      ['too short', [one, one]],
      ['too long', [one, one, one, one]],
      ['empty', []],
      ['not a list', one],
      ['a number entry', [0, one, one]],
      ['21 entries', Array(21).fill(one)],
    ]
    for (const [label, setEfforts] of bad) {
      expect(LogExercisePayloadSchema.safeParse({ ...base, setEfforts }).success, label).toBe(false)
    }
  })

  it('the plain payload schema still supports .pick (the native client picks weights and reps from it)', async () => {
    const { LogExercisePayloadSchema: plain } = await import('../log-payload')
    expect(plain.pick({ weights: true, reps: true }).safeParse({ weights: [60], reps: [8] }).success).toBe(true)
  })

  it('the exercise\'s own answer keeps its own schema (not made strict by this change)', () => {
    expect(LogExercisePayloadSchema.safeParse({ ...base, effort: { vsPlan: 1, source: 'tapped', extra: 1 } }).success).toBe(true)
  })
})

describe('logExerciseWithRepo hands each set its own answer to the write (#4159)', () => {
  it('index-aligned; a null entry and an absent list hand over nothing', async () => {
    await logExerciseFromPayload('u1', {
      ...base,
      setEfforts: [{ vsPlan: -1, source: 'tapped' }, null, { vsPlan: 0, source: 'default' }],
    }, TZ)
    const [, log, sets] = logExerciseAndSets.mock.calls[0]
    expect(sets.map(s => [s.effortVsPlan ?? null, s.effortSource ?? null])).toEqual([[-1, 'tapped'], [null, null], [0, 'default']])
    // The server does not derive the lift's answer from the sets (the phone sends it, #4155).
    expect(log.effortVsPlan).toBeNull()
    expect(log.effortSource).toBeNull()
  })

  it('both the exercise\'s answer and the sets\' answers are stored as sent, even when they disagree', async () => {
    await logExerciseFromPayload('u1', {
      ...base,
      effort: { vsPlan: 1, source: 'tapped' },
      setEfforts: [{ vsPlan: -1, source: 'tapped' }, { vsPlan: -1, source: 'tapped' }, { vsPlan: 0, source: 'default' }],
    }, TZ)
    const [, log, sets] = logExerciseAndSets.mock.calls[0]
    expect([log.effortVsPlan, log.effortSource]).toEqual([1, 'tapped'])
    expect(sets.map(s => s.effortVsPlan)).toEqual([-1, -1, 0])
  })

  it('a payload with no per-set answers hands the repository no per-set answer', async () => {
    await logExerciseFromPayload('u1', base, TZ)
    const [, , sets] = logExerciseAndSets.mock.calls[0]
    expect(sets.every(s => s.effortVsPlan == null && s.effortSource == null)).toBe(true)
  })
})
