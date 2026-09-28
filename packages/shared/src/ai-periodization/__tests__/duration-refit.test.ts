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
const BASELINE_SETS: Record<string, number> = { [SQUAT]: 4, [ROW]: 4, [CURL]: 3, [RAISE]: 3 }
/** ...and what it would then have STORED, once the standard budget trimmed the accessories.
 *  The two differing is the normal case, not a contrived one — the budget stage exists to trim. */
const STORED_SETS: Record<string, number> = { [SQUAT]: 4, [ROW]: 4, [CURL]: 2, [RAISE]: 2 }

const storedPrescription = (over: Partial<AiPrescription> = {}): AiPrescription => ({
  phase: 'accumulation',
  phaseAction: 'stay',
  exercises: EXERCISES.map(e => ({
    sessionExerciseId: e.sessionExerciseId,
    name: e.name,
    sets: STORED_SETS[e.sessionExerciseId],
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

  it('gives the sets back on the way out — short then standard is the original plan', async () => {
    const original = storedPrescription()

    const shortened = await refit('short')
    if (!shortened.ok) throw new Error('short leg did not re-fit')
    // The short leg must actually have changed the plan, or the round trip proves nothing.
    expect(setsOf(shortened.prescription)).not.toEqual(setsOf(original))
    expect(shortened.prescription.droppedExerciseIds).toEqual([CURL, RAISE])

    const restored = await refit('standard', periodizationState({ prescription: shortened.prescription }))
    if (!restored.ok) throw new Error('return leg did not re-fit')

    // Measured: re-fitting from the STORED (short) sets instead of the baseline returns
    // { Squat 4, Row 2, Curl 3, Raise 3 } — the Row silently loses half its sets and the
    // accessories keep the count they only ever had because they were dropped rather than
    // trimmed. Nothing on screen would say the plan is wrong.
    expect(setsOf(restored.prescription)).toEqual(setsOf(original))
    expect(restored.prescription.droppedExerciseIds ?? []).toEqual([])
    expect(restored.prescription.reasoning).toBe(original.reasoning)
  })

  it('never touches reps, load, rest or the phase — only how many sets fit', async () => {
    const res = await refit('short')
    if (!res.ok) throw new Error('did not re-fit')
    expect(res.prescription.phase).toBe('accumulation')
    expect(res.prescription.phaseAction).toBe('stay')
    expect(res.prescription.confidence).toBe(0.8)
    for (const ex of res.prescription.exercises) {
      expect({ reps: ex.reps, pct: ex.pct, restSec: ex.restSec }).toEqual({ reps: 10, pct: 70, restSec: 120 })
    }
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
// re-fit cases above — the round trip's standard leg happens to sit ~1 min under its budget, so
// an expansion would not have fitted and a drop would not have been needed. That is a property
// of that fixture, not of the code, which is exactly why these are separate.
describe('a standard session neither expands into its slack nor drops an exercise', () => {
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

  it('leaves a short session\'s surplus alone — that under-fill IS the finish-early margin', () => {
    // Two exercises at two sets against a 90-minute working budget: room for many more sets.
    const res = applyBudgetStage(stageExercises(2, 2), stageSignals(90, 2) as never, 60, 'standard', new Set())
    expect([...res.sets.values()]).toEqual([2, 2])
    expect(res.droppedIds.size).toBe(0)
  })

  it('surfaces an overrun as a note instead of dropping work the lifter asked for', () => {
    // Six exercises in 20 working minutes cannot fit even at the two-set role floor. Only an
    // explicit SHORT request may drop an exercise; a standard session says so and keeps them.
    const res = applyBudgetStage(stageExercises(6, 3), stageSignals(20, 6) as never, 60, 'standard', new Set())
    expect(res.droppedIds.size).toBe(0)
    expect([...res.sets.values()]).toEqual([2, 2, 2, 2, 2, 2])
    expect(res.budgetNote).toContain('more exercises than the time budget fits')
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
