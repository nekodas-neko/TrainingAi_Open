// #4114 item 5: `logExerciseFromPayload` works out a logged lift's phase through the shared resolver
// (`resolveSessionPhase`, `isStoredBaseline`) instead of its own steps. What is recorded must not change
// for any input: this runs the real function over every program kind × phase × early-deload week ×
// upload (old payload with no `intensityMode`, `full`, `deload`, with and without an override) and
// compares what it hands the repository (the workout's phase id, phase type and early-deload flag) with
// the steps it used to run inline, written out below as the oracle. Made-up names and numbers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCurrentPhase, isDeloadActive } from '@trainingai/shared/phase-engine'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const resolver = vi.hoisted(() => ({ phase: 0, baseline: 0 }))
vi.mock('@trainingai/shared/workout/read-session', async importOriginal => {
  const real = await importOriginal<typeof import('@trainingai/shared/workout/read-session')>()
  return {
    ...real,
    resolveSessionPhase: (...a: Parameters<typeof real.resolveSessionPhase>) => { resolver.phase++; return real.resolveSessionPhase(...a) },
    isStoredBaseline: (...a: Parameters<typeof real.isStoredBaseline>) => { resolver.baseline++; return real.isStoredBaseline(...a) },
  }
})

const getActiveProgramWithPhases = vi.fn()
const getActiveProgram = vi.fn()
const createWorkoutSession = vi.fn(async (..._a: unknown[]) => ({ id: 'ws-1' }))
const countAllSessionsSinceStart = vi.fn(async (..._a: unknown[]) => new Map<string, number>())
const getSessionPeriodization = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown> | null> => null)
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getActiveProgramWithPhases, getActiveProgram, createWorkoutSession, countAllSessionsSinceStart, getSessionPeriodization,
    getExerciseType: async () => 'barbell', getDayLog: async () => [], ensureWorkoutSession: vi.fn(),
    setWorkoutSessionWarmupEnd: async () => {}, logExerciseAndSets: async () => ({ exerciseLog: { id: 'el-1' } }),
    upsertPersonalRecordIfBetter: async () => true, listBodyMetrics: async () => [], getPrescriptionBasisBefore: async () => null,
    programSessionIdOwned: async () => true,
  }),
}))

import { logExerciseFromPayload } from '../log-exercise'
import type { LogExercisePayload } from '../log-exercise'

const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const base: LogExercisePayload = { sessionName: 'Push', sessionId: 'ps-1', exercise: 'Bench Press', weights: [100], sets: 1, reps: [5] }
const recorded = () => createWorkoutSession.mock.calls[0].slice(4, 9)

const PHASES = (['normal', 'deload', 'baseline', 'testing'] as const).map((phaseType, position) => ({
  id: `ph-${phaseType}`, phaseSetId: 'set-1', position, name: phaseType, durationCycles: 2, phaseType,
}))
const SESSIONS = [{ id: 'ps-1', name: 'Push', exercises: [] }, { id: 'ps-2', name: 'Pull', exercises: [] }]
const EARLY = { none: undefined, 'in the week': today, 'a month ago': shiftDateStr(today, -30) }
const UPLOADS = [
  { label: 'old payload (no intensityMode)', intensityMode: undefined, wasOverride: undefined },
  { label: 'null intensityMode (outbox replay)', intensityMode: null, wasOverride: undefined },
  { label: 'full', intensityMode: 'full', wasOverride: false },
  { label: 'full, overridden', intensityMode: 'full', wasOverride: true },
  { label: 'deload', intensityMode: 'deload', wasOverride: false },
  { label: 'deload, overridden', intensityMode: 'deload', wasOverride: true },
] as const

const tally = { automatic: 0, aiDynamic: 0, differences: 0 }

beforeEach(() => {
  vi.clearAllMocks(); resolver.phase = 0; resolver.baseline = 0
  createWorkoutSession.mockResolvedValue({ id: 'ws-1' })
  countAllSessionsSinceStart.mockResolvedValue(new Map())
  getSessionPeriodization.mockResolvedValue(null)
})

describe('an automatic program: the phase recorded is the one the old inline steps gave (#4114 item 5)', () => {
  for (const [earlyLabel, earlyDeloadWeekStart] of Object.entries(EARLY)) {
    for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      for (const up of UPLOADS) {
        it(`${count} sessions done · early deload: ${earlyLabel} · ${up.label}`, async () => {
          const program = { id: 'prog-1', phaseMode: 'automatic', sessions: SESSIONS, earlyDeloadWeekStart }
          getActiveProgramWithPhases.mockResolvedValue({ program, phases: PHASES })
          getActiveProgram.mockResolvedValue(program)
          countAllSessionsSinceStart.mockResolvedValue(new Map([['ps-1', count]]))

          await logExerciseFromPayload('u1', { ...base, intensityMode: up.intensityMode as never, wasOverride: up.wasOverride }, TZ)

          // The oracle: what the function did before it called the resolver.
          const { phase } = getCurrentPhase(PHASES as never, 1, count)
          const expected = [phase.id, phase.phaseType, isDeloadActive(phase, { earlyDeloadWeekStart }, today), up.intensityMode ?? null, up.wasOverride ?? false]
          tally.automatic++
          if (JSON.stringify(recorded()) !== JSON.stringify(expected)) tally.differences++
          expect(recorded()).toEqual(expected)
          // It asked the shared resolver, and read nothing of its own.
          expect(resolver.phase).toBe(1)
        })
      }
    }
  }
})

describe('an ai_dynamic program: the phase recorded is the one the old inline steps gave (#4114 item 5)', () => {
  const STORED = [
    { label: 'accumulation', p: { phase: 'accumulation', baselineComplete: true } },
    { label: 'deload', p: { phase: 'deload', baselineComplete: true } },
    { label: 'baseline, unfinished', p: { phase: 'baseline', baselineComplete: false } },
    { label: 'baseline, finished', p: { phase: 'baseline', baselineComplete: true } },
    { label: 'nothing stored', p: null },
  ]
  for (const stored of STORED) for (const up of UPLOADS) {
    it(`stored ${stored.label} · ${up.label}`, async () => {
      getActiveProgramWithPhases.mockResolvedValue(null)
      getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'ai_dynamic' })
      getSessionPeriodization.mockResolvedValue(stored.p)

      await logExerciseFromPayload('u1', { ...base, intensityMode: up.intensityMode as never, wasOverride: up.wasOverride }, TZ)

      // The oracle: the inline steps (#4097's rule over the stored phase).
      const overriddenToFull = up.wasOverride === true && up.intensityMode !== 'deload'
      const trainedAsDeload = up.intensityMode === 'deload'
        || (up.intensityMode !== 'full' && stored.p?.phase === 'deload' && !overriddenToFull)
      const type = trainedAsDeload ? 'deload'
        : stored.p?.phase === 'baseline' && !stored.p.baselineComplete ? 'baseline' : undefined
      const expected = [undefined, type, false, up.intensityMode ?? null, up.wasOverride ?? false]
      tally.aiDynamic++
      if (JSON.stringify(recorded()) !== JSON.stringify(expected)) tally.differences++
      expect(recorded()).toEqual(expected)
      // The baseline test is the shared one, asked only where the upload did not already say deload.
      expect(resolver.baseline).toBe(trainedAsDeload ? 0 : 1)
    })
  }
})

it('the differential was not vacuous: every cell ran and none differed', () => {
  expect(tally.automatic).toBe(3 * 10 * UPLOADS.length)
  expect(tally.aiDynamic).toBe(5 * UPLOADS.length)
  expect(tally.differences).toBe(0)
  console.info(`[#4114 item 5] ${tally.automatic} automatic + ${tally.aiDynamic} ai_dynamic cells, ${tally.differences} differences`)
})
