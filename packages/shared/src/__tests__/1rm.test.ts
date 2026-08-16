import { describe, it, expect } from 'vitest'
import { calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM, oneRmTrendStatus, BW_REF, repMaxFromOneRm, rescaleBodyweightReps, resolveBodyweightStyle, estimateOneRm, repFactor, REP_CEILING, bestSetOneRm, mround, displayOneRm, displayOneRmDelta, displayOneRmSeries, oneRmLabel, oneRmUnit, describePersonalRecord, pickHeadlinePersonalRecord } from '../1rm'

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

  it('applies 0.88 factor at 15 reps', () => {
    const expected = Math.round(calc1RM(100, 15) * 0.88 * 4) / 4
    expect(calcAmrap1RM(100, 15)).toBe(expected)
  })

  it('applies 0.82 factor at 25 reps', () => {
    const expected = Math.round(calc1RM(100, 25) * 0.82 * 4) / 4
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

  it('falls back to raw calc1RM when no style is provided', () => {
    const { estimated1rm } = calculate1RM([100, 100, 100], [12, 12, 12])
    expect(estimated1rm).toBe(calc1RM(100, 12))
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

  it('ignores sets with reps above 30', () => {
    const { estimated1rm } = calculate1RM([20, 20], [12, 35], generalStyle)
    expect(estimated1rm).toBeGreaterThan(0)
    expect(estimated1rm).toBe(calculate1RM([20], [12], generalStyle).estimated1rm)
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
    const weights = [100, 100]
    const reps = [35, 6] // set 0 is >30 reps → excluded by the formula
    const style = [
      { pct: 100, reps: 5, useFor1rm: true },
      { pct: 100, reps: 5, useFor1rm: false },
    ]
    // Only the flagged set counts, but it is excluded (>30 reps) → primary is 0
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
    // set 1: calcAmrap1RM(100,6)  = mround(calc1RM(100,6)=118.0 × 0.97, .25) = mround(114.46) = 114.5
    // set 2: calcAmrap1RM(100,10) = mround(133.25 × 0.93, .25) = mround(123.9225) = 124.0
    // mean(114.5, 124.0) = 119.25 (old best-set rule: 133.25)
    const out = estimateOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(119.25)
  })

  it('a 34-rep bodyweight AMRAP is capped and scaled, not exploded', () => {
    // reps capped to 30: calc1RM(100,30) = 206 (Task 2) × amrapScaleFactor(30)=0.82 = 168.92 → mround → 169
    // OLD (clamp 36 + live Brzycki): repFactor(34)=(2.1333+36/3=12)/2=7.0667 → ~706.75 ≈ 7×BW_REF
    const out = estimateOneRm([{ weightKg: 0, reps: 34 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(169)
  })

  it('weighted bodyweight sets score higher than unweighted', () => {
    // calcAmrap1RM(120,6) = mround(calc1RM(120,6)=141.75 × 0.97, .25) = mround(137.4975) = 137.5
    expect(estimateOneRm([{ weightKg: 20, reps: 6 }], { exerciseType: 'bodyweight' }).estimated1rm).toBe(137.5)
  })

  it('honours useFor1rm subset flags like the weighted path', () => {
    const style = [
      { pct: 100, reps: 10, useFor1rm: true },
      { pct: 60, reps: 15, useFor1rm: false },
    ]
    // only set 1 counts: calcAmrap1RM(100,10) = 124.0
    const out = estimateOneRm([{ weightKg: 0, reps: 10 }, { weightKg: 0, reps: 15 }], { exerciseType: 'bodyweight', style })
    expect(out.estimated1rm).toBe(124.0)
  })

  it('baseline averages ALL sets (was: first set only)', () => {
    // set 1: 133.25 × 0.93 = 123.9225 → 124.0 ; set 2: calc1RM(100,8)=125.5 × 0.97 = 121.735 → 121.75
    // mean = 122.875 → mround 0.25 → 123.0 (old first-set-only rule: 124.0)
    const out = estimateOneRm(
      [{ weightKg: 100, reps: 10 }, { weightKg: 100, reps: 8 }],
      { exerciseType: 'weighted', isBaseline: true },
    )
    expect(out.estimated1rm).toBe(123.0)
  })
})

describe('bestSetOneRm — display-only best-single-set estimate (C4 decision)', () => {
  it('returns the best single set where the session estimate averages', () => {
    // weighted, no style: per-set calc1RM = 114.5 (100×5) and 133.25 (100×10) → best = 133.25
    expect(bestSetOneRm([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 10 }], { exerciseType: 'weighted' })).toBe(133.25)
    // the saved session estimate is the average — mean(114.5, 133.25)=123.875 → mround ... = 123.875×4=495.5→round 496 → 124.0
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 10 }], { exerciseType: 'weighted' }).estimated1rm).toBe(124.0)
  })

  it('uses AMRAP-scaled per-set values for bodyweight', () => {
    // per-set: 114.5 (6 reps) and 124.0 (10 reps) → best 124.0
    expect(bestSetOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })).toBe(124.0)
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

  it('expresses a bodyweight delta in whole reps and a weighted one in kg', () => {
    expect(displayOneRmDelta(118, 114.5, 'bodyweight')?.text).toBe('+1 rep')
    expect(displayOneRmDelta(114.5, 118, 'bodyweight')?.text).toBe('-1 rep')
    expect(displayOneRmDelta(95, 92.5, 'weighted')?.text).toBe('+2.50 kg')
    expect(displayOneRmDelta(100, null, 'weighted')).toBeNull()
  })

  it('reports 0 reps when a bodyweight change is smaller than one rep', () => {
    // 114.5 and 116 both invert to a 5 rep max — sub-rep movement is not a rep gained.
    expect(displayOneRmDelta(116, 114.5, 'bodyweight')?.value).toBe(0)
  })

  it('converts a whole series for charts, and leaves weighted series untouched', () => {
    expect(displayOneRmSeries([114.5, 118, 128], 'bodyweight')).toEqual([5, 6, 8])
    expect(displayOneRmSeries([90, 92.5], 'weighted')).toEqual([90, 92.5])
  })

  it('labels the metric for the exercise', () => {
    expect(oneRmLabel('bodyweight')).toBe('Rep Max')
    expect(oneRmLabel('weighted')).toBe('Estimated 1RM')
  })
})

// The values migration 148 writes are generated from THIS module, never restated in SQL.
// If the formula ever changes, this test fails and the migration's constants are known stale.
describe('migration 148 backfill values match the real estimator (Q-12)', () => {
  const cases: [number[], number, number][] = [
    [[5], 114.5, 91.5],
    [[4, 4, 3, 3], 109.75, 87.75],
    [[7], 118, 94.5],
    [[11], 128, 102.5],
    [[5, 4, 4, 5], 113, 90.5],
    [[10, 10, 10], 124, 99.25],
  ]
  it.each(cases)('reps %j → %s / target %s', (reps, expected1rm, expectedTarget) => {
    const r = estimateOneRm(reps.map(x => ({ weightKg: 0, reps: x })), { exerciseType: 'bodyweight', bwRef: 100 })
    expect(r.estimated1rm).toBe(expected1rm)
    expect(r.target80).toBe(expectedTarget)
  })
})

describe('describePersonalRecord (Q-19)', () => {
  it('announces a bodyweight record as a rep max, never a weight', () => {
    expect(describePersonalRecord('Pull-Up', 118, 'bodyweight')).toBe('Pull-Up 6 RM')
    expect(describePersonalRecord('Pull-Up', 118, 'bodyweight')).not.toMatch(/kg/i)
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
