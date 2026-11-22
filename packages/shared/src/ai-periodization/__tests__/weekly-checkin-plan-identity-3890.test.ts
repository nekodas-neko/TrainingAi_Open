// #3890 step 2: what the weekly check-in changes in a plan, and what it must not.
//   1. Identity: with no weekly_checkins rows (the repository answers "no held lifts" and "no shorter
//      session"), every prescription and every prompt is byte-identical to main's, compared with the
//      SAME golden file #3896's identity test pins (it is read, never written, here).
//   2. "Heavy" feeds the session read only (in shadow until #3889 step 4): a held lift's stored read
//      never adds load, and the prescription itself is unchanged.
//   3. A shorter session is the week's time budget, only when shorter and only without a preset.
// 0 real model calls: the model is a mock that records the prompt it was sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { SessionReadLog, SessionReadSet } from '../session-read'
import type { WorkoutRepository } from '@/lib/data/repository'
import { SCENARIOS, SESSION_ID, fakeRepo } from './fixtures/lift-preference-scenarios'

const GOLDEN = join(__dirname, 'fixtures', 'lift-preference-identity-3896.golden.json')
const golden: Record<string, string> = JSON.parse(readFileSync(GOLDEN, 'utf8'))

const mocks = vi.hoisted(() => ({
  signals: null as unknown,
  model: null as Record<string, unknown> | null,
  prompts: [] as Array<{ system: string; prompt: string }>,
  budgetOverrides: [] as Array<number | undefined>,
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async (...args: unknown[]) => { mocks.budgetOverrides.push(args[5] as number | undefined); return mocks.signals },
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { system: string; prompt: string }) => {
    mocks.prompts.push({ system: args.system, prompt: args.prompt })
    if (!mocks.model) throw new Error('model unavailable (test)')
    return { object: structuredClone(mocks.model) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_opts: unknown, run: (signal: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

/** The repository with the two check-in reads present and empty: a person with no check-in rows. */
const noCheckinRows = {
  listCheckinHeldLifts: async () => new Set<string>(),
  getCheckinSessionBudgetMin: async () => null,
}

let n = 0
describe('with no weekly_checkins rows every plan is identical to main (golden file of #3896)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  for (let i = 0; i < SCENARIOS.length; i++) {
    it(SCENARIOS[i].name, async () => {
      const sc = SCENARIOS[i]
      mocks.signals = structuredClone(sc.signals)
      mocks.model = sc.model
      mocks.prompts = []
      mocks.budgetOverrides = []
      const stored: AiPrescription[] = []
      await generatePrescriptionForSession(`user-3890-identity-${++n}`, SESSION_ID, fakeRepo(sc.phase, stored, noCheckinRows), 'Australia/Brisbane')
      expect(JSON.stringify({ stored: stored[0], prompt: mocks.prompts[0] }, null, 2)).toBe(golden[`ai:${i}`])
      expect(mocks.budgetOverrides).toEqual([undefined])
    })
  }
})

// ── A held lift's read, and the shorter session ──

const SESSION = 'ps-3890'
const set = (setNumber: number, over: Partial<SessionReadSet> = {}): SessionReadSet => ({
  setNumber, reps: 5, weightKg: 80, plannedReps: 5, plannedWeightKg: 80, plannedPct: 75,
  restTimeSec: 120, plannedRestSec: 120, rpe: null, rpeSource: null, hr: null, ...over,
})
// Lift A beat its last set (the read adds weight as today); Lift B met every set (today's basis).
const LOGS: SessionReadLog[] = [
  { name: 'Lift A 3890', sets: [set(1), set(2), set(3, { reps: 8 })] },
  { name: 'Lift B 3890', sets: [set(1), set(2), set(3)] },
].map(({ name, sets }, i) => ({
  exerciseLogId: `el-${i}`, workoutSessionId: 'ws-last', programSessionId: SESSION, exerciseName: name,
  loggedAt: new Date('2026-11-18T02:00:00Z'), estimated1rm: 100, exerciseDeloaded: false, exerciseType: 'weighted',
  session: { completed: true, isEarlyDeload: false, wasOverride: false, intensityMode: 'full', phaseType: 'normal', hrDense: null },
  effortVsPlan: null, effortSource: null, sets,
}))
const signals = {
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 60,
  exercises: ['a', 'b'].map((id, i) => ({
    sessionExerciseId: id, name: i === 0 ? 'Lift A 3890' : 'Lift B 3890', role: 'primary', muscleGroups: ['chest'],
    muscleAssignments: [{ muscle: 'chest', role: 'main' }], baseline1rm: 100, current1rm: 100, exerciseType: null,
    rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null, equipment: ['barbell'], transitionSec: 240,
    plateau: false, rpeDelta: null, repCompletionRate: null,
    baseSets: [{ pct: 75, reps: 5, restSec: 120 }, { pct: 75, reps: 5, restSec: 120 }, { pct: 75, reps: 5, restSec: 120 }],
  })),
  phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
  soreMusclesInSession: [], soreMusclesOutOfSession: [], recentlyTrainedMusclesInSession: [], sorenessLogDate: 'none',
  activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null, repCompletionRate: null, weeklyTargets: {},
  weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null, sleepTrend: null, hrvTrend: null, spo2Trend: null,
  illness: null, externalReadiness: null, confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false,
  sleepScoreTrend: null, tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
}
const model = {
  phase: 'accumulation', phase_action: 'stay', deload: false, confidence: 0.7, reasoning: 'Steady week.',
  exercises: [
    { session_exercise_id: 'a', name: 'Lift A 3890', sets: 3, reps: 5, pct: 75, rest_sec: 120 },
    { session_exercise_id: 'b', name: 'Lift B 3890', sets: 3, reps: 5, pct: 75, rest_sec: 120 },
  ],
}

async function generate(extra: Record<string, unknown>, durationPreset?: number) {
  const stored: AiPrescription[] = []
  const state = {
    phase: 'accumulation', baselineComplete: true, sessionsInPhase: 2,
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const program = {
    id: 'prog-1', createdAt: new Date('2026-11-01T00:00:00Z'), trainingGoal: 'strength',
    sessions: [{ id: SESSION, timeBudgetMinutes: 60, exercises: [
      { id: 'a', exerciseName: 'Lift A 3890', exerciseRole: 'primary' },
      { id: 'b', exerciseName: 'Lift B 3890', exerciseRole: 'primary' },
    ] }],
  }
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({ program, structure: null }),
    getActiveProgram: async () => program,
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    listSessionPeriodizationForProgram: async () => [{ phaseStartedAt: new Date(0), ...state }],
    listProgramCompletions: async () => [],
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    getSessionReadLogs: async () => LOGS,
    getExerciseEquipment: async () => ({ 'Lift A 3890': ['barbell'], 'Lift B 3890': ['barbell'] }),
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p) },
    ...extra,
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  mocks.signals = structuredClone(signals)
  mocks.model = model
  mocks.prompts = []
  mocks.budgetOverrides = []
  await generatePrescriptionForSession(`user-3890-${++n}`, SESSION, repo, 'Australia/Brisbane', undefined, durationPreset)
  return { stored: stored[0], prompts: mocks.prompts, budget: mocks.budgetOverrides }
}
const plan = (p: AiPrescription) => ({ ...p, sessionReads: undefined, generatedFor: undefined })

describe('"Heavy" feeds the session read, in shadow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T02:00:00Z')) // Wednesday; the week starting 2026-11-23
  })
  afterEach(() => { vi.useRealTimers() })

  it('asks for the check-in that applies to THIS local week, and holds only the lifts it names', async () => {
    const asked: unknown[] = []
    const out = await generate({ ...noCheckinRows, listCheckinHeldLifts: async (...a: unknown[]) => { asked.push(a); return new Set(['Lift A 3890']) } })
    expect(asked).toEqual([[expect.any(String), '2026-11-23', ['Lift A 3890', 'Lift B 3890']]])
    expect(out.stored.sessionReads?.map(r => [r.exerciseName, r.verdict, r.nextLoad, r.checkinHeld ?? null])).toEqual([
      ['Lift A 3890', 'hold', 'hold', true],
      ['Lift B 3890', 'hold', 'as-today', null],
    ])
  })

  it('the prescription and the prompt are identical with and without a hold', async () => {
    const without = await generate(noCheckinRows)
    const withHold = await generate({ ...noCheckinRows, listCheckinHeldLifts: async () => new Set(['Lift A 3890', 'Lift B 3890']) })
    expect(withHold.stored.sessionReads?.map(r => r.nextLoad)).toEqual(['hold', 'hold'])
    expect(without.stored.sessionReads?.map(r => r.nextLoad)).toEqual(['as-today', 'as-today'])
    expect(plan(withHold.stored)).toEqual(plan(without.stored))
    expect(withHold.prompts).toEqual(without.prompts)
  })

  it('a failed check-in read plans as if there were none', async () => {
    const out = await generate({ ...noCheckinRows, listCheckinHeldLifts: async () => { throw new Error('db down') } })
    expect(out.stored.sessionReads?.every(r => r.checkinHeld == null)).toBe(true)
  })
})

describe('a shorter session is next week\'s time budget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T02:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('is read for this local week and applied when shorter than the session (60 min)', async () => {
    const asked: unknown[] = []
    const out = await generate({ ...noCheckinRows, getCheckinSessionBudgetMin: async (...a: unknown[]) => { asked.push(a); return 40 } })
    expect(asked).toEqual([[expect.any(String), '2026-11-23']])
    expect(out.budget).toEqual([40])
  })
  it('is not applied when it is no shorter than the session', async () => {
    expect((await generate({ ...noCheckinRows, getCheckinSessionBudgetMin: async () => 60 })).budget).toEqual([undefined])
    expect((await generate({ ...noCheckinRows, getCheckinSessionBudgetMin: async () => 90 })).budget).toEqual([undefined])
  })
  it('a length picked for today wins, and the check-in is not read', async () => {
    let read = 0
    const out = await generate({ ...noCheckinRows, getCheckinSessionBudgetMin: async () => { read++; return 30 } }, 75)
    expect(read).toBe(0)
    expect(out.budget).toEqual([75])
  })
  it('a failed read keeps the session\'s budget', async () => {
    expect((await generate({ ...noCheckinRows, getCheckinSessionBudgetMin: async () => { throw new Error('db down') } })).budget).toEqual([undefined])
  })
})
