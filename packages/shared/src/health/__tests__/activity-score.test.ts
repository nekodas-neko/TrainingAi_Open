import { describe, it, expect } from 'vitest'
import { computeActivityScore, volumeTargetKg } from '@trainingai/shared/health/activity-score'
import type { DailyGoals } from '@trainingai/shared/health/daily-goals'

// NOTE: `**/__tests__/**` is excluded from tsconfig, so a missing field here is NOT a compile
// error — it surfaces as NaN through the score. Keep this literal complete.
const GOALS: DailyGoals = { stepGoal: 8000, activeEnergyGoal: 400, zoneMinutesGoal: 22, strengthFreqGoal: 3, sessionVolumeGoalKg: 5000 }

function input(overrides: Partial<Parameters<typeof computeActivityScore>[0]> = {}) {
  return {
    steps: null, activeCalories: null, zoneMinutes: null, moveHours: null, moveHoursGoal: null,
    sessions7d: 0, volume7dKg: 0, typicalSessionVolumeKg: 5000, goals: GOALS, acwr: null,
    ...overrides,
  }
}

describe('computeActivityScore (goal-anchored, two-lane)', () => {
  it('returns null when there is nothing to score', () => {
    expect(computeActivityScore(input())).toBeNull()
  })

  it('scores movement against absolute goals, not a trailing average', () => {
    const atGoal = computeActivityScore(input({ steps: 8000 }))!
    const half = computeActivityScore(input({ steps: 4000 }))!
    expect(atGoal.components.steps).toBe(100)
    expect(half.components.steps).toBe(50)
  })

  it('caps a goal component at 100 for a day well above target', () => {
    const r = computeActivityScore(input({ steps: 20000 }))!
    expect(r.components.steps).toBe(100)
  })

  it('a perfect day reaches 100', () => {
    const r = computeActivityScore(input({
      steps: 8000, activeCalories: 410, zoneMinutes: 22, moveHours: 11, moveHoursGoal: 11,
      sessions7d: 3, volume7dKg: 15000, // 3 typical (5000) sessions
    }))!
    expect(r.score).toBe(100)
    expect(r.preTaperScore).toBe(100)
    expect(r.taperApplied).toBe(false)
  })

  it('a rest day still scores well off the rolling-7-day strength lane', () => {
    // No steps/calories today, but trained 3× this week → strength lane keeps it high.
    const r = computeActivityScore(input({ steps: 0, sessions7d: 3, volume7dKg: 15000 }))!
    expect(r.components.strengthFreq).toBe(100) // 3 of a 3-session goal = goal met
    expect(r.score).toBeGreaterThan(60)
  })

  it('rewards training more than twice a week (graded, not pass/fail)', () => {
    const twice = computeActivityScore(input({ sessions7d: 2, volume7dKg: 10000 }))!
    const fourTimes = computeActivityScore(input({ sessions7d: 4, volume7dKg: 20000 }))!
    expect(fourTimes.components.strengthFreq).toBeGreaterThan(twice.components.strengthFreq)
  })

  it('tapers the final score below the goal-completion score when ACWR is over-reaching', () => {
    const base = { steps: 8000, activeCalories: 410, zoneMinutes: 22, sessions7d: 4, volume7dKg: 20000 }
    const optimal = computeActivityScore(input({ ...base, acwr: 1.05 }))!
    const overreach = computeActivityScore(input({ ...base, acwr: 2.0 }))!
    expect(optimal.taperApplied).toBe(false)
    expect(overreach.taperApplied).toBe(true)
    expect(overreach.score).toBeLessThan(overreach.preTaperScore)
    // Readiness reads the pre-taper score — it is not dragged down by the taper.
    expect(overreach.preTaperScore).toBeGreaterThanOrEqual(optimal.preTaperScore)
  })

  it('omits absent components rather than fabricating them', () => {
    const r = computeActivityScore(input({ steps: 8000, sessions7d: 2, volume7dKg: 10000 }))!
    expect(r.components).toHaveProperty('steps')
    expect(r.components).toHaveProperty('strengthFreq')
    expect(r.components).not.toHaveProperty('activeEnergy')
    expect(r.components).not.toHaveProperty('zoneMinutes')
  })
})

// Q-183. Measured over the owner's last 45 days: 40 were exactly zero zone minutes, 32 of those on
// a day they lifted. Scoring that as a missed cardio target at full weight punished the shape of
// their training, not their behaviour.
describe('computeActivityScore — a lifting day with no zone-2+ minutes (Q-183)', () => {
  const lifted = { sessions7d: 3, volume7dKg: 15000, steps: 8000 }

  it('excludes the lane instead of scoring it zero', () => {
    const r = computeActivityScore(input({ ...lifted, zoneMinutes: 0, strengthSessionToday: true }))!
    expect(r.components).not.toHaveProperty('zoneMinutes')
  })

  it('renormalises rather than redistributing to nothing — the score rises off the same inputs', () => {
    const excluded = computeActivityScore(input({ ...lifted, zoneMinutes: 0, strengthSessionToday: true }))!
    const scoredZero = computeActivityScore(input({ ...lifted, zoneMinutes: 0, strengthSessionToday: false }))!
    expect(excluded.score).toBeGreaterThan(scoredZero.score)
  })

  it('still scores real cardio done on a lifting day', () => {
    const r = computeActivityScore(input({ ...lifted, zoneMinutes: 22, strengthSessionToday: true }))!
    expect(r.components.zoneMinutes).toBe(100)
  })

  it('a REST day with no zone minutes is still scored zero — that one is a real miss', () => {
    const r = computeActivityScore(input({ ...lifted, zoneMinutes: 0, strengthSessionToday: false }))!
    expect(r.components.zoneMinutes).toBe(0)
  })

  it('does nothing when the flag is absent, so every existing caller is unaffected', () => {
    const r = computeActivityScore(input({ ...lifted, zoneMinutes: 0 }))!
    expect(r.components.zoneMinutes).toBe(0)
  })
})

// Q-137 (2026-08-11): raising DEFAULT_STRENGTH_FREQ_GOAL from 3 to 5 unfreezes BOTH strength
// contributors, because the volume lane's target is derived from it —
// `volTarget = typicalSessionVolumeKg × strengthFreqGoal` (activity-score.ts).
//
// Numbers are the owner's measured ones, so this fails if either lane re-saturates: median session
// tonnage 4,700 kg; a strong week 25,159 kg over 5 sessions; a weak week 16,843 kg over 3.
describe('strength lanes discriminate once the frequency goal matches the athlete (Q-137)', () => {
  const TYPICAL_SESSION_KG = 4_700
  const STRONG_WEEK = { sessions7d: 5, volume7dKg: 25_159 }
  const WEAK_WEEK   = { sessions7d: 3, volume7dKg: 16_843 }

  const strengthOnly = (goal: number, week: { sessions7d: number; volume7dKg: number }) =>
    computeActivityScore(input({
      ...week,
      typicalSessionVolumeKg: TYPICAL_SESSION_KG,
      goals: { ...GOALS, strengthFreqGoal: goal },
    }))!

  it('the OLD goal of 3 scored a weak week identically to a strong one', () => {
    // volTarget was 4,700 × 3 = 14,100 — below even the weak week's 16,843 — so both lanes
    // clamped to 100 and 45 of the 100 available weight carried no information at all.
    const strong = strengthOnly(3, STRONG_WEEK)
    const weak   = strengthOnly(3, WEAK_WEEK)
    expect(weak.components.strengthFreq).toBe(strong.components.strengthFreq)
    expect(weak.components.strengthVolume).toBe(strong.components.strengthVolume)
    expect(weak.score).toBe(strong.score)
  })

  it('the NEW goal of 5 separates them on both lanes', () => {
    // volTarget is now 4,700 × 5 = 23,500, which the strong week clears and the weak week does not.
    const strong = strengthOnly(5, STRONG_WEEK)
    const weak   = strengthOnly(5, WEAK_WEEK)
    expect(weak.components.strengthFreq).toBeLessThan(strong.components.strengthFreq)
    expect(weak.components.strengthVolume).toBeLessThan(strong.components.strengthVolume)
    expect(weak.score).toBeLessThan(strong.score)
  })

  it('a strong week still reaches the target — the goal is raised, not made unreachable', () => {
    const strong = strengthOnly(5, STRONG_WEEK)
    expect(strong.components.strengthFreq).toBe(100)
    expect(strong.components.strengthVolume).toBe(100)
  })
})

// Q-190 (2026-08-11): the volume target was `typicalSessionVolumeKg × strengthFreqGoal` — the
// median of the user's OWN sessions. Train harder, the median rises, the target rises, the score
// stays put: the treadmill the 2026-07-22 rewrite removed from the daily-movement lane and left
// here. It is now an absolute per-session goal.
describe('the volume target is absolute, not the user\'s own median (Q-190)', () => {
  const GOALS_V: DailyGoals = { ...GOALS, strengthFreqGoal: 5, sessionVolumeGoalKg: 5200 }
  const week = (volume7dKg: number, typicalSessionVolumeKg: number) =>
    computeActivityScore(input({ sessions7d: 5, volume7dKg, typicalSessionVolumeKg, goals: GOALS_V }))!

  it('scores the same week identically however strong the athlete has become', () => {
    // THE regression. Same training week, three very different personal medians. Before the fix the
    // stronger athlete was punished for having a higher median — the target moved with them.
    const beginner     = week(25_159, 2_000)
    const intermediate = week(25_159, 4_438) // the owner's measured median
    const advanced     = week(25_159, 9_000)
    expect(intermediate.components.strengthVolume).toBe(beginner.components.strengthVolume)
    expect(advanced.components.strengthVolume).toBe(beginner.components.strengthVolume)
  })

  it('separates the owner\'s measured weak, typical and strong weeks', () => {
    // volTarget = 5,200 × 5 = 26,000. Measured weeks over 8 weeks: 16,843 / 25,159 / 31,083.
    const weak    = week(16_843, 4_438).components.strengthVolume
    const typical = week(25_159, 4_438).components.strengthVolume
    const strong  = week(31_083, 4_438).components.strengthVolume
    expect(weak).toBeLessThan(typical)
    expect(typical).toBeLessThan(100)   // near the target, not at it — a typical week is not a best week
    expect(strong).toBe(100)            // and a strong week is still reachable
  })

  it('volumeTargetKg is the single formula all three surfaces read', () => {
    // Model, score-audit note and the Activity screen's progress-bar max all call this. Three
    // copies existed before; changing one and not the others would have shown a target different
    // from the one being scored, with nothing failing.
    expect(volumeTargetKg({ sessionVolumeGoalKg: 5200, strengthFreqGoal: 5 })).toBe(26_000)
    expect(volumeTargetKg({ sessionVolumeGoalKg: 0, strengthFreqGoal: 0 })).toBe(1) // degenerate, never divides by zero
  })
})
