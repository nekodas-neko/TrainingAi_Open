/**
 * BF-59 — a full week of correct training painted red, because the target measured the wrong thing.
 *
 * The owner: *"i did the full sessions for the week; and i was nowhere near hitting the reccomended
 * amount of muscle sets"*, then the cause in their own words: *"oh yes cause its realization phase
 * its been less sets."* MAV is an **accumulation** target. Showing it during a peak tells an athlete
 * that doing the right thing is wrong.
 *
 * Two separate defects, and the numbers here are the production ones rather than invented:
 * `program_volume_targets` held a flat 14/10 binary — which the landmark table's own comment says it
 * does not do — and nothing anywhere reflected the phase.
 */
import { describe, it, expect } from 'vitest'
import {
  volumeLandmarks,
  weeklyVolumeTarget,
  phaseVolumeScale,
  PHASE_VOLUME_MULTIPLIER,
} from '../volume-targets'

// The owner's active program, from production: `Shikai`, powerbuilding (×0.8).
const GOAL = 'powerbuilding'

describe('the stored binary is not what the formula says', () => {
  // Stored-vs-landmark, straight from the entry's table. The point of asserting these is that the
  // binary is not merely coarse — it is wrong in BOTH directions, so "close enough" is not a defence.
  const CASES: [muscle: string, stored: number][] = [
    ['chest', 14], ['lats', 14], ['shoulders', 14], ['glutes', 14], ['hamstrings', 14],
    ['biceps', 10], ['lower back', 10],
  ]

  it('disagrees with the stored value on every muscle the entry measured', () => {
    for (const [muscle, stored] of CASES) {
      expect(weeklyVolumeTarget(GOAL, muscle, []), muscle).not.toBe(stored)
    }
  })

  // Triceps is deliberately NOT in the list above, and writing it down is the point: MAV 12 × 0.8
  // rounds to exactly the stored 10. One muscle out of fifteen where a coarse binary lands on the
  // right answer by arithmetic accident — which is why "the numbers look about right" was never
  // evidence that the stored rows were derived from anything.
  it('agrees with the binary on triceps, by coincidence', () => {
    expect(weeklyVolumeTarget(GOAL, 'triceps', [])).toBe(10)
  })

  it('is lower than the binary where the binary over-asked, and higher where it under-asked', () => {
    // Glutes: stored 14 against a goal-adjusted MAV of 8 — the owner logged 9 and read as short.
    expect(weeklyVolumeTarget(GOAL, 'glutes', [])).toBeLessThan(14)
    // Biceps: stored 10 against a goal-adjusted MAV of 11 — the binary asked for too LITTLE here.
    expect(weeklyVolumeTarget(GOAL, 'biceps', [])).toBeGreaterThan(10)
  })

  it('reflects the goal multiplier, which the stored rows ignored entirely', () => {
    // ×0.65 against ×1.0 — a strength program must visibly ask for less than a hypertrophy one.
    expect(weeklyVolumeTarget('strength', 'chest', []))
      .toBeLessThan(weeklyVolumeTarget('hypertrophy', 'chest', []))
  })
})

describe('phaseVolumeScale', () => {
  it('scales by 1 when nothing has been trained yet — the accumulation baseline', () => {
    expect(phaseVolumeScale([])).toEqual({ scale: 1, dominant: null, counts: {} })
  })

  it('takes the phase when a week sits in one', () => {
    const s = phaseVolumeScale(['realisation', 'realisation', 'realisation'])
    expect(s.scale).toBe(PHASE_VOLUME_MULTIPLIER.realisation)
    expect(s.dominant).toBe('realisation')
    expect(s.counts).toEqual({ realisation: 3 })
  })

  // A week is not in one phase, and this is the production case: the owner's ten sessions span
  // three at once, so there is no "this week's phase" that could be stored anywhere.
  it('averages a mixed week rather than picking one phase', () => {
    const s = phaseVolumeScale(['accumulation', 'accumulation', 'realisation'])
    expect(s.scale).toBeCloseTo((1.0 + 1.0 + 0.6) / 3, 10)
    expect(s.dominant).toBe('accumulation')
    expect(s.counts).toEqual({ accumulation: 2, realisation: 1 })
  })

  // Weighted by SESSIONS, not by distinct phases — training a session twice is two sessions' volume.
  it('counts a repeated phase twice', () => {
    expect(phaseVolumeScale(['realisation', 'accumulation']).scale)
      .toBeGreaterThan(phaseVolumeScale(['realisation', 'realisation', 'accumulation']).scale)
  })

  it('treats an unknown phase as unscaled rather than dropping it', () => {
    expect(phaseVolumeScale(['something-new']).scale).toBe(1)
  })
})

describe('the owner\'s week, which is the whole point', () => {
  // Five sessions, three of them realisation — the week they reported.
  const WEEK = ['realisation', 'realisation', 'realisation', 'accumulation', 'accumulation']

  it('asks for less in a peaking week than in an accumulation one', () => {
    for (const muscle of ['chest', 'lats', 'quads', 'glutes']) {
      expect(weeklyVolumeTarget(GOAL, muscle, WEEK), muscle)
        .toBeLessThan(weeklyVolumeTarget(GOAL, muscle, ['accumulation']))
    }
  })

  // The reported symptom, as an assertion: 9 glute sets against a stored target of 14 read as a
  // deficit. Against the phase-aware target it does not.
  it('reads the owner\'s 9 glute sets as met rather than short', () => {
    expect(weeklyVolumeTarget(GOAL, 'glutes', WEEK)).toBeLessThanOrEqual(9)
  })

  it('still asks for MORE than a pure peaking week would', () => {
    // Two of the five sessions were accumulation. A mixed week must not be scored as a full peak.
    expect(weeklyVolumeTarget(GOAL, 'chest', WEEK))
      .toBeGreaterThan(weeklyVolumeTarget(GOAL, 'chest', ['realisation']))
  })

  // A target of 0 would read as "no volume wanted", which is never what a phase means.
  it('never floors a target to zero, however hard the week is scaled', () => {
    const tiny = weeklyVolumeTarget('power', 'hip flexors', ['deload', 'deload'])
    expect(tiny).toBeGreaterThanOrEqual(1)
  })

  it('is the landmark table, not a second copy of it', () => {
    // An accumulation week must equal the goal-adjusted MAV exactly — if these ever diverge there
    // are two formulas again, which is the class this entry is filed under.
    for (const muscle of ['chest', 'biceps', 'lower back']) {
      expect(weeklyVolumeTarget(GOAL, muscle, ['accumulation']), muscle)
        .toBe(volumeLandmarks(GOAL, muscle).mav)
    }
  })
})
