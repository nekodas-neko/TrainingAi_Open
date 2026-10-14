// RV-204. The Workout Review's proposal with no model in it.
//
// What the model supplied that survived `reconcileReview` was the CHOICE — which exercises to
// drop, which set counts to change — plus a sentence per drop. These pin that the choice is now
// made by the same trim the prescription path uses, in the same order, so the two cannot propose
// shapes that contradict each other.
import { describe, it, expect } from 'vitest'
import { buildRulesReview } from '../rules-review'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'

const SQUAT = 'ex-squat', ROW = 'ex-row', CURL = 'ex-curl'

const signalExercise = (id: string, name: string, role: string, muscle: string) => ({
  sessionExerciseId: id, name, role, muscleGroups: [muscle],
  muscleAssignments: [{ muscle, role: 'main' as const }],
  baseline1rm: null, current1rm: null, exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0,
  avgSetDurationSec: 40, timeProfile: null, equipment: [], transitionSec: 30, plateau: false,
  rpeDelta: null, repCompletionRate: null,
})

const signals = (over: Record<string, unknown> = {}) => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 60,
  exercises: [
    signalExercise(SQUAT, 'Squat', 'primary', 'quads'),
    signalExercise(ROW, 'Row', 'secondary', 'back'),
    signalExercise(CURL, 'Curl', 'accessory', 'biceps'),
  ],
  phase: 'accumulation', sessionsInPhase: 3, hoursSinceLastSession: 48,
  weeklyTargets: {}, weeklyLogged: {}, ...over,
}) as unknown as PrescriptionSignals

const EXERCISES = [
  { sessionExerciseId: SQUAT, name: 'Squat', sets: 3, reps: 5, pct: 80, restSec: 180 },
  { sessionExerciseId: ROW, name: 'Row', sets: 3, reps: 8, pct: 72, restSec: 120 },
  { sessionExerciseId: CURL, name: 'Curl', sets: 3, reps: 12, pct: 65, restSec: 90 },
]

const run = (budgetMin: number, over: Record<string, unknown> = {}) =>
  buildRulesReview({ exercises: EXERCISES, signals: signals({ effectiveTimeBudgetMin: budgetMin, ...over }), budgetMin })

describe('buildRulesReview', () => {
  // The common case, and the one the sheet has to render without looking broken.
  it('proposes nothing and says so when the session already fits', () => {
    const r = run(120)
    expect(r.modelExercises).toEqual([])
    expect(r.reasoning).toContain('already fits')
    expect(r.reasoning).toContain('120-min')
  })

  // #2787 (Orchestrator decision, 2026-10-11) reversed the old "trim sets before dropping anything"
  // pin: the review now drops a whole exercise first, like the allocator, because "everything at 2
  // sets" is the shape the owner called worse training. At 15 min the old answer trimmed all three;
  // the new one drops the curl and leaves the squat and row at the sets the user has.
  it('drops a whole exercise before it trims any set', () => {
    const r = run(15)
    expect(r.modelExercises.map(m => [m.sessionExerciseId, m.action])).toEqual([[CURL, 'drop']])
    expect(r.reasoning).toContain('dropped')
    expect(r.reasoning).not.toContain('trimmed')
  })

  // Was "drops once trimming has run out of room". The order flipped (#2787); what is unchanged is
  // that it never goes below two exercises (#2078) and keeps the main lift, and that sets are cut
  // only once the two it keeps still overrun.
  it('trims only once the two exercises it keeps still overrun, keeping the main compound lift', () => {
    const r = run(1)
    const dropped = r.modelExercises.filter(m => m.action === 'drop').map(m => m.sessionExerciseId)
    expect(dropped).toEqual([CURL])
    expect(r.modelExercises.filter(m => m.action === 'adjust').map(m => m.sessionExerciseId).sort()).toEqual([ROW, SQUAT].sort())
    expect(r.reasoning).toContain('dropped')
    expect(r.reasoning).toContain('trimmed')
  })

  // Was "leaves the drop reason to reconcileReview". #2787 asks the sheet to say which exercise went
  // and why, and reconcile's fallback ("Dropped to fit the time budget.") cannot say why, so the
  // reason is written here now.
  it('says why each exercise went: least behind this week', () => {
    const r = run(15, { weeklyTargets: { quads: 10, back: 10, biceps: 10 }, weeklyLogged: { quads: 0, back: 0, biceps: 30 } })
    const drops = r.modelExercises.filter(m => m.action === 'drop')
    expect(drops.map(d => d.sessionExerciseId)).toEqual([CURL])
    expect(drops[0].dropReason).toBe('Dropped to fit the 15-min budget: least behind this week.')
  })

  it('does not claim "least behind" when no weekly target covers the muscle', () => {
    const drops = run(15).modelExercises.filter(m => m.action === 'drop')
    expect(drops[0].dropReason).toContain('lowest priority in the session')
  })

  // The last drop keeps a pair that fits (#2078). Value order would drop the cheap curl and leave
  // squat + row, which overrun 14 minutes; the row goes instead, and the sheet says why rather than
  // claiming it was the least valuable. Pair-rule band for this fixture, measured: 11–18 min.
  it('names the pair rule when it, not value order, chose the drop', () => {
    const r = buildRulesReview({
      exercises: [
        { sessionExerciseId: SQUAT, name: 'Squat', sets: 3, reps: 5, pct: 80, restSec: 180 },
        { sessionExerciseId: ROW, name: 'Row', sets: 3, reps: 10, pct: 72, restSec: 240 },
        { sessionExerciseId: CURL, name: 'Curl', sets: 2, reps: 10, pct: 65, restSec: 60 },
      ],
      signals: signals({ effectiveTimeBudgetMin: 14 }),
      budgetMin: 14,
    })
    expect(r.modelExercises.map(m => [m.sessionExerciseId, m.action])).toEqual([[ROW, 'drop']])
    expect(r.modelExercises[0].dropReason).toContain('the two exercises left fit together')
  })

  // An unchanged exercise is omitted, not sent as an explicit `keep` — `reconcileReview` reads a
  // missing entry as a keep, and two ways of saying it is how they drift.
  it('omits an unchanged exercise instead of sending an explicit keep', () => {
    expect(run(120).modelExercises.map(m => m.action)).not.toContain('keep')
  })

  // Deterministic means deterministic: same inputs, same answer, every time.
  it('returns the same proposal for the same inputs', () => {
    expect(JSON.stringify(run(25))).toBe(JSON.stringify(run(25)))
  })

  /**
   * Role plausibility runs BEFORE the budget passes, so an accessory configured above its
   * ceiling is brought into shape even when the session has time to spare. Every other fixture
   * here sits at 3 sets, which is plausible for all three roles — so without this case the call
   * is a no-op on the whole file and deleting it would pass (it did, in the mutation run).
   */
  it('caps an implausible set count even when the budget is not the constraint', () => {
    const r = buildRulesReview({
      exercises: [
        { sessionExerciseId: SQUAT, name: 'Squat', sets: 3, reps: 5, pct: 80, restSec: 180 },
        { sessionExerciseId: CURL, name: 'Curl', sets: 9, reps: 12, pct: 65, restSec: 90 },
      ],
      signals: signals({ effectiveTimeBudgetMin: 600 }),
      budgetMin: 600,
    })
    const curl = r.modelExercises.find(m => m.sessionExerciseId === CURL)
    expect(curl, 'a 9-set accessory should not survive untouched').toBeDefined()
    expect(curl!.action).toBe('adjust')
    expect(curl!.sets).toBeLessThan(9)
  })

  // Trim priority weighs a cut against the muscle's weekly target, which is the whole reason the
  // muscle map is shared with the prescription path rather than rebuilt here.
  it('sends the muscle furthest ahead of its weekly target first', () => {
    const r = run(1, { weeklyTargets: { quads: 10, back: 10, biceps: 10 }, weeklyLogged: { quads: 0, back: 0, biceps: 30 } })
    const dropped = r.modelExercises.filter(m => m.action === 'drop').map(m => m.sessionExerciseId)
    expect(dropped).toContain(CURL)
  })
})

it('untimed session reviews retain all work without showing an over-budget failure', () => {
  const result = run(0)
  expect(result.modelExercises).toEqual([])
  expect(result.reasoning).toContain('No time limit')
  expect(result.reasoning).not.toContain('0-min')
})
