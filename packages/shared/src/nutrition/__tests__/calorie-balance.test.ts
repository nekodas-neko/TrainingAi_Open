import { describe, it, expect } from 'vitest'
import {
  balanceZone, computeCalorieBalance, barProgress,
  targetFromMaintenance, goalToDailyKcal, dailyKcalToGoal,
  ON_TARGET_KCAL, OUTER_KCAL,
} from '../calorie-balance'

describe('balanceZone', () => {
  it('bands deviation symmetrically around the goal target', () => {
    expect(balanceZone(0).zone).toBe('on_target')
    expect(balanceZone(ON_TARGET_KCAL).zone).toBe('on_target')
    expect(balanceZone(-ON_TARGET_KCAL).zone).toBe('on_target')
    expect(balanceZone(ON_TARGET_KCAL + 1).zone).toBe('over')
    expect(balanceZone(-ON_TARGET_KCAL - 1).zone).toBe('under')
    expect(balanceZone(OUTER_KCAL).zone).toBe('over')
    expect(balanceZone(OUTER_KCAL + 1).zone).toBe('far_over')
    expect(balanceZone(-OUTER_KCAL - 1).zone).toBe('far_under')
  })

  it('always pairs the colour with a text label', () => {
    for (const dev of [-900, -300, 0, 300, 900]) {
      const z = balanceZone(dev)
      expect(z.label.length).toBeGreaterThan(0)
      expect(z.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('computeCalorieBalance', () => {
  it('counts movement as calories out, not as extra budget', () => {
    const r = computeCalorieBalance({
      restingBaseKcal: 1800, activeKcal: 400, intakeKcal: 2000, goalDeltaKcal: 0,
    })
    expect(r.expenditureKcal).toBe(2200)
    expect(r.netKcal).toBe(-200)
  })

  it('treats maintenance as OFF target for someone cutting', () => {
    // Ate exactly what they burned, but the goal calls for a 500 kcal deficit.
    const r = computeCalorieBalance({
      restingBaseKcal: 2000, activeKcal: 0, intakeKcal: 2000, goalDeltaKcal: -500,
    })
    expect(r.netKcal).toBe(0)
    expect(r.deviationKcal).toBe(500)
    expect(r.zone).toBe('far_over')
  })

  it('is on target when the net matches the goal deficit', () => {
    const r = computeCalorieBalance({
      restingBaseKcal: 2000, activeKcal: 300, intakeKcal: 1800, goalDeltaKcal: -500,
    })
    expect(r.netKcal).toBe(-500)
    expect(r.deviationKcal).toBe(0)
    expect(r.zone).toBe('on_target')
    expect(r.remainingKcal).toBe(0)
  })

  it('reports remaining kcal to land on target', () => {
    const r = computeCalorieBalance({
      restingBaseKcal: 2000, activeKcal: 0, intakeKcal: 1000, goalDeltaKcal: -500,
    })
    // Burned 2000, ate 1000, net −1000; goal wants −500, so 500 kcal still to eat.
    expect(r.remainingKcal).toBe(500)
    expect(r.zone).toBe('far_under')
  })

  it('flags an over-aggressive deficit as red, not as success', () => {
    const r = computeCalorieBalance({
      restingBaseKcal: 2000, activeKcal: 600, intakeKcal: 900, goalDeltaKcal: -500,
    })
    expect(r.netKcal).toBe(-1700)
    expect(r.zone).toBe('far_under')
    expect(r.zoneLabel).toBe('Well under')
  })

  it('projects weekly weight change from the net', () => {
    const r = computeCalorieBalance({
      restingBaseKcal: 2000, activeKcal: 0, intakeKcal: 1000, goalDeltaKcal: 0,
    })
    // −1000/day × 7 / 7700 ≈ −0.91 kg/week
    expect(r.projectedWeeklyKg).toBeCloseTo(-0.91, 2)
  })

  it('handles a gain goal with the same bands', () => {
    const r = computeCalorieBalance({
      restingBaseKcal: 2200, activeKcal: 300, intakeKcal: 2800, goalDeltaKcal: 300,
    })
    expect(r.netKcal).toBe(300)
    expect(r.zone).toBe('on_target')
  })
})

describe('barProgress', () => {
  const BUDGET = 2180

  it('puts the goal notch at the budget, with the far-over threshold as the whole tail', () => {
    const { notchPct } = barProgress({ intakeKcal: 0, budgetKcal: BUDGET })
    expect(notchPct).toBeCloseTo(BUDGET / (BUDGET + OUTER_KCAL), 6)
    // The tail is short on purpose: long enough to read, not long enough to look like a second
    // target to aim for.
    expect(1 - notchPct).toBeLessThan(0.2)
  })

  it('lands the fill exactly on the notch when intake equals the budget', () => {
    const { fillPct, notchPct } = barProgress({ intakeKcal: BUDGET, budgetKcal: BUDGET })
    expect(fillPct).toBeCloseTo(notchPct, 6)
  })

  it('clamps rather than overflowing the track', () => {
    expect(barProgress({ intakeKcal: 99999, budgetKcal: BUDGET }).fillPct).toBe(1)
    expect(barProgress({ intakeKcal: -500, budgetKcal: BUDGET }).fillPct).toBe(0)
  })

  it('keeps the stops in order and spanning the whole track', () => {
    const { stops } = barProgress({ intakeKcal: 0, budgetKcal: BUDGET })
    expect(stops[0].pct).toBe(0)
    expect(stops[stops.length - 1].pct).toBe(1)
    for (let i = 1; i < stops.length; i++) expect(stops[i].pct).toBeGreaterThanOrEqual(stops[i - 1].pct)
  })

  it('puts green at the notch and the thresholds where balanceZone puts them', () => {
    const { stops, notchPct } = barProgress({ intakeKcal: 0, budgetKcal: BUDGET })
    const green = stops.find(s => s.color === balanceZone(0).color)!
    expect(green.pct).toBeCloseTo(notchPct, 6)
    // The amber stop after the notch is exactly the on-target/over boundary, so the fill's leading
    // edge changes colour at the same intake where the LABEL changes. The two cannot disagree.
    const amberAfter = stops[stops.indexOf(green) + 1]
    expect(amberAfter.pct).toBeCloseTo((BUDGET + ON_TARGET_KCAL) / (BUDGET + OUTER_KCAL), 6)
  })

  it('survives a budget smaller than the outer threshold without inverting', () => {
    // `budget - OUTER_KCAL` goes negative here and several stops collapse onto 0; the clamp has to
    // leave them ordered or the gradient renders backwards.
    const { stops, fillPct, notchPct } = barProgress({ intakeKcal: 100, budgetKcal: 200 })
    for (let i = 1; i < stops.length; i++) expect(stops[i].pct).toBeGreaterThanOrEqual(stops[i - 1].pct)
    expect(fillPct).toBeGreaterThan(0)
    expect(notchPct).toBeGreaterThan(0)
  })

  it('never divides by zero on a zero budget', () => {
    const { fillPct, notchPct, stops } = barProgress({ intakeKcal: 0, budgetKcal: 0 })
    expect(Number.isFinite(fillPct)).toBe(true)
    expect(Number.isFinite(notchPct)).toBe(true)
    expect(stops.every(s => Number.isFinite(s.pct))).toBe(true)
  })
})

describe('targetFromMaintenance', () => {
  it('applies the goal offset to maintenance', () => {
    expect(targetFromMaintenance(2300, -500)).toBe(1800)
    expect(targetFromMaintenance(2300, 300)).toBe(2600)
  })

  it('never recommends below the 1200 kcal floor', () => {
    expect(targetFromMaintenance(1400, -500)).toBe(1200)
  })
})

describe('daily/weekly goal conversion', () => {
  it('converts a weekly goal down to the daily macro target', () => {
    // The bug this guards: mirroring a weekly 13,650 straight across made the macro ring
    // demand 13,650 kcal in one day.
    expect(goalToDailyKcal(13650, 'weekly')).toBe(1950)
  })

  it('passes a daily goal through untouched', () => {
    expect(goalToDailyKcal(1950, 'daily')).toBe(1950)
    expect(goalToDailyKcal(1950, null)).toBe(1950)
  })

  it('converts back into the user\'s chosen unit', () => {
    expect(dailyKcalToGoal(1950, 'weekly')).toBe(13650)
    expect(dailyKcalToGoal(1950, 'daily')).toBe(1950)
  })

  it('round-trips without drifting', () => {
    for (const type of ['daily', 'weekly'] as const) {
      for (const daily of [1200, 1750, 1950, 3000]) {
        expect(goalToDailyKcal(dailyKcalToGoal(daily, type), type)).toBe(daily)
      }
    }
  })
})
