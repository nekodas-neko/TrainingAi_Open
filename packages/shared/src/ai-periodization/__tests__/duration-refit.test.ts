/**
 * RV-202 ② — changing the duration preset must not re-ask the model.
 *
 * The plan the model produces does not depend on the time budget; the budget only ever decided
 * how many of its sets survive. So a preset change re-runs the deterministic budget stage against
 * the STORED plan, and the two things this file has to prove are:
 *
 *   · the re-fit lands where a full generation for that preset would have landed, and
 *   · it is REVERSIBLE — short → standard gives the sets back.
 *
 * The second is the whole reason `refitBaseline` exists. The budget passes only ever remove sets
 * (`fitToBudget`), and a return to the session's own length runs neither `dropToBudget` nor
 * `expandToBudget` — so a re-fit that started from the stored, already-trimmed plan would keep the
 * short session's two-set shape and relabel it "standard". That is a wrong workout, silently, and
 * nothing about it looks broken on screen.
 *
 * `aggregateSignals` is mocked — it is ~30 repository reads and has its own coverage. Everything
 * downstream of it, including the real budget stage, runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { workingBudgetMin, budgetForPreset, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
const SQUAT = '00000000-0000-4000-8000-000000000001'
const ROW = '00000000-0000-4000-8000-000000000002'
const CURL = '00000000-0000-4000-8000-000000000003'
const RAISE = '00000000-0000-4000-8000-000000000004'
const SESSION_BUDGET = 60

const aggregateSignals = vi.fn()
vi.mock('@trainingai/shared/ai-periodization/signals', () => ({
  aggregateSignals: (...a: unknown[]) => aggregateSignals(...a),
}))

const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')
const { applyBudgetStage } = await import('@trainingai/shared/ai-periodization/budget-stage')

const EXERCISES = [
  { sessionExerciseId: SQUAT, name: 'Squat', role: 'primary', muscle: 'quads' },
  { sessionExerciseId: ROW, name: 'Row', role: 'secondary', muscle: 'back' },
  { sessionExerciseId: CURL, name: 'Curl', role: 'accessory', muscle: 'biceps' },
  { sessionExerciseId: RAISE, name: 'Lateral Raise', role: 'accessory', muscle: 'shoulders' },
]

/** Only the fields the budget stage reads. The rest of PrescriptionSignals is ~30 more keys of
 *  prompt input that never reach it. */
const signalsFor = (budgetOverrideMin: number | undefined) => ({
  trainingGoal: 'hypertrophy',
  effectiveTimeBudgetMin: workingBudgetMin(budgetOverrideMin ?? SESSION_BUDGET),
  exercises: EXERCISES.map(e => ({
    sessionExerciseId: e.sessionExerciseId,
    name: e.name,
    role: e.role,
    muscleAssignments: [{ muscle: e.muscle, role: 'main' as const }],
    transitionSec: 240,
    timeProfile: null,
  })),
  weeklyTargets: { quads: 16, back: 16, biceps: 12, shoulders: 12 },
  weeklyLogged: { quads: 4, back: 4, biceps: 2, shoulders: 2 },
})

/** The pre-budget shape a generation would have handed the budget stage... */
const BASELINE_SETS: Record<string, number> = { [SQUAT]: 5, [ROW]: 5, [CURL]: 4, [RAISE]: 4 }
/** ...and what it would then have STORED, once the standard budget trimmed the accessories (to
 *  5/5/3/3). Read off the real stage rather than typed in, so a change to the duration model moves
 *  the fixture with it. The two differing is the normal case — the budget stage exists to trim. */
const storedSets = (): Record<string, number> => Object.fromEntries(generationAnswer('standard').sets)

const storedPrescription = (over: Partial<AiPrescription> = {}): AiPrescription => ({
  phase: 'accumulation',
  phaseAction: 'stay',
  exercises: EXERCISES.map(e => ({
    sessionExerciseId: e.sessionExerciseId,
    name: e.name,
    sets: storedSets()[e.sessionExerciseId],
    reps: 10,
    pct: 70,
    restSec: 120,
  })),
  estimatedSessionDurationMin: 50,
  weeklyVolumeContribution: {},
  deload: false,
  reasoning: 'Steady accumulation week.',
  confidence: 0.8,
  durationPreset: 'standard',
  refitBaseline: { sets: { ...BASELINE_SETS }, reasoning: 'Steady accumulation week.' },
  ...over,
})

const getActiveProgram = vi.fn()
const getSessionPeriodization = vi.fn()
const storePrescription = vi.fn(async (
  _userId: string, _programSessionId: string, _prescription: AiPrescription,
  _expiresAt: Date, _status?: string,
) => undefined)
const repo = { getActiveProgram, getSessionPeriodization, storePrescription } as never

const periodizationState = (over: Record<string, unknown> = {}) => ({
  phase: 'accumulation',
  prescription: storedPrescription(),
  prescriptionStatus: 'pending',
  prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000),
  ...over,
})

beforeEach(() => {
  for (const m of [aggregateSignals, getActiveProgram, getSessionPeriodization, storePrescription]) m.mockClear()
  getActiveProgram.mockResolvedValue({
    id: 'p-1',
    sessions: [{ id: SESSION_ID, timeBudgetMinutes: SESSION_BUDGET }],
  })
  getSessionPeriodization.mockResolvedValue(periodizationState())
  aggregateSignals.mockImplementation(async (..._a: unknown[]) => signalsFor(_a[5] as number | undefined))
})

const refit = (preset: DurationPreset, state?: Record<string, unknown>) => {
  if (state) getSessionPeriodization.mockResolvedValue(state)
  return refitPrescriptionToBudget('u-1', SESSION_ID, repo, 'Australia/Brisbane', preset)
}

/** What a full generation for `preset` would have produced, from the same baseline. */
const generationAnswer = (preset: DurationPreset) => applyBudgetStage(
  EXERCISES.map(e => ({
    sessionExerciseId: e.sessionExerciseId,
    name: e.name,
    sets: BASELINE_SETS[e.sessionExerciseId],
    reps: 10,
    pct: 70,
    restSec: 120,
  })),
  signalsFor(budgetForPreset(SESSION_BUDGET, preset) === SESSION_BUDGET
    ? undefined
    : budgetForPreset(SESSION_BUDGET, preset)) as never,
  SESSION_BUDGET,
  preset,
  new Set<string>(),
)

const setsOf = (p: AiPrescription) =>
  Object.fromEntries(p.exercises.map(e => [e.sessionExerciseId, e.sets]))
const restOf = (p: AiPrescription) =>
  Object.fromEntries(p.exercises.map(e => [e.sessionExerciseId, e.restSec]))

describe('a duration change re-fits the stored plan instead of re-asking the model', () => {
  it('lands exactly where a generation for that preset would have', async () => {
    for (const preset of ['short', 'long'] as const) {
      getSessionPeriodization.mockResolvedValue(periodizationState())
      const res = await refit(preset)
      if (!res.ok) throw new Error(`expected a re-fit, got ${res.reason}`)

      const expected = generationAnswer(preset)
      expect(setsOf(res.prescription)).toEqual(Object.fromEntries(expected.sets))
      expect(res.prescription.droppedExerciseIds ?? []).toEqual([...expected.droppedIds])
      expect(res.estimatedSessionDurationMin).toBe(expected.estimatedSessionDurationMin)
    }
  })

  it('gives the sets and the rest back on the way out — short then standard is the original plan', async () => {
    const original = storedPrescription()

    // 20 minutes, so the short leg has to drop as well as trim.
    const shortened = await refit(20)
    if (!shortened.ok) throw new Error('short leg did not re-fit')
    // The short leg must actually have changed the plan, or the round trip proves nothing.
    expect(setsOf(shortened.prescription)).not.toEqual(setsOf(original))
    expect(shortened.prescription.droppedExerciseIds).toEqual([CURL, RAISE])
    expect(restOf(shortened.prescription)).toEqual({ [SQUAT]: 120, [ROW]: 90, [CURL]: 90, [RAISE]: 90 })

    const restored = await refit('standard', periodizationState({ prescription: shortened.prescription }))
    if (!restored.ok) throw new Error('return leg did not re-fit')

    // Measured: re-fitting from the STORED (short) sets instead of the baseline returns
    // { Squat 4, Row 2, Curl 3, Raise 3 } — the Row silently loses half its sets and the
    // accessories keep the count they only ever had because they were dropped rather than
    // trimmed. Nothing on screen would say the plan is wrong.
    expect(setsOf(restored.prescription)).toEqual(setsOf(original))
    // #2284: the stored rest was shortened, so without the baseline's copy it would stay short.
    expect(restOf(restored.prescription)).toEqual(restOf(original))
    expect(restored.prescription.droppedExerciseIds ?? []).toEqual([])
    expect(restored.prescription.reasoning).toBe(original.reasoning)
  })

  it('never touches reps, load or the phase — only sets, and rest on a shorter day', async () => {
    const res = await refit('short')
    if (!res.ok) throw new Error('did not re-fit')
    expect(res.prescription.phase).toBe('accumulation')
    expect(res.prescription.phaseAction).toBe('stay')
    expect(res.prescription.confidence).toBe(0.8)
    for (const ex of res.prescription.exercises) {
      expect({ reps: ex.reps, pct: ex.pct }).toEqual({ reps: 10, pct: 70 })
    }
    // #2284: accessory and secondary rest is cut by a quarter; the primary keeps its full rest.
    expect(restOf(res.prescription)).toEqual({ [SQUAT]: 120, [ROW]: 90, [CURL]: 90, [RAISE]: 90 })
    const long = await refit('long')
    if (!long.ok) throw new Error('did not re-fit')
    expect(Object.values(restOf(long.prescription))).toEqual([120, 120, 120, 120])
  })

  it('replaces the budget note rather than stacking a second one', async () => {
    const first = await refit('short')
    if (!first.ok) throw new Error('did not re-fit')
    const second = await refit('short', periodizationState({ prescription: first.prescription }))
    if (!second.ok) throw new Error('did not re-fit')
    expect(second.prescription.reasoning).toBe(first.prescription.reasoning)
    expect(second.prescription.reasoning.startsWith('Steady accumulation week.')).toBe(true)
  })

  it('stores under the plan\'s existing expiry and acceptance, not a fresh window', async () => {
    const state = periodizationState({ prescriptionStatus: 'accepted' })
    const res = await refit('long', state)
    if (!res.ok) throw new Error('did not re-fit')
    const [, , , expiresAt, status] = storePrescription.mock.calls[0]
    expect(expiresAt).toBe(state.prescriptionExpiresAt)
    expect(status).toBe('accepted')
    expect(res.prescriptionStatus).toBe('accepted')
  })
})

// The two guards that make "standard" mean the session's own length. Both are one character
// away from silently changing every plan the app produces, and neither is reachable through the
// re-fit cases above — the round trip's standard leg happens to sit ~2 min under its budget, so
// an expansion would not have fitted and a drop would not have been needed. That is a property
// of that fixture, not of the code, which is exactly why these are separate.
// #2133 (owner direction 2026-09-24, proposal 2026-10-05): this block pinned the opposite rule, that a
// standard session neither fills its slack nor drops an exercise. The allocator replaces it: every
// preset is sized to the budget, slack buys sets for the muscles behind the week, and an overrun at
// the minimums drops whole exercises before any set is floored.
describe('a standard session is sized to its budget (#2133)', () => {
  const stageSignals = (workingMin: number, count: number) => ({
    trainingGoal: 'hypertrophy',
    effectiveTimeBudgetMin: workingMin,
    exercises: Array.from({ length: count }, (_, i) => ({
      sessionExerciseId: `ex-${i}`,
      name: `Exercise ${i}`,
      role: i === 0 ? 'primary' : 'accessory',
      muscleAssignments: [{ muscle: `m-${i}`, role: 'main' as const }],
      transitionSec: 240,
      timeProfile: null,
    })),
    weeklyTargets: Object.fromEntries(Array.from({ length: count }, (_, i) => [`m-${i}`, 16])),
    weeklyLogged: {},
  })
  const stageExercises = (count: number, sets: number) =>
    Array.from({ length: count }, (_, i) => ({
      sessionExerciseId: `ex-${i}`, name: `Exercise ${i}`, sets, reps: 10, pct: 70, restSec: 120,
    }))

  it('spends a standard session\'s surplus on sets, within each role\'s ceiling', () => {
    // Two exercises at two sets against a 90-minute working budget: the time buys sets up to the
    // ceilings (primary 6, accessory 4), and nothing is dropped.
    const res = applyBudgetStage(stageExercises(2, 2), stageSignals(90, 2) as never, 60, 'standard', new Set())
    expect([...res.sets.values()]).toEqual([6, 4])
    expect(res.droppedIds.size).toBe(0)
    expect(res.estimatedSessionDurationMin).toBeLessThanOrEqual(90)
  })

  it('passes the phase through: an intensity phase keeps the model\'s counts, accumulation fills (#2788)', () => {
    // The model asked for 2 sets each; the main lift's minimum is 3.
    const run = (phase: string) => [...applyBudgetStage(stageExercises(2, 2), stageSignals(90, 2) as never, 60, 'standard', new Set(), undefined, phase).sets.values()]
    expect(run('intensification')).toEqual([3, 2])
    expect(run('realisation')).toEqual([3, 2])
    expect(run('accumulation')).toEqual([6, 4])
  })

  it('drops whole exercises when even the minimums overrun, keeping the main lift and at least two', () => {
    // Six exercises in 20 working minutes cannot fit at their minimums. The least-behind accessories
    // go whole instead of all six being floored to two sets.
    const res = applyBudgetStage(stageExercises(6, 3), stageSignals(20, 6) as never, 60, 'standard', new Set())
    expect(res.droppedIds.size).toBeGreaterThan(0)
    expect(res.droppedIds.has('ex-0')).toBe(false)
    expect(6 - res.droppedIds.size).toBeGreaterThanOrEqual(2)
    expect(res.budgetNote).toContain('dropped for today')
  })
})

describe('what falls through to a full generation instead', () => {
  it('a prescription generated before the baseline existed — every row in production today', async () => {
    const stored = storedPrescription()
    delete stored.refitBaseline
    const res = await refit('short', periodizationState({ prescription: stored }))
    expect(res).toEqual({ ok: false, reason: 'no_baseline' })
    expect(storePrescription).not.toHaveBeenCalled()
  })

  it('an expired plan is replaced, not re-shaped', async () => {
    const res = await refit('short', periodizationState({
      prescriptionExpiresAt: new Date(Date.now() - 1000),
    }))
    expect(res).toEqual({ ok: false, reason: 'expired' })
  })

  it.each(['consumed', 'dismissed', 'none'])('a %s plan is finished with', async status => {
    const res = await refit('short', periodizationState({ prescriptionStatus: status }))
    expect(res).toEqual({ ok: false, reason: 'not_refittable' })
  })

  it('no stored prescription at all', async () => {
    const res = await refit('short', periodizationState({ prescription: null }))
    expect(res).toEqual({ ok: false, reason: 'no_prescription' })
  })

  it('a session id that is not in the active program', async () => {
    getActiveProgram.mockResolvedValue({ id: 'p-1', sessions: [] })
    const res = await refit('short')
    expect(res).toEqual({ ok: false, reason: 'no_session' })
    expect(getSessionPeriodization).not.toHaveBeenCalled()
  })
})

describe('#2403 — a re-fit re-costs the session Full trains', () => {
  const withCurlDeloaded = () => storedPrescription({
    exercises: storedPrescription().exercises.map(ex => ex.sessionExerciseId === CURL
      ? { ...ex, sets: 2, reps: 15, pct: 50, restSec: 60, deloaded: true, preDeload: { sets: 4, reps: 10, pct: 70, restSec: 120 } }
      : ex),
    // A stale block from the previous budget, which the re-fit must not carry forward.
    fullSession: { estimatedSessionDurationMin: 999, weeklyVolumeContribution: { biceps: 99 } },
  })

  it('writes a fresh fullSession for the new budget, with the cut row back on its full numbers', async () => {
    const res = await refit('long', periodizationState({ prescription: withCurlDeloaded() }))
    if (!res.ok) throw new Error('did not re-fit')
    const full = res.prescription.fullSession!
    expect(full.estimatedSessionDurationMin).not.toBe(999)
    expect(full.estimatedSessionDurationMin).toBeGreaterThan(res.prescription.estimatedSessionDurationMin)
    // Curl trains only biceps: its full 4 sets, whatever the stage left its deload.
    expect(full.weeklyVolumeContribution.biceps).toBe(4)
    expect(full.weeklyVolumeContribution.quads).toBe(res.prescription.weeklyVolumeContribution.quads)
    expect(storePrescription.mock.calls[0][2].fullSession).toEqual(full)
  })

  it('drops a stale block when nothing is deloaded any more, so the stored plan is what it was', async () => {
    const stale = storedPrescription({ fullSession: { estimatedSessionDurationMin: 999, weeklyVolumeContribution: {} } })
    const res = await refit('long', periodizationState({ prescription: stale }))
    if (!res.ok) throw new Error('did not re-fit')
    expect('fullSession' in res.prescription).toBe(false)
  })
})

it('turning the time limit off restores work and full rests from the saved baseline', async () => {
  const shortened = await refit(30)
  if (!shortened.ok) throw Error('did not refit')
  getSessionPeriodization.mockResolvedValue(periodizationState({ prescription: shortened.prescription }))
  const unlimited = await refit(0)
  if (!unlimited.ok) throw Error('did not refit')
  expect(aggregateSignals.mock.calls.at(-1)?.[5]).toBe(0)
  expect(unlimited.prescription.droppedExerciseIds ?? []).toEqual([])
  expect(unlimited.prescription.exercises.find(ex => ex.sessionExerciseId === CURL)?.sets).toBe(4)
  expect(unlimited.prescription.exercises.every(ex => ex.restSec === 120)).toBe(true)
  expect(unlimited.prescription.reasoning).not.toContain('0-min')
  expect(unlimited.prescription.durationPreset).toBe(0)
})
