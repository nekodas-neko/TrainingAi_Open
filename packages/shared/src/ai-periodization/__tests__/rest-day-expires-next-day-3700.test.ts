// #3700 — a rest-day prescription written on a sick morning stayed the session's plan for a week.
// Its "for reference" exercise list was served as the plan on a healthy day seven days later.
//
// A prescription sized on one day's readiness now ends at the next local midnight in the lifter's
// timezone, and an aged-out prescription is "pending regeneration" on every read, never the plan.
// The model is mocked throughout: no live calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextMidnightInTz } from '@trainingai/shared/date-utils'
import { isOneDayPrescription, prescriptionAgedOut, prescriptionExpiresAt, PRESCRIPTION_TTL_MS } from '../prescription-expiry'
import { isAiPrescriptionPending } from '../prescription-pending'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'

const restDay = { phaseAction: 'rest_day_recommended' } as const
const stay = { phaseAction: 'stay' } as const
const deload = { phaseAction: 'deload_recommended' } as const

describe('nextMidnightInTz', () => {
  it('is the start of the next local day, not 24 hours on', () => {
    // 19:30 in Brisbane (UTC+10, no DST) on 3 Nov → 00:00 on 4 Nov.
    expect(nextMidnightInTz('Australia/Brisbane', new Date('2026-11-03T09:30:00Z')).toISOString())
      .toBe('2026-11-03T14:00:00.000Z')
  })

  it('at exactly midnight it is the FOLLOWING midnight, never the same instant', () => {
    expect(nextMidnightInTz('Australia/Brisbane', new Date('2026-11-03T14:00:00Z')).toISOString())
      .toBe('2026-11-04T14:00:00.000Z')
  })
})

describe('the expiry written for a prescription', () => {
  it('a rest-day prescription written in the evening expires at the next local midnight', () => {
    const at = new Date('2026-11-03T09:30:00Z') // 19:30 Brisbane
    expect(prescriptionExpiresAt(restDay, 'Australia/Brisbane', at).toISOString()).toBe('2026-11-03T14:00:00.000Z')
  })

  it('a rest-day prescription written in the morning also ends that night, not a day later', () => {
    const at = new Date('2026-11-02T21:00:00Z') // 07:00 Brisbane on 3 Nov
    expect(prescriptionExpiresAt(restDay, 'Australia/Brisbane', at).toISOString()).toBe('2026-11-03T14:00:00.000Z')
  })

  it('a normal "stay" keeps its 7 days', () => {
    const at = new Date('2026-11-03T09:30:00Z')
    expect(prescriptionExpiresAt(stay, 'Australia/Brisbane', at).getTime()).toBe(at.getTime() + PRESCRIPTION_TTL_MS)
    expect(PRESCRIPTION_TTL_MS).toBe(7 * 86_400_000)
  })

  it('uses the lifter\'s timezone, not Brisbane\'s', () => {
    // 21:00 in New York (EST, UTC−5) on 10 Nov is 02:00 UTC on 11 Nov, already "tomorrow" in UTC and
    // midday in Brisbane. The plan must still live until New York's own midnight.
    const at = new Date('2026-11-11T02:00:00Z')
    expect(prescriptionExpiresAt(restDay, 'America/New_York', at).toISOString()).toBe('2026-11-11T05:00:00.000Z')
    expect(prescriptionExpiresAt(restDay, 'Australia/Brisbane', at).toISOString()).toBe('2026-11-11T14:00:00.000Z')
  })

  it('a 25-hour day (London, clocks back on 25 Oct) still ends at local midnight', () => {
    // 00:30 BST on 25 Oct = 23:30 UTC on 24 Oct. The day is 25 h long, so `+24h` would land on
    // 23:30 the same evening; the next local midnight is 00:00 GMT on 26 Oct.
    const at = new Date('2026-10-24T23:30:00Z')
    expect(prescriptionExpiresAt(restDay, 'Europe/London', at).toISOString()).toBe('2026-10-26T00:00:00.000Z')
  })

  it('a 23-hour day (Sydney, clocks forward on 4 Oct) still ends at local midnight', () => {
    // 00:30 AEST (UTC+10) on 4 Oct; 00:00 on 5 Oct is AEDT (UTC+11). Only 22.5 h later.
    const at = new Date('2026-10-03T14:30:00Z')
    expect(prescriptionExpiresAt(restDay, 'Australia/Sydney', at).toISOString()).toBe('2026-10-04T13:00:00.000Z')
  })

  it('an emergency deload fired by the lifter\'s own sick report ends at the next local midnight', () => {
    const at = new Date('2026-11-03T09:30:00Z')
    expect(isOneDayPrescription(deload, { illnessTriggered: true })).toBe(true)
    expect(prescriptionExpiresAt(deload, 'Australia/Brisbane', at, { illnessTriggered: true }).toISOString())
      .toBe('2026-11-03T14:00:00.000Z')
  })

  it('any other deload keeps its week: its inputs cannot say illness drove it', () => {
    const at = new Date('2026-11-03T09:30:00Z')
    expect(isOneDayPrescription(deload)).toBe(false)
    expect(prescriptionExpiresAt(deload, 'Australia/Brisbane', at).getTime()).toBe(at.getTime() + PRESCRIPTION_TTL_MS)
  })
})

describe('an expired prescription is no longer the plan', () => {
  const now = new Date('2026-11-10T00:00:00Z')
  const expired = new Date(now.getTime() - 1)
  const live = new Date(now.getTime() + 1)
  const p = (phaseAction: AiPrescription['phaseAction']) => ({ phaseAction } as AiPrescription)

  it('a pending rest-day offer ages out at its expiry', () => {
    expect(prescriptionAgedOut({ prescription: p('rest_day_recommended'), prescriptionStatus: 'pending', prescriptionExpiresAt: expired }, now)).toBe(true)
    expect(prescriptionAgedOut({ prescription: p('rest_day_recommended'), prescriptionStatus: 'pending', prescriptionExpiresAt: live }, now)).toBe(false)
  })

  it('an accepted rest day ages out too', () => {
    expect(prescriptionAgedOut({ prescription: p('rest_day_recommended'), prescriptionStatus: 'accepted', prescriptionExpiresAt: expired }, now)).toBe(true)
  })

  // #3714: a pending stay drives load, and every stay is pending while auto-apply is off, so an
  // exemption here replayed a session's last plan for as long as the session went unused.
  it('a pending stay or transition ages out at its expiry too', () => {
    expect(prescriptionAgedOut({ prescription: p('stay'), prescriptionStatus: 'pending', prescriptionExpiresAt: expired }, now)).toBe(true)
    expect(prescriptionAgedOut({ prescription: p('transition_recommended'), prescriptionStatus: 'pending', prescriptionExpiresAt: expired }, now)).toBe(true)
    expect(prescriptionAgedOut({ prescription: p('stay'), prescriptionStatus: 'pending', prescriptionExpiresAt: live }, now)).toBe(false)
    expect(prescriptionAgedOut({ prescription: p('transition_recommended'), prescriptionStatus: 'pending', prescriptionExpiresAt: live }, now)).toBe(false)
  })

  it('an expired pending stay reads as pending regeneration', () => {
    const opts = { isAiDynamic: true, isBaselinePhase: false }
    expect(isAiPrescriptionPending({ prescription: p('stay'), prescriptionStatus: 'pending', prescriptionExpiresAt: expired }, opts, now)).toBe(true)
  })

  it('`none` never ages out', () => {
    expect(prescriptionAgedOut({ prescription: p('rest_day_recommended'), prescriptionStatus: 'none', prescriptionExpiresAt: expired }, now)).toBe(false)
  })

  it('an aged-out prescription reads as pending regeneration, so the next open regenerates it', () => {
    const opts = { isAiDynamic: true, isBaselinePhase: false }
    const state = { prescription: p('rest_day_recommended'), prescriptionStatus: 'pending' as const, prescriptionExpiresAt: expired }
    expect(isAiPrescriptionPending(state, opts, now)).toBe(true)
    expect(isAiPrescriptionPending({ ...state, prescriptionExpiresAt: live }, opts, now)).toBe(false)
    expect(isAiPrescriptionPending(state, { ...opts, isBaselinePhase: true }, now)).toBe(false)
  })
})

// ── Generation writes the short expiry ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  signals: null as unknown,
  modelAnswer: null as unknown,
  /** Runs while the model "answers", to let the clock move during a generation (#3716). */
  duringModel: null as null | (() => void),
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async () => {
    mocks.duringModel?.()
    return { object: mocks.modelAnswer }
  },
}))

const { generatePrescriptionForSession } = await import('../generate-prescription')

type Ex = PrescriptionSignals['exercises'][number]
const exercise = (id: string): Ex => ({
  sessionExerciseId: id, name: `Lift ${id}`, role: 'primary', muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: [], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }],
}) as Ex

const baseSignals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise('a')], phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
}) as PrescriptionSignals

const SESSION = 'ps-3700'
let n = 0
function harness() {
  const stored: { prescription: AiPrescription; expiresAt: Date }[] = []
  const state = {
    phase: 'accumulation', baselineComplete: true, sessionsInPhase: 2,
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const known: Record<string, unknown> = {
    getActiveProgram: async () => ({ id: 'prog-1', sessions: [{ id: SESSION, timeBudgetMinutes: 90 }] }),
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    storePrescription: async (_u: string, _s: string, prescription: AiPrescription, expiresAt: Date) => {
      stored.push({ prescription, expiresAt })
    },
  }
  const repo = new Proxy({}, {
    get: (_t, prop: string) => known[prop] ?? (async () => undefined),
  }) as WorkoutRepository
  return { repo, stored, run: (tz: string) => generatePrescriptionForSession(`user-3700-${++n}`, SESSION, repo, tz) }
}

const answer = (phase_action: string) => ({
  phase: 'accumulation', phase_action, deload: false, confidence: 0.7,
  reasoning: 'test',
  exercises: [{ session_exercise_id: 'a', name: 'Lift a', sets: 4, reps: 5, pct: 75, rest_sec: 120 }],
})

describe('generation stores the short expiry (#3700)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T09:30:00Z')) // 19:30 Brisbane
    mocks.signals = baseSignals()
    mocks.duringModel = null
  })
  afterEach(() => { vi.useRealTimers() })

  // #3716: the expiry was read from the moment the plan was stored, so a rest day asked for at
  // 23:59 and stored at 00:00 lived all of the next day.
  it('a generation that straddles midnight ends at the midnight that closed the day it was asked on', async () => {
    vi.setSystemTime(new Date('2026-11-03T13:59:30Z')) // 23:59:30 Brisbane on 3 Nov
    mocks.duringModel = () => { vi.setSystemTime(new Date('2026-11-03T14:00:30Z')) } // 00:00:30 on 4 Nov
    mocks.modelAnswer = answer('rest_day_recommended')
    const h = harness()
    await h.run('Australia/Brisbane')
    expect(h.stored[0].prescription.phaseAction).toBe('rest_day_recommended')
    expect(h.stored[0].expiresAt.toISOString()).toBe('2026-11-03T14:00:00.000Z')
  })

  it('a model session swap ends at the next local midnight (#3716)', async () => {
    mocks.modelAnswer = answer('session_swap_recommended')
    const h = harness()
    await h.run('Australia/Brisbane')
    expect(h.stored[0].prescription.phaseAction).toBe('session_swap_recommended')
    expect(h.stored[0].expiresAt.toISOString()).toBe('2026-11-03T14:00:00.000Z')
  })

  it('a model rest-day recommendation ends at the next local midnight', async () => {
    mocks.modelAnswer = answer('rest_day_recommended')
    const h = harness()
    const r = await h.run('Australia/Brisbane')
    expect(r.ok).toBe(true)
    expect(h.stored).toHaveLength(1)
    expect(h.stored[0].prescription.phaseAction).toBe('rest_day_recommended')
    expect(h.stored[0].expiresAt.toISOString()).toBe('2026-11-03T14:00:00.000Z')
  })

  it('a model "stay" keeps 7 days', async () => {
    mocks.modelAnswer = answer('stay')
    const h = harness()
    await h.run('Australia/Brisbane')
    expect(h.stored[0].prescription.phaseAction).toBe('stay')
    expect(h.stored[0].expiresAt.getTime()).toBe(new Date('2026-11-03T09:30:00Z').getTime() + 7 * 86_400_000)
  })

  it('a self-reported-sick emergency deload ends at the next local midnight in the lifter\'s zone', async () => {
    mocks.signals = baseSignals({ selfReportedSick: true })
    const h = harness()
    await h.run('America/New_York') // 04:30 EST on 3 Nov → 00:00 EST on 4 Nov
    expect(h.stored[0].prescription.phaseAction).toBe('deload_recommended')
    expect(h.stored[0].expiresAt.toISOString()).toBe('2026-11-04T05:00:00.000Z')
  })

  it('an emergency deload on training load keeps its week', async () => {
    mocks.signals = baseSignals({ acwr: 9 })
    const h = harness()
    await h.run('Australia/Brisbane')
    expect(h.stored[0].prescription.phaseAction).toBe('deload_recommended')
    expect(h.stored[0].expiresAt.getTime()).toBe(new Date('2026-11-03T09:30:00Z').getTime() + 7 * 86_400_000)
  })
})
