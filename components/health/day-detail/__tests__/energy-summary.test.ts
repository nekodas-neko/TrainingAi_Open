// Q-247 — owner report (Health → day detail): "the summary is; energy expenditure. the day overview
// doesnt show the calories in vs out. doesnt show the calorie expenditure for workouts or
// activities."
//
// The formula was never the problem — `computeActiveEnergy` already combines strength workouts,
// logged activities and passive steps correctly, and powers Nutrition's Energy Balance card. The
// day screen simply never asked for it. These tests cover the display rules the new section adds
// on top: when it stays hidden, and how the net figure is labelled.
import { describe, it, expect } from 'vitest'
import { energyDaySummary } from '../energy-summary'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

function response(over: {
  intakeKcal?: number; expenditureKcal?: number; restingBaseKcal?: number; netKcal?: number
  workoutKcal?: number; activityKcal?: number; stepsKcal?: number
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
