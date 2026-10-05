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

  // Sets are the cheap lever: trimming happens before anything is dropped, because losing a whole
  // exercise is the answer of last resort.
  // 15 minutes is inside the measured trim-only band for this fixture: 21 already fits, and 11
  // is low enough to force a drop. Pinned to a band rather than a single value on purpose — a
  // duration-model change that moves the boundary should show up here (#2132 moved it from 15–30).
  it('trims sets before it drops anything', () => {
    const r = run(15)
    expect(r.modelExercises.length).toBeGreaterThan(0)
    expect(r.modelExercises.every(m => m.action === 'adjust')).toBe(true)
    expect(r.reasoning).toContain('trimmed')
    expect(r.reasoning).not.toContain('dropped')
  })

  // `applyBudgetStage` declines to drop unless the user explicitly asked for a SHORT session,
  // because there the under-fill is the finish-early margin. A review is the opposite situation —
  // the user opened it to be told what does not fit — so this path drops when trimming runs out.
  it('drops once trimming has run out of room, keeping the main compound lift', () => {
    const r = run(1)
    const dropped = r.modelExercises.filter(m => m.action === 'drop').map(m => m.sessionExerciseId)
    // Never below two exercises (#2078), so one of the three goes.
    expect(dropped).toEqual([CURL])
    expect(r.reasoning).toContain('does not fit')
  })

  // The sentence per drop was the model's one irreplaceable output. It is not duplicated here —
  // `reconcileReview` owns the fallback string, so `dropReason` is left unset on purpose.
  it('leaves the drop reason to reconcileReview rather than writing a second copy', () => {
    const dropped = run(1).modelExercises.filter(m => m.action === 'drop')
    expect(dropped.length).toBeGreaterThan(0)
    for (const d of dropped) expect(d.dropReason).toBeUndefined()
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
