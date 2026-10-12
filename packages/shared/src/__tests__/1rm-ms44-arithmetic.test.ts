// Batch ms44: issue 2200 (score against the bar loaded), issue 2193 (smooth AMRAP discount, clamp
// above 30 reps) and issue 2357 (styleless working sets undiscounted), all owner-signed 2026-10-06.
//
// `__fixtures__/1rm-main-baseline.json` pins what `origin/main` (961ff44d5) returned over a grid of
// weights, reps, styles and bodyweight-ness, generated from the unchanged file before any edit.
// Every test below either proves a grid point did NOT move, or names the decision that moved it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  calc1RM, calcAmrap1RM, calculate1RM, estimateOneRm, bestSetOneRm, repFactor, mround, REP_CEILING,
  amrapScaleFactor, withPrescribedBars, bodyweightRepMax, repMaxFromAmrapOneRm, runningEstimate1RM,
  type RMStyleSet,
} from '../1rm'
import { planStylelessOneRmRederive, medianStylelessMovePct } from '../workout/styleless-one-rm-rederive'

const baseline: Record<string, number> = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', '1rm-main-baseline.json'), 'utf8'),
)

const WEIGHTS = [20, 36.5, 60, 80, 100, 142.5]
const REPS = Array.from({ length: 35 }, (_, i) => i + 1)
const ANCHORS = new Set([1, 2, 3, 4, 5, 8, 12, 20, 30])
/** The app's prescription rounding (`mroundStepUp`, barbell step). */
const barFor = (basis: number, pct: number) => Math.max(5, Math.min(250, Math.ceil(basis * pct / 100 / 2.5) * 2.5))

describe('characterization against main: what moved, and why', () => {
  it('the baseline fixture is the full grid', () => {
    expect(Object.keys(baseline).length).toBe(2110)
  })

  it('issue 2193 (a)/(c): the AMRAP estimate moves only off the anchors and above the ceiling', () => {
    let movedOffAnchor = 0
    let movedAboveCeiling = 0
    for (const w of WEIGHTS) for (const r of REPS) {
      const now = calcAmrap1RM(w, r)
      const was = baseline[`amrap|${w}|${r}`]
      if (r <= 5) expect(now).toBe(was)
      else if (ANCHORS.has(r)) expect(Math.abs(now - was)).toBeLessThanOrEqual(0.25) // one rounding instead of two
      else if (r > REP_CEILING) { expect(now).toBe(calcAmrap1RM(w, REP_CEILING)); if (now !== was) movedAboveCeiling++ }
      else if (now !== was) movedOffAnchor++
      // Baseline-week and bodyweight averages are the same per-set number.
      expect(estimateOneRm([{ weightKg: w, reps: r }], { exerciseType: 'weighted', isBaseline: true }).estimated1rm).toBe(now)
    }
    expect({ movedOffAnchor, movedAboveCeiling }).toEqual({ movedOffAnchor: 126, movedAboveCeiling: 30 })
  })

  it('issue 2357 + 2193 (c): a styleless set is the plain rep-factor estimate, never lower than main, and 31+ reps count at 30', () => {
    let rose = 0
    for (const w of WEIGHTS) for (const r of REPS) {
      const now = calculate1RM([w, w, w], [r, r, r], null).estimated1rm
      const was = baseline[`styleless|${w}|${r}`]
      expect(now).toBe(mround(w * repFactor(Math.min(r, REP_CEILING)), 0.25))
      expect(now).toBeGreaterThanOrEqual(was)
      if (r <= 5) expect(now).toBe(was) // the discount was 1.0 there
      if (r > REP_CEILING) expect(was).toBe(0) // main dropped the set
      if (now > was) rose++
    }
    // 6..30 reps (25 counts) lose the discount and 31..35 (5) stop scoring zero, at each of 6 weights.
    expect(rose).toBe(6 * 30)
  })

  it('bodyweight: moves only with the smoothed discount, nothing at or below 5 reps', () => {
    for (const added of [0, 10]) for (const r of REPS) {
      const now = estimateOneRm([{ weightKg: added, reps: r }], { exerciseType: 'bodyweight' }).estimated1rm
      expect(now).toBe(calcAmrap1RM(100 + added, r))
      if (r <= 5) expect(now).toBe(baseline[`bw|${added}|${r}`])
    }
  })

  it('bestSetOneRm (display only) does not move at all', () => {
    for (const w of WEIGHTS) for (const r of REPS) {
      expect(bestSetOneRm([{ weightKg: w, reps: r }], { exerciseType: 'weighted' })).toBe(baseline[`best|${w}|${r}`])
    }
  })

  it('issue 2200: a styled set with NO stored bar scores exactly as on main (every row before #2445)', () => {
    for (const key of Object.keys(baseline).filter(k => k.startsWith('styled|'))) {
      const [, basis, pct, target, dw, dr] = key.split('|').map(Number)
      const w = barFor(basis, pct) + dw
      const r = target + dr
      expect(calculate1RM([w], [r], [{ pct, reps: target }]).estimated1rm).toBe(baseline[key])
    }
  })

  it('issue 2200: with the bar, exact adherence holds the 1RM, and every other move keeps its direction', () => {
    let moved = 0
    let movedDown = 0
    let exact = 0
    for (const key of Object.keys(baseline).filter(k => k.startsWith('styled|'))) {
      const [, basis, pct, target, dw, dr] = key.split('|').map(Number)
      const bar = barFor(basis, pct)
      const w = bar + dw
      const r = target + dr
      const style = withPrescribedBars([{ pct, reps: target }], [bar], basis)
      const now = calculate1RM([w], [r], style).estimated1rm
      if (dw === 0 && dr === 0) { exact++; expect(now).toBe(basis) }
      if (dw >= 0 && dr >= 0 && (dw > 0 || dr > 0)) expect(now).toBeGreaterThan(basis)
      if (dw <= 0 && dr <= 0 && (dw < 0 || dr < 0)) expect(now).toBeLessThan(basis)
      // The bar is never lighter than the planned share, so scoring against it never RAISES a set.
      expect(now).toBeLessThanOrEqual(baseline[key])
      if (now !== baseline[key]) { moved++; if (now < baseline[key]) movedDown++ }
    }
    expect(exact).toBe(80)
    expect({ moved, movedDown }).toEqual({ moved: 980, movedDown: 980 })
  })
})

describe('issue 2200: the owner-device case (Barbell Skull Crusher, 2026-10-06)', () => {
  const style = withPrescribedBars([{ pct: 70.5, reps: 10 }, { pct: 70.5, reps: 10 }], [27.5, 27.5], 36.5)
  it('27.5 x 10 as prescribed stores 36.5, not 39.0', () => {
    expect(calculate1RM([27.5, 27.5], [10, 10], [{ pct: 70.5, reps: 10 }, { pct: 70.5, reps: 10 }]).estimated1rm).toBe(39)
    expect(calculate1RM([27.5, 27.5], [10, 10], style).estimated1rm).toBe(36.5)
  })
  it('two reps short now lowers it; one rep over raises it', () => {
    expect(calculate1RM([27.5], [8], style!.slice(0, 1)).estimated1rm).toBeLessThan(36.5)
    expect(calculate1RM([27.5], [11], style!.slice(0, 1)).estimated1rm).toBeGreaterThan(36.5)
  })
  it('the live readout reads the same bars', () => {
    expect(runningEstimate1RM([27.5, 27.5], [10, 10], style)).toBe(36.5)
  })
  it('the same answer through the estimator every log path calls', () => {
    expect(estimateOneRm([{ weightKg: 27.5, reps: 10 }, { weightKg: 27.5, reps: 10 }], { exerciseType: 'weighted', style }).estimated1rm).toBe(36.5)
  })
})

describe('issue 2200: a bar is used only when its basis could have produced it', () => {
  const plan = (bar: number, basis: number): RMStyleSet[] => withPrescribedBars([{ pct: 70.5, reps: 10 }], [bar], basis)!
  const legacy = calculate1RM([27.5], [10], [{ pct: 70.5, reps: 10 }]).estimated1rm
  it.each([
    ['a bar more than one barbell step above the raw load', 30.5, 36.5],
    ['a bar lighter than the raw load', 25, 36.5],
    ['a basis that is not a number', 27.5, Number.NaN],
  ])('%s falls back to the planned percentage', (_l, bar, basis) => {
    expect(calculate1RM([27.5], [10], plan(bar, basis)).estimated1rm).toBe(legacy)
  })
  it('the 5 kg floor counts as a rounded bar', () => {
    const style = withPrescribedBars([{ pct: 50, reps: 10 }], [5], 6)
    expect(calculate1RM([5], [10], style).estimated1rm).toBe(6)
  })
  it('without a basis or bars the style is returned untouched', () => {
    const s = [{ pct: 70.5, reps: 10 }]
    expect(withPrescribedBars(s, [27.5], null)).toBe(s)
    expect(withPrescribedBars(s, undefined, 36.5)).toBe(s)
    expect(withPrescribedBars(null, [27.5], 36.5)).toBeNull()
  })
  it('a bodyweight set ignores bars entirely', () => {
    const style = withPrescribedBars([{ pct: 70, reps: 10 }], [27.5], 36.5)
    expect(estimateOneRm([{ weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight', style }).estimated1rm)
      .toBe(estimateOneRm([{ weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight', style: [{ pct: 70, reps: 10 }] }).estimated1rm)
  })
})

describe('issue 2193 (a): the AMRAP discount is smooth', () => {
  it('keeps the anchor values and interpolates between them', () => {
    expect([5, 8, 12, 20, 30].map(amrapScaleFactor)).toEqual([1, 0.97, 0.93, 0.88, 0.82])
    expect(amrapScaleFactor(10)).toBeCloseTo(0.95, 10)
    expect(amrapScaleFactor(25)).toBeCloseTo(0.85, 10)
    expect(amrapScaleFactor(1)).toBe(1)
    expect(amrapScaleFactor(40)).toBe(0.82)
  })
  it('one more rep never lowers the estimate, 5-250 kg, up to the ceiling', () => {
    let decreases = 0
    for (let w = 5; w <= 250; w += 0.25) for (let r = 1; r < REP_CEILING; r++) {
      if (calcAmrap1RM(w, r + 1) < calcAmrap1RM(w, r)) decreases++
    }
    expect(decreases).toBe(0)
  })
  it('the cases issue 2193 quotes at 80 kg no longer fall', () => {
    for (const [a, b] of [[8, 9], [12, 13], [20, 21]]) expect(calcAmrap1RM(80, b)).toBeGreaterThanOrEqual(calcAmrap1RM(80, a))
  })
})

describe('issue 2193 (c): above 30 reps counts at 30 on every path', () => {
  it.each([31, 35, 100])('%i reps', r => {
    expect(calc1RM(80, r)).toBe(calc1RM(80, 30))
    expect(calcAmrap1RM(80, r)).toBe(calcAmrap1RM(80, 30))
    expect(calculate1RM([80], [r], null).estimated1rm).toBe(calculate1RM([80], [30], null).estimated1rm)
    expect(calculate1RM([80], [r], [{ pct: 50, reps: 20 }]).estimated1rm).toBe(calculate1RM([80], [30], [{ pct: 50, reps: 20 }]).estimated1rm)
    expect(estimateOneRm([{ weightKg: 0, reps: r }], { exerciseType: 'bodyweight' }).estimated1rm)
      .toBe(estimateOneRm([{ weightKg: 0, reps: 30 }], { exerciseType: 'bodyweight' }).estimated1rm)
  })
})

describe('issue 2193 (b): a bodyweight rep max never ratchets down', () => {
  it('a stored bodyweight estimate reads back as the reps performed, below 26 reps and at any added load', () => {
    for (const added of [0, 10, 20]) for (let r = 1; r <= 26; r++) {
      const oneRm = estimateOneRm([{ weightKg: added, reps: r }], { exerciseType: 'bodyweight' }).estimated1rm
      expect(bodyweightRepMax({ oneRm, addedKg: added })).toBe(r)
    }
  })
  // Rows stored before this change keep the stepped encoding (past 1RMs are not rewritten). The
  // inverse reads both encodings; where a legacy value is exactly a LOWER count's current value the
  // two cannot be told apart, and the current reading wins because every future row is current.
  it('legacy rows (main-pinned values) read back exactly except at the named collisions', () => {
    const misses: string[] = []
    for (const added of [0, 10]) for (let r = 1; r <= REP_CEILING; r++) {
      const back = bodyweightRepMax({ oneRm: baseline[`bw|${added}|${r}`], addedKg: added })
      if (back !== r) misses.push(`+${added}kg ${r}->${back}`)
      expect(back).toBeLessThanOrEqual(r)
    }
    // On main the same inverse missed only `6->5` (the old 5/6 collision) at each load.
    expect(misses).toEqual(['+0kg 6->5', '+0kg 10->9', '+0kg 13->11', '+0kg 16->15', '+0kg 29->23', '+10kg 10->9', '+10kg 29->23'])
  })
  it('5 and 6 reps no longer collide', () => {
    expect(repMaxFromAmrapOneRm(calcAmrap1RM(100, 6))).toBe(6)
  })
  it('the logged reps still win where they are known', () => {
    expect(bodyweightRepMax({ storedReps: 6, oneRm: calcAmrap1RM(100, 3) })).toBe(6)
  })
})

describe('days moved on a synthetic history (every point is a main-pinned grid value)', () => {
  // [day, grid key]. Styled sets carry the bar the app would have loaded.
  const HISTORY: [number, string][] = [
    // Skull-crusher shape: 36.5 basis, 70.5 % x 10 — rounding adds 1.8 kg.
    [1, 'styled|36.5|70.5|10|0|0'], [8, 'styled|36.5|70.5|10|0|-1'], [15, 'styled|36.5|70.5|10|0|-2'], [22, 'styled|36.5|70.5|10|0|1'],
    // Bench shape: 100 x 75 % = exactly 75 kg, so rounding adds nothing.
    [2, 'styled|100|75|8|0|0'], [9, 'styled|100|75|8|0|0'], [16, 'styled|100|75|8|2.5|0'], [23, 'styled|100|75|8|0|-1'],
    // OHP shape: 57.5 x 85 % x 5.
    [3, 'styled|57.5|85|5|0|0'], [10, 'styled|57.5|85|5|0|1'], [17, 'styled|57.5|85|5|-2.5|0'], [24, 'styled|57.5|85|5|0|0'],
    // Heavy accessory: 142.5 x 60 % x 12.
    [4, 'styled|142.5|60|12|0|0'], [11, 'styled|142.5|60|12|0|2'],
    // Styleless working sets (issue 2357) at 8, 11, 12 and 5 reps, and a heavy triple.
    [5, 'styleless|36.5|8'], [12, 'styleless|36.5|11'], [19, 'styleless|36.5|12'], [26, 'styleless|36.5|5'], [6, 'styleless|60|3'],
    // A bodyweight set off an anchor (smoothed discount) and one at an anchor.
    [7, 'bw|0|10'], [14, 'bw|0|5'],
  ]
  const now = (key: string): number => {
    const p = key.split('|')
    if (p[0] === 'styled') {
      const [basis, pct, target, dw, dr] = p.slice(1).map(Number)
      const bar = barFor(basis, pct)
      return calculate1RM([bar + dw], [target + dr], withPrescribedBars([{ pct, reps: target }], [bar], basis)).estimated1rm
    }
    if (p[0] === 'styleless') { const w = Number(p[1]); const r = Number(p[2]); return calculate1RM([w, w, w], [r, r, r], null).estimated1rm }
    return estimateOneRm([{ weightKg: Number(p[1]), reps: Number(p[2]) }], { exerciseType: 'bodyweight' }).estimated1rm
  }

  it('moves 14 of 21 logs on 14 of 21 days; prescribed lifts only down, styleless only up', () => {
    const moves = HISTORY.map(([day, key]) => ({ day, key, was: baseline[key], now: now(key) }))
    const moved = moves.filter(m => m.now !== m.was)
    const styledMoves = moved.filter(m => m.key.startsWith('styled'))
    const stylelessMoves = moved.filter(m => m.key.startsWith('styleless'))
    expect(styledMoves.every(m => m.now < m.was)).toBe(true)
    expect(stylelessMoves.every(m => m.now > m.was)).toBe(true)
    // Exact adherence where rounding added nothing (bench, 75 kg) does not move.
    expect(moves.filter(m => m.key === 'styled|100|75|8|0|0').every(m => m.now === m.was)).toBe(true)
    expect({
      logsMoved: moved.length,
      daysMoved: new Set(moved.map(m => m.day)).size,
      styled: styledMoves.length,
      styleless: stylelessMoves.length,
      bodyweight: moved.length - styledMoves.length - stylelessMoves.length,
    }).toEqual({ logsMoved: 14, daysMoved: 14, styled: 10, styleless: 3, bodyweight: 1 })
  })
})

describe('issue 2357: the styleless re-derive plan', () => {
  const log = (id: string, est: number, sets: [number, number][]) => ({
    exerciseLogId: id, exerciseName: 'Curl', loggedAt: new Date('2026-09-10T00:00:00Z'), estimated1rm: est, target80: est * 0.8,
    sets: sets.map(([w, r], i) => ({ setLogId: `${id}-${i}`, weightKg: w, reps: r, intensityPct: null })),
  })
  it('raises a discounted log to the undiscounted value, with target and intensities', () => {
    const plan = planStylelessOneRmRederive([log('a', 39.5, [[32.5, 8], [32.5, 8]])])
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].after).toEqual({ estimated1rm: 40.75, target80: 32.5 })
    expect(plan.changes[0].sets.map(s => s.intensityPct)).toEqual([79.8, 79.8])
    expect(medianStylelessMovePct(plan.changes)).toBe(3.2)
  })
  it('is upward only: a lower re-derive is reported and never planned', () => {
    const plan = planStylelessOneRmRederive([log('b', 90, [[50, 5]])])
    expect(plan.changes).toEqual([])
    expect(plan.wouldLower).toEqual([expect.objectContaining({ exerciseLogId: 'b', stored: 90, rederived: 57.25 })])
  })
  it('is idempotent: a re-derived log is unchanged on the next pass', () => {
    const first = planStylelessOneRmRederive([log('a', 39.5, [[32.5, 8]])])
    const second = planStylelessOneRmRederive([log('a', first.changes[0].after.estimated1rm, [[32.5, 8]])])
    expect(second).toEqual({ changes: [], unchanged: 1, wouldLower: [] })
  })
  it('a log with no live sets is left alone', () => {
    expect(planStylelessOneRmRederive([log('c', 50, [])]).unchanged).toBe(1)
  })
})
