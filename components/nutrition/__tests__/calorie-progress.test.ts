import { describe, it, expect } from 'vitest'
import {
  progressBands, progressFill, trackEndKcal, OVERSHOOT_TAIL_KCAL,
} from '../calorie-progress'
import {
  ON_TARGET_KCAL, OUTER_KCAL, balanceZone, budgetProvenance,
} from '@trainingai/shared/nutrition/calorie-balance'

const BUDGET = 2_180 // the owner's screenshot: 1,629 base + 551 earned

describe('progressBands (Q-323)', () => {
  it('covers the whole track exactly once', () => {
    for (const budget of [1_200, 2_180, 4_000]) {
      const total = progressBands(budget).reduce((a, b) => a + b.widthPct, 0)
      expect(total, `budget ${budget}`).toBeCloseTo(100, 6)
    }
  })

  it('runs red → amber → green → amber → red, so the walk ends in the green', () => {
    const bands = progressBands(BUDGET)
    expect(bands.map(b => b.zone)).toEqual(['far_under', 'under', 'on_target', 'over', 'far_over'])
    // The colours come from `balanceZone`, not a second palette — a drifting copy of these five is
    // the class of defect this whole entry is about.
    expect(bands[2].color).toBe(balanceZone(0).color)
    expect(bands[0].color).toBe(bands[4].color)
    expect(bands[1].color).toBe(bands[3].color)
  })

  it('the goal notch sits far enough along that the tail cannot read as the target', () => {
    // The owner asked for "a little orange/red bar after". On a real budget the walk is ~77% of the
    // track and everything past the notch is 23% of it, ending in red.
    const { goalPct } = progressFill(0, BUDGET)
    expect(goalPct).toBeGreaterThan(70)
    expect(goalPct).toBeLessThan(85)
  })

  it('the over-side bands mirror the under-side ones in kcal', () => {
    // Not a tuned tail: the same two thresholds reflected about the goal. Only the under-side red
    // is longer, because a day can be arbitrarily under and its band runs back to zero eaten.
    const end = trackEndKcal(BUDGET)
    const [, under, , over, farOver] = progressBands(BUDGET)
    expect(under.widthPct).toBeCloseTo(over.widthPct, 6)
    expect(farOver.widthPct).toBeCloseTo(over.widthPct, 6)
    expect(OVERSHOOT_TAIL_KCAL).toBe(OUTER_KCAL + (OUTER_KCAL - ON_TARGET_KCAL))
    expect(end).toBe(BUDGET + OVERSHOOT_TAIL_KCAL)
  })

  it('never emits a negative width when the budget is smaller than the bands', () => {
    // A 200 kcal budget cannot have 400 kcal of under-shoot below it; those bands collapse to zero
    // rather than wrapping negative and dragging the rest of the track left.
    for (const band of progressBands(200)) expect(band.widthPct).toBeGreaterThanOrEqual(0)
    expect(progressBands(200).reduce((a, b) => a + b.widthPct, 0)).toBeCloseTo(100, 6)
  })
})

describe('progressFill (Q-323)', () => {
  it('is empty at nothing eaten and reaches the notch exactly at the goal', () => {
    const empty = progressFill(-BUDGET, BUDGET)
    expect(empty.fillPct).toBe(0)
    const onGoal = progressFill(0, BUDGET)
    expect(onGoal.fillPct).toBeCloseTo(onGoal.goalPct, 6)
  })

  /**
   * The property that makes this bar safe to draw on two screens at once. `deviation` is exactly
   * `intake − budget` — expand `budgetProvenance` and `computeCalorieBalance` and the terms cancel —
   * so the bar reads the number the route already published instead of re-deriving one. Q-415 and
   * Q-417 are both a surface that re-derived, and both put two budgets on one screen.
   */
  it('the deviation the route publishes IS intake minus the provenance budget', () => {
    const restingBaseKcal = 1_800, activeKcal = 551, targetNetKcal = -171, intakeKcal = 2_014
    const expenditureKcal = restingBaseKcal + activeKcal
    const deviationKcal = (intakeKcal - expenditureKcal) - targetNetKcal
    const { total } = budgetProvenance({ restingBaseKcal, activeKcal, targetNetKcal })
    expect(deviationKcal).toBe(intakeKcal - total)

    const fill = progressFill(deviationKcal, total)
    expect(fill.fillPct).toBeCloseTo((intakeKcal / trackEndKcal(total)) * 100, 6)
  })

  it('takes the colour and the words of the band the fill ends in', () => {
    for (const dev of [-900, -300, 0, 300, 900]) {
      const fill = progressFill(dev, BUDGET)
      const zone = balanceZone(dev)
      expect(fill.zone, `dev ${dev}`).toBe(zone.zone)
      expect(fill.color).toBe(zone.color)
      expect(fill.label).toBe(zone.label)
    }
  })

  it('clamps a runaway day at the end of the track instead of overflowing it', () => {
    const fill = progressFill(5_000, BUDGET)
    expect(fill.fillPct).toBe(100)
    expect(fill.zone).toBe('far_over')
    expect(fill.remainingKcal).toBe(-5_000) // the words still carry the real figure
  })

  it('reports what is left to eat, and normalises -0 away at the goal', () => {
    expect(progressFill(-400, BUDGET).remainingKcal).toBe(400)
    expect(Object.is(progressFill(0, BUDGET).remainingKcal, -0)).toBe(false)
  })
})
