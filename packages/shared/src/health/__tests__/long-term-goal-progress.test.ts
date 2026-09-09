import { describe, it, expect } from 'vitest'
import { goalProgressPct, computeWeightRateKgPerWeek, computeWeightRateFit, evaluateWeightRateVsGoalBand } from '../long-term-goal-progress'

describe('goalProgressPct', () => {
  it('returns 100 when starting equals target (already at goal)', () => {
    expect(goalProgressPct(80, 82, 80)).toBe(100)
  })

  it('computes progress toward a decreasing target (losing weight)', () => {
    // starting 82, target 78 (lose 4kg), currently at 80 (lost 2kg) -> 50%
    expect(goalProgressPct(82, 80, 78)).toBeCloseTo(50, 5)
  })

  it('computes progress toward an increasing target (gaining weight)', () => {
    // starting 78, target 82 (gain 4kg), currently at 80 (gained 2kg) -> 50%
    expect(goalProgressPct(78, 80, 82)).toBeCloseTo(50, 5)
  })

  it('clamps to 0 when movement is away from a decreasing target', () => {
    // starting 81.85, target 78, currently 82.5 (went up, away from goal)
    expect(goalProgressPct(81.85, 82.5, 78)).toBe(0)
  })

  it('clamps to 0 when movement is away from an increasing target', () => {
    // starting 18, target 22 (gain), currently 17 (went down, away from goal)
    expect(goalProgressPct(18, 17, 22)).toBe(0)
  })

  it('clamps to 100 when current has overshot the target', () => {
    // starting 82, target 78, currently 75 (already past target)
    expect(goalProgressPct(82, 75, 78)).toBe(100)
  })
})

/** Consecutive days from 2026-03-01, one weigh-in each — the every-day case. */
const daily = (weights: number[]) =>
  weights.map((weightKg, i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, weightKg }))

describe('computeWeightRateKgPerWeek', () => {
  it('computes a steady loss rate as kg/week', () => {
    // -0.1kg/day trend -> -0.7 kg/week
    expect(computeWeightRateKgPerWeek(daily([82, 81.9, 81.8, 81.7, 81.6, 81.5, 81.4]))).toBeCloseTo(-0.7, 5)
  })

  it('computes a steady gain rate as kg/week', () => {
    expect(computeWeightRateKgPerWeek(daily([78, 78.1, 78.2, 78.3, 78.4]))).toBeCloseTo(0.7, 5)
  })

  it('returns null for fewer than 3 readings', () => {
    expect(computeWeightRateKgPerWeek([])).toBeNull()
    expect(computeWeightRateKgPerWeek(daily([80]))).toBeNull()
    expect(computeWeightRateKgPerWeek(daily([80, 79.5]))).toBeNull()
  })

  it('returns 0 for a perfectly flat series', () => {
    expect(computeWeightRateKgPerWeek(daily([80, 80, 80, 80]))).toBe(0)
  })

  it('rounds the DISPLAY figure to one decimal', () => {
    // −0.07 kg/day is −0.49 kg/wk, which is not already a 1-dp value — every other case here has a
    // truth of exactly −0.7, where rounded and unrounded agree and the rounding goes untested.
    expect(computeWeightRateKgPerWeek(daily([82, 81.93, 81.86, 81.79, 81.72]))).toBe(-0.5)
  })

  // ── LB-67 ────────────────────────────────────────────────────────────────────────────────────
  //
  // The defect and its consequence. A row exists only on a day carrying a metric, so the series is
  // gappy; fitting the array index reported a slope per READING as though it were per day.

  it('reads a gappy series at the SAME rate as a complete one', () => {
    // The same −0.1 kg/day truth, sampled on 10 of 14 days. This is the whole bug: before the fix
    // this returned −1.0 (the entry measured −1.04 on the owner's own spacing), because ten
    // readings spanning 14 days were treated as ten consecutive days.
    const gappy = [
      { date: '2026-03-01', weightKg: 82.0 },
      { date: '2026-03-02', weightKg: 81.9 },
      { date: '2026-03-04', weightKg: 81.7 },
      { date: '2026-03-05', weightKg: 81.6 },
      { date: '2026-03-07', weightKg: 81.4 },
      { date: '2026-03-08', weightKg: 81.3 },
      { date: '2026-03-11', weightKg: 81.0 },
      { date: '2026-03-12', weightKg: 80.9 },
      { date: '2026-03-13', weightKg: 80.8 },
      { date: '2026-03-14', weightKg: 80.7 },
    ]
    expect(computeWeightRateKgPerWeek(gappy)).toBeCloseTo(-0.7, 5)
    // And the fixture is a real discriminator: 10 readings over 14 days, so per-reading and per-day
    // cannot agree. A gappy fixture whose gaps happened to cancel would test nothing.
    expect(computeWeightRateFit(gappy)!.weighIns).toBe(10)
    expect(computeWeightRateFit(gappy)!.spanDays).toBe(13)
  })

  it('keeps an ordinary rate inside the healthy band, which is what the screen showed wrong', () => {
    // Not a restatement of the case above: this asserts the USER-VISIBLE consequence. −0.7 kg/wk is
    // an ordinary healthy pace, and the per-reading slope pushed it past the 1.0 kg/wk ceiling so
    // Health → Body rendered "Faster than ideal pace" in amber.
    const gappy = [
      { date: '2026-03-01', weightKg: 82.0 },
      { date: '2026-03-03', weightKg: 81.8 },
      { date: '2026-03-06', weightKg: 81.5 },
      { date: '2026-03-08', weightKg: 81.3 },
      { date: '2026-03-11', weightKg: 81.0 },
      { date: '2026-03-14', weightKg: 80.7 },
    ]
    const rate = computeWeightRateKgPerWeek(gappy)
    expect(rate).toBeCloseTo(-0.7, 5)
    expect(evaluateWeightRateVsGoalBand(80.7, 75, rate).status).toBe('on_track')
  })

  it('sorts and drops null weights itself, so no caller has to', () => {
    // Both call sites used to do this by hand, differently — one sorted ascending, the other
    // reversed a descending list. A row with no weight is a real shape: `body_metrics` rows exist
    // for any metric, so a steps-only day arrives with `weightKg` null.
    const scrambled = [
      { date: '2026-03-08', weightKg: 81.3 },
      { date: '2026-03-01', weightKg: 82.0 },
      { date: '2026-03-05', weightKg: null },
      { date: '2026-03-14', weightKg: 80.7 },
      { date: '2026-03-03', weightKg: undefined },
    ]
    expect(computeWeightRateKgPerWeek(scrambled)).toBeCloseTo(-0.7, 5)
    // **`spanDays` is what the sort is actually load-bearing for, and the rate is not.** A least-
    // squares slope is order-invariant, so asserting only the rate leaves the sort untested — a
    // mutant deleting it survived exactly that. Unsorted, the span is measured from whichever row
    // happened to be first.
    expect(computeWeightRateFit(scrambled)!.spanDays).toBe(13)
  })
})

describe('computeWeightRateFit', () => {
  it('reports an unrounded slope, because callers do kcal arithmetic on it', () => {
    // At 7,700 kcal/kg, rounding the weekly figure to 2 dp before the multiply moves a maintenance
    // estimate by tens of kcal/day — so the fit hands back kg/day untouched and each caller rounds
    // for its own display.
    const fit = computeWeightRateFit(daily([82, 81.93, 81.86, 81.79, 81.72]))!
    expect(fit.slopeKgPerDay).toBeCloseTo(-0.07, 10)
    expect(fit.rateKgPerWeek).toBeCloseTo(-0.49, 10)
  })

  it('gives a standard error that widens with scatter', () => {
    // The point estimate is identical in both; only the spread differs. Asserting a number here
    // would pin arithmetic — what matters is that noise is reported as less certain.
    const clean = computeWeightRateFit(daily([82, 81.9, 81.8, 81.7, 81.6, 81.5, 81.4]))!
    const noisy = computeWeightRateFit(daily([82, 82.1, 81.6, 81.9, 81.4, 81.6, 81.4]))!
    expect(clean.stdErrKgPerWeek).toBeLessThan(0.01)
    expect(noisy.stdErrKgPerWeek!).toBeGreaterThan(clean.stdErrKgPerWeek!)
    // And the UNITS, pinned to a computed value: an ordering assertion holds whether or not the
    // per-day error was scaled to per-week, so dropping the ×7 survived it. 0.2419 kg/wk beside a
    // −0.49 kg/wk estimate is the honest reading — this owner's scatter swamps the trend.
    expect(noisy.stdErrKgPerWeek!).toBeCloseTo(0.241868, 5)
  })

  it('has no standard error at two readings, where a line fits exactly', () => {
    // Two points have zero residual degrees of freedom. Reporting 0 would read as perfect
    // certainty, which is the opposite of what two readings mean.
    const fit = computeWeightRateFit(daily([82, 81.9]))!
    expect(fit.weighIns).toBe(2)
    expect(fit.stdErrKgPerWeek).toBeNull()
  })

  it('returns null when every reading falls on one day', () => {
    // No spread in x, so there is no slope to report — null rather than 0, which would claim a
    // measured flat trend.
    expect(computeWeightRateFit([
      { date: '2026-03-01', weightKg: 82.0 },
      { date: '2026-03-01', weightKg: 81.8 },
      { date: '2026-03-01', weightKg: 82.1 },
    ])).toBeNull()
  })

  it('returns null for an unparseable date rather than fitting NaN', () => {
    expect(computeWeightRateFit([
      { date: 'not-a-date', weightKg: 82.0 },
      { date: '2026-03-02', weightKg: 81.9 },
      { date: '2026-03-03', weightKg: 81.8 },
    ])).toBeNull()
  })
})

describe('evaluateWeightRateVsGoalBand', () => {
  it('reports at_goal when current weight already equals target', () => {
    expect(evaluateWeightRateVsGoalBand(78, 78, -0.5)).toEqual({ rateKgPerWeek: -0.5, status: 'at_goal' })
  })

  it('reports on_track when losing weight toward a lower target within the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, -0.6)
    expect(r.status).toBe('on_track')
  })

  it('reports too_slow when the loss rate is below the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, -0.1)
    expect(r.status).toBe('too_slow')
  })

  it('reports too_fast when the loss rate exceeds the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, -1.5)
    expect(r.status).toBe('too_fast')
  })

  it('reports wrong_direction when gaining while the goal is to lose', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, 0.3)
    expect(r.status).toBe('wrong_direction')
  })

  it('reports on_track for a gain goal moving upward within the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(78, 82, 0.5)
    expect(r.status).toBe('on_track')
  })

  it('returns a null status when there is no rate data yet', () => {
    expect(evaluateWeightRateVsGoalBand(82, 78, null)).toEqual({ rateKgPerWeek: null, status: null })
  })
})
