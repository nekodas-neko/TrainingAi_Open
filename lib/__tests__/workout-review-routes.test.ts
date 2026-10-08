/**
 * PS-39 — the Workout Review pair, neither of which had a test that imports its handler.
 *
 * They divide the way this app divides everywhere: the **review** route decides what to change and
 * the **apply** route writes it. Apply validates every client-supplied id against the user's own
 * active program and stamps its own `confidence: 1.0` over whatever the client sent — invisible
 * from the outside, because a route that stopped checking ids returns the same shape.
 *
 * **RV-204 removed the review's model call.** The proposal is now `buildRulesReview` →
 * `reconcileReview`, the same deterministic trim the prescription path runs. So the cases that
 * used to assert on the string handed to `generateObject` assert on the PROPOSAL instead, which
 * is what the user actually sees; and the `ai` mock stays, unused, so that a reintroduced model
 * call fails the first case below rather than passing silently.
 *
 * `reconcileReview` and `buildRulesReview` are deliberately NOT mocked — they are the thing worth
 * holding. `aggregateSignals` is, because it is a ~30-read aggregate and none of these cases are
 * about it. `reconcileReview`'s own guards (the last primary, under-target coverage, invented
 * ids) are unit-tested next to it in `review/__tests__/reconcile.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const getActiveProgram = vi.fn(async (_u: string) => program() as Row | null)
const listProgressionStyles = vi.fn(async (_u: string) => [] as Row[])
const removeSessionExercise = vi.fn(async (_u: string, _id: string) => true)
const storePrescription = vi.fn(async (_u: string, _s: string, _p: Row, _e: Date) => undefined)
const updatePrescriptionStatus = vi.fn(async (_u: string, _s: string, _st: string) => undefined)
const aggregateSignals = vi.fn(async (..._a: unknown[]) => signals() as Row | null)
const loadFigureSignals = vi.fn(async (..._a: unknown[]) => ({ exercises: [
  { sessionExerciseId: '00000000-0000-4000-8000-000000000001', muscleAssignments: [{ muscle: 'Quads', role: 'main' }], timeProfile: null, transitionSec: 240 },
] }) as Row)
/** Loosely typed: a model returns arbitrary JSON and the schema narrows it, so a case handing back
 *  an invented id has to be expressible here. */
const generateObject = vi.fn(async (_o: unknown) => ({ object: aiReview() as Record<string, unknown> }))

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getSessionPeriodization, getActiveProgram, listProgressionStyles,
    removeSessionExercise, storePrescription, updatePrescriptionStatus,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/ai-periodization/signals', () => ({
  aggregateSignals: (...a: unknown[]) => aggregateSignals(...a),
  loadFigureSignals: (...a: unknown[]) => loadFigureSignals(...a),
}))
vi.mock('ai', () => ({ generateObject: (o: unknown) => generateObject(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_m: unknown, run: () => Promise<unknown>) => run(),
}))

import { POST as review } from '@/app/api/workout-review/session/[sessionId]/route'
import { POST as apply } from '@/app/api/workout-review/session/[sessionId]/apply/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
const SQUAT = '00000000-0000-4000-8000-000000000001'
const ROW = '00000000-0000-4000-8000-000000000002'
const CURL = '00000000-0000-4000-8000-000000000003'
const FOREIGN = '00000000-0000-4000-8000-0000000000ff'

const program = (over: Row = {}) => ({
  id: 'p-1', name: 'Strength',
  sessions: [{
    id: SESSION_ID, programId: 'p-1', name: 'Upper', position: 0, timeBudgetMinutes: 60,
    exercises: [
      { id: SQUAT, sessionId: SESSION_ID, exerciseName: 'Squat', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary' },
      { id: ROW, sessionId: SESSION_ID, exerciseName: 'Row', muscleGroups: ['back'], position: 1, exerciseRole: 'secondary' },
      { id: CURL, sessionId: SESSION_ID, exerciseName: 'Curl', muscleGroups: ['biceps'], position: 2, exerciseRole: 'accessory' },
    ],
  }],
  ...over,
})

const state = (over: Row = {}) => ({
  id: 'st-1', userId: 'u-1', programSessionId: SESSION_ID, phase: 'accumulation',
  phaseStartedAt: new Date(), sessionsInPhase: 3, baselineComplete: true, baseline1rm: {},
  prescription: null, prescriptionGeneratedAt: null, prescriptionExpiresAt: null,
  prescriptionStatus: 'none', lastSessionRanPrescription: null, pendingTransition: null,
  preEmergencyDeloadPhase: null, updatedAt: new Date(), ...over,
})

const signalExercise = (id: string, name: string, role: string, muscle: string) => ({
  sessionExerciseId: id, name, role, muscleGroups: [muscle], muscleAssignments: [],
  baseline1rm: null, current1rm: null, exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0,
  avgSetDurationSec: 40, timeProfile: null, equipment: [], transitionSec: 30, plateau: false,
  rpeDelta: null, repCompletionRate: null,
})

const signals = (over: Row = {}) => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 60,
  exercises: [
    signalExercise(SQUAT, 'Squat', 'primary', 'quads'),
    signalExercise(ROW, 'Row', 'secondary', 'back'),
    signalExercise(CURL, 'Curl', 'accessory', 'biceps'),
  ],
  phase: 'accumulation', sessionsInPhase: 3, hoursSinceLastSession: 48,
  weeklyTargets: {}, weeklyLogged: {}, ...over,
})

const aiExercise = (id: string, name: string, over: Row = {}) => ({
  session_exercise_id: id, name, action: 'keep', sets: 3, reps: 5, pct: 80, rest_sec: 180,
  drop_reason: null, ...over,
})

const aiReview = (over: Row = {}) => ({
  exercises: [aiExercise(SQUAT, 'Squat'), aiExercise(ROW, 'Row'), aiExercise(CURL, 'Curl')],
  reasoning: 'Everything is on track.', confidence: 0.8, ...over,
})

const ctx = (id = SESSION_ID) => ({ params: Promise.resolve({ sessionId: id }) })
const reviewPost = (id = SESSION_ID) =>
  review(new Request(`http://localhost/api/workout-review/session/${id}`, { method: 'POST' }) as never, ctx(id) as never)
const applyPost = (body: unknown, id = SESSION_ID) =>
  apply(new Request(`http://localhost/api/workout-review/session/${id}/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never, ctx(id) as never)

const validApply = (over: Row = {}) => ({ estimatedSessionDurationMin: 55, ...over })

/** A fresh user per case — review allows 10 an hour and cases would throttle each other. */
let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' } }

beforeEach(() => {
  for (const m of [loadFigureSignals, getSessionPeriodization, getActiveProgram, listProgressionStyles,
    removeSessionExercise, storePrescription, updatePrescriptionStatus, aggregateSignals, generateObject]) m.mockClear()
  getSessionPeriodization.mockResolvedValue(state())
  getActiveProgram.mockResolvedValue(program())
  listProgressionStyles.mockResolvedValue([])
  removeSessionExercise.mockResolvedValue(true)
  aggregateSignals.mockResolvedValue(signals())
  generateObject.mockResolvedValue({ object: aiReview() })
  freshUser()
  // Both routes log to the console on the paths these cases exercise; captured so the assertions
  // can read them and the run stays quiet.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks() })

/** The "before" shape the review diffs against, straight off the proposal the user is shown. */
const beforeOf = async (id: string) => {
  const body = await (await reviewPost()).json()
  return (body.proposal.exercises as Row[]).find(e => e.sessionExerciseId === id)!.before as Row
}
const storedPrescription = () => storePrescription.mock.calls[0][2] as Row

describe('POST /api/workout-review/session/[sessionId]', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await reviewPost()).status).toBe(401)
  })

  it('rejects a malformed id before touching the database', async () => {
    const res = await reviewPost('not-a-uuid')
    expect(res.status).toBe(400)
    expect(getSessionPeriodization).not.toHaveBeenCalled()
  })

  it('rate-limits the eleventh review in the hour', async () => {
    for (let i = 0; i < 10; i++) expect((await reviewPost()).status).toBe(200)
    expect((await reviewPost()).status).toBe(429)
  })

  it('explains a session that is not AI-dynamic instead of failing', async () => {
    getSessionPeriodization.mockResolvedValue(null)
    const res = await reviewPost()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('AI-dynamic')
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('will not review a baseline week that is still running', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'baseline', baselineComplete: false }))
    expect((await reviewPost()).status).toBe(400)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('reviews a finished baseline week', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'baseline', baselineComplete: true }))
    expect((await reviewPost()).status).toBe(200)
  })

  it('404s when there is no training data, or when the session left the active program', async () => {
    aggregateSignals.mockResolvedValue(null)
    expect((await reviewPost()).status).toBe(404)

    freshUser()
    aggregateSignals.mockResolvedValue(signals())
    getActiveProgram.mockResolvedValue(program({ sessions: [] }))
    expect((await reviewPost()).status).toBe(404)
  })

  /**
   * RV-204. The route used to answer 502 when Gemini failed; there is no model to fail now. The
   * `ai` mock is still installed above and this is what makes its absence load-bearing — a
   * reintroduced model call fails here rather than passing quietly and costing tokens again.
   */
  it('reaches no model at all', async () => {
    const res = await reviewPost()
    expect(res.status).toBe(200)
    expect(generateObject).not.toHaveBeenCalled()
    // Deterministic arithmetic reports itself as certain, and always exactly this.
    expect((await res.json()).confidence).toBe(1)
  })

  // An invented id was a MODEL failure mode — `buildRulesReview` emits ids it was handed, so the
  // route can no longer produce one. `reconcileReview`'s guard against it stays and is tested
  // next to that function; this holds the weaker, true property at the route.
  it('proposes only the session\'s own exercises, with nothing invented', async () => {
    const body = await (await reviewPost()).json()
    expect(body.proposal.invalidIds).toEqual([])
    expect(body.proposal.exercises.map((e: Row) => e.sessionExerciseId).sort())
      .toEqual([SQUAT, ROW, CURL].sort())
    expect(body.proposal.exercises.map((e: Row) => e.sessionExerciseId)).not.toContain(FOREIGN)
  })

  /**
   * The main compound lift survives a budget nothing can fit. Two things hold it and they are
   * different: `dropToBudget` stops at one exercise and trim priority sends accessories first,
   * and `reconcileReview`'s guard refuses a drop that would take the last primary. This asserts
   * the OUTCOME, which is the thing the user cares about either way.
   */
  it('keeps the main compound lift even when the budget cannot hold the session', async () => {
    aggregateSignals.mockResolvedValue(signals({ effectiveTimeBudgetMin: 1 }))
    const body = await (await reviewPost()).json()
    // Non-vacuous by construction: assert the budget really did force drops, or a change that
    // stopped dropping anything would pass this while the guard went untested.
    expect(body.proposal.droppedIds.length).toBeGreaterThan(0)
    const squat = body.proposal.exercises.find((e: Row) => e.sessionExerciseId === SQUAT)
    expect(squat.action).not.toBe('drop')
  })

  // Nothing to change is a real answer, and the summary line has to say so rather than going blank.
  it('says so when the session already fits, changing nothing', async () => {
    const body = await (await reviewPost()).json()
    expect(body.proposal.exercises.every((e: Row) => e.action === 'keep')).toBe(true)
    expect(body.reasoning).toContain('already fits')
  })

  it('reports the session name and budget from the program, not the model', async () => {
    const body = await (await reviewPost()).json()
    expect(body.sessionName).toBe('Upper')
    expect(body.totalBudgetMin).toBe(60)
    expect(body.sessionId).toBe(SESSION_ID)
  })

  // The "before" numbers a review diffs against. A prescription only overrides the base style when
  // it is actually driving the bar — `prescriptionDrivesLoad`.
  it('diffs against the base style while a proposed deload is still unaccepted', async () => {
    // A pending `stay` DOES drive the bar — its numbers are today's load and only the phase
    // decision is open. A deload changes whether you train hard at all, so it stays opt-in, and
    // until it is accepted the review must diff against the style the bar is actually on.
    getSessionPeriodization.mockResolvedValue(state({
      prescriptionStatus: 'pending',
      prescription: { phaseAction: 'deload', exercises: [{ sessionExerciseId: SQUAT, sets: 9, reps: 9, pct: 40, restSec: 999 }] },
    }))
    const before = await beforeOf(SQUAT)
    expect(before.pct).not.toBe(40)
    expect(before.pct).toBe(80) // the primary role default
  })

  it('diffs against a pending `stay`, whose numbers are already today\'s load', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      prescriptionStatus: 'pending',
      prescription: { phaseAction: 'stay', exercises: [{ sessionExerciseId: SQUAT, sets: 9, reps: 9, pct: 99, restSec: 999 }] },
    }))
    expect((await beforeOf(SQUAT)).pct).toBe(99)
  })

  it('diffs against an accepted prescription, which is driving the bar', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      prescriptionStatus: 'accepted',
      prescription: { phaseAction: 'stay', exercises: [{ sessionExerciseId: SQUAT, sets: 9, reps: 9, pct: 99, restSec: 999 }] },
    }))
    expect((await beforeOf(SQUAT)).pct).toBe(99)
  })

  it('falls back to a role default when an exercise has no progression style', async () => {
    // primary 3×5@80, secondary 3×8@72, accessory 3×12@65
    expect(await beforeOf(SQUAT)).toEqual({ sets: 3, reps: 5, pct: 80, restSec: 180 })
    expect(await beforeOf(CURL)).toEqual({ sets: 3, reps: 12, pct: 65, restSec: 90 })
  })
})

describe('POST /api/workout-review/session/[sessionId]/apply', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await applyPost(validApply())).status).toBe(401)

    freshUser()
    expect((await applyPost(validApply(), 'not-a-uuid')).status).toBe(400)
  })

  it('rejects a body with an unknown key rather than ignoring it', async () => {
    const res = await applyPost({ ...validApply(), sneak: true })
    expect(res.status).toBe(400)
    expect(storePrescription).not.toHaveBeenCalled()
  })

  it('rejects out-of-range adjustment numbers', async () => {
    const res = await applyPost(validApply({
      adjustments: [{ sessionExerciseId: SQUAT, sets: 99, reps: 5, pct: 80, restSec: 180 }],
    }))
    expect(res.status).toBe(400)
  })

  it('refuses an oversized body', async () => {
    const res = await applyPost(validApply({ reasoning: 'x'.repeat(400 * 1024) }))
    expect(res.status).toBe(413)
  })

  it('404s when the session is not in the active program, before any write', async () => {
    getActiveProgram.mockResolvedValue(program({ sessions: [] }))
    expect((await applyPost(validApply())).status).toBe(404)
    expect(removeSessionExercise).not.toHaveBeenCalled()
  })

  it('refuses a session that is not AI-dynamic, or a baseline still running', async () => {
    getSessionPeriodization.mockResolvedValue(null)
    expect((await applyPost(validApply())).status).toBe(400)

    getSessionPeriodization.mockResolvedValue(state({ phase: 'baseline', baselineComplete: false }))
    expect((await applyPost(validApply())).status).toBe(400)
    expect(storePrescription).not.toHaveBeenCalled()
  })

  // The ids come from the client. One that is not in the caller's own active program session must
  // never reach a write, whatever it names.
  it('ignores every id that is not in the caller\'s own session', async () => {
    const res = await applyPost(validApply({
      adjustments: [{ sessionExerciseId: FOREIGN, sets: 3, reps: 5, pct: 80, restSec: 180 }],
      dropThisCycle: [FOREIGN],
      dropPermanent: [FOREIGN],
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ applied: { adjustments: 0, dropThisCycle: 0, dropPermanent: 0 } })
    expect(removeSessionExercise).not.toHaveBeenCalled()
    expect(storePrescription).not.toHaveBeenCalled()
  })

  it('writes nothing at all when there is nothing to overlay', async () => {
    const res = await applyPost(validApply())
    expect(res.status).toBe(200)
    expect(storePrescription).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('stamps its own confidence over whatever the client sent', async () => {
    // CLAUDE.md: no LLM self-reported number may gate an automatic action. An apply is a
    // user-confirmed change, so it must never trip the card's low-confidence gate.
    await applyPost(validApply({
      confidence: 0.05,
      adjustments: [{ sessionExerciseId: ROW, sets: 4, reps: 8, pct: 72, restSec: 120 }],
    }))
    expect(storedPrescription().confidence).toBe(1)
    expect(storedPrescription().confidenceReasons).toEqual([])
  })

  // Issue 2592: a kept deloaded row (with its `preDeload`) means Full trains something else, so the
  // rebuilt blob carries a `fullSession` costed through the one figures function.
  const deloadedSquat = {
    sessionExerciseId: SQUAT, name: 'Squat', sets: 2, reps: 5, pct: 55, restSec: 120,
    deloaded: true, preDeload: { sets: 4, reps: 5, pct: 80, restSec: 180 },
  }
  const existingWithDeload = () => state({
    prescriptionStatus: 'accepted',
    prescription: {
      phase: 'accumulation', phaseAction: 'stay', exercises: [deloadedSquat], deload: false, reasoning: 'r',
      confidence: 1, estimatedSessionDurationMin: 40, weeklyVolumeContribution: { quads: 2 },
    },
  })

  it('carries fullSession for a kept deloaded row, costed over the stored figures', async () => {
    getSessionPeriodization.mockResolvedValue(existingWithDeload())
    await applyPost(validApply({
      estimatedSessionDurationMin: 50,
      adjustments: [{ sessionExerciseId: ROW, sets: 4, reps: 8, pct: 72, restSec: 120 }],
    }))
    const p = storedPrescription()
    expect(p.estimatedSessionDurationMin).toBe(50)
    const rows = p.exercises as Row[]
    expect(rows.find(e => e.sessionExerciseId === SQUAT)).toMatchObject({ deloaded: true, preDeload: { sets: 4 } })
    const full = p.fullSession as { estimatedSessionDurationMin: number; weeklyVolumeContribution: Record<string, number> }
    expect(full.estimatedSessionDurationMin).toBeGreaterThan(50)
    expect(full.weeklyVolumeContribution.quads).toBe(4) // stored 2 + (4 full sets - 2 deload sets)
  })

  it('stores no fullSession when no kept row has anything to revert', async () => {
    await applyPost(validApply({ adjustments: [{ sessionExerciseId: ROW, sets: 4, reps: 8, pct: 72, restSec: 120 }] }))
    expect(storedPrescription().fullSession).toBeUndefined()
  })

  it('still stores the apply, without a fullSession, when the figure inputs cannot be loaded', async () => {
    getSessionPeriodization.mockResolvedValue(existingWithDeload())
    loadFigureSignals.mockRejectedValueOnce(new Error('db down'))
    const res = await applyPost(validApply({
      estimatedSessionDurationMin: 50,
      adjustments: [{ sessionExerciseId: ROW, sets: 4, reps: 8, pct: 72, restSec: 120 }],
    }))
    expect(res.status).toBe(200)
    expect(storedPrescription().fullSession).toBeUndefined()
    expect(storedPrescription().estimatedSessionDurationMin).toBe(50)
  })

  it('raises a set count below its role floor instead of writing it', async () => {
    await applyPost(validApply({
      adjustments: [
        { sessionExerciseId: SQUAT, sets: 1, reps: 5, pct: 80, restSec: 180 },  // primary, floor 2
        { sessionExerciseId: CURL, sets: 1, reps: 12, pct: 65, restSec: 90 },   // accessory, floor 1
      ],
    }))
    const byId = new Map((storedPrescription().exercises as Row[]).map(e => [e.sessionExerciseId, e]))
    expect(byId.get(SQUAT)!.sets).toBe(2)
    expect(byId.get(CURL)!.sets).toBe(1)
  })

  it('accepts the prescription it writes, so it drives the bar this cycle', async () => {
    await applyPost(validApply({ dropThisCycle: [CURL] }))
    expect(storedPrescription().droppedExerciseIds).toEqual([CURL])
    expect(storedPrescription().phaseAction).toBe('stay')
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('accepted')
  })

  it('lets a permanent drop beat an adjustment and a this-cycle drop for the same exercise', async () => {
    const res = await applyPost(validApply({
      adjustments: [{ sessionExerciseId: CURL, sets: 3, reps: 12, pct: 65, restSec: 90 }],
      dropThisCycle: [CURL],
      dropPermanent: [CURL, CURL],
    }))
    expect(await res.json()).toEqual({ applied: { adjustments: 0, dropThisCycle: 0, dropPermanent: 1 } })
    expect(removeSessionExercise).toHaveBeenCalledTimes(1) // deduped
    expect(storePrescription).not.toHaveBeenCalled()
  })

  it('counts a permanent drop only when the repository actually removed it', async () => {
    removeSessionExercise.mockResolvedValue(false)
    const res = await applyPost(validApply({ dropPermanent: [CURL] }))
    expect(await res.json()).toEqual({ applied: { adjustments: 0, dropThisCycle: 0, dropPermanent: 0 } })
  })

  // A prescription left pointing at a deleted exercise would keep prescribing it forever.
  it('prunes a deleted exercise out of an existing prescription even with nothing to overlay', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      prescriptionStatus: 'accepted',
      prescription: {
        phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'earlier',
        estimatedSessionDurationMin: 60, weeklyVolumeContribution: {}, confidence: 0.4,
        confidenceReasons: ['x'], droppedExerciseIds: [ROW],
        exercises: [{ sessionExerciseId: CURL, name: 'Curl', sets: 3, reps: 12, pct: 65, restSec: 90 }],
      },
    }))
    await applyPost(validApply({ dropPermanent: [CURL] }))
    expect(storePrescription).toHaveBeenCalled()
    expect(storedPrescription().exercises).toEqual([])
    expect(storedPrescription().droppedExerciseIds).toEqual([ROW])
  })

  it('starts a baseline session on accumulation rather than storing "baseline" as a phase', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'baseline', baselineComplete: true }))
    await applyPost(validApply({ dropThisCycle: [CURL] }))
    expect(storedPrescription().phase).toBe('accumulation')
  })
})
