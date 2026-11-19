/**
 * #3876 and #3877, from the 19 Nov staged review (#3871). The model is mocked throughout: no live
 * calls. Fixtures sit at local midday unless the dates come from the issue.
 *
 * The production shape (#3876), five session types while the program waits for its switch-over:
 *   · type A: deload sessions on 5, 12 and 19 Nov; its deload start was rewritten on 18 Nov at
 *     22:37:28Z (a "Move to Deload" on a type already in one), so it counts 1 session.
 *   · type B: deload sessions on 9 and 16 Nov, so its deload is done; its next plan was a deload again.
 *   · types C, D and E: on their own phases, started before the rule shipped.
 * The stored switch-over date is Mon 23 Nov (B finished on the 16th), written before #3876 and so
 * without the instant it became known.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription, PendingTransition, PeriodizationPhase, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { planSwitchOver, programMoveMark, switchOverWait, type PhaseRow, type ProgramCompletion } from '../program-phase'
import { deloadExitPhase, isDeloadPlan, typeDeloadFinished, DELOAD_FLOOR } from '../phase-guards'
import { isAiPrescriptionPending } from '../prescription-pending'

const mocks = vi.hoisted(() => ({ signals: null as unknown, modelAnswer: null as unknown }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async () => ({ object: structuredClone(mocks.modelAnswer) }),
}))
const { generatePrescriptionForSession, buildProgramAsWrittenPrescription } = await import('../generate-prescription')

const TZ = 'Australia/Brisbane'
const at = (local: string) => new Date(`${local}+10:00`)
const done = (id: string, local: string): ProgramCompletion => ({ programSessionId: id, completedAt: at(local) })
const row = (id: string, phase: PhaseRow['phase'], start: Date, sessionsInPhase = 0, over: Partial<PhaseRow> = {}): PhaseRow => ({
  programSessionId: id, phase, phaseStartedAt: start, sessionsInPhase, baselineComplete: true, pendingTransition: null, ...over,
})

/** The stamp as production holds it: date known, instant not recorded (written before #3876). */
const legacyStamp = (day: string): PendingTransition => {
  const { switchOverKnownAt: _drop, ...rest } = switchOverWait(day, null)
  return rest
}

const RESTART_A = new Date('2026-11-18T22:37:28Z')
const productionRows = (stamp: PendingTransition | null): PhaseRow[] => [
  row('a', 'deload', RESTART_A, 1, { pendingTransition: stamp }),
  row('b', 'deload', at('2026-11-08T12:00:00'), 2, { pendingTransition: stamp }),
  row('c', 'accumulation', at('2026-10-24T12:00:00'), 6, { pendingTransition: stamp }),
  row('d', 'intensification', at('2026-10-08T12:00:00'), 8, { pendingTransition: stamp }),
  row('e', 'accumulation', at('2026-09-10T12:00:00'), 10, { pendingTransition: stamp }),
]
const productionHistory = (): ProgramCompletion[] => [
  done('a', '2026-11-05T12:00:00'), done('a', '2026-11-12T12:00:00'),
  // 19 Nov's session began 9 s after the restart (08:37:37 local) and finished an hour later.
  { programSessionId: 'a', completedAt: new Date('2026-11-18T23:40:00Z') },
  done('b', '2026-11-09T12:00:00'), done('b', '2026-11-16T12:00:00'),
]

// ── Bound the switch-over wait (#3876, item 3) ──────────────────────────────────────────────

describe('a deload begun after the switch-over date is known does not move it', () => {
  it('production: the restart of 18 Nov no longer holds the 23 Nov switch-over', () => {
    const rows = productionRows(legacyStamp('2026-11-23'))
    expect(planSwitchOver(rows, productionHistory(), TZ, at('2026-11-20T12:00:00')))
      .toMatchObject({ kind: 'waiting', reason: 'before_start', startDay: '2026-11-23' })
    expect(planSwitchOver(rows, productionHistory(), TZ, at('2026-11-23T08:00:00')))
      .toMatchObject({ kind: 'switch', startDay: '2026-11-23' })
  })

  it('the legacy stamp is given the instant once, from the Monday of the week before the date', () => {
    const plan = planSwitchOver(productionRows(legacyStamp('2026-11-23')), productionHistory(), TZ, at('2026-11-20T12:00:00'))
    expect(plan.kind === 'waiting' && plan.stamp).toMatchObject({
      switchOverOn: '2026-11-23', switchOverKnownAt: at('2026-11-16T00:00:00').toISOString(),
    })
  })

  it('date known, then a type restarts a deload: the date holds', () => {
    const stamp = switchOverWait('2026-11-23', at('2026-11-16T12:00:00').toISOString())
    // C restarts a deload on Fri 20 Nov and trains it once on Sat 21.
    const rows = [
      row('b', 'accumulation', at('2026-11-17T12:00:00'), 0, { pendingTransition: stamp }),
      row('c', 'deload', at('2026-11-20T12:00:00'), 1, { pendingTransition: stamp }),
      row('d', 'intensification', at('2026-10-08T12:00:00'), 8, { pendingTransition: stamp }),
    ]
    const history = [done('c', '2026-11-21T12:00:00')]
    const before = planSwitchOver(rows, history, TZ, at('2026-11-22T12:00:00'))
    expect(before).toMatchObject({ kind: 'waiting', reason: 'before_start', startDay: '2026-11-23' })
    expect(before.kind === 'waiting' && before.stamp).toBeNull() // nothing to rewrite
    expect(planSwitchOver(rows, history, TZ, at('2026-11-23T08:00:00'))).toMatchObject({ kind: 'switch', startDay: '2026-11-23' })
  })

  it('a deload already under way when the date became known still holds it, as signed', () => {
    const stamp = switchOverWait('2026-11-23', at('2026-11-16T12:00:00').toISOString())
    const rows = [
      row('b', 'accumulation', at('2026-11-17T12:00:00'), 0, { pendingTransition: stamp }),
      row('c', 'deload', at('2026-11-12T12:00:00'), 1, { pendingTransition: stamp }),
    ]
    expect(planSwitchOver(rows, [done('c', '2026-11-13T12:00:00')], TZ, at('2026-11-23T08:00:00')))
      .toMatchObject({ kind: 'waiting', reason: 'deload_in_progress' })
  })

  it('the first time a date is known, the stamp records when', () => {
    const now = at('2026-11-18T12:00:00')
    const rows = [
      row('b', 'deload', at('2026-11-08T12:00:00'), 2),
      row('d', 'intensification', at('2026-10-08T12:00:00'), 8),
    ]
    const plan = planSwitchOver(rows, [done('b', '2026-11-09T12:00:00'), done('b', '2026-11-16T12:00:00')], TZ, now)
    expect(plan.kind === 'waiting' && plan.stamp).toMatchObject({ switchOverOn: '2026-11-23', switchOverKnownAt: now.toISOString() })
  })
})

// ── Where a finished deload goes (#3876, item 2) ────────────────────────────────────────────

describe('a finished deload goes back to the phase it was entered from', () => {
  it('back to accumulation or intensification as recorded', () => {
    expect(deloadExitPhase('accumulation', null)).toBe('accumulation')
    expect(deloadExitPhase('intensification', null)).toBe('intensification')
  })
  it('a deload entered from realisation closes the cycle: accumulation', () => {
    expect(deloadExitPhase('realisation', null)).toBe('accumulation')
  })
  it('with nothing recorded, the program\'s phase; with none, accumulation', () => {
    expect(deloadExitPhase(null, 'intensification')).toBe('intensification')
    expect(deloadExitPhase(null, 'deload')).toBe('accumulation')
    expect(deloadExitPhase(null, null)).toBe('accumulation')
    expect(deloadExitPhase('baseline', null)).toBe('accumulation')
  })
  it('only a waiting program ends a deload per type, and only at the floor', () => {
    expect(typeDeloadFinished({ phase: 'deload', sessionsInPhase: DELOAD_FLOOR }, false)).toBe(true)
    expect(typeDeloadFinished({ phase: 'deload', sessionsInPhase: DELOAD_FLOOR - 1 }, false)).toBe(false)
    expect(typeDeloadFinished({ phase: 'deload', sessionsInPhase: DELOAD_FLOOR }, true)).toBe(false)
    expect(typeDeloadFinished({ phase: 'accumulation', sessionsInPhase: 5 }, false)).toBe(false)
  })
})

describe('the deload flag is worked out in code (#3877, item 2)', () => {
  it('true only in a deload phase or on a deload offer', () => {
    expect(isDeloadPlan('accumulation', 'stay')).toBe(false)
    expect(isDeloadPlan('accumulation', 'transition_recommended')).toBe(false)
    expect(isDeloadPlan('realisation', 'deload_recommended')).toBe(true)
    expect(isDeloadPlan('deload', 'stay')).toBe(true)
  })
})

// ── Generation ──────────────────────────────────────────────────────────────────────────────

const exercise = (id: string) => ({
  sessionExerciseId: id, name: `Lift ${id}`, role: 'primary', muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: [], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }],
})
const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise('x')], phase: 'accumulation', sessionsInPhase: 0, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
}) as unknown as PrescriptionSignals

const stayAnswer = (phase: string, over: Record<string, unknown> = {}) => ({
  phase, phase_action: 'stay', deload: false, confidence: 0.9, reasoning: 'Keep going.',
  exercises: [{ session_exercise_id: 'x', name: 'Lift x', sets: 3, reps: 6, pct: 72, rest_sec: 150 }],
  ...over,
})

type Slot = SessionPeriodization

/**
 * A program in memory that behaves like the Postgres slice for what generation touches: counts are
 * reconciled from completions, `advancePhase` keeps the waiting stamp and records the phase a deload
 * was entered from, `setProgramPhase` refuses a program move on a program that has not switched,
 * and `storePrescription` stores only into the phase and start the plan was made for.
 */
function memoryProgram(
  initial: PhaseRow[], completions: ProgramCompletion[], pre: Record<string, PeriodizationPhase | null> = {},
  opts: { failStore?: boolean } = {},
) {
  let rows: Slot[] = initial.map(r => ({
    ...r, prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
    preEmergencyDeloadPhase: pre[r.programSessionId] ?? null,
  })) as unknown as Slot[]
  const typeMoves: Array<[string, string]> = []
  const programMoves: unknown[] = []
  const stored: Array<{ id: string; prescription: AiPrescription; status: string }> = []
  const find = (id: string) => rows.find(r => r.programSessionId === id)!
  const phased = (r: Slot) => r.baselineComplete && r.phase !== 'baseline'
  const known: Record<string, unknown> = {
    getActiveProgram: async () => ({ id: 'prog', sessions: rows.map(r => ({ id: r.programSessionId, timeBudgetMinutes: 90 })) }),
    ensureSessionPeriodization: async (_u: string, id: string) => ({ ...find(id) }),
    getSessionPeriodization: async (_u: string, id: string) => ({ ...find(id) }),
    reconcileSessionsInPhase: async () => {
      rows = rows.map(r => ({
        ...r,
        sessionsInPhase: completions.filter(c => c.programSessionId === r.programSessionId && c.completedAt >= r.phaseStartedAt).length,
      }))
    },
    listSessionPeriodizationForProgram: async () => rows.map(r => ({ ...r })),
    listProgramCompletions: async (_u: string, _p: string, since: Date) => completions.filter(c => c.completedAt >= since),
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async (_u: string, _p: string, phase: PeriodizationPhase, startedAt: Date, pending: PendingTransition | null, opts?: { expect?: unknown }) => {
      const rowsPhased = rows.filter(phased)
      const expect = opts?.expect as { phase: string; phaseStartedAt: Date } | 'switch-over' | undefined
      if (expect && expect !== 'switch-over'
        && !rowsPhased.every(r => r.phase === expect.phase && r.phaseStartedAt.getTime() === expect.phaseStartedAt.getTime())) return false
      const mark = programMoveMark(phase, pending)
      rows = rows.map(r => (phased(r)
        ? { ...r, phase, phaseStartedAt: startedAt, sessionsInPhase: 0, pendingTransition: mark, prescription: null, prescriptionStatus: 'consumed' } as Slot
        : r))
      return true
    },
    setProgramPendingTransition: async (_u: string, _p: string, decide: (r: Slot[]) => PendingTransition | null) => {
      const pending = decide(rows)
      if (pending) rows = rows.map(r => (phased(r) ? { ...r, pendingTransition: pending } : r))
    },
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    advancePhase: async (_u: string, id: string, phase: PeriodizationPhase) => {
      typeMoves.push([id, phase])
      rows = rows.map(r => (r.programSessionId === id
        ? {
            ...r, phase, phaseStartedAt: new Date(), sessionsInPhase: 0,
            pendingTransition: r.pendingTransition?.switchOverPending ? r.pendingTransition : null,
            preEmergencyDeloadPhase: phase === 'deload' ? (r.phase !== 'deload' ? r.phase : r.preEmergencyDeloadPhase) : null,
            prescription: null, prescriptionStatus: 'none',
          }
        : r))
      return { ...find(id) }
    },
    // The slice's conditional exit: moves the row only while it is the deload that started then, and
    // leaves the slot 'consumed'.
    exitDeload: async (_u: string, id: string, phase: PeriodizationPhase, deloadStartedAt: Date) => {
      const r = find(id)
      if (r.phase !== 'deload' || r.phaseStartedAt.getTime() !== deloadStartedAt.getTime()) return false
      typeMoves.push([id, phase])
      rows = rows.map(x => (x.programSessionId === id
        ? {
            ...x, phase, phaseStartedAt: new Date(), sessionsInPhase: 0,
            pendingTransition: x.pendingTransition?.switchOverPending ? x.pendingTransition : null,
            preEmergencyDeloadPhase: null, prescription: null, prescriptionStatus: 'consumed',
          } as Slot
        : x))
      return true
    },
    advanceProgramPhase: async (_u: string, id: string, phase: PeriodizationPhase, expected?: { phase: string; phaseStartedAt: Date }) => {
      programMoves.push([id, phase])
      await (known.setProgramPhase as (...a: unknown[]) => Promise<boolean>)('u', 'prog', phase, new Date(), null, { expect: expected })
      return { ...find(id) }
    },
    storePrescription: async (_u: string, id: string, prescription: AiPrescription, _e: Date, status: string, generatedFor?: { phase: string; phaseStartedAt: Date }) => {
      if (opts.failStore) throw new Error('connection lost')
      const r = find(id)
      if (generatedFor && (r.phase !== generatedFor.phase || r.phaseStartedAt.getTime() !== generatedFor.phaseStartedAt.getTime())) return false
      stored.push({ id, prescription, status })
      rows = rows.map(x => (x.programSessionId === id ? { ...x, prescription, prescriptionStatus: status } as Slot : x))
      return true
    },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  let n = 0
  return {
    repo, typeMoves, programMoves, stored, row: find,
    plan: (id: string) => generatePrescriptionForSession(`u-3876-${++n}-${Math.random()}`, id, repo, TZ),
  }
}

describe('a deload ends by itself after its two sessions (#3876, owner 19 Nov)', () => {
  const NOW = at('2026-11-20T12:00:00')
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mocks.signals = signals()
    mocks.modelAnswer = stayAnswer('accumulation')
  })
  afterEach(() => vi.useRealTimers())

  it('production: type B leaves its deload at its next plan, with auto-apply off, and plans accumulation', async () => {
    const p = memoryProgram(productionRows(legacyStamp('2026-11-23')), productionHistory())
    const r = await p.plan('b')
    expect(p.typeMoves).toEqual([['b', 'accumulation']]) // nothing recorded, the program has no phase yet
    expect(p.row('b').phase).toBe('accumulation')
    expect(r.ok && r.prescription.phase).toBe('accumulation')
    expect(r.ok && r.prescription.deload).toBe(false)
    expect(r.ok && r.prescriptionStatus).toBe('pending')
    // Leaving the deload kept the switch-over's date.
    expect(p.row('b').pendingTransition).toMatchObject({ switchOverPending: true, switchOverOn: '2026-11-23' })
  })

  it('production: type A, its count reset to 1 by the restart, stays in its deload', async () => {
    mocks.modelAnswer = stayAnswer('deload')
    const p = memoryProgram(productionRows(legacyStamp('2026-11-23')), productionHistory())
    await p.plan('a')
    expect(p.typeMoves).toEqual([])
    expect(p.row('a').phase).toBe('deload')
  })

  it('the same with auto-apply on', async () => {
    mocks.signals = signals({ autoApplyPrescriptions: true, confidence: 0.9 })
    const p = memoryProgram(productionRows(legacyStamp('2026-11-23')), productionHistory())
    const r = await p.plan('b')
    expect(p.typeMoves).toEqual([['b', 'accumulation']])
    expect(r.ok && r.prescriptionStatus).toBe('auto_applied')
  })

  it('back to the phase recorded when the deload began', async () => {
    mocks.modelAnswer = stayAnswer('intensification')
    const p = memoryProgram(productionRows(legacyStamp('2026-11-23')), productionHistory(), { b: 'intensification' })
    const r = await p.plan('b')
    expect(p.typeMoves).toEqual([['b', 'intensification']])
    expect(r.ok && r.prescription.phase).toBe('intensification')
  })

  // #3876 after the switch-over: the owner's decision holds once the program is aligned too. The
  // program's deload ends at its cap (1 training week) by itself, with auto-apply off, and the plan is
  // made in accumulation. It used to be offered (ceiling-forced), which never auto-applies.
  it('an aligned program\'s deload ends by itself at its cap, with auto-apply off', async () => {
    const mark = programMoveMark('deload')
    const start = at('2026-11-09T00:00:00')
    const p = memoryProgram(
      [row('a', 'deload', start, 2, { pendingTransition: mark }), row('b', 'deload', start, 2, { pendingTransition: mark })],
      [done('a', '2026-11-10T12:00:00'), done('a', '2026-11-12T12:00:00'), done('b', '2026-11-11T12:00:00'), done('b', '2026-11-13T12:00:00')],
    )
    mocks.modelAnswer = stayAnswer('accumulation')
    const r = await p.plan('b')
    expect(p.typeMoves).toEqual([])
    expect(p.programMoves).toEqual([['b', 'accumulation']])
    expect(p.row('a').phase).toBe('accumulation')
    expect(p.row('b').phase).toBe('accumulation')
    expect(r.ok && r.prescription.phase).toBe('accumulation')
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
    expect(r.ok && r.prescription.deload).toBe(false)
  })

  it('an aligned program\'s deload short of its cap stays, and its plan is not a move', async () => {
    const mark = programMoveMark('deload')
    const start = at('2026-11-16T00:00:00')
    const p = memoryProgram(
      [row('a', 'deload', start, 2, { pendingTransition: mark }), row('b', 'deload', start, 2, { pendingTransition: mark })],
      [done('a', '2026-11-17T12:00:00'), done('a', '2026-11-19T12:00:00'), done('b', '2026-11-18T12:00:00'), done('b', '2026-11-19T13:00:00')],
    )
    mocks.modelAnswer = stayAnswer('deload')
    const r = await p.plan('b')
    expect(p.programMoves).toEqual([])
    expect(p.row('b').phase).toBe('deload')
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
    // Stamped with the count it was made at, so workout-data does not regenerate it again.
    expect(p.stored.at(-1)?.prescription.sessionsInPhaseAtPlan).toBe(2)
  })

  it('two generations of a finished deload at once: one exit, and both plans store', async () => {
    const p = memoryProgram(productionRows(legacyStamp('2026-11-23')), productionHistory())
    const [r1, r2] = await Promise.all([p.plan('b'), p.plan('b')])
    expect(p.typeMoves).toEqual([['b', 'accumulation']])
    expect(r1.ok && r2.ok).toBe(true)
    expect(p.row('b').phase).toBe('accumulation')
    expect(p.row('b').prescription?.phase).toBe('accumulation')
  })

  it('a generation that fails after the exit leaves a consumed slot, which the next open refills', async () => {
    const p = memoryProgram(productionRows(legacyStamp('2026-11-23')), productionHistory(), {}, { failStore: true })
    await expect(p.plan('b')).rejects.toThrow('connection lost')
    expect(p.typeMoves).toEqual([['b', 'accumulation']])
    expect(p.row('b')).toMatchObject({ phase: 'accumulation', prescription: null, prescriptionStatus: 'consumed' })
    expect(isAiPrescriptionPending(p.row('b'), { isAiDynamic: true, isBaselinePhase: false })).toBe(true)
  })
})

describe('generation, #3877', () => {
  const NOW = at('2026-11-20T12:00:00')
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mocks.signals = signals()
  })
  afterEach(() => vi.useRealTimers())

  // Waiting for the switch-over: E is in a deload it has not finished.
  const waitingRows = (): PhaseRow[] => [
    row('c', 'accumulation', at('2026-10-24T12:00:00'), 6),
    row('d', 'intensification', at('2026-10-08T12:00:00'), 8),
    row('e', 'deload', at('2026-11-17T12:00:00'), 0),
  ]

  it('the model\'s deload flag on a plain stay in accumulation is not stored', async () => {
    mocks.modelAnswer = stayAnswer('accumulation', { deload: true })
    const p = memoryProgram(waitingRows(), [])
    const r = await p.plan('c')
    expect(r.ok && r.prescription.deload).toBe(false)
    expect(p.stored.at(-1)?.prescription.deload).toBe(false)
  })

  // The rules path works its flag out the same way: the program-as-written plan in a deload phase
  // (the shadow's rules plan, `Full`'s revert) said `deload: false`.
  it('the program-as-written plan is a deload in a deload phase, and only there', () => {
    expect(buildProgramAsWrittenPrescription(signals({ phase: 'deload' }), '')?.deload).toBe(true)
    expect(buildProgramAsWrittenPrescription(signals({ phase: 'accumulation' }), '')?.deload).toBe(false)
  })

  it('a plan in a deload phase is a deload even when the model says it is not', async () => {
    mocks.modelAnswer = stayAnswer('deload', { deload: false })
    const p = memoryProgram(waitingRows(), [])
    const r = await p.plan('e')
    expect(r.ok && r.prescription.deload).toBe(true)
  })

  // The review read `generate-prescription.ts:814-845` as answering 409 here. On `main` the waiting
  // program's vote (`votedMove`, no program move) already turns the model's move into a stay before
  // the store, so the plan is stored; the auto-apply guard added beside it keeps the program move,
  // which a waiting program refuses, from ever being tried.
  it('auto-apply on a program waiting for its switch-over still stores a plan, never a 409', async () => {
    mocks.signals = signals({ autoApplyPrescriptions: true, confidence: 0.9 })
    mocks.modelAnswer = {
      ...stayAnswer('intensification'), phase_action: 'transition_recommended',
      exercises: [{ session_exercise_id: 'x', name: 'Lift x', sets: 4, reps: 4, pct: 85, rest_sec: 180 }],
    }
    const p = memoryProgram(waitingRows(), [])
    const r = await p.plan('c')
    expect(r.ok).toBe(true)
    expect(p.programMoves).toEqual([])
    expect(p.stored).toHaveLength(1)
    expect(p.row('c').phase).toBe('accumulation')
    expect(p.row('c').prescription).not.toBeNull()
  })
})
