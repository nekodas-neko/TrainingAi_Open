// TN-6a: the temperature ladder is suspended while its baseline is demonstrably uncentred, and the
// suspension clears itself. The entry asks for both halves to be proven by feeding real and
// synthetic histories through the condition — "not by reading it".
import { describe, it, expect } from 'vitest'
import {
  isTemperatureBaselineCentred,
  TEMP_CENTRED_MAX_ABS_MEAN_C,
  TEMP_CENTRED_MIN_NIGHTS,
} from '../temperature-baseline-health'

// The owner's real shape, from BF-13's measurement: 34 nights, deviation positive on every one,
// mean +0.662 °C, range +0.14…+1.33. Reproduced rather than hand-waved so the case is the case.
const OWNER_UNCENTRED = [
  0.14, 0.21, 0.28, 0.33, 0.39, 0.42, 0.47, 0.51, 0.55, 0.58, 0.61, 0.63, 0.66, 0.68, 0.70, 0.72,
  0.74, 0.75, 0.77, 0.79, 0.81, 0.83, 0.85, 0.88, 0.91, 0.94, 0.98, 1.02, 1.08, 1.14, 1.20, 1.26,
  1.30, 1.33,
]

describe('the temperature ladder is suspended while the baseline is uncentred (TN-6a)', () => {
  it('suspends on the owner\'s real history', () => {
    // Mean is well outside ±0.15 and not one night is negative.
    const mean = OWNER_UNCENTRED.reduce((a, b) => a + b, 0) / OWNER_UNCENTRED.length
    expect(mean).toBeGreaterThan(0.6)
    expect(OWNER_UNCENTRED.every(d => d > 0)).toBe(true)
    expect(isTemperatureBaselineCentred(OWNER_UNCENTRED)).toBe(false)
  })

  it('CLEARS ITSELF once the deviations are centred — no deploy, no TODO', () => {
    // The same 34 nights, re-derived against a correct baseline: BF-13's seed fix shifts every
    // deviation down by the 0.363 °C the baseline was low, plus the residual offset.
    const centred = OWNER_UNCENTRED.map(d => d - 0.662)
    expect(isTemperatureBaselineCentred(centred)).toBe(true)
  })

  it('stays suspended just outside the band and lifts just inside it', () => {
    const at = (mean: number) => Array.from({ length: 20 }, () => mean)
    expect(isTemperatureBaselineCentred(at(TEMP_CENTRED_MAX_ABS_MEAN_C + 0.01))).toBe(false)
    expect(isTemperatureBaselineCentred(at(TEMP_CENTRED_MAX_ABS_MEAN_C))).toBe(true)
    // Symmetric: a baseline that runs HIGH is just as untrustworthy as one that runs low.
    expect(isTemperatureBaselineCentred(at(-(TEMP_CENTRED_MAX_ABS_MEAN_C + 0.01)))).toBe(false)
  })

  it('suspends when there is too little history to judge', () => {
    // Absence of evidence is not evidence of centredness. A perfectly centred but short history
    // still waits — it costs nothing, because a baseline this young was never trustworthy here.
    const short = Array.from({ length: TEMP_CENTRED_MIN_NIGHTS - 1 }, () => 0)
    expect(isTemperatureBaselineCentred(short)).toBe(false)
    expect(isTemperatureBaselineCentred([...short, 0])).toBe(true)
  })

  it('ignores nights with no reading rather than counting them as zero', () => {
    // A null deviation is a night the rollup did not resolve, not a night of perfect centredness.
    // Counting nulls as 0 would drag the mean toward zero and lift the suspension on missing data.
    const sparse = [...OWNER_UNCENTRED.slice(0, 12), ...Array.from({ length: 40 }, () => null)]
    expect(isTemperatureBaselineCentred(sparse)).toBe(false)
  })
})
