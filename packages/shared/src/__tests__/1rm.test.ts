import { describe, it, expect } from 'vitest'
import { calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM, oneRmTrendStatus, BW_REF, repMaxFromOneRm, repMaxFromAmrapOneRm, rescaleBodyweightReps, resolveBodyweightStyle, estimateOneRm, repFactor, REP_CEILING, bestSetOneRm, mround, displayOneRm, displayOneRmDelta, displayOneRmSeries, oneRmLabel, oneRmUnit, describePersonalRecord, pickHeadlinePersonalRecord } from '../1rm'

describe('calcAmrap1RM', () => {
  it('matches calc1RM for ≤5 reps (scale factor 1.0)', () => {
    expect(calcAmrap1RM(100, 5)).toBe(calc1RM(100, 5))
  })

  it('applies 0.97 factor at 8 reps', () => {
    const expected = Math.round(calc1RM(100, 8) * 0.97 * 4) / 4
    expect(calcAmrap1RM(100, 8)).toBe(expected)
  })

  it('applies 0.93 factor at 12 reps', () => {
    const expected = Math.round(calc1RM(100, 12) * 0.93 * 4) / 4
    expect(calcAmrap1RM(100, 12)).toBe(expected)
  })

  // Issue 2193 (a): between anchors the factor is interpolated, and the product is rounded once.
  it('interpolates between 0.93 (12) and 0.88 (20) at 15 reps', () => {
    const expected = Math.round(100 * repFactor(15) * (0.93 - 0.05 * 3 / 8) * 4) / 4
    expect(calcAmrap1RM(100, 15)).toBe(expected)
  })

  it('interpolates between 0.88 (20) and 0.82 (30) at 25 reps', () => {
    const expected = Math.round(100 * repFactor(25) * 0.85 * 4) / 4
    expect(calcAmrap1RM(100, 25)).toBe(expected)
  })

  it('returns weight unchanged for 0 reps', () => {
    expect(calcAmrap1RM(100, 0)).toBe(100)
  })

  it('returns weight unchanged for 0 weight', () => {
    expect(calcAmrap1RM(0, 10)).toBe(0)
  })

  it('always produces a lower estimate than calc1RM for reps > 5', () => {
    expect(calcAmrap1RM(80, 15)).toBeLessThan(calc1RM(80, 15))
  })
})

describe('calculate1RM', () => {
  // General style: 3 sets, 60% / 12 reps, useFor1rm=false on every set
  const generalStyle = [
    { pct: 60, reps: 12, useFor1rm: false },
    { pct: 60, reps: 12, useFor1rm: false },
    { pct: 60, reps: 12, useFor1rm: false },
  ]

  it('hitting the prescription exactly reproduces the weight used as the 1RM (within rounding)', () => {
    // 20kg x 12 prescribed at 60%/12reps -> 1RM should land back near 20 / 0.6 = 33.3
    const { estimated1rm } = calculate1RM([20, 20, 20], [12, 12, 12], generalStyle)
    expect(estimated1rm).toBeCloseTo(20 / 0.6, 0)
  })

  it('exceeding the prescription increases the estimate vs hitting it exactly', () => {
    const exact = calculate1RM([20, 20, 20], [12, 12, 12], generalStyle)
    const exceeded = calculate1RM([20, 20, 20], [14, 14, 14], generalStyle)
    expect(exceeded.estimated1rm).toBeGreaterThan(exact.estimated1rm)
  })

  it('falling short of the prescription decreases the estimate vs hitting it exactly', () => {
    const exact = calculate1RM([20, 20, 20], [12, 12, 12], generalStyle)
    const short = calculate1RM([20, 20, 20], [10, 10, 10], generalStyle)
    expect(short.estimated1rm).toBeLessThan(exact.estimated1rm)
  })

  // Issue 2357 (owner-signed 2026-10-06) reverses Q-304: a styleless working set is a chosen
  // working set, not an all-out one, so it takes the plain rep-factor estimate with no discount.
  it('uses the plain rep-factor estimate when no style is provided (issue 2357)', () => {
    const { estimated1rm } = calculate1RM([100, 100, 100], [12, 12, 12])
    expect(estimated1rm).toBe(calc1RM(100, 12))
    expect(estimated1rm).toBeGreaterThan(calcAmrap1RM(100, 12))
  })

  it('applies no AMRAP discount at any rep count with no prescription (issue 2357)', () => {
    for (const reps of [6, 13, 20, 21]) {
      expect(calculate1RM([100], [reps]).estimated1rm).toBe(calc1RM(100, reps))
    }
  })

  it('a set past the style length is a styleless slot too: undiscounted', () => {
    const style = [{ pct: 60, reps: 12 }]
    const twoSets = calculate1RM([20, 50], [12, 8], style).estimated1rm
    const first = calculate1RM([20], [12], style).estimated1rm
    expect(twoSets).toBe(Math.round(((first + calc1RM(50, 8)) / 2) * 4) / 4)
  })

  it('does NOT apply the AMRAP correction on top of a real prescription (no double-correction)', () => {
    // A prescribed 60%/12reps set at 13 reps (exceeding the prescription) must be rescaled by
    // prescriptionFactor alone — combining it with amrapScaleFactor would deflate the estimate,
    // the mirror of the bug this fix closes.
    const prescribed = calculate1RM([20], [13], [{ pct: 60, reps: 12, useFor1rm: true }]).estimated1rm
    const unprescribed = calculate1RM([20], [13]).estimated1rm
    expect(prescribed).not.toBe(unprescribed)
  })

  it('only scores useFor1rm sets when the style flags them', () => {
    const peakStyle = [
      { pct: 90, reps: 3, useFor1rm: true },
      { pct: 60, reps: 12, useFor1rm: false },
    ]
    const { estimated1rm } = calculate1RM([90, 50], [3, 12], peakStyle)
    const expected = calculate1RM([90, 50], [3, 12], [peakStyle[0]]).estimated1rm
    expect(estimated1rm).toBe(expected)
  })

  // Issue 2193 (c): above the ceiling a set counts at 30 reps, on this path as on every other.
  it('counts a set above 30 reps at 30', () => {
    const { estimated1rm } = calculate1RM([20, 20], [12, 35], generalStyle)
    expect(estimated1rm).toBe(calculate1RM([20, 20], [12, 30], generalStyle).estimated1rm)
    expect(estimated1rm).toBeGreaterThan(calculate1RM([20], [12], generalStyle).estimated1rm)
  })

  it('target80 is 80% of the estimated 1RM, rounded to the nearest 0.25', () => {
    const { estimated1rm, target80 } = calculate1RM([20, 20, 20], [12, 12, 12], generalStyle)
    expect(target80).toBe(Math.round(estimated1rm * 0.8 * 4) / 4)
  })
})

describe('runningEstimate1RM', () => {
  it('equals calc1RM for a single logged set', () => {
    expect(runningEstimate1RM([100], [5])).toBe(calc1RM(100, 5))
  })

  it('averages uniform sets to the same value as one set', () => {
    expect(runningEstimate1RM([100, 100], [5, 5])).toBe(calc1RM(100, 5))
  })

  it('averages per-set 1RMs, not the averaged inputs (mixed reps)', () => {
    const perSet = calculate1RM([100, 100], [5, 12]).estimated1rm
    expect(runningEstimate1RM([100, 100], [5, 12])).toBe(perSet)
    // averaged-inputs calc from (avgWeight, avgReps) would differ
    expect(runningEstimate1RM([100, 100], [5, 12])).not.toBe(calc1RM(100, 8.5))
  })

  it('falls back to all logged sets when the useFor1rm subset yields nothing', () => {
    // Set 0 has no load, so it cannot score. (It used to be a 35-rep set, which scored nothing
    // before issue 2193 (c) counted it at 30.)
    const weights = [0, 100]
    const reps = [5, 6]
    const style = [
      { pct: 100, reps: 5, useFor1rm: true },
      { pct: 100, reps: 5, useFor1rm: false },
    ]
    // Only the flagged set counts, but it cannot score → primary is 0
    expect(calculate1RM(weights, reps, style).estimated1rm).toBe(0)
    // Fallback re-runs ignoring useFor1rm → set 1 counts
    const flat = calculate1RM(weights, reps, [
      { pct: 100, reps: 5 },
      { pct: 100, reps: 5 },
    ]).estimated1rm
    expect(flat).toBeGreaterThan(0)
    expect(runningEstimate1RM(weights, reps, style)).toBe(flat)
  })

  it('returns 0 for no logged sets', () => {
    expect(runningEstimate1RM([], [])).toBe(0)
  })
})

describe('oneRmTrendStatus', () => {
  it('is "none" when there is no previous 1RM', () => {
    expect(oneRmTrendStatus(76.25, null)).toBe('none')
    expect(oneRmTrendStatus(76.25, 0)).toBe('none')
  })

  it('is "up" when projected is clearly above previous', () => {
    expect(oneRmTrendStatus(76.25, 66.75)).toBe('up')
  })

  it('is "down" when projected is clearly below previous', () => {
    expect(oneRmTrendStatus(64.0, 66.75)).toBe('down')
  })

  it('is "even" within ±0.5 kg', () => {
    expect(oneRmTrendStatus(66.75, 66.5)).toBe('even')
    expect(oneRmTrendStatus(66.25, 66.75)).toBe('even')
  })
})

describe('repMaxFromAmrapOneRm (BF-149)', () => {
  // The owner's own numbers: 11 logged reps stored 128 and the summary card read 8 RM, because
  // the inverse used `calc1RM` while `estimateOneRm` writes `amrapAverage1Rm` values.
  it('recovers the reps a stored bodyweight estimate came from', () => {
    // 128 under the stepped discount; 129.25 since issue 2193 (a) smoothed it (0.9425 at 11 reps).
    const stored = estimateOneRm([{ weightKg: 0, reps: 11 }], { exerciseType: 'bodyweight' }).estimated1rm
    expect(stored).toBe(129.25)
    expect(repMaxFromAmrapOneRm(stored)).toBe(11)
    // What the unscaled inverse reports, kept so the regression is legible rather than just "not 11".
    expect(repMaxFromOneRm(stored)).toBeLessThan(11)
  })

  // The stepped discount dipped across each boundary and a "largest r that does not exceed" search
  // overshot — 20 reps used to read back as 28. The anchors are still worth checking.
  it('does not overshoot at the discount anchors', () => {
    for (const reps of [5, 8, 12, 19, 20]) {
      expect(repMaxFromAmrapOneRm(calcAmrap1RM(BW_REF, reps))).toBe(reps)
    }
  })

  it('round-trips every rep count except the two collisions above 25 reps', () => {
    const mismatched: number[] = []
    for (let r = 1; r <= REP_CEILING; r++) {
      if (repMaxFromAmrapOneRm(calcAmrap1RM(BW_REF, r)) !== r) mismatched.push(r)
    }
    // Issue 2193 (a): with the smooth discount, 5 and 6 no longer share 114.5. Above 25 reps the
    // discount and the rep factor nearly cancel, so 27 and 30 land within a quarter of their lower
    // neighbour and read back as 26 and 29. The lower reading is the one the number supports.
    expect(mismatched).toEqual([27, 30])
    expect(calcAmrap1RM(BW_REF, 5)).not.toBe(calcAmrap1RM(BW_REF, 6))
  })

  it('inverts at the load the estimate was earned on', () => {
    expect(repMaxFromAmrapOneRm(calcAmrap1RM(BW_REF + 20, 8), 20)).toBe(8)
  })

  it('returns 0 with no estimate', () => {
    expect(repMaxFromAmrapOneRm(0)).toBe(0)
  })
})

describe('repMaxFromOneRm', () => {
  it('round-trips reps -> oneRm -> reps', () => {
    expect(repMaxFromOneRm(calc1RM(BW_REF, 10))).toBe(10)
    expect(repMaxFromOneRm(calc1RM(BW_REF, 6))).toBe(6)
  })

  it('returns 0 for no estimate and clamps tiny values to 1', () => {
    expect(repMaxFromOneRm(0)).toBe(0)
    expect(repMaxFromOneRm(1)).toBe(1)
  })

  it('is monotonic — more strength never means fewer reps', () => {
    expect(repMaxFromOneRm(calc1RM(BW_REF, 12))).toBeGreaterThanOrEqual(repMaxFromOneRm(calc1RM(BW_REF, 8)))
  })

  it('round-trips exactly for ≤5-rep sets; is deliberately conservative above (AMRAP scaling)', () => {
    // ≤5 reps: amrapScaleFactor = 1.0 → exact round trip: calcAmrap1RM(100,5)=114.5, repMax → 5
    expect(repMaxFromOneRm(estimateOneRm([{ weightKg: 0, reps: 5 }], { exerciseType: 'bodyweight' }).estimated1rm)).toBe(5)
    // 12 reps: estimate = calcAmrap1RM(100,12) = mround(142.0 × 0.93) = 132.0; largest r with
    // calc1RM(100,r) ≤ 132.5 is 9 (calc1RM(100,9)=129.25; calc1RM(100,10)=133.25) — conservative by design
    expect(repMaxFromOneRm(estimateOneRm([{ weightKg: 0, reps: 12 }], { exerciseType: 'bodyweight' }).estimated1rm)).toBe(9)
  })

  it('inverts at BW_REF + added load when addedKg is passed (C10)', () => {
    // 1RM proven at +20kg × 6: calc1RM(120,6) = mround(120 × 1.180645) = 141.75
    const est = calc1RM(120, 6)
    // at +20kg: calc1RM(120,6)=141.75 ≤ 142.25, calc1RM(120,7)=120×1.216667=146.0 > → 6 (clean round trip)
    expect(repMaxFromOneRm(est, 20)).toBe(6)
    // at bare bodyweight the same 1RM supports ~12 reps: calc1RM(100,12)=142.0 ≤ 142.25, calc1RM(100,13)=146.75 > → 12
    expect(repMaxFromOneRm(est)).toBe(12)
  })
})

describe('rescaleBodyweightReps', () => {
  it('rescales each set\'s reps from its pct and the rep-max derived from basis', () => {
    // basis chosen so repMaxFromOneRm(basis) === 5 (matches the repMaxFromOneRm test fixture pattern)
    const basis = calc1RM(BW_REF, 5)
    const style = [{ pct: 100, reps: 1 }, { pct: 80, reps: 1 }, { pct: 60, reps: 1 }]
    const out = rescaleBodyweightReps(style, basis)
    expect(out.map(s => s.reps)).toEqual([5, 4, 3])
  })

  it('never returns 0 reps — floors at 1', () => {
    const out = rescaleBodyweightReps([{ pct: 10, reps: 1 }], calc1RM(BW_REF, 5))
    expect(out[0].reps).toBeGreaterThanOrEqual(1)
  })

  it('returns the style unchanged when basis has no usable estimate (repMax <= 0)', () => {
    const style = [{ pct: 75, reps: 8 }]
    expect(rescaleBodyweightReps(style, 0)).toEqual(style)
  })

  it('preserves every other field on each set (restSec, useFor1rm)', () => {
    const style = [{ pct: 100, reps: 1, restSec: 90, useFor1rm: true }]
    const out = rescaleBodyweightReps(style, calc1RM(BW_REF, 5))
    expect(out[0]).toMatchObject({ restSec: 90, useFor1rm: true })
  })
})

describe('resolveBodyweightStyle (dropped-exercise regression fix)', () => {
  const basis = calc1RM(BW_REF, 5)
  const style = [{ pct: 100, reps: 1 }, { pct: 80, reps: 1 }]

  it('rescales a bodyweight exercise the AI dropped from its prescription (aiStyleApplied=false), even in an AI-driven session', () => {
    const out = resolveBodyweightStyle({ bwType: 'bodyweight', style, isBaselinePhase: false, aiStyleApplied: false, basis })
    expect(out!.map(s => s.reps)).toEqual([5, 4])
  })

  it('leaves an AI-prescribed bodyweight exercise (aiStyleApplied=true) untouched', () => {
    const out = resolveBodyweightStyle({ bwType: 'bodyweight', style, isBaselinePhase: false, aiStyleApplied: true, basis })
    expect(out).toBe(style)
  })

  it('leaves a weighted exercise untouched regardless of aiStyleApplied', () => {
    const out = resolveBodyweightStyle({ bwType: 'weighted', style, isBaselinePhase: false, aiStyleApplied: false, basis })
    expect(out).toBe(style)
  })

  it('leaves a baseline-phase bodyweight exercise untouched', () => {
    const out = resolveBodyweightStyle({ bwType: 'bodyweight', style, isBaselinePhase: true, aiStyleApplied: false, basis })
    expect(out).toBe(style)
  })

  it('passes through a null style unchanged', () => {
    const out = resolveBodyweightStyle({ bwType: 'bodyweight', style: null, isBaselinePhase: false, aiStyleApplied: false, basis })
    expect(out).toBeNull()
  })
})

describe('estimateOneRm — shared estimator (behaviour-preserving extraction)', () => {
  const generalStyle = [
    { pct: 60, reps: 12, useFor1rm: false },
    { pct: 60, reps: 12, useFor1rm: false },
    { pct: 60, reps: 12, useFor1rm: false },
  ]

  it('weighted + style: matches calculate1RM exactly', () => {
    // 20 × repFactor(12)=1.42 × prescriptionFactor(60,12)=1/(0.6×1.42) = 33.333 → mround 0.25 → 33.25
    const out = estimateOneRm(
      [{ weightKg: 20, reps: 12 }, { weightKg: 20, reps: 12 }, { weightKg: 20, reps: 12 }],
      { exerciseType: 'weighted', style: generalStyle },
    )
    expect(out.estimated1rm).toBe(33.25)
    expect(out.estimated1rm).toBe(calculate1RM([20, 20, 20], [12, 12, 12], generalStyle).estimated1rm)
    // targetPct is derived from the style's own pct (60, Task 5) — not the flat 80% calculate1RM uses
    expect(out.targetPct).toBe(60)
    expect(out.target80).toBe(mround(33.25 * 0.6, 0.25))
  })

  it('weighted, no style: 100kg × 5 reps → 114.5', () => {
    // Epley(5) = 1+5/30 = 1.16667 (pure Epley would give 116.67); Brzycki(5) = 36/32 = 1.125
    // this codebase averages them: repFactor(5) = 1.145833 → 100 × 1.145833 = 114.583 → mround 0.25 → 114.5
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }], { exerciseType: 'weighted' }).estimated1rm).toBe(114.5)
  })

  it('assisted bodyweight (negative added load) never produces a ≤0 effective weight', () => {
    const out = estimateOneRm([{ weightKg: -120, reps: 8 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBeGreaterThan(0) // effective = max(1, 100−120) = 1
  })

  it('returns 0 for no sets', () => {
    expect(estimateOneRm([], { exerciseType: 'weighted' }).estimated1rm).toBe(0)
  })
})

describe('estimateOneRm — deloaded gate (Q-115)', () => {
  // A deload's every set is useFor1rm:false — the exact same shape as the "General" style
  // above, whose all-false sets are meant to count anyway (calculate1RM's own fallback: no
  // set flagged true → use them all). That ambiguity is why `deloaded` exists as a separate,
  // unambiguous signal instead of trying to encode "exclude everything" via useFor1rm.
  const deloadStyle = [
    { pct: 50, reps: 8, useFor1rm: false },
    { pct: 50, reps: 11, useFor1rm: false },
  ]

  it('deloaded:true returns zero regardless of what the sets would otherwise estimate', () => {
    // These are the owner's real reported numbers (42.5kg × 8, 42.5kg × 11) that inflated
    // 78.75kg → 85.75kg before this fix.
    const out = estimateOneRm(
      [{ weightKg: 42.5, reps: 8 }, { weightKg: 42.5, reps: 11 }],
      { exerciseType: 'weighted', style: deloadStyle, deloaded: true },
    )
    expect(out.estimated1rm).toBe(0)
    expect(out.target80).toBe(0)
  })

  it('a deloaded bodyweight/baseline exercise is also excluded (both route through amrapAverage1Rm)', () => {
    const out = estimateOneRm(
      [{ weightKg: 0, reps: 12 }],
      { exerciseType: 'bodyweight', deloaded: true },
    )
    expect(out.estimated1rm).toBe(0)
  })

  it('deloaded:false (default) does not change existing behaviour for an all-useFor1rm:false style', () => {
    const generalStyle = [
      { pct: 60, reps: 12, useFor1rm: false },
      { pct: 60, reps: 12, useFor1rm: false },
    ]
    const out = estimateOneRm(
      [{ weightKg: 20, reps: 12 }, { weightKg: 20, reps: 12 }],
      { exerciseType: 'weighted', style: generalStyle },
    )
    expect(out.estimated1rm).toBeGreaterThan(0)
  })
})

describe('estimateOneRm — bodyweight/baseline AMRAP-scaled averaging (C3+C4)', () => {
  it('bodyweight averages per-set AMRAP-scaled estimates (was: max of best set)', () => {
    // Issue 2193 (a), smooth discount, rounded once:
    // set 1: calcAmrap1RM(100,6)  = mround(100 × repFactor(6) × 0.99) = 117.0
    // set 2: calcAmrap1RM(100,10) = mround(100 × repFactor(10) × 0.95) = 126.75
    // mean(117.0, 126.75) = 121.875 → 122.0 (old best-set rule: 133.25)
    const out = estimateOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(122)
  })

  it('a 34-rep bodyweight AMRAP is capped and scaled, not exploded', () => {
    // reps capped to 30: 100 × repFactor(30) (2.0588) × 0.82 = 168.82 → mround → 168.75 (169 when it
    // rounded calc1RM first, before issue 2193 (a))
    // OLD (clamp 36 + live Brzycki): repFactor(34)=(2.1333+36/3=12)/2=7.0667 → ~706.75 ≈ 7×BW_REF
    const out = estimateOneRm([{ weightKg: 0, reps: 34 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(168.75)
  })

  it('weighted bodyweight sets score higher than unweighted', () => {
    // calcAmrap1RM(120,6) = mround(120 × repFactor(6) × 0.99, .25) = 140.25
    expect(estimateOneRm([{ weightKg: 20, reps: 6 }], { exerciseType: 'bodyweight' }).estimated1rm).toBe(140.25)
  })

  it('honours useFor1rm subset flags like the weighted path', () => {
    const style = [
      { pct: 100, reps: 10, useFor1rm: true },
      { pct: 60, reps: 15, useFor1rm: false },
    ]
    // only set 1 counts: calcAmrap1RM(100,10) = 126.75
    const out = estimateOneRm([{ weightKg: 0, reps: 10 }, { weightKg: 0, reps: 15 }], { exerciseType: 'bodyweight', style })
    expect(out.estimated1rm).toBe(126.75)
  })

  it('baseline averages ALL sets (was: first set only)', () => {
    // set 1: calcAmrap1RM(100,10) = 126.75 ; set 2: calcAmrap1RM(100,8) = 121.75 (an anchor)
    // mean = 124.25 (old first-set-only rule: the first set alone)
    const out = estimateOneRm(
      [{ weightKg: 100, reps: 10 }, { weightKg: 100, reps: 8 }],
      { exerciseType: 'weighted', isBaseline: true },
    )
    expect(out.estimated1rm).toBe(124.25)
  })
})

describe('bestSetOneRm — display-only best-single-set estimate (C4 decision)', () => {
  it('returns the best single set where the session estimate averages', () => {
    // bestSetOneRm is display-only and deliberately NEVER applies the AMRAP band correction (see
    // its own comment) — per-set calc1RM = 114.5 (100×5) and 133.25 (100×10) → best = 133.25
    expect(bestSetOneRm([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 10 }], { exerciseType: 'weighted' })).toBe(133.25)
    // the SAVED session estimate AVERAGES the sets. Since issue 2357 an unprescribed working set
    // takes no AMRAP discount: mean(114.5, 133.25) = 123.875 → 124.0.
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 10 }], { exerciseType: 'weighted' }).estimated1rm).toBe(124)
  })

  it('uses AMRAP-scaled per-set values for bodyweight', () => {
    // per-set: 117.0 (6 reps) and 126.75 (10 reps) → best 126.75
    expect(bestSetOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })).toBe(126.75)
  })

  it('returns 0 with no valid sets', () => {
    expect(bestSetOneRm([], { exerciseType: 'weighted' })).toBe(0)
  })
})

describe('estimateOneRm targetPct from style (C10)', () => {
  it('uses the max pct of useFor1rm-flagged sets', () => {
    // single flagged top set 90 kg × 3 at (90%, 3): repFactor(3) = (1.1 + 36/34=1.05882)/2 = 1.07941
    // prescriptionFactor(90,3) = 1/(0.9 × 1.07941) = 1.02937 → 90 × 1.07941 × 1.02937 = 100.0 → est 100.0
    const style = [
      { pct: 90, reps: 3, useFor1rm: true },
      { pct: 70, reps: 8, useFor1rm: false },
    ]
    const out = estimateOneRm([{ weightKg: 90, reps: 3 }, { weightKg: 70, reps: 8 }], { exerciseType: 'weighted', style })
    expect(out.estimated1rm).toBe(100.0)
    expect(out.targetPct).toBe(90)
    expect(out.target80).toBe(90.0) // 100 × 0.9
  })

  it('falls back to the max style pct when nothing is flagged, and to 80 with no style', () => {
    const style = [{ pct: 70, reps: 8 }, { pct: 60, reps: 12 }]
    expect(estimateOneRm([{ weightKg: 70, reps: 8 }], { exerciseType: 'weighted', style }).targetPct).toBe(70)
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }], { exerciseType: 'weighted' }).targetPct).toBe(80)
  })

  it('an explicit opts.targetPct always wins', () => {
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }], { exerciseType: 'weighted', targetPct: 85 }).targetPct).toBe(85)
  })
})

describe('repFactor high-rep behaviour (C3)', () => {
  it('freezes the Brzycki term above 20 reps — no more blow-up', () => {
    // OLD repFactor(30) = (Epley 2.0 + Brzycki 36/7=5.1429)/2 = 3.5714 → calc1RM(100,30) = 357.25 (absurd)
    // NEW = (Epley(30)=2.0 + Brzycki(20)=36/17=2.11765)/2 = 2.05882 → 205.882 → mround 0.25 → 206
    expect(calc1RM(100, 30)).toBe(206)
    // NEW repFactor(25) = (1.83333 + 2.11765)/2 = 1.97549 → 197.549 → 197.5 (old: 241.75)
    expect(calc1RM(100, 25)).toBe(197.5)
  })

  it('is unchanged at and below 20 reps', () => {
    // repFactor(20) = (1.66667 + 36/17=2.11765)/2 = 1.89216 → 189.216 → 189.25
    expect(calc1RM(100, 20)).toBe(189.25)
    expect(calc1RM(100, 5)).toBe(114.5)
  })

  it('stays monotonic across the 20-rep boundary', () => {
    expect(repFactor(21)).toBeGreaterThan(repFactor(20))
    expect(repFactor(30)).toBeGreaterThan(repFactor(29))
  })
})

describe('REP_CEILING (C3)', () => {
  it('repMaxFromOneRm never prescribes more than 30 reps', () => {
    expect(repMaxFromOneRm(100_000)).toBe(REP_CEILING)
  })
})

// ── Display basis (audit finding Q-12) ──────────────────────────────────────
describe('bodyweight strength displays as reps, not kilograms (Q-12)', () => {
  it('renders a weighted 1RM in kg and a bodyweight one as a rep max', () => {
    expect(displayOneRm(92.5, 'weighted')).toEqual({ value: 92.5, unit: 'kg', text: '92.5 kg' })
    // calc1RM(100, 5) = 114.5 exactly, so a 114.5 estimate inverts to a 5 rep max.
    expect(displayOneRm(114.5, 'bodyweight')).toEqual({ value: 5, unit: 'RM', text: '5 RM' })
  })

  it('treats an unknown/absent exercise type as weighted', () => {
    expect(oneRmUnit(undefined)).toBe('kg')
    expect(oneRmUnit(null)).toBe('kg')
    expect(oneRmUnit('bodyweight')).toBe('RM')
  })

  it('inverts a weighted-variation estimate at the load it was earned on', () => {
    // A 10 kg-weighted pull-up 1RM must not be read back at bare bodyweight, or it
    // prescribes inflated rep targets (see repMaxFromOneRm).
    const oneRm = calc1RM(110, 5)
    expect(displayOneRm(oneRm, 'bodyweight', 10).value).toBe(5)
    expect(displayOneRm(oneRm, 'bodyweight', 0).value).toBeGreaterThan(5)
  })

  // BF-164: the bodyweight fixtures are DERIVED from `calcAmrap1RM`, which is what
  // `estimateOneRm` actually stores for a bodyweight set — they used to be hand-written values from
  // `calc1RM`, a forward map this path never uses. A stored 118 is 7 reps under the real map and 6
  // under the one the old fixtures came from, so the numbers agreed with the inverse under test and
  // with nothing else. Seven and eight, not five and six: five and six collide (the 1.0 → 0.97
  // step cancels the rep-factor gain) and no inverse can separate them.
  const bwStored = (reps: number) => calcAmrap1RM(BW_REF, reps)

  it('expresses a bodyweight delta in whole reps and a weighted one in kg', () => {
    expect(displayOneRmDelta(bwStored(8), bwStored(7), 'bodyweight')?.text).toBe('+1 rep')
    expect(displayOneRmDelta(bwStored(7), bwStored(8), 'bodyweight')?.text).toBe('-1 rep')
    expect(displayOneRmDelta(95, 92.5, 'weighted')?.text).toBe('+2.50 kg')
    expect(displayOneRmDelta(100, null, 'weighted')).toBeNull()
  })

  it('reports 0 reps when a bodyweight change is smaller than one rep', () => {
    // 114.5 and 115 both invert to a 5 rep max — sub-rep movement is not a rep gained.
    expect(displayOneRmDelta(115, 114.5, 'bodyweight')?.value).toBe(0)
  })

  it('converts a whole series for charts, and leaves weighted series untouched', () => {
    expect(displayOneRmSeries([bwStored(5), bwStored(7), bwStored(11)], 'bodyweight')).toEqual([5, 7, 11])
    expect(displayOneRmSeries([90, 92.5], 'weighted')).toEqual([90, 92.5])
  })

  // The owner's live report, as the assertion. His Hanging Leg Raise stored 128 from an 11-rep set
  // and every surface below printed "8 RM" four lines under "Last: 11 reps".
  // 128 is what 11 reps stored before issue 2193 (a); the same set stores 129.25 now. Both read 11.
  it('reads a real stored estimate back as the reps it came from', () => {
    expect(calcAmrap1RM(BW_REF, 11)).toBe(129.25)
    expect(displayOneRm(129.25, 'bodyweight').text).toBe('11 RM')
    expect(displayOneRm(128, 'bodyweight').text).toBe('11 RM')
    expect(displayOneRmSeries([128], 'bodyweight')).toEqual([11])
  })

  // Not cosmetic: this one sets prescribed reps. An understated rep max understates every target
  // by the same proportion — 8/11 is a 27% shortfall in training volume, not a label.
  it('prescribes reps off the true rep max', () => {
    expect(rescaleBodyweightReps([{ pct: 100, reps: 0 }], 128)[0].reps).toBe(11)
    expect(rescaleBodyweightReps([{ pct: 80, reps: 0 }], 128)[0].reps).toBe(8)
  })

  it('labels the metric for the exercise', () => {
    expect(oneRmLabel('bodyweight')).toBe('Rep Max')
    expect(oneRmLabel('weighted')).toBe('Estimated 1RM')
  })
})

// The values migration 148 wrote were generated from this module as it stood (the stepped AMRAP
// discount). Issue 2193 (a) smoothed the discount and did NOT rewrite stored rows, so these are now
// the legacy encoding: they must still READ BACK as the reps they came from, which is what every
// display and prescription does with them.
describe('migration 148 backfill values still read back as their reps (Q-12, issue 2193)', () => {
  const cases: [number[], number, number][] = [
    [[5], 114.5, 91.5],
    [[4, 4, 3, 3], 109.75, 87.75],
    [[7], 118, 94.5],
    [[11], 128, 102.5],
    [[5, 4, 4, 5], 113, 90.5],
    [[10, 10, 10], 124, 99.25],
  ]
  it.each(cases)('reps %j → %s / target %s', (reps, expected1rm, expectedTarget) => {
    expect(expectedTarget).toBe(Math.round(expected1rm * 0.8 * 4) / 4)
    // A set reads back within its range, never above it. One rep below is the documented legacy
    // collision: the old 10-rep value (124) is exactly the current 9-rep value, and an inverse must
    // read a current row right (see 1rm-ms44-arithmetic.test.ts, "legacy rows").
    const back = displayOneRm(expected1rm, 'bodyweight').value
    expect(back).toBeGreaterThanOrEqual(Math.min(...reps) - 1)
    expect(back).toBeLessThanOrEqual(Math.max(...reps))
    if (new Set(reps).size === 1) expect(back).toBe(reps[0] === 10 ? 9 : reps[0])
    // And the current estimator never stores LESS for the same sets.
    const now = estimateOneRm(reps.map(x => ({ weightKg: 0, reps: x })), { exerciseType: 'bodyweight', bwRef: 100 })
    expect(now.estimated1rm).toBeGreaterThanOrEqual(expected1rm)
  })
})

describe('describePersonalRecord (Q-19)', () => {
  it('announces a bodyweight record as a rep max, never a weight', () => {
    // Derived, per the BF-164 note above: `calcAmrap1RM(BW_REF, 7)` is 118, so a stored 118 is a
    // 7 RM. It read 6 while the fixture came from `calc1RM`, which is not what gets stored.
    expect(describePersonalRecord('Pull-Up', calcAmrap1RM(BW_REF, 7), 'bodyweight')).toBe('Pull-Up 7 RM')
    expect(describePersonalRecord('Pull-Up', calcAmrap1RM(BW_REF, 7), 'bodyweight')).not.toMatch(/kg/i)
  })

  it('keeps the existing phrasing for weighted lifts', () => {
    expect(describePersonalRecord('Barbell Bench Press', 96.4, 'weighted')).toBe('Barbell Bench Press 96kg est. 1RM')
  })

  it('treats an unknown type as weighted', () => {
    expect(describePersonalRecord('Mystery Lift', 100, undefined)).toContain('kg')
  })
})

describe('pickHeadlinePersonalRecord', () => {
  // The production case, 2026-08-03: Hanging Leg Raise (128) and Pull-Up (118) are the numerically
  // largest stored 1RMs, above a real 96 kg bench press — because a bodyweight 1RM is a BW_REF(100)
  // index, not kilograms. A plain max headlined a core exercise as the year's biggest lift.
  const PROD = [
    { exerciseName: 'Hanging Leg Raise', estimated1rm: 128, exerciseType: 'bodyweight' },
    { exerciseName: 'Pull-Up', estimated1rm: 118.3, exerciseType: 'bodyweight' },
    { exerciseName: 'Barbell Bench Press', estimated1rm: 96, exerciseType: 'weighted' },
    { exerciseName: 'Barbell Squat', estimated1rm: 87.5, exerciseType: 'weighted' },
  ]

  it('never lets a bodyweight index outrank a real weighted lift', () => {
    expect(pickHeadlinePersonalRecord(PROD)?.exerciseName).toBe('Barbell Bench Press')
  })

  it('still picks the heaviest weighted lift among weighted ones', () => {
    const heavier = [...PROD, { exerciseName: 'Barbell Hip Thrust', estimated1rm: 154.5, exerciseType: 'weighted' }]
    expect(pickHeadlinePersonalRecord(heavier)?.exerciseName).toBe('Barbell Hip Thrust')
  })

  it('falls back to the best bodyweight record when there is no weighted one', () => {
    const bwOnly = PROD.filter(p => p.exerciseType === 'bodyweight')
    expect(pickHeadlinePersonalRecord(bwOnly)?.exerciseName).toBe('Hanging Leg Raise')
  })

  it('treats an unknown or missing type as weighted, matching describePersonalRecord', () => {
    const rows = [
      { estimated1rm: 200, exerciseType: 'bodyweight' },
      { estimated1rm: 50, exerciseType: null },
    ]
    expect(pickHeadlinePersonalRecord(rows)?.estimated1rm).toBe(50)
  })

  it('returns null for an empty set rather than throwing', () => {
    expect(pickHeadlinePersonalRecord([])).toBeNull()
  })
})
