import { describe, it, expect } from 'vitest'
import { computeReadinessComposite, BASELINE_MIN_NIGHTS } from '../readiness-composite'

const FULL_HISTORY = BASELINE_MIN_NIGHTS + 1

describe('computeReadinessComposite', () => {
  it('falls back to neutral for every baseline-relative contributor when history is cold', () => {
    const result = computeReadinessComposite({
      rhrZ: -2, hrvZ: 2, tempZ: 0, sleepBalanceZ: 1,
      previousNightScore: 80, prevDayActivityScore: 70, activityBalanceScore: 60,
      nHistory: 3,
    })
    expect(result.contributors.restingHeartRate).toEqual({ score: 50, provisional: true })
    expect(result.contributors.hrvBalance).toEqual({ score: 50, provisional: true })
    expect(result.contributors.temperature).toEqual({ score: 50, provisional: true })
    expect(result.contributors.sleepBalance).toEqual({ score: 50, provisional: true })
    // Non-baseline contributors are unaffected by cold history.
    expect(result.contributors.previousNight.provisional).toBe(false)
  })

  it('scores a lower resting HR than baseline as better (positive)', () => {
    const result = computeReadinessComposite({
      rhrZ: -1, hrvZ: null, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    expect(result.contributors.restingHeartRate.score).toBeGreaterThan(50)
    expect(result.contributors.restingHeartRate.provisional).toBe(false)
  })

  it('scores higher HRV than baseline as better (positive)', () => {
    const result = computeReadinessComposite({
      rhrZ: null, hrvZ: 1, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    expect(result.contributors.hrvBalance.score).toBeGreaterThan(50)
  })

  it('penalizes temperature deviation in either direction', () => {
    const hot = computeReadinessComposite({
      rhrZ: null, hrvZ: null, tempZ: 1.5, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    const cold = computeReadinessComposite({
      rhrZ: null, hrvZ: null, tempZ: -1.5, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    expect(hot.contributors.temperature.score).toBeLessThan(50)
    expect(cold.contributors.temperature.score).toBeLessThan(50)
  })

  it('recovery index is always neutral/provisional — no calibratable mapping', () => {
    const result = computeReadinessComposite({
      rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    expect(result.contributors.recoveryIndex).toEqual({ score: 50, provisional: true })
  })

  it('clamps sub-scores to [0, 100]', () => {
    const result = computeReadinessComposite({
      rhrZ: -10, hrvZ: 10, tempZ: 0, sleepBalanceZ: null,
      previousNightScore: 500, prevDayActivityScore: -500, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    expect(result.contributors.restingHeartRate.score).toBe(100)
    expect(result.contributors.hrvBalance.score).toBe(100)
    expect(result.contributors.previousNight.score).toBe(100)
    expect(result.contributors.prevDayActivity.score).toBe(0)
  })

  it('an all-neutral input composites to exactly 50', () => {
    const result = computeReadinessComposite({
      rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: 0,
    })
    expect(result.score).toBe(50)
  })

  // Recalibration (2026-07-22, W-D): baseline terms now reach a full 100 at +1.5σ (was +2.5σ), and
  // the weights sum to exactly 1.00, so a genuinely great day + a good check-in can reach a true 100.
  it('reaches a full 100 sub-score at +1.5σ (softened z-scaling)', () => {
    const r = computeReadinessComposite({
      rhrZ: -1.5, hrvZ: 1.5, tempZ: 0, sleepBalanceZ: 1.5,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    expect(r.contributors.restingHeartRate.score).toBe(100)
    expect(r.contributors.hrvBalance.score).toBe(100)
    expect(r.contributors.sleepBalance.score).toBe(100)
  })

  it('lets a genuinely perfect day with a good check-in reach 100', () => {
    const r = computeReadinessComposite({
      rhrZ: -1.5, hrvZ: 1.5, tempZ: 0, sleepBalanceZ: 1.5,
      previousNightScore: 100, prevDayActivityScore: 100, activityBalanceScore: 100,
      recoveryIndexHours: 6, checkinScore: 100,
      nHistory: FULL_HISTORY,
    })
    expect(r.score).toBe(100)
  })

  it('maps the check-in as a contributor; a good one lifts the composite over a drained one', () => {
    const base = {
      rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: 0,
    }
    const good = computeReadinessComposite({ ...base, checkinScore: 100 })
    const drained = computeReadinessComposite({ ...base, checkinScore: 30 })
    expect(good.contributors.checkin.score).toBe(100)
    expect(good.score).toBeGreaterThan(drained.score)
  })

  it('caps below 100 without a check-in but never tanks readiness for skipping it', () => {
    // No check-in → neutral 50 → a perfect-biometrics day tops out ~95 (check-in unlocks the last 5).
    const r = computeReadinessComposite({
      rhrZ: -1.5, hrvZ: 1.5, tempZ: 0, sleepBalanceZ: 1.5,
      previousNightScore: 100, prevDayActivityScore: 100, activityBalanceScore: 100,
      recoveryIndexHours: 6,
      nHistory: FULL_HISTORY,
    })
    expect(r.score).toBeGreaterThanOrEqual(94)
    expect(r.score).toBeLessThan(100)
  })

  describe('recovery-index contributor (calibrated curve, was dead NEUTRAL)', () => {
    const base = {
      rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: 0,
    }
    // Anchor moved 6 h → 5 h on 2026-08-18 (Q-500), fitted against Oura's own recovery_index
    // contributor over the 15 pre-re-key nights where both exist. The property under test is
    // unchanged — linear, a true 100 at the optimum, 0 at 0 h, clamped above — so only the
    // anchor-dependent literals move: the midpoint is now 2.5 h rather than 3 h.
    it('maps hours → 0-100 linearly, 100 at the ≥5h optimal, provisional', () => {
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 5 }).contributors.recoveryIndex).toEqual({ score: 100, provisional: true })
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 2.5 }).contributors.recoveryIndex).toEqual({ score: 50, provisional: true })
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 0 }).contributors.recoveryIndex).toEqual({ score: 0, provisional: true })
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 9 }).contributors.recoveryIndex.score).toBe(100) // clamped
    })
    it('is neutral (never fabricated) when there is no overnight HR series', () => {
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: null }).contributors.recoveryIndex).toEqual({ score: 50, provisional: true })
      expect(computeReadinessComposite(base).contributors.recoveryIndex).toEqual({ score: 50, provisional: true }) // omitted
    })
    it('a good recovery index lifts the composite above the former frozen 50', () => {
      // recovery-index is 10% of the weight; 6h → 100 lifts an otherwise-neutral composite by ~5 pts.
      const good = computeReadinessComposite({ ...base, recoveryIndexHours: 6 })
      expect(good.score).toBeGreaterThan(50)
    })
  })
})
