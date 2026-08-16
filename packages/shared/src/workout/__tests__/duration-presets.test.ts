import { describe, it, expect } from 'vitest'
import {
  budgetForPreset,
  warmupGoalSecFor,
  warmupBudgetMin,
  DURATION_PRESET_DELTA_MIN,
  MIN_PRESET_BUDGET_MIN,
  MIN_WARMUP_MIN,
} from '@trainingai/shared/workout/duration-model'

describe('budgetForPreset', () => {
  it('leaves the session budget alone for standard (and when unset)', () => {
    expect(budgetForPreset(60, 'standard')).toBe(60)
    expect(budgetForPreset(60, undefined)).toBe(60)
    expect(budgetForPreset(45, 'standard')).toBe(45)
  })

  it('is RELATIVE to the session budget, not a fixed clock', () => {
    // The whole point of the 2026-07-29 change: shortening a 75-minute session gives 45, not a
    // fixed 30 — and lengthening a 45-minute one gives 75, not a fixed 90.
    expect(budgetForPreset(75, 'short')).toBe(75 - DURATION_PRESET_DELTA_MIN)
    expect(budgetForPreset(45, 'long')).toBe(45 + DURATION_PRESET_DELTA_MIN)
    // A 45-minute session's "quick" would be 15, which the floor lifts to the minimum.
    expect(budgetForPreset(45, 'short')).toBe(MIN_PRESET_BUDGET_MIN)
  })

  it('reproduces the old 30/90 numbers for a 60-minute session', () => {
    // The owner's sessions are 60 min, so this change must be numerically invisible to them.
    expect(budgetForPreset(60, 'short')).toBe(30)
    expect(budgetForPreset(60, 'long')).toBe(90)
  })

  it('floors a shortened session rather than going to zero or negative', () => {
    expect(budgetForPreset(30, 'short')).toBe(MIN_PRESET_BUDGET_MIN)
    expect(budgetForPreset(20, 'short')).toBe(MIN_PRESET_BUDGET_MIN)
    expect(budgetForPreset(10, 'short')).toBe(MIN_PRESET_BUDGET_MIN)
  })

  it('never floors the long preset — more time is always allowed', () => {
    expect(budgetForPreset(20, 'long')).toBe(50)
    expect(budgetForPreset(120, 'long')).toBe(150)
  })

  it('keeps short strictly below standard below long at every realistic budget', () => {
    for (const budget of [30, 40, 45, 50, 60, 75, 90, 120]) {
      const short = budgetForPreset(budget, 'short')
      const long = budgetForPreset(budget, 'long')
      expect(short).toBeLessThanOrEqual(budget)
      expect(long).toBeGreaterThan(budget)
    }
  })
})

/**
 * Q-212. The owner ran a 30-minute Quick session and the on-screen warm-up timer still counted to
 * 10 minutes: `warmup-screen.tsx` held a flat `WARMUP_GOAL_SEC = 600` while this model was already
 * scaling the *planning* budget correctly. So the exercise list was trimmed for a ~5-minute warm-up
 * and the lifter was shown a 10-minute one — two numbers for the same thing.
 */
describe('warmupGoalSecFor — the timer and the plan agree', () => {
  it('gives the owner-reported case ~5 minutes, not 10', () => {
    // A 60-min session on Quick is a 30-min budget; the flat constant showed 600 s.
    expect(warmupGoalSecFor(60, 'short')).toBe(5 * 60)
  })

  it('is the same number the planner trims against, not a parallel formula', () => {
    // The point of the shared helper: if these ever diverge, the lifter watches one clock while the
    // plan was built for another — which is the bug.
    for (const [budget, preset] of [[60, 'standard'], [60, 'short'], [45, 'long'], [90, 'standard']] as const) {
      const todays = budgetForPreset(budget, preset)
      expect(warmupGoalSecFor(budget, preset)).toBe(warmupBudgetMin(todays, undefined, budget) * 60)
    }
  })

  it('scales with session length instead of being flat', () => {
    const short = warmupGoalSecFor(60, 'short')!
    const standard = warmupGoalSecFor(60, 'standard')!
    const long = warmupGoalSecFor(60, 'long')!
    expect(short).toBeLessThan(standard)
    expect(standard).toBeLessThan(long)
  })

  it('follows the fraction on the shortest legal budget — MIN_WARMUP_MIN does NOT floor it', () => {
    // Written first as `>= MIN_WARMUP_MIN`, which failed at 180 s. The model is right and the
    // assumption was wrong: MIN_WARMUP_MIN/MAX_WARMUP_MIN are documented as bounds on a *measured*
    // warmup allowance, and the fraction fallback below them is deliberately unclamped. A 45-min
    // session's "quick" floors at MIN_PRESET_BUDGET_MIN (20), and 15% of 20 is 3.
    //
    // Pinned as-is rather than "fixed": changing it would move the live planning budget the AI
    // trims against, which is not this timer fix's to change. Noted on the Q-212 entry instead —
    // the same 20-minute budget yields 3 min here and floors at 4 for a lifter with a measured
    // median, and whether that asymmetry is intended is a question for whoever owns the model.
    expect(warmupGoalSecFor(45, 'short')).toBe(3 * 60)
    expect(3).toBeLessThan(MIN_WARMUP_MIN)
  })

  it('does clamp to MIN_WARMUP_MIN once a measured median exists', () => {
    // The branch the floor is actually written for.
    expect(warmupGoalSecFor(45, 'short', 1)).toBe(MIN_WARMUP_MIN * 60)
  })

  it('returns null when the budget is unknown, so the caller shows its fallback', () => {
    // Computing from a placeholder would be a confidently wrong number on screen. Better to say
    // "I do not know yet" and let the caller keep the old constant until workout-data lands.
    expect(warmupGoalSecFor(undefined, 'short')).toBeNull()
    expect(warmupGoalSecFor(0, 'standard')).toBeNull()
    expect(warmupGoalSecFor(Number.NaN, 'standard')).toBeNull()
  })
})
