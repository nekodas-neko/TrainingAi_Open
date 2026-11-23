/**
 * #3900 (owner, 20 Nov; design steps 1, 2 and 4 approved the same day): on an `ai_dynamic` program a
 * generated plan applies by itself. A move forced by the template window cap applies too, with its
 * loads made in the new phase's zone; a plan under 0.6 confidence applies; a deload the engine
 * prescribes becomes the day's plan; a rest-day or swap suggestion is data on the plan, never a gate.
 * `automatic` and `manual` programs are decided exactly as before.
 *
 * The model is mocked throughout (0 real calls), and the repository is in memory with the same
 * compare-and-set the adapter's program move and store carry. Fixtures sit at local midday unless
 * the test is about a week boundary. Made-up lifts and numbers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription, PeriodizationPhase, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { programMoveMark, guardMoveTarget, type ProgramPhaseView } from '../program-phase'
import { aiPlanStatus, aiPlanCardState, isAiPlanProgram, AI_PRESCRIBED_DELOAD_APPLIES } from '../plan-status'
import { intensityZoneForRole } from '../prompt'
import { clampPrescribedPct } from '../autoregulation'
import { holdsOneDayDeload } from '../one-day-deload'
import { shouldTriggerEmergencyDeload } from '../emergency-deload'
import { reevaluatePrescriptionForToday } from '../reevaluate'
import { prescriptionDrivesLoad } from '../apply-prescription'
import { rowUnderFull } from '../prescription-figures'

const mocks = vi.hoisted(() => ({
  signals: null as unknown, answer: null as unknown, fail: false, calls: 0, prompts: [] as string[],
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => structuredClone(mocks.signals),
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { prompt: string }) => {
    mocks.calls++
    mocks.prompts.push(args.prompt)
    if (mocks.fail) throw new Error('model unavailable in this test')
    return { object: structuredClone(mocks.answer) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (_meta: unknown, run: (s: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

const BRISBANE = 'Australia/Brisbane'
const DAY = 86_400_000
const WEEK = 7 * DAY
const CAP: Record<string, number> = { accumulation: 6, intensification: 5, realisation: 2, deload: 1 }
const NEXT: Record<string, PeriodizationPhase> = {
  accumulation: 'intensification', intensification: 'realisation', realisation: 'deload', deload: 'accumulation',
}
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

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise('p', 'primary', 'quadriceps'), exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps')],
  phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
  soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.9, confidenceReasons: ['Test reason'], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
} as unknown as PrescriptionSignals)

const rows = (pct: number, reps: number) => [
  { session_exercise_id: 'p', name: 'Lift p', sets: 5, reps, pct, rest_sec: 180 },
  { session_exercise_id: 's', name: 'Lift s', sets: 4, reps: reps + 2, pct: pct - 5, rest_sec: 150 },
  { session_exercise_id: 'a', name: 'Lift a', sets: 3, reps: 12, pct: 60, rest_sec: 90 },
]
const answer = (phase: string, phaseAction: string, pct = 72, reps = 6) =>
  ({ phase, phase_action: phaseAction, deload: phaseAction === 'deload_recommended', confidence: 0.95, reasoning: 'Model says.', exercises: rows(pct, reps) })

interface Row {
  programSessionId: string; phase: PeriodizationPhase; phaseStartedAt: Date; sessionsInPhase: number
  baselineComplete: boolean; pendingTransition: ReturnType<typeof programMoveMark> | null
  prescription: AiPrescription | null; prescriptionStatus: PrescriptionStatus
  prescriptionExpiresAt: Date | null; prescriptionGeneratedAt: Date | null; preEmergencyDeloadPhase: null
}

let users = 0
/**
 * One program of three session types (push is planned; legs and pull are the others), all on one
 * phase that started `weeksDone` local weeks before `now`'s week, with one completed session of legs
 * in each of those weeks, so `weeksDone` training weeks are done.
 */
function program(opts: {
  kind?: Kind; tz?: string; now: Date; phase?: PeriodizationPhase; weeksDone: number
  voters?: boolean; waiting?: boolean; underWay?: boolean | 'throws'; checkinBudgetMin?: number | null
  stored?: { prescription: AiPrescription; status: PrescriptionStatus; expiresAt?: Date }
}) {
  const tz = opts.tz ?? BRISBANE
  const phase = opts.phase ?? 'accumulation'
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(opts.now)
  const weekday = (new Date(`${todayStr}T12:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const thisMonday = shiftDateStr(todayStr, -weekday)
  const startDay = shiftDateStr(thisMonday, -7 * opts.weeksDone)
  const start = dateStrMidnightInTz(startDay, tz)
  const completions = Array.from({ length: opts.weeksDone }, (_, i) =>
    ({ programSessionId: 'legs', completedAt: new Date(dateStrMidnightInTz(shiftDateStr(startDay, 7 * i + 2), tz).getTime() + 12 * 3_600_000) }))
  const voteAnswers: Array<{ programSessionId: string; phase: string; phaseAction: string; createdAt: Date }> = []
  if (opts.voters) {
    for (const [i, id] of ['legs', 'pull'].entries()) {
      const trainedAt = new Date(dateStrMidnightInTz(thisMonday, tz).getTime() + i * DAY + 12 * 3_600_000)
      if (trainedAt < opts.now) {
        completions.push({ programSessionId: id, completedAt: trainedAt })
        voteAnswers.push({ programSessionId: id, phase: NEXT[phase], phaseAction: 'transition_recommended', createdAt: new Date(trainedAt.getTime() - 4 * 3_600_000) })
      }
    }
  }
  const base = (id: string): Row => ({
    programSessionId: id, phase, phaseStartedAt: start, sessionsInPhase: 2, baselineComplete: true,
    pendingTransition: opts.waiting ? null : programMoveMark(phase),
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
    preEmergencyDeloadPhase: null,
  })
  const db = new Map<string, Row>(['push', 'legs', 'pull'].map(id => [id, base(id)]))
  if (opts.waiting) Object.assign(db.get('pull')!, { phase: phase === 'accumulation' ? 'intensification' : 'accumulation', phaseStartedAt: new Date(start.getTime() - 3 * WEEK) })
  if (opts.stored) {
    Object.assign(db.get('push')!, {
      prescription: opts.stored.prescription, prescriptionStatus: opts.stored.status,
      prescriptionExpiresAt: opts.stored.expiresAt ?? new Date(opts.now.getTime() + 3 * DAY), prescriptionGeneratedAt: new Date(opts.now.getTime() - 3_600_000),
    })
  }
  const log = { stores: [] as Array<{ prescription: AiPrescription; status: string; generatedFor: { phase: string; phaseStartedAt: Date } }>, moves: [] as Array<[string, string]>, refusedMoves: 0, typeMoves: [] as string[] }
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({
      program: {
        id: 'prog', ...(opts.kind && { phaseMode: opts.kind }), trainingGoal: 'strength',
        sessions: ['push', 'legs', 'pull'].map(id => ({ id, timeBudgetMinutes: 90, exercises: [] })),
      },
      structure: 'stamp',
    }),
    getCheckinSessionBudgetMin: async () => opts.checkinBudgetMin ?? null,
    ensureSessionPeriodization: async (_u: string, id: string) => ({ ...db.get(id)! }),
    getSessionPeriodization: async (_u: string, id: string) => ({ ...db.get(id)! }),
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: async () => [...db.values()].map(r => ({ ...r })),
    listProgramCompletions: async () => completions,
    listModelPhaseAnswers: async () => voteAnswers,
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    recordPrescriptionShadow: async () => undefined,
    getDaySessionSummaries: async () => {
      if (opts.underWay === 'throws') throw new Error('read failed')
      return opts.underWay ? [{ sessionId: 'push', sessionName: 'Push', startedAt: new Date(opts.now.getTime() - 1_800_000) }] : []
    },
    // The adapter's compare-and-set: the move lands only on rows still on the expected phase and start.
    advanceProgramPhase: async (_u: string, id: string, newPhase: PeriodizationPhase, expected?: { phase: string; phaseStartedAt: Date }) => {
      const all = [...db.values()]
      if (expected && !all.every(r => r.phase === expected.phase && r.phaseStartedAt.getTime() === expected.phaseStartedAt.getTime())) {
        log.refusedMoves++
        return null
      }
      const at = new Date()
      for (const r of all) Object.assign(r, { phase: newPhase, phaseStartedAt: at, sessionsInPhase: 0, prescriptionStatus: 'consumed', pendingTransition: programMoveMark(newPhase) })
      log.moves.push([expected?.phase ?? '?', newPhase])
      return { ...db.get(id)! }
    },
    advancePhase: async (_u: string, _id: string, p: string) => { log.typeMoves.push(p) },
    // The store's own check: the slot must still be in the phase and start the plan was made for.
    storePrescription: async (_u: string, id: string, prescription: AiPrescription, expiresAt: Date, status: PrescriptionStatus, generatedFor: { phase: string; phaseStartedAt: Date }) => {
      const r = db.get(id)!
      if (r.phase !== generatedFor.phase || r.phaseStartedAt.getTime() !== generatedFor.phaseStartedAt.getTime()) return false
      Object.assign(r, { prescription, prescriptionStatus: status, prescriptionExpiresAt: expiresAt, prescriptionGeneratedAt: new Date() })
      log.stores.push({ prescription, status, generatedFor })
      return true
    },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  const user = `u-3900-${++users}`
  return {
    db, log, start, tz,
    // A completion-path call (`excludeSessionId`) skips the read-through cooldown, as a re-plan would.
    run: (exclude?: string) => generatePrescriptionForSession(user, 'push', repo, tz, exclude),
  }
}

const NOW = new Date('2026-11-25T12:00:00+10:00') // Wednesday, Brisbane

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.calls = 0
  mocks.prompts = []
  mocks.fail = false
  mocks.signals = signals()
  mocks.answer = answer('accumulation', 'stay')
})
afterEach(() => vi.useRealTimers())

const ok = (r: Awaited<ReturnType<typeof generatePrescriptionForSession>>) => {
  if (!r.ok) throw new Error(`generation failed: ${r.error}`)
  return r
}
/** Inside the clamp every plan's compounds are held to (the zone's ceiling, a back-off under its floor). */
const inClamp = (goal: string, phase: PeriodizationPhase, row: AiPrescription['exercises'][number], role: 'primary' | 'secondary') => {
  const zone = intensityZoneForRole(goal as never, phase, role)
  const primary = intensityZoneForRole(goal as never, phase, 'primary')
  const lo = clampPrescribedPct(-1, zone)
  const hi = role === 'secondary' ? (primary.pctMax ?? 85) : (zone.pctMax ?? Infinity)
  return row.pct >= lo && row.pct <= hi
}
/** Inside the phase's own zone, load and reps: what the prompt tells the model to use there. */
const inZone = (goal: string, phase: PeriodizationPhase, row: AiPrescription['exercises'][number]) => {
  const zone = intensityZoneForRole(goal as never, phase, 'primary')
  return row.pct >= zone.pctMin && row.pct <= zone.pctMax && row.reps >= zone.repMin && row.reps <= zone.repMax
}

describe('the status decision (aiPlanStatus)', () => {
  it('every action applies, except a move the program cannot apply now', () => {
    expect(aiPlanStatus({ phaseAction: 'stay', movesPhase: false })).toBe('auto_applied')
    expect(aiPlanStatus({ phaseAction: 'rest_day_recommended', movesPhase: false })).toBe('auto_applied')
    expect(aiPlanStatus({ phaseAction: 'session_swap_recommended', movesPhase: false })).toBe('auto_applied')
    expect(aiPlanStatus({ phaseAction: 'transition_recommended', movesPhase: true })).toBe('auto_applied')
    expect(aiPlanStatus({ phaseAction: 'transition_recommended', movesPhase: false })).toBe('pending')
  })

  it('a prescribed deload applies while the one switch says so (the 2 Aug call reversed)', () => {
    expect(AI_PRESCRIBED_DELOAD_APPLIES).toBe(true)
    expect(aiPlanStatus({ phaseAction: 'deload_recommended', movesPhase: false })).toBe('auto_applied')
  })

  it('only ai_dynamic is the AI plan', () => {
    expect(isAiPlanProgram({ phaseMode: 'ai_dynamic' })).toBe(true)
    expect(isAiPlanProgram({ phaseMode: 'automatic' })).toBe(false)
    expect(isAiPlanProgram({ phaseMode: 'manual' })).toBe(false)
    expect(isAiPlanProgram(null)).toBe(false)
  })
})

describe('every program kind × the three kinds that always waited', () => {
  const kinds: Kind[] = ['ai_dynamic', 'automatic', 'manual']
  for (const kind of kinds) {
    for (const autoApply of [false, true]) {
      it(`${kind}, auto-apply ${autoApply ? 'on' : 'off'}: a move forced by the window cap`, async () => {
        mocks.signals = signals({ autoApplyPrescriptions: autoApply })
        const h = program({ kind, now: NOW, weeksDone: CAP.accumulation })
        const r = ok(await h.run())
        expect(r.prescription.phaseAction).toBe('transition_recommended')
        expect(r.prescription.phase).toBe('intensification')
        if (kind === 'ai_dynamic') {
          expect(r.prescriptionStatus).toBe('auto_applied')
          expect(h.log.moves).toEqual([['accumulation', 'intensification']])
          expect(h.log.stores.at(-1)?.generatedFor.phase).toBe('intensification')
        } else {
          expect(r.prescriptionStatus).toBe('pending')
          expect(h.log.moves).toEqual([])
        }
      })

      it(`${kind}, auto-apply ${autoApply ? 'on' : 'off'}: a deload the model offers`, async () => {
        mocks.signals = signals({ autoApplyPrescriptions: autoApply })
        mocks.answer = answer('deload', 'deload_recommended', 55, 6)
        const h = program({ kind, now: NOW, weeksDone: 2 })
        const r = ok(await h.run())
        expect(r.prescription.phaseAction).toBe('deload_recommended')
        expect(r.prescriptionStatus).toBe(kind === 'ai_dynamic' ? 'auto_applied' : 'pending')
        // A one-day deload never moves the phase (#3799), applied or not.
        expect(h.log.moves).toEqual([])
        expect(h.db.get('push')!.phase).toBe('accumulation')
      })

      it(`${kind}, auto-apply ${autoApply ? 'on' : 'off'}: a plan under 0.6 confidence`, async () => {
        mocks.signals = signals({ autoApplyPrescriptions: autoApply, confidence: 0.4, confidenceReasons: ['Little history yet.'] })
        const h = program({ kind, now: NOW, weeksDone: 2 })
        const r = ok(await h.run())
        expect(r.prescription.phaseAction).toBe('stay')
        expect(r.prescriptionStatus).toBe(kind === 'ai_dynamic' ? 'auto_applied' : 'pending')
        // The confidence is stored and shown as before; it no longer gates on the AI plan.
        expect(r.prescription.confidence).toBe(0.4)
        expect(r.prescription.confidenceReasons).toEqual(['Little history yet.'])
      })
    }
  }

  it('with the switch on and confidence met, the other kinds still apply a stay as before', async () => {
    for (const kind of ['automatic', 'manual'] as const) {
      mocks.signals = signals({ autoApplyPrescriptions: true })
      const r = ok(await program({ kind, now: NOW, weeksDone: 2 }).run())
      expect(r.prescriptionStatus).toBe('auto_applied')
    }
  })
})

describe('a move forced by the window cap applies with its loads in the new phase', () => {
  for (const [from, to] of [['accumulation', 'intensification'], ['intensification', 'realisation'], ['realisation', 'deload']] as const) {
    it(`${from} → ${to}: every compound's load is inside ${to}'s clamp, and the move is applied once`, async () => {
      mocks.signals = signals({ phase: from })
      mocks.answer = answer(from, 'stay', from === 'accumulation' ? 70 : from === 'intensification' ? 82 : 90, from === 'realisation' ? 2 : 5)
      const h = program({ kind: 'ai_dynamic', now: NOW, phase: from, weeksDone: CAP[from] })
      const r = ok(await h.run())
      expect(r.prescriptionStatus).toBe('auto_applied')
      expect(r.prescription.phase).toBe(to)
      expect(inClamp('strength', to, r.prescription.exercises.find(e => e.sessionExerciseId === 'p')!, 'primary')).toBe(true)
      // Not merely inside the clamp's floor: the primary is in the new phase's own zone, load and reps.
      expect(inZone('strength', to, r.prescription.exercises.find(e => e.sessionExerciseId === 'p')!)).toBe(true)
      expect(inClamp('strength', to, r.prescription.exercises.find(e => e.sessionExerciseId === 's')!, 'secondary')).toBe(true)
      // The loads are recorded as the new phase's, so a re-fit caps against it (#3713).
      expect(r.prescription.refitBaseline?.phase).toBe(to)
      // The same rationale an earned move gets (there is none written for the planned deload week).
      if (to !== 'deload') expect(r.prescription.transitionRationale).toBeTruthy()
      // A move into the planned deload week is a deload plan, from the phase (#3877).
      expect(r.prescription.deload).toBe(to === 'deload')
      expect(h.log.moves).toEqual([[from, to]])
      expect([...h.db.values()].every(row => row.phase === to)).toBe(true)
    })
  }

  it('every rule after the model still runs on the moved rows: a tapped Harder cuts below the zone\'s floor', async () => {
    mocks.signals = signals({
      exercises: [
        exercise('p', 'primary', 'quadriceps', { rpeDelta: 1.5, effortAnswer: 1, rm1Trend: 'down' } as Partial<Ex>),
        exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps'),
      ],
    })
    mocks.answer = answer('accumulation', 'stay', 70, 6)
    const r = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: CAP.accumulation }).run())
    const p = r.prescription.exercises.find(e => e.sessionExerciseId === 'p')!
    const zone = intensityZoneForRole('strength', 'intensification', 'primary')
    expect(p.autoregNote).toMatch(/felt harder/)
    expect(p.pct).toBeLessThan(zone.pctMin)
    expect(inClamp('strength', 'intensification', p, 'primary')).toBe(true)
  })

  it('a row the soreness deload cut keeps its deload numbers, and Full puts back the new phase\'s', async () => {
    mocks.signals = signals({ soreMusclesInSession: ['quadriceps'], sorenessLogDate: 'today', hoursSinceLastSession: 60 })
    mocks.answer = answer('accumulation', 'stay', 70, 6)
    const r = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: CAP.accumulation }).run())
    expect(r.prescriptionStatus).toBe('auto_applied')
    const p = r.prescription.exercises.find(e => e.sessionExerciseId === 'p')!
    expect(p.deloaded).toBe(true)
    const zone = intensityZoneForRole('strength', 'intensification', 'primary')
    expect(p.pct).toBeLessThan(zone.pctMin)
    expect(p.preDeload!.pct).toBeGreaterThanOrEqual(zone.pctMin)
    expect(p.preDeload!.reps).toBeLessThanOrEqual(zone.repMax)
  })

  it('the same answer on main\'s path (automatic) keeps the old phase\'s loads and waits', async () => {
    mocks.answer = answer('accumulation', 'stay', 70, 5)
    const ai = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: CAP.accumulation }).run())
    const before = ok(await program({ kind: 'automatic', now: NOW, weeksDone: CAP.accumulation }).run())
    const p = (r: typeof ai) => r.prescription.exercises.find(e => e.sessionExerciseId === 'p')!.pct
    expect(before.prescriptionStatus).toBe('pending')
    expect(inClamp('strength', 'intensification', before.prescription.exercises[0], 'primary')).toBe(false)
    expect(p(ai)).toBeGreaterThan(p(before))
  })

  it('the other types\' agreement carries the move the same way', async () => {
    mocks.answer = answer('accumulation', 'stay', 70, 5)
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2, voters: true })
    const r = ok(await h.run())
    expect(r.prescription.phase).toBe('intensification')
    expect(r.prescriptionStatus).toBe('auto_applied')
    expect(inZone('strength', 'intensification', r.prescription.exercises[0])).toBe(true)
    expect(h.log.moves).toEqual([['accumulation', 'intensification']])
  })

  it('a move the model earns still applies as before, with no re-clamp needed', async () => {
    mocks.answer = answer('intensification', 'transition_recommended', 84, 4)
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2, voters: true })
    const r = ok(await h.run())
    expect(r.prescriptionStatus).toBe('auto_applied')
    expect(h.log.moves).toEqual([['accumulation', 'intensification']])
  })

  it('a program still waiting for its switch-over offers its move and moves nothing', async () => {
    mocks.answer = answer('intensification', 'transition_recommended', 84, 4)
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 7, waiting: true })
    const r = ok(await h.run())
    expect(r.prescriptionStatus).toBe(r.prescription.phaseAction === 'transition_recommended' ? 'pending' : 'auto_applied')
    expect(h.log.moves).toEqual([])
    expect(h.log.typeMoves).toEqual([])
  })
})

describe('the window cap across a week boundary, in a timezone that is not the default', () => {
  // New York: the program's accumulation began at a local Monday midnight six weeks before Monday
  // 30 Nov, so its sixth training week ends at Sunday 29 Nov 23:59 local (04:59 UTC on Monday).
  const TZ = 'America/New_York'
  const sunday = new Date('2026-11-29T23:30:00-05:00')
  const monday = new Date('2026-11-30T00:30:00-05:00')

  it('late on the sixth week\'s Sunday, the plan is a stay in accumulation, applied', async () => {
    vi.setSystemTime(sunday)
    mocks.answer = answer('accumulation', 'stay', 70, 5)
    // Five full weeks before this one plus this week: the cap is not reached until Monday.
    const h = program({ kind: 'ai_dynamic', tz: TZ, now: sunday, weeksDone: CAP.accumulation - 1 })
    const r = ok(await h.run())
    expect(r.prescription.phaseAction).toBe('stay')
    expect(r.prescription.phase).toBe('accumulation')
    expect(r.prescriptionStatus).toBe('auto_applied')
    expect(h.log.moves).toEqual([])
  })

  it('just after local midnight on Monday the cap is reached: the move applies, loads re-clamped', async () => {
    vi.setSystemTime(monday)
    mocks.answer = answer('accumulation', 'stay', 70, 5)
    const h = program({ kind: 'ai_dynamic', tz: TZ, now: monday, weeksDone: CAP.accumulation })
    // The phase started at a local Monday midnight, never a UTC one.
    expect(h.start.toISOString()).toBe('2026-10-19T04:00:00.000Z')
    const r = ok(await h.run())
    expect(r.prescription.phase).toBe('intensification')
    expect(r.prescriptionStatus).toBe('auto_applied')
    expect(inZone('strength', 'intensification', r.prescription.exercises[0])).toBe(true)
    expect(inClamp('strength', 'intensification', r.prescription.exercises[1], 'secondary')).toBe(true)
    expect(h.log.moves).toEqual([['accumulation', 'intensification']])
  })
})

describe('a plan is never applied twice', () => {
  it('the next plan after an applied move plans in the new phase and moves nothing', async () => {
    mocks.answer = answer('accumulation', 'stay', 70, 5)
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: CAP.accumulation })
    ok(await h.run())
    mocks.answer = answer('intensification', 'stay', 84, 4)
    const second = ok(await h.run('ws-done'))
    expect(second.prescription.phase).toBe('intensification')
    expect(second.prescription.phaseAction).toBe('stay')
    expect(h.log.moves).toEqual([['accumulation', 'intensification']])
  })

  it('two generations racing from the same phase move the program once; the loser stores nothing', async () => {
    mocks.answer = answer('accumulation', 'stay', 70, 5)
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: CAP.accumulation })
    const [a, b] = await Promise.all([h.run('ws-a'), h.run('ws-b')])
    expect(h.log.moves).toHaveLength(1)
    expect(h.log.refusedMoves).toBe(1)
    expect([a, b].filter(r => r.ok)).toHaveLength(1)
    expect([a, b].find(r => !r.ok)).toMatchObject({ ok: false, status: 409 })
    expect(h.log.stores).toHaveLength(1)
  })
})

describe('a session under way is never re-planned (#3907)', () => {
  const held = (over: Partial<AiPrescription> = {}) => ({
    phase: 'accumulation', phaseAction: 'stay', reasoning: 'Held.', confidence: 0.9, deload: false,
    estimatedSessionDurationMin: 50, weeklyVolumeContribution: {},
    exercises: [{ sessionExerciseId: 'p', name: 'Lift p', sets: 3, reps: 5, pct: 70, restSec: 180 }], ...over,
  }) as AiPrescription

  for (const status of ['pending', 'auto_applied', 'accepted'] as const) {
    it(`a ${status} plan with a set logged today is returned as stored, even at the window cap`, async () => {
      const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: CAP.accumulation, underWay: true, stored: { prescription: held(), status } })
      const r = ok(await h.run())
      expect(r.prescription).toEqual(held())
      expect(r.prescriptionStatus).toBe(status)
      expect(mocks.calls).toBe(0)
      expect(h.log.moves).toEqual([])
      expect(h.log.stores).toEqual([])
    })
  }

  it('a plan turned down is not replaced mid-session by one that would apply by itself', async () => {
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2, underWay: true, stored: { prescription: held(), status: 'dismissed' } })
    expect(await h.run()).toMatchObject({ ok: false, status: 409 })
    expect(h.log.stores).toEqual([])
  })

  it('a failed read keeps the stored plan', async () => {
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2, underWay: 'throws', stored: { prescription: held(), status: 'auto_applied' } })
    const r = ok(await h.run())
    expect(r.prescription).toEqual(held())
    expect(h.log.stores).toEqual([])
  })

  it('a slot with no plan in it is planned as before', async () => {
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2, underWay: true })
    ok(await h.run())
    expect(h.log.stores).toHaveLength(1)
  })

  it('the other program kinds re-plan as before', async () => {
    const h = program({ kind: 'automatic', now: NOW, weeksDone: 2, underWay: true, stored: { prescription: held(), status: 'pending', expiresAt: new Date(NOW.getTime() - 1) } })
    ok(await h.run())
    expect(h.log.stores).toHaveLength(1)
  })
})

describe('a deload the engine prescribes is the day\'s plan, with Full as the override', () => {
  it('an emergency deload (a sick report) is stored applied and held for the day', async () => {
    mocks.signals = signals({ selfReportedSick: true, hoursSinceLastSession: 20 })
    const h = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2 })
    const r = ok(await h.run())
    expect(r.prescription.phaseAction).toBe('deload_recommended')
    expect(r.prescriptionStatus).toBe('auto_applied')
    expect(mocks.calls).toBe(0)
    expect(h.log.moves).toEqual([])
    const state = h.db.get('push')!
    // Held, not re-fired, not regenerated on the next read.
    expect(holdsOneDayDeload(state)).toBe(true)
    expect(shouldTriggerEmergencyDeload(mocks.signals as PrescriptionSignals, state)).toBe(false)
    const again = ok(await h.run('reopen'))
    expect(again.prescription).toEqual(h.db.get('push')!.prescription)
    expect(again.prescription.exercises).toEqual(r.prescription.exercises)
    expect(again.prescriptionStatus).toBe('auto_applied')
    expect(h.log.stores).toHaveLength(1)
    // It drives the bar, and the card says "Deload · prescribed".
    expect(prescriptionDrivesLoad(r.prescription.phaseAction, 'auto_applied')).toBe(true)
    expect(aiPlanCardState(r.prescription, 'auto_applied').deloadPrescribed).toBe(true)
  })

  it('"Train full instead" puts back the program\'s own numbers on every deloaded row (the Full override)', async () => {
    mocks.signals = signals({ selfReportedSick: true, hoursSinceLastSession: 20 })
    const r = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2 }).run())
    for (const row of r.prescription.exercises) {
      expect(row.deloaded).toBe(true)
      expect(row.preDeload).toEqual({ sets: 3, reps: 6, pct: 75, restSec: 150 })
      expect(rowUnderFull(row)).toMatchObject({ sets: 3, reps: 6, pct: 75, restSec: 150 })
    }
    expect(r.prescription.fullSession).toBeTruthy()
  })

  it('a whole-session soreness deload is applied too; on automatic it is still an offer', async () => {
    mocks.signals = signals({ soreMusclesInSession: ['quadriceps', 'back', 'biceps'], sorenessLogDate: 'today', hoursSinceLastSession: 60 })
    const ai = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2 }).run())
    const auto = ok(await program({ kind: 'automatic', now: NOW, weeksDone: 2 }).run())
    expect(ai.prescription.phaseAction).toBe('deload_recommended')
    expect(ai.prescriptionStatus).toBe('auto_applied')
    expect(auto.prescriptionStatus).toBe('pending')
    expect(ai.prescription).toEqual(auto.prescription)
  })

  it('the re-evaluation reads an applied deload exactly as an accepted one', () => {
    mocks.signals = signals()
    const p = { phase: 'deload', phaseAction: 'deload_recommended', deload: true, reasoning: 'x', confidence: 1, estimatedSessionDurationMin: 30, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: 'p', name: 'Lift p', sets: 2, reps: 6, pct: 50, restSec: 90, deloaded: true, preDeload: { sets: 3, reps: 6, pct: 75, restSec: 150 } }] } as AiPrescription
    const reeval = { soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], hoursSinceLastSession: 20, activeInjuredMusclesInSession: ['quadriceps'],
      trainingGoal: 'strength', illnessFlag: null, selfReportedSick: false,
      exercises: [{ sessionExerciseId: 'p', name: 'Lift p', muscleAssignments: [{ muscle: 'quadriceps', role: 'main' as const }] }] }
    const at = (status: PrescriptionStatus) => reevaluatePrescriptionForToday(p, reeval as never,
      { phase: 'accumulation', prescription: p, prescriptionStatus: status, prescriptionExpiresAt: new Date(NOW.getTime() + DAY), sessionsInPhase: 2 })
    expect(at('auto_applied')).toEqual(at('accepted'))
    expect(at('auto_applied').needsRegenerate).toBe(false)
  })
})

describe('a rest-day or swap suggestion never gates anything', () => {
  for (const action of ['rest_day_recommended', 'session_swap_recommended'] as const) {
    it(`${action} is applied, keeps its action as data for the card's note, and drives the bar`, async () => {
      mocks.answer = answer('accumulation', action)
      const r = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2 }).run())
      expect(r.prescriptionStatus).toBe('auto_applied')
      expect(r.prescription.phaseAction).toBe(action)
      expect(prescriptionDrivesLoad(action, r.prescriptionStatus)).toBe(true)
      expect(aiPlanCardState(r.prescription, r.prescriptionStatus).suggestion).toBe(action === 'rest_day_recommended' ? 'rest_day' : 'session_swap')
      expect(aiPlanCardState(r.prescription, r.prescriptionStatus).applied).toBe(true)
    })
  }
})

describe('every rule after the model still bounds a plan applied by itself', () => {
  // The automatic program with the switch off is main's path for the same answer: a pending plan,
  // which is what Accept takes (it only changes the status). Each applied plan must equal it.
  const both = async (sig: PrescriptionSignals, checkinBudgetMin: number | null = null) => {
    mocks.signals = sig
    mocks.answer = answer('accumulation', 'stay', 72, 6)
    const ai = program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2, checkinBudgetMin })
    const auto = program({ kind: 'automatic', now: NOW, weeksDone: 2, checkinBudgetMin })
    const a = ok(await ai.run()), m = ok(await auto.run())
    expect(a.prescriptionStatus).toBe('auto_applied')
    expect(m.prescriptionStatus).toBe('pending')
    expect(a.prescription).toEqual(m.prescription)
    return a.prescription
  }

  it('a lift preference: the rep range and the preferred rest', async () => {
    const p = await both(signals({
      exercises: [
        exercise('p', 'primary', 'quadriceps'),
        exercise('s', 'secondary', 'back', { liftPreference: { preference: { repRange: { min: 10, max: 12 }, restSec: 100, oneShot: null }, basisKg: 90 } } as Partial<Ex>),
        exercise('a', 'accessory', 'biceps'),
      ],
    }))
    const s = p.exercises.find(e => e.sessionExerciseId === 's')!
    expect(s.reps).toBeGreaterThanOrEqual(10)
    expect(s.reps).toBeLessThanOrEqual(12)
    expect(s.liftPreference).toBeTruthy()
  })

  it('the weekly check-in\'s hold ("Heavy"): the bar is no heavier than last time', async () => {
    const p = await both(signals({
      exercises: [
        exercise('p', 'primary', 'quadriceps', { liftPreference: { preference: { repRange: null, restSec: null, oneShot: null, checkinHold: { weekStart: '2026-11-23', barKg: 60 } }, basisKg: 100 } } as Partial<Ex>),
        exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps'),
      ],
    }))
    expect(p.checkinHold).toBeTruthy()
    expect(p.exercises.find(e => e.sessionExerciseId === 'p')!.pct).toBeLessThanOrEqual(60)
  })

  it('the weekly check-in\'s shorter session: the plan is fitted to it and records it', async () => {
    const p = await both(signals({ effectiveTimeBudgetMin: 45 }), 45)
    expect(p.checkinBudgetMin).toBe(45)
  })

  it('the effort answer (#4069): a tapped Harder cuts the load and says so', async () => {
    const p = await both(signals({
      exercises: [
        exercise('p', 'primary', 'quadriceps', { rpeDelta: 1.5, effortAnswer: 1, rm1Trend: 'down' } as Partial<Ex>),
        exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps'),
      ],
    }))
    expect(p.exercises.find(e => e.sessionExerciseId === 'p')!.autoregNote).toMatch(/felt harder/)
  })

  it('an injury in today\'s session reaches the model as before', async () => {
    await both(signals({ activeInjuredMusclesInSession: ['quadriceps'] }))
    expect(mocks.prompts).toHaveLength(2)
    expect(mocks.prompts[0]).toBe(mocks.prompts[1])
    expect(mocks.prompts[0]).toContain('quadriceps')
  })

  it('the program\'s own numbers when the model cannot be reached are applied; on automatic they wait', async () => {
    mocks.fail = true
    const ai = ok(await program({ kind: 'ai_dynamic', now: NOW, weeksDone: 2 }).run())
    const auto = ok(await program({ kind: 'automatic', now: NOW, weeksDone: 2 }).run())
    expect(ai.prescription.source).toBe('rules')
    expect(ai.prescriptionStatus).toBe('auto_applied')
    expect(auto.prescriptionStatus).toBe('pending')
    expect(ai.prescription).toEqual(auto.prescription)
  })
})

describe('guardMoveTarget is the guards\' own move, worked out before the clamps', () => {
  const view = (over: Partial<ProgramPhaseView>): ProgramPhaseView => ({
    aligned: true, phase: 'accumulation', phaseStartedAt: NOW, trainingWeeksDone: 2, weekNumber: 3, capWeeks: 6,
    trainedThisWeek: new Set(), lastTrainedThisWeek: new Map(), currentWeek: '2026-11-23', ...over,
  })
  it('the cap first, then the vote, only on a plain stay of a type on the program\'s phase', () => {
    expect(guardMoveTarget(view({ trainingWeeksDone: 6 }), null, 'accumulation', 'stay')).toBe('intensification')
    expect(guardMoveTarget(view({ trainingWeeksDone: 6 }), 'realisation', 'accumulation', 'stay')).toBe('intensification')
    expect(guardMoveTarget(view({}), 'intensification', 'accumulation', 'stay')).toBe('intensification')
    expect(guardMoveTarget(view({}), null, 'accumulation', 'stay')).toBeNull()
    expect(guardMoveTarget(view({ trainingWeeksDone: 6 }), null, 'accumulation', 'deload_recommended')).toBeNull()
    expect(guardMoveTarget(view({ trainingWeeksDone: 6 }), null, 'accumulation', 'transition_recommended')).toBeNull()
    expect(guardMoveTarget(view({ aligned: false, phase: null, trainingWeeksDone: 9 }), null, 'accumulation', 'stay')).toBeNull()
    expect(guardMoveTarget(view({ trainingWeeksDone: 6 }), null, 'baseline', 'stay')).toBeNull()
  })
})
