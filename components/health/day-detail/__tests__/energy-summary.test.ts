// Q-247 — owner report (Health → day detail): "the summary is; energy expenditure. the day overview
// doesnt show the calories in vs out. doesnt show the calorie expenditure for workouts or
// activities."
//
// The formula was never the problem — `computeActiveEnergy` already combines strength workouts,
// logged activities and passive steps correctly, and powers Nutrition's Energy Balance card. The
// day screen simply never asked for it. These tests cover the display rules the new section adds
// on top: when it stays hidden, and how the net figure is labelled.
import { describe, it, expect } from 'vitest'
import { energyDaySummary, workoutKcalBySession } from '../energy-summary'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

function response(over: {
  intakeKcal?: number; expenditureKcal?: number; restingBaseKcal?: number; netKcal?: number
  workoutKcal?: number; activityKcal?: number; stepsKcal?: number
  bySession?: { id: string; kcal: number }[]
  balanceNull?: boolean
}): EnergyBalanceResponse {
  return {
    date: '2026-08-15',
    balance: over.balanceNull ? null : {
      intakeKcal: over.intakeKcal ?? 0,
      expenditureKcal: over.expenditureKcal ?? 2389,
      restingBaseKcal: over.restingBaseKcal ?? 2197,
      activeKcal: 192, netKcal: over.netKcal ?? -2389, targetNetKcal: 0, deviationKcal: 0,
      remainingKcal: 0, projectedWeeklyKg: 0, zone: 'z', zoneLabel: 'z', zoneColor: 'z',
    },
    maintenance: null,
    target: { recommendedKcal: null, currentKcal: null, driftsFromRecommendation: false },
    activeBreakdown: {
      workoutKcal: over.workoutKcal ?? 0,
      activityKcal: over.activityKcal ?? 0,
      stepsKcal: over.stepsKcal ?? 0,
      // `source` defaults here so the existing cases stay about kcal arithmetic. The two cases at
      // the end of this file set it explicitly, because that is what they are about.
      workoutKcalBySession: (over.bySession ?? []).map(r => ({ source: 'met' as const, ...r })),
    },
    goal: null,
    missingProfileFields: [],
  } as EnergyBalanceResponse
}

describe('energyDaySummary (Q-247)', () => {
  it('stays hidden on a day with nothing logged, rather than reporting bare resting burn', () => {
    // Resting burn computes for every day the profile supports. Without this the empty state
    // ("Nothing logged on this day") would sit under "Eaten 0 / Burned 2,389 / Deficit −2,389".
    expect(energyDaySummary(response({ intakeKcal: 0, workoutKcal: 0, activityKcal: 0, stepsKcal: 0 }))).toBeNull()
  })

  it('shows once anything was eaten', () => {
    expect(energyDaySummary(response({ intakeKcal: 1800 }))).not.toBeNull()
  })

  it('shows on a day with only movement and no food logged', () => {
    expect(energyDaySummary(response({ intakeKcal: 0, stepsKcal: 190 }))).not.toBeNull()
  })

  it('reports the workout and activity expenditure the report asked for', () => {
    const s = energyDaySummary(response({ intakeKcal: 2000, workoutKcal: 290, activityKcal: 140, stepsKcal: 188 }))!
    expect(s.breakdown).toEqual([
      { label: 'Workouts', kcal: 290 },
      { label: 'Activity', kcal: 140 },
      { label: 'Steps', kcal: 188 },
      { label: 'Resting', kcal: 2197 },
    ])
  })

  it('names a deficit and a surplus rather than relying on colour', () => {
    expect(energyDaySummary(response({ intakeKcal: 1500, netKcal: -889 })!)!.netLabel).toBe('Deficit')
    expect(energyDaySummary(response({ intakeKcal: 3200, netKcal: 811 })!)!.netLabel).toBe('Surplus')
  })

  it('returns nothing when the profile is too incomplete for a balance', () => {
    // `computeEnergyBalance` returns balance: null with missingProfileFields set — measured against
    // the seeded dev user, which has no date of birth.
    expect(energyDaySummary(response({ balanceNull: true }))).toBeNull()
    expect(energyDaySummary(null)).toBeNull()
  })

  it('rounds every figure it hands the renderer', () => {
    const s = energyDaySummary(response({ intakeKcal: 1800.4, expenditureKcal: 2389.6, netKcal: -589.5, stepsKcal: 191.7 }))!
    expect(Number.isInteger(s.intakeKcal)).toBe(true)
    expect(Number.isInteger(s.expenditureKcal)).toBe(true)
    expect(Number.isInteger(s.netKcal)).toBe(true)
    expect(s.breakdown.every(b => Number.isInteger(b.kcal))).toBe(true)
  })
})

describe('workoutKcalBySession (Q-391)', () => {
  /**
   * The consistency requirement the entry names: the session cards on a day must sum to the ENERGY
   * section's "Workouts" row on the same screen. It holds **by construction** — these are the
   * addends `computeActiveEnergy` summed, not a second estimate — and this asserts the wiring keeps
   * it that way rather than trusting the comment.
   */
  it('the per-session parts sum exactly to the day total they were summed from', () => {
    const parts = [
      { id: 'a', kcal: 120.4 },
      { id: 'b', kcal: 130.2 },
      { id: 'c', kcal: 110.9 },
    ]
    const total = parts.reduce((n, p) => n + p.kcal, 0)
    const map = workoutKcalBySession(response({ workoutKcal: total, bySession: parts, intakeKcal: 500 }))
    expect([...map.values()].reduce((n, k) => n + k.kcal, 0)).toBeCloseTo(total, 10)
  })

  /**
   * And the reason the map is unrounded. Rounding each addend then summing is not the same number as
   * rounding the sum: these three render as 120 + 130 + 111 = 361 under a "Workouts 362" row. Half a
   * kcal per card is the accepted drift; compounding it inside the helper would not be.
   */
  it('leaves rounding to the caller, so the drift is bounded per card', () => {
    const parts = [{ id: 'a', kcal: 120.4 }, { id: 'b', kcal: 130.2 }, { id: 'c', kcal: 110.9 }]
    const map = workoutKcalBySession(response({ workoutKcal: 361.5, bySession: parts, intakeKcal: 500 }))
    expect(map.get('a')?.kcal).toBe(120.4)

    const renderedSum = [...map.values()].reduce((n, k) => n + Math.round(k.kcal), 0)
    const renderedTotal = Math.round(361.5)
    expect(Math.abs(renderedSum - renderedTotal)).toBeLessThanOrEqual(Math.ceil(parts.length / 2))
  })

  it('is keyed by session id, so two same-named sessions in a day do not collide', () => {
    // The whole reason the join is on id. Name-keying would leave one card showing the other's
    // figure — or one card showing both.
    const map = workoutKcalBySession(response({
      bySession: [{ id: 'morning', kcal: 200 }, { id: 'evening', kcal: 90 }],
      workoutKcal: 290, intakeKcal: 500,
    }))
    expect(map.size).toBe(2)
    expect(map.get('morning')?.kcal).toBe(200)
    expect(map.get('evening')?.kcal).toBe(90)
  })

  it('yields no entry rather than a zero when the estimate could not be made', () => {
    // A profile missing age/weight/sex produces no addends. The card must then show nothing — a
    // confident "0 kcal" is indistinguishable from a real one (the Q-278 class).
    const map = workoutKcalBySession(response({ workoutKcal: 0, intakeKcal: 500 }))
    expect(map.get('anything')).toBeUndefined()
    expect(map.size).toBe(0)
  })

  it('survives a response with no balance at all', () => {
    expect(workoutKcalBySession(response({ balanceNull: true })).size).toBe(0)
    expect(workoutKcalBySession(null).size).toBe(0)
  })

  /**
   * Q-421's remaining clause. About half the owner's sessions have no strap reading, so a day
   * routinely holds one card produced by Keytel from heart rate and another by a MET tier over the
   * clock — two formulas whose outputs overlap rather than agree. If the helper drops `source` the
   * card cannot say which, and two adjacent numbers look like the same measurement.
   */
  it('carries each session\'s basis, because one day can hold both', () => {
    const map = workoutKcalBySession(response({
      bySession: [
        { id: 'strapped', kcal: 321, source: 'hr' as const },
        { id: 'bare', kcal: 300, source: 'met' as const },
      ],
      workoutKcal: 621, intakeKcal: 500,
    }))
    expect(map.get('strapped')?.source).toBe('hr')
    expect(map.get('bare')?.source).toBe('met')
  })

  it('does not invent a basis it was not given', () => {
    // Mutation guard: hardcoding either literal in the helper passes the case above for the wrong
    // reason. Both addends here are 'hr', so a hardcoded 'met' fails and vice versa.
    const map = workoutKcalBySession(response({
      bySession: [{ id: 'a', kcal: 10, source: 'hr' as const }, { id: 'b', kcal: 20, source: 'hr' as const }],
      workoutKcal: 30, intakeKcal: 500,
    }))
    expect([...map.values()].map(v => v.source)).toEqual(['hr', 'hr'])
  })
})
