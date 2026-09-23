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
    // `input: null` on a cold-baseline fallback is deliberate (Q-501): the z existed, but the score
    // was NOT computed from it, so recording it would make the row look re-derivable when it is not.
    // Q-278: the z EXISTED here (nHistory 3 is a cold baseline, not missing data), so the gap must
    // read `awaiting_baseline`. Reading `no_input` would be the collapse this field exists to undo.
    const cold = { score: 50, provisional: true, input: null, gap: 'awaiting_baseline' }
    expect(result.contributors.restingHeartRate).toEqual(cold)
    expect(result.contributors.hrvBalance).toEqual(cold)
    expect(result.contributors.temperature).toEqual(cold)
    expect(result.contributors.sleepBalance).toEqual(cold)
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
    expect(result.contributors.recoveryIndex).toEqual({ score: 50, provisional: true, input: null, gap: 'no_input' })
  })

  it('keeps sub-scores inside [0, 100], and z-driven ones approach the rail without landing on it', () => {
    const result = computeReadinessComposite({
      rhrZ: -10, hrvZ: 10, tempZ: 0, sleepBalanceZ: null,
      previousNightScore: 500, prevDayActivityScore: -500, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    // TN-60: a z-driven contributor no longer CLAMPS, it compresses. Even ±10σ stays a hair short
    // of the rail, which is the whole mechanism — a score sitting exactly on 100 is a score that
    // has stopped carrying information about how far past the edge the day was.
    for (const c of [result.contributors.restingHeartRate, result.contributors.hrvBalance]) {
      expect(c.score).toBeGreaterThan(95)
      expect(c.score).toBeLessThan(100)
    }
    // Plain (already-0-100) inputs are NOT z-driven and still hard-clamp — untouched by TN-60.
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

  // 2026-07-22 (W-D) moved the rail from ±2.5σ to ±1.5σ so a great day could reach a true 100.
  // TN-60 (2026-09-23) replaced the rail itself: ±1.5σ now scores 90, and the remaining 10 points
  // are spent giving the days BEYOND it their ordering back. That is the trade the owner chose —
  // 38% of hrvBalance days were sitting on a rail, with z from −1.63 to −4.37 all reading 0.
  // **The floor is the half TN-60 was actually filed about, so it gets its own case.** The entry's
  // measurement is of days scoring ZERO — hrvBalance z from −1.63 to −4.37, all rendered as 0. A
  // mutation run proved this was worth writing separately: deleting the lower tail outright, so the
  // floor hard-clips exactly as before, passed all 1004 tests in this package. Every case here
  // exercised the ceiling.
  it('scores 10 at −1.5σ and keeps FALLING beyond it, instead of railing at 0', () => {
    const at = (z: number) => computeReadinessComposite({
      rhrZ: null, hrvZ: z, tempZ: null, sleepBalanceZ: null,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    }).contributors.hrvBalance.score

    expect(at(-1.5)).toBe(10)

    // The seven worst days the entry measured. Under the old clip all seven read 0.
    const worst = [-1.63, -1.9, -2.2, -2.6, -3.1, -3.6, -4.37].map(at)

    // Non-increasing, not strictly decreasing. The 20-point band separates SIX of these seven —
    // that is the number the width was chosen on — so one adjacent pair ties after rounding, and
    // asserting a strict drop on every pair pins float noise rather than the design. A
    // mathematically identical rewrite of the tail moved which pair ties; the contract did not.
    for (let i = 1; i < worst.length; i++) {
      expect(worst[i], `a worse day scored HIGHER: ${worst.join(',')}`)
        .toBeLessThanOrEqual(worst[i - 1])
    }
    expect(new Set(worst).size, `expected 6 of 7 separated, got ${worst.join(',')}`)
      .toBeGreaterThanOrEqual(6)
    // The part that is absolute: nothing lands on the rail any more.
    expect(Math.min(...worst), `something still railed at 0: ${worst.join(',')}`).toBeGreaterThan(0)
  })

  it('scores 90 at +1.5σ and keeps rising beyond it, instead of railing', () => {
    const at = (z: number) => computeReadinessComposite({
      rhrZ: -z, hrvZ: z, tempZ: 0, sleepBalanceZ: z,
      previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null,
      nHistory: FULL_HISTORY,
    })
    const edge = at(1.5)
    expect(edge.contributors.restingHeartRate.score).toBe(90)
    expect(edge.contributors.hrvBalance.score).toBe(90)
    expect(edge.contributors.sleepBalance.score).toBe(90)

    // The point of the change: past the old rail, worse/better days remain distinguishable.
    const scores = [1.6, 2.0, 2.6, 3.4, 4.4].map(z => at(z).contributors.hrvBalance.score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i], `z grew but the score did not: ${scores.join(',')}`)
        .toBeGreaterThan(scores[i - 1])
    }
    // Under the old hard clip every one of these was exactly 100.
    expect(new Set(scores).size).toBe(scores.length)
  })

  // **TN-60 makes 100 unreachable, and that is the cost of the change rather than a bug.** A
  // saturating curve and a reachable ceiling are mutually exclusive: the ceiling IS the rail. A
  // 1.5σ-on-everything day now reads ~95 rather than 100, because the z-driven contributors carry
  // 0.59 of the weight and each tops out at 90 there. Milder than the ~86 the 2026-07-22 note
  // called a defect, and reversible with one constant (TAIL_BAND_POINTS).
  it('puts a genuinely perfect day just under the ceiling rather than on it', () => {
    const r = computeReadinessComposite({
      rhrZ: -1.5, hrvZ: 1.5, tempZ: 0, sleepBalanceZ: 1.5,
      previousNightScore: 100, prevDayActivityScore: 100, activityBalanceScore: 100,
      recoveryIndexHours: 6, checkinScore: 100,
      nHistory: FULL_HISTORY,
    })
    expect(r.score).toBe(95)
  })

  it('still rewards a day better than 1.5σ on every axis — the ceiling is approached, not hit', () => {
    const at = (z: number) => computeReadinessComposite({
      rhrZ: -z, hrvZ: z, tempZ: 0, sleepBalanceZ: z,
      previousNightScore: 100, prevDayActivityScore: 100, activityBalanceScore: 100,
      recoveryIndexHours: 6, checkinScore: 100,
      nHistory: FULL_HISTORY,
    }).score
    expect(at(3)).toBeGreaterThan(at(1.5))
    expect(at(3)).toBeLessThan(100)
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
    // No check-in → neutral 50 → a perfect-biometrics day tops out at 90 (check-in unlocks the last
    // 5, same relationship as before TN-60 — both ends simply moved down with the tail).
    const r = computeReadinessComposite({
      rhrZ: -1.5, hrvZ: 1.5, tempZ: 0, sleepBalanceZ: 1.5,
      previousNightScore: 100, prevDayActivityScore: 100, activityBalanceScore: 100,
      recoveryIndexHours: 6,
      nHistory: FULL_HISTORY,
    })
    expect(r.score).toBeGreaterThanOrEqual(89)
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
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 5 }).contributors.recoveryIndex).toEqual({ score: 100, provisional: true, input: 5, gap: null })
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 2.5 }).contributors.recoveryIndex).toEqual({ score: 50, provisional: true, input: 2.5, gap: null })
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 0 }).contributors.recoveryIndex).toEqual({ score: 0, provisional: true, input: 0, gap: null })
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: 9 }).contributors.recoveryIndex.score).toBe(100) // clamped
    })
    it('is neutral (never fabricated) when there is no overnight HR series', () => {
      expect(computeReadinessComposite({ ...base, recoveryIndexHours: null }).contributors.recoveryIndex).toEqual({ score: 50, provisional: true, input: null, gap: 'no_input' })
      expect(computeReadinessComposite(base).contributors.recoveryIndex).toEqual({ score: 50, provisional: true, input: null, gap: 'no_input' }) // omitted
    })
    it('a good recovery index lifts the composite above the former frozen 50', () => {
      // recovery-index is 10% of the weight; 6h → 100 lifts an otherwise-neutral composite by ~5 pts.
      const good = computeReadinessComposite({ ...base, recoveryIndexHours: 6 })
      expect(good.score).toBeGreaterThan(50)
    })
  })
})
