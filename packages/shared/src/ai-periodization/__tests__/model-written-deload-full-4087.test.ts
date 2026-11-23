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
const { generatePrescriptionForSession, buildProgramAsWrittenPrescription } = await import('../generate-prescription')

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
function program(kind: Kind) {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(NOW)
  const weekday = (new Date(`${todayStr}T12:00:00Z`).getUTCDay() + 6) % 7
  const thisMonday = shiftDateStr(todayStr, -weekday)
  const startDay = shiftDateStr(thisMonday, -14)
  const start = dateStrMidnightInTz(startDay, TZ)
  const completions = [0, 1].map(i => ({
    programSessionId: 'legs', completedAt: new Date(dateStrMidnightInTz(shiftDateStr(startDay, 7 * i + 2), TZ).getTime() + 12 * 3_600_000),
  }))
  const base = (id: string): Row => ({
    programSessionId: id, phase: 'accumulation', phaseStartedAt: start, sessionsInPhase: 2, baselineComplete: true,
    pendingTransition: programMoveMark('accumulation'),
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

