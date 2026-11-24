/**
 * #4087: a deload the MODEL writes itself (`phaseAction: 'deload_recommended'`) applies by itself on an
 * `ai_dynamic` program (#4088), and the screen offers "Train full instead". Its rows used to carry no
 * `deloaded` flag and no `preDeload`, so Full had nothing to put back: the session was logged as full
 * while the bar kept the deload's loads. The two rules-built deloads record the program's own numbers
 * (BF-198); a model-written one now records them through the same builder.
 *
 * The model is mocked throughout (0 real calls); the repository is in memory with the adapter's
 * compare-and-set. Fixtures sit at local midday. Made-up lifts and numbers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription, PeriodizationPhase, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { ProgramSession } from '@trainingai/shared/types/program'
import { buildWorkoutExercises, type BuildWorkoutExercisesCtx } from '@trainingai/shared/workout/session-data'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { programMoveMark } from '../program-phase'
import { intensityZoneForRole, phaseRestBounds } from '../prompt'
import { clampPrescribedPct } from '../autoregulation'
import { holdsOneDayDeload } from '../one-day-deload'
import { reevaluatePrescriptionForToday } from '../reevaluate'
import { deloadOverrideForGoal } from '../deload-constants'
import { rowUnderFull, prescriptionFigures } from '../prescription-figures'
import { deloadOverrideOutcome, prescriptionRowAsTrained, prescriptionFiguresAsTrained } from '@/components/workout/utils'

const mocks = vi.hoisted(() => ({ signals: null as unknown, answer: null as unknown, calls: 0 }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => structuredClone(mocks.signals),
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async () => { mocks.calls++; return { object: structuredClone(mocks.answer) } },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_meta: unknown, run: (s: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession, buildProgramAsWrittenPrescription, buildWholeSessionDeloadPrescription, recordFullSessionOnModelDeload } = await import('../generate-prescription')

const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-11-25T12:00:00+10:00') // Wednesday, Brisbane
type Kind = 'ai_dynamic' | 'automatic' | 'manual'
type Ex = PrescriptionSignals['exercises'][number]

const exercise = (id: string, role: string, muscle: string, over: Partial<Ex> = {}): Ex => ({
  sessionExerciseId: id, name: `Lift ${id}`, role, muscleGroups: [muscle],
  muscleAssignments: [{ muscle, role: 'main' }], baseline1rm: 100, current1rm: 100, latest1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: role === 'primary' ? ['barbell'] : ['cable'], transitionSec: 240, plateau: false,
  rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 75, reps: 6, restSec: 150 }, { pct: 75, reps: 6, restSec: 150 }, { pct: 75, reps: 6, restSec: 150 }],
  ...over,
} as Ex)

const signals = (over: Partial<PrescriptionSignals> = {}, exs?: Ex[]): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: exs ?? [exercise('p', 'primary', 'quadriceps'), exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps')],
  phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
  soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.9, confidenceReasons: ['Test reason'], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
} as unknown as PrescriptionSignals)

const deloadAnswer = (pct = 55, reps = 6) => ({
  phase: 'deload', phase_action: 'deload_recommended', deload: true, confidence: 0.95, reasoning: 'Model says take it easy.',
  exercises: [
    { session_exercise_id: 'p', name: 'Lift p', sets: 2, reps, pct, rest_sec: 90 },
    { session_exercise_id: 's', name: 'Lift s', sets: 2, reps: reps + 2, pct: pct - 5, rest_sec: 90 },
    { session_exercise_id: 'a', name: 'Lift a', sets: 2, reps: 12, pct: 45, rest_sec: 60 },
  ],
})
const stayAnswer = () => ({ ...deloadAnswer(72), phase: 'accumulation', phase_action: 'stay', deload: false })

interface Row {
  programSessionId: string; phase: PeriodizationPhase; phaseStartedAt: Date; sessionsInPhase: number
  baselineComplete: boolean; pendingTransition: ReturnType<typeof programMoveMark> | null
  prescription: AiPrescription | null; prescriptionStatus: PrescriptionStatus
  prescriptionExpiresAt: Date | null; prescriptionGeneratedAt: Date | null; preEmergencyDeloadPhase: null
}

let users = 0
/** One program of three session types, all in accumulation with two training weeks done; 'push' is planned. */
function program(kind: Kind, phase: PeriodizationPhase = 'accumulation') {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(NOW)
  const weekday = (new Date(`${todayStr}T12:00:00Z`).getUTCDay() + 6) % 7
  const thisMonday = shiftDateStr(todayStr, -weekday)
  const startDay = shiftDateStr(thisMonday, -14)
  const start = dateStrMidnightInTz(startDay, TZ)
  const completions = [0, 1].map(i => ({
    programSessionId: 'legs', completedAt: new Date(dateStrMidnightInTz(shiftDateStr(startDay, 7 * i + 2), TZ).getTime() + 12 * 3_600_000),
  }))
  const base = (id: string): Row => ({
    programSessionId: id, phase, phaseStartedAt: phase === 'deload' ? dateStrMidnightInTz(thisMonday, TZ) : start, sessionsInPhase: phase === 'deload' ? 0 : 2, baselineComplete: true,
    pendingTransition: programMoveMark(phase),
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
    preEmergencyDeloadPhase: null,
  })
  const db = new Map<string, Row>(['push', 'legs', 'pull'].map(id => [id, base(id)]))
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({
      program: { id: 'prog', phaseMode: kind, trainingGoal: 'strength', sessions: ['push', 'legs', 'pull'].map(id => ({ id, timeBudgetMinutes: 90, exercises: [] })) },
      structure: 'stamp',
    }),
    getCheckinSessionBudgetMin: async () => null,
    ensureSessionPeriodization: async (_u: string, id: string) => ({ ...db.get(id)! }),
    getSessionPeriodization: async (_u: string, id: string) => ({ ...db.get(id)! }),
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: async () => [...db.values()].map(r => ({ ...r })),
    listProgramCompletions: async () => completions,
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    recordPrescriptionShadow: async () => undefined,
    listUnfinishedLoggedSessions: async () => [],
    advanceProgramPhase: async () => null,
    advancePhase: async () => undefined,
    storePrescription: async (_u: string, id: string, prescription: AiPrescription, expiresAt: Date, status: PrescriptionStatus, generatedFor: { phase: string; phaseStartedAt: Date }) => {
      const r = db.get(id)!
      if (r.phase !== generatedFor.phase || r.phaseStartedAt.getTime() !== generatedFor.phaseStartedAt.getTime()) return false
      Object.assign(r, { prescription, prescriptionStatus: status, prescriptionExpiresAt: expiresAt, prescriptionGeneratedAt: new Date() })
      return true
    },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  const user = `u-4087-${++users}`
  return { db, run: () => generatePrescriptionForSession(user, 'push', repo, TZ) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.calls = 0
  mocks.signals = signals()
  mocks.answer = deloadAnswer()
})
afterEach(() => vi.useRealTimers())

const ok = (r: Awaited<ReturnType<typeof generatePrescriptionForSession>>) => {
  if (!r.ok) throw new Error(`generation failed: ${r.error}`)
  return r
}
const rowOf = (p: AiPrescription, id: string) => p.exercises.find(e => e.sessionExerciseId === id)!
const NUM = (r: { sets: number; reps: number; pct: number; restSec: number }) => ({ sets: r.sets, reps: r.reps, pct: r.pct, restSec: r.restSec })

/** The screen's own read of a stored plan (`buildWorkoutExercises`), for the Full override. */
function screenRows(prescription: AiPrescription, trainingGoal = 'strength') {
  const session: ProgramSession = {
    id: 'push', programId: 'prog', name: 'Push', position: 0, timeBudgetMinutes: 90,
    exercises: ['p', 's', 'a'].map((id, i) => ({
      id, sessionId: 'push', exerciseName: `Lift ${id}`, muscleGroups: ['chest'], position: i,
      exerciseRole: id === 'p' ? 'primary' : id === 's' ? 'secondary' : 'accessory',
    })) as ProgramSession['exercises'],
  }
  const ctx: BuildWorkoutExercisesCtx = {
    lastLogs: new Map(), prMap: new Map(), estimateMap: new Map(), styleById: new Map(), styleByName: new Map(),
    styles: [], libByName: new Map(), currentPhase: null, allPhases: [], isDeloadActive: false, isBaselinePhase: false,
    aiDrivesLoad: true, aiPrescription: prescription, aiPhaseLabel: 'Deload', isAiDynamic: true, aiDeload: false,
    droppedThisCycle: new Set(), loggedTodayInThisSession: new Set(), trainingGoal,
  }
  return buildWorkoutExercises(session, ctx)
}

describe('1 — the bug: Full on a deload the model wrote', () => {
  it('Full puts the program\'s numbers back, and the session is not logged as full on the deload\'s loads', async () => {
    const h = program('ai_dynamic')
    const r = ok(await h.run())
    expect(mocks.calls).toBe(1)
    expect(r.prescription.phaseAction).toBe('deload_recommended')
    expect(r.prescriptionStatus).toBe('auto_applied')
    const stored = h.db.get('push')!.prescription!
    // The Full override, as the screen reads it.
    const exercises = screenRows(stored)
    const outcome = deloadOverrideOutcome(exercises, true, { periodization: { prescription: stored, prescriptionStatus: 'auto_applied' }, deloadWeek: false })
    expect(outcome).toBe('all')
    // What Full trains is the program's own numbers, not the deload's.
    const p = prescriptionRowAsTrained(rowOf(stored, 'p'), true)
    expect(p.pct).toBe(75)
    expect(p.reps).toBe(6)
    expect(p.deloaded).toBe(false)
    expect(exercises.every(e => e.deloaded && e.preDeloadStyle)).toBe(true)
  })
})

describe('2 — what is recorded, and what is not touched', () => {
  it('the deload\'s own numbers are exactly what the model wrote, clamped as before; every row is flagged and records the program\'s numbers', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    expect(stored.deload).toBe(true)
    // Captured from `main` (d65958c6) before this change: the same answer, the same rows and minutes.
    expect(NUM(rowOf(stored, 'p'))).toEqual({ sets: 3, reps: 6, pct: 55, restSec: 90 })
    expect(NUM(rowOf(stored, 's'))).toEqual({ sets: 3, reps: 8, pct: 55, restSec: 90 })
    expect(NUM(rowOf(stored, 'a'))).toEqual({ sets: 3, reps: 10, pct: 55, restSec: 60 })
    expect(stored.estimatedSessionDurationMin).toBe(22)
    const asWritten = buildProgramAsWrittenPrescription(mocks.signals as PrescriptionSignals, 'x')!
    for (const row of stored.exercises) {
      expect(row.deloaded).toBe(true)
      expect(row.deloadNote).toBe('Deload — prescribed by your plan')
      const full = asWritten.exercises.find(e => e.sessionExerciseId === row.sessionExerciseId)!
      expect(row.preDeload).toEqual(NUM(full))
    }
    expect(stored.fullSession).toEqual(prescriptionFigures(stored.exercises.map(rowUnderFull), mocks.signals as PrescriptionSignals))
    expect(stored.fullSession!.estimatedSessionDurationMin).toBeGreaterThan(stored.estimatedSessionDurationMin)
  })

  it('Full then Deload again round-trips: toggling touches nothing stored', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    const before = structuredClone(stored)
    const full = stored.exercises.map(e => prescriptionRowAsTrained(e, true))
    expect(full.every(e => e.deloaded === false)).toBe(true)
    expect(prescriptionFiguresAsTrained(stored, true)).toEqual(stored.fullSession)
    const again = stored.exercises.map(e => prescriptionRowAsTrained(e, false))
    expect(again).toEqual(before.exercises)
    expect(prescriptionFiguresAsTrained(stored, false)).toEqual({
      estimatedSessionDurationMin: before.estimatedSessionDurationMin, weeklyVolumeContribution: before.weeklyVolumeContribution,
    })
    expect(stored).toEqual(before)
  })

  it('a lift preference (a rep range) and the check-in hold are in what Full restores', async () => {
    const pref = { repRange: { min: 9, max: 10 }, restSec: null, oneShot: null, checkinHold: { weekStart: '2026-11-23', barKg: 40 } }
    mocks.signals = signals({}, [
      exercise('p', 'primary', 'quadriceps', { liftPreference: { preference: pref, basisKg: 100 } } as never),
      exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps'),
    ])
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    const asWritten = buildProgramAsWrittenPrescription(mocks.signals as PrescriptionSignals, 'x')!
    const want = asWritten.exercises.find(e => e.sessionExerciseId === 'p')!
    expect(want.reps).toBeGreaterThanOrEqual(9)
    expect(want.reps).toBeLessThanOrEqual(10)
    expect(want.pct).toBeLessThan(75) // the hold lowered the bar
    const row = rowOf(stored, 'p')
    expect(row.preDeload).toEqual(NUM(want))
    expect(rowUnderFull(row)).toMatchObject(NUM(want))
    // The deload's own numbers carry neither.
    expect(NUM(row)).toEqual({ sets: 3, reps: 6, pct: 55, restSec: 90 })
  })

  it('an extreme program row is restored inside the phase\'s bounds', async () => {
    const extreme = [0, 1, 2, 3, 4, 5, 6, 7].map(() => ({ pct: 130, reps: 1, restSec: 5 }))
    mocks.signals = signals({}, [
      exercise('p', 'primary', 'quadriceps', { baseSets: extreme }),
      exercise('s', 'secondary', 'back', { baseSets: extreme }),
      exercise('a', 'accessory', 'biceps', { baseSets: extreme }),
    ])
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    const rest = phaseRestBounds('accumulation')
    for (const id of ['p', 's', 'a']) {
      const full = rowOf(stored, id).preDeload!
      const zone = intensityZoneForRole('strength', 'accumulation', id === 'p' ? 'primary' : id === 's' ? 'secondary' : 'accessory')
      expect(full.sets).toBeLessThanOrEqual(zone.setsMax)
      expect(full.sets).toBeGreaterThanOrEqual(1)
      // An accessory is held to the goal's band by its own rules (#4088 leaves it too): its sets only.
      if (id !== 'a') {
        expect(full.restSec).toBeGreaterThanOrEqual(rest.restSecMin)
        expect(full.restSec).toBeLessThanOrEqual(rest.restSecMax)
        expect(full.reps).toBeGreaterThanOrEqual(zone.repMin)
        expect(full.reps).toBeLessThanOrEqual(zone.repMax)
        expect(full.pct).toBeLessThanOrEqual(zone.pctMax)
        expect(full.pct).toBeGreaterThanOrEqual(clampPrescribedPct(-1, zone))
      }
    }
  })
})

describe('3 — what the new flag changes elsewhere', () => {
  const quiet = {
    soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], hoursSinceLastSession: 48, activeInjuredMusclesInSession: [],
    trainingGoal: 'strength', illnessFlag: null, selfReportedSick: false,
    exercises: ['p', 's', 'a'].map(id => ({ sessionExerciseId: id, name: `Lift ${id}`, muscleAssignments: [{ muscle: 'quadriceps', role: 'main' as const }] })),
  }

  it('the first read of the day does not turn it back into a full session', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    const state = h.db.get('push')!
    const stored = state.prescription!
    const out = reevaluatePrescriptionForToday(stored, quiet as never, {
      phase: 'accumulation', prescription: stored, prescriptionStatus: 'auto_applied',
      prescriptionExpiresAt: state.prescriptionExpiresAt, sessionsInPhase: 2,
    }, NOW)
    expect(out.needsRegenerate).toBe(false)
    expect(out.changed).toBe(false)
    expect(out.prescription.exercises).toEqual(stored.exercises)
    expect(out.prescription.exercises.every(e => e.deloaded === true)).toBe(true)
  })

  it('it is still held for the day as a one-day deload, and a stay is not a deload', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    expect(holdsOneDayDeload(h.db.get('push')!)).toBe(true)
    mocks.answer = stayAnswer()
    const h2 = program('ai_dynamic')
    ok(await h2.run())
    const stay = h2.db.get('push')!.prescription!
    expect(stay.exercises.some(e => e.deloaded || e.preDeload)).toBe(false)
    expect(stay.fullSession).toBeUndefined()
  })

  it('automatic and manual programs store the model\'s rows exactly as before: no flag, no record', async () => {
    for (const kind of ['automatic', 'manual'] as const) {
      const h = program(kind)
      const r = ok(await h.run())
      expect(r.prescription.phaseAction).toBe('deload_recommended')
      expect(r.prescriptionStatus).toBe('pending')
      for (const row of r.prescription.exercises) {
        expect(row.deloaded).toBeUndefined()
        expect(row.preDeload).toBeUndefined()
        expect(row.deloadNote).toBeUndefined()
      }
      expect(r.prescription.fullSession).toBeUndefined()
    }
  })
})

describe('4 — a plan stored before this change is not rewritten', () => {
  it('has no record, and Full says so as it did: nothing to revert', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    // What `main` stored for the same answer: the model's rows, no flag, no record, no full figures.
    const legacy: AiPrescription = {
      ...stored, fullSession: undefined,
      exercises: stored.exercises.map(({ deloaded: _d, deloadNote: _n, preDeload: _p, ...row }) => row),
    }
    const exercises = screenRows(legacy)
    expect(exercises.every(e => !e.deloaded && !e.preDeloadStyle)).toBe(true)
    expect(deloadOverrideOutcome(exercises, true, { periodization: { prescription: legacy, prescriptionStatus: 'auto_applied' }, deloadWeek: false }))
      .toBe('nothing-to-revert')
    // Served again, it is the same plan: nothing in the read path writes a record onto it.
    expect(legacy.exercises.every(e => e.deloaded === undefined && e.preDeload === undefined)).toBe(true)
  })
})



// ── After review (#4101) ────────────────────────────────────────────────────────────────────────────

const GOALS = ['strength', 'hypertrophy', 'power', 'powerbuilding'] as const
const LENGTHS = [30, 60, 90] as const
const sigFor = (goal: string, phase: string, minutes: number, exs?: Ex[]) =>
  signals({ trainingGoal: goal, phase, effectiveTimeBudgetMin: minutes } as Partial<PrescriptionSignals>, exs)
const modelDeloadPlan = (goal: string, reps?: number): AiPrescription => ({
  phase: 'deload', phaseAction: 'deload_recommended', deload: true, reasoning: 'r', confidence: 0.5,
  estimatedSessionDurationMin: 20, weeklyVolumeContribution: {},
  exercises: [
    { sessionExerciseId: 'p', name: 'Lift p', sets: 3, reps: reps ?? (goal === 'power' ? 5 : 6), pct: 52.5, restSec: 150 },
    { sessionExerciseId: 's', name: 'Lift s', sets: 3, reps: 8, pct: 52.5, restSec: 150 },
    { sessionExerciseId: 'a', name: 'Lift a', sets: 3, reps: 12, pct: 45, restSec: 60 },
  ],
} as unknown as AiPrescription)

describe('review 1 — a model-written deload in the planned deload week restores what the engine\'s own deload restores', () => {
  it('Full equals the whole-session builder\'s, over goals × session lengths', () => {
    let cells = 0
    for (const goal of GOALS) for (const minutes of LENGTHS) {
      const sig = sigFor(goal, 'deload', minutes)
      const engine = buildWholeSessionDeloadPrescription(sig, 'r')
      const model = recordFullSessionOnModelDeload(modelDeloadPlan(goal), sig, 'deload')
      for (const row of model.exercises) {
        const want = engine.exercises.find(e => e.sessionExerciseId === row.sessionExerciseId)!.preDeload
        expect(row.preDeload, `${goal} ${minutes} ${row.sessionExerciseId}`).toEqual(want)
        cells++
      }
    }
    expect(cells).toBe(GOALS.length * LENGTHS.length * 3)
  })

  it('the numbers the bug gave: 3×6 @ 75 / 150 s program, model deload at 52.5 %, strength, hypertrophy and power', () => {
    for (const goal of ['strength', 'hypertrophy', 'power'] as const) {
      const model = recordFullSessionOnModelDeload(modelDeloadPlan(goal), sigFor(goal, 'deload', 90), 'deload')
      // Before: strength 3×6 @ 55, hypertrophy 10 reps @ 55, power 5 reps @ 60. The program says 3×6 @ 75.
      expect(NUM(rowOf(model, 'p').preDeload as never), goal).toEqual({ sets: 3, reps: 6, pct: 75, restSec: 150 })
    }
  })

  it('end to end, in a deload phase: Full gives the program\'s 3×6 @ 75 and a deload-phase stay is restorable too', async () => {
    mocks.answer = deloadAnswer(52.5)
    const h = program('ai_dynamic', 'deload')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    expect(stored.deload).toBe(true)
    expect(NUM(prescriptionRowAsTrained(rowOf(stored, 'p'), true))).toEqual({ sets: 3, reps: 6, pct: 75, restSec: 150 })
    mocks.answer = { ...deloadAnswer(52.5), phase_action: 'stay' }
    const h2 = program('ai_dynamic', 'deload')
    const r2 = ok(await h2.run())
    expect(r2.prescription.phaseAction).toBe('stay')
    const stay = h2.db.get('push')!.prescription!
    expect(stay.deload).toBe(true)
    expect(NUM(prescriptionRowAsTrained(rowOf(stay, 'p'), true))).toEqual({ sets: 3, reps: 6, pct: 75, restSec: 150 })
  })
})

/** The screen's read of a plan for a lift that has a stored preference (`buildWorkoutExercises` with `liftPreferences`). */
function screenWithPref(prescription: AiPrescription, pref: unknown, phase: 'normal' | 'deload' = 'normal') {
  const rows = screenRowsWith(prescription, new Map([['Lift p', pref as never]]), phase)
  return rows.find(r => r.sessionExerciseId === 'p')!
}
function screenRowsWith(prescription: AiPrescription, liftPreferences: BuildWorkoutExercisesCtx['liftPreferences'], phase: 'normal' | 'deload') {
  const session: ProgramSession = {
    id: 'push', programId: 'prog', name: 'Push', position: 0, timeBudgetMinutes: 90,
    exercises: ['p', 's', 'a'].map((id, i) => ({
      id, sessionId: 'push', exerciseName: `Lift ${id}`, muscleGroups: ['chest'], position: i,
      exerciseRole: id === 'p' ? 'primary' : id === 's' ? 'secondary' : 'accessory',
    })) as ProgramSession['exercises'],
  }
  const ctx: BuildWorkoutExercisesCtx = {
    lastLogs: new Map(), lastRealOneRm: new Map([['Lift p', { estimated1rm: 100, avgReps: 5 } as never]]), prMap: new Map(), estimateMap: new Map(),
    styleById: new Map(), styleByName: new Map(), styles: [], libByName: new Map(), currentPhase: null, allPhases: [],
    isDeloadActive: false, isBaselinePhase: false, aiDrivesLoad: true, aiPrescription: prescription, aiPhaseLabel: 'Deload',
    isAiDynamic: true, aiDeload: false, droppedThisCycle: new Set(), loggedTodayInThisSession: new Set(), trainingGoal: 'strength',
    liftPreferences,
  }
  void phase
  return buildWorkoutExercises(session, ctx)
}
const HOLD = { repRange: null, restSec: null, oneShot: null, checkinHold: { weekStart: '2026-11-23', barKg: 40 } }
const fullOf = (r: { preDeloadStyle?: Array<{ pct: number; reps: number; restSec: number }>; preDeloadSets?: number }) =>
  ({ sets: r.preDeloadSets, reps: r.preDeloadStyle![0].reps, pct: r.preDeloadStyle![0].pct, restSec: r.preDeloadStyle![0].restSec })

describe('review 3 — a hold or preference saved after the plan was made reaches Full', () => {
  it('a 40 kg hold (basis 100) caps what Full restores on a model-written deload: 75 kg before, at most 40 kg now', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    expect(rowOf(stored, 'p').preDeload!.pct).toBe(75)
    const row = screenWithPref(stored, HOLD)
    expect(row.deloaded).toBe(true)
    const full = fullOf(row as never)
    expect(full.pct).toBeLessThanOrEqual(40)
    expect(full.sets).toBe(3)
    expect(full.reps).toBe(6)
  })

  it('the same on the engine\'s own whole-session deload (a behaviour change: it used to be skipped), and with no hold nothing moves', () => {
    const sig = sigFor('strength', 'accumulation', 90)
    const engine = buildWholeSessionDeloadPrescription(sig, 'r')
    expect(engine.deload).toBe(true)
    const held = fullOf(screenWithPref(engine, HOLD) as never)
    expect(held.pct).toBeLessThanOrEqual(40)
    const free = screenRowsWith(engine, new Map(), 'normal')
    const none = screenRowsWith(engine, new Map([['Lift p', { repRange: null, restSec: null, oneShot: null } as never]]), 'normal')
    expect(none).toEqual(free)
    expect(fullOf(free.find(r => r.sessionExerciseId === 'p') as never).pct).toBe(75)
  })

  it('a rep range and a rest preference reach Full in the deload week as well', () => {
    const sig = sigFor('strength', 'deload', 90)
    const model = recordFullSessionOnModelDeload(modelDeloadPlan('strength'), sig, 'deload')
    const row = screenWithPref(model, { repRange: { min: 9, max: 10 }, restSec: 200, oneShot: null, checkinHold: null }, 'deload')
    const full = fullOf(row as never)
    expect(full.reps).toBeGreaterThanOrEqual(9)
    expect(full.reps).toBeLessThanOrEqual(10)
    expect(full.restSec).toBe(200)
    expect(full.pct).toBeLessThan(75)
  })
})

describe('review 4 — a Coach rep range set after the plan was made reaches Full', () => {
  it('a model-written deload stored with 3×6 @ 75 gives 9-10 reps under Full once the range is 9-10', async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    const stored = h.db.get('push')!.prescription!
    expect(rowOf(stored, 'p').preDeload!.reps).toBe(6)
    const full = fullOf(screenWithPref(stored, { repRange: { min: 9, max: 10 }, restSec: null, oneShot: null, checkinHold: null }) as never)
    expect(full.reps).toBe(9)
    expect(full.pct).toBeLessThan(75)
  })
})

describe('review 2 — a soreness or illness signal still lightens a model-written deload, to what `main` gave', () => {
  const override = deloadOverrideForGoal('strength')
  const sigs = (over: Record<string, unknown> = {}) => ({
    soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], hoursSinceLastSession: 48, activeInjuredMusclesInSession: [],
    trainingGoal: 'strength', illnessFlag: null, selfReportedSick: false,
    exercises: [
      { sessionExerciseId: 'p', name: 'Lift p', muscleAssignments: [{ muscle: 'quadriceps', role: 'main' as const }] },
      { sessionExerciseId: 's', name: 'Lift s', muscleAssignments: [{ muscle: 'back', role: 'main' as const }] },
      { sessionExerciseId: 'a', name: 'Lift a', muscleAssignments: [{ muscle: 'biceps', role: 'main' as const }] },
    ],
    ...over,
  })
  const stored = async () => {
    const h = program('ai_dynamic')
    ok(await h.run())
    return h
  }
  const run = (h: Awaited<ReturnType<typeof stored>>, s: ReturnType<typeof sigs>, underWay = false) => {
    const state = h.db.get('push')!
    return reevaluatePrescriptionForToday(state.prescription!, s as never, {
      phase: 'accumulation', prescription: state.prescription!, prescriptionStatus: 'auto_applied',
      prescriptionExpiresAt: state.prescriptionExpiresAt, sessionsInPhase: 2, underWay,
    }, NOW)
  }
  const lightened = { sets: override.sets, reps: override.reps, pct: override.pct, restSec: override.restSec }

  it('the engine\'s override is lighter than the model\'s deload in the stored plan (the premise)', async () => {
    const h = await stored()
    expect(NUM(rowOf(h.db.get('push')!.prescription!, 'p'))).toEqual({ sets: 3, reps: 6, pct: 55, restSec: 90 })
    expect(lightened).toEqual({ sets: 2, reps: 6, pct: 50, restSec: 120 })
  })

  it('soreness on one lift lightens that lift to 2×6 @ 50 / 120 s, as on main; the others keep the model\'s rows', async () => {
    const h = await stored()
    const before = h.db.get('push')!.prescription!
    const out = run(h, sigs({ soreMusclesInSession: ['Quads'] }))
    expect(out.changed).toBe(true)
    expect(NUM(rowOf(out.prescription, 'p'))).toEqual({ sets: 2, reps: 6, pct: 50, restSec: 120 })
    expect(rowOf(out.prescription, 'p').preDeload).toEqual(rowOf(before, 'p').preDeload)
    expect(rowOf(out.prescription, 'p').deloadNote).toBe('Deload — quads still sore')
    expect(NUM(rowOf(out.prescription, 's'))).toEqual(NUM(rowOf(before, 's')))
  })

  it('illness radar elevated, under way or not, lightens every row to 2×6 @ 50 / 120 s', async () => {
    for (const underWay of [false, true]) {
      const h = await stored()
      const out = run(h, sigs({ illnessFlag: 'elevated' }), underWay)
      for (const id of ['p', 's', 'a']) expect(NUM(rowOf(out.prescription, id)), `${id} ${underWay}`).toEqual(lightened)
      expect(rowOf(out.prescription, 'p').deloadNote).toBe('Deload — illness radar: elevated')
    }
  })

  it('several sore muscles while under way lighten every row to 2×6 @ 50 / 120 s', async () => {
    const h = await stored()
    const out = run(h, sigs({ soreMusclesInSession: ['Quads', 'Lats', 'Biceps'] }), true)
    for (const id of ['p', 's', 'a']) expect(NUM(rowOf(out.prescription, id))).toEqual(lightened)
    // A second read changes nothing.
    const again = reevaluatePrescriptionForToday(out.prescription, sigs({ soreMusclesInSession: ['Quads', 'Lats', 'Biceps'] }) as never, {
      phase: 'accumulation', prescription: out.prescription, prescriptionStatus: 'auto_applied',
      prescriptionExpiresAt: h.db.get('push')!.prescriptionExpiresAt, sessionsInPhase: 2, underWay: true,
    }, NOW)
    expect(again.changed).toBe(false)
  })

  it('a row the model already wrote lighter than the override is not made heavier', async () => {
    const h = await stored()
    const state = h.db.get('push')!
    const light = { ...state.prescription!, exercises: state.prescription!.exercises.map(e => e.sessionExerciseId === 'p' ? { ...e, sets: 1, pct: 40 } : e) }
    const out = reevaluatePrescriptionForToday(light, sigs({ soreMusclesInSession: ['Quads'] }) as never, {
      phase: 'accumulation', prescription: light, prescriptionStatus: 'auto_applied',
      prescriptionExpiresAt: state.prescriptionExpiresAt, sessionsInPhase: 2,
    }, NOW)
    expect(NUM(rowOf(out.prescription, 'p'))).toEqual({ sets: 1, reps: 6, pct: 40, restSec: 120 })
  })
})
