import { describe, it, expect } from 'vitest'
import {
  balanceZone, computeCalorieBalance, barPosition, barBands,
  targetFromMaintenance, goalToDailyKcal, dailyKcalToGoal,
  ON_TARGET_KCAL, OUTER_KCAL, BAR_SCALE_KCAL,
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

describe('barPosition / barBands', () => {
  it('puts a perfectly on-target day at the centre', () => {
    expect(barPosition(0)).toBeCloseTo(0.5, 6)
  })

  it('clamps beyond the scale instead of overflowing the bar', () => {
    expect(barPosition(BAR_SCALE_KCAL * 10)).toBe(1)
    expect(barPosition(-BAR_SCALE_KCAL * 10)).toBe(0)
    expect(barPosition(99999)).toBeLessThanOrEqual(1)
  })

  it('is monotonic in deviation', () => {
    const xs = [-800, -400, -150, 0, 150, 400, 800].map(barPosition)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1])
  })

  it('emits five bands that exactly fill the bar', () => {
    const bands = barBands()
    expect(bands.map(b => b.zone)).toEqual(['far_under', 'under', 'on_target', 'over', 'far_over'])
    expect(bands.reduce((s, b) => s + b.widthPct, 0)).toBeCloseTo(100, 6)
  })

  it('lines the green band up with where barPosition puts an on-target day', () => {
    const bands = barBands()
    const leftEdge = bands[0].widthPct + bands[1].widthPct
    const rightEdge = leftEdge + bands[2].widthPct
    expect(barPosition(-ON_TARGET_KCAL) * 100).toBeCloseTo(leftEdge, 6)
    expect(barPosition(ON_TARGET_KCAL) * 100).toBeCloseTo(rightEdge, 6)
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
