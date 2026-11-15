/**
 * #3766: one phase for the whole program, counted in training weeks (the rule the owner signed on
 * 15 Nov, switch-over included). The model is mocked throughout: no live calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import {
  trainingWeekOf, programPhaseView, applyProgramPhaseCap, programMoveTarget, collectVotes,
  planSwitchOver, syncProgramPhase, isProgramAligned, PROGRAM_PHASE_CAP_WEEKS,
  type PhaseRow, type ProgramCompletion, type PhaseVote,
} from '../program-phase'

const mocks = vi.hoisted(() => ({ signals: null as unknown, modelAnswer: null as unknown }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  // A copy: generation rewrites the answer in place.
  loggedGenerateObject: async () => ({ object: structuredClone(mocks.modelAnswer) }),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

const TZ = 'Australia/Brisbane'
const at = (local: string) => new Date(`${local}+10:00`)
const row = (id: string, phase: PhaseRow['phase'], start: Date, sessionsInPhase = 0, over: Partial<PhaseRow> = {}): PhaseRow => ({
  programSessionId: id, phase, phaseStartedAt: start, sessionsInPhase, baselineComplete: true, pendingTransition: null, ...over,
})
const done = (id: string, local: string): ProgramCompletion => ({ programSessionId: id, completedAt: at(local) })
const stay = { phase: 'accumulation', phaseAction: 'stay', reasoning: 'Keep building.' } as AiPrescription

describe('training weeks', () => {
  it('a week is the local Monday to Sunday', () => {
    expect(trainingWeekOf(at('2026-11-22T23:30:00'), TZ)).toBe('2026-11-16') // Sunday night
    expect(trainingWeekOf(at('2026-11-23T00:10:00'), TZ)).toBe('2026-11-23') // Monday just after midnight
    // 00:10 Monday in Brisbane is still Sunday in UTC, which a UTC week key would file a week early.
    expect(at('2026-11-23T00:10:00').getUTCDay()).toBe(0)
  })

  it('counts weeks with at least one completed session of ANY type, since the phase began, before this week', () => {
    const start = at('2026-11-02T00:00:00')
    const rows = [row('legs', 'accumulation', start), row('push', 'accumulation', start)]
    const completions = [
      done('legs', '2026-10-30T09:00:00'), // before the phase: not counted
      done('legs', '2026-11-03T09:00:00'), done('push', '2026-11-05T09:00:00'), // week of 2 Nov: one week
      // week of 9 Nov: nothing trained, so not a training week
      done('push', '2026-11-17T09:00:00'), // week of 16 Nov
      done('legs', '2026-11-24T09:00:00'), // this week
    ]
    const view = programPhaseView(rows, completions, TZ, at('2026-11-25T12:00:00'))
    expect(view.aligned).toBe(true)
    expect(view.trainingWeeksDone).toBe(2)
    expect(view.weekNumber).toBe(3)
    expect([...view.trainedThisWeek]).toEqual(['legs'])
  })

  it('a session type still in its baseline does not take part', () => {
    const start = at('2026-11-02T00:00:00')
    expect(isProgramAligned([
      row('legs', 'accumulation', start),
      row('new', 'baseline', at('2026-11-10T00:00:00'), 0, { baselineComplete: false }),
    ])).toBe(true)
    expect(isProgramAligned([row('legs', 'accumulation', start), row('pull', 'intensification', start)])).toBe(false)
  })
})

describe('the caps, in training weeks', () => {
  const viewAt = (phase: PhaseRow['phase'], weeks: number, pending: PhaseRow['pendingTransition'] = null) => {
    const start = at('2026-06-01T00:00:00')
    const completions = Array.from({ length: weeks }, (_, i) =>
      ({ programSessionId: 'a', completedAt: new Date(start.getTime() + (i * 7 + 1) * 86_400_000) }))
    return programPhaseView([row('a', phase, start, weeks, { pendingTransition: pending })], completions, TZ, new Date(start.getTime() + (weeks * 7 + 1) * 86_400_000))
  }

  it('matches the signed numbers', () => {
    expect(PROGRAM_PHASE_CAP_WEEKS).toEqual({ accumulation: 6, intensification: 5, realisation: 2, deload: 1 })
  })

  it.each([
    ['accumulation', 6, 'intensification'],
    ['intensification', 5, 'realisation'],
    ['realisation', 2, 'deload'],
    ['deload', 1, 'accumulation'],
  ] as const)('%s: a stay at %i weeks becomes the program\'s move to %s, and not a week before', (phase, cap, next) => {
    expect(applyProgramPhaseCap({ ...stay, phase }, viewAt(phase, cap - 1)).phaseAction).toBe('stay')
    const out = applyProgramPhaseCap({ ...stay, phase }, viewAt(phase, cap))
    expect(out.phaseAction).toBe('transition_recommended')
    expect(out.phase).toBe(next)
    expect(out.reasoning).toContain('training week')
  })

  it('leaves a recovery action alone past the cap', () => {
    const p = { ...stay, phaseAction: 'rest_day_recommended' } as AiPrescription
    expect(applyProgramPhaseCap(p, viewAt('accumulation', 9))).toBe(p)
  })

  it('the switch-over\'s scheduled move ends its accumulation block at 3 weeks', () => {
    const pending = { newPhase: 'intensification' as const, reasoning: 'x', urgency: 'normal' as const, afterTrainingWeeks: 3 }
    expect(viewAt('accumulation', 3, pending).capWeeks).toBe(3)
    expect(applyProgramPhaseCap(stay, viewAt('accumulation', 2, pending)).phaseAction).toBe('stay')
    expect(applyProgramPhaseCap(stay, viewAt('accumulation', 3, pending)).phase).toBe('intensification')
  })
})

describe('the early move: half of this week\'s session types, none asking to stay for recovery', () => {
  const v = (id: string, phaseAction: string, phase = 'intensification'): PhaseVote => ({ programSessionId: id, phase, phaseAction })

  it('one type alone never moves the program', () => {
    expect(programMoveTarget([v('a', 'transition_recommended')], 'accumulation')).toBeNull()
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'stay')], 'accumulation')).toBeNull()
  })

  it('two of three, and two of four, move it; two of five do not', () => {
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'stay')], 'accumulation')).toBe('intensification')
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'stay'), v('d', 'none')], 'accumulation')).toBe('intensification')
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', 'stay'), v('d', 'stay'), v('e', 'stay')], 'accumulation')).toBeNull()
  })

  it('one recovery answer holds the program', () => {
    for (const recovery of ['deload_recommended', 'rest_day_recommended', 'session_swap_recommended']) {
      expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended'), v('c', recovery)], 'accumulation')).toBeNull()
    }
  })

  it('agreement is on the SAME move', () => {
    expect(programMoveTarget([v('a', 'transition_recommended'), v('b', 'transition_recommended', 'realisation')], 'accumulation')).toBeNull()
  })

  it('a type trained this week with no recorded answer counts in the vote but never agrees', () => {
    const start = at('2026-11-16T00:00:00')
    const view = programPhaseView([row('a', 'accumulation', start), row('b', 'accumulation', start), row('c', 'accumulation', start)],
      [done('b', '2026-11-17T09:00:00'), done('c', '2026-11-18T09:00:00')], TZ, at('2026-11-19T09:00:00'))
    const votes = collectVotes(view, v('a', 'transition_recommended'), [v('b', 'transition_recommended')])
    expect(votes.map(x => x.phaseAction)).toEqual(['transition_recommended', 'transition_recommended', 'none'])
    expect(programMoveTarget(votes, 'accumulation')).toBe('intensification')
  })
})

describe('the switch-over (the owner\'s program, 14 Nov)', () => {
  // Legs deload (2 done), Lower deload (1 done), Pull intensification (5), Push accumulation (3),
  // Upper accumulation since 10 Sep (8).
  const rows = (lowerDone: number): PhaseRow[] => [
    row('legs', 'deload', at('2026-10-29T18:00:00'), 2),
    row('lower', 'deload', at('2026-11-06T18:00:00'), lowerDone),
    row('pull', 'intensification', at('2026-10-08T18:00:00'), 5),
    row('push', 'accumulation', at('2026-10-24T18:00:00'), 3),
    row('upper', 'accumulation', at('2026-09-10T18:00:00'), 8),
  ]
  const history = [
    done('legs', '2026-11-02T18:00:00'), done('legs', '2026-11-09T18:00:00'),
    done('lower', '2026-11-11T18:00:00'),
  ]

  it('waits while Lower is still in its deload', () => {
    expect(planSwitchOver(rows(1), history, TZ, at('2026-11-16T10:00:00'))).toEqual({ kind: 'waiting', reason: 'deload_in_progress' })
  })

  it('once Lower finishes it (Wed 18 Nov), every type starts accumulation week 1 on Monday 23 Nov', () => {
    const after = [...history, done('lower', '2026-11-18T18:00:00')]
    expect(planSwitchOver(rows(2), after, TZ, at('2026-11-20T10:00:00')))
      .toEqual({ kind: 'waiting', reason: 'before_start', startDay: '2026-11-23' })
    const plan = planSwitchOver(rows(2), after, TZ, at('2026-11-23T06:00:00'))
    expect(plan).toEqual({ kind: 'switch', startDay: '2026-11-23', startsAt: at('2026-11-23T00:00:00') })
  })

  it('never starts before the first Monday after the sign-off', () => {
    const plan = planSwitchOver([row('a', 'accumulation', at('2026-10-01T00:00:00')), row('b', 'intensification', at('2026-10-05T00:00:00'))], [], TZ, at('2026-11-15T10:00:00'))
    expect(plan).toEqual({ kind: 'waiting', reason: 'before_start', startDay: '2026-11-16' })
  })

  it('writes one phase, one start and the 3-week block on every row, once', async () => {
    let stored = rows(2) as unknown as SessionPeriodization[]
    const writes: unknown[][] = []
    const repo = {
      reconcileSessionsInPhase: async () => undefined,
      listSessionPeriodizationForProgram: async () => stored,
      listProgramCompletions: async () => [...history, done('lower', '2026-11-18T18:00:00')],
      setProgramPhase: async (...args: unknown[]) => {
        writes.push(args)
        stored = stored.map(r => ({ ...r, phase: args[2], phaseStartedAt: args[3], pendingTransition: args[4] })) as SessionPeriodization[]
      },
    }
    const view = await syncProgramPhase(repo, 'u', 'p', TZ, at('2026-11-23T06:00:00'))
    expect(writes).toHaveLength(1)
    expect(writes[0].slice(2, 4)).toEqual(['accumulation', at('2026-11-23T00:00:00')])
    expect(writes[0][4]).toMatchObject({ newPhase: 'intensification', afterTrainingWeeks: 3 })
    expect(view).toMatchObject({ aligned: true, phase: 'accumulation', weekNumber: 1, capWeeks: 3 })
    await syncProgramPhase(repo, 'u', 'p', TZ, at('2026-11-24T06:00:00'))
    expect(writes).toHaveLength(1)
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
  exercises: [exercise('a')], phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
}) as unknown as PrescriptionSignals

const moveAnswer = {
  phase: 'intensification', phase_action: 'transition_recommended', deload: false, confidence: 0.9, reasoning: 'Ready.',
  exercises: [{ session_exercise_id: 'a', name: 'Lift a', sets: 4, reps: 4, pct: 85, rest_sec: 180 }],
}

let n = 0
function harness(opts: { answers?: PhaseVote[]; trainedThisWeek?: string[]; aligned?: boolean } = {}) {
  const start = new Date(Date.now() - 10 * 86_400_000)
  const state = {
    programSessionId: 'push', phase: 'accumulation', phaseStartedAt: start, baselineComplete: true, sessionsInPhase: 2,
    prescription: null as AiPrescription | null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
    pendingTransition: null,
  }
  const others = ['legs', 'pull'].map(id => ({ ...state, programSessionId: id, ...(opts.aligned === false && id === 'pull' && { phase: 'intensification' }) }))
  const stored: AiPrescription[] = []
  const programMoves: string[] = []
  const typeMoves: string[] = []
  const known: Record<string, unknown> = {
    getActiveProgram: async () => ({ id: 'prog', sessions: ['push', 'legs', 'pull'].map(id => ({ id, timeBudgetMinutes: 90 })) }),
    ensureSessionPeriodization: async () => state,
    getSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: async () => [state, ...others],
    // Completed this week, so they are in the vote. `now` is the real clock here.
    listProgramCompletions: async () => (opts.trainedThisWeek ?? []).map(id => ({ programSessionId: id, completedAt: new Date(Date.now() - 60_000) })),
    listModelPhaseAnswers: async () => opts.answers ?? [],
    setProgramPhase: async () => undefined,
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p) },
    advanceProgramPhase: async (_u: string, _s: string, phase: string) => { programMoves.push(phase) },
    advancePhase: async (_u: string, _s: string, phase: string) => { typeMoves.push(phase) },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  return { stored, programMoves, typeMoves, run: () => generatePrescriptionForSession(`u-3766-${++n}`, 'push', repo, TZ) }
}

describe('generation follows the program', () => {
  beforeEach(() => { mocks.signals = signals(); mocks.modelAnswer = moveAnswer })

  it('one type\'s move is a stay, planned at the program\'s phase', async () => {
    const h = harness({ trainedThisWeek: ['legs'], answers: [{ programSessionId: 'legs', phase: 'accumulation', phaseAction: 'stay' }] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
    expect(r.ok && r.prescription.phase).toBe('accumulation')
    // Clamped to the accumulation zone, not the 85% the model asked for at intensification.
    expect(r.ok && r.prescription.exercises[0].pct).toBeLessThan(85)
    expect(r.ok && r.prescription.reasoning).toContain('whole program')
  })

  it('with another type agreeing (2 of 2 this week) the move is offered for the program', async () => {
    const h = harness({ trainedThisWeek: ['legs'], answers: [{ programSessionId: 'legs', phase: 'intensification', phaseAction: 'transition_recommended' }] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('transition_recommended')
    expect(r.ok && r.prescription.phase).toBe('intensification')
    expect(h.programMoves).toEqual([]) // auto-apply is off: it waits for the tap
  })

  it('an auto-applied move moves the program, never one type', async () => {
    mocks.signals = signals({ autoApplyPrescriptions: true, confidence: 0.9 })
    const h = harness({ trainedThisWeek: ['legs'], answers: [{ programSessionId: 'legs', phase: 'intensification', phaseAction: 'transition_recommended' }] })
    await h.run()
    expect(h.programMoves).toEqual(['intensification'])
    expect(h.typeMoves).toEqual([])
  })

  it('the others\' agreement carries the move to a session whose own answer was a stay', async () => {
    mocks.modelAnswer = { ...moveAnswer, phase: 'accumulation', phase_action: 'stay', exercises: [{ ...moveAnswer.exercises[0], pct: 75 }] }
    const agree = { phase: 'intensification', phaseAction: 'transition_recommended' }
    const h = harness({ trainedThisWeek: ['legs', 'pull'], answers: [{ programSessionId: 'legs', ...agree }, { programSessionId: 'pull', ...agree }] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('transition_recommended')
    expect(r.ok && r.prescription.phase).toBe('intensification')
  })

  it('while the program waits for its switch-over, no type moves', async () => {
    const h = harness({ aligned: false, trainedThisWeek: ['legs'], answers: [{ programSessionId: 'legs', phase: 'intensification', phaseAction: 'transition_recommended' }] })
    const r = await h.run()
    expect(r.ok && r.prescription.phaseAction).toBe('stay')
  })
})
