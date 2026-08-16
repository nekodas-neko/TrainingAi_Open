import { describe, it, expect } from 'vitest'
import {
  SECONDS_PER_REP, SET_SETUP_SEC,
  WARMUP_FRACTION, workingBudgetMin, warmupBudgetMin, MIN_WARMUP_MIN, MAX_WARMUP_MIN,
  WARMUP_CEILING_FRACTION, MIN_PRESET_BUDGET_MIN,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT, TRANSITION_SEC_DEFAULT,
  transitionSecForEquipment, setWorkSec, effectiveSetWorkSec, styleWorkSec, warmupRampSectionSec,
  estimateExerciseDurationSec, estimateSessionDurationSec, estimateSessionDurationMin,
} from '@trainingai/shared/workout/duration-model'

describe('transitionSecForEquipment', () => {
  it('barbell anywhere in the options list wins (worst case)', () => {
    expect(transitionSecForEquipment(['barbell'])).toBe(TRANSITION_SEC_BARBELL)
    expect(transitionSecForEquipment(['dumbbell', 'barbell'])).toBe(TRANSITION_SEC_BARBELL)
    expect(transitionSecForEquipment(['machine', 'barbell', 'dumbbell', 'kettlebell'])).toBe(TRANSITION_SEC_BARBELL)
  })

  it('machine/dumbbell/cable/kettlebell class is standard', () => {
    expect(transitionSecForEquipment(['machine'])).toBe(TRANSITION_SEC_STANDARD)
    expect(transitionSecForEquipment(['dumbbell', 'cable'])).toBe(TRANSITION_SEC_STANDARD)
    expect(transitionSecForEquipment(['kettlebell'])).toBe(TRANSITION_SEC_STANDARD)
  })

  it('pure bodyweight is cheapest', () => {
    expect(transitionSecForEquipment(['bodyweight'])).toBe(TRANSITION_SEC_BODYWEIGHT)
  })

  it('bodyweight mixed with equipment uses the equipment class', () => {
    expect(transitionSecForEquipment(['bodyweight', 'machine'])).toBe(TRANSITION_SEC_STANDARD)
  })

  it('unknown/empty equipment assumes the worst case', () => {
    expect(transitionSecForEquipment([])).toBe(TRANSITION_SEC_DEFAULT)
    expect(transitionSecForEquipment(undefined)).toBe(TRANSITION_SEC_DEFAULT)
    expect(TRANSITION_SEC_DEFAULT).toBe(TRANSITION_SEC_BARBELL)
  })
})

describe('duration formula', () => {
  it('setWorkSec = setup + reps × tempo', () => {
    expect(setWorkSec(5)).toBe(SET_SETUP_SEC + 5 * SECONDS_PER_REP)
  })

  it('exercise duration = sets×setWork + sets×rest + transition', () => {
    const ex = { sets: 3, reps: 5, restSec: 120, transitionSec: 240 }
    expect(estimateExerciseDurationSec(ex)).toBe(3 * setWorkSec(5) + 3 * 120 + 240)
  })

  // The last set's rest is real time, distinct from the inter-exercise transition — see the
  // production measurement in duration-model.ts. The old `sets − 1` form conflated them and
  // under-estimated every session by ~1 rest per exercise.
  it('charges rest for every set, including the last', () => {
    expect(estimateExerciseDurationSec({ sets: 1, reps: 5, restSec: 180, transitionSec: 120 }))
      .toBe(setWorkSec(5) + 180 + 120)
  })

  it('an extra set costs one set of work plus one full rest', () => {
    const shape = { reps: 8, restSec: 90, transitionSec: 240 }
    const three = estimateExerciseDurationSec({ ...shape, sets: 3 })
    const four = estimateExerciseDurationSec({ ...shape, sets: 4 })
    expect(four - three).toBe(setWorkSec(8) + 90)
  })

  it('a barbell exercise costs 2 minutes more than the same machine exercise', () => {
    const shape = { sets: 4, reps: 8, restSec: 90 }
    const barbell = estimateExerciseDurationSec({ ...shape, transitionSec: TRANSITION_SEC_BARBELL })
    const machine = estimateExerciseDurationSec({ ...shape, transitionSec: TRANSITION_SEC_STANDARD })
    expect(barbell - machine).toBe(120)
  })

  it('session duration sums exercises and rounds to minutes', () => {
    const exs = [
      { sets: 2, reps: 6, restSec: 90, transitionSec: 240 },
      { sets: 3, reps: 8, restSec: 60, transitionSec: 120 },
    ]
    expect(estimateSessionDurationSec(exs))
      .toBe(estimateExerciseDurationSec(exs[0]) + estimateExerciseDurationSec(exs[1]))
    expect(estimateSessionDurationMin(exs)).toBe(Math.round(estimateSessionDurationSec(exs) / 60))
  })

  it('styleWorkSec sums per-set work + rest with no transition', () => {
    const sets = [{ reps: 5, restSec: 120 }, { reps: 5, restSec: 120 }]
    expect(styleWorkSec(sets)).toBe(2 * setWorkSec(5) + 2 * 120)
  })

  it('working budget carves out only the warmup fraction (no finish-early buffer)', () => {
    expect(WARMUP_FRACTION).toBeCloseTo(0.15)
    expect(workingBudgetMin(60)).toBe(51)  // 60 − 9 warmup; margin comes from beating rest/set estimates
    expect(workingBudgetMin(30)).toBe(26)  // short session gets a short warmup allowance
    expect(workingBudgetMin(10)).toBe(15)  // floor guards degenerate configs
  })

  it('a measured warmup median replaces the flat fraction, clamped to [MIN, MAX]', () => {
    expect(MIN_WARMUP_MIN).toBe(4)
    expect(MAX_WARMUP_MIN).toBe(15)
    // Fast warmer: 4-min measured warmup → 4-min carve-out (vs 9 flat), 56 min working.
    expect(warmupBudgetMin(60, 4)).toBe(4)
    expect(workingBudgetMin(60, 4)).toBe(56)
    // Floor: a barely-tracked 2-min warmup is clamped up to the 4-min minimum.
    expect(warmupBudgetMin(60, 2)).toBe(MIN_WARMUP_MIN)
    expect(workingBudgetMin(60, 2)).toBe(56)
    // Ceiling: a 20-min measured warmup is clamped down to 15.
    expect(warmupBudgetMin(60, 20)).toBe(MAX_WARMUP_MIN)
    expect(workingBudgetMin(60, 20)).toBe(45)
    // Rounds a fractional measured value.
    expect(warmupBudgetMin(60, 6.4)).toBe(6)
    expect(workingBudgetMin(60, 6.4)).toBe(54)
  })

  it('null/absent measured warmup preserves the flat-fraction default exactly', () => {
    expect(warmupBudgetMin(60)).toBe(9)
    expect(warmupBudgetMin(60, null)).toBe(9)
    expect(workingBudgetMin(60, null)).toBe(51)
    expect(workingBudgetMin(60, undefined)).toBe(51)
    expect(workingBudgetMin(60)).toBe(51)
    // A non-positive measured value is treated as no data, not a zero-warmup budget.
    expect(workingBudgetMin(60, 0)).toBe(51)
  })

  // Q-83: the measured median is learned at the session's standard length, so subtracting it
  // whole from a budget shortened for today charged a 30-min "Quick" the 9 min learned at 60.
  it('a shortened budget caps the measured warmup at a share of that budget', () => {
    expect(WARMUP_CEILING_FRACTION).toBeCloseTo(0.2)
    // The owner's case: 9-min measured warmup, 60-min session, squeezed to 30 today.
    // Before: 9 min carved (30% of the budget) → 21 working. Now 6 (20%) → 24.
    expect(warmupBudgetMin(30, 9, 60)).toBe(6)
    expect(workingBudgetMin(30, 9, 60)).toBe(24)
    // Below the ceiling it is used as-is — the cap bounds, it does not rescale.
    expect(warmupBudgetMin(30, 5, 60)).toBe(5)
    expect(workingBudgetMin(30, 5, 60)).toBe(25)
    // The floor still wins over the ceiling, and the two meet exactly at the shortest
    // legal budget, so they can never invert for anything budgetForPreset emits.
    expect(Math.round(MIN_PRESET_BUDGET_MIN * WARMUP_CEILING_FRACTION)).toBe(MIN_WARMUP_MIN)
    expect(warmupBudgetMin(MIN_PRESET_BUDGET_MIN, 9, 60)).toBe(MIN_WARMUP_MIN)
  })

  it('the cap is inert at or above the session\'s own length, and without a reference', () => {
    // 'standard' preset — today's budget IS the session's length. Measured value is ground
    // truth at that length, including a session genuinely configured at 30 min where a 9-min
    // warmup really is 30% of it.
    expect(warmupBudgetMin(30, 9, 30)).toBe(9)
    expect(workingBudgetMin(30, 9, 30)).toBe(21)
    // 'long' preset — a longer budget is never capped.
    expect(warmupBudgetMin(90, 9, 60)).toBe(9)
    expect(workingBudgetMin(90, 9, 60)).toBe(81)
    // Callers with no preset in play (generate-program, builder-chat) omit the reference
    // entirely and keep the pre-Q-83 behaviour.
    expect(warmupBudgetMin(30, 9)).toBe(9)
    expect(warmupBudgetMin(30, 9, null)).toBe(9)
    // A 15-min measured warmup at a 60-min session is left alone — the ceiling only ever
    // binds below the standard length, so no standard-path plan changes.
    expect(warmupBudgetMin(60, 15, 60)).toBe(MAX_WARMUP_MIN)
  })

  it('measured values override the constants when present, per field', () => {
    expect(effectiveSetWorkSec(10, 3)).toBe(SET_SETUP_SEC + 10 * 3)
    expect(effectiveSetWorkSec(10, null)).toBe(setWorkSec(10))
    expect(effectiveSetWorkSec(10, undefined)).toBe(setWorkSec(10))
    const ex = { sets: 3, reps: 10, restSec: 90, transitionSec: 120, measuredSecPerRep: 3, measuredRestSec: 150 }
    expect(estimateExerciseDurationSec(ex)).toBe(3 * (SET_SETUP_SEC + 30) + 3 * 150 + 120)
    // rest override alone leaves work on the constant model
    expect(estimateExerciseDurationSec({ sets: 3, reps: 10, restSec: 90, transitionSec: 120, measuredRestSec: 150 }))
      .toBe(3 * setWorkSec(10) + 3 * 150 + 120)
  })
})

describe('warmupRampSectionSec', () => {
  it('splits the barbell transition assumption across 3 stages (4:00 total)', () => {
    expect(warmupRampSectionSec(['barbell'], 3)).toBe(80) // 240 / 3
  })

  it('splits the standard-equipment transition across 3 stages (2:00 total, unchanged today)', () => {
    expect(warmupRampSectionSec(['machine'], 3)).toBe(40) // 120 / 3
    expect(warmupRampSectionSec(['dumbbell', 'cable'], 3)).toBe(40)
  })

  it('splits the bodyweight transition across 3 stages (1:00 total)', () => {
    expect(warmupRampSectionSec(['bodyweight'], 3)).toBe(20) // 60 / 3
  })

  it('unknown/empty equipment assumes the barbell worst case', () => {
    expect(warmupRampSectionSec([], 3)).toBe(80)
    expect(warmupRampSectionSec(undefined, 3)).toBe(80)
  })

  it('falls back to a flat 40s per section if sectionCount is 0 (no divide-by-zero)', () => {
    expect(warmupRampSectionSec(['barbell'], 0)).toBe(40)
  })
})
